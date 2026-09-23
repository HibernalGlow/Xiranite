package main

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
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

func TestPruneStaleEmbeddedBunRuntimesKeepsCurrentAndRecent(t *testing.T) {
	root := t.TempDir()
	now := time.Date(2026, 9, 23, 12, 0, 0, 0, time.UTC)
	stale := filepath.Join(root, "bun-staaaaaale")
	recent := filepath.Join(root, "bun-recentshhh")
	keep := filepath.Join(root, "bun-currentt")
	unrelated := filepath.Join(root, "backend-abcdef01")
	for _, dir := range []string{stale, recent, keep, unrelated} {
		if err := os.MkdirAll(filepath.Join(dir, "inner"), 0o755); err != nil {
			t.Fatalf("create %s: %v", dir, err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "notes.txt"), []byte("x"), 0o644); err != nil {
		t.Fatalf("write stray file: %v", err)
	}
	const maxAge = 30 * 24 * time.Hour
	for dir, age := range map[string]time.Duration{
		stale:     45 * 24 * time.Hour,
		recent:    2 * 24 * time.Hour,
		keep:      90 * 24 * time.Hour,
		unrelated: 90 * 24 * time.Hour,
	} {
		if err := os.Chtimes(dir, now.Add(-age), now.Add(-age)); err != nil {
			t.Fatalf("set mtime on %s: %v", dir, err)
		}
	}

	removed := pruneStaleEmbeddedBunRuntimes(root, keep, maxAge, now)
	if len(removed) != 1 || removed[0] != stale {
		t.Fatalf("pruned %v, want only %s", removed, stale)
	}
	for _, dir := range []string{keep, recent, unrelated} {
		if _, err := os.Stat(dir); err != nil {
			t.Fatalf("%s must survive pruning: %v", dir, err)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "notes.txt")); err != nil {
		t.Fatalf("stray files must not be touched: %v", err)
	}
}

func TestLocalBackendStartupReasonRoundTrip(t *testing.T) {
	t.Cleanup(func() { recordLocalBackendStartupReason(nil) })

	if text := localBackendStartupReasonText(); text != "" {
		t.Fatalf("expected no reason before the first failure, got %q", text)
	}
	recordLocalBackendStartupReason(errors.New("  install Bun 1.3 or later  "))
	if text := localBackendStartupReasonText(); text != "install Bun 1.3 or later" {
		t.Fatalf("recorded reason = %q", text)
	}
	recordLocalBackendStartupReason(nil)
	if text := localBackendStartupReasonText(); text != "" {
		t.Fatalf("successful startup must clear the reason, got %q", text)
	}
}

func TestResolveBunCommandPrefersExplicitOverride(t *testing.T) {
	override := filepath.Join(t.TempDir(), "custom-bun")
	if err := os.WriteFile(override, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("write override runtime: %v", err)
	}
	t.Setenv("XIRANITE_BUN_BIN", override)

	command, err := resolveBunCommand()
	if err != nil {
		t.Fatalf("resolve explicit Bun override: %v", err)
	}
	if command != override {
		t.Fatalf("resolved %q, want %q", command, override)
	}
	if bunRuntimeSourceLabelValue() != "env" {
		t.Fatalf("runtime source label = %q, want env", bunRuntimeSourceLabelValue())
	}
}

func TestResolveBunCommandIgnoresUnusableOverride(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "removed-bun")
	t.Setenv("XIRANITE_BUN_BIN", missing)
	originalPath := os.Getenv("PATH")
	originalLabel := bunRuntimeSourceLabelValue()
	setBunRuntimeSourceLabel("")
	t.Setenv("PATH", t.TempDir())
	t.Cleanup(func() {
		_ = os.Setenv("PATH", originalPath)
		setBunRuntimeSourceLabel(originalLabel)
	})

	// The contract is build independent: a dangling override is never handed back,
	// whether or not this build can fall back to an embedded or system runtime.
	command, err := resolveBunCommand()
	if err == nil && command == missing {
		t.Fatalf("resolveBunCommand returned the unusable override path %q", command)
	}
	if label := bunRuntimeSourceLabelValue(); label == "env" {
		t.Fatal("an unusable override must not be labelled as the runtime source")
	}
}

func TestResolveBunCommandFallsBackWithoutEmbeddedRuntime(t *testing.T) {
	if embeddedBunBundle().available() {
		t.Skip("this build embeds a Bun runtime, so the fallback path is not exercised")
	}
	t.Setenv("XIRANITE_BUN_BIN", "")
	originalLabel := bunRuntimeSourceLabelValue()
	setBunRuntimeSourceLabel("")
	t.Cleanup(func() { setBunRuntimeSourceLabel(originalLabel) })
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
	if bunRuntimeSourceLabelValue() != "" {
		t.Fatalf("failed resolution must not label a runtime source, got %q", bunRuntimeSourceLabelValue())
	}
}
