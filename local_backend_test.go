package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

func TestStartLocalBackendSkipsDevProxyWithoutExternalBackend(t *testing.T) {
	t.Setenv("FRONTEND_DEVSERVER_URL", "http://127.0.0.1:5173")
	t.Setenv("XIRANITE_BACKEND_URL", "")

	backend, err := StartLocalBackend()
	if err != nil {
		t.Fatalf("expected dev proxy mode to skip local backend without error: %v", err)
	}
	if backend != nil {
		t.Fatalf("expected no local backend in dev proxy attach mode, got %#v", backend)
	}
}

func TestResolveLocalBackendCommandUsesNodeAppEntrypointForDirectNodeHost(t *testing.T) {
	t.Setenv("XIRANITE_BACKEND_BIN", "")
	t.Setenv("XIRANITE_BACKEND_JS", "")
	t.Setenv("XIRANITE_NODE_APP_ID", "neoview")
	originalMinimumBunVersion := nodeAppMinimumBunVersion
	nodeAppMinimumBunVersion = "1.3.0"
	t.Cleanup(func() { nodeAppMinimumBunVersion = originalMinimumBunVersion })

	command, args, cwd, err := resolveLocalBackendCommand()
	if err != nil {
		t.Fatalf("resolve direct node host backend: %v", err)
	}
	if command == "" || len(args) != 1 {
		t.Fatalf("expected one Bun node application backend command, got command=%q args=%#v", command, args)
	}
	if embeddedNodeAppBackendBundle().available() {
		if filepath.Base(args[0]) != "xiranite-node-app-backend.js" {
			t.Fatalf("expected embedded node application backend entrypoint, got %q", args[0])
		}
		if cwd != "" {
			t.Fatalf("expected embedded node application backend to avoid a repository cwd, got %q", cwd)
		}
	} else {
		if !strings.HasSuffix(filepath.ToSlash(args[0]), "/packages/backend/src/nodeApp.ts") {
			t.Fatalf("expected node application backend entrypoint, got %q", args[0])
		}
		if cwd != findProjectRoot() {
			t.Fatalf("expected node application backend cwd %q, got %q", findProjectRoot(), cwd)
		}
	}
}

func TestExtractEmbeddedLocalBackendBundlePreservesRelativeRuntimeAssets(t *testing.T) {
	bundle := embeddedLocalBackendRuntimeBundle{
		files: fstest.MapFS{
			"build/wails/xiranite-backend.js":                &fstest.MapFile{Data: []byte(`require("./backend-assets/sharp.node")`)},
			"build/wails/backend-assets/sharp.node":          &fstest.MapFile{Data: []byte("native-sharp")},
			"build/wails/backend-assets/reader-runtime.wasm": &fstest.MapFile{Data: []byte("reader-runtime")},
		},
		entrypoint: "build/wails/xiranite-backend.js",
	}

	script, err := extractEmbeddedLocalBackendBundleTo(bundle, t.TempDir())
	if err != nil {
		t.Fatalf("extract embedded backend bundle: %v", err)
	}
	contents, err := os.ReadFile(script)
	if err != nil || string(contents) != `require("./backend-assets/sharp.node")` {
		t.Fatalf("extracted backend script = %q, %v", contents, err)
	}
	for _, asset := range []string{"sharp.node", "reader-runtime.wasm"} {
		if _, err := os.Stat(filepath.Join(filepath.Dir(script), "backend-assets", asset)); err != nil {
			t.Fatalf("relative runtime asset %q was not extracted: %v", asset, err)
		}
	}
}

func TestInjectBackendConfig(t *testing.T) {
	html := "<!doctype html><html><head><title>X</title></head><body></body></html>"
	result := injectBackendConfig(html, &LocalBackendConfig{
		BaseURL: wailsBackendPublicURL,
		Token:   "secret",
	})

	if !strings.Contains(result, `window.__XIRANITE_BACKEND__`) {
		t.Fatalf("expected backend config script to be injected: %s", result)
	}
	if !strings.Contains(result, `"baseUrl":"http://wails.localhost"`) {
		t.Fatalf("expected baseUrl in injected config: %s", result)
	}
	if !strings.Contains(result, `"token":"secret"`) {
		t.Fatalf("expected token in injected config: %s", result)
	}
	if strings.Index(result, `window.__XIRANITE_BACKEND__`) > strings.Index(result, `<title>`) {
		t.Fatalf("expected backend config before other head content: %s", result)
	}
}

