package desktop

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCheckNodeAppDataContractRejectsNewerSharedData(t *testing.T) {
	t.Setenv("LOCALAPPDATA", t.TempDir())
	path := nodeAppDataContractsPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{"schemaVersion":1,"version":2}`), 0o644); err != nil {
		t.Fatal(err)
	}
	status, err := checkNodeAppDataContract("1", "1")
	if err == nil {
		t.Fatal("expected incompatible data contract error")
	}
	if status.CurrentVersion != 2 || status.DataPath != path {
		t.Fatalf("status = %#v, want current version 2 at %s", status, path)
	}
}

func TestCheckNodeAppDataContractAcceptsMissingMarkerAtInitialVersion(t *testing.T) {
	t.Setenv("LOCALAPPDATA", t.TempDir())
	status, err := checkNodeAppDataContract("1", "1")
	if err != nil {
		t.Fatalf("unexpected data contract error: %v", err)
	}
	if status.CurrentVersion != nodeAppInitialDataContractVersion {
		t.Fatalf("current version = %d, want %d", status.CurrentVersion, nodeAppInitialDataContractVersion)
	}
}

func TestNodeAppWebview2DataDirectoryIsScopedToNodeRatherThanSnapshot(t *testing.T) {
	t.Setenv("LOCALAPPDATA", t.TempDir())
	first := nodeAppWebview2DataDirectory("xlchemy")
	second := nodeAppWebview2DataDirectory("xlchemy")
	if first != second || filepath.Base(first) != "webview2" {
		t.Fatalf("webview path = %q, want one stable node-scoped profile", first)
	}
}
