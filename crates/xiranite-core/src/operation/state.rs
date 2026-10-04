//! One operation's mutable state, and the transitions `packages/services` performs.
//!
//! The field list is `NodeOperationState`
//! (`packages/services/src/index.ts:567-589`) minus two entries that are Bun
//! concepts: `memory: NodeOperationMemoryGuard` (ADR-0063 deletes the JavaScript
//! heap guard; the replacement is the ceilings in [`RetainedEventBuffer`] plus the
//! Extism manifest memory limit, neither of which lives here) and `input: unknown`,
//! which the runner owns because the plugin reads it through the invocation
//! request, not through the operation record.
//!
//! Every method here is synchronous and never awaits, so the manager can hold the
//! enclosing `std::sync::MutexGuard` while it decides — the single `async`
//! transition in this module's vocabulary, the paused-checkpoint wait, lives in
//! [`super::control`] and releases the guard before it parks.

use tokio::sync::{mpsc, oneshot, watch};
use xiranite_plugin_api::EventRetentionCeiling;
use xiranite_plugin_api::OperationPhase;
use xiranite_plugin_api::run_events::EventIndex;

use super::dto::{
    NodeOperationRecord, NodeRunEventRecord, NodeRunResultRecord, OperationStreamMessage,
};
use super::retention::{RetainedEventBuffer, RetainedEventStats};
use crate::support::TimestampMs;

/// The stream endpoint a subscription receives frames on.
pub(crate) type StreamSender = mpsc::UnboundedSender<OperationStreamMessage>;

/// Mutable state of one node operation.
pub(crate) struct OperationState {
    pub operation_id: String,
    pub node_id: String,
    pub component_id: Option<String>,
    pub workspace_id: Option<String>,
    pub phase: OperationPhase,
    pub created_at: TimestampMs,
    pub updated_at: TimestampMs,
    pub started_at: Option<TimestampMs>,
    pub cancelled_at: Option<TimestampMs>,
    pub finished_at: Option<TimestampMs>,
    pub events: RetainedEventBuffer,
    /// `eventCount`: every event ever emitted, retained or dropped.
    pub event_count: u64,
    pub result: Option<NodeRunResultRecord>,
    /// `cancelRequested`, set by `cancelOperation()` before the terminal phase is
    /// written. A pending checkpoint reads this, not the phase, to decide whether
    /// to stop (`packages/services/src/index.ts:459`).
    pub cancel_requested: bool,
    /// The resolver side of `waitWhilePaused()`. TypeScript keeps one
    /// `resumePaused` callback (`packages/services/src/index.ts:588`) because a
    /// single plugin call owns the operation; a `Vec` holds the same ground for a
    /// host that checkpoints from more than one task.
    pub pause_waiters: Vec<oneshot::Sender<()>>,
    pub listeners: Vec<StreamSender>,
    pub completion: watch::Sender<Option<NodeRunResultRecord>>,
}

impl OperationState {
    /// A fresh `queued` operation, as `startOperation()` creates it
    /// (`packages/services/src/index.ts:243-273`).
    #[must_use]
    pub fn new(
        operation_id: String,
        node_id: String,
        component_id: Option<String>,
        workspace_id: Option<String>,
        now: TimestampMs,
        ceiling: EventRetentionCeiling,
    ) -> Self {
        let (completion, _receiver) = watch::channel(None);
        Self {
            operation_id,
            node_id,
            component_id,
            workspace_id,
            phase: OperationPhase::Queued,
            created_at: now,
            updated_at: now,
            started_at: None,
            cancelled_at: None,
            finished_at: None,
            events: RetainedEventBuffer::new(ceiling),
            event_count: 0,
            result: None,
            cancel_requested: false,
            pause_waiters: Vec::new(),
            listeners: Vec::new(),
            completion,
        }
    }

    /// The absolute index `subscribeOperation` starts replaying from: never older than
    /// the oldest event the retention ceiling kept, never past `eventCount`
    /// (`packages/services/src/index.ts:390-392`).
    #[must_use]
    pub fn first_replayed_index(&self, requested: Option<u64>) -> u64 {
        let first_retained = self.event_count.saturating_sub(self.events.stats().retained_events);
        self.event_count.min(first_retained.max(requested.unwrap_or(0)))
    }

