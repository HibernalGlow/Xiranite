package main

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"time"
)

// embeddedBunDirectory is the build-time drop directory for packaged Bun
// runtimes. scripts/fetch-bun-runtime.ts writes exactly one
// bun-<GOOS>-<GOARCH>[.exe] asset there before a production build, and the
// no_bun tag ships the host without any embedded runtime at all.
const embeddedBunDirectory = "build/wails/bun"

// embeddedBunVersion is stamped with -X main.embeddedBunVersion by the release
// build so failure text names the runtime the package was built against.
var embeddedBunVersion string

// errNoEmbeddedBun marks the expected case where a build ships without an
// embedded runtime, so the resolver can fall back to PATH silently.
var errNoEmbeddedBun = errors.New("build has no embedded Bun runtime")

// bunRuntimeSourceLabel records which Bun runtime a resolved command came from:
// "env", "embedded" or "system"; it is reported in the node application status.
// It is stored atomically because the backend recovery goroutine reads it while
// a restart resolves the command again.
var bunRuntimeSourceLabel atomic.Pointer[string]

func setBunRuntimeSourceLabel(label string) {
	bunRuntimeSourceLabel.Store(&label)
}

func bunRuntimeSourceLabelValue() string {
	if label := bunRuntimeSourceLabel.Load(); label != nil {
		return *label
	}
	return ""
}

// embeddedBunRuntimeBundle is the packaged runtime descriptor. embeddedBunBundle
// is supplied by the build-tag split: production without no_bun reads the
// embedded asset, every other build returns an empty bundle so the resolver
// falls back to a system Bun.
type embeddedBunRuntimeBundle struct {
	files     fs.FS
	assetPath string
}

func (bundle embeddedBunRuntimeBundle) available() bool {
	return bundle.files != nil && bundle.assetPath != ""
}

func embeddedBunAssetName() string {
	name := fmt.Sprintf("bun-%s-%s", runtime.GOOS, runtime.GOARCH)
	if runtime.GOOS == "windows" {
		return name + ".exe"
	}
	return name
}

// resolveBunCommand returns the Bun executable used to run the TypeScript
// backend and node packages. An explicit XIRANITE_BUN_BIN always wins, then the
// runtime shipped inside this host, then a Bun found on PATH.
func resolveBunCommand() (string, error) {
	if bin := strings.TrimSpace(os.Getenv("XIRANITE_BUN_BIN")); bin != "" {
		setBunRuntimeSourceLabel("env")
		return bin, nil
	}
	if command, err := embeddedBunCommand(); err == nil {
		setBunRuntimeSourceLabel("embedded")
		return command, nil
	} else if !errors.Is(err, errNoEmbeddedBun) {
		log.Printf("embedded Bun runtime unavailable, falling back to system Bun: %v", err)
	}
	command, err := lookPathWithWindowsExt("bun")
	if err != nil {
		return "", bunRuntimeMissingError(err)
	}
	setBunRuntimeSourceLabel("system")
	return command, nil
}

func embeddedBunCommand() (string, error) {
	bundle := embeddedBunBundle()
	if !bundle.available() {
		return "", errNoEmbeddedBun
	}
	contents, err := fs.ReadFile(bundle.files, bundle.assetPath)
	if err != nil {
		return "", fmt.Errorf("read embedded Bun runtime %s: %w", bundle.assetPath, err)
	}

	cacheDir, err := os.UserCacheDir()
	if err != nil || cacheDir == "" {
		cacheDir = os.TempDir()
	}
	runtimeDirectory := filepath.Join(cacheDir, "Xiranite", "runtime")
	target, err := extractEmbeddedBunRuntimeTo(contents, runtimeDirectory)
	if err != nil {
		return "", err
	}
	// Every release used on this machine leaves a content-hashed copy behind, and
	// a runtime is 60-120MB, so stale ones are dropped. A host that later needs a
	// pruned copy re-extracts it from its own embedded runtime, which is why this
	// is safe to do without coordinating with other running hosts.
	if removed := pruneStaleEmbeddedBunRuntimes(runtimeDirectory, filepath.Dir(target), embeddedBunRuntimeMaxAge, time.Now()); len(removed) > 0 {
		log.Printf("pruned %d stale embedded Bun runtime cache directories", len(removed))
	}
	return target, nil
}

