//go:build production && no_bun

package main

import (
	"os"
	"strings"
	"testing"
)

// TestSystemBunVariantResolvesRuntimeFromPath is the release gate for the
// system-Bun package: nothing is embedded, so the host has to find and accept
// the Bun the user installed, including through the node-app version gate.
func TestSystemBunVariantResolvesRuntimeFromPath(t *testing.T) {
	if embeddedBunBundle().available() {
		t.Fatal("a no_bun build must not carry an embedded Bun runtime")
	}

	t.Setenv("XIRANITE_BUN_BIN", "")
	command, err := resolveBunCommand()
	if err != nil {
		// A release build without any usable runtime is exactly what the CI gate
		// exists to catch, so it must fail there instead of skipping green.
		if os.Getenv("XIRANITE_REQUIRE_SYSTEM_BUN") == "1" {
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
