package main

import (
	"bytes"
	"image/png"
	"regexp"
	"testing"
)

func TestComponentWindowAppUserModelID(t *testing.T) {
	t.Parallel()

	first := componentWindowAppUserModelID("component-100")
	if first != componentWindowAppUserModelID("component-100") {
		t.Fatal("AppUserModelID must be stable for the same window")
	}
	if first == componentWindowAppUserModelID("component-101") {
		t.Fatal("different windows must receive different AppUserModelIDs")
	}
	if len(first) > 128 {
		t.Fatalf("AppUserModelID exceeds the Windows limit: %d", len(first))
	}
	if !regexp.MustCompile(`^[A-Za-z0-9.]+$`).MatchString(first) {
		t.Fatalf("AppUserModelID contains unsupported characters: %q", first)
	}
}

func TestMakeTaskbarIconPNG(t *testing.T) {
	t.Parallel()

	encoded, err := makeTaskbarIconPNG("neoview", "NeoView", 32)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := png.Decode(bytes.NewReader(encoded))
	if err != nil {
		t.Fatalf("generated taskbar icon is not a valid PNG: %v", err)
	}
	if got := decoded.Bounds().Dx(); got != 32 {
		t.Fatalf("icon width = %d, want 32", got)
	}
}