// embeddedBunRuntimeMaxAge keeps a runtime copy long enough that a host updated
// in place can still reuse the copy the previous version prepared.
const embeddedBunRuntimeMaxAge = 30 * 24 * time.Hour

// pruneStaleEmbeddedBunRuntimes removes bun-<hash> directories other than keep
// whose last write is older than maxAge relative to now. Unremovable entries are
// skipped: they are either in use or belong to another host version.
func pruneStaleEmbeddedBunRuntimes(root, keep string, maxAge time.Duration, now time.Time) []string {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	removed := make([]string, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if !entry.IsDir() || !strings.HasPrefix(name, "bun-") {
			continue
		}
		path := filepath.Join(root, name)
		if path == keep {
			continue
		}
		info, err := os.Stat(path)
		if err != nil || now.Sub(info.ModTime()) < maxAge {
			continue
		}
		if err := os.RemoveAll(path); err == nil {
			removed = append(removed, path)
		}
	}
	return removed
}

// extractEmbeddedBunRuntimeTo writes the embedded runtime into a content-hash
// directory, so repeated launches reuse one prepared copy and different hosts
// never overwrite a Bun binary another process is running.
func extractEmbeddedBunRuntimeTo(contents []byte, cacheDirectory string) (string, error) {
	hash := sha256.Sum256(contents)
	targetDir := filepath.Join(cacheDirectory, fmt.Sprintf("bun-%x", hash[:8]))
	target := filepath.Join(targetDir, embeddedBunAssetName())
	if info, err := os.Stat(target); err == nil && !info.IsDir() && info.Size() == int64(len(contents)) {
		return target, nil
	}

	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return "", fmt.Errorf("failed to create Bun runtime cache: %w", err)
	}
	// Write through a temporary file and rename so a second host starting at the
	// same time can never exec a half-written runtime.
	temp, err := os.CreateTemp(targetDir, embeddedBunAssetName()+".partial-")
	if err != nil {
		return "", fmt.Errorf("failed to stage embedded Bun runtime: %w", err)
	}
	tempName := temp.Name()
	defer func() { _ = os.Remove(tempName) }()

	if _, err := temp.Write(contents); err != nil {
		_ = temp.Close()
		return "", fmt.Errorf("failed to write embedded Bun runtime: %w", err)
	}
	if err := temp.Chmod(0o755); err != nil {
		_ = temp.Close()
		return "", fmt.Errorf("failed to mark embedded Bun runtime executable: %w", err)
	}
	if err := temp.Close(); err != nil {
		return "", fmt.Errorf("failed to close embedded Bun runtime: %w", err)
	}
	if err := clearRuntimeQuarantine(tempName); err != nil {
		log.Printf("could not clear quarantine flag on embedded Bun runtime: %v", err)
	}
	if err := os.Rename(tempName, target); err != nil {
		if info, statErr := os.Stat(target); statErr != nil || info.Size() != int64(len(contents)) {
			return "", fmt.Errorf("failed to install embedded Bun runtime: %w", err)
		}
	}
	return target, nil
}

func bunRuntimeMissingError(lookupErr error) error {
	if embeddedBunBundle().available() {
		return fmt.Errorf("no usable Bun runtime: %w", lookupErr)
	}
	if embeddedBunVersion != "" {
		return fmt.Errorf(
			"this package needs the embedded Bun runtime for %s/%s, but none is embedded; install Bun %s or later, or set XIRANITE_BUN_BIN: %w",
			runtime.GOOS, runtime.GOARCH, embeddedBunVersion, lookupErr,
		)
	}
	return fmt.Errorf(
		"this package has no embedded Bun runtime; install Bun 1.3 or later, or set XIRANITE_BUN_BIN: %w",
		lookupErr,
	)
}

func lookPathWithWindowsExt(name string) (string, error) {
	path, err := exec.LookPath(name)
	if err == nil || runtime.GOOS != "windows" || strings.HasSuffix(name, ".exe") {
		return path, err
	}
	return exec.LookPath(name + ".exe")
}

// embeddedBunAssetPathFor is the slash-separated embed.FS path scripts and the
// production embed file agree on.
func embeddedBunAssetPathFor(assetName string) string {
	return embeddedBunDirectory + "/" + assetName
}
