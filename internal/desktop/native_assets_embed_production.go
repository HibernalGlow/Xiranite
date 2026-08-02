//go:build production

package desktop

import (
	"embed"
	"io/fs"
)

//go:embed all:build/native-assets
var embeddedNativeAssets embed.FS

func embeddedNativeAssetFS() fs.FS {
	assets, err := fs.Sub(embeddedNativeAssets, "build/native-assets")
	if err != nil {
		panic(err)
	}
	return assets
}
