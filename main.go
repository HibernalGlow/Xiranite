package main

import (
	"embed"
	"log"

	"github.com/hibernalglow/xiranite/internal/nexusbridge"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:dist
var assets embed.FS

var App *application.App

type FileDropEvent struct {
	Files   []string                       `json:"files"`
	Details *application.DropTargetDetails `json:"details,omitempty"`
}

func init() {
	application.RegisterEvent[FileDropEvent]("files-dropped")
	application.RegisterEvent[TrayActionEvent]("tray-action")
	application.RegisterEvent[NodeAppCloseRequestedEvent]("node-app-close-requested")
	application.RegisterEvent[NodeAppBackendRuntimeStatus]("node-app-backend-status")
}

func main() {
	if nodeAppID != "" {
		runNodeApp()
		return
	}
	localBackend, err := StartLocalBackend()
	if err != nil {
		log.Printf("Xiranite local backend is unavailable: %v", err)
	} else if localBackend != nil {
		log.Printf("Xiranite local backend ready: %s", localBackend.Config.BaseURL)
	} else {
		log.Printf("Xiranite frontend dev proxy active; local backend startup is delegated to the Vite dev server")
	}

	service := NewXiraniteService(localBackend)
	defer service.StopLocalBackend()
	bridge, err := nexusbridge.StartServer(func() *nexusbridge.BackendConfig {
		config := service.InternalBackendConfig()
		if config == nil {
			return nil
		}
		return &nexusbridge.BackendConfig{BaseURL: config.BaseURL, Token: config.Token}
	})
	if err != nil {
		log.Printf("Xiranite Nexus IPC is unavailable: %v", err)
	} else {
		defer bridge.Close()
		if pipe, pipeErr := nexusbridge.PipeName(); pipeErr == nil {
			log.Printf("Xiranite Nexus IPC ready: %s", pipe)
		}
	}

	App = application.New(application.Options{
		Name:        "Xiranite",
		Description: "Adapter-free Xiranite desktop host",
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
		Windows: wailsWindowsOptions(),
	})
	stopDevDesktopShutdownWatcher := startDevDesktopShutdownWatcher(App)
	defer stopDevDesktopShutdownWatcher()

	win := App.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:            "main",
		Title:           "Xiranite",
		DevToolsEnabled: true,
		KeyBindings:     devToolsKeyBindings(),
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 48,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		Windows: application.WindowsWindow{
			Theme:            application.SystemDefault,
			ResizeDebounceMS: 0,
		},
		BackgroundColour: application.NewRGB(20, 20, 20),
		URL:              "/",
		Width:            1280,
		Height:           820,
		MinWidth:         960,
		MinHeight:        640,
		EnableFileDrop:   true,
		Frameless:        true,
	})

	wireFileDrop(win)
	service.trayManager = newDesktopTrayManager(App, win, service.mainTrayEnabled())
	primeWindowFrame(win)

	if err := App.Run(); err != nil {
		log.Fatal(err)
	}
}

func wireFileDrop(win *application.WebviewWindow) {
	win.OnWindowEvent(events.Common.WindowFilesDropped, func(event *application.WindowEvent) {
		files := event.Context().DroppedFiles()
		if len(files) == 0 {
			return
		}
		App.Event.Emit("files-dropped", FileDropEvent{
			Files:   files,
			Details: event.Context().DropTargetDetails(),
		})
	})
}