    /// `toOperationDTO()` in `packages/services/src/index.ts:593-608`.
    #[must_use]
    pub fn record(&self) -> NodeOperationRecord {
        NodeOperationRecord {
            operation_id: self.operation_id.clone(),
            node_id: self.node_id.clone(),
            component_id: self.component_id.clone(),
            workspace_id: self.workspace_id.clone(),
            phase: self.phase,
            created_at: self.created_at,
            updated_at: self.updated_at,
            started_at: self.started_at,
            cancelled_at: self.cancelled_at,
            finished_at: self.finished_at,
            event_count: self.event_count,
            result: self.result.clone(),
        }
    }

    /// `isTerminalPhase()` in `packages/services/src/index.ts:610-612`.
    #[must_use]
    pub const fn is_terminal(&self) -> bool {
        self.phase.is_terminal()
    }

    /// `pushEvent()` in `packages/services/src/index.ts:491-499`.
    ///
    /// Returns `None` when the terminal guard refused the event, which is what the
    /// runner's `onEvent` callback hits once the operation has finished
    /// (`if (isTerminalPhase(state.phase)) return`).
    pub fn push_event(&mut self, event: NodeRunEventRecord, now: TimestampMs) -> Option<EventIndex> {
        if self.is_terminal() {
            return None;
        }
        let index = EventIndex::new(self.event_count);
        self.event_count = self.event_count.saturating_add(1);
        self.events.push(index, event.clone());
        self.updated_at = now;
        self.emit(OperationStreamMessage::Event { index, event });
        Some(index)
    }

    /// `emitOperation()` in `packages/services/src/index.ts:540-542`.
    pub fn emit_operation(&mut self) {
        let message = OperationStreamMessage::Operation {
            operation: self.record(),
        };
        self.emit(message);
    }

    /// `emit()` in `packages/services/src/index.ts:544-546`: a listener that has
    /// already gone away is dropped rather than failing the transition.
    pub fn emit(&mut self, message: OperationStreamMessage) {
        if self.listeners.is_empty() {
            return;
        }
        self.listeners.retain(|sender| sender.send(message.clone()).is_ok());
    }

    /// Releases every parked checkpoint: `state.resumePaused?.()` in `resumeOperation`,
    /// `cancelOperation` and `checkMemory`.
    pub fn release_pause_waiters(&mut self) {
        for waiter in self.pause_waiters.drain(..) {
            // A receiver that already went away means the checkpoint task was
            // dropped; nothing to release, and the operation state stays correct.
            let _ = waiter.send(());
        }
    }

    /// `finishOperation()` in `packages/services/src/index.ts:501-517`.
    ///
    /// Returns `false` when a terminal phase was already written, because
    /// TypeScript's guard makes the second call a no-op: `cancelOperation()` can
    /// land while the runner is returning, and the cancel must win.
    pub fn finish(
        &mut self,
        phase: OperationPhase,
        result: NodeRunResultRecord,
        now: TimestampMs,
    ) -> bool {
        if self.is_terminal() {
            return false;
        }
        debug_assert!(
            phase.is_terminal(),
            "finish() only writes a terminal phase"
        );
        self.phase = phase;
        self.result = Some(result.clone());
        self.finished_at = Some(now);
        self.updated_at = now;
        self.emit(OperationStreamMessage::Result {
            operation: self.record(),
            result: result.clone(),
        });
        // `state.listeners.clear()`: subscribers see the channel close after the
        // result frame, exactly as the SSE stream ends today.
        self.listeners.clear();
        self.completion.send_replace(Some(result));
        true
    }

    /// The receiver `waitForOperation()` awaits.
    #[must_use]
    pub fn completion_receiver(&self) -> watch::Receiver<Option<NodeRunResultRecord>> {
        self.completion.subscribe()
    }

