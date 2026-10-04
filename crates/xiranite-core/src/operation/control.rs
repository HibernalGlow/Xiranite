//! The per-run handle and ADR-0066's cooperative checkpoint.

use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;
use xiranite_plugin_api::{CheckpointDecision, CheckpointOutcome, OperationPhase};

use super::dto::NodeOperationRecord;
use super::state::OperationState;
use crate::support::TimestampMs;

/// The operation a handle names no longer exists — it finished and aged out of the
/// registry (`cleanupOperations`), or the id was never issued.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperationNotFound(pub String);

impl std::fmt::Display for OperationNotFound {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "node operation not found: {}", self.0)
    }
}

impl std::error::Error for OperationNotFound {}

/// Handle to one operation, held by whatever runs the plugin.
///
/// Cloning is cheap and safe: every method locks the shared state for the duration of
/// one decision, never across an await.
/// Clone is cheap; `Debug` prints the id and phase rather than requiring
/// `OperationState: Debug`, which holds channels and listeners that have nothing to print.
#[derive(Clone)]
pub struct OperationControl {
    operation_id: String,
    state: Arc<Mutex<OperationState>>,
}

impl std::fmt::Debug for OperationControl {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OperationControl")
            .field("operation_id", &self.operation_id)
            .field("phase", &self.phase())
            .finish()
    }
}

impl OperationControl {
    pub(crate) fn new(operation_id: String, state: Arc<Mutex<OperationState>>) -> Self {
        Self { operation_id, state }
    }

    /// The id `startOperation` issued; `xiranite.operation.*` calls carry it.
    #[must_use]
    pub fn operation_id(&self) -> &str {
        &self.operation_id
    }

    /// `getOperation()` for this handle.
    #[must_use]
    pub fn record(&self) -> NodeOperationRecord {
        self.state.lock().expect("operation state").record()
    }

    /// `state.cancelRequested`: the runner checks this between items, which is what
    /// makes cancel win even if the plugin returns successfully afterwards.
    #[must_use]
    pub fn cancel_requested(&self) -> bool {
        self.state.lock().expect("operation state").cancel_requested
    }

    /// The current phase, for diagnostics and for the runner's loop condition.
    #[must_use]
    pub fn phase(&self) -> OperationPhase {
        self.state.lock().expect("operation state").phase
    }

    /// `finishedAt` once terminal; the runner needs it to time the history row.
    #[must_use]
    pub fn finished_at(&self) -> Option<TimestampMs> {
        self.state.lock().expect("operation state").finished_at
    }

    /// ADR-0066: yield at an item boundary.
    ///
    /// `Running` continues, `Paused` parks this task until `resume`/`cancel` releases
    /// the waiter, and a cancel request or a terminal phase answers `Cancelled`. The
    /// mutex is released before parking — holding it across the await would deadlock
    /// against the HTTP route that has to take the same lock to resume.
    #[must_use]
    pub async fn checkpoint(&self) -> CheckpointDecision {
        loop {
            let waiter = {
                let mut state = self.state.lock().expect("operation state");
                match Self::outcome_for(&state) {
                    // Only a paused operation produces a waiter; anything else answers now.
                    CheckpointOutcome::Paused => {
                        let (sender, receiver) = oneshot::channel();
                        state.pause_waiters.push(sender);
                        Some(receiver)
                    }
                    _ => None,
                }
            };

            let Some(waiter) = waiter else {
                let state = self.state.lock().expect("operation state");
                return Self::decision_for(&state).into_decision();
            };

            // Woken by resume or cancel, or by the resolver being dropped when the
            // operation was removed from the registry: either way, re-read and decide.
            let _ = waiter.await;
        }
    }

