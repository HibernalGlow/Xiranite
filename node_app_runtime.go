package main

import (
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// nodeAppBunVersionTimeout bounds the `bun --version` probe, which runs on the
// backend startup path: a Bun on PATH that hangs (broken shim, network home) must
// not block the host indefinitely.
const nodeAppBunVersionTimeout = 10 * time.Second

var bunVersionPattern = regexp.MustCompile(`^(\d+)\.(\d+)\.(\d+)`)

// nodeAppBunStatusMu guards the two Bun facts below. They are written while a
// backend starts or restarts and read by the recovery reporter, which holds a
// different lock, so an unsynchronised string write was a real data race.
var nodeAppBunStatusMu sync.Mutex

var (
	nodeAppRuntimeBunVersion       string
	nodeAppBunCompatibilityWarning string
)

func nodeAppRuntimeBunVersionValue() string {
	nodeAppBunStatusMu.Lock()
	defer nodeAppBunStatusMu.Unlock()
	return nodeAppRuntimeBunVersion
}

func nodeAppBunCompatibilityWarningValue() string {
	nodeAppBunStatusMu.Lock()
	defer nodeAppBunStatusMu.Unlock()
	return nodeAppBunCompatibilityWarning
}

func setNodeAppBunStatus(version string, warning string) {
	nodeAppBunStatusMu.Lock()
	nodeAppRuntimeBunVersion = version
	nodeAppBunCompatibilityWarning = warning
	nodeAppBunStatusMu.Unlock()
}

func ensureNodeAppBunVersion(command string, minimum string) error {
	ctx, cancel := context.WithTimeout(context.Background(), nodeAppBunVersionTimeout)
	defer cancel()
	versionCommand := nodeAppBunVersionCommandContext(ctx, command)
	output, err := versionCommand.Output()
	if err != nil {
		return fmt.Errorf("inspect Bun runtime version: %w", err)
	}
	actual := strings.TrimSpace(string(output))
	if !isBunVersionAtLeast(actual, minimum) {
		return fmt.Errorf("Bun %s is below this node application's minimum supported version %s", actual, minimum)
	}
	warning := ""
	if compareBunVersions(actual, nodeAppBuildBunVersion) > 0 {
		warning = fmt.Sprintf("Bun %s is newer than the build-tested version %s; the bundled backend capability handshake is required.", actual, nodeAppBuildBunVersion)
	}
	// A compatible runtime clears the previous warning instead of leaving a stale
	// one reported for the life of the host.
	setNodeAppBunStatus(actual, warning)
	return nil
}

// noteNodeAppBunCompatibilityWarning records an externally derived warning, such
// as an embedded build falling back to an older system Bun.
func noteNodeAppBunCompatibilityWarning(warning string) {
	nodeAppBunStatusMu.Lock()
	nodeAppBunCompatibilityWarning = warning
	nodeAppBunStatusMu.Unlock()
}

func nodeAppBunVersionCommand(command string) *exec.Cmd {
	return nodeAppBunVersionCommandContext(context.Background(), command)
}

func nodeAppBunVersionCommandContext(ctx context.Context, command string) *exec.Cmd {
	versionCommand := exec.CommandContext(ctx, command, "--version")
	// Kill and reap even if the child handed the output pipe to a process of its
	// own; without this a deadline could still be swallowed by an open pipe.
	versionCommand.WaitDelay = 2 * time.Second
	configureHiddenSubprocess(versionCommand)
	return versionCommand
}

func isBunVersionAtLeast(actual string, minimum string) bool {
	return compareBunVersions(actual, minimum) >= 0
}

func compareBunVersions(actual string, reference string) int {
	actualParts, ok := parseBunVersion(actual)
	if !ok {
		return -1
	}
	referenceParts, ok := parseBunVersion(reference)
	if !ok {
		return -1
	}
	for index := range actualParts {
		if actualParts[index] != referenceParts[index] {
			if actualParts[index] > referenceParts[index] {
				return 1
			}
			return -1
		}
	}
	return 0
}

func parseBunVersion(value string) ([3]int, bool) {
	match := bunVersionPattern.FindStringSubmatch(strings.TrimSpace(value))
	if len(match) != 4 {
		return [3]int{}, false
	}
	var output [3]int
	for index := range output {
		parsed, err := strconv.Atoi(match[index+1])
		if err != nil {
			return [3]int{}, false
		}
		output[index] = parsed
	}
	return output, true
}
