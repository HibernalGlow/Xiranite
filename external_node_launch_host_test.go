package main

import "testing"

func TestExternalNodeLaunchHostRuntimePollsPendingRequestsInOrder(t *testing.T) {
	first := externalNodeLaunchRequest{RequestID: "first", NodeID: "neoview", Intent: "open"}
	second := externalNodeLaunchRequest{RequestID: "second", NodeID: "neoview", Intent: "open"}
	runtime := newExternalNodeLaunchHostRuntime(nil, first)
	secondResponse := runtime.queue(second)

	if current := runtime.nextPendingRequest(); current == nil || current.RequestID != first.RequestID {
		t.Fatalf("first pending request = %#v, want %q", current, first.RequestID)
	}
	if acknowledgement := runtime.acknowledge(externalNodeLaunchAcknowledgement{RequestID: first.RequestID, Accepted: true}); !acknowledgement.Accepted {
		t.Fatalf("first acknowledgement = %#v", acknowledgement)
	}
	if current := runtime.nextPendingRequest(); current == nil || current.RequestID != second.RequestID {
		t.Fatalf("second pending request = %#v, want %q", current, second.RequestID)
	}
	input := externalNodeLaunchAcknowledgement{RequestID: second.RequestID, Accepted: true}
	acknowledgement := externalNodeLaunchAcknowledgement{RequestID: second.RequestID, Accepted: true, Message: "Node accepted the external launch request."}
	if got := runtime.acknowledge(input); got != acknowledgement {
		t.Fatalf("second acknowledgement = %#v, want %#v", got, acknowledgement)
	}
	if got := <-secondResponse; got != acknowledgement {
		t.Fatalf("queued response = %#v, want %#v", got, acknowledgement)
	}
	if current := runtime.nextPendingRequest(); current != nil {
		t.Fatalf("pending request after acknowledgements = %#v, want nil", current)
	}
}
