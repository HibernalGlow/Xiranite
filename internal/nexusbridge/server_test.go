package nexusbridge

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNativeHostForwardsChunkedCaptureToMainBridge(t *testing.T) {
	var accepted map[string]any
	backend := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/nexus/captures" || request.Method != http.MethodPost {
			t.Fatalf("unexpected backend request %s %s", request.Method, request.URL.Path)
		}
		if got := request.Header.Get("x-xiranite-token"); got != "bridge-token" {
			t.Fatalf("unexpected backend token %q", got)
		}
		if err := json.NewDecoder(request.Body).Decode(&accepted); err != nil {
			t.Fatal(err)
		}
		writer.Header().Set("content-type", "application/json")
		writer.WriteHeader(http.StatusAccepted)
		_, _ = writer.Write([]byte(`{"id":"capture-1","accepted":true}`))
	}))
	defer backend.Close()

	mainConnection, hostConnection := net.Pipe()
	server := &Server{
		provider: func() *BackendConfig { return &BackendConfig{BaseURL: backend.URL, Token: "bridge-token"} },
		client:   backend.Client(),
	}
	go server.handleConnection(mainConnection)

	payload := []byte(`{"version":1,"targetNodeId":"lorat","kind":"page","source":{"url":"https://civitai.red/models/2794878/si-arknight-endfield","capturedAt":"2026-07-24T00:00:00.000Z"},"content":{"text":"captured page"}}`)
	var input bytes.Buffer
	for _, request := range []Request{
		{Version: 1, Type: "hello", RequestID: "hello"},
		{Version: 1, Type: "ping", RequestID: "ping"},
		{Version: 1, Type: "capture.begin", RequestID: "begin", CaptureID: "capture_test", TotalBytes: int64(len(payload)), ChunkCount: 1},
		{Version: 1, Type: "capture.chunk", RequestID: "chunk", CaptureID: "capture_test", ChunkIndex: 0, DataBase64: base64.StdEncoding.EncodeToString(payload)},
		{Version: 1, Type: "capture.commit", RequestID: "commit", CaptureID: "capture_test"},
	} {
		if err := WriteFrame(&input, request); err != nil {
			t.Fatal(err)
		}
	}

	var output bytes.Buffer
	dialled := false
	err := RunNativeHost(&input, &output, func() (net.Conn, error) {
		if dialled {
			t.Fatal("Native Host unexpectedly dialled the main bridge twice")
		}
		dialled = true
		return hostConnection, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if accepted["targetNodeId"] != "lorat" {
		t.Fatalf("capture was not forwarded to Lorat: %#v", accepted)
	}
	if source, ok := accepted["source"].(map[string]any); !ok || source["url"] != "https://civitai.red/models/2794878/si-arknight-endfield" {
		t.Fatalf("capture source was changed: %#v", accepted)
	}

	for _, expected := range []string{"connected", "connected", "receiving", "receiving", "accepted"} {
		var response Response
		if err := ReadFrame(&output, &response); err != nil {
			t.Fatal(err)
		}
		if !response.OK || response.State != expected {
			t.Fatalf("unexpected bridge response: %#v", response)
		}
	}
	if _, err := io.ReadAll(&output); err != nil {
		t.Fatal(err)
	}
}

func TestServerRejectsOversizedCapture(t *testing.T) {
	server := &Server{provider: func() *BackendConfig { return &BackendConfig{BaseURL: "http://example.invalid"} }}
	response := server.handleRequest(Request{
		Version: 1, Type: "capture.begin", RequestID: "begin", CaptureID: "capture_test", TotalBytes: MaxCaptureBytes + 1, ChunkCount: 1,
	}, map[string]*captureSession{})
	if response.OK || response.State != "error" {
		t.Fatalf("expected oversized capture rejection, got %#v", response)
	}
}