func TestBackendGatewayProxiesBinaryResponsesAndSwitchesTargets(t *testing.T) {
	first := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, req *http.Request) {
		rw.Header().Set("Content-Type", "image/png")
		rw.Header().Set("Accept-Ranges", "bytes")
		rw.Header().Set("Content-Range", "bytes 0-3/8")
		rw.WriteHeader(http.StatusPartialContent)
		_, _ = rw.Write([]byte("first"))
	}))
	defer first.Close()
	second := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, req *http.Request) {
		_, _ = rw.Write([]byte("second"))
	}))
	defer second.Close()

	current := &LocalBackendConfig{BaseURL: first.URL, Token: "secret"}
	handler := backendGatewayMiddleware(
		func() *LocalBackendConfig { return current },
		func() *LocalBackendConfig {
			return &LocalBackendConfig{BaseURL: wailsBackendPublicURL, Token: "secret"}
		},
	)(http.NotFoundHandler())

	request := httptest.NewRequest(http.MethodGet, "http://wails.localhost/reader/page?token=secret", nil)
	request.Header.Set("Range", "bytes=0-3")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusPartialContent || response.Header().Get("Content-Range") != "bytes 0-3/8" {
		t.Fatalf("expected ranged backend response, got %d %#v", response.Code, response.Header())
	}
	if body, _ := io.ReadAll(response.Result().Body); string(body) != "first" {
		t.Fatalf("expected first backend response, got %q", body)
	}

	current = &LocalBackendConfig{BaseURL: second.URL, Token: "secret"}
	replacement := httptest.NewRecorder()
	handler.ServeHTTP(replacement, httptest.NewRequest(http.MethodGet, "http://wails.localhost/health", nil))
	if replacement.Body.String() != "second" {
		t.Fatalf("expected replacement backend response, got %q", replacement.Body.String())
	}
}

func TestBackendGatewayPreservesJSONRequestBodies(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{
			name:   "open reader session",
			method: http.MethodPost,
			path:   "/reader/sessions?source=desktop",
			body:   `{"path":"D:/Books/demo.cbz"}`,
		},
		{
			name:   "patch reader config",
			method: http.MethodPatch,
			path:   "/reader/config",
			body:   `{"viewDefaults":{"fitMode":"fit-width"}}`,
		},
		{
			name:   "save melodeck metadata",
			method: http.MethodPut,
			path:   "/melodeck/metadata",
			body:   `{"path":"D:/Music/demo.flac","lyricsHydrated":true}`,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			backend := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, req *http.Request) {
				body, err := io.ReadAll(req.Body)
				if err != nil {
					t.Errorf("read proxied request body: %v", err)
					http.Error(rw, "read request body", http.StatusInternalServerError)
					return
				}
				if req.Method != test.method {
					t.Errorf("method = %q, want %q", req.Method, test.method)
				}
				if req.URL.RequestURI() != test.path {
					t.Errorf("request URI = %q, want %q", req.URL.RequestURI(), test.path)
				}
				if req.Header.Get("Content-Type") != "application/json" {
					t.Errorf("content type = %q, want application/json", req.Header.Get("Content-Type"))
				}
				if string(body) != test.body {
					t.Errorf("body = %q, want %q", body, test.body)
				}
				rw.WriteHeader(http.StatusNoContent)
			}))
			defer backend.Close()

			handler := backendGatewayMiddleware(
				func() *LocalBackendConfig {
					return &LocalBackendConfig{BaseURL: backend.URL, Token: "secret"}
				},
				func() *LocalBackendConfig {
					return &LocalBackendConfig{BaseURL: wailsBackendPublicURL, Token: "secret"}
				},
			)(http.NotFoundHandler())

			request := httptest.NewRequest(test.method, "http://wails.localhost"+test.path, strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			// Wails reconstructs requests from a WebView2 stream without populating
			// http.Request.ContentLength, so exercise that exact proxy shape.
			request.ContentLength = 0
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusNoContent {
				t.Fatalf("expected proxied response status 204, got %d: %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestBackendGatewayLeavesWailsRuntimeAndAssetsAlone(t *testing.T) {
	for _, path := range []string{"/", "/assets/app.js", "/wails/runtime"} {
		if isBackendGatewayPath(path) {
			t.Fatalf("expected %s to remain owned by Wails", path)
		}
	}
	for _, path := range []string{"/health", "/reader/s/1/page/2", "/workspace/snapshot", "/config", "/melodeck/library", "/melodeck/metadata"} {
		if !isBackendGatewayPath(path) {
			t.Fatalf("expected %s to be owned by backend gateway", path)
		}
	}
}

func TestInjectBackendConfigSkipsEmptyConfig(t *testing.T) {
	html := "<html></html>"
	if got := injectBackendConfig(html, &LocalBackendConfig{}); got != html {
		t.Fatalf("expected empty config to leave html unchanged")
	}
}
