//go:build production

package main

import (
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"testing"
)

// TestPackagedBackendCarriesNativeNodeModules is the release gate for the part of
// the bundle that no bundler can inline: `libsql` asks for its native binding with
// a runtime-computed bare specifier, so a packaged host needs a real
// `node_modules` beside the extracted entrypoint. Without it the shipped app dies
// on its first database access, and every developer machine stays green because a
// hoisted install happens to resolve the specifier from the repository root.
//
// This walks the embedded filesystem rather than a synthetic one, so it fails when
// the go:embed pattern stops matching or when extraction drops the nesting.
func TestPackagedBackendCarriesNativeNodeModules(t *testing.T) {
	bundle := embeddedLocalBackendBundle()
	if !bundle.available() {
		t.Fatal("the production host must embed the local backend bundle")
	}

	embedDirectory := path.Dir(bundle.entrypoint)
	bindingFound := ""
	err := fs.WalkDir(bundle.files, embedDirectory, func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.HasSuffix(name, ".node") {
			return nil
		}
		if !strings.Contains(name, "/node_modules/@libsql/") {
			return nil
		}
		bindingFound = name
		return fs.SkipAll
	})
	if err != nil {
		t.Fatalf("walk embedded backend files: %v", err)
	}
	if bindingFound == "" {
		t.Fatalf("no native @libsql binding is embedded below %q; run `bun run build:backend:js` "+
			"so the installer's platform package is staged next to the bundle", embedDirectory)
	}

	script, err := extractEmbeddedLocalBackendBundleTo(bundle, t.TempDir())
	if err != nil {
		t.Fatalf("extract embedded backend bundle: %v", err)
	}
	// Extraction preserves the paths below the bundle directory, so the binding's
	// location relative to the entrypoint is the same inside the cache directory.
	relative := strings.TrimPrefix(bindingFound, embedDirectory+"/")
	if !strings.HasPrefix(relative, "node_modules/") {
		t.Fatalf("embedded binding %q must sit in a node_modules directory next to %q, got %q",
			bindingFound, filepath.Base(script), relative)
	}
	info, err := os.Stat(filepath.Join(filepath.Dir(script), filepath.FromSlash(relative)))
	if err != nil || info.Size() == 0 {
		t.Fatalf("extracted native binding %q is missing or empty: %v", relative, err)
	}
}
