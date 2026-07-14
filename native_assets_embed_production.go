//go:build production

package main

import (
	"embed"
	"io/fs"
)

//go:embed all:build/wails/native-assets
var embeddedNativeAssets embed.FS

func embeddedNativeAssetFS() fs.FS {
	assets, err := fs.Sub(embeddedNativeAssets, "build/wails/native-assets")
	if err != nil {
		panic(err)
	}
	return assets
}
