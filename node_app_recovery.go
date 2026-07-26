package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

const (
	nodeAppBackendRecoveryInterval = 3 * time.Second
	nodeAppBackendRecoveryFailures = 2
	nodeAppBackendRecoveryLimit    = 2
)

type NodeAppBackendRuntimeStatus struct {
	State               string                     `json:"state"`
	ConsecutiveFailures int                        `json:"consecutiveFailures"`
	RestartAttempts     int                        `json:"restartAttempts"`
	RecoveryExhausted   bool                       `json:"recoveryExhausted"`
	Message             string                     `json:"message,omitempty"`
	DataContract        *NodeAppDataContractStatus `json:"dataContract,omitempty"`
	BunVersion          string                     `json:"bunVersion,omitempty"`
	BunWarning          string                     `json:"bunWarning,omitempty"`
}

type nodeAppBackendRecovery struct {
	mu      sync.RWMutex
	health  func() error
	restart func() error
	notify  func(NodeAppBackendRuntimeStatus)
	status  NodeAppBackendRuntimeStatus
}

func newNodeAppBackendRecovery(health func() error, restart func() error, notify func(NodeAppBackendRuntimeStatus)) *nodeAppBackendRecovery {
	return &nodeAppBackendRecovery{
		health:  health,
		restart: restart,
		notify:  notify,
		status:  NodeAppBackendRuntimeStatus{State: "starting", Message: "Waiting for the bundled backend health check."},
	}
}

func startNodeAppBackendRecovery(service *XiraniteService, notify func(NodeAppBackendRuntimeStatus)) func() {
	recovery := newNodeAppBackendRecovery(
		func() error { return nodeAppBackendHealthError(service.InternalBackendConfig()) },
		func() error {
			result, err := service.RestartLocalBackend()
			if err != nil {
				return err
			}
			if !result.Restarted {
				return errors.New(result.Message)
			}
			return nil
		},
		notify,
	)
	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(nodeAppBackendRecoveryInterval)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
			}
			recovery.tick()
		}
	}()
	return func() { close(done) }
}

func (r *nodeAppBackendRecovery) tick() {
	if r.health() == nil {
		r.update(func(status *NodeAppBackendRuntimeStatus) {
			status.State = "ready"
			status.ConsecutiveFailures = 0
			status.Message = "Bundled backend is healthy."
		})
		return
	}

	r.mu.RLock()
	exhausted := r.status.RecoveryExhausted
	r.mu.RUnlock()
	if exhausted {
		return
	}

	r.update(func(status *NodeAppBackendRuntimeStatus) {
		status.ConsecutiveFailures++
		status.State = "degraded"
		status.Message = "Bundled backend health check failed."
	})

	status := r.Status()
	if status.ConsecutiveFailures < nodeAppBackendRecoveryFailures {
		return
	}
	if status.RestartAttempts >= nodeAppBackendRecoveryLimit {
		r.exhaust("Bundled backend recovery is exhausted.")
		return
	}

	r.update(func(next *NodeAppBackendRuntimeStatus) {
		next.RestartAttempts++
		next.ConsecutiveFailures = 0
		next.State = "recovering"
		next.Message = fmt.Sprintf("Restarting bundled backend (%d/%d).", next.RestartAttempts, nodeAppBackendRecoveryLimit)
	})
	status = r.Status()
	if err := r.restart(); err != nil {
		message := fmt.Sprintf("Bundled backend restart %d failed: %v", status.RestartAttempts, err)
		if status.RestartAttempts >= nodeAppBackendRecoveryLimit {
			r.exhaust(message)
			return
		}
		r.update(func(next *NodeAppBackendRuntimeStatus) {
			next.State = "degraded"
			next.Message = message
		})
		log.Print(message)
		return
	}
	log.Printf("Node app backend restart %d completed", status.RestartAttempts)
}

func (r *nodeAppBackendRecovery) exhaust(message string) {
	r.update(func(status *NodeAppBackendRuntimeStatus) {
		status.State = "exhausted"
		status.RecoveryExhausted = true
		status.Message = message
	})
	log.Printf("Node app backend recovery exhausted after %d restart attempts", r.Status().RestartAttempts)
}

func (r *nodeAppBackendRecovery) Status() NodeAppBackendRuntimeStatus {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.status
}

func (r *nodeAppBackendRecovery) update(update func(*NodeAppBackendRuntimeStatus)) {
	r.mu.Lock()
	update(&r.status)
	r.status.BunVersion = nodeAppRuntimeBunVersion
	r.status.BunWarning = nodeAppBunCompatibilityWarning
	status := r.status
	r.mu.Unlock()
	if r.notify != nil {
		r.notify(status)
	}
}

func nodeAppBackendHealthy(config *LocalBackendConfig) bool {
	return nodeAppBackendHealthError(config) == nil
}

func nodeAppBackendHealthError(config *LocalBackendConfig) error {
	if config == nil || config.BaseURL == "" {
		return errors.New("bundled backend is unavailable")
	}
	context, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(context, http.MethodGet, config.BaseURL+"/health", nil)
	if err != nil {
		return err
	}
	if config.Token != "" {
		request.Header.Set("x-xiranite-token", config.Token)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("bundled backend health returned %d", response.StatusCode)
	}
	var health struct {
		NodeID     string `json:"nodeId"`
		SnapshotID string `json:"snapshotId"`
	}
	if err := json.NewDecoder(response.Body).Decode(&health); err != nil {
		return fmt.Errorf("decode bundled backend health: %w", err)
	}
	if health.NodeID != nodeAppID || health.SnapshotID != nodeAppSnapshotID {
		return fmt.Errorf("bundled backend health belongs to %s/%s, expected %s/%s", health.NodeID, health.SnapshotID, nodeAppID, nodeAppSnapshotID)
	}

	capabilityRequest, err := http.NewRequestWithContext(context, http.MethodGet, config.BaseURL+"/node-app/capabilities", nil)
	if err != nil {
		return err
	}
	if config.Token != "" {
		capabilityRequest.Header.Set("x-xiranite-token", config.Token)
	}
	capabilityResponse, err := http.DefaultClient.Do(capabilityRequest)
	if err != nil {
		return fmt.Errorf("request bundled backend capabilities: %w", err)
	}
	defer capabilityResponse.Body.Close()
	if capabilityResponse.StatusCode != http.StatusOK {
		return fmt.Errorf("bundled backend capabilities returned %d", capabilityResponse.StatusCode)
	}
	var handshake struct {
		NodeID       string   `json:"nodeId"`
		SnapshotID   string   `json:"snapshotId"`
		Capabilities []string `json:"capabilities"`
	}
	if err := json.NewDecoder(capabilityResponse.Body).Decode(&handshake); err != nil {
		return fmt.Errorf("decode bundled backend capabilities: %w", err)
	}
	if handshake.NodeID != nodeAppID || handshake.SnapshotID != nodeAppSnapshotID {
		return fmt.Errorf("bundled backend capability handshake belongs to another snapshot")
	}
	available := make(map[string]bool, len(handshake.Capabilities))
	for _, capability := range handshake.Capabilities {
		available[capability] = true
	}
	for _, required := range []string{"health", "node-api", "state", "operations", "history"} {
		if !available[required] {
			return fmt.Errorf("bundled backend capability handshake is missing %s", required)
		}
	}
	return nil
}
