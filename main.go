package main

import (
	"embed"

	"github.com/hibernalglow/xiranite/internal/desktop"
)

//go:embed all:dist
var frontendAssets embed.FS

func main() {
	desktop.Run(frontendAssets)
}
