package nexusbridge

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

const (
	ProtocolVersion      = 1
	NativeHostName       = "com.xiranite.nexus"
	MaxFrameBytes        = 1 << 20
	MaxCaptureBytes      = 64 << 20
	RecommendedChunkSize = 256 << 10
)

type Request struct {
	Version    int    `json:"version"`
	Type       string `json:"type"`
	RequestID  string `json:"requestId"`
	CaptureID  string `json:"captureId,omitempty"`
	TotalBytes int64  `json:"totalBytes,omitempty"`
	ChunkCount int    `json:"chunkCount,omitempty"`
	ChunkIndex int    `json:"chunkIndex,omitempty"`
	DataBase64 string `json:"dataBase64,omitempty"`
}

type Response struct {
	Version   int             `json:"version"`
	Type      string          `json:"type"`
	RequestID string          `json:"requestId"`
	OK        bool            `json:"ok"`
	State     string          `json:"state,omitempty"`
	Message   string          `json:"message,omitempty"`
	Result    json.RawMessage `json:"result,omitempty"`
}

func ReadFrame(reader io.Reader, value any) error {
	var size uint32
	if err := binary.Read(reader, binary.LittleEndian, &size); err != nil {
		return err
	}
	if size == 0 || size > MaxFrameBytes {
		return fmt.Errorf("native message size %d is outside the allowed range", size)
	}
	payload := make([]byte, size)
	if _, err := io.ReadFull(reader, payload); err != nil {
		return err
	}
	if err := json.Unmarshal(payload, value); err != nil {
		return fmt.Errorf("decode native message: %w", err)
	}
	return nil
}

func WriteFrame(writer io.Writer, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encode native message: %w", err)
	}
	if len(payload) == 0 || len(payload) > MaxFrameBytes {
		return fmt.Errorf("native message size %d is outside the allowed range", len(payload))
	}
	if err := binary.Write(writer, binary.LittleEndian, uint32(len(payload))); err != nil {
		return err
	}
	_, err = writer.Write(payload)
	return err
}

func ValidateRequest(request Request) error {
	if request.Version != ProtocolVersion {
		return fmt.Errorf("unsupported Nexus protocol version %d", request.Version)
	}
	if request.RequestID == "" {
		return errors.New("requestId is required")
	}
	switch request.Type {
	case "hello", "ping":
		return nil
	case "capture.begin", "capture.chunk", "capture.commit", "capture.abort":
		if request.CaptureID == "" {
			return errors.New("captureId is required")
		}
		return nil
	default:
		return fmt.Errorf("unsupported Nexus request type %q", request.Type)
	}
}

func Success(request Request, state string, result json.RawMessage) Response {
	return Response{
		Version: ProtocolVersion, Type: request.Type + ".result", RequestID: request.RequestID,
		OK: true, State: state, Result: result,
	}
}

func Failure(request Request, err error) Response {
	return Response{
		Version: ProtocolVersion, Type: request.Type + ".result", RequestID: request.RequestID,
		OK: false, State: "error", Message: err.Error(),
	}
}
