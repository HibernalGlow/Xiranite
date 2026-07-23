package nexusbridge

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

var captureIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

type BackendConfig struct {
	BaseURL string
	Token   string
}

type BackendProvider func() *BackendConfig

type Server struct {
	listener net.Listener
	provider BackendProvider
	client   *http.Client
	closed   chan struct{}
	once     sync.Once
}

type captureSession struct {
	path         string
	file         *os.File
	totalBytes   int64
	writtenBytes int64
	chunkCount   int
	nextChunk    int
}

func StartServer(provider BackendProvider) (*Server, error) {
	listener, err := Listen()
	if err != nil {
		return nil, err
	}
	server := &Server{
		listener: listener,
		provider: provider,
		client:   &http.Client{Timeout: 20 * time.Second},
		closed:   make(chan struct{}),
	}
	go server.serve()
	return server, nil
}

func (server *Server) Close() error {
	var err error
	server.once.Do(func() {
		close(server.closed)
		err = server.listener.Close()
	})
	return err
}

func (server *Server) serve() {
	for {
		connection, err := server.listener.Accept()
		if err != nil {
			select {
			case <-server.closed:
				return
			default:
				continue
			}
		}
		go server.handleConnection(connection)
	}
}

func (server *Server) handleConnection(connection net.Conn) {
	defer connection.Close()
	sessions := make(map[string]*captureSession)
	defer func() {
		for _, session := range sessions {
			_ = session.file.Close()
			_ = os.Remove(session.path)
		}
	}()

	for {
		var request Request
		if err := ReadFrame(connection, &request); err != nil {
			if !errors.Is(err, io.EOF) {
				_ = WriteFrame(connection, Failure(request, err))
			}
			return
		}
		response := server.handleRequest(request, sessions)
		if err := WriteFrame(connection, response); err != nil {
			return
		}
	}
}

func (server *Server) handleRequest(request Request, sessions map[string]*captureSession) Response {
	if err := ValidateRequest(request); err != nil {
		return Failure(request, err)
	}
	switch request.Type {
	case "hello":
		return Success(request, "connected", json.RawMessage(`{"host":"xiranite-main","protocolVersion":1}`))
	case "ping":
		if config := server.provider(); config == nil || strings.TrimSpace(config.BaseURL) == "" {
			return Failure(request, errors.New("Xiranite backend is not ready"))
		}
		return Success(request, "connected", nil)
	case "capture.begin":
		return server.beginCapture(request, sessions)
	case "capture.chunk":
		return server.appendCapture(request, sessions)
	case "capture.commit":
		return server.commitCapture(request, sessions)
	case "capture.abort":
		cleanupCapture(request.CaptureID, sessions)
		return Success(request, "aborted", nil)
	default:
		return Failure(request, errors.New("unsupported request"))
	}
}

func (server *Server) beginCapture(request Request, sessions map[string]*captureSession) Response {
	if !captureIDPattern.MatchString(request.CaptureID) {
		return Failure(request, errors.New("captureId contains unsupported characters"))
	}
	if request.TotalBytes <= 0 || request.TotalBytes > MaxCaptureBytes {
		return Failure(request, fmt.Errorf("capture size %d exceeds the allowed range", request.TotalBytes))
	}
	if request.ChunkCount <= 0 || request.ChunkCount > int(MaxCaptureBytes/1024) {
		return Failure(request, errors.New("invalid capture chunk count"))
	}
	cleanupCapture(request.CaptureID, sessions)
	directory := filepath.Join(os.TempDir(), "Xiranite", "Nexus")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return Failure(request, err)
	}
	file, err := os.CreateTemp(directory, request.CaptureID+"-*.json.part")
	if err != nil {
		return Failure(request, err)
	}
	sessions[request.CaptureID] = &captureSession{
		path: file.Name(), file: file, totalBytes: request.TotalBytes, chunkCount: request.ChunkCount,
	}
	return Success(request, "receiving", nil)
}

func (server *Server) appendCapture(request Request, sessions map[string]*captureSession) Response {
	session := sessions[request.CaptureID]
	if session == nil {
		return Failure(request, errors.New("capture session was not started"))
	}
	if request.ChunkIndex != session.nextChunk {
		return Failure(request, fmt.Errorf("expected capture chunk %d, received %d", session.nextChunk, request.ChunkIndex))
	}
	data, err := base64.StdEncoding.DecodeString(request.DataBase64)
	if err != nil {
		return Failure(request, errors.New("capture chunk is not valid base64"))
	}
	if len(data) == 0 || len(data) > RecommendedChunkSize {
		return Failure(request, fmt.Errorf("capture chunk size %d exceeds the allowed range", len(data)))
	}
	if session.writtenBytes+int64(len(data)) > session.totalBytes {
		return Failure(request, errors.New("capture data exceeds the declared size"))
	}
	if _, err := session.file.Write(data); err != nil {
		return Failure(request, err)
	}
	session.writtenBytes += int64(len(data))
	session.nextChunk++
	return Success(request, "receiving", nil)
}

func (server *Server) commitCapture(request Request, sessions map[string]*captureSession) Response {
	session := sessions[request.CaptureID]
	if session == nil {
		return Failure(request, errors.New("capture session was not started"))
	}
	defer cleanupCapture(request.CaptureID, sessions)
	if session.nextChunk != session.chunkCount || session.writtenBytes != session.totalBytes {
		return Failure(request, errors.New("capture upload is incomplete"))
	}
	if err := session.file.Close(); err != nil {
		return Failure(request, err)
	}
	payload, err := os.ReadFile(session.path)
	if err != nil {
		return Failure(request, err)
	}
	if err := validateCapturePayload(payload); err != nil {
		return Failure(request, err)
	}
	result, err := server.forwardCapture(payload)
	if err != nil {
		return Failure(request, err)
	}
	return Success(request, "accepted", result)
}

func (server *Server) forwardCapture(payload []byte) (json.RawMessage, error) {
	config := server.provider()
	if config == nil || strings.TrimSpace(config.BaseURL) == "" {
		return nil, errors.New("Xiranite backend is not ready")
	}
	url := strings.TrimRight(config.BaseURL, "/") + "/nexus/captures"
	request, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	request.Header.Set("content-type", "application/json")
	if config.Token != "" {
		request.Header.Set("x-xiranite-token", config.Token)
	}
	response, err := server.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("forward capture to Xiranite backend: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, MaxFrameBytes))
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message := strings.TrimSpace(string(body))
		if message == "" {
			message = response.Status
		}
		return nil, fmt.Errorf("Xiranite rejected the capture: %s", message)
	}
	if !json.Valid(body) {
		return nil, errors.New("Xiranite backend returned invalid JSON")
	}
	return json.RawMessage(body), nil
}

func cleanupCapture(captureID string, sessions map[string]*captureSession) {
	session := sessions[captureID]
	if session == nil {
		return
	}
	_ = session.file.Close()
	_ = os.Remove(session.path)
	delete(sessions, captureID)
}

func validateCapturePayload(payload []byte) error {
	var capture struct {
		Version      int    `json:"version"`
		TargetNodeID string `json:"targetNodeId"`
		Source       struct {
			URL string `json:"url"`
		} `json:"source"`
	}
	if err := json.Unmarshal(payload, &capture); err != nil {
		return fmt.Errorf("capture payload is invalid JSON: %w", err)
	}
	if capture.Version != 1 || strings.TrimSpace(capture.TargetNodeID) == "" || strings.TrimSpace(capture.Source.URL) == "" {
		return errors.New("capture payload is missing version, targetNodeId, or source.url")
	}
	return nil
}
