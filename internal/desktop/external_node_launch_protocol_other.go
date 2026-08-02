//go:build !windows

package desktop

func registerExternalNodeLaunchProtocolForCurrentUser() error {
	return nil
}
