package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type XiraniteService struct {
	storageMu          sync.Mutex
	backendMu          sync.Mutex
	backendRestartMu   sync.Mutex
	componentWindowMu  sync.Mutex
	nodeAppMu          sync.RWMutex
	externalLaunchMu   sync.RWMutex
	userDataDir        string
	storageFile        string
	localBackend       *LocalBackend
	trayManager        *desktopTrayManager
	nodeAppRuntime     *nodeAppLifecycle
	externalLaunchHost *externalNodeLaunchHostRuntime
}

type FsEntry struct {
	Name         string  `json:"name"`
	Path         string  `json:"path"`
	IsDirectory  bool    `json:"isDirectory"`
	SizeBytes    int64   `json:"sizeBytes"`
	LastModified float64 `json:"lastModified"`
}

type FsStat struct {
	Path         string  `json:"path"`
	IsDirectory  bool    `json:"isDirectory"`
	SizeBytes    int64   `json:"sizeBytes"`
	LastModified float64 `json:"lastModified"`
}

type SubprocessRequest struct {
	Cmd   string            `json:"cmd"`
	Args  []string          `json:"args"`
	Cwd   string            `json:"cwd"`
	Env   map[string]string `json:"env"`
	Stdin string            `json:"stdin"`
}

type SubprocessResult struct {
	ExitCode int    `json:"exitCode"`
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
}

type WindowCapabilities struct {
	Supported            bool   `json:"supported"`
	NativeWindowControls bool   `json:"nativeWindowControls"`
	Frameless            bool   `json:"frameless"`
	ComponentWindows     string `json:"componentWindows"`
	Message              string `json:"message,omitempty"`
}

type WindowCommandResult struct {
	Success   bool   `json:"success"`
	Supported bool   `json:"supported"`
	ID        string `json:"id,omitempty"`
	Message   string `json:"message"`
	State     string `json:"state,omitempty"`
}

type WindowFrame struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

type OpenComponentWindowInput struct {
	ComponentID string `json:"componentId"`
	ModuleID    string `json:"moduleId"`
	WorkspaceID string `json:"workspaceId"`
	Title       string `json:"title"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
}

type ComponentWindowFrameEvent struct {
	ComponentID string `json:"componentId"`
	ModuleID    string `json:"moduleId"`
	WorkspaceID string `json:"workspaceId,omitempty"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
}

type LocalBackendRestartResult struct {
	Restarted bool                `json:"restarted"`
	Supported bool                `json:"supported"`
	Message   string              `json:"message"`
	Config    *LocalBackendConfig `json:"config,omitempty"`
}

func NewXiraniteService(localBackend *LocalBackend) *XiraniteService {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		home = "."
	}
	userDataDir := filepath.Join(home, ".xiranite")
	return &XiraniteService{
		userDataDir:  userDataDir,
		storageFile:  filepath.Join(userDataDir, "storage.json"),
		localBackend: localBackend,
	}
}

func (s *XiraniteService) LocalBackendConfig() *LocalBackendConfig {
	s.backendMu.Lock()
	defer s.backendMu.Unlock()

	if s.localBackend == nil || s.localBackend.Config.BaseURL == "" {
		return nil
	}
	if s.localBackend.external {
		config := s.localBackend.Config
		return &config
	}
	return &LocalBackendConfig{
		BaseURL: wailsBackendPublicURL,
		Token:   s.localBackend.Config.Token,
	}
}

func (s *XiraniteService) InternalBackendConfig() *LocalBackendConfig {
	s.backendMu.Lock()
	defer s.backendMu.Unlock()

	if s.localBackend == nil || s.localBackend.Config.BaseURL == "" {
		return nil
	}
	config := s.localBackend.Config
	return &config
}

