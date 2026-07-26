package main

import (
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

var bunVersionPattern = regexp.MustCompile(`^(\d+)\.(\d+)\.(\d+)`)

var nodeAppRuntimeBunVersion string
var nodeAppBunCompatibilityWarning string

func ensureNodeAppBunVersion(command string, minimum string) error {
	output, err := exec.Command(command, "--version").Output()
	if err != nil {
		return fmt.Errorf("inspect Bun runtime version: %w", err)
	}
	actual := strings.TrimSpace(string(output))
	if !isBunVersionAtLeast(actual, minimum) {
		return fmt.Errorf("Bun %s is below this node application's minimum supported version %s", actual, minimum)
	}
	nodeAppRuntimeBunVersion = actual
	if compareBunVersions(actual, nodeAppBuildBunVersion) > 0 {
		nodeAppBunCompatibilityWarning = fmt.Sprintf("Bun %s is newer than the build-tested version %s; the bundled backend capability handshake is required.", actual, nodeAppBuildBunVersion)
	}
	return nil
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
