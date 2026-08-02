//go:build !production

package main

func embeddedLocalBackendBundle() embeddedLocalBackendRuntimeBundle {
	return embeddedLocalBackendRuntimeBundle{}
}

func embeddedNodeAppBackendBundle() embeddedLocalBackendRuntimeBundle {
	return embeddedLocalBackendRuntimeBundle{}
}