func (s *XiraniteService) RestartLocalBackend() (LocalBackendRestartResult, error) {
	s.backendRestartMu.Lock()
	defer s.backendRestartMu.Unlock()

	s.backendMu.Lock()
	current := s.localBackend
	if current == nil {
		s.backendMu.Unlock()
		return LocalBackendRestartResult{
			Restarted: false,
			Supported: false,
			Message:   "Local backend is not owned by the desktop shell.",
		}, nil
	}
	if current.external {
		s.backendMu.Unlock()
		return LocalBackendRestartResult{
			Restarted: false,
			Supported: false,
			Message:   "The current local backend is externally managed.",
		}, nil
	}
	s.backendMu.Unlock()

	token := current.Config.Token
	current.Stop()
	next, err := startLocalBackend(token)
	if err != nil {
		return LocalBackendRestartResult{}, err
	}
	if next == nil || next.external {
		if next != nil {
			next.Stop()
		}
		return LocalBackendRestartResult{
			Restarted: false,
			Supported: false,
			Message:   "Local backend restart is not supported in the current runtime mode.",
		}, nil
	}

	s.backendMu.Lock()
	s.localBackend = next
	config := LocalBackendConfig{BaseURL: wailsBackendPublicURL, Token: next.Config.Token}
	s.backendMu.Unlock()
	return LocalBackendRestartResult{
		Restarted: true,
		Supported: true,
		Message:   "Local backend restarted by the desktop shell.",
		Config:    &config,
	}, nil
}

func (s *XiraniteService) StopLocalBackend() {
	s.backendRestartMu.Lock()
	defer s.backendRestartMu.Unlock()

	s.backendMu.Lock()
	backend := s.localBackend
	s.localBackend = nil
	s.backendMu.Unlock()

	if backend != nil {
		backend.Stop()
	}
}

func (s *XiraniteService) setNodeAppLifecycle(lifecycle *nodeAppLifecycle) {
	s.nodeAppMu.Lock()
	s.nodeAppRuntime = lifecycle
	s.nodeAppMu.Unlock()
}

func (s *XiraniteService) nodeAppLifecycle() *nodeAppLifecycle {
	s.nodeAppMu.RLock()
	defer s.nodeAppMu.RUnlock()
	return s.nodeAppRuntime
}

func (s *XiraniteService) setExternalNodeLaunchHostRuntime(runtime *externalNodeLaunchHostRuntime) {
	s.externalLaunchMu.Lock()
	s.externalLaunchHost = runtime
	s.externalLaunchMu.Unlock()
}

func (s *XiraniteService) externalNodeLaunchHostRuntime() *externalNodeLaunchHostRuntime {
	s.externalLaunchMu.RLock()
	defer s.externalLaunchMu.RUnlock()
	return s.externalLaunchHost
}

// ExternalNodeLaunchHostInfo identifies a complete direct-node host. It is
// unavailable to the workspace host and to frozen standalone node packages.
func (s *XiraniteService) ExternalNodeLaunchHostInfo() *externalNodeLaunchHostInfo {
	runtime := s.externalNodeLaunchHostRuntime()
	if runtime == nil {
		return nil
	}
	info := runtime.hostInfo()
	return &info
}

// ExternalNodeLaunchInitial returns the first request held while WebView and
// the declared node surface complete their capability handshake.
func (s *XiraniteService) ExternalNodeLaunchInitial() *externalNodeLaunchRequest {
	runtime := s.externalNodeLaunchHostRuntime()
	if runtime == nil {
		return nil
	}
	return runtime.initialRequest()
}

// AcknowledgeExternalNodeLaunch is deliberately the final step of an external
// request. Process reuse reports success only after the declared node has
// accepted or rejected the normalized target.
func (s *XiraniteService) AcknowledgeExternalNodeLaunch(acknowledgement externalNodeLaunchAcknowledgement) externalNodeLaunchAcknowledgement {
	runtime := s.externalNodeLaunchHostRuntime()
	if runtime == nil {
		return externalNodeLaunchAcknowledgement{
			RequestID: acknowledgement.RequestID,
			Accepted:  false,
			Message:   "This desktop window is not an external node launch host.",
		}
	}
	return runtime.acknowledge(acknowledgement)
}

