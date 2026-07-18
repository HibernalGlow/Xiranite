//go:build !windows

package main

import "os/exec"

func configureHiddenSubprocess(_ *exec.Cmd) {}
