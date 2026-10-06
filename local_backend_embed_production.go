//go:build production

package main

import "embed"

// The Bun output may contain native or WASM sidecars. Preserve its directory
// structure so a packaged host has the same capabilities as the build output.
//
// `node_modules` carries the native bindings that the bundle asks for through a
// runtime-computed bare specifier, which no bundler can turn into a
// `backend-assets/` sidecar; see scripts/lib/backend-native-deps.ts. They stay
// beside the entrypoint after extraction so Node's own lookup finds them.
//
//go:embed build/wails/xiranite-backend.js build/wails/xiranite-node-app-backend.js build/wails/backend-assets/* all:build/wails/node_modules
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
