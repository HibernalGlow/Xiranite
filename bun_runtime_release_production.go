//go:build production

package main

// productionRelease marks a packaged host: one of the two release variants is
// compiled in, so a missing Bun runtime is a support problem for a user rather
// than a developer's local choice.
const productionRelease = true
