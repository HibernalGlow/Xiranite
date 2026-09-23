//go:build production && no_bun

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestSystemBunVariantResolvesRuntimeFromPath is the release gate for the
// system-Bun package: nothing is embedded, so the host has to find and accept
// the Bun the user installed, including through the node-app version gate.
// TestSystemBunVariantFloorsRuntimeVersion proves the system-Bun release does not
// run a too-old Bun silently: the release floor applies even though nothing is
// embedded.
func TestSystemBunVariantFloorsRuntimeVersion(t *testing.T) {
	if variant := bunReleaseVariant(); variant != "system" {
		t.Fatalf("bunReleaseVariant() = %q, want system", variant)
	}
	originalWarning := nodeAppBunCompatibilityWarningValue()
	t.Cleanup(func() { noteNodeAppBunCompatibilityWarning(originalWarning) })

	dir := t.TempDir()
	path := filepath.Join(dir, "bun")
	if err := os.WriteFile(path, []byte("#!/bin/sh\necho 1.0.0\n"), 0o755); err != nil {
		t.Fatalf("write stub Bun: %v", err)
	}
	noteNodeAppBunCompatibilityWarning("")
	warnOnSystemBunFallback(path)
	warning := nodeAppBunCompatibilityWarningValue()
	if !strings.Contains(warning, "built to run on Bun "+defaultBunRuntimeVersion) {
		t.Fatalf("an old system Bun must be reported against the release floor, got %q", warning)
	}
}

func TestSystemBunVariantResolvesRuntimeFromPath(t *testing.T) {
	if embeddedBunBundle().available() {
		t.Fatal("a no_bun build must not carry an embedded Bun runtime")
	}

	t.Setenv("XIRANITE_BUN_BIN", "")
	command, err := resolveBunCommand()
	if err != nil {
		// A release build without any usable runtime is exactly what the CI gate
		// exists to catch, so it must fail there instead of skipping green.
		if os.Getenv("XIRANITE_REQUIRE_RELEASE_RUNTIME") == "1" {
			t.Fatalf("the release gate requires a system Bun, but resolution failed: %v", err)
		}
		t.Skipf("this host has no Bun on PATH: %v", err)
	}
	if bunRuntimeSourceLabelValue() != "system" {
		t.Fatalf("runtime source label = %q, want system", bunRuntimeSourceLabelValue())
	}
	if _, err := os.Stat(command); err != nil {
		t.Fatalf("Bun resolved to %q but it is not usable: %v", command, err)
	}

	minimumBunVersion := nodeAppMinimumBunVersion
	if strings.TrimSpace(minimumBunVersion) == "" {
		minimumBunVersion = "1.3.0"
	}
	if err := ensureNodeAppBunVersion(command, minimumBunVersion); err != nil {
		t.Fatalf("system Bun failed the node application version gate: %v", err)
	}
}
