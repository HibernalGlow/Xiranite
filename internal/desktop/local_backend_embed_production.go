//go:build production

package desktop

import "embed"

// The Bun output may contain native or WASM sidecars. Preserve its directory
// structure so a packaged host has the same capabilities as the build output.
//
//go:embed build/xiranite-backend.js build/xiranite-node-app-backend.js build/backend-assets/*
var embeddedLocalBackendFiles embed.FS

func embeddedLocalBackendBundle() embeddedLocalBackendRuntimeBundle {
	return embeddedLocalBackendRuntimeBundle{
		files:      embeddedLocalBackendFiles,
		entrypoint: "build/xiranite-backend.js",
	}
}

func embeddedNodeAppBackendBundle() embeddedLocalBackendRuntimeBundle {
	return embeddedLocalBackendRuntimeBundle{
		files:      embeddedLocalBackendFiles,
		entrypoint: "build/xiranite-node-app-backend.js",
	}
}
