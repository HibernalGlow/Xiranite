package desktop

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const externalNodeLaunchProtocolName = "xiranite"
const externalNodeLaunchProtocolDescription = "URL:Xiranite Protocol"

type externalNodeLaunchProtocolRegistration struct {
	Description string
	Command     string
}

// A go run executable disappears with the development session. Shell
// registrations must refer to an installed desktop entry point instead.
func resolveStableDesktopExecutable() (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("resolve desktop executable: %w", err)
	}
	if isGoRunTemporaryExecutable(executable) {
		return "", fmt.Errorf("refusing to register temporary go run executable %q", executable)
	}
	return executable, nil
}

func isGoRunTemporaryExecutable(executable string) bool {
	executableDir := filepath.Dir(filepath.Clean(executable))
	if !strings.EqualFold(filepath.Base(executableDir), "exe") {
		return false
	}
	buildDirectory := filepath.Dir(filepath.Dir(executableDir))
	return strings.HasPrefix(strings.ToLower(filepath.Base(buildDirectory)), "go-build")
}

func newExternalNodeLaunchProtocolRegistration(executable string) (externalNodeLaunchProtocolRegistration, error) {
	quotedExecutable, err := quoteExternalNodeLaunchWindowsArgument(executable)
	if err != nil {
		return externalNodeLaunchProtocolRegistration{}, fmt.Errorf("quote desktop executable: %w", err)
	}
	return externalNodeLaunchProtocolRegistration{
		Description: externalNodeLaunchProtocolDescription,
		Command:     quotedExecutable + ` "%1"`,
	}, nil
}

// Explorer expands the protocol URL as one argument. Always quoting preserves
// executable paths with spaces and prevents the registry value from becoming a
// second command line when an unexpected control character reaches this layer.
func quoteExternalNodeLaunchWindowsArgument(value string) (string, error) {
	if value == "" {
		return "", fmt.Errorf("value is empty")
	}
	if strings.ContainsAny(value, "\x00\r\n") {
		return "", fmt.Errorf("value contains a command control character")
	}

	var quoted strings.Builder
	quoted.Grow(len(value) + 2)
	quoted.WriteByte('"')
	backslashes := 0
	for _, character := range value {
		switch character {
		case '\\':
			backslashes++
		case '"':
			quoted.WriteString(strings.Repeat(`\`, backslashes*2+1))
			quoted.WriteRune(character)
			backslashes = 0
		default:
			quoted.WriteString(strings.Repeat(`\`, backslashes))
			quoted.WriteRune(character)
			backslashes = 0
		}
	}
	quoted.WriteString(strings.Repeat(`\`, backslashes*2))
	quoted.WriteByte('"')
	return quoted.String(), nil
}
