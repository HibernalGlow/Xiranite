package main

import (
	"encoding/base64"
	"testing"
)

func TestDecodeTrayIcon(t *testing.T) {
	want := []byte("png")
	encoded := base64.StdEncoding.EncodeToString(want)
	got, err := decodeTrayIcon("data:image/png;base64," + encoded)
	if err != nil {
		t.Fatalf("decodeTrayIcon returned an error: %v", err)
	}
	if string(got) != string(want) {
		t.Fatalf("decodeTrayIcon = %q, want %q", got, want)
	}
}

func TestDecodeTrayIconRejectsNonImageURL(t *testing.T) {
	if _, err := decodeTrayIcon("https://example.com/icon.png"); err == nil {
		t.Fatal("decodeTrayIcon accepted a non-data URL")
	}
}
