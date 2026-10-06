package main

import (
	"bufio"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const backendGatewayPathPrefix = "/_xiranite/backend"

// localBackendStartupReason keeps the host's own failure text. A packaged GUI
// build has no console, so logging alone leaves a user reading "Local Backend is
// unreachable" with no hint that the release they chose needs Bun on PATH.
var localBackendStartupReason atomic.Pointer[string]

func recordLocalBackendStartupReason(err error) {
	if err == nil {
		localBackendStartupReason.Store(nil)
		return
	}
	reason := strings.TrimSpace(err.Error())
	localBackendStartupReason.Store(&reason)
}

func localBackendStartupReasonText() string {
	if reason := localBackendStartupReason.Load(); reason != nil {
		return *reason
	}
	return ""
}

var (
	// wailsFrontendOrigin mirrors the asset origin Wails serves the bundled
	// frontend from. It is platform dependent, so it must not be a constant.
	wailsFrontendOrigin = resolveWailsFrontendOrigin(runtime.GOOS)
	// wailsBackendPublicURL is the gateway URL the frontend is told to call. It
	// has to stay same-origin with the document, and it is also passed to the
	// local backend as --public-base-url for the absolute links it generates.
	wailsBackendPublicURL = wailsFrontendOrigin + backendGatewayPathPrefix
)

// resolveWailsFrontendOrigin returns the origin Wails' asset server uses on goos.
// Keep in sync with github.com/wailsapp/wails/v3/internal/assetserver
// (assetserver_<os>.go). Getting this wrong makes the bundled frontend request
// its own backend gateway cross-origin, which WebKit blocks outright and which
// surfaces as "Local Backend is unreachable".
func resolveWailsFrontendOrigin(goos string) string {
	switch goos {
	case "windows":
		// Wails intercepts the Windows virtual asset origin only for HTTP
		// requests; HTTPS bypasses WebResourceRequested and never reaches the
		// gateway middleware.
		return "http://wails.localhost"
	case "android":
		return "https://wails.localhost"
	default:
		// darwin, ios and linux serve assets over the custom wails:// scheme.
		return "wails://localhost"
	}
}

type LocalBackendConfig struct {
	BaseURL string `json:"baseUrl"`
	Token   string `json:"token,omitempty"`
}

type LocalBackend struct {
	Config      LocalBackendConfig
	cmd         *exec.Cmd
	containment *localBackendProcessContainment
	external    bool
	stopOnce    sync.Once
}

func StartLocalBackend() (*LocalBackend, error) {
	return startLocalBackend("")
}

func startLocalBackend(restartToken string) (*LocalBackend, error) {
	if baseURL := strings.TrimSpace(os.Getenv("XIRANITE_BACKEND_URL")); baseURL != "" {
		return &LocalBackend{
			Config: LocalBackendConfig{
				BaseURL: baseURL,
				Token:   os.Getenv("XIRANITE_BACKEND_TOKEN"),
			},
			external: true,
		}, nil
	}

	if strings.TrimSpace(os.Getenv("FRONTEND_DEVSERVER_URL")) != "" {
		return nil, nil
	}

	if err := prepareEmbeddedNativeAssets(); err != nil {
		return nil, fmt.Errorf("prepare embedded native assets: %w", err)
	}
	if executable, executableErr := resolveStableDesktopExecutable(); executableErr == nil {
		_ = os.Setenv("XIRANITE_DESKTOP_EXECUTABLE", executable)
	} else {
		_ = os.Unsetenv("XIRANITE_DESKTOP_EXECUTABLE")
	}

	command, args, cwd, err := resolveLocalBackendCommand()
	if err != nil {
		return nil, err
	}
	token := strings.TrimSpace(restartToken)
	if token == "" {
		token = strings.TrimSpace(os.Getenv("XIRANITE_BACKEND_TOKEN"))
	}
	if token == "" {
		token, err = randomLocalBackendToken()
		if err != nil {
			return nil, err
		}
	}
	args = append(args, "--token", token, "--public-base-url", wailsBackendPublicURL)
	if nodeID := strings.TrimSpace(os.Getenv("XIRANITE_NODE_APP_ID")); nodeID != "" {
		args = append(args, "--node-id", nodeID)
		if snapshotID := strings.TrimSpace(os.Getenv("XIRANITE_NODE_APP_SNAPSHOT_ID")); snapshotID != "" {
			args = append(args, "--snapshot-id", snapshotID)
		}
		if dataContractVersion := strings.TrimSpace(os.Getenv("XIRANITE_NODE_APP_DATA_CONTRACT_VERSION")); dataContractVersion != "" {
			args = append(args, "--data-contract-version", dataContractVersion)
		}
		if strings.TrimSpace(os.Getenv("XIRANITE_NODE_APP_ENABLE_READER")) == "1" {
			args = append(args, "--enable-reader")
		}
	} else {
		// The main desktop host publishes the same monotonic compatibility
		// marker as standalone node apps, but only after its Bun backend has
		// initialized shared configuration and database state.
		args = append(args, "--data-contract-version", fmt.Sprintf("%d", nodeAppCurrentDataContractVersion))
	}

	cmd := exec.Command(command, args...)
	configureHiddenSubprocess(cmd)
	// Publish the runtime this host picked. A nested Bun consumer (the Deno
	// supervisor, a re-executed TUI node) then resolves the same binary instead
	// of searching PATH and finding nothing on an embedded-only install.
	cmd.Env = append(os.Environ(), "XIRANITE_BUN_BIN="+command)
	if cwd != "" {
		cmd.Dir = cwd
	}
	containment, err := newLocalBackendProcessContainment()
	if err != nil {
		return nil, fmt.Errorf("prepare Xiranite local backend process containment: %w", err)
	}
	containment.Prepare(cmd)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = containment.Close()
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		_ = containment.Close()
		return nil, err
	}

	if err := cmd.Start(); err != nil {
		_ = containment.Close()
		return nil, err
	}
	if err := containment.AssignAndResume(cmd.Process); err != nil {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		_ = containment.Close()
		return nil, fmt.Errorf("contain Xiranite local backend process: %w", err)
	}

	go logPipe("[xiranite-backend:stderr] ", stderr)

	ready := make(chan backendReadyResult, 1)
	go readBackendReady(stdout, ready)

	select {
	case result := <-ready:
		if result.err != nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
			_ = containment.Close()
			return nil, result.err
		}
		return &LocalBackend{Config: result.config, cmd: cmd, containment: containment}, nil
	case <-time.After(10 * time.Second):
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		_ = containment.Close()
		return nil, errors.New("timed out waiting for Xiranite local backend")
	}
}

