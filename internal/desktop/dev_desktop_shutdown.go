package desktop

import (
	"os"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const devDesktopShutdownPathEnv = "XIRANITE_DEV_DESKTOP_SHUTDOWN_PATH"

func startDevDesktopShutdownWatcher(app *application.App) func() {
	path := strings.TrimSpace(os.Getenv(devDesktopShutdownPathEnv))
	return watchDevDesktopShutdown(path, 50*time.Millisecond, app.Quit)
}

func watchDevDesktopShutdown(path string, interval time.Duration, quit func()) func() {
	if path == "" || interval <= 0 || quit == nil {
		return func() {}
	}

	stopped := make(chan struct{})
	var stopOnce sync.Once
	stop := func() {
		stopOnce.Do(func() { close(stopped) })
	}

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-stopped:
				return
			case <-ticker.C:
				select {
				case <-stopped:
					return
				default:
				}
				if _, err := os.Stat(path); err != nil {
					continue
				}
				_ = os.Remove(path)
				quit()
				return
			}
		}
	}()

	return stop
}
