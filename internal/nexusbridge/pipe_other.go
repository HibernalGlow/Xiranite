//go:build !windows

package nexusbridge

import (
	"net"
	"os"
	"path/filepath"
	"time"
)

func PipeName() (string, error) {
	return filepath.Join(os.TempDir(), "xiranite-nexus.sock"), nil
}

func Listen() (net.Listener, error) {
	name, err := PipeName()
	if err != nil {
		return nil, err
	}
	_ = os.Remove(name)
	return net.Listen("unix", name)
}

func Dial(timeout time.Duration) (net.Conn, error) {
	name, err := PipeName()
	if err != nil {
		return nil, err
	}
	return net.DialTimeout("unix", name, timeout)
}
