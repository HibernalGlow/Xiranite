package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/hibernalglow/xiranite/internal/nexusbridge"
)

type hostConfig struct {
	MainExecutable string `json:"mainExecutable"`
}

func main() {
	err := nexusbridge.RunNativeHost(os.Stdin, os.Stdout, func() (connection net.Conn, err error) {
		return nexusbridge.DialMainWithRetry(launchXiranite)
	})
	if err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func launchXiranite() error {
	executable, err := resolveMainExecutable()
	if err != nil {
		return err
	}
	command := exec.Command(executable)
	if runtime.GOOS == "windows" {
		configureDetachedProcess(command)
	}
	if err := command.Start(); err != nil {
		return fmt.Errorf("start Xiranite: %w", err)
	}
	return command.Process.Release()
}

func resolveMainExecutable() (string, error) {
	hostExecutable, err := os.Executable()
	if err != nil {
		return "", err
	}
	directory := filepath.Dir(hostExecutable)
	configPath := filepath.Join(directory, "xiranite-native-host.config.json")
	if data, readErr := os.ReadFile(configPath); readErr == nil {
		var config hostConfig
		if json.Unmarshal(data, &config) == nil && strings.TrimSpace(config.MainExecutable) != "" {
			if _, statErr := os.Stat(config.MainExecutable); statErr == nil {
				return config.MainExecutable, nil
			}
		}
	}
	name := "Xiranite"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	candidate := filepath.Join(directory, name)
	if _, err := os.Stat(candidate); err == nil {
		return candidate, nil
	}
	return "", errors.New("Xiranite main executable is not configured; start Xiranite first")
}
