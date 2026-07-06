package main

import (
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
		BaseURL: "http://127.0.0.1:4321",
		Token:   "secret",
	})

	if !strings.Contains(result, `window.__XIRANITE_BACKEND__`) {
		t.Fatalf("expected backend config script to be injected: %s", result)
	}
	if !strings.Contains(result, `"baseUrl":"http://127.0.0.1:4321"`) {
		t.Fatalf("expected baseUrl in injected config: %s", result)
	}
	if !strings.Contains(result, `"token":"secret"`) {
		t.Fatalf("expected token in injected config: %s", result)
	}
	if strings.Index(result, `window.__XIRANITE_BACKEND__`) > strings.Index(result, `<title>`) {
		t.Fatalf("expected backend config before other head content: %s", result)
	}
}

func TestInjectBackendConfigSkipsEmptyConfig(t *testing.T) {
	html := "<html></html>"
	if got := injectBackendConfig(html, &LocalBackendConfig{}); got != html {
		t.Fatalf("expected empty config to leave html unchanged")
	}
}
