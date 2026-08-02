package desktop

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWatchDevDesktopShutdownRequestsGracefulQuit(t *testing.T) {
	path := filepath.Join(t.TempDir(), "desktop.stop")
	quit := make(chan struct{}, 1)
	stop := watchDevDesktopShutdown(path, time.Millisecond, func() { quit <- struct{}{} })
	defer stop()

	if err := os.WriteFile(path, []byte("stop\n"), 0o600); err != nil {
		t.Fatalf("write shutdown request: %v", err)
	}

	select {
	case <-quit:
	case <-time.After(time.Second):
		t.Fatal("shutdown watcher did not request a graceful quit")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("shutdown request was not consumed: %v", err)
	}
}

func TestWatchDevDesktopShutdownCanBeStopped(t *testing.T) {
	path := filepath.Join(t.TempDir(), "desktop.stop")
	quit := make(chan struct{}, 1)
	stop := watchDevDesktopShutdown(path, time.Millisecond, func() { quit <- struct{}{} })
	stop()

	if err := os.WriteFile(path, []byte("stop\n"), 0o600); err != nil {
		t.Fatalf("write shutdown request: %v", err)
	}
	time.Sleep(20 * time.Millisecond)
	select {
	case <-quit:
		t.Fatal("stopped shutdown watcher requested a quit")
	default:
	}
}
