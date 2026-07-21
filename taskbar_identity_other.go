//go:build !windows

package main

import "github.com/wailsapp/wails/v3/pkg/application"

func setWindowTaskbarIdentity(_ *application.WebviewWindow, _ string) error {
	return nil
}
