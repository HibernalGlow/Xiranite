//go:build !windows

package main

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"strings"
	"unicode"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func setWindowTaskbarIcon(_ *application.WebviewWindow, _, _ string) error {
	return nil
}

var taskbarIconBackground = color.RGBA{R: 40, G: 191, B: 157, A: 255}
var taskbarIconForeground = color.RGBA{R: 18, G: 34, B: 27, A: 255}
var taskbarIconAccent = color.RGBA{R: 196, G: 236, B: 222, A: 255}

func makeTaskbarIconPNG(moduleID, title string, size int) ([]byte, error) {
	if size < 16 {
		return nil, fmt.Errorf("icon size must be at least 16px")
	}
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	draw.Draw(img, img.Bounds(), &image.Uniform{C: taskbarIconBackground}, image.Point{}, draw.Src)
	drawGlyph(img, nodeGlyph(title), taskbarIconAccent)
	marker := taskbarIconForeground
	for y := size - max(3, size/5); y < size-1; y++ {
		for x := size - max(3, size/5); x < size-1; x++ {
			img.SetRGBA(x, y, marker)
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, img); err != nil {
		return nil, err
	}
	return encoded.Bytes(), nil
}

func nodeGlyph(title string) byte {
	for _, r := range strings.TrimSpace(title) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return byte(unicode.ToUpper(r))
		}
	}
	return '?'
}

var glyphs = map[byte][5]uint8{
	'N': {0b10001, 0b11001, 0b10101, 0b10011, 0b10001},
}

func drawGlyph(img *image.RGBA, glyph byte, foreground color.RGBA) {
	pattern := glyphs[glyph]
	scale := max(1, img.Bounds().Dx()/12)
	startX := (img.Bounds().Dx() - 5*scale) / 2
	startY := (img.Bounds().Dy() - 5*scale) / 2
	for y, row := range pattern {
		for x := 0; x < 5; x++ {
			if row&(1<<uint(4-x)) == 0 {
				continue
			}
			for sy := 0; sy < scale; sy++ {
				for sx := 0; sx < scale; sx++ {
					img.SetRGBA(startX+x*scale+sx, startY+y*scale+sy, foreground)
				}
			}
		}
	}
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