// NodeAppContinueInBackground hides a standalone node window while preserving
// its owned backend and active operations. It is unavailable to the workspace
// host, where the ordinary tray manager owns this policy.
func (s *XiraniteService) NodeAppContinueInBackground() NodeAppLifecycleActionResult {
	lifecycle := s.nodeAppLifecycle()
	if lifecycle == nil {
		return NodeAppLifecycleActionResult{Supported: false, Message: "This is not a standalone node application."}
	}
	return lifecycle.continueInBackground()
}

// NodeAppCancelTasksAndQuit explicitly cancels active node operations before
// terminating the standalone application and its contained Bun process tree.
func (s *XiraniteService) NodeAppCancelTasksAndQuit() NodeAppLifecycleActionResult {
	lifecycle := s.nodeAppLifecycle()
	if lifecycle == nil {
		return NodeAppLifecycleActionResult{Supported: false, Message: "This is not a standalone node application."}
	}
	return lifecycle.cancelTasksAndQuit()
}

// NodeAppRuntimeStatus exposes recovery state to the standalone diagnostic UI.
func (s *XiraniteService) NodeAppRuntimeStatus() NodeAppBackendRuntimeStatus {
	lifecycle := s.nodeAppLifecycle()
	if lifecycle == nil {
		return NodeAppBackendRuntimeStatus{State: "unavailable", Message: "This is not a standalone node application."}
	}
	return lifecycle.runtimeStatus()
}

func (s *XiraniteService) StorageGet(key string) (*string, error) {
	s.storageMu.Lock()
	defer s.storageMu.Unlock()

	storage, err := s.loadStorage()
	if err != nil {
		return nil, err
	}
	value, ok := storage[key]
	if !ok {
		return nil, nil
	}
	return &value, nil
}

func (s *XiraniteService) StorageSet(key string, value string) error {
	s.storageMu.Lock()
	defer s.storageMu.Unlock()

	storage, err := s.loadStorage()
	if err != nil {
		return err
	}
	storage[key] = value
	return s.saveStorage(storage)
}

func (s *XiraniteService) StorageDelete(key string) error {
	s.storageMu.Lock()
	defer s.storageMu.Unlock()

	storage, err := s.loadStorage()
	if err != nil {
		return err
	}
	delete(storage, key)
	return s.saveStorage(storage)
}

func (s *XiraniteService) StorageKeys(prefix string) ([]string, error) {
	s.storageMu.Lock()
	defer s.storageMu.Unlock()

	storage, err := s.loadStorage()
	if err != nil {
		return nil, err
	}

	keys := make([]string, 0)
	for key := range storage {
		if strings.HasPrefix(key, prefix) {
			keys = append(keys, key)
		}
	}
	return keys, nil
}

func (s *XiraniteService) mainTrayEnabled() bool {
	s.storageMu.Lock()
	defer s.storageMu.Unlock()

	storage, err := s.loadStorage()
	if err != nil {
		return false
	}
	return storage[mainTrayStorageKey] == "1"
}

func (s *XiraniteService) FsExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func (s *XiraniteService) FsListDir(path string) ([]FsEntry, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}

	out := make([]FsEntry, 0, len(entries))
	for _, entry := range entries {
		entryPath := filepath.Join(path, entry.Name())
		info, err := entry.Info()
		if err != nil {
			continue
		}
		out = append(out, FsEntry{
			Name:         entry.Name(),
			Path:         entryPath,
			IsDirectory:  entry.IsDir(),
			SizeBytes:    info.Size(),
			LastModified: float64(info.ModTime().UnixMilli()),
		})
	}
	return out, nil
}

func (s *XiraniteService) FsReadFileText(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (s *XiraniteService) FsReadFileBytes(path string) ([]int, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	out := make([]int, len(data))
	for index, value := range data {
		out[index] = int(value)
	}
	return out, nil
}

func (s *XiraniteService) FsWriteFileText(path string, content string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(content), 0o644)
}

func (s *XiraniteService) FsWriteFileBytes(path string, content []int) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}

	data := make([]byte, len(content))
	for index, value := range content {
		if value < 0 || value > 255 {
			return fmt.Errorf("byte value out of range at index %d", index)
		}
		data[index] = byte(value)
	}
	return os.WriteFile(path, data, 0o644)
}

