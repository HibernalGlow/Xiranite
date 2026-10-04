//! The operation registry: `NodeRunnerService`'s lifecycle half, in Rust.
//!
//! Every method mirrors a named TypeScript function in
//! `packages/services/src/index.ts` and keeps its guards, because the HTTP routes and
//! the React cards downstream already depend on those outcomes:
//!
//! | this | TypeScript |
//! | --- | --- |
//! | [`OperationManager::start`] | `startOperation` (`:243`) |
//! | [`OperationManager::mark_running`] | the `running` write inside `executeOperation` |
//! | [`OperationManager::get`] / [`OperationManager::list`] | `getOperation` (`:275`) / `listOperations` (`:280`) |
//! | [`OperationManager::events`] | `getOperationEvents` (`:292`) |
//! | [`OperationManager::pause`] / [`OperationManager::resume`] | `pauseOperation` (`:335`) / `resumeOperation` (`:346`) |
//! | [`OperationManager::cancel`] / [`OperationManager::finish`] | `cancelOperation` (`:322`) / `finishOperation` (`:501`) |
//! | [`OperationManager::cleanup`] | `cleanupOperations` (`:359`) |
//! | [`OperationManager::subscribe`] | `subscribeOperation` (`:378`) |
//!
//! Deliberately absent: the JavaScript heap guard (`NodeOperationMemoryGuard`), whose
//! replacement is the retained-event ceiling plus the Extism manifest memory limit, and
//! the history write, which belongs to the caller that owns the repository — a manager
//! that also persisted would split one operation's lifecycle across two owners.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tokio::sync::{mpsc, watch};
use xiranite_plugin_api::{EventRetentionCeiling, OperationPhase, run_events::EventIndex};

use super::control::{OperationControl, OperationNotFound};
use super::dto::{
    IndexedOperationEvent, NodeOperationRecord, NodeRunEventRecord, NodeRunResultRecord,
    OperationStreamMessage,
};
use super::retention::{RetainedEventStats, normalize_event_index, normalize_event_limit};
use super::state::OperationState;
use crate::support::{Clock, IdGenerator, ManualClock, SystemClock, TimestampMs};

/// `defaultOperationRetentionMs` (`packages/services/src/index.ts:221`).
pub const DEFAULT_OPERATION_RETENTION_MS: TimestampMs = 30 * 60 * 1000;
/// `listOperations` clamps its limit with `Math.max(1, Math.min(500, limit ?? 100))`.
const DEFAULT_LIST_LIMIT: u64 = 100;
const MAX_LIST_LIMIT: u64 = 500;
/// How many collisions `createUniqueOperationId` tolerates before switching to the
/// suffixed form, matching the retry loop the `Math.random()` suffix served.
const ID_COLLISION_ATTEMPTS: u64 = 64;

/// How long finished operations stay addressable, and how much of their event stream
/// the host keeps.
#[derive(Debug, Clone)]
pub struct OperationManagerOptions {
    /// The retained-event ceiling that replaces the JavaScript heap guard (ADR-0063).
    pub retention_ceiling: EventRetentionCeiling,
    /// `operationRetentionMs`: a terminal operation younger than this stays registered.
    pub operation_retention_ms: TimestampMs,
}

impl Default for OperationManagerOptions {
    fn default() -> Self {
        Self {
            retention_ceiling: EventRetentionCeiling::default(),
            operation_retention_ms: DEFAULT_OPERATION_RETENTION_MS,
        }
    }
}

/// Shared registry handle. Cloning is free; every clone sees one map.
#[derive(Clone)]
pub struct OperationManager {
    operations: Arc<Mutex<BTreeMap<String, Arc<Mutex<OperationState>>>>>,
    ids: Arc<IdGenerator>,
    clock: Arc<dyn Clock>,
    options: Arc<OperationManagerOptions>,
}

impl OperationManager {
    /// A manager on the system clock.
    #[must_use]
    pub fn new(options: OperationManagerOptions) -> Self {
        Self::with_clock(Arc::new(SystemClock), options)
    }

