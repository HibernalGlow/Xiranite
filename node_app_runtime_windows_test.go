//go:build windows

package main

import "testing"

func TestNodeAppBunVersionProbeDoesNotCreateAConsoleWindow(t *testing.T) {
	command := nodeAppBunVersionCommand("bun.exe")
	if command.SysProcAttr == nil || !command.SysProcAttr.HideWindow {
		t.Fatal("Bun version probe did not hide its Windows process")
	}
	if command.SysProcAttr.CreationFlags&windowsCreateNoWindow == 0 {
		t.Fatalf("Bun version probe creation flags = %#x, want CREATE_NO_WINDOW", command.SysProcAttr.CreationFlags)
	}
}
