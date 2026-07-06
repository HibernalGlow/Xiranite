package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:dist
var assets embed.FS

var App *application.App

type FileDropEvent struct {
	Files []string `json:"files"`
}

func init() {
	application.RegisterEvent[FileDropEvent]("files-dropped")
}

func main() {
	service := NewXiraniteService()
	localBackend, err := StartLocalBackend()
	if err != nil {
		log.Printf("Xiranite local backend is unavailable: %v", err)
	} else if localBackend != nil {
		defer localBackend.Stop()
		log.Printf("Xiranite local backend ready: %s", localBackend.Config.BaseURL)
	} else {
		log.Printf("Xiranite frontend dev proxy active; local backend startup is delegated to the Vite dev server")
	}

	var backendConfig *LocalBackendConfig
	if localBackend != nil {
		backendConfig = &localBackend.Config
	}

	App = application.New(application.Options{
		Name:        "Xiranite",
		Description: "Adapter-free Xiranite desktop host",
		Services: []application.Service{
			application.NewService(service),
		},
		Assets: application.AssetOptions{
			Handler:    application.AssetFileServerFS(assets),
			Middleware: backendConfigMiddleware(backendConfig),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	win := App.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:  "main",
		Title: "Xiranite",
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
		App.Event.Emit("files-dropped", FileDropEvent{Files: files})
	})
}
