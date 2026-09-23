//go:build production && !no_bun

package main

import (
	"os"
	"os/exec"
	"strings"
	"testing"
)

// TestEmbeddedBunRuntimeRuns is the release gate for the embedded variant: the
// runtime staged by scripts/fetch-bun-runtime.ts must survive embedding,
// extraction and execute on the machine that ships the package.
// TestEmbeddedBunRuntimeIsUsedWithoutSystemBun is the headline promise of the
// default release: a machine that never installed Bun still starts the backend.
func TestEmbeddedBunRuntimeIsUsedWithoutSystemBun(t *testing.T) {
	if !embeddedBunBundle().available() {
		t.Skipf("production build embeds no Bun runtime for this platform (%s)", embeddedBunAssetName())
	}
	t.Setenv("XIRANITE_BUN_BIN", "")
	originalPath := os.Getenv("PATH")
	emptyDir := t.TempDir()
	t.Setenv("PATH", emptyDir)
	t.Cleanup(func() { _ = os.Setenv("PATH", originalPath) })

	command, err := resolveBunCommand()
	if err != nil {
		t.Fatalf("embedded Bun must resolve with no system Bun on PATH: %v", err)
	}
	if bunRuntimeSourceLabel != "embedded" {
		t.Fatalf("runtime source label = %q, want embedded", bunRuntimeSourceLabel)
	}
	if _, err := os.Stat(command); err != nil {
		t.Fatalf("resolved embedded runtime %q is not on disk: %v", command, err)
	}
}

func TestEmbeddedBunRuntimeRuns(t *testing.T) {
	bundle := embeddedBunBundle()
	if !bundle.available() {
		t.Fatalf("production build embeds no Bun runtime for this platform; asset %q missing from %s",
			embeddedBunAssetName(), embeddedBunDirectory)
	}

	t.Setenv("XIRANITE_BUN_BIN", "")
	command, err := resolveBunCommand()
	if err != nil {
		t.Fatalf("resolve embedded Bun command: %v", err)
	}
	if bunRuntimeSourceLabel != "embedded" {
		t.Fatalf("runtime source label = %q, want embedded", bunRuntimeSourceLabel)
	}

	output, err := exec.Command(command, "--version").Output()
	if err != nil {
		t.Fatalf("run extracted Bun runtime: %v", err)
	}
	version := strings.TrimSpace(string(output))
	if embeddedBunVersion != "" && version != embeddedBunVersion {
		t.Fatalf("extracted Bun runtime reports %q, build stamped %q", version, embeddedBunVersion)
	}
	info, err := os.Stat(command)
	if err != nil {
		t.Fatalf("stat extracted Bun runtime: %v", err)
	}
	if info.Size() == 0 {
		t.Fatalf("extracted Bun runtime is empty")
	}
}
