//go:build !production

package main

// Development builds resolve Bun from the environment by design, so they must
// not warn about a runtime that was never meant to be embedded.
const productionRelease = false
