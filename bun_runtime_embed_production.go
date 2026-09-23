//go:build production && !no_bun

package main

import (
	"embed"
	"io/fs"
)

// A release ships the Bun runtime for its own target platform only;
// scripts/fetch-bun-runtime.ts fills build/wails/bun before the Go build, and
// the no_bun tag compiles this file away so no runtime is embedded.
//
//go:embed build/wails/bun
var embeddedBunRuntimeFiles embed.FS

// embedsBunRuntime is the compile-time counterpart of bunReleaseVariant: this
// build was produced with a runtime inside the executable.
const embedsBunRuntime = true

func embeddedBunBundle() embeddedBunRuntimeBundle {
	assetPath := embeddedBunAssetPathFor(embeddedBunAssetName())
	if _, err := fs.Stat(embeddedBunRuntimeFiles, assetPath); err != nil {
		return embeddedBunRuntimeBundle{}
	}
	return embeddedBunRuntimeBundle{files: embeddedBunRuntimeFiles, assetPath: assetPath}
}
