package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestResolveXiraniteConfigPathPriority(t *testing.T) {
	options := XiraniteConfigPathOptions{
		Env: map[string]string{
			"XIRANITE_CONFIG_PATH":   "custom/settings.toml",
			"XIRANITE_DATABASE_PATH": "data/xiranite.db",
			"XIRANITE_DATA_DIR":      "data-dir",
		},
		Cwd:  "C:/repo",
		GOOS: "windows",
	}
	want := filepath.Clean("C:/repo/custom/settings.toml")
	if got := resolveXiraniteConfigPath(options); got != want {
		t.Fatalf("resolveXiraniteConfigPath() = %q, want %q", got, want)
	}
}

func TestLoadBrowserRuntimeConfigDefaultsWhenSectionMissing(t *testing.T) {
	path := filepath.Join(t.TempDir(), xiraniteConfigFilename)
	if err := os.WriteFile(path, []byte("[workspace]\ndefault = \"ws-default\"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	result := loadBrowserRuntimeConfigFromPath(path)
	if !reflect.DeepEqual(result.Config, defaultBrowserRuntimeConfig()) {
		t.Fatalf("config = %#v, want defaults %#v", result.Config, defaultBrowserRuntimeConfig())
	}
}

func TestLoadBrowserRuntimeConfigSanitizesConfiguredFlags(t *testing.T) {
	path := filepath.Join(t.TempDir(), xiraniteConfigFilename)
	content := `[webview2]
features = ["ParallelDownloading", "UnknownFeature", "ParallelDownloading"]
switches = ["--enable-zero-copy", "--unsafe-switch"]
`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	result := loadBrowserRuntimeConfigFromPath(path)
	want := BrowserRuntimeConfig{Features: []string{"ParallelDownloading"}, Switches: []string{"--enable-zero-copy"}}
	if !reflect.DeepEqual(result.Config, want) {
		t.Fatalf("config = %#v, want %#v", result.Config, want)
	}
	if len(result.Warnings) != 2 {
		t.Fatalf("warnings = %#v, want 2 warnings", result.Warnings)
	}
}
