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
