package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const externalNodeLaunchHostSnapshotID = "external-launch-v1"
const externalNodeLaunchAcknowledgementTimeout = 15 * time.Second

type externalNodeLaunchHostInfo struct {
	NodeID     string `json:"nodeId"`
	SnapshotID string `json:"snapshotId"`
}

type externalNodeLaunchAcknowledgement struct {
	RequestID string `json:"requestId"`
	Accepted  bool   `json:"accepted"`
	Message   string `json:"message,omitempty"`
}

type externalNodeLaunchHostRuntime struct {
	mu           sync.Mutex
	app          *application.App
	info         externalNodeLaunchHostInfo
	pending      map[string]externalNodeLaunchPending
	pendingOrder []string
}

type externalNodeLaunchPending struct {
	request  externalNodeLaunchRequest
	response chan externalNodeLaunchAcknowledgement
}

func newExternalNodeLaunchHostRuntime(app *application.App, request externalNodeLaunchRequest) *externalNodeLaunchHostRuntime {
	copy := request
	return &externalNodeLaunchHostRuntime{
		app:  app,
		info: externalNodeLaunchHostInfo{NodeID: request.NodeID, SnapshotID: externalNodeLaunchHostSnapshotID},
		pending: map[string]externalNodeLaunchPending{
			request.RequestID: {request: copy, response: make(chan externalNodeLaunchAcknowledgement, 1)},
		},
		pendingOrder: []string{request.RequestID},
	}
}

func (r *externalNodeLaunchHostRuntime) hostInfo() externalNodeLaunchHostInfo {
	return r.info
}

func (r *externalNodeLaunchHostRuntime) nextPendingRequest() *externalNodeLaunchRequest {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, requestID := range r.pendingOrder {
		pending, found := r.pending[requestID]
		if !found {
			continue
		}
		copy := pending.request
		return &copy
	}
	return nil
}

func (r *externalNodeLaunchHostRuntime) queue(request externalNodeLaunchRequest) <-chan externalNodeLaunchAcknowledgement {
	r.mu.Lock()
	response := make(chan externalNodeLaunchAcknowledgement, 1)
	r.pending[request.RequestID] = externalNodeLaunchPending{request: request, response: response}
	r.pendingOrder = append(r.pendingOrder, request.RequestID)
	r.mu.Unlock()
	recordExternalNodeLaunchSmokeHostCall("QueuedExternalNodeLaunch:" + request.RequestID)
	if r.app != nil {
		r.app.Event.Emit("external-node-launch", request)
	}
	return response
}

func (r *externalNodeLaunchHostRuntime) acknowledge(acknowledgement externalNodeLaunchAcknowledgement) externalNodeLaunchAcknowledgement {
	r.mu.Lock()
	pending, found := r.pending[acknowledgement.RequestID]
	if found {
		delete(r.pending, acknowledgement.RequestID)
		r.pendingOrder = removeExternalNodeLaunchRequestID(r.pendingOrder, acknowledgement.RequestID)
	}
	r.mu.Unlock()
	if !found {
		return externalNodeLaunchAcknowledgement{
			RequestID: acknowledgement.RequestID,
			Accepted:  false,
			Message:   "The external launch request is no longer pending.",
		}
	}
	if acknowledgement.Message == "" {
		acknowledgement.Message = "Node accepted the external launch request."
	}
	recordExternalNodeLaunchSmokeAcknowledgement(acknowledgement)
	pending.response <- acknowledgement
	return acknowledgement
}

func (r *externalNodeLaunchHostRuntime) rejectPending(message string) {
	r.mu.Lock()
	pending := r.pending
	r.pending = map[string]externalNodeLaunchPending{}
	r.pendingOrder = nil
	r.mu.Unlock()
	for requestID, request := range pending {
		request.response <- externalNodeLaunchAcknowledgement{RequestID: requestID, Accepted: false, Message: message}
	}
}

func removeExternalNodeLaunchRequestID(requestIDs []string, requestID string) []string {
	for index, value := range requestIDs {
		if value == requestID {
			return append(requestIDs[:index:index], requestIDs[index+1:]...)
		}
	}
	return requestIDs
}

