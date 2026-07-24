//go:build windows

package main

import (
	"bufio"
	"os"
	"os/exec"
	"testing"
	"time"
)

func TestLocalBackendProcessContainmentKillsProcessTreeOnClose(t *testing.T) {
	command := exec.Command(os.Args[0], "-test.run=TestLocalBackendProcessContainmentHelper")
	command.Env = append(os.Environ(), "XIRANITE_CONTAINMENT_HELPER=1")
	configureHiddenSubprocess(command)
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	containment, err := newLocalBackendProcessContainment()
	if err != nil {
		t.Fatal(err)
	}
	containment.Prepare(command)
	if err := command.Start(); err != nil {
		_ = containment.Close()
		t.Fatal(err)
	}
	defer func() {
		_ = command.Process.Kill()
		_, _ = command.Process.Wait()
		_ = containment.Close()
	}()
	if err := containment.AssignAndResume(command.Process); err != nil {
		t.Fatal(err)
	}

	ready := make(chan error, 1)
	go func() {
		_, err := bufio.NewReader(stdout).ReadString('\n')
		ready <- err
	}()
	select {
	case err := <-ready:
		if err != nil {
			t.Fatalf("contained process did not report ready: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("contained process did not resume")
	}

	waited := make(chan error, 1)
	go func() { waited <- command.Wait() }()
	if err := containment.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-waited:
	case <-time.After(5 * time.Second):
		t.Fatal("contained process survived after the Job Object closed")
	}
}

func TestLocalBackendProcessContainmentHelper(t *testing.T) {
	if os.Getenv("XIRANITE_CONTAINMENT_HELPER") != "1" {
		return
	}
	_, _ = os.Stdout.WriteString("ready\n")
	select {}
}