func (s *XiraniteService) FsRemove(path string, _ bool) error {
	return os.RemoveAll(path)
}

func (s *XiraniteService) FsRename(oldPath string, newPath string) error {
	if err := os.MkdirAll(filepath.Dir(newPath), 0o755); err != nil {
		return err
	}
	return os.Rename(oldPath, newPath)
}

func (s *XiraniteService) FsStat(path string) (FsStat, error) {
	info, err := os.Stat(path)
	if err != nil {
		return FsStat{}, err
	}
	return FsStat{
		Path:         path,
		IsDirectory:  info.IsDir(),
		SizeBytes:    info.Size(),
		LastModified: float64(info.ModTime().UnixMilli()),
	}, nil
}

func (s *XiraniteService) SubprocessSpawn(payloadJSON string) (string, error) {
	var request SubprocessRequest
	if err := json.Unmarshal([]byte(payloadJSON), &request); err != nil {
		return "", err
	}
	if request.Cmd == "" {
		return "", errors.New("subprocess command is required")
	}

	cmd := exec.Command(request.Cmd, request.Args...)
	configureHiddenSubprocess(cmd)
	if request.Cwd != "" {
		cmd.Dir = request.Cwd
	}
	if request.Env != nil {
		env := os.Environ()
		for key, value := range request.Env {
			env = append(env, key+"="+value)
		}
		cmd.Env = env
	}
	if request.Stdin != "" {
		cmd.Stdin = strings.NewReader(request.Stdin)
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	exitCode := 0
	if err != nil {
		var exitError *exec.ExitError
		if errors.As(err, &exitError) {
			exitCode = exitError.ExitCode()
		} else {
			return "", err
		}
	}

	return marshalString(SubprocessResult{
		ExitCode: exitCode,
		Stdout:   stdout.String(),
		Stderr:   stderr.String(),
	})
}

func (s *XiraniteService) EventsPublish(topic string, eventJSON string) error {
	if App == nil {
		return errors.New("application is not ready")
	}
	App.Event.Emit("xiranite:event:"+topic, eventJSON)
	return nil
}

func (s *XiraniteService) NodeRun(nodeID string, inputJSON string) (string, error) {
	if nodeID == "" {
		return "", errors.New("nodeID is required")
	}
	if inputJSON == "" {
		inputJSON = "null"
	}
	if !json.Valid([]byte(inputJSON)) {
		return "", errors.New("node input is not valid JSON")
	}

	bun, err := exec.LookPath("bun")
	if err != nil && runtime.GOOS == "windows" {
		bun, err = exec.LookPath("bun.exe")
	}
	if err != nil {
		return "", errors.New("Bun is required to run Xiranite TypeScript node packages")
	}

	root := findProjectRoot()
	payload := fmt.Sprintf(`{"nodeId":%s,"input":%s}`, quoteJSON(nodeID), inputJSON)
	cmd := exec.Command(bun, "desktop/node-runner-cli.ts")
	configureHiddenSubprocess(cmd)
	cmd.Dir = root
	cmd.Stdin = strings.NewReader(payload)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		detail := strings.TrimSpace(stderr.String())
		if detail == "" {
			detail = err.Error()
		}
		return "", fmt.Errorf("node runner failed: %s", detail)
	}
	return stdout.String(), nil
}

func (s *XiraniteService) WindowCapabilities() WindowCapabilities {
	return WindowCapabilities{
		Supported:            true,
		NativeWindowControls: true,
		Frameless:            true,
		ComponentWindows:     "native",
		Message:              "Wails runtime controls native windows.",
	}
}

