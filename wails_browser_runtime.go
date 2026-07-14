package main

import (
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func wailsWindowsOptions() application.WindowsOptions {
	result := loadBrowserRuntimeConfig()
	log.Printf("WebView2 config: path=%s features=%q switches=%q", result.Path, result.Config.Features, result.Config.Switches)
	for _, warning := range result.Warnings {
		log.Printf("WebView2 config: %s", warning)
	}
	return application.WindowsOptions{
		EnabledFeatures:       result.Config.Features,
		AdditionalBrowserArgs: result.Config.Switches,
	}
}
