package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const externalNodeLaunchSmokeMarkerEnv = "XIRANITE_EXTERNAL_NODE_LAUNCH_SMOKE_MARKER"
const externalNodeLaunchSmokeShutdownFileEnv = "XIRANITE_EXTERNAL_NODE_LAUNCH_SMOKE_SHUTDOWN_FILE"

type desktopSmokeMarker struct {
	NodeID           string                              `json:"nodeId"`
	SnapshotID       string                              `json:"snapshotId"`
	BackendBaseURL   string                              `json:"backendBaseUrl,omitempty"`
	BackendToken     string                              `json:"backendToken,omitempty"`
	WindowCreated    bool                                `json:"windowCreated"`
	HostCalls        []string                            `json:"hostCalls,omitempty"`
	Acknowledgements []externalNodeLaunchAcknowledgement `json:"acknowledgements,omitempty"`
}

var desktopSmokeMarkerMu sync.Mutex

// writeNodeAppSmokeMarker is an opt-in release-gate seam. It is ignored in
// ordinary launches and records only that the Wails window and bundled backend
// reached their startup boundary inside the isolated smoke environment.
func writeNodeAppSmokeMarker(backend *LocalBackend) {
	writeDesktopSmokeMarker(backend, "XIRANITE_NODE_APP_SMOKE_MARKER", nodeAppID, nodeAppSnapshotID)
}

func writeExternalNodeLaunchSmokeMarker(backend *LocalBackend, nodeID string) {
	writeDesktopSmokeMarker(backend, externalNodeLaunchSmokeMarkerEnv, nodeID, externalNodeLaunchHostSnapshotID)
}

func writeDesktopSmokeMarker(backend *LocalBackend, markerEnvironment string, nodeID string, snapshotID string) {
	path := strings.TrimSpace(os.Getenv(markerEnvironment))
	if path == "" {
		return
	}
	payload := desktopSmokeMarker{
		NodeID:        nodeID,
		SnapshotID:    snapshotID,
		WindowCreated: true,
	}
	if backend != nil {
		payload.BackendBaseURL = backend.Config.BaseURL
		payload.BackendToken = backend.Config.Token
	}
	writeDesktopSmokeMarkerFile(path, payload)
}

func recordExternalNodeLaunchSmokeAcknowledgement(acknowledgement externalNodeLaunchAcknowledgement) {
	path := strings.TrimSpace(os.Getenv(externalNodeLaunchSmokeMarkerEnv))
	if path == "" {
		return
	}
	desktopSmokeMarkerMu.Lock()
	defer desktopSmokeMarkerMu.Unlock()
	content, err := os.ReadFile(path)
	if err != nil {
		log.Printf("External node launch smoke marker read failed: %v", err)
		return
	}
	var payload desktopSmokeMarker
	if err := json.Unmarshal(content, &payload); err != nil {
		log.Printf("External node launch smoke marker decode failed: %v", err)
		return
	}
	payload.Acknowledgements = append(payload.Acknowledgements, acknowledgement)
	writeDesktopSmokeMarkerFile(path, payload)
}

func recordExternalNodeLaunchSmokeHostCall(name string) {
	path := strings.TrimSpace(os.Getenv(externalNodeLaunchSmokeMarkerEnv))
	if path == "" {
		return
	}
	desktopSmokeMarkerMu.Lock()
	defer desktopSmokeMarkerMu.Unlock()
	content, err := os.ReadFile(path)
	if err != nil {
		log.Printf("External node launch smoke marker read failed: %v", err)
		return
	}
	var payload desktopSmokeMarker
	if err := json.Unmarshal(content, &payload); err != nil {
		log.Printf("External node launch smoke marker decode failed: %v", err)
		return
	}
	payload.HostCalls = append(payload.HostCalls, name)
	writeDesktopSmokeMarkerFile(path, payload)
}

func writeDesktopSmokeMarkerFile(path string, payload desktopSmokeMarker) {
	content, err := json.Marshal(payload)
	if err != nil {
		log.Printf("Desktop smoke marker serialization failed: %v", err)
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		log.Printf("Desktop smoke marker directory failed: %v", err)
		return
	}
	if err := os.WriteFile(path, content, 0o644); err != nil {
		log.Printf("Desktop smoke marker write failed: %v", err)
	}
}

// startNodeAppSmokeShutdown is only enabled when the opt-in marker is present.
// It lets the release gate exercise App.Quit instead of force-killing Wails,
// which otherwise leaves WebView2 profile handles open during cleanup.
func startNodeAppSmokeShutdown(app *application.App) func() {
	return startDesktopSmokeShutdown(app, "XIRANITE_NODE_APP_SMOKE_MARKER", "XIRANITE_NODE_APP_SMOKE_SHUTDOWN_FILE")
}

func startExternalNodeLaunchSmokeShutdown(app *application.App) func() {
	return startDesktopSmokeShutdown(app, externalNodeLaunchSmokeMarkerEnv, externalNodeLaunchSmokeShutdownFileEnv)
}

func startDesktopSmokeShutdown(app *application.App, markerEnvironment string, shutdownFileEnvironment string) func() {
	if strings.TrimSpace(os.Getenv(markerEnvironment)) == "" {
		return func() {}
	}
	path := strings.TrimSpace(os.Getenv(shutdownFileEnvironment))
	if path == "" {
		return func() {}
	}

	stop := make(chan struct{})
	go func() {
		ticker := time.NewTicker(50 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				if _, err := os.Stat(path); err == nil {
					app.Quit()
					return
				}
			}
		}
	}()
	return func() { close(stop) }
}