func (s *XiraniteService) WindowOpenComponent(inputJSON string) (WindowCommandResult, error) {
	if App == nil {
		return WindowCommandResult{Success: false, Supported: false, Message: "Application is not ready."}, nil
	}

	var input OpenComponentWindowInput
	if err := json.Unmarshal([]byte(inputJSON), &input); err != nil {
		return WindowCommandResult{}, err
	}
	if input.ComponentID == "" || input.ModuleID == "" {
		return WindowCommandResult{Success: false, Supported: true, Message: "componentId and moduleId are required."}, nil
	}

	s.componentWindowMu.Lock()
	defer s.componentWindowMu.Unlock()

	id := componentWindowID(input.ComponentID)
	if existing, ok := getWindow(id); ok {
		existing.Focus()
		return WindowCommandResult{
			Success:   true,
			Supported: true,
			ID:        id,
			Message:   "Focused existing component window.",
		}, nil
	}
	title := input.Title
	if title == "" {
		title = input.ModuleID
	}
	width := input.Width
	if width <= 0 {
		width = 460
	}
	height := input.Height
	if height <= 0 {
		height = 380
	}
	query := url.Values{}
	query.Set("floatingComponent", input.ComponentID)
	query.Set("moduleId", input.ModuleID)
	query.Set("title", title)
	query.Set("windowId", id)
	if input.WorkspaceID != "" {
		query.Set("workspaceId", input.WorkspaceID)
	}

	win := App.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:            id,
		Title:           title,
		DevToolsEnabled: true,
		KeyBindings:     devToolsKeyBindings(),
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 40,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		Windows: application.WindowsWindow{
			Theme:            application.SystemDefault,
			ResizeDebounceMS: 0,
		},
		BackgroundColour: application.NewRGB(20, 20, 20),
		URL:              "/?" + query.Encode(),
		Width:            width,
		Height:           height,
		MinWidth:         360,
		MinHeight:        260,
		EnableFileDrop:   true,
		Frameless:        true,
	})
	if err := setWindowTaskbarIdentity(win, id); err != nil {
		log.Printf("Unable to give component window %q an independent taskbar identity: %v", id, err)
	}
	if err := setWindowTaskbarIcon(win, input.ModuleID, title); err != nil {
		log.Printf("Unable to set component window %q taskbar icon: %v", id, err)
	}
	wireFileDrop(win)
	trackComponentWindowFrame(win, input)
	primeWindowFrame(win)

	return WindowCommandResult{
		Success:   true,
		Supported: true,
		ID:        id,
		Message:   "Opened component in a Wails native window.",
	}, nil
}

func componentWindowID(componentID string) string {
	return "component-" + componentID
}

const componentWindowFrameEventName = "component-window-frame"

func trackComponentWindowFrame(window application.Window, input OpenComponentWindowInput) {
	publishCurrentFrame := func(_ *application.WindowEvent) {
		if window.IsMaximised() || window.IsFullscreen() || window.IsMinimised() {
			return
		}
		width, height := window.Size()
		event, ok := newComponentWindowFrameEvent(input, width, height)
		if !ok || App == nil {
			return
		}
		App.Event.Emit(componentWindowFrameEventName, event)
	}

	if runtime.GOOS == "windows" {
		window.OnWindowEvent(events.Windows.WindowEndResize, publishCurrentFrame)
	}
	window.RegisterHook(events.Common.WindowClosing, publishCurrentFrame)
}

func newComponentWindowFrameEvent(input OpenComponentWindowInput, width int, height int) (ComponentWindowFrameEvent, bool) {
	if input.ComponentID == "" || input.ModuleID == "" || width < 360 || height < 260 {
		return ComponentWindowFrameEvent{}, false
	}
	return ComponentWindowFrameEvent{
		ComponentID: input.ComponentID,
		ModuleID:    input.ModuleID,
		WorkspaceID: input.WorkspaceID,
		Width:       width,
		Height:      height,
	}, true
}

func (s *XiraniteService) WindowFocus(id string) WindowCommandResult {
	window, ok := getWindow(id)
	if !ok {
		return WindowCommandResult{Success: false, Supported: true, ID: id, Message: "Window is not tracked."}
	}
	window.Focus()
	return WindowCommandResult{Success: true, Supported: true, ID: id, Message: "Window focused."}
}

