package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// writeNodeAppSmokeMarker is an opt-in release-gate seam. It is ignored in
// ordinary launches and records only that the Wails window and bundled backend
// reached their startup boundary inside the isolated smoke environment.
func writeNodeAppSmokeMarker(backend *LocalBackend) {
	path := strings.TrimSpace(os.Getenv("XIRANITE_NODE_APP_SMOKE_MARKER"))
	if path == "" {
		return
	}
	payload := struct {
		NodeID         string `json:"nodeId"`
		SnapshotID     string `json:"snapshotId"`
		BackendBaseURL string `json:"backendBaseUrl,omitempty"`
		BackendToken   string `json:"backendToken,omitempty"`
		WindowCreated  bool   `json:"windowCreated"`
	}{
		NodeID:        nodeAppID,
		SnapshotID:    nodeAppSnapshotID,
		WindowCreated: true,
	}
	if backend != nil {
		payload.BackendBaseURL = backend.Config.BaseURL
		payload.BackendToken = backend.Config.Token
	}
	content, err := json.Marshal(payload)
	if err != nil {
		log.Printf("Node app smoke marker serialization failed: %v", err)
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		log.Printf("Node app smoke marker directory failed: %v", err)
		return
	}
	if err := os.WriteFile(path, content, 0o644); err != nil {
		log.Printf("Node app smoke marker write failed: %v", err)
	}
}

// startNodeAppSmokeShutdown is only enabled when the opt-in marker is present.
// It lets the release gate exercise App.Quit instead of force-killing Wails,
// which otherwise leaves WebView2 profile handles open during cleanup.
func startNodeAppSmokeShutdown(app *application.App) func() {
	if strings.TrimSpace(os.Getenv("XIRANITE_NODE_APP_SMOKE_MARKER")) == "" {
		return func() {}
	}
	path := strings.TrimSpace(os.Getenv("XIRANITE_NODE_APP_SMOKE_SHUTDOWN_FILE"))
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