    /// A manager whose time a test drives. Ids come from the same clock, so a frozen
    /// clock plus the counter still produces distinct ids.
    #[must_use]
    pub fn with_clock(clock: Arc<dyn Clock>, options: OperationManagerOptions) -> Self {
        Self {
            operations: Arc::new(Mutex::new(BTreeMap::new())),
            ids: Arc::new(IdGenerator::new("op", Arc::clone(&clock))),
            clock,
            options: Arc::new(options),
        }
    }

    /// Convenience for tests that only need a frozen clock.
    #[must_use]
    pub fn with_manual_clock(clock: ManualClock, options: OperationManagerOptions) -> Self {
        Self::with_clock(Arc::new(clock), options)
    }

    /// Current time, so a caller can stamp a history row with the same instant the
    /// operation transitioned.
    #[must_use]
    pub fn now(&self) -> TimestampMs {
        self.clock.now_ms()
    }

    /// The ceiling this manager retains events under, for diagnostics and tests.
    #[must_use]
    pub fn retention_ceiling(&self) -> EventRetentionCeiling {
        self.options.retention_ceiling
    }

    /// `startOperation`: cleans the registry, mints an unused id and returns the handle
    /// for a `queued` operation. The caller owns execution — nothing here spawns a task,
    /// which keeps the Extism host in charge of the permit and the plugin call.
    #[must_use]
    pub fn start(
        &self,
        node_id: impl Into<String>,
        component_id: Option<String>,
        workspace_id: Option<String>,
    ) -> OperationControl {
        // startOperation() runs cleanupOperations() first; the counts are the routes answer with, not this call.
        let _ = self.cleanup(None, None);
        let now = self.now();
        let operation_id = self.create_unique_operation_id();
        let state = OperationState::new(
            operation_id.clone(),
            node_id.into(),
            component_id,
            workspace_id,
            now,
            self.options.retention_ceiling,
        );
        let shared = Arc::new(Mutex::new(state));
        self.operations
            .lock()
            .expect("operation registry")
            .insert(operation_id.clone(), Arc::clone(&shared));
        OperationControl::new(operation_id, shared)
    }

    /// The `running` write `executeOperation()` performs before the first plugin call,
    /// including the frame the monitor card needs to draw its first progress bar.
        pub fn mark_running(&self, operation_id: &str) -> Option<NodeOperationRecord> {
        let shared = self.find(operation_id)?;
        let mut state = shared.lock().expect("operation state");
        if state.is_terminal() {
            return Some(state.record());
        }
        let now = self.now();
        state.phase = OperationPhase::Running;
        state.started_at = Some(now);
        state.updated_at = now;
        let record = state.record();
        state.emit_operation();
        Some(record)
    }

    /// `getOperation`.
    #[must_use]
    pub fn get(&self, operation_id: &str) -> Option<NodeOperationRecord> {
        let shared = self.find(operation_id)?;
        let state = shared.lock().expect("operation state");
        Some(state.record())
    }

    /// `listOperations`: newest first, clamped limit, optional node and active filters.
    #[must_use]
    pub fn list(&self, filter: &OperationFilter) -> NodeOperationListResponse {
        let _unused = self.cleanup(None, None);
        let _ = _unused;
        let limit = usize::try_from(filter.limit.unwrap_or(DEFAULT_LIST_LIMIT).clamp(1, MAX_LIST_LIMIT))
            .unwrap_or(1);
        let mut records = self
            .records()
            .into_iter()
            .filter(|record| filter.node_id.as_deref().is_none_or(|node_id| record.node_id == node_id))
            .filter(|record| !filter.active_only || !record.phase.is_terminal())
            .collect::<Vec<_>>();
        // `right.createdAt - left.createdAt`; the id breaks ties so a frozen clock in a
        // test still gets a stable order.
        records.sort_by(|left, right| {
            right.created_at.cmp(&left.created_at).then_with(|| right.operation_id.cmp(&left.operation_id))
        });
        let operations = records.into_iter().take(limit).collect::<Vec<_>>();
        let total = operations.len();
        NodeOperationListResponse { operations, total }
    }

