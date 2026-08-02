package desktop

import (
	"errors"
	"testing"
)

func TestNodeAppWindowCloseDecisionAllowsOnlyConfirmedIdleBackend(t *testing.T) {
	allowClose, prompt := nodeAppWindowCloseDecision(nil, nil)
	if !allowClose || prompt.QueryError != "" || prompt.ActiveTasks != 0 {
		t.Fatalf("idle decision = (%v, %#v), want close", allowClose, prompt)
	}

	allowClose, prompt = nodeAppWindowCloseDecision([]nodeAppOperation{{OperationID: "running"}}, nil)
	if allowClose || prompt.ActiveTasks != 1 || prompt.QueryError != "" {
		t.Fatalf("active decision = (%v, %#v), want active-task prompt", allowClose, prompt)
	}
}

func TestNodeAppWindowCloseDecisionFailsClosedWhenStatusCannotBeRead(t *testing.T) {
	allowClose, prompt := nodeAppWindowCloseDecision(nil, errors.New("connection refused"))
	if allowClose || prompt.QueryError == "" || prompt.ActiveTasks != 0 {
		t.Fatalf("unknown decision = (%v, %#v), want blocked close with query error", allowClose, prompt)
	}
}
