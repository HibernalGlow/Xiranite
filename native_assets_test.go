package main

import (
	"io/fs"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"
)

func TestMaterializeNativeAssets(t *testing.T) {
	assets := fstest.MapFS{
		"manifest.json":       &fstest.MapFile{Data: []byte(`{"schemaVersion":1}`)},
		"archives/sample.zip": &fstest.MapFile{Data: []byte("zip")},
	}
	root, err := materializeNativeAssets(assets, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "archives", "sample.zip"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "zip" {
		t.Fatalf("unexpected materialized data: %q", data)
	}
	if _, err := fs.Stat(os.DirFS(root), "manifest.json"); err != nil {
		t.Fatal(err)
	}
}