func runExternalNodeLaunchHost(request externalNodeLaunchRequest) error {
	declaration, found := generatedExternalNodeLaunchDeclarations[request.NodeID]
	if !found {
		return fmt.Errorf("node %q does not declare external launch support", request.NodeID)
	}
	instance, primary, err := acquireExternalNodeLaunchHostInstance(request.NodeID, externalNodeLaunchHostDataDirectory(request.NodeID))
	if err != nil {
		return fmt.Errorf("acquire external node host: %w", err)
	}
	if !primary {
		acknowledgement, err := submitExternalNodeLaunchToExistingHost(request.NodeID, request, externalNodeLaunchAcknowledgementTimeout)
		if err != nil {
			return fmt.Errorf("deliver external node launch to existing host: %w", err)
		}
		if !acknowledgement.Accepted {
			return fmt.Errorf("%s", acknowledgement.Message)
		}
		return nil
	}
	defer instance.Close()

	if err := configureExternalNodeLaunchHostEnvironment(request.NodeID, declaration); err != nil {
		return err
	}
	localBackend, err := StartLocalBackend()
	if err != nil {
		return fmt.Errorf("start complete %s node host backend: %w", request.NodeID, err)
	}
	if localBackend == nil {
		return fmt.Errorf("complete %s node host requires an owned local backend", request.NodeID)
	}
	service := NewXiraniteService(localBackend)
	defer service.StopLocalBackend()
	title := fmt.Sprintf("Xiranite: %s", request.NodeID)
	App = application.New(application.Options{
		Name:        title,
		Description: "Xiranite external node launch host",
		Services:    []application.Service{application.NewService(service)},
		Assets: application.AssetOptions{
			Handler:    application.AssetFileServerFS(assets),
			Middleware: backendGatewayMiddleware(service.InternalBackendConfig, service.LocalBackendConfig),
		},
		Windows: externalNodeLaunchWindowsOptions(),
	})
	window := App.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "external-node-host",
		Title:            title,
		DevToolsEnabled:  true,
		KeyBindings:      devToolsKeyBindings(),
		Windows:          application.WindowsWindow{Theme: application.SystemDefault, ResizeDebounceMS: 0},
		BackgroundColour: application.NewRGB(20, 20, 20),
		URL:              "/node-host.html",
		Width:            1280,
		Height:           820,
		MinWidth:         460,
		MinHeight:        320,
		EnableFileDrop:   true,
		Frameless:        true,
	})
	wireFileDrop(window)
	primeWindowFrame(window)
	lifecycle := newNodeAppLifecycle(App, window, service, request.NodeID, title)
	service.setNodeAppLifecycle(lifecycle)
	defer lifecycle.Close()
	runtime := newExternalNodeLaunchHostRuntime(App, request)
	service.setExternalNodeLaunchHostRuntime(runtime)
	instance.SetRequestHandler(func(next externalNodeLaunchRequest) externalNodeLaunchAcknowledgement {
		response := runtime.queue(next)
		select {
		case acknowledgement := <-response:
			return acknowledgement
		case <-time.After(externalNodeLaunchAcknowledgementTimeout):
			return externalNodeLaunchAcknowledgement{RequestID: next.RequestID, Accepted: false, Message: "Timed out waiting for the node launch acknowledgement."}
		}
	})
	stopRecovery := startNodeAppBackendRecovery(service, nodeAppBackendExpectation{
		NodeID:     request.NodeID,
		SnapshotID: externalNodeLaunchHostSnapshotID,
	}, lifecycle.setRuntimeStatus)
	defer stopRecovery()
	writeExternalNodeLaunchSmokeMarker(localBackend, request.NodeID)
	stopSmokeShutdown := startExternalNodeLaunchSmokeShutdown(App)
	defer stopSmokeShutdown()
	if err := App.Run(); err != nil {
		runtime.rejectPending(fmt.Sprintf("External node host stopped: %v", err))
		return err
	}
	runtime.rejectPending("External node host closed before the request was acknowledged.")
	return nil
}

func configureExternalNodeLaunchHostEnvironment(nodeID string, declaration externalNodeLaunchDeclaration) error {
	if strings.TrimSpace(nodeAppMinimumBunVersion) == "" {
		nodeAppMinimumBunVersion = defaultBunRuntimeVersion
	}
	if strings.TrimSpace(nodeAppBuildBunVersion) == "" {
		nodeAppBuildBunVersion = nodeAppMinimumBunVersion
	}
	dataContractVersion := strconv.Itoa(nodeAppCurrentDataContractVersion)
	if _, err := checkNodeAppDataContract(dataContractVersion, dataContractVersion); err != nil {
		return fmt.Errorf("verify complete %s node host data contract: %w", nodeID, err)
	}
	if err := os.Setenv("XIRANITE_NODE_APP_ID", nodeID); err != nil {
		return fmt.Errorf("configure node host id: %w", err)
	}
	if err := os.Setenv("XIRANITE_NODE_APP_SNAPSHOT_ID", externalNodeLaunchHostSnapshotID); err != nil {
		return fmt.Errorf("configure node host snapshot: %w", err)
	}
	if err := os.Setenv("XIRANITE_NODE_APP_DATA_CONTRACT_VERSION", dataContractVersion); err != nil {
		return fmt.Errorf("configure node host data contract: %w", err)
	}
	if containsExternalLaunchFeature(declaration.BackendFeatures, "reader") {
		if err := os.Setenv("XIRANITE_NODE_APP_ENABLE_READER", "1"); err != nil {
			return fmt.Errorf("configure node host reader feature: %w", err)
		}
	} else {
		_ = os.Unsetenv("XIRANITE_NODE_APP_ENABLE_READER")
	}
	return nil
}

func containsExternalLaunchFeature(features []string, feature string) bool {
	for _, value := range features {
		if strings.EqualFold(value, feature) {
			return true
		}
	}
	return false
}

func externalNodeLaunchHostDataDirectory(nodeID string) string {
	return filepath.Join(xiraniteDataDirectory(), "direct-node-hosts", nodeID)
}

func externalNodeLaunchWindowsOptions() application.WindowsOptions {
	return wailsWindowsOptions()
}