    /// `getOperationEvents`: absolute indexes, with a window that starts at the oldest
    /// event the ceiling has not dropped.
    #[must_use]
    pub fn events(
        &self,
        operation_id: &str,
        from_event_index: Option<u64>,
        limit: Option<u64>,
    ) -> Option<NodeOperationEventsResponse> {
        let shared = self.find(operation_id)?;
        let state = shared.lock().expect("operation state");
        let limit = normalize_event_limit(limit);
        let page = state.events.page(state.event_count, normalize_event_index(from_event_index), limit);
        let total = page.total;
        Some(NodeOperationEventsResponse {
            operation: state.record(),
            events: page.events,
            from: page.from,
            limit: page.limit,
            next: page.next,
            total,
        })
    }

    /// `pushEvent` for one operation. `None` when the operation is gone or already
    /// terminal, which is the runner's `if (isTerminalPhase(state.phase)) return` path.
        pub fn push_event(&self, operation_id: &str, event: NodeRunEventRecord) -> Option<EventIndex> {
        let shared = self.find(operation_id)?;
        let mut state = shared.lock().expect("operation state");
        state.push_event(event, self.now())
    }

    /// Emits a frame the runner produces outside the event buffer. False when the
    /// operation is gone or terminal.
    pub fn publish(&self, operation_id: &str, message: OperationStreamMessage) -> bool {
        let Some(shared) = self.find(operation_id) else { return false };
        let mut state = shared.lock().expect("operation state");
        if state.is_terminal() {
            return false
        }
        state.emit(message);
        true
    }

    /// `pauseOperation`: only a running operation pauses. Anything else answers with the
    /// unchanged record, which is what makes a double pause harmless.
        pub fn pause(&self, operation_id: &str) -> Option<NodeOperationRecord> {
        let shared = self.find(operation_id)?;
        let mut state = shared.lock().expect("operation state");
        if state.phase != OperationPhase::Running {
            return Some(state.record());
        }
        state.phase = OperationPhase::Paused;
        let now = self.now();
        state.updated_at = now;
        state.push_event(NodeRunEventRecord::log_line("Node operation paused."), now);
        let record = state.record();
        state.emit_operation();
        Some(record)
    }

    /// `resumeOperation`: writes `running`, releases every parked checkpoint, logs.
        pub fn resume(&self, operation_id: &str) -> Option<NodeOperationRecord> {
        let shared = self.find(operation_id)?;
        let mut state = shared.lock().expect("operation state");
        if state.phase != OperationPhase::Paused {
            return Some(state.record());
        }
        state.phase = OperationPhase::Running;
        let now = self.now();
        state.updated_at = now;
        state.release_pause_waiters();
        state.push_event(NodeRunEventRecord::log_line("Node operation resumed."), now);
        let record = state.record();
        state.emit_operation();
        Some(record)
    }

    /// `cancelOperation`: flags first, releases parked checkpoints, logs, then finishes
    /// `cancelled`. A later [`finish`](Self::finish) loses, which is how a cancel that
    /// lands while the plugin is returning still wins.
        pub fn cancel(&self, operation_id: &str, reason: &str) -> Option<NodeOperationRecord> {
        let shared = self.find(operation_id)?;
        let mut state = shared.lock().expect("operation state");
        if state.is_terminal() {
            return Some(state.record());
        }
        let now = self.now();
        state.cancelled_at = Some(now);
        state.cancel_requested = true;
        state.release_pause_waiters();
        state.push_event(NodeRunEventRecord::log_line(reason), now);
        state.finish(OperationPhase::Cancelled, NodeRunResultRecord::failed(reason), now);
        Some(state.record())
    }

