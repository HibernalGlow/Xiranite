//go:build !windows

package desktop

import "os/exec"

func configureHiddenSubprocess(_ *exec.Cmd) {}
