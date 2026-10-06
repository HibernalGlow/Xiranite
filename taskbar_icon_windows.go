//go:build windows

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
	"github.com/wailsapp/wails/v3/pkg/w32"
)

var taskbarIconBackground = color.RGBA{R: 40, G: 191, B: 157, A: 255}
var taskbarIconForeground = color.RGBA{R: 18, G: 34, B: 27, A: 255}
var taskbarIconAccent = color.RGBA{R: 196, G: 236, B: 222, A: 255}

func setWindowTaskbarIcon(window *application.WebviewWindow, moduleID, title string) error {
	if window == nil || window.NativeWindow() == nil {
		return fmt.Errorf("native window handle is unavailable")
	}
	icon16, err := makeTaskbarIconPNG(moduleID, title, 16)
	if err != nil {
		return err
	}
	icon32, err := makeTaskbarIconPNG(moduleID, title, 32)
	if err != nil {
		return err
	}
	small, err := w32.CreateSmallHIconFromImage(icon16)
	if err != nil {
		return fmt.Errorf("create small node icon: %w", err)
	}
	large, err := w32.CreateLargeHIconFromImage(icon32)
	if err != nil {
		w32.DestroyIcon(small)
		return fmt.Errorf("create large node icon: %w", err)
	}
	hwnd := w32.HWND(uintptr(window.NativeWindow()))
	w32.SendMessage(hwnd, w32.WM_SETICON, w32.ICON_SMALL, uintptr(small))
	w32.SendMessage(hwnd, w32.WM_SETICON, w32.ICON_BIG, uintptr(large))
	return nil
}

func makeTaskbarIconPNG(moduleID, title string, size int) ([]byte, error) {
	if size < 16 {
		return nil, fmt.Errorf("icon size must be at least 16px")
	}
	_ = moduleID
	background := taskbarIconBackground
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	draw.Draw(img, img.Bounds(), &image.Uniform{C: background}, image.Point{}, draw.Src)
	for i := 0; i < size; i++ {
		img.SetRGBA(i, 0, taskbarIconForeground)
		img.SetRGBA(i, size-1, taskbarIconForeground)
		img.SetRGBA(0, i, taskbarIconForeground)
		img.SetRGBA(size-1, i, taskbarIconForeground)
	}
	drawGlyph(img, nodeGlyph(title), taskbarIconAccent)
	// Small Xiranite marker in the lower-right corner.
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
	'A': {0b01110, 0b10001, 0b11111, 0b10001, 0b10001},
	'B': {0b11110, 0b10001, 0b11110, 0b10001, 0b11110},
	'C': {0b01111, 0b10000, 0b10000, 0b10000, 0b01111},
	'D': {0b11110, 0b10001, 0b10001, 0b10001, 0b11110},
	'E': {0b11111, 0b10000, 0b11110, 0b10000, 0b11111},
	'F': {0b11111, 0b10000, 0b11110, 0b10000, 0b10000},
	'G': {0b01111, 0b10000, 0b10111, 0b10001, 0b01111},
	'H': {0b10001, 0b10001, 0b11111, 0b10001, 0b10001},
	'I': {0b11111, 0b00100, 0b00100, 0b00100, 0b11111},
	'J': {0b00111, 0b00010, 0b00010, 0b10010, 0b01100},
	'K': {0b10001, 0b10010, 0b11100, 0b10010, 0b10001},
	'L': {0b10000, 0b10000, 0b10000, 0b10000, 0b11111},
	'M': {0b10001, 0b11011, 0b10101, 0b10001, 0b10001},
	'N': {0b10001, 0b11001, 0b10101, 0b10011, 0b10001},
	'O': {0b01110, 0b10001, 0b10001, 0b10001, 0b01110},
	'P': {0b11110, 0b10001, 0b11110, 0b10000, 0b10000},
	'Q': {0b01110, 0b10001, 0b10101, 0b10010, 0b01101},
	'R': {0b11110, 0b10001, 0b11110, 0b10010, 0b10001},
	'S': {0b01111, 0b10000, 0b01110, 0b00001, 0b11110},
	'T': {0b11111, 0b00100, 0b00100, 0b00100, 0b00100},
	'U': {0b10001, 0b10001, 0b10001, 0b10001, 0b01110},
	'V': {0b10001, 0b10001, 0b10001, 0b01010, 0b00100},
	'W': {0b10001, 0b10001, 0b10101, 0b11011, 0b10001},
	'X': {0b10001, 0b01010, 0b00100, 0b01010, 0b10001},
	'Y': {0b10001, 0b01010, 0b00100, 0b00100, 0b00100},
	'Z': {0b11111, 0b00010, 0b00100, 0b01000, 0b11111},
}

func drawGlyph(img *image.RGBA, glyph byte, foreground color.RGBA) {
	pattern, ok := glyphs[glyph]
	if !ok {
		pattern = glyphs['?']
	}
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
