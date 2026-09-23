//go:build !darwin

package main

// Only macOS tags downloaded payloads, so the embedded runtime needs no
// quarantine handling on Windows or Linux.
func clearRuntimeQuarantine(string) error { return nil }
