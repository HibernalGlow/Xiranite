//go:build !production

package desktop

func embeddedLocalBackendBundle() embeddedLocalBackendRuntimeBundle {
	return embeddedLocalBackendRuntimeBundle{}
}

func embeddedNodeAppBackendBundle() embeddedLocalBackendRuntimeBundle {
	return embeddedLocalBackendRuntimeBundle{}
}
