package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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

func TestInjectBackendConfig(t *testing.T) {
	html := "<!doctype html><html><head><title>X</title></head><body></body></html>"
	result := injectBackendConfig(html, &LocalBackendConfig{
		BaseURL: wailsBackendPublicURL,
		Token:   "secret",
	})

	if !strings.Contains(result, `window.__XIRANITE_BACKEND__`) {
		t.Fatalf("expected backend config script to be injected: %s", result)
	}
	if !strings.Contains(result, `"baseUrl":"https://wails.localhost"`) {
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

	request := httptest.NewRequest(http.MethodGet, "https://wails.localhost/reader/page?token=secret", nil)
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
	handler.ServeHTTP(replacement, httptest.NewRequest(http.MethodGet, "https://wails.localhost/health", nil))
	if replacement.Body.String() != "second" {
		t.Fatalf("expected replacement backend response, got %q", replacement.Body.String())
	}
}

func TestBackendGatewayLeavesWailsRuntimeAndAssetsAlone(t *testing.T) {
	for _, path := range []string{"/", "/assets/app.js", "/wails/runtime"} {
		if isBackendGatewayPath(path) {
			t.Fatalf("expected %s to remain owned by Wails", path)
		}
	}
	for _, path := range []string{"/health", "/reader/s/1/page/2", "/workspace/snapshot", "/config"} {
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
