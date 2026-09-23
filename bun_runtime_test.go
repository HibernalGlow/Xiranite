package main

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestExtractEmbeddedBunRuntimeToStagesExecutableCopy(t *testing.T) {
	contents := []byte("#!/bin/sh\necho 1.3.0\n")
	cache := t.TempDir()

	target, err := extractEmbeddedBunRuntimeTo(contents, cache)
	if err != nil {
		t.Fatalf("extract embedded Bun runtime: %v", err)
	}
	if filepath.Base(target) != embeddedBunAssetName() {
		t.Fatalf("extracted runtime name = %q, want %q", target, embeddedBunAssetName())
	}
	info, err := os.Stat(target)
	if err != nil {
		t.Fatalf("stat extracted runtime: %v", err)
	}
	if info.Size() != int64(len(contents)) {
		t.Fatalf("extracted runtime size = %d, want %d", info.Size(), len(contents))
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o100 == 0 {
		t.Fatalf("extracted runtime is not executable: %v", info.Mode())
	}
	stored, err := os.ReadFile(target)
	if err != nil || string(stored) != string(contents) {
		t.Fatalf("extracted runtime contents = %q, %v", stored, err)
	}

	reused, err := extractEmbeddedBunRuntimeTo(contents, cache)
	if err != nil || reused != target {
		t.Fatalf("re-extract reused %q, %v; want %q", reused, err, target)
	}

	other, err := extractEmbeddedBunRuntimeTo([]byte("#!/bin/sh\necho 1.3.1\n"), cache)
	if err != nil {
		t.Fatalf("extract second Bun runtime: %v", err)
	}
	if other == target {
		t.Fatalf("different runtime contents must not share the cache path %q", target)
	}
}

func TestResolveBunCommandPrefersExplicitOverride(t *testing.T) {
	t.Setenv("XIRANITE_BUN_BIN", filepath.Join(t.TempDir(), "custom-bun"))

	command, err := resolveBunCommand()
	if err != nil {
		t.Fatalf("resolve explicit Bun override: %v", err)
	}
	if command != os.Getenv("XIRANITE_BUN_BIN") {
		t.Fatalf("resolved %q, want %q", command, os.Getenv("XIRANITE_BUN_BIN"))
	}
	if bunRuntimeSourceLabel != "env" {
		t.Fatalf("runtime source label = %q, want env", bunRuntimeSourceLabel)
	}
}

func TestResolveBunCommandFallsBackWithoutEmbeddedRuntime(t *testing.T) {
	if embeddedBunBundle().available() {
		t.Skip("this build embeds a Bun runtime, so the fallback path is not exercised")
	}
	t.Setenv("XIRANITE_BUN_BIN", "")
	originalLabel := bunRuntimeSourceLabel
	bunRuntimeSourceLabel = ""
	t.Cleanup(func() { bunRuntimeSourceLabel = originalLabel })
	original := os.Getenv("PATH")
	emptyDir := t.TempDir()
	t.Setenv("PATH", emptyDir)
	t.Cleanup(func() { _ = os.Setenv("PATH", original) })

	_, err := resolveBunCommand()
	if err == nil {
		t.Skip("a system Bun is installed on this host; the missing-runtime text is not exercised")
	}
	if !errors.Is(err, errNoEmbeddedBun) && !strings.Contains(err.Error(), "install Bun") {
		t.Fatalf("error should tell the user how to provide Bun, got %v", err)
	}
	if bunRuntimeSourceLabel != "" {
		t.Fatalf("failed resolution must not label a runtime source, got %q", bunRuntimeSourceLabel)
	}
}
