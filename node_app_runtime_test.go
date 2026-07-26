package main

import (
	"errors"
	"testing"
)

func TestIsBunVersionAtLeast(t *testing.T) {
	for _, test := range []struct {
		actual  string
		minimum string
		want    bool
	}{
		{actual: "1.4.0-canary.1", minimum: "1.3.0", want: true},
		{actual: "1.3.0", minimum: "1.3.0", want: true},
		{actual: "1.2.9", minimum: "1.3.0", want: false},
		{actual: "invalid", minimum: "1.3.0", want: false},
	} {
		if got := isBunVersionAtLeast(test.actual, test.minimum); got != test.want {
			t.Fatalf("isBunVersionAtLeast(%q, %q) = %v, want %v", test.actual, test.minimum, got, test.want)
		}
	}
}

func TestCompareBunVersions(t *testing.T) {
	if got := compareBunVersions("1.4.0", "1.3.0"); got != 1 {
		t.Fatalf("compare newer Bun = %d, want 1", got)
	}
	if got := compareBunVersions("1.3.0", "1.3.0"); got != 0 {
		t.Fatalf("compare equal Bun = %d, want 0", got)
	}
	if got := compareBunVersions("1.2.9", "1.3.0"); got != -1 {
		t.Fatalf("compare older Bun = %d, want -1", got)
	}
}

func TestNodeAppBackendRecoveryStopsAfterTwoFailedRestarts(t *testing.T) {
	restartAttempts := 0
	var statuses []NodeAppBackendRuntimeStatus
	recovery := newNodeAppBackendRecovery(
		func() error { return errors.New("backend is down") },
		func() error {
			restartAttempts++
			return errors.New("restart failed")
		},
		func(status NodeAppBackendRuntimeStatus) { statuses = append(statuses, status) },
	)

	for range 6 {
		recovery.tick()
	}

	status := recovery.Status()
	if restartAttempts != nodeAppBackendRecoveryLimit {
		t.Fatalf("restart attempts = %d, want %d", restartAttempts, nodeAppBackendRecoveryLimit)
	}
	if !status.RecoveryExhausted || status.State != "exhausted" {
		t.Fatalf("status = %#v, want exhausted recovery state", status)
	}
	if len(statuses) == 0 || !statuses[len(statuses)-1].RecoveryExhausted {
		t.Fatalf("last status = %#v, want an exhausted status notification", statuses)
	}

	recovery.tick()
	if restartAttempts != nodeAppBackendRecoveryLimit {
		t.Fatalf("restart attempts after exhaustion = %d, want %d", restartAttempts, nodeAppBackendRecoveryLimit)
	}
}

func TestNodeAppBackendRecoveryReturnsReadyAfterHealthCheck(t *testing.T) {
	restarts := 0
	recovery := newNodeAppBackendRecovery(
		func() error { return nil },
		func() error {
			restarts++
			return nil
		},
		nil,
	)

	recovery.tick()
	status := recovery.Status()
	if status.State != "ready" || status.ConsecutiveFailures != 0 || status.RestartAttempts != 0 {
		t.Fatalf("status = %#v, want ready without restarts", status)
	}
	if restarts != 0 {
		t.Fatalf("restarts = %d, want 0", restarts)
	}
}
