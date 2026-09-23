//go:build !production || no_bun

package main

// Builds without a packaged runtime resolve Bun from XIRANITE_BUN_BIN or PATH,
// which is how the system-Bun release variant and every development build runs.
func embeddedBunBundle() embeddedBunRuntimeBundle {
	return embeddedBunRuntimeBundle{}
}
