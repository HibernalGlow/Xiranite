package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// xiraniteDataDirectory returns the per-OS Xiranite data directory (the folder
// that already includes the product name). It mirrors the TypeScript resolver
// in @xiranite/platform so the native host and the Bun backend always agree on
// shared data locations, including the node app data contract marker.
func xiraniteDataDirectory() string {
	home, _ := os.UserHomeDir()
	return resolveXiraniteDataDirectory(runtime.GOOS, home, os.Getenv)
}

// resolveXiraniteDataDirectory is the pure form used with an explicit GOOS/hook
// set, so callers that already carry environment and platform options can reuse
// exactly the same path rules.
func resolveXiraniteDataDirectory(goos string, home string, env func(string) string) string {
	switch goos {
	case "windows":
		base := strings.TrimSpace(env("LOCALAPPDATA"))
		if base == "" {
			base = strings.TrimSpace(env("APPDATA"))
		}
		if base == "" {
			base = filepath.Join(home, "AppData", "Local")
		}
		return filepath.Join(base, "Xiranite")
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "Xiranite")
	default:
		base := strings.TrimSpace(env("XDG_DATA_HOME"))
		if base == "" {
			base = filepath.Join(home, ".local", "share")
		}
		return filepath.Join(base, "xiranite")
	}
}
