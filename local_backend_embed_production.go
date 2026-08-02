//go:build production

package main

import "embed"

// The Bun output may contain native or WASM sidecars. Preserve its directory
// structure so a packaged host has the same capabilities as the build output.
//
//go:embed build/wails/xiranite-backend.js build/wails/xiranite-node-app-backend.js build/wails/backend-assets/*
var embeddedLocalBackendFiles embed.FS

func embeddedLocalBackendBundle() embeddedLocalBackendRuntimeBundle {
	return embeddedLocalBackendRuntimeBundle{
		files:      embeddedLocalBackendFiles,
		entrypoint: "build/wails/xiranite-backend.js",
	}
}

func embeddedNodeAppBackendBundle() embeddedLocalBackendRuntimeBundle {
	return embeddedLocalBackendRuntimeBundle{
		files:      embeddedLocalBackendFiles,
		entrypoint: "build/wails/xiranite-node-app-backend.js",
	}
}
