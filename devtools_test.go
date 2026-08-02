package main

import "testing"

func TestDevToolsKeyBindingsIncludesF12(t *testing.T) {
	if _, ok := devToolsKeyBindings()["F12"]; !ok {
		t.Fatal("expected F12 developer-tools key binding")
	}
}
