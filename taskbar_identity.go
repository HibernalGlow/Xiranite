package main

import (
	"crypto/sha256"
	"encoding/hex"
)

const componentWindowAppIDPrefix = "com.hibernalglow.Xiranite.Component."

func componentWindowAppUserModelID(windowID string) string {
	digest := sha256.Sum256([]byte(windowID))
	return componentWindowAppIDPrefix + hex.EncodeToString(digest[:16])
}