    /// `finishOperation`. The transition itself is a no-op once the operation is
    /// terminal, so the record returned for a late call is the one cancel wrote.
        pub fn finish(
        &self,
        operation_id: &str,
        phase: OperationPhase,
        result: NodeRunResultRecord,
    ) -> Option<NodeOperationRecord> {
        debug_assert!(phase.is_terminal(), "finish() only writes a terminal phase");
        let shared = self.find(operation_id)?;
        let mut state = shared.lock().expect("operation state");
        state.finish(phase, result, self.now());
        Some(state.record())
    }

    /// Retention stats for one operation: the diagnostics that replaced the heap guard.
    #[must_use]
    pub fn retention_stats(&self, operation_id: &str) -> Option<RetainedEventStats> {
        let shared = self.find(operation_id)?;
        let state = shared.lock().expect("operation state");
        Some(state.retention_stats())
    }

    /// `cleanupOperations`: forgets terminal operations past the window and reports both
    /// counts. `max_age_ms`/`now` are parameters so a test can age records without
    /// sleeping.
        pub fn cleanup(&self, max_age_ms: Option<TimestampMs>, now: Option<TimestampMs>) -> NodeOperationCleanupResponse {
        let max_age = max_age_ms.unwrap_or(self.options.operation_retention_ms);
        let cutoff = now.unwrap_or_else(|| self.now());
        let mut registry = self.operations.lock().expect("operation registry");
        let stale = registry
            .iter()
            .filter_map(|(operation_id, shared)| {
                let state = shared.lock().expect("operation state");
                let reference = state.finished_at.unwrap_or(state.updated_at)
                    .saturating_add(max_age);
                (state.is_terminal() && cutoff >= reference).then(|| operation_id.clone())
            })
            .collect::<Vec<_>>();
        let removed_count = u64::try_from(stale.len()).unwrap_or(u64::MAX);
        for operation_id in stale {
            registry.remove(&operation_id);
        }
        NodeOperationCleanupResponse {
            removed_count,
            remaining_count: u64::try_from(registry.len()).unwrap_or(u64::MAX),
        }
    }

    /// `subscribeOperation`: snapshot, replay of the retained events, then live frames.
    /// A terminal operation is answered in full and never registered as a listener, the
    /// same way the TypeScript returns a no-op unsubscribe.
    pub fn subscribe(
        &self,
        operation_id: &str,
        options: &SubscribeOptions,
    ) -> Result<OperationSubscription, OperationNotFound> {
        let shared = self
            .find(operation_id)
            .ok_or_else(|| OperationNotFound(operation_id.to_owned()))?;
        let (sender, receiver) = mpsc::unbounded_channel();
        let mut state = shared.lock().expect("operation state");

        if options.include_snapshot {
            let _ = sender.send(OperationStreamMessage::Operation { operation: state.record() });
        }
        let from = state.first_replayed_index(options.from_event_index);
        for item in state.events.retained() {
            if item.index.get() < from {
                continue;
            }
            let _ = sender.send(OperationStreamMessage::Event { index: item.index, event: item.event });
        }
        if state.is_terminal() {
            if let Some(result) = state.result.clone() {
                let _ = sender.send(OperationStreamMessage::Result { operation: state.record(), result });
            }
            return Ok(OperationSubscription { receiver })
        }
        state.listeners.push(sender);
        Ok(OperationSubscription { receiver })
    }

    /// `waitForOperation`: resolves once the operation reaches a terminal phase.
    #[must_use]
    pub fn completion_watcher(&self, operation_id: &str) -> Option<watch::Receiver<Option<NodeRunResultRecord>>> {
        let shared = self.find(operation_id)?;
        let state = shared.lock().expect("operation state");
        Some(state.completion_receiver())
    }

    /// The handle for a stored operation, e.g. for a route that found it by id.
    #[must_use]
    pub fn control(&self, operation_id: &str) -> Option<OperationControl> {
        Some(OperationControl::new(operation_id.to_owned(), self.find(operation_id)?))
    }

    /// Operations currently registered.
    #[must_use]
    pub fn len(&self) -> usize {
        self.operations.lock().expect("operation registry").len()
    }

