package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	nodeAppDataContractSchemaVersion  = 1
	nodeAppInitialDataContractVersion = 1
	// Keep this in sync with NODE_APP_DATA_CONTRACT_VERSION in
	// scripts/lib/node-app-packager.ts when a breaking shared-data migration is
	// introduced. The main Wails host uses it to advance the global marker.
	nodeAppCurrentDataContractVersion = 1
)

type NodeAppDataContractStatus struct {
	CurrentVersion          int    `json:"currentVersion"`
	MinimumSupportedVersion int    `json:"minimumSupportedVersion"`
	MaximumSupportedVersion int    `json:"maximumSupportedVersion"`
	DataPath                string `json:"dataPath"`
}

type nodeAppDataContractDocument struct {
	SchemaVersion int `json:"schemaVersion"`
	Version       int `json:"version"`
}

// checkNodeAppDataContract runs before Bun is started. An old snapshot must
// never get an opportunity to migrate or write shared data after a newer
// snapshot has recorded an incompatible contract.
func checkNodeAppDataContract(minimumValue string, maximumValue string) (NodeAppDataContractStatus, error) {
	minimum, err := parseNodeAppDataContractVersion(minimumValue)
	if err != nil {
		return NodeAppDataContractStatus{}, fmt.Errorf("invalid minimum data contract version: %w", err)
	}
	maximum, err := parseNodeAppDataContractVersion(maximumValue)
	if err != nil {
		return NodeAppDataContractStatus{}, fmt.Errorf("invalid maximum data contract version: %w", err)
	}
	if maximum < minimum {
		return NodeAppDataContractStatus{}, fmt.Errorf("maximum data contract version %d is below minimum %d", maximum, minimum)
	}

	status := NodeAppDataContractStatus{
		MinimumSupportedVersion: minimum,
		MaximumSupportedVersion: maximum,
		DataPath:                nodeAppDataContractsPath(),
	}
	document, err := readNodeAppDataContract(status.DataPath)
	if err != nil {
		return status, err
	}
	status.CurrentVersion = document.Version
	if status.CurrentVersion < minimum || status.CurrentVersion > maximum {
		return status, fmt.Errorf("shared data contract version %d is outside this snapshot's supported range %d-%d; rebuild this node application", status.CurrentVersion, minimum, maximum)
	}
	return status, nil
}

func nodeAppDataContractsPath() string {
	base := strings.TrimSpace(os.Getenv("LOCALAPPDATA"))
	if base == "" {
		base = strings.TrimSpace(os.Getenv("APPDATA"))
	}
	if base == "" {
		home, _ := os.UserHomeDir()
		base = filepath.Join(home, "AppData", "Local")
	}
	return filepath.Join(base, "Xiranite", "node-apps", "data-contract.json")
}

func readNodeAppDataContract(path string) (nodeAppDataContractDocument, error) {
	content, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nodeAppDataContractDocument{SchemaVersion: nodeAppDataContractSchemaVersion, Version: nodeAppInitialDataContractVersion}, nil
	}
	if err != nil {
		return nodeAppDataContractDocument{}, fmt.Errorf("read shared data contract %s: %w", path, err)
	}
	var document nodeAppDataContractDocument
	if err := json.Unmarshal(content, &document); err != nil {
		return nodeAppDataContractDocument{}, fmt.Errorf("parse shared data contract %s: %w", path, err)
	}
	if document.SchemaVersion != nodeAppDataContractSchemaVersion {
		return nodeAppDataContractDocument{}, fmt.Errorf("shared data contract %s uses unsupported schema version %d", path, document.SchemaVersion)
	}
	if document.Version < 1 {
		return nodeAppDataContractDocument{}, fmt.Errorf("shared data contract %s has invalid version %d", path, document.Version)
	}
	return document, nil
}

func parseNodeAppDataContractVersion(value string) (int, error) {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed < 1 {
		return 0, fmt.Errorf("%q is not a positive integer", value)
	}
	return parsed, nil
}
