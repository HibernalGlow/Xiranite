//go:build !windows

package desktop

import "log"

func showExternalNodeLaunchError(message string) {
	log.Printf("External node launch failed: %s", message)
}