    /// False while any operation is registered.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn find(&self, operation_id: &str) -> Option<Arc<Mutex<OperationState>>> {
        self.operations.lock().expect("operation registry").get(operation_id).cloned()
    }

    fn records(&self) -> Vec<NodeOperationRecord> {
        self.operations
            .lock()
            .expect("operation registry")
            .values()
            .map(|shared| shared.lock().expect("operation state").record())
            .collect()
    }

    /// `createUniqueOperationId`: the counter separates ids inside a process, and a
    /// collision — a restarted host over the same database — falls back to a numbered
    /// suffix rather than overwriting a live operation.
    fn create_unique_operation_id(&self) -> String {
        let registry = self.operations.lock().expect("operation registry");
        let mut candidate = self.ids.next();
        let mut attempt = 0_u64;
        while registry.contains_key(&candidate) && attempt < ID_COLLISION_ATTEMPTS {
            attempt += 1;
            candidate = self.ids.next_with_suffix(&format!("retry{attempt}"));
        }
        candidate
    }
}

impl std::fmt::Debug for OperationManager {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OperationManager")
            .field("operations", &self.len())
            .field("retention_ceiling", &self.options.retention_ceiling)
            .field("operation_retention_ms", &self.options.operation_retention_ms)
            .finish()
    }
}

/// `listOperations`' filter argument.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OperationFilter {
    /// `nodeId`.
    pub node_id: Option<String>,
    /// `activeOnly`: drop terminal operations.
    pub active_only: bool,
    /// `limit`, clamped to `1..=500` like the TypeScript.
    pub limit: Option<u64>,
}

/// `nodeOperationListResponseDTO`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeOperationListResponse {
    /// The page.
    pub operations: Vec<NodeOperationRecord>,
    /// `total`: the page size, which is what the list header shows today.
    pub total: usize,
}

/// `nodeOperationEventsResponseDTO`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeOperationEventsResponse {
    /// The operation the page belongs to.
    pub operation: NodeOperationRecord,
    /// Retained events inside the window.
    pub events: Vec<IndexedOperationEvent>,
    /// `from`: the absolute index the page actually starts at, after the retention clamp.
    pub from: u64,
    /// `limit`: the normalised page size.
    pub limit: u64,
    /// `next`: the index to continue from, absent at the end.
    pub next: Option<u64>,
    /// `total`: every event ever emitted, retained or dropped.
    pub total: u64,
}

/// `nodeOperationCleanupResponseDTO`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeOperationCleanupResponse {
    /// `removedCount`.
    pub removed_count: u64,
    /// `remainingCount`.
    pub remaining_count: u64,
}

/// Options for [`OperationManager::subscribe`].
#[derive(Debug, Clone, Copy)]
pub struct SubscribeOptions {
    /// Absolute index to replay from.
    pub from_event_index: Option<u64>,
    /// `includeSnapshot`, which the TypeScript defaults to true.
    pub include_snapshot: bool,
}

impl Default for SubscribeOptions {
    fn default() -> Self {
        Self { from_event_index: None, include_snapshot: true }
    }
}

/// The stream half of a subscription. Dropping it detaches the listener, because
/// `emit()` prunes a sender whose receiver is gone — the same rule the TypeScript
/// `Set` depends on when a socket closes.
#[derive(Debug)]
pub struct OperationSubscription {
    receiver: mpsc::UnboundedReceiver<OperationStreamMessage>,
}

impl OperationSubscription {
    /// The next frame, or `None` once the operation finished and the channel drained.
    pub async fn next(&mut self) -> Option<OperationStreamMessage> {
        self.receiver.recv().await
    }

