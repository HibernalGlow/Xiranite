package main

import (
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Set by the node-app builder with Go -ldflags. Empty means normal Xiranite.
var nodeAppID string
var nodeAppTitle string
var nodeAppSnapshotID string
var nodeAppMinimumBunVersion string
var nodeAppBuildBunVersion string
var nodeAppDataContractVersion string
var nodeAppMinimumDataContractVersion string
var nodeAppMaximumDataContractVersion string
var nodeAppEnableReader string

func runNodeApp() {
	if strings.TrimSpace(nodeAppSnapshotID) == "" {
		nodeAppSnapshotID = "development"
	}
	if strings.TrimSpace(nodeAppMinimumBunVersion) == "" {
		nodeAppMinimumBunVersion = "1.3.0"
	}
	if strings.TrimSpace(nodeAppBuildBunVersion) == "" {
		nodeAppBuildBunVersion = nodeAppMinimumBunVersion
	}
	if strings.TrimSpace(nodeAppDataContractVersion) == "" {
		nodeAppDataContractVersion = "1"
	}
	if strings.TrimSpace(nodeAppMinimumDataContractVersion) == "" {
		nodeAppMinimumDataContractVersion = nodeAppDataContractVersion
	}
	if strings.TrimSpace(nodeAppMaximumDataContractVersion) == "" {
		nodeAppMaximumDataContractVersion = nodeAppDataContractVersion
	}
	instance, primary, err := acquireNodeAppInstance(nodeAppID, nodeAppDataDirectory(nodeAppID))
	if err != nil {
		log.Printf("Unable to acquire node app instance: %v", err)
		return
	}
	if !primary {
		return
	}
	defer instance.Close()

	if err := os.Setenv("XIRANITE_NODE_APP_ID", nodeAppID); err != nil {
		log.Printf("Unable to configure node app backend: %v", err)
	}
	if err := os.Setenv("XIRANITE_NODE_APP_SNAPSHOT_ID", nodeAppSnapshotID); err != nil {
		log.Printf("Unable to configure node app snapshot: %v", err)
	}
	if err := os.Setenv("XIRANITE_NODE_APP_DATA_CONTRACT_VERSION", nodeAppDataContractVersion); err != nil {
		log.Printf("Unable to configure node app data contract: %v", err)
	}
	if strings.EqualFold(nodeAppEnableReader, "true") {
		_ = os.Setenv("XIRANITE_NODE_APP_ENABLE_READER", "1")
	}

	dataContract, dataContractErr := checkNodeAppDataContract(nodeAppMinimumDataContractVersion, nodeAppMaximumDataContractVersion)
	if dataContractErr != nil {
		log.Printf("Node app data contract is incompatible: %v", dataContractErr)
	}

	var localBackend *LocalBackend
	if dataContractErr == nil {
		localBackend, err = StartLocalBackend()
		if err != nil {
			log.Printf("Node app backend is unavailable: %v", err)
		} else if localBackend != nil {
			log.Printf("Node app backend ready: %s", localBackend.Config.BaseURL)
		}
	}

	service := NewXiraniteService(localBackend)
	defer service.StopLocalBackend()
	title := strings.TrimSpace(nodeAppTitle)
	if title == "" {
		title = nodeAppID
	}
	App = application.New(application.Options{
		Name:        title,
		Description: "Xiranite standalone node application",
		Services: []application.Service{
			application.NewService(service),
		},
		Assets: application.AssetOptions{
			Handler:    application.AssetFileServerFS(assets),
			Middleware: backendGatewayMiddleware(service.InternalBackendConfig, service.LocalBackendConfig),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		Windows: nodeAppWindowsOptions(nodeAppID, nodeAppSnapshotID),
	})

	win := App.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "node-app",
		Title:            title,
		DevToolsEnabled:  false,
		Windows:          application.WindowsWindow{Theme: application.SystemDefault, ResizeDebounceMS: 0},
		BackgroundColour: application.NewRGB(20, 20, 20),
		URL:              "/",
		Width:            1280,
		Height:           820,
		MinWidth:         460,
		MinHeight:        320,
		EnableFileDrop:   true,
		Frameless:        true,
	})
	wireFileDrop(win)
	primeWindowFrame(win)
	lifecycle := newNodeAppLifecycle(App, win, service, nodeAppID, title)
	service.setNodeAppLifecycle(lifecycle)
	defer lifecycle.Close()
	if dataContractErr == nil {
		stopRecovery := startNodeAppBackendRecovery(service, lifecycle.setRuntimeStatus)
		defer stopRecovery()
	} else {
		lifecycle.setRuntimeStatus(NodeAppBackendRuntimeStatus{
			State:        "incompatible-data-contract",
			Message:      dataContractErr.Error(),
			DataContract: &dataContract,
		})
	}
	instance.SetFocusHandler(func() {
		win.Show()
		win.Focus()
	})
	writeNodeAppSmokeMarker(localBackend)
	stopSmokeShutdown := startNodeAppSmokeShutdown(App)
	defer stopSmokeShutdown()
	if err := App.Run(); err != nil {
		log.Fatal(err)
	}
}

func nodeAppWindowsOptions(nodeID string, snapshotID string) application.WindowsOptions {
	options := wailsWindowsOptions()
	if nodeID == "" {
		return options
	}
	options.WebviewUserDataPath = nodeAppWebview2DataDirectory(nodeID)
	return options
}

func nodeAppWebview2DataDirectory(nodeID string) string {
	return filepath.Join(nodeAppDataDirectory(nodeID), "webview2")
}

func nodeAppDataDirectory(nodeID string) string {
	base := strings.TrimSpace(os.Getenv("LOCALAPPDATA"))
	if base == "" {
		base = strings.TrimSpace(os.Getenv("APPDATA"))
	}
	if base == "" {
		home, _ := os.UserHomeDir()
		base = filepath.Join(home, "AppData", "Local")
	}
	return filepath.Join(base, "Xiranite", "node-apps", nodeID)
}
