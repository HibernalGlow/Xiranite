package main

import (
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func wailsWindowsOptions() application.WindowsOptions {
	result := loadBrowserRuntimeConfig()
	for _, warning := range result.Warnings {
		log.Printf("WebView2 config: %s", warning)
	}
	return application.WindowsOptions{
		EnabledFeatures:       result.Config.Features,
		AdditionalBrowserArgs: result.Config.Switches,
	}
}