    /// Non-blocking read, for draining everything a synchronous test has produced.
    pub fn try_next(&mut self) -> Option<OperationStreamMessage> {
        self.receiver.try_recv().ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use xiranite_plugin_api::PluginRunEvent;

    fn manager() -> OperationManager {
        OperationManager::with_manual_clock(
            ManualClock::new(1_000),
            OperationManagerOptions {
                retention_ceiling: EventRetentionCeiling::try_new(3, 100_000).expect("test ceiling"),
                operation_retention_ms: 50,
            },
        )
    }

    fn log(message: &str) -> NodeRunEventRecord {
        NodeRunEventRecord::from_plugin_event(&PluginRunEvent::log_message(message))
    }

    fn drain(mut subscription: OperationSubscription) -> Vec<OperationStreamMessage> {
        let mut frames = Vec::new();
        while let Some(frame) = subscription.try_next() {
            frames.push(frame);
        }
        frames
    }

    fn kinds(frames: &[OperationStreamMessage]) -> Vec<&'static str> {
        frames
            .iter()
            .map(|message| match message {
                OperationStreamMessage::Operation { .. } => "operation",
                OperationStreamMessage::Event { .. } => "event",
                OperationStreamMessage::Result { .. } => "result",
            })
            .collect()
    }

    #[test]
    fn start_registers_a_queued_operation_and_returns_its_record() {
        let manager = manager();
        let control = manager.start("enginev", None, Some("ws-1".to_owned()));
        let record = manager.get(control.operation_id()).expect("started");
        assert_eq!(record.phase, OperationPhase::Queued);
        assert_eq!(record.node_id, "enginev");
        assert_eq!(record.workspace_id.as_deref(), Some("ws-1"));
        assert_eq!(record.event_count, 0);
        assert_eq!(record.started_at, None);
        assert_eq!(manager.len(), 1);
    }

    #[test]
    fn mark_running_stamps_started_at_and_emits_the_operation_frame() {
        let manager = manager();
        let control = manager.start("bitv", None, None);
        let subscription = manager.subscribe(control.operation_id(), &SubscribeOptions::default()).expect("subscribed");

        let record = manager.mark_running(control.operation_id()).expect("running");
        assert_eq!(record.phase, OperationPhase::Running);
        assert_eq!(record.started_at, Some(1_000));

        let frames = drain(subscription);
        assert_eq!(kinds(&frames), vec!["operation", "operation"]);
        let phases = frames
            .iter()
            .map(|message| match message {
                OperationStreamMessage::Operation { operation } => operation.phase,
                other => panic!("unexpected frame: {other:?}"),
            })
            .collect::<Vec<_>>();
        assert_eq!(phases, vec![OperationPhase::Queued, OperationPhase::Running]);
    }

    #[test]
    fn a_terminal_operation_stays_running_and_keeps_its_result() {
        let manager = manager();
        let control = manager.start("bitv", None, None);
        let id = control.operation_id().to_owned();
        manager.cancel(&id, "stop");
        let record = manager.mark_running(&id).expect("already terminal");
        assert_eq!(record.phase, OperationPhase::Cancelled);
        assert_eq!(record.started_at, None, "a finished run never gains a start time");
    }

    #[test]
    fn events_page_from_the_oldest_retained_event_after_the_ceiling_drops_older_ones() {
        let manager = manager();
        let control = manager.start("bitv", None, None);
        let id = control.operation_id().to_owned();
        for index in 0..5 {
            manager.push_event(&id, log(&format!("e{index}")));
        }

        let page = manager.events(&id, Some(0), Some(10)).expect("events");
        assert_eq!(page.total, 5, "eventCount keeps counting past the ceiling");
        assert_eq!(page.from, 2, "the ceiling already dropped the first two events");
        assert_eq!(
            page.events.iter().map(|item| item.index.get()).collect::<Vec<_>>(),
            vec![2, 3, 4]
        );
        assert_eq!(page.next, None, "nothing is left past the retained window");

        let windowed = manager.events(&id, Some(3), Some(1)).expect("second page");
        assert_eq!(windowed.events.len(), 1);
        assert_eq!(windowed.limit, 1);
        assert_eq!(windowed.next, Some(4));
    }

