//go:build windows

package main

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/Microsoft/go-winio"
	"golang.org/x/sys/windows"
)

type externalNodeLaunchHostInstance struct {
	mutex    windows.Handle
	listener net.Listener

	mu      sync.RWMutex
	handler func(externalNodeLaunchRequest) externalNodeLaunchAcknowledgement
	close   sync.Once
}

func acquireExternalNodeLaunchHostInstance(nodeID string, dataDirectory string) (*externalNodeLaunchHostInstance, bool, error) {
	key := externalNodeLaunchHostKey(nodeID, dataDirectory)
	mutexName, err := windows.UTF16PtrFromString("Local\\Xiranite.ExternalNodeLaunch." + key)
	if err != nil {
		return nil, false, err
	}
	handle, err := windows.CreateMutex(nil, false, mutexName)
	if errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		_ = windows.CloseHandle(handle)
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	listener, err := winio.ListenPipe(externalNodeLaunchHostPipeName(key), &winio.PipeConfig{InputBufferSize: 8192, OutputBufferSize: 2048})
	if err != nil {
		_ = windows.CloseHandle(handle)
		return nil, false, err
	}
	instance := &externalNodeLaunchHostInstance{mutex: handle, listener: listener}
	go instance.acceptRequests()
	return instance, true, nil
}

func submitExternalNodeLaunchToExistingHost(nodeID string, request externalNodeLaunchRequest, timeout time.Duration) (externalNodeLaunchAcknowledgement, error) {
	key := externalNodeLaunchHostKey(nodeID, externalNodeLaunchHostDataDirectory(nodeID))
	connection, err := winio.DialPipe(externalNodeLaunchHostPipeName(key), &timeout)
	if err != nil {
		return externalNodeLaunchAcknowledgement{}, err
	}
	defer connection.Close()
	_ = connection.SetDeadline(time.Now().Add(timeout))
	if err := json.NewEncoder(connection).Encode(request); err != nil {
		return externalNodeLaunchAcknowledgement{}, err
	}
	var acknowledgement externalNodeLaunchAcknowledgement
	if err := json.NewDecoder(io.LimitReader(connection, 4096)).Decode(&acknowledgement); err != nil {
		return externalNodeLaunchAcknowledgement{}, err
	}
	return acknowledgement, nil
}

func (i *externalNodeLaunchHostInstance) SetRequestHandler(handler func(externalNodeLaunchRequest) externalNodeLaunchAcknowledgement) {
	i.mu.Lock()
	i.handler = handler
	i.mu.Unlock()
}

func (i *externalNodeLaunchHostInstance) Close() {
	i.close.Do(func() {
		if i.listener != nil {
			_ = i.listener.Close()
		}
		if i.mutex != 0 {
			_ = windows.CloseHandle(i.mutex)
		}
	})
}

func (i *externalNodeLaunchHostInstance) acceptRequests() {
	for {
		connection, err := i.listener.Accept()
		if err != nil {
			return
		}
		go i.handleRequest(connection)
	}
}

func (i *externalNodeLaunchHostInstance) handleRequest(connection net.Conn) {
	defer connection.Close()
	_ = connection.SetDeadline(time.Now().Add(externalNodeLaunchAcknowledgementTimeout))
	var request externalNodeLaunchRequest
	if err := json.NewDecoder(io.LimitReader(connection, 65536)).Decode(&request); err != nil {
		_ = json.NewEncoder(connection).Encode(externalNodeLaunchAcknowledgement{Accepted: false, Message: fmt.Sprintf("Invalid external launch request: %v", err)})
		return
	}
	if err := validateExternalNodeLaunchRequest(request); err != nil {
		_ = json.NewEncoder(connection).Encode(externalNodeLaunchAcknowledgement{RequestID: request.RequestID, Accepted: false, Message: err.Error()})
		return
	}
	i.mu.RLock()
	handler := i.handler
	i.mu.RUnlock()
	if handler == nil {
		_ = json.NewEncoder(connection).Encode(externalNodeLaunchAcknowledgement{RequestID: request.RequestID, Accepted: false, Message: "The external node host is still starting."})
		return
	}
	_ = json.NewEncoder(connection).Encode(handler(request))
}

func externalNodeLaunchHostKey(nodeID string, dataDirectory string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(nodeID) + "|" + strings.TrimSpace(dataDirectory))))
	return fmt.Sprintf("%x", sum[:12])
}

func externalNodeLaunchHostPipeName(key string) string {
	return `\\.\pipe\Xiranite.ExternalNodeLaunch.` + key
}
