package main

import (
	"log"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func wailsWindowsOptions() application.WindowsOptions {
	result := loadBrowserRuntimeConfig()
	userDataPath := developmentWebviewUserDataPath(result.Path)
	log.Printf("WebView2 config: path=%s user-data=%s features=%q switches=%q", result.Path, userDataPath, result.Config.Features, result.Config.Switches)
	for _, warning := range result.Warnings {
		log.Printf("WebView2 config: %s", warning)
	}
	return application.WindowsOptions{
		EnabledFeatures:       result.Config.Features,
		AdditionalBrowserArgs: result.Config.Switches,
		WebviewUserDataPath:   userDataPath,
	}
}

func resolveDevelopmentWebviewUserDataPath(configPath string, enabled bool) string {
	if !enabled {
		return ""
	}
	return filepath.Join(filepath.Dir(configPath), "webview2-dev")
}