func randomLocalBackendToken() (string, error) {
	bytes := make([]byte, 24)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate Xiranite local backend token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func (b *LocalBackend) Stop() {
	if b == nil || b.external || b.cmd == nil || b.cmd.Process == nil {
		return
	}
	b.stopOnce.Do(func() {
		_ = b.cmd.Process.Kill()
		if b.containment != nil {
			_ = b.containment.Close()
		}
		_ = b.cmd.Wait()
	})
}

func backendGatewayMiddleware(
	internalConfig func() *LocalBackendConfig,
	publicConfig func() *LocalBackendConfig,
) application.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(rw http.ResponseWriter, req *http.Request) {
			if strings.TrimSpace(os.Getenv("FRONTEND_DEVSERVER_URL")) != "" {
				next.ServeHTTP(rw, req)
				return
			}
			if rewriteBackendGatewayPath(req.URL) {
				recordExternalNodeLaunchSmokeBackendRequest(req.Method, req.URL.Path)
				proxyBackendRequest(rw, req, internalConfig())
				return
			}
			config := publicConfig()
			if req.Method == http.MethodGet && (req.URL.Path == "/" || req.URL.Path == "/index.html" || req.URL.Path == "/node-host.html") && config != nil && config.BaseURL != "" {
				assetPath := "dist/index.html"
				if req.URL.Path == "/node-host.html" {
					assetPath = "dist/node-host.html"
				}
				data, err := assets.ReadFile(assetPath)
				if err == nil {
					rw.Header().Set("Content-Type", "text/html; charset=utf-8")
					_, _ = rw.Write([]byte(injectBackendConfig(string(data), config)))
					return
				}
				log.Printf("failed to inject backend config into index.html: %v", err)
			}
			next.ServeHTTP(rw, req)
		})
	}
}