    #[test]
    fn pause_and_resume_only_move_the_phases_they_are_guarded_on() {
        let manager = manager();
        let control = manager.start("bitv", None, None);
        let id = control.operation_id().to_owned();

        assert_eq!(manager.pause(&id).expect("queued").phase, OperationPhase::Queued);
        manager.mark_running(&id);
        assert_eq!(manager.pause(&id).expect("paused").phase, OperationPhase::Paused);
        assert_eq!(manager.pause(&id).expect("still paused").phase, OperationPhase::Paused);
        assert_eq!(manager.resume(&id).expect("resumed").phase, OperationPhase::Running);
        assert_eq!(manager.resume(&id).expect("still running").phase, OperationPhase::Running);

        let messages = manager
            .events(&id, None, None)
            .expect("events")
            .events
            .iter()
            .map(|item| item.event.message.clone())
            .collect::<Vec<_>>();
        assert_eq!(
            messages,
            vec!["Node operation paused.", "Node operation resumed."],
            "pauseOperation/resumeOperation each log exactly one transition line"
        );
    }

    #[test]
    fn cancel_wins_over_the_result_the_runner_reports_afterwards() {
        let manager = manager();
        let control = manager.start("bitv", None, None);
        let id = control.operation_id().to_owned();
        manager.mark_running(&id);

        let cancelled = manager.cancel(&id, "Node operation cancelled.").expect("cancelled");
        assert_eq!(cancelled.phase, OperationPhase::Cancelled);
        assert_eq!(cancelled.cancelled_at, Some(1_000));
        assert!(control.cancel_requested());

        manager.finish(&id, OperationPhase::Completed, NodeRunResultRecord::succeeded("late"));
        let after = manager.get(&id).expect("record");
        assert_eq!(after.phase, OperationPhase::Cancelled, "finishOperation() is a no-op once terminal");
        assert_eq!(after.result.expect("result").message, "Node operation cancelled.");
    }

    #[test]
    fn cleanup_only_forgets_terminal_operations_past_the_window() {
        let manager = manager();
        let control = manager.start("bitv", None, None);
        let id = control.operation_id().to_owned();
        manager.mark_running(&id);

        assert_eq!(manager.cleanup(Some(50), Some(10_000)).removed_count, 0, "running is never collected");
        manager.cancel(&id, "stop");
        assert_eq!(manager.cleanup(Some(50), Some(1_010)).removed_count, 0, "terminal but still inside the window");

        let report = manager.cleanup(Some(50), Some(2_000));
        assert_eq!(report, NodeOperationCleanupResponse { removed_count: 1, remaining_count: 0 });
        assert!(manager.get(&id).is_none());
        assert!(manager.subscribe(&id, &SubscribeOptions::default()).is_err(), "a collected operation is gone for good");
    }

    #[test]
    fn list_is_newest_first_and_honours_the_node_active_and_limit_filters() {
        let clock = ManualClock::new(1_000);
        let manager = OperationManager::with_manual_clock(
            clock.clone(),
            OperationManagerOptions {
                retention_ceiling: EventRetentionCeiling::try_new(10, 100_000).expect("ceiling"),
                operation_retention_ms: 10_000,
            },
        );
        let first = manager.start("bitv", None, None);
        clock.advance(10);
        let second = manager.start("bitv", None, None);
        clock.advance(10);
        let third = manager.start("snf", None, None);
        manager.mark_running(third.operation_id());
        manager.cancel(third.operation_id(), "stop");

        let all = manager.list(&OperationFilter::default());
        assert_eq!(
            all.operations.iter().map(|record| record.operation_id.as_str()).collect::<Vec<_>>(),
            vec![
                third.operation_id().to_owned(),
                second.operation_id().to_owned(),
                first.operation_id().to_owned()
            ],
            "createdAt descending, like the TypeScript sort"
        );
        assert_eq!(manager.list(&OperationFilter { node_id: Some("bitv".to_owned()), ..Default::default() }).total, 2);
        assert_eq!(manager.list(&OperationFilter { active_only: true, ..Default::default() }).total, 2);
        assert_eq!(
            manager.list(&OperationFilter { limit: Some(0), ..Default::default() }).total,
            1,
            "limit clamps up to one rather than down to nothing"
        );
    }

