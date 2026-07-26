package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type NodeAppCloseRequestedEvent struct {
	ActiveTasks int    `json:"activeTasks"`
	QueryError  string `json:"queryError,omitempty"`
}

type NodeAppLifecycleActionResult struct {
	Supported bool   `json:"supported"`
	Message   string `json:"message"`
}

type nodeAppLifecycle struct {
	mu       sync.Mutex
	app      *application.App
	window   *application.WebviewWindow
	service  *XiraniteService
	nodeID   string
	title    string
	tray     *application.SystemTray
	quitting bool
	recovery NodeAppBackendRuntimeStatus
}

func newNodeAppLifecycle(app *application.App, window *application.WebviewWindow, service *XiraniteService, nodeID string, title string) *nodeAppLifecycle {
	lifecycle := &nodeAppLifecycle{
		app:     app,
		window:  window,
		service: service,
		nodeID:  nodeID,
		title:   title,
		recovery: NodeAppBackendRuntimeStatus{
			State:   "starting",
			Message: "Waiting for the bundled backend health check.",
		},
	}
	window.RegisterHook(events.Common.WindowClosing, lifecycle.handleWindowClosing)
	return lifecycle
}

func (l *nodeAppLifecycle) Close() {
	l.mu.Lock()
	tray := l.tray
	l.tray = nil
	l.mu.Unlock()
	if tray != nil {
		tray.Destroy()
	}
}

func (l *nodeAppLifecycle) continueInBackground() NodeAppLifecycleActionResult {
	l.mu.Lock()
	if l.quitting {
		l.mu.Unlock()
		return NodeAppLifecycleActionResult{Supported: true, Message: "The node application is already exiting."}
	}
	l.ensureTrayLocked()
	l.mu.Unlock()
	l.window.Hide()
	return NodeAppLifecycleActionResult{Supported: true, Message: "The node application is running in the system tray."}
}

func (l *nodeAppLifecycle) cancelTasksAndQuit() NodeAppLifecycleActionResult {
	context, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if err := l.cancelActiveOperations(context); err != nil {
		return NodeAppLifecycleActionResult{Supported: true, Message: fmt.Sprintf("Unable to cancel active tasks: %v", err)}
	}
	l.mu.Lock()
	if l.quitting {
		l.mu.Unlock()
		return NodeAppLifecycleActionResult{Supported: true, Message: "The node application is already exiting."}
	}
	l.quitting = true
	l.mu.Unlock()
	go l.app.Quit()
	return NodeAppLifecycleActionResult{Supported: true, Message: "Active tasks were cancelled and the node application is exiting."}
}

func (l *nodeAppLifecycle) runtimeStatus() NodeAppBackendRuntimeStatus {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.recovery
}

func (l *nodeAppLifecycle) setRuntimeStatus(status NodeAppBackendRuntimeStatus) {
	l.mu.Lock()
	l.recovery = status
	l.mu.Unlock()
	if l.app != nil {
		l.app.Event.Emit("node-app-backend-status", status)
	}
}

func (l *nodeAppLifecycle) handleWindowClosing(event *application.WindowEvent) {
	l.mu.Lock()
	quitting := l.quitting
	l.mu.Unlock()
	if quitting {
		return
	}

	context, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	operations, err := l.activeOperations(context)
	cancel()
	allowClose, prompt := nodeAppWindowCloseDecision(operations, err)
	if allowClose {
		l.mu.Lock()
		l.quitting = true
		l.mu.Unlock()
		return
	}

	event.Cancel()
	l.app.Event.Emit("node-app-close-requested", prompt)
}

func nodeAppWindowCloseDecision(operations []nodeAppOperation, queryErr error) (bool, NodeAppCloseRequestedEvent) {
	if queryErr != nil {
		return false, NodeAppCloseRequestedEvent{QueryError: fmt.Sprintf("Unable to verify active task status: %v", queryErr)}
	}
	if len(operations) == 0 {
		return true, NodeAppCloseRequestedEvent{}
	}
	return false, NodeAppCloseRequestedEvent{ActiveTasks: len(operations)}
}

func (l *nodeAppLifecycle) ensureTrayLocked() {
	if l.tray != nil {
		return
	}
	tray := l.app.SystemTray.New()
	tray.SetTooltip(fmt.Sprintf("%s is running", l.title))
	tray.OnClick(l.restoreWindow)
	menu := application.NewMenu()
	menu.Add("Restore window").OnClick(func(*application.Context) { l.restoreWindow() })
	menu.AddSeparator()
	menu.Add("Cancel tasks and exit").OnClick(func(*application.Context) { go l.cancelTasksAndQuit() })
	tray.SetMenu(menu)
	l.tray = tray
}

func (l *nodeAppLifecycle) restoreWindow() {
	l.window.Show().Focus()
}

func (l *nodeAppLifecycle) activeOperations(context context.Context) ([]nodeAppOperation, error) {
	config := l.service.InternalBackendConfig()
	if config == nil || strings.TrimSpace(config.BaseURL) == "" {
		return nil, fmt.Errorf("bundled backend is unavailable")
	}
	request, err := http.NewRequestWithContext(context, http.MethodGet, strings.TrimRight(config.BaseURL, "/")+"/node-operations?activeOnly=true", nil)
	if err != nil {
		return nil, err
	}
	if config.Token != "" {
		request.Header.Set("x-xiranite-token", config.Token)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("active operation query returned %d", response.StatusCode)
	}
	var payload struct {
		Operations []nodeAppOperation `json:"operations"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, err
	}
	return payload.Operations, nil
}

func (l *nodeAppLifecycle) cancelActiveOperations(context context.Context) error {
	operations, err := l.activeOperations(context)
	if err != nil {
		return err
	}
	for _, operation := range operations {
		if operation.OperationID == "" {
			continue
		}
		if err := l.cancelOperation(context, operation.OperationID); err != nil {
			return err
		}
	}
	return nil
}

func (l *nodeAppLifecycle) cancelOperation(context context.Context, operationID string) error {
	config := l.service.InternalBackendConfig()
	if config == nil || strings.TrimSpace(config.BaseURL) == "" {
		return nil
	}
	url := strings.TrimRight(config.BaseURL, "/") + "/node-operations/" + operationID + "/cancel"
	request, err := http.NewRequestWithContext(context, http.MethodPost, url, nil)
	if err != nil {
		return err
	}
	if config.Token != "" {
		request.Header.Set("x-xiranite-token", config.Token)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("cancel operation %s returned %d", operationID, response.StatusCode)
	}
	return nil
}

type nodeAppOperation struct {
	OperationID string `json:"operationId"`
}
