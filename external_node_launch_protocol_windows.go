//go:build windows

package main

import (
	"fmt"

	"golang.org/x/sys/windows/registry"
)

const externalNodeLaunchProtocolRegistryPath = `Software\Classes\xiranite`

// registerExternalNodeLaunchProtocolForCurrentUser is deliberately independent
// from every node's Explorer integration toggle. Any declared node can receive
// a xiranite:// request, so disabling NeoView must not remove this protocol.
func registerExternalNodeLaunchProtocolForCurrentUser() error {
	executable, err := resolveStableDesktopExecutable()
	if err != nil {
		return err
	}
	registration, err := newExternalNodeLaunchProtocolRegistration(executable)
	if err != nil {
		return err
	}
	return writeExternalNodeLaunchProtocolRegistration(
		registry.CURRENT_USER,
		externalNodeLaunchProtocolRegistryPath,
		registration,
	)
}

func writeExternalNodeLaunchProtocolRegistration(
	root registry.Key,
	path string,
	registration externalNodeLaunchProtocolRegistration,
) error {
	key, _, err := registry.CreateKey(root, path, registry.SET_VALUE|registry.CREATE_SUB_KEY)
	if err != nil {
		return fmt.Errorf("create protocol key %q: %w", path, err)
	}
	defer key.Close()
	if err := key.SetStringValue("", registration.Description); err != nil {
		return fmt.Errorf("write protocol description: %w", err)
	}
	if err := key.SetStringValue("URL Protocol", ""); err != nil {
		return fmt.Errorf("write URL Protocol marker: %w", err)
	}
	if err := key.SetStringValue("Xiranite.ManagedBy", "xiranite.external-launch/v1"); err != nil {
		return fmt.Errorf("write protocol ownership marker: %w", err)
	}
	commandKey, _, err := registry.CreateKey(key, `shell\open\command`, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("create protocol command key: %w", err)
	}
	defer commandKey.Close()
	if err := commandKey.SetStringValue("", registration.Command); err != nil {
		return fmt.Errorf("write protocol command: %w", err)
	}
	return nil
}
