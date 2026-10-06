//go:build windows

package main

import (
	"crypto/sha256"
	"errors"
	"io"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/Microsoft/go-winio"
	"golang.org/x/sys/windows"
)

// nodeAppInstance coordinates all snapshots of a node at one data root. A
// named mutex prevents a second backend, while the pipe raises the first UI.
type nodeAppInstance struct {
	mutex    windows.Handle
	listener net.Listener

	mu           sync.Mutex
	focusHandler func()
	pendingFocus bool
	closeOnce    sync.Once
}

func acquireNodeAppInstance(nodeID string, dataDirectory string) (*nodeAppInstance, bool, error) {
	key := nodeAppInstanceKey(nodeID, dataDirectory)
	mutexName, err := windows.UTF16PtrFromString("Local\\Xiranite.NodeApp." + key)
	if err != nil {
		return nil, false, err
	}
	handle, err := windows.CreateMutex(nil, false, mutexName)
	if errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		_ = windows.CloseHandle(handle)
		notifyNodeAppFocus(nodeAppPipeName(key))
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	listener, err := winio.ListenPipe(nodeAppPipeName(key), &winio.PipeConfig{InputBufferSize: 64, OutputBufferSize: 64})
	if err != nil {
		_ = windows.CloseHandle(handle)
		return nil, false, err
	}
	instance := &nodeAppInstance{mutex: handle, listener: listener}
	go instance.acceptFocusRequests()
	return instance, true, nil
}

func (i *nodeAppInstance) SetFocusHandler(handler func()) {
	i.mu.Lock()
	i.focusHandler = handler
	pending := i.pendingFocus
	i.pendingFocus = false
	i.mu.Unlock()
	if pending && handler != nil {
		go handler()
	}
}

func (i *nodeAppInstance) Close() {
	i.closeOnce.Do(func() {
		if i.listener != nil {
			_ = i.listener.Close()
		}
		if i.mutex != 0 {
			_ = windows.CloseHandle(i.mutex)
		}
	})
}

func (i *nodeAppInstance) acceptFocusRequests() {
	for {
		connection, err := i.listener.Accept()
		if err != nil {
			return
		}
		go func() {
			defer connection.Close()
			_ = connection.SetReadDeadline(time.Now().Add(2 * time.Second))
			_, _ = io.CopyN(io.Discard, connection, 64)
			i.triggerFocus()
		}()
	}
}

func (i *nodeAppInstance) triggerFocus() {
	i.mu.Lock()
	handler := i.focusHandler
	if handler == nil {
		i.pendingFocus = true
	}
	i.mu.Unlock()
	if handler != nil {
		go handler()
	}
}

func nodeAppInstanceKey(nodeID string, dataDirectory string) string {
	value := strings.ToLower(strings.TrimSpace(nodeID) + "|" + strings.TrimSpace(dataDirectory))
	sum := sha256.Sum256([]byte(value))
	return fmtHex(sum[:12])
}

func nodeAppPipeName(key string) string {
	return `\\.\pipe\Xiranite.NodeApp.` + key
}

func notifyNodeAppFocus(pipeName string) {
	for attempt := 0; attempt < 12; attempt++ {
		timeout := 150 * time.Millisecond
		connection, err := winio.DialPipe(pipeName, &timeout)
		if err == nil {
			_, _ = connection.Write([]byte("focus\n"))
			_ = connection.Close()
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func fmtHex(value []byte) string {
	const digits = "0123456789abcdef"
	output := make([]byte, len(value)*2)
	for index, item := range value {
		output[index*2] = digits[item>>4]
		output[index*2+1] = digits[item&0x0f]
	}
	return string(output)
}
