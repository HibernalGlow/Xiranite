package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// The host controls where an index lives; the core controls what it is called (ADR-0077 §6.6).
// These are the two halves of that split, and each one goes red if the precedence order flips.

func TestDefaultDatabasePathPrefersTheHostIndexDirectory(t *testing.T) {
	indexDir := filepath.Join(t.TempDir(), "data")
	wrongRoot := filepath.Join(t.TempDir(), "should-not-win")
	t.Setenv(indexDirEnv, indexDir)
	t.Setenv("LOCALAPPDATA", wrongRoot)

	path, err := defaultDatabasePath("library-abc")
	if err != nil {
		t.Fatalf("defaultDatabasePath: %v", err)
	}
	if path != filepath.Join(indexDir, "library-abc.sqlite") {
		t.Fatalf("the host's index directory must win exactly, got %q", path)
	}
	if strings.Contains(path, "should-not-win") {
		t.Fatalf("LOCALAPPDATA overrode the explicit index directory: %q", path)
	}
}

func TestDefaultDatabasePathFallsBackToThePlatformRoot(t *testing.T) {
	// Blank-by-whitespace is not a placement decision, so it must fall through rather than
	// produce a relative index file next to the current working directory.
	t.Setenv(indexDirEnv, "\t ")
	root := filepath.Join(t.TempDir(), "root")
	t.Setenv("LOCALAPPDATA", root)

	path, err := defaultDatabasePath("library-abc")
	if err != nil {
		t.Fatalf("defaultDatabasePath: %v", err)
	}
	want := filepath.Join(root, "Xiranite", "findz", "indexes", "library-abc.sqlite")
	if path != want {
		t.Fatalf("without a host override the documented default must hold\ngot  %q\nwant %q", path, want)
	}
}

func TestDefaultDatabasePathKeepsTheIdentifierOurs(t *testing.T) {
	// The host passes a directory, never a file name: the id stays derived from the root here, so
	// two hosts with different data roots cannot invent two names for the same library.
	indexDir := t.TempDir()
	t.Setenv(indexDirEnv, indexDir)
	t.Setenv("LOCALAPPDATA", "")

	root := filepath.Join(t.TempDir(), "Library")
	id := libraryIDForRoot(root)
	viaOverride, err := defaultDatabasePath(id)
	if err != nil {
		t.Fatalf("defaultDatabasePath: %v", err)
	}
	if filepath.Base(viaOverride) != id+".sqlite" {
		t.Fatalf("the file name must be the derived library id, got %q", filepath.Base(viaOverride))
	}
	second, err := defaultDatabasePath(libraryIDForRoot(strings.ToUpper(root)))
	if err != nil {
		t.Fatalf("defaultDatabasePath: %v", err)
	}
	if second != viaOverride {
		t.Fatalf("the id is case-normalised at the source; %q vs %q", viaOverride, second)
	}
}