    /// [`RetainedEventBuffer::stats`] for this operation.
    #[must_use]
    pub fn retention_stats(&self) -> RetainedEventStats {
        self.events.stats()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use xiranite_plugin_api::PluginRunEvent;

    fn ceiling() -> EventRetentionCeiling {
        EventRetentionCeiling::try_new(2, 1_000_000).expect("test ceiling")
    }

    fn state() -> OperationState {
        OperationState::new(
            "op-1".to_owned(),
            "enginev".to_owned(),
            None,
            Some("ws-1".to_owned()),
            100,
            ceiling(),
        )
    }

    fn log(message: &str) -> NodeRunEventRecord {
        NodeRunEventRecord::from_plugin_event(&PluginRunEvent::log_message(message))
    }

    #[test]
    fn a_new_operation_is_queued_with_no_counters_written() {
        let state = state();
        let record = state.record();
        assert_eq!(record.phase, OperationPhase::Queued);
        assert_eq!(record.created_at, 100);
        assert_eq!(record.updated_at, 100);
        assert_eq!(record.event_count, 0);
        assert_eq!(record.started_at, None);
        assert_eq!(record.result, None);
        assert_eq!(record.workspace_id.as_deref(), Some("ws-1"));
        assert_eq!(state.retention_stats().retained_events, 0);
    }

    #[test]
    fn push_event_assigns_absolute_indexes_and_updates_the_clock() {
        let mut state = state();
        assert_eq!(state.push_event(log("one"), 110), Some(EventIndex::new(0)));
        assert_eq!(state.push_event(log("two"), 120), Some(EventIndex::new(1)));
        assert_eq!(state.event_count, 2);
        assert_eq!(state.updated_at, 120);
        assert_eq!(state.retention_stats().dropped_events, 0);
    }

    #[test]
    fn a_terminal_operation_refuses_further_events_like_pushevent() {
        let mut state = state();
        state.finish(
            OperationPhase::Completed,
            NodeRunResultRecord {
                success: true,
                message: "done".to_owned(),
                data: None,
                stats: Default::default(),
                output_path: None,
            },
            150,
        );
        assert_eq!(state.push_event(log("late"), 160), None);
        assert_eq!(state.event_count, 0, "the refused event must not be counted");
        assert_eq!(state.updated_at, 150);
        assert!(
            !state.finish(
                OperationPhase::Cancelled,
                NodeRunResultRecord {
                    success: false,
                    message: "late cancel".to_owned(),
                    data: None,
                    stats: Default::default(),
                    output_path: None,
                },
                170,
            ),
            "finishOperation() is a no-op once terminal"
        );
        assert_eq!(state.record().phase, OperationPhase::Completed);
    }

    #[test]
    fn stream_listeners_receive_frames_and_are_cleared_at_the_result() {
        let mut state = state();
        let (sender, mut receiver) = mpsc::unbounded_channel();
        state.listeners.push(sender);

        state.push_event(log("progress line"), 130);
        state.emit_operation();
        state.finish(
            OperationPhase::Completed,
            NodeRunResultRecord {
                success: true,
                message: "done".to_owned(),
                data: None,
                stats: Default::default(),
                output_path: None,
            },
            140,
        );
        drop(state);

        let mut kinds = Vec::new();
        let mut messages = Vec::new();
        while let Ok(message) = receiver.try_recv() {
            match message {
                OperationStreamMessage::Event { index, .. } => {
                    kinds.push("event");
                    messages.push(index.get());
                }
                OperationStreamMessage::Operation { .. } => kinds.push("operation"),
                OperationStreamMessage::Result { .. } => kinds.push("result"),
            }
        }
        assert_eq!(kinds, vec!["event", "operation", "result"]);
        assert_eq!(messages, vec![0]);
    }

    #[test]
    fn releasing_pause_waiters_resolves_every_parked_checkpoint() {
        let mut state = state();
        let first = {
            let (tx, rx) = oneshot::channel();
            state.pause_waiters.push(tx);
            rx
        };
        let second = {
            let (tx, rx) = oneshot::channel();
            state.pause_waiters.push(tx);
            rx
        };
        state.release_pause_waiters();
        assert!(state.pause_waiters.is_empty());
        assert_eq!(first.blocking_recv(), Ok(()));
        assert_eq!(second.blocking_recv(), Ok(()));
        // `resumeOperation()` clears the resolver after calling it; a second release
        // has nothing left to wake.
        state.release_pause_waiters();
    }

    #[test]
    fn completion_is_visible_before_and_after_a_transition() {
        let mut state = state();
        let receiver = state.completion_receiver();
        assert_eq!(*receiver.borrow(), None);
        state.finish(
            OperationPhase::Cancelled,
            NodeRunResultRecord {
                success: false,
                message: "Node operation cancelled.".to_owned(),
                data: None,
                stats: Default::default(),
                output_path: None,
            },
            150,
        );
        assert_eq!(
            receiver.borrow().as_ref().map(|result| result.message.as_str()),
            Some("Node operation cancelled.")
        );
    }

    #[test]
    fn the_count_ceiling_applies_through_the_state_helper() {
        let mut state = state();
        for index in 0..5 {
            state.push_event(log(&format!("e{index}")), 200 + index);
        }
        assert_eq!(state.event_count, 5, "eventCount keeps counting past the ceiling");
        let stats = state.retention_stats();
        assert_eq!(stats.retained_events, 2);
        assert_eq!(stats.dropped_events, 3);
    }
}
