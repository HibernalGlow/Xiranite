//go:build !production

package main

import "io/fs"

func embeddedNativeAssetFS() fs.FS {
	return nil
}