func proxyBackendRequest(rw http.ResponseWriter, req *http.Request, config *LocalBackendConfig) {
	if config == nil || config.BaseURL == "" {
		message := "Xiranite local backend is unavailable."
		if reason := localBackendStartupReasonText(); reason != "" {
			message = "Xiranite local backend is unavailable: " + reason
		}
		http.Error(rw, message, http.StatusServiceUnavailable)
		return
	}
	// Wails reconstructs WebView2 requests with a body stream but leaves
	// ContentLength at zero. ReverseProxy treats that combination as an empty
	// body, so mark its length as unknown and let net/http stream it chunked.
	if req.Body != nil && req.Body != http.NoBody && req.ContentLength == 0 {
		req.ContentLength = -1
	}
	target, err := url.Parse(config.BaseURL)
	if err != nil {
		http.Error(rw, "Xiranite local backend target is invalid.", http.StatusBadGateway)
		return
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.ErrorHandler = func(rw http.ResponseWriter, _ *http.Request, err error) {
		log.Printf("Xiranite backend gateway failed for %s %s: %v", req.Method, req.URL.String(), err)
		http.Error(rw, "Xiranite local backend gateway failed.", http.StatusBadGateway)
	}
	proxy.ServeHTTP(rw, req)
}

func rewriteBackendGatewayPath(requestURL *url.URL) bool {
	targetPath, ok := backendGatewayTargetPath(requestURL.Path)
	if !ok {
		return false
	}
	requestURL.Path = targetPath
	if requestURL.RawPath != "" {
		if rawTargetPath, rawOK := backendGatewayTargetPath(requestURL.RawPath); rawOK {
			requestURL.RawPath = rawTargetPath
		} else {
			requestURL.RawPath = ""
		}
	}
	return true
}

func backendGatewayTargetPath(path string) (string, bool) {
	if path == backendGatewayPathPrefix {
		return "/", true
	}
	if !strings.HasPrefix(path, backendGatewayPathPrefix+"/") {
		return "", false
	}
	return strings.TrimPrefix(path, backendGatewayPathPrefix), true
}

func injectBackendConfig(html string, config *LocalBackendConfig) string {
	script := backendConfigScript(config)
	if script == "" || strings.Contains(html, "__XIRANITE_BACKEND__") {
		return html
	}
	if strings.Contains(html, "<head>") {
		return strings.Replace(html, "<head>", "<head>\n    "+script, 1)
	}
	return script + "\n" + html
}

func backendConfigScript(config *LocalBackendConfig) string {
	if config == nil || config.BaseURL == "" {
		return ""
	}
	payload, err := json.Marshal(config)
	if err != nil {
		return ""
	}
	return "<script>window.__XIRANITE_BACKEND__ = " + string(payload) + ";</script>"
}

type backendReadyResult struct {
	config LocalBackendConfig
	err    error
}

type embeddedLocalBackendRuntimeBundle struct {
	files      fs.FS
	entrypoint string
}

type embeddedLocalBackendFile struct {
	relativePath string
	contents     []byte
}

func readBackendReady(stdout io.Reader, ready chan<- backendReadyResult) {
	reader := bufio.NewReader(stdout)
	line, err := reader.ReadString('\n')
	if err != nil {
		ready <- backendReadyResult{err: fmt.Errorf("failed to read Xiranite local backend startup output: %w", err)}
		return
	}

	var config LocalBackendConfig
	if err := json.Unmarshal([]byte(strings.TrimSpace(line)), &config); err != nil {
		ready <- backendReadyResult{err: fmt.Errorf("invalid Xiranite local backend startup output: %w", err)}
		return
	}
	if config.BaseURL == "" {
		ready <- backendReadyResult{err: errors.New("Xiranite local backend did not report a baseUrl")}
		return
	}

	ready <- backendReadyResult{config: config}
	go logPipe("[xiranite-backend:stdout] ", reader)
}

func resolveLocalBackendCommand() (string, []string, string, error) {
	if bin := strings.TrimSpace(os.Getenv("XIRANITE_BACKEND_BIN")); bin != "" {
		return bin, nil, "", nil
	}

	bun, bunErr := resolveBunCommand()
	if strings.TrimSpace(os.Getenv("XIRANITE_NODE_APP_ID")) != "" && bunErr == nil {
		if err := ensureNodeAppBunVersion(bun, nodeAppMinimumBunVersion); err != nil {
			return "", nil, "", err
		}
		if warning := nodeAppBunCompatibilityWarningValue(); warning != "" {
			log.Print(warning)
		}
	}

	if script := strings.TrimSpace(os.Getenv("XIRANITE_BACKEND_JS")); script != "" {
		if bunErr != nil {
			return "", nil, "", fmt.Errorf("XIRANITE_BACKEND_JS requires Bun runtime: %w", bunErr)
		}
		return bun, []string{script}, "", nil
	}

	if nodeID := strings.TrimSpace(os.Getenv("XIRANITE_NODE_APP_ID")); nodeID != "" {
		if embedded := embeddedNodeAppBackendBundle(); embedded.available() {
			if bunErr != nil {
				return "", nil, "", fmt.Errorf("embedded node application backend requires Bun runtime: %w", bunErr)
			}
			script, err := extractEmbeddedLocalBackendBundle(embedded)
			if err != nil {
				return "", nil, "", err
			}
			return bun, []string{script}, "", nil
		}

		root := findProjectRoot()
		source := filepath.Join(root, "packages", "backend", "src", "nodeApp.ts")
		if fileExists(source) {
			if bunErr != nil {
				return "", nil, "", fmt.Errorf("node application backend source requires Bun runtime: %w", bunErr)
			}
			return bun, []string{source}, root, nil
		}
		return "", nil, "", fmt.Errorf("could not find a node application backend for %q", nodeID)
	}

	for _, candidate := range localBackendScriptCandidates() {
		if fileExists(candidate) {
			if bunErr != nil {
				return "", nil, "", fmt.Errorf("found Xiranite local backend JS but Bun runtime is unavailable: %w", bunErr)
			}
			return bun, []string{candidate}, "", nil
		}
	}

	if embedded := embeddedLocalBackendBundle(); embedded.available() {
		if bunErr != nil {
			return "", nil, "", fmt.Errorf("embedded Xiranite local backend JS requires Bun runtime: %w", bunErr)
		}
		script, err := extractEmbeddedLocalBackendBundle(embedded)
		if err != nil {
			return "", nil, "", err
		}
		return bun, []string{script}, "", nil
	}

	root := findProjectRoot()
	source := filepath.Join(root, "packages", "backend", "src", "index.ts")
	if fileExists(source) {
		if bunErr == nil {
			return bun, []string{"packages/backend/src/index.ts"}, root, nil
		}
	}

	return "", nil, "", errors.New("could not find Xiranite local backend JS bundle or Bun runtime")
}

func (bundle embeddedLocalBackendRuntimeBundle) available() bool {
	return bundle.files != nil && bundle.entrypoint != ""
}

func extractEmbeddedLocalBackendBundle(bundle embeddedLocalBackendRuntimeBundle) (string, error) {
	cacheDir, err := os.UserCacheDir()
	if err != nil || cacheDir == "" {
		cacheDir = os.TempDir()
	}
	return extractEmbeddedLocalBackendBundleTo(bundle, filepath.Join(cacheDir, "Xiranite", "runtime"))
}

func extractEmbeddedLocalBackendBundleTo(bundle embeddedLocalBackendRuntimeBundle, cacheDirectory string) (string, error) {
	if !bundle.available() {
		return "", errors.New("embedded Xiranite local backend bundle is unavailable")
	}
	files, err := collectEmbeddedLocalBackendFiles(bundle)
	if err != nil {
		return "", err
	}

	hash := sha256.New()
	for _, file := range files {
		_, _ = hash.Write([]byte(file.relativePath))
		_, _ = hash.Write(file.contents)
	}
	targetDir := filepath.Join(cacheDirectory, fmt.Sprintf("backend-%x", hash.Sum(nil)[:8]))
	target := filepath.Join(targetDir, filepath.FromSlash(path.Base(bundle.entrypoint)))
	if embeddedLocalBackendFilesExist(targetDir, files) {
		return target, nil
	}

	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return "", fmt.Errorf("failed to create Xiranite runtime cache: %w", err)
	}
	for _, file := range files {
		targetFile := filepath.Join(targetDir, filepath.FromSlash(file.relativePath))
		if err := os.MkdirAll(filepath.Dir(targetFile), 0o755); err != nil {
			return "", fmt.Errorf("failed to create Xiranite runtime asset directory: %w", err)
		}
		if err := os.WriteFile(targetFile, file.contents, 0o644); err != nil {
			return "", fmt.Errorf("failed to extract embedded Xiranite local backend asset: %w", err)
		}
	}
	return target, nil
}

