package main

import (
	"path/filepath"
	"testing"
)

func TestComponentWindowIDUsesComponentIdentity(t *testing.T) {
	first := componentWindowID("alphabet-window-enginev-1")
	if first != componentWindowID("alphabet-window-enginev-1") {
		t.Fatal("component window id must be stable")
	}
	if first == componentWindowID("alphabet-window-enginev-2") {
		t.Fatal("distinct component ids must not share a window")
	}
}

func TestComponentWindowSizePrefersComponentThenFallsBackToModule(t *testing.T) {
	dataDir := t.TempDir()
	service := &XiraniteService{
		userDataDir: dataDir,
		storageFile: filepath.Join(dataDir, "storage.json"),
	}

	firstSize := ComponentWindowSize{Width: 920, Height: 680}
	if err := service.saveComponentWindowSize("component-1", "enginev", firstSize); err != nil {
		t.Fatal(err)
	}

	if size, ok, err := service.loadComponentWindowSize("component-1", "enginev"); err != nil || !ok || size != firstSize {
		t.Fatalf("expected component size %v, got %v (ok=%v, err=%v)", firstSize, size, ok, err)
	}
	if size, ok, err := service.loadComponentWindowSize("new-component", "enginev"); err != nil || !ok || size != firstSize {
		t.Fatalf("expected module fallback size %v, got %v (ok=%v, err=%v)", firstSize, size, ok, err)
	}

	secondSize := ComponentWindowSize{Width: 1180, Height: 760}
	if err := service.saveComponentWindowSize("component-2", "enginev", secondSize); err != nil {
		t.Fatal(err)
	}
	if size, ok, err := service.loadComponentWindowSize("component-1", "enginev"); err != nil || !ok || size != firstSize {
		t.Fatalf("expected original component size %v, got %v (ok=%v, err=%v)", firstSize, size, ok, err)
	}
	if size, ok, err := service.loadComponentWindowSize("another-component", "enginev"); err != nil || !ok || size != secondSize {
		t.Fatalf("expected latest module size %v, got %v (ok=%v, err=%v)", secondSize, size, ok, err)
	}
}

func TestComponentWindowSizeIgnoresInvalidStoredValue(t *testing.T) {
	dataDir := t.TempDir()
	service := &XiraniteService{
		userDataDir: dataDir,
		storageFile: filepath.Join(dataDir, "storage.json"),
	}

	keys := componentWindowSizeStorageKeys("component-1", "enginev")
	if err := service.StorageSet(keys[0], `{"width":120,"height":100}`); err != nil {
		t.Fatal(err)
	}
	if err := service.StorageSet(keys[1], `not-json`); err != nil {
		t.Fatal(err)
	}

	if size, ok, err := service.loadComponentWindowSize("component-1", "enginev"); err != nil || ok {
		t.Fatalf("expected invalid sizes to be ignored, got %v (ok=%v, err=%v)", size, ok, err)
	}
}
