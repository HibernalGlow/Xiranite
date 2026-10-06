//go:build darwin

package main

import (
	"errors"

	"golang.org/x/sys/unix"
)

// macOS propagates the download quarantine flag to files a quarantined app
// writes, and Gatekeeper then blocks the first exec of the extracted runtime.
// The bytes came from this host's own embedded payload, so clear the flag on
// the copy we just staged.
func clearRuntimeQuarantine(path string) error {
	err := unix.Removexattr(path, "com.apple.quarantine")
	// A runtime staged without the flag present is the normal case.
	if err != nil && !errors.Is(err, unix.ENOATTR) && !errors.Is(err, unix.ENODATA) {
		return err
	}
	return nil
}
