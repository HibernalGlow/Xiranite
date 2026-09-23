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

// defaultBunRuntimeVersion is the floor used when a build was not stamped, and it
// is the same minimum the node applications enforce. Release builds stamp
// nodeAppMinimumBunVersion from the workspace pin so this constant never decides
// what a shipped package accepts.
const defaultBunRuntimeVersion = "1.3.0"

// systemBunRuntimeFloor is the Bun version a package built without an embedded
// runtime expects to find on the host. desktop-release and the local release
// build stamp nodeAppMinimumBunVersion with the same pin that was used to build
// and test the artifact, so the floor follows the workspace instead of the
// constant below.
func systemBunRuntimeFloor() string {
	if version := strings.TrimSpace(nodeAppMinimumBunVersion); version != "" {
		return version
	}
	return defaultBunRuntimeVersion
}

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
		// The override is host input: it may point at a runtime that another
		// process already replaced or pruned, so verify before trusting it.
		if info, err := os.Stat(bin); err == nil && !info.IsDir() {
			setBunRuntimeSourceLabel("env")
			return bin, nil
		}
		log.Printf("XIRANITE_BUN_BIN %q is not usable; ignoring the override", bin)
	}
	var embeddedErr error
	if command, err := embeddedBunCommand(); err == nil {
		setBunRuntimeSourceLabel("embedded")
		return command, nil
	} else {
		embeddedErr = err
		if !errors.Is(err, errNoEmbeddedBun) {
			log.Printf("embedded Bun runtime unavailable, falling back to system Bun: %v", err)
		}
	}
	command, err := lookPathWithWindowsExt("bun")
	if err != nil {
		// Clear the source instead of leaving a previous resolution's label
		// behind: the status row reports which runtime the host is on now.
		setBunRuntimeSourceLabel("unavailable")
		return "", bunRuntimeMissingError(errors.Join(err, embeddedErr))
	}
	setBunRuntimeSourceLabel("system")
	warnOnSystemBunFallback(command)
	return command, nil
}

// warnOnSystemBunFallback makes a degraded runtime visible. Both release
// variants are built and tested against a specific Bun: the embedded one carries
// it, the system one requires it on PATH. Running something older than that
// floor silently changes behaviour, so the mismatch is logged and reported
// through the node application runtime status the UI already shows.
func warnOnSystemBunFallback(command string) {
	var minimum string
	switch bunReleaseVariant() {
	case "embedded":
		minimum = strings.TrimSpace(embeddedBunVersion)
	case "system":
		minimum = systemBunRuntimeFloor()
	default:
		return
	}
	if minimum == "" {
		return
	}
	probeErr := ensureNodeAppBunVersion(command, minimum)
	if probeErr == nil {
		return
	}
	noteNodeAppBunCompatibilityWarning(fmt.Sprintf(
		"%v; this package was built to run on Bun %s",
		probeErr, minimum,
	))
	log.Printf("%s", nodeAppBunCompatibilityWarningValue())
}

// bunReleaseVariant reports which release shape this binary was built for:
// "embedded" carries a Bun runtime, "system" expects one on PATH, and "none"
// covers development builds that resolve Bun from the environment by design.
func bunReleaseVariant() string {
	switch {
	case !productionRelease:
		return "none"
	case embedsBunRuntime:
		return "embedded"
	default:
		return "system"
	}
}

// preparedEmbeddedBunCommand remembers the extracted runtime for the life of the
// process. The embedded asset is close to 100MB, so reading it out of the
// executable and hashing it again on every backend restart and every node launch
// would repeat identical work and allocate an identical copy each time.
var preparedEmbeddedBunCommand atomic.Pointer[string]

func embeddedBunCommand() (string, error) {
	if cached := preparedEmbeddedBunCommand.Load(); cached != nil {
		if info, err := os.Stat(*cached); err == nil && !info.IsDir() {
			// Keep the timestamp fresh so another host's prune never treats a
			// runtime this process is relying on as stale.
			_ = os.Chtimes(filepath.Dir(*cached), time.Now(), time.Now())
			return *cached, nil
		}
	}
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
	command := target
	preparedEmbeddedBunCommand.Store(&command)
	return target, nil
}

// embeddedBunRuntimeMaxAge keeps a runtime copy long enough that a host updated
// in place can still reuse the copy the previous version prepared.
const embeddedBunRuntimeMaxAge = 30 * 24 * time.Hour

// pruneStaleEmbeddedBunRuntimes removes bun-<hash> directories other than keep
// whose last write is older than maxAge relative to now, plus staged files left
// behind by a host that was killed mid-extract. Staged files are swept in both
// the runtime root and inside keep, because the extraction writes its temporary
// file next to the final runtime. Unremovable entries are skipped: they are
// either in use or belong to another host version.
func pruneStaleEmbeddedBunRuntimes(root, keep string, maxAge time.Duration, now time.Time) []string {
	removed := removeStaleStagedRuntimeFiles(root, maxAge, now)
	if keep != "" {
		removed = append(removed, removeStaleStagedRuntimeFiles(keep, maxAge, now)...)
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return removed
	}
	for _, entry := range entries {
		name := entry.Name()
		path := filepath.Join(root, name)
		if !entry.IsDir() {
			continue
		}
		if !strings.HasPrefix(name, "bun-") || path == keep {
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

// removeStaleStagedRuntimeFiles drops extraction leftovers older than maxAge.
// Recent ones stay: they may belong to a host that is writing right now, and a
// concurrent extract cannot accept a half-written rename target anyway.
func removeStaleStagedRuntimeFiles(dir string, maxAge time.Duration, now time.Time) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	removed := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.Contains(entry.Name(), ".partial-") {
			continue
		}
		info, statErr := entry.Info()
		if statErr != nil || now.Sub(info.ModTime()) < maxAge {
			continue
		}
		if err := os.Remove(filepath.Join(dir, entry.Name())); err == nil {
			removed = append(removed, filepath.Join(dir, entry.Name()))
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
		// Refresh the directory timestamp so a runtime another host is still
		// executing cannot look stale to the prune below.
		_ = os.Chtimes(targetDir, time.Now(), time.Now())
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
	// Flush before the rename: a crash must not leave a same-size, partly
	// written runtime that the size-only reuse check would accept.
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return "", fmt.Errorf("failed to flush embedded Bun runtime: %w", err)
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
	version := systemBunRuntimeFloor()
	return fmt.Errorf(
		"this package was built without an embedded Bun runtime for %s/%s; install Bun %s or later, or set XIRANITE_BUN_BIN: %w",
		runtime.GOOS, runtime.GOARCH, version, lookupErr,
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
