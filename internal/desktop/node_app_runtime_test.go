package desktop

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestNodeAppBackendHealthErrorUsesHostSpecificIdentityExpectation(t *testing.T) {
	expected := nodeAppBackendExpectation{NodeID: "neoview", SnapshotID: externalNodeLaunchHostSnapshotID}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("content-type", "application/json")
		switch request.URL.Path {
		case "/health":
			_, _ = fmt.Fprintf(writer, `{"nodeId":%q,"snapshotId":%q}`, expected.NodeID, expected.SnapshotID)
		case "/node-app/capabilities":
			_, _ = fmt.Fprintf(writer, `{"nodeId":%q,"snapshotId":%q,"capabilities":["health","node-api","state","operations","history","config","appearance","persistent-file-operations"]}`, expected.NodeID, expected.SnapshotID)
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	config := &LocalBackendConfig{BaseURL: server.URL}
	if err := nodeAppBackendHealthError(config, expected); err != nil {
		t.Fatalf("host-specific identity health check failed: %v", err)
	}
	if nodeAppBackendHealthy(config, nodeAppBackendExpectation{NodeID: "neoview", SnapshotID: "wrong-snapshot"}) {
		t.Fatal("health check accepted a backend that belongs to a different host snapshot")
	}
}

func TestNodeAppBackendHealthRejectsNonPersistentFileOperations(t *testing.T) {
	expected := nodeAppBackendExpectation{NodeID: "neoview", SnapshotID: externalNodeLaunchHostSnapshotID}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("content-type", "application/json")
		switch request.URL.Path {
		case "/health":
			_, _ = fmt.Fprintf(writer, `{"nodeId":%q,"snapshotId":%q}`, expected.NodeID, expected.SnapshotID)
		case "/node-app/capabilities":
			_, _ = fmt.Fprintf(writer, `{"nodeId":%q,"snapshotId":%q,"capabilities":["health","node-api","state","operations","history","config","appearance"]}`, expected.NodeID, expected.SnapshotID)
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	err := nodeAppBackendHealthError(&LocalBackendConfig{BaseURL: server.URL}, expected)
	if err == nil || !strings.Contains(err.Error(), "persistent-file-operations") {
		t.Fatalf("health error = %v, want missing persistent-file-operations capability", err)
	}
}
