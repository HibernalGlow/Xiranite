package main

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/pelletier/go-toml/v2"
)

const xiraniteConfigFilename = "xiranite.config.toml"

//go:embed config/webview2-flags.json
var browserRuntimeFlagCatalogJSON []byte

type BrowserRuntimeConfig struct {
	Features []string `json:"features" toml:"features"`
	Switches []string `json:"switches" toml:"switches"`
}

type BrowserRuntimeFlag struct {
	ID      string `json:"id"`
	Default bool   `json:"default"`
}

type BrowserRuntimeFlagCatalog struct {
	Features []BrowserRuntimeFlag `json:"features"`
	Switches []BrowserRuntimeFlag `json:"switches"`
}

type BrowserRuntimeLoadResult struct {
	Config   BrowserRuntimeConfig
	Path     string
	Warnings []string
}

type XiraniteConfigPathOptions struct {
	Env     map[string]string
	Cwd     string
	HomeDir string
	GOOS    string
}

type browserRuntimeFileConfig struct {
	WebView2 *BrowserRuntimeConfig `toml:"webview2"`
}

var browserRuntimeFlagCatalog = mustBrowserRuntimeFlagCatalog()

func loadBrowserRuntimeConfig() BrowserRuntimeLoadResult {
	result := loadBrowserRuntimeConfigFromPath(resolveXiraniteConfigPath(XiraniteConfigPathOptions{}))
	result.Config = mergeBrowserRuntimeConfig(result.Config, developmentBrowserRuntimeConfig())
	return result
}

func loadBrowserRuntimeConfigFromPath(path string) BrowserRuntimeLoadResult {
	result := BrowserRuntimeLoadResult{Config: defaultBrowserRuntimeConfig(), Path: path}
	content, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return result
	}
	if err != nil {
		result.Warnings = append(result.Warnings, fmt.Sprintf("failed to read %s: %v", path, err))
		return result
	}

	var fileConfig browserRuntimeFileConfig
	if err := toml.Unmarshal(content, &fileConfig); err != nil {
		result.Warnings = append(result.Warnings, fmt.Sprintf("failed to parse %s: %v", path, err))
		return result
	}
	if fileConfig.WebView2 == nil {
		return result
	}

	result.Config, result.Warnings = sanitizeBrowserRuntimeConfig(*fileConfig.WebView2)
	return result
}

func resolveXiraniteConfigPath(options XiraniteConfigPathOptions) string {
	env := options.Env
	if env == nil {
		env = map[string]string{
			"XIRANITE_CONFIG_PATH":   os.Getenv("XIRANITE_CONFIG_PATH"),
			"XIRANITE_DATABASE_PATH": os.Getenv("XIRANITE_DATABASE_PATH"),
			"XIRANITE_DATA_DIR":      os.Getenv("XIRANITE_DATA_DIR"),
			"LOCALAPPDATA":           os.Getenv("LOCALAPPDATA"),
			"APPDATA":                os.Getenv("APPDATA"),
			"XDG_DATA_HOME":          os.Getenv("XDG_DATA_HOME"),
		}
	}
	cwd := options.Cwd
	if cwd == "" {
		cwd, _ = os.Getwd()
	}
	resolve := func(path string) string {
		if filepath.IsAbs(path) {
			return filepath.Clean(path)
		}
		return filepath.Clean(filepath.Join(cwd, path))
	}

	if value := strings.TrimSpace(env["XIRANITE_CONFIG_PATH"]); value != "" {
		return resolve(value)
	}
	if value := strings.TrimSpace(env["XIRANITE_DATABASE_PATH"]); value != "" {
		return filepath.Join(filepath.Dir(resolve(value)), xiraniteConfigFilename)
	}
	if value := strings.TrimSpace(env["XIRANITE_DATA_DIR"]); value != "" {
		return filepath.Join(resolve(value), xiraniteConfigFilename)
	}

	home := options.HomeDir
	if home == "" {
		home, _ = os.UserHomeDir()
	}
	goos := options.GOOS
	if goos == "" {
		goos = runtime.GOOS
	}
	if goos == "windows" {
		base := strings.TrimSpace(env["LOCALAPPDATA"])
		if base == "" {
			base = strings.TrimSpace(env["APPDATA"])
		}
		if base == "" {
			base = filepath.Join(home, "AppData", "Local")
		}
		return filepath.Join(base, "Xiranite", xiraniteConfigFilename)
	}
	if goos == "darwin" {
		return filepath.Join(home, "Library", "Application Support", "Xiranite", xiraniteConfigFilename)
	}
	base := strings.TrimSpace(env["XDG_DATA_HOME"])
	if base == "" {
		base = filepath.Join(home, ".local", "share")
	}
	return filepath.Join(base, "xiranite", xiraniteConfigFilename)
}

func defaultBrowserRuntimeConfig() BrowserRuntimeConfig {
	return BrowserRuntimeConfig{
		Features: defaultFlagIDs(browserRuntimeFlagCatalog.Features),
		Switches: defaultFlagIDs(browserRuntimeFlagCatalog.Switches),
	}
}

func sanitizeBrowserRuntimeConfig(config BrowserRuntimeConfig) (BrowserRuntimeConfig, []string) {
	features, featureWarnings := sanitizeFlagIDs(config.Features, browserRuntimeFlagCatalog.Features, "feature")
	switches, switchWarnings := sanitizeFlagIDs(config.Switches, browserRuntimeFlagCatalog.Switches, "switch")
	return BrowserRuntimeConfig{Features: features, Switches: switches}, append(featureWarnings, switchWarnings...)
}

func mergeBrowserRuntimeConfig(base BrowserRuntimeConfig, overlay BrowserRuntimeConfig) BrowserRuntimeConfig {
	return BrowserRuntimeConfig{
		Features: uniqueStrings(append(append([]string{}, base.Features...), overlay.Features...)),
		Switches: uniqueStrings(append(append([]string{}, base.Switches...), overlay.Switches...)),
	}
}

func defaultFlagIDs(flags []BrowserRuntimeFlag) []string {
	result := make([]string, 0, len(flags))
	for _, flag := range flags {
		if flag.Default {
			result = append(result, flag.ID)
		}
	}
	return result
}

func sanitizeFlagIDs(values []string, catalog []BrowserRuntimeFlag, kind string) ([]string, []string) {
	allowed := make(map[string]struct{}, len(catalog))
	for _, flag := range catalog {
		allowed[flag.ID] = struct{}{}
	}
	result := make([]string, 0, len(values))
	warnings := make([]string, 0)
	for _, value := range uniqueStrings(values) {
		if _, ok := allowed[value]; ok {
			result = append(result, value)
		} else {
			warnings = append(warnings, fmt.Sprintf("ignored unsupported WebView2 %s: %s", kind, value))
		}
	}
	return result, warnings
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func mustBrowserRuntimeFlagCatalog() BrowserRuntimeFlagCatalog {
	var catalog BrowserRuntimeFlagCatalog
	if err := json.Unmarshal(browserRuntimeFlagCatalogJSON, &catalog); err != nil {
		panic(fmt.Sprintf("invalid browser runtime flag catalog: %v", err))
	}
	return catalog
}
