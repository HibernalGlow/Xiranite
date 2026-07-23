package nexusbridge

import (
	"errors"
	"io"
	"net"
	"time"
)

type DialMain func() (net.Conn, error)

func RunNativeHost(input io.Reader, output io.Writer, dialMain DialMain) error {
	var connection net.Conn
	defer func() {
		if connection != nil {
			_ = connection.Close()
		}
	}()

	for {
		var request Request
		if err := ReadFrame(input, &request); err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				return nil
			}
			return err
		}
		if connection == nil {
			var err error
			connection, err = dialMain()
			if err != nil {
				if writeErr := WriteFrame(output, Failure(request, err)); writeErr != nil {
					return writeErr
				}
				continue
			}
		}
		if err := WriteFrame(connection, request); err != nil {
			_ = connection.Close()
			connection = nil
			if writeErr := WriteFrame(output, Failure(request, err)); writeErr != nil {
				return writeErr
			}
			continue
		}
		var response Response
		if err := ReadFrame(connection, &response); err != nil {
			_ = connection.Close()
			connection = nil
			if writeErr := WriteFrame(output, Failure(request, err)); writeErr != nil {
				return writeErr
			}
			continue
		}
		if err := WriteFrame(output, response); err != nil {
			return err
		}
	}
}

func DialMainWithRetry(launch func() error) (net.Conn, error) {
	connection, err := Dial(300 * time.Millisecond)
	if err == nil {
		return connection, nil
	}
	if launch == nil {
		return nil, err
	}
	if launchErr := launch(); launchErr != nil {
		return nil, launchErr
	}
	deadline := time.Now().Add(12 * time.Second)
	for time.Now().Before(deadline) {
		connection, err = Dial(300 * time.Millisecond)
		if err == nil {
			return connection, nil
		}
		time.Sleep(150 * time.Millisecond)
	}
	return nil, err
}
