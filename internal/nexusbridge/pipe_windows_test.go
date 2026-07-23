//go:build windows

package nexusbridge

import (
	"fmt"
	"net"
	"os"
	"testing"
	"time"

	"github.com/Microsoft/go-winio"
)

func TestWindowsNamedPipeRoundTrip(t *testing.T) {
	name := fmt.Sprintf(`\\.\pipe\xiranite-nexus-test-%d-%d`, os.Getpid(), time.Now().UnixNano())
	listener, err := listenPipe(name)
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		listener: listener,
		provider: func() *BackendConfig { return &BackendConfig{BaseURL: "http://unused.invalid"} },
		closed:   make(chan struct{}),
	}
	go server.serve()
	defer server.Close()

	timeout := time.Second
	connection, err := winio.DialPipe(name, &timeout)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	assertHelloRoundTrip(t, connection)
}

func assertHelloRoundTrip(t *testing.T, connection net.Conn) {
	t.Helper()
	request := Request{Version: 1, Type: "hello", RequestID: "windows-pipe"}
	if err := WriteFrame(connection, request); err != nil {
		t.Fatal(err)
	}
	var response Response
	if err := ReadFrame(connection, &response); err != nil {
		t.Fatal(err)
	}
	if !response.OK || response.State != "connected" || response.RequestID != request.RequestID {
		t.Fatalf("unexpected Named Pipe response: %#v", response)
	}
}
