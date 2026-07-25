package main

import (
	"testing"
)

func TestComponentWindowIDUsesComponentIdentity(t *testing.T) {
	first := componentWindowID("alphabet-window-enginev-1")
	if first != componentWindowID("alphabet-window-enginev-1") {
		t.Fatal("component window id must be stable")
	}
	if first == componentWindowID("alphabet-window-enginev-2") {
		t.Fatal("distinct component ids must not share a window")
	}
}

func TestComponentWindowFrameEventUsesWorkspaceIdentityAndNormalSize(t *testing.T) {
	input := OpenComponentWindowInput{ComponentID: "component-1", ModuleID: "enginev", WorkspaceID: "ws-alpha"}
	event, ok := newComponentWindowFrameEvent(input, 1180, 760)
	if !ok {
		t.Fatal("expected a valid component window frame event")
	}
	if event.ComponentID != input.ComponentID || event.ModuleID != input.ModuleID || event.WorkspaceID != input.WorkspaceID {
		t.Fatalf("unexpected event identity: %+v", event)
	}
	if event.Width != 1180 || event.Height != 760 {
		t.Fatalf("unexpected event size: %+v", event)
	}

	if _, ok := newComponentWindowFrameEvent(input, 120, 100); ok {
		t.Fatal("undersized frames must not be persisted")
	}
}
