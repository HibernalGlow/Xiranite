//go:build windows

package nexusbridge

import (
	"fmt"
	"net"
	"time"

	"github.com/Microsoft/go-winio"
	"golang.org/x/sys/windows"
)

func PipeName() (string, error) {
	token := windows.GetCurrentProcessToken()
	user, err := token.GetTokenUser()
	if err != nil {
		return "", fmt.Errorf("read current Windows user: %w", err)
	}
	sid := user.User.Sid.String()
	return `\\.\pipe\xiranite-nexus-` + sid, nil
}

func Listen() (net.Listener, error) {
	name, err := PipeName()
	if err != nil {
		return nil, err
	}
	return listenPipe(name)
}

func listenPipe(name string) (net.Listener, error) {
	token := windows.GetCurrentProcessToken()
	user, err := token.GetTokenUser()
	if err != nil {
		return nil, err
	}
	securityDescriptor := "D:P(A;;GA;;;" + user.User.Sid.String() + ")"
	return winio.ListenPipe(name, &winio.PipeConfig{
		SecurityDescriptor: securityDescriptor,
		MessageMode:        false,
		InputBufferSize:    MaxFrameBytes,
		OutputBufferSize:   MaxFrameBytes,
	})
}

func Dial(timeout time.Duration) (net.Conn, error) {
	name, err := PipeName()
	if err != nil {
		return nil, err
	}
	return winio.DialPipe(name, &timeout)
}
