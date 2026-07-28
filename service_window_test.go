package main

import (
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type trackedWindowControllerStub struct {
	closed     bool
	minimized  bool
	maximized  bool
	fullscreen bool
	restored   bool
}

func (s *trackedWindowControllerStub) Close() { s.closed = true }
func (s *trackedWindowControllerStub) Minimise() application.Window {
	s.minimized = true
	return nil
}
func (s *trackedWindowControllerStub) ToggleMaximise()    { s.maximized = !s.maximized }
func (s *trackedWindowControllerStub) IsMaximised() bool  { return s.maximized }
func (s *trackedWindowControllerStub) ToggleFullscreen()  { s.fullscreen = !s.fullscreen }
func (s *trackedWindowControllerStub) IsFullscreen() bool { return s.fullscreen }
func (s *trackedWindowControllerStub) Restore()           { s.restored = true }

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

func TestControlTrackedWindowUsesOnlyTheRequestedWindow(t *testing.T) {
	window := &trackedWindowControllerStub{}

	minimized := controlTrackedWindow(window, "component-1", "minimize")
	if !window.minimized || minimized.ID != "component-1" || minimized.State != "minimized" {
		t.Fatalf("minimize must target the component window: %+v", minimized)
	}

	closed := controlTrackedWindow(window, "component-1", "close")
	if !window.closed || closed.ID != "component-1" || closed.State != "closed" {
		t.Fatalf("close must target the component window: %+v", closed)
	}
}
