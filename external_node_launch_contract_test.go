package main

import (
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseExternalNodeLaunchArgvNormalizesFileAndDirectory(t *testing.T) {
	temporary := t.TempDir()
	file := filepath.Join(temporary, "book.cbz")
	if err := os.WriteFile(file, []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}

	fileRequest, err := parseExternalNodeLaunchArgv([]string{"--launch-node", "neoview", "--intent", "open", "--", file})
	if err != nil {
		t.Fatal(err)
	}
	if fileRequest.Source != "explorer" || fileRequest.Targets[0].Kind != "file" || !strings.HasPrefix(fileRequest.Targets[0].URI, "file:") {
		t.Fatalf("unexpected file request: %#v", fileRequest)
	}

	directoryRequest, err := parseExternalNodeLaunchArgv([]string{"--launch-node", "neoview", "--intent", "open", "--", temporary})
	if err != nil {
		t.Fatal(err)
	}
	if directoryRequest.Targets[0].Kind != "directory" {
		t.Fatalf("unexpected directory request: %#v", directoryRequest)
	}
}

func TestParseExternalNodeLaunchURLMatchesArgvTarget(t *testing.T) {
	file := filepath.Join(t.TempDir(), "book.cbz")
	if err := os.WriteFile(file, []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	argvRequest, err := parseExternalNodeLaunchArgv([]string{"--launch-node", "neoview", "--intent", "open", "--", file})
	if err != nil {
		t.Fatal(err)
	}
	launchURL := "xiranite://launch/neoview/open?target=" + url.QueryEscape(argvRequest.Targets[0].URI)
	urlRequest, err := parseExternalNodeLaunchURL(launchURL)
	if err != nil {
		t.Fatal(err)
	}
	if urlRequest.Source != "url" || urlRequest.Targets[0] != argvRequest.Targets[0] {
		t.Fatalf("URL request did not normalize to argv target: %#v != %#v", urlRequest, argvRequest)
	}
}

func TestParseExternalNodeLaunchRejectsUndeclaredAndUnsafeRequests(t *testing.T) {
	temporary := t.TempDir()
	if _, err := parseExternalNodeLaunchArgv([]string{"--launch-node", "owithu", "--intent", "open", "--", temporary}); err == nil {
		t.Fatal("expected undeclared node to be rejected")
	}
	if _, err := parseExternalNodeLaunchURL("xiranite://launch/neoview/open?target=https%3A%2F%2Fexample.test%2Fbook.cbz"); err == nil {
		t.Fatal("expected non-file URL target to be rejected")
	}
	if _, err := parseExternalNodeLaunchURL("xiranite://launch/neoview/open?target=file%3A%2F%2F%2Fmissing&unexpected=value"); err == nil {
		t.Fatal("expected unknown protocol field to be rejected")
	}
	if _, err := parseExternalNodeLaunchArgv([]string{"--launch-node", "neoview", "--intent", "open", "--", temporary, temporary}); err == nil {
		t.Fatal("expected target limit to be rejected")
	}
}