func (s *XiraniteService) WindowClose(id string) WindowCommandResult {
	window, ok := getWindow(id)
	if !ok {
		return WindowCommandResult{Success: false, Supported: true, ID: id, Message: "Window is not tracked."}
	}
	window.Close()
	return WindowCommandResult{Success: true, Supported: true, ID: id, Message: "Window closed.", State: "closed"}
}

func (s *XiraniteService) WindowOpenDevTools(id string) WindowCommandResult {
	window, ok := getWindow(id)
	if !ok {
		return WindowCommandResult{Success: false, Supported: true, ID: id, Message: "Window is not tracked."}
	}
	window.OpenDevTools()
	return WindowCommandResult{Success: true, Supported: true, ID: id, Message: "Developer tools opened."}
}

func (s *XiraniteService) WindowGetFrame(id string) (*WindowFrame, error) {
	window, ok := getWindow(id)
	if !ok {
		return nil, nil
	}
	bounds := window.Bounds()
	return &WindowFrame{
		X:      bounds.X,
		Y:      bounds.Y,
		Width:  bounds.Width,
		Height: bounds.Height,
	}, nil
}

func (s *XiraniteService) WindowSetFrame(id string, frameJSON string) (WindowCommandResult, error) {
	window, ok := getWindow(id)
	if !ok {
		return WindowCommandResult{Success: false, Supported: true, ID: id, Message: "Window is not tracked."}, nil
	}

	var frame WindowFrame
	if err := json.Unmarshal([]byte(frameJSON), &frame); err != nil {
		return WindowCommandResult{}, err
	}
	window.SetBounds(application.Rect{X: frame.X, Y: frame.Y, Width: frame.Width, Height: frame.Height})
	return WindowCommandResult{Success: true, Supported: true, ID: id, Message: "Window frame updated."}, nil
}

func (s *XiraniteService) loadStorage() (map[string]string, error) {
	if err := os.MkdirAll(s.userDataDir, 0o755); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(s.storageFile)
	if errors.Is(err, os.ErrNotExist) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, err
	}

	storage := map[string]string{}
	if len(data) == 0 {
		return storage, nil
	}
	if err := json.Unmarshal(data, &storage); err != nil {
		return map[string]string{}, nil
	}
	return storage, nil
}

func (s *XiraniteService) saveStorage(storage map[string]string) error {
	if err := os.MkdirAll(s.userDataDir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(storage, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.storageFile, data, 0o644)
}

func getWindow(id string) (application.Window, bool) {
	if App == nil {
		return nil, false
	}
	if id == "" {
		id = "main"
	}
	return App.Window.Get(id)
}

func primeWindowFrame(window application.Window) {
	if window == nil || runtime.GOOS != "windows" {
		return
	}

	go func() {
		for _, delay := range []time.Duration{120 * time.Millisecond, 420 * time.Millisecond, 900 * time.Millisecond, 1500 * time.Millisecond} {
			time.Sleep(delay)
			bounds := window.Bounds()
			if bounds.Width <= 0 || bounds.Height <= 0 {
				continue
			}
			nudged := bounds
			nudged.Width++
			window.SetBounds(nudged)
			time.Sleep(16 * time.Millisecond)
			window.SetBounds(bounds)
		}
	}()
}

func findProjectRoot() string {
	starts := make([]string, 0, 2)
	if cwd, err := os.Getwd(); err == nil {
		starts = append(starts, cwd)
	}
	if exe, err := os.Executable(); err == nil {
		starts = append(starts, filepath.Dir(exe))
	}

	seen := map[string]bool{}
	for _, start := range starts {
		dir, err := filepath.Abs(start)
		if err != nil {
			continue
		}
		for {
			if seen[dir] {
				break
			}
			seen[dir] = true
			if fileExists(filepath.Join(dir, "desktop", "node-runner-cli.ts")) {
				return dir
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}

	cwd, _ := os.Getwd()
	return cwd
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func quoteJSON(value string) string {
	data, _ := json.Marshal(value)
	return string(data)
}

func marshalString(value any) (string, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(data), nil
}