    /// The outcome a checkpoint owes right now. Total by construction: a cancel
    /// request or a terminal phase stops the run, `paused` parks, anything else continues.
    fn outcome_for(state: &OperationState) -> CheckpointOutcome {
        if state.cancel_requested || state.phase.is_terminal() {
            return CheckpointOutcome::Cancelled;
        }
        match state.phase {
            OperationPhase::Paused => CheckpointOutcome::Paused,
            // `queued` never checkpoints in TypeScript — `executeOperation()` writes
            // `running` first — so reporting continue as `running` is the faithful
            // answer instead of a pair the ABI refuses outright.
            OperationPhase::Queued | OperationPhase::Running => CheckpointOutcome::Continue,
            _ => CheckpointOutcome::Cancelled,
        }
    }

    /// Phase and outcome as one value, built so the pair is always constructible.
    fn decision_for(state: &OperationState) -> PendingDecision {
        let reported_phase = if state.phase == OperationPhase::Queued {
            OperationPhase::Running
        } else {
            state.phase
        };
        PendingDecision { phase: reported_phase, outcome: Self::outcome_for(state) }
    }
}

/// A decision waiting for its guard: the phase is already clamped to one the outcome
/// is legal with, so building [`CheckpointDecision`] from it cannot fail.
#[derive(Debug, Clone, Copy)]
struct PendingDecision {
    phase: OperationPhase,
    outcome: CheckpointOutcome,
}

impl PendingDecision {
    fn into_decision(self) -> CheckpointDecision {
        CheckpointDecision::new(self.phase, self.outcome)
            .expect("a phase clamped to the outcome's legal set cannot contradict it")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use xiranite_plugin_api::EventRetentionCeiling;

    fn control() -> OperationControl {
        let state = OperationState::new(
            "op-1".to_owned(),
            "enginev".to_owned(),
            None,
            None,
            100,
            EventRetentionCeiling::try_new(10, 10_000).expect("test ceiling"),
        );
        OperationControl::new("op-1".to_owned(), Arc::new(Mutex::new(state)))
    }

    #[tokio::test]
    async fn a_running_checkpoint_answers_continue_without_parking() {
        let control = control();
        control.state.lock().expect("state").phase = OperationPhase::Running;
        let decision = control.checkpoint().await;
        assert_eq!(decision.outcome(), CheckpointOutcome::Continue);
        assert_eq!(decision.phase(), OperationPhase::Running);
    }

    #[tokio::test]
    async fn a_queued_checkpoint_reports_running_because_the_run_has_to_have_begun() {
        let decision = control().checkpoint().await;
        assert_eq!(decision.phase(), OperationPhase::Running);
        assert_eq!(decision.outcome(), CheckpointOutcome::Continue);
    }

    #[tokio::test]
    async fn a_cancelled_operation_checkpoints_as_cancelled() {
        let control = control();
        {
            let mut state = control.state.lock().expect("state");
            state.phase = OperationPhase::Running;
            state.cancel_requested = true;
        }
        assert_eq!(control.checkpoint().await.outcome(), CheckpointOutcome::Cancelled);
    }

    #[tokio::test]
    async fn a_paused_checkpoint_waits_for_resume_and_answers_continue() {
        let control = control();
        control.state.lock().expect("state").phase = OperationPhase::Paused;

        let runner = {
            let control = control.clone();
            tokio::spawn(async move { control.checkpoint().await })
        };
        // Give the task a chance to park, then release it the way the route does.
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        {
            let mut state = control.state.lock().expect("state");
            state.phase = OperationPhase::Running;
            state.release_pause_waiters();
        }

        assert_eq!(runner.await.expect("task").outcome(), CheckpointOutcome::Continue);
    }

    #[tokio::test]
    async fn cancel_while_paused_releases_the_waiter_with_cancelled() {
        let control = control();
        control.state.lock().expect("state").phase = OperationPhase::Paused;

        let runner = {
            let control = control.clone();
            tokio::spawn(async move { control.checkpoint().await })
        };
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        {
            let mut state = control.state.lock().expect("state");
            state.cancel_requested = true;
            state.release_pause_waiters();
        }

        assert_eq!(runner.await.expect("task").outcome(), CheckpointOutcome::Cancelled);
    }
}
