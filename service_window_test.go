package main

import "testing"

func TestComponentWindowIDUsesComponentIdentity(t *testing.T) {
	first := componentWindowID("alphabet-window-enginev-1")
	if first != componentWindowID("alphabet-window-enginev-1") {
		t.Fatal("component window id must be stable")
	}
	if first == componentWindowID("alphabet-window-enginev-2") {
		t.Fatal("distinct component ids must not share a window")
	}
}
