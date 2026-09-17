package main

import "testing"

// redirectXiraniteDataDirectory points the per-OS Xiranite data directory at a
// fresh temp root and returns that root. Every platform resolves its data
// directory from a different environment variable, so all of them are set;
// previously only LOCALAPPDATA was, which meant tests leaked into the
// developer's real macOS/Linux application data directory.
func redirectXiraniteDataDirectory(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	t.Setenv("LOCALAPPDATA", root)
	t.Setenv("APPDATA", root)
	t.Setenv("XDG_DATA_HOME", root)
	t.Setenv("HOME", root)
	return root
}