func collectEmbeddedLocalBackendFiles(bundle embeddedLocalBackendRuntimeBundle) ([]embeddedLocalBackendFile, error) {
	bundleDirectory := path.Dir(bundle.entrypoint)
	files := make([]embeddedLocalBackendFile, 0, 2)
	err := fs.WalkDir(bundle.files, bundleDirectory, func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		relativePath := strings.TrimPrefix(name, bundleDirectory+"/")
		if relativePath == name || relativePath == "" || strings.HasPrefix(relativePath, "../") {
			return fmt.Errorf("invalid embedded Xiranite local backend asset path %q", name)
		}
		contents, err := fs.ReadFile(bundle.files, name)
		if err != nil {
			return err
		}
		files = append(files, embeddedLocalBackendFile{relativePath: relativePath, contents: contents})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("read embedded Xiranite local backend bundle: %w", err)
	}
	if len(files) == 0 {
		return nil, errors.New("embedded Xiranite local backend bundle has no files")
	}
	return files, nil
}

func embeddedLocalBackendFilesExist(targetDirectory string, files []embeddedLocalBackendFile) bool {
	for _, file := range files {
		if !fileExists(filepath.Join(targetDirectory, filepath.FromSlash(file.relativePath))) {
			return false
		}
	}
	return true
}

func localBackendScriptCandidates() []string {
	name := "xiranite-backend.js"

	candidates := make([]string, 0, 4)
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(exe), name))
	}
	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates,
			filepath.Join(cwd, "build", "wails", name),
			filepath.Join(cwd, "build", "backend", name),
		)
	}
	return candidates
}

func logPipe(prefix string, reader io.Reader) {
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line != "" {
			log.Print(prefix + line)
		}
	}
}
