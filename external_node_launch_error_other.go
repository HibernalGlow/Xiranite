//go:build !windows

package main

import "log"

func showExternalNodeLaunchError(message string) {
	log.Printf("External node launch failed: %s", message)
}
