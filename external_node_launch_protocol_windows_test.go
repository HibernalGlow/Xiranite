//go:build windows

package main

import (
	"fmt"
	"testing"
	"time"

	"golang.org/x/sys/windows/registry"
)

func TestWriteExternalNodeLaunchProtocolRegistrationIsVisibleThroughHKCR(t *testing.T) {
	protocolName := fmt.Sprintf("xiranite.protocol-test-%d", time.Now().UnixNano())
	path := `Software\Classes\` + protocolName
	defer deleteExternalNodeLaunchProtocolTestKey(t, path)

	registration, err := newExternalNodeLaunchProtocolRegistration(`C:\Program Files\Xiranite\Xiranite.exe`)
	if err != nil {
		t.Fatal(err)
	}
	if err := writeExternalNodeLaunchProtocolRegistration(registry.CURRENT_USER, path, registration); err != nil {
		t.Fatal(err)
	}

	protocolKey, err := registry.OpenKey(registry.CLASSES_ROOT, protocolName, registry.QUERY_VALUE)
	if err != nil {
		t.Fatalf("open merged HKCR protocol key: %v", err)
	}
	defer protocolKey.Close()
	assertExternalNodeLaunchRegistryValue(t, protocolKey, "", registration.Description)
	assertExternalNodeLaunchRegistryValue(t, protocolKey, "URL Protocol", "")
	assertExternalNodeLaunchRegistryValue(t, protocolKey, "Xiranite.ManagedBy", "xiranite.external-launch/v1")

	commandKey, err := registry.OpenKey(protocolKey, `shell\open\command`, registry.QUERY_VALUE)
	if err != nil {
		t.Fatalf("open merged HKCR protocol command key: %v", err)
	}
	defer commandKey.Close()
	assertExternalNodeLaunchRegistryValue(t, commandKey, "", registration.Command)
}

func assertExternalNodeLaunchRegistryValue(t *testing.T, key registry.Key, name string, want string) {
	t.Helper()
	got, _, err := key.GetStringValue(name)
	if err != nil {
		t.Fatalf("read registry value %q: %v", name, err)
	}
	if got != want {
		t.Fatalf("registry value %q = %q, want %q", name, got, want)
	}
}

func deleteExternalNodeLaunchProtocolTestKey(t *testing.T, path string) {
	t.Helper()
	for _, child := range []string{`shell\open\command`, `shell\open`, `shell`} {
		if err := registry.DeleteKey(registry.CURRENT_USER, path+`\`+child); err != nil && err != registry.ErrNotExist {
			t.Errorf("delete test registry key %q: %v", child, err)
		}
	}
	if err := registry.DeleteKey(registry.CURRENT_USER, path); err != nil && err != registry.ErrNotExist {
		t.Errorf("delete test registry key %q: %v", path, err)
	}
}
