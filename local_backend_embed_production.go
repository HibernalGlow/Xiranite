//go:build production

package main

import _ "embed"

//go:embed build/wails/xiranite-backend.js
var embeddedLocalBackendJS []byte

func embeddedLocalBackendScript() []byte {
	return embeddedLocalBackendJS
}
