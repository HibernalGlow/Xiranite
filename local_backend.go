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
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const wailsBackendPublicURL = "https://wails.localhost"

type LocalBackendConfig struct {
	BaseURL string `json:"baseUrl"`
	Token   string `json:"token,omitempty"`
}

type LocalBackend struct {
	Config   LocalBackendConfig
	cmd      *exec.Cmd
	external bool
	stopOnce sync.Once
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

	cmd := exec.Command(command, args...)
	configureHiddenSubprocess(cmd)
	if cwd != "" {
		cmd.Dir = cwd
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}

	if err := cmd.Start(); err != nil {
		return nil, err
	}

	go logPipe("[xiranite-backend:stderr] ", stderr)

	ready := make(chan backendReadyResult, 1)
	go readBackendReady(stdout, ready)

	select {
	case result := <-ready:
		if result.err != nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
			return nil, result.err
		}
		return &LocalBackend{Config: result.config, cmd: cmd}, nil
	case <-time.After(10 * time.Second):
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
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
			if isBackendGatewayPath(req.URL.Path) {
				proxyBackendRequest(rw, req, internalConfig())
				return
			}
			config := publicConfig()
			if req.Method == http.MethodGet && (req.URL.Path == "/" || req.URL.Path == "/index.html") && config != nil && config.BaseURL != "" {
				data, err := assets.ReadFile("dist/index.html")
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
		http.Error(rw, "Xiranite local backend is unavailable.", http.StatusServiceUnavailable)
		return
	}
	target, err := url.Parse(config.BaseURL)
	if err != nil {
		http.Error(rw, "Xiranite local backend target is invalid.", http.StatusBadGateway)
		return
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.ErrorHandler = func(rw http.ResponseWriter, _ *http.Request, err error) {
		log.Printf("Xiranite backend gateway failed: %v", err)
		http.Error(rw, "Xiranite local backend gateway failed.", http.StatusBadGateway)
	}
	proxy.ServeHTTP(rw, req)
}

func isBackendGatewayPath(path string) bool {
	for _, prefix := range backendRoutePrefixes {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return true
		}
	}
	return false
}

var backendRoutePrefixes = [...]string{
	"/config",
	"/health",
	"/local-files",
	"/logs",
	"/nexus",
	"/node-operations",
	"/node-run-history",
	"/nodes",
	"/reader",
	"/runtime-history",
	"/system",
	"/workspace",
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

	if script := strings.TrimSpace(os.Getenv("XIRANITE_BACKEND_JS")); script != "" {
		if bunErr != nil {
			return "", nil, "", fmt.Errorf("XIRANITE_BACKEND_JS requires Bun runtime: %w", bunErr)
		}
		return bun, []string{script}, "", nil
	}

	for _, candidate := range localBackendScriptCandidates() {
		if fileExists(candidate) {
			if bunErr != nil {
				return "", nil, "", fmt.Errorf("found Xiranite local backend JS but Bun runtime is unavailable: %w", bunErr)
			}
			return bun, []string{candidate}, "", nil
		}
	}

	if embedded := embeddedLocalBackendScript(); len(embedded) > 0 {
		if bunErr != nil {
			return "", nil, "", fmt.Errorf("embedded Xiranite local backend JS requires Bun runtime: %w", bunErr)
		}
		script, err := extractEmbeddedLocalBackendScript(embedded)
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

func extractEmbeddedLocalBackendScript(script []byte) (string, error) {
	cacheDir, err := os.UserCacheDir()
	if err != nil || cacheDir == "" {
		cacheDir = os.TempDir()
	}

	sum := sha256.Sum256(script)
	targetDir := filepath.Join(cacheDir, "Xiranite", "runtime")
	target := filepath.Join(targetDir, fmt.Sprintf("xiranite-backend-%x.js", sum[:8]))
	if fileExists(target) {
		return target, nil
	}

	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return "", fmt.Errorf("failed to create Xiranite runtime cache: %w", err)
	}
	if err := os.WriteFile(target, script, 0o644); err != nil {
		return "", fmt.Errorf("failed to extract embedded Xiranite local backend: %w", err)
	}
	return target, nil
}

func resolveBunCommand() (string, error) {
	if bin := strings.TrimSpace(os.Getenv("XIRANITE_BUN_BIN")); bin != "" {
		return bin, nil
	}
	return lookPathWithWindowsExt("bun")
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

func lookPathWithWindowsExt(name string) (string, error) {
	path, err := exec.LookPath(name)
	if err == nil || runtime.GOOS != "windows" || strings.HasSuffix(name, ".exe") {
		return path, err
	}
	return exec.LookPath(name + ".exe")
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
