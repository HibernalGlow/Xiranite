package main

import (
	"crypto/sha256"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

const nativeAssetRootEnv = "XIRANITE_NATIVE_ASSET_ROOT"

func prepareEmbeddedNativeAssets() error {
	assets := embeddedNativeAssetFS()
	if assets == nil {
		return nil
	}

	cacheDir, err := os.UserCacheDir()
	if err != nil || cacheDir == "" {
		cacheDir = os.TempDir()
	}
	root, err := materializeNativeAssets(assets, filepath.Join(cacheDir, "Xiranite", "embedded-native-assets"))
	if err != nil {
		return err
	}
	return os.Setenv(nativeAssetRootEnv, root)
}

func materializeNativeAssets(assets fs.FS, cacheBase string) (string, error) {
	manifest, err := fs.ReadFile(assets, "manifest.json")
	if err != nil {
		return "", fmt.Errorf("read embedded native asset manifest: %w", err)
	}
	sum := sha256.Sum256(manifest)
	targetRoot := filepath.Join(cacheBase, fmt.Sprintf("%x", sum[:8]))
	completeMarker := filepath.Join(targetRoot, ".complete")
	if fileExists(completeMarker) {
		return targetRoot, nil
	}

	if err := fs.WalkDir(assets, ".", func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == "." {
			return os.MkdirAll(targetRoot, 0o755)
		}
		target := filepath.Join(targetRoot, filepath.FromSlash(path))
		if entry.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := fs.ReadFile(assets, path)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	}); err != nil {
		return "", fmt.Errorf("materialize embedded native assets: %w", err)
	}
	if err := os.WriteFile(completeMarker, []byte("ok\n"), 0o644); err != nil {
		return "", fmt.Errorf("complete embedded native asset cache: %w", err)
	}
	return targetRoot, nil
}
