//go:build windows

package main

import (
	"fmt"
	"testing"
	"time"
)

func TestNodeAppInstanceFocusesExistingProcess(t *testing.T) {
	dataDirectory := t.TempDir()
	nodeID := fmt.Sprintf("node-app-test-%d", time.Now().UnixNano())
	first, primary, err := acquireNodeAppInstance(nodeID, dataDirectory)
	if err != nil || !primary {
		t.Fatalf("first instance = (%v, %v), want primary without error", primary, err)
	}
	defer first.Close()

	focused := make(chan struct{}, 1)
	first.SetFocusHandler(func() { focused <- struct{}{} })
	second, primary, err := acquireNodeAppInstance(nodeID, dataDirectory)
	if err != nil || primary || second != nil {
		t.Fatalf("second instance = (%v, %v, %v), want existing process", second, primary, err)
	}
	select {
	case <-focused:
	case <-time.After(3 * time.Second):
		t.Fatal("existing node application was not focused")
	}
}

func TestNodeAppInstanceKeyScopesDataDirectory(t *testing.T) {
	if nodeAppInstanceKey("xlchemy", `C:\\one`) == nodeAppInstanceKey("xlchemy", `C:\\two`) {
		t.Fatal("different data directories must not share a node application mutex")
	}
}