    #[test]
    fn subscribe_replays_retained_events_then_live_frames_and_ends_at_the_result() {
        let manager = manager();
        let control = manager.start("bitv", None, None);
        let id = control.operation_id().to_owned();
        manager.push_event(&id, log("one"));
        manager.push_event(&id, log("two"));

        let subscription = manager.subscribe(&id, &SubscribeOptions::default()).expect("subscribed");
        manager.push_event(&id, log("three"));
        manager.finish(&id, OperationPhase::Completed, NodeRunResultRecord::succeeded("done"));
        drop(control);

        let frames = drain(subscription);
        assert_eq!(kinds(&frames), vec!["operation", "event", "event", "event", "result"]);
        let indexes = frames
            .iter()
            .filter_map(|message| match message {
                OperationStreamMessage::Event { index, .. } => Some(index.get()),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(indexes, vec![0, 1, 2]);
    }

    #[test]
    fn subscribe_without_a_snapshot_starts_at_the_requested_index() {
        let manager = manager();
        let control = manager.start("bitv", None, None);
        let id = control.operation_id().to_owned();
        for index in 0..3 {
            manager.push_event(&id, log(&format!("e{index}")));
        }

        let subscription = manager
            .subscribe(&id, &SubscribeOptions { from_event_index: Some(1), include_snapshot: false })
            .expect("subscribed");
        let frames = drain(subscription);
        assert_eq!(kinds(&frames), vec!["event", "event"]);
    }

    #[test]
    fn subscribing_an_unknown_operation_reports_the_id() {
        let manager = manager();
        let error = manager
            .subscribe("op-missing", &SubscribeOptions::default())
            .expect_err("unknown id");
        assert_eq!(error, OperationNotFound("op-missing".to_owned()));
        assert!(error.to_string().contains("op-missing"));
    }

    #[test]
    fn ids_stay_unique_and_a_colliding_id_falls_back_to_the_suffixed_form() {
        let manager = manager();
        let mut seen = Vec::new();
        for _ in 0..5 {
            seen.push(manager.start("bitv", None, None).operation_id().to_owned());
        }
        assert_eq!(seen.iter().collect::<std::collections::BTreeSet<_>>().len(), 5, "{seen:?}");

        let taken = manager.ids.next();
        manager.operations.lock().expect("registry").insert(
            taken.clone(),
            Arc::new(Mutex::new(OperationState::new(
                taken.clone(),
                "bitv".to_owned(),
                None,
                None,
                1,
                EventRetentionCeiling::default(),
            ))),
        );
        // The next generated id collides with `taken`, so the manager must keep looking
        // instead of overwriting the live operation.
        let control = manager.start("bitv", None, None);
        assert_ne!(control.operation_id(), taken);
        assert_eq!(manager.get(&taken).expect("still there").node_id, "bitv");
    }

    #[tokio::test]
    async fn completion_watcher_reports_the_terminal_result() {
        let manager = manager();
        let control = manager.start("bitv", None, None);
        let id = control.operation_id().to_owned();
        let mut watcher = manager.completion_watcher(&id).expect("watcher");
        assert!(watcher.borrow().is_none());
        manager.finish(&id, OperationPhase::Completed, NodeRunResultRecord::succeeded("done"));
        watcher.changed().await.expect("closed on finish");
        assert_eq!(watcher.borrow().as_ref().map(|result| result.message.as_str()), Some("done"));
    }

    #[test]
    fn push_event_is_refused_once_the_operation_is_terminal() {
        let manager = manager();
        let control = manager.start("bitv", None, None);
        let id = control.operation_id().to_owned();
        assert_eq!(manager.push_event(&id, log("before")), Some(EventIndex::new(0)));
        manager.cancel(&id, "stop");
        assert_eq!(manager.push_event(&id, log("after")), None);
        let total = manager.events(&id, None, None).expect("events").total;
        assert_eq!(total, 2, "the event before the cancel counts, the one after it must not");
    }
}
