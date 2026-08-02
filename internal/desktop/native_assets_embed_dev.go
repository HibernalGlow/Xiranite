//go:build !production

package desktop

import "io/fs"

func embeddedNativeAssetFS() fs.FS {
	return nil
}
