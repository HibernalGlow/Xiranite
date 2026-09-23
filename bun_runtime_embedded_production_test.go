//go:build production && !no_bun

package main

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
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
	if bunRuntimeSourceLabelValue() != "embedded" {
		t.Fatalf("runtime source label = %q, want embedded", bunRuntimeSourceLabelValue())
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
	if bunRuntimeSourceLabelValue() != "embedded" {
		t.Fatalf("runtime source label = %q, want embedded", bunRuntimeSourceLabelValue())
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

// TestEmbeddedBuildAnnouncesSystemBunFallback covers the degradation path: an
// embedded build can only reach a system Bun when its own runtime could not be
// prepared, which must never happen quietly on an older runtime.
func TestEmbeddedBuildAnnouncesSystemBunFallback(t *testing.T) {
	if !embeddedBunBundle().available() {
		t.Skipf("production build embeds no Bun runtime for this platform (%s)", embeddedBunAssetName())
	}
	originalVersion := embeddedBunVersion
	originalWarning := nodeAppBunCompatibilityWarning
	originalRuntime := nodeAppRuntimeBunVersion
	t.Cleanup(func() {
		embeddedBunVersion = originalVersion
		nodeAppBunCompatibilityWarning = originalWarning
		nodeAppRuntimeBunVersion = originalRuntime
	})

	warnWith := func(version string) string {
		dir := t.TempDir()
		path := filepath.Join(dir, "bun")
		if err := os.WriteFile(path, []byte("#!/bin/sh\necho "+version+"\n"), 0o755); err != nil {
			t.Fatalf("write stub Bun: %v", err)
		}
		nodeAppBunCompatibilityWarning = ""
		warnOnSystemBunFallback(path)
		return nodeAppBunCompatibilityWarning
	}

	embeddedBunVersion = "1.3.0"
	if warning := warnWith("1.0.0"); !strings.Contains(warning, "built to run on Bun 1.3.0") {
		t.Fatalf("an older system Bun must be reported as a downgrade, got %q", warning)
	}
	if warning := warnWith("9.9.9"); warning != "" {
		t.Fatalf("an acceptable system Bun must stay quiet, got %q", warning)
	}

	embeddedBunVersion = ""
	if warning := warnWith("0.1.0"); warning != "" {
		t.Fatalf("builds without a stamped runtime version must stay quiet, got %q", warning)
	}
}

// TestPackagedBackendBootsOnEmbeddedRuntime is the release smoke test for the
// default artifact: the host must start its TypeScript backend from the embedded
// Bun runtime and the embedded backend bundle, and answer /health. Extracting
// and version-probing the runtime is not enough on its own.
func TestPackagedBackendBootsOnEmbeddedRuntime(t *testing.T) {
	if !embeddedBunBundle().available() {
		if os.Getenv("XIRANITE_REQUIRE_RELEASE_RUNTIME") == "1" {
			t.Fatalf("the release gate needs an embedded runtime, but %q is missing from %s",
				embeddedBunAssetName(), embeddedBunDirectory)
		}
		t.Skip("no embedded runtime staged for this host")
	}
	for _, key := range []string{
		"XIRANITE_BUN_BIN", "XIRANITE_BACKEND_BIN", "XIRANITE_BACKEND_JS", "XIRANITE_BACKEND_URL",
		"XIRANITE_NODE_APP_ID", "FRONTEND_DEVSERVER_URL",
	} {
		t.Setenv(key, "")
	}
	t.Setenv("XIRANITE_DATA_DIR", t.TempDir())

	backend, err := startLocalBackend("")
	if err != nil {
		t.Fatalf("start the packaged backend: %v", err)
	}
	defer backend.Stop()

	if label := bunRuntimeSourceLabelValue(); label != "embedded" {
		t.Fatalf("the packaged backend must run on the embedded runtime, source label = %q", label)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	response, err := client.Get(backend.Config.BaseURL + "/health")
	if err != nil {
		t.Fatalf("GET %s/health: %v", backend.Config.BaseURL, err)
	}
	defer func() { _ = response.Body.Close() }()
	var health struct {
		OK         bool   `json:"ok"`
		InstanceID string `json:"instanceId"`
	}
	if err := json.NewDecoder(response.Body).Decode(&health); err != nil {
		t.Fatalf("decode health response: %v", err)
	}
	if response.StatusCode != http.StatusOK || !health.OK || health.InstanceID == "" {
		t.Fatalf("health check failed: status=%d body=%#v", response.StatusCode, health)
	}
}
