//! The checkpoint outcome and its consistency rule.
//!
//! ADR-0066 replaces runtime-level suspension with one host function:
//! `xiranite.operation.checkpoint()` is a yield and a reporting point. If the owning
//! operation is paused, the host *waits inside the call* until resume or cancel;
//! if the operation is cancelled, it returns a status the plugin must treat as a
//! hard stop. Pause therefore stays cooperative waiting on an item boundary, the
//! same property `waitWhilePaused()` has today, and it is explicitly not a
//! "resumable mid-file" transaction boundary.

use std::fmt;

use crate::abi_code::AbiCode;
use crate::abi_code::UnknownAbiCode;
use crate::operation_status::OperationPhase;

/// What a checkpoint call answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum CheckpointOutcome {
    /// Keep processing the next item.
    Continue,
    /// The operation is paused right now, reported without holding the call.
    ///
    /// The blocking chain in ADR-0066 never returns this variant: a paused
    /// operation releases its waiting checkpoint as [`Self::Continue`] or
    /// [`Self::Cancelled`]. It exists because the four-state machine ADR-0066
    /// names is otherwise unrepresentable on this side of the boundary, and
    /// whether any host function ever returns it is an open point.
    Paused,
    /// Stop without starting another item.
    Cancelled,
}

impl CheckpointOutcome {
    /// Every outcome in wire order.
    pub const ALL: &'static [Self] = &[Self::Continue, Self::Paused, Self::Cancelled];

    /// Whether the plugin must stop working immediately.
    pub const fn is_hard_stop(self) -> bool {
        matches!(self, Self::Cancelled)
    }

    /// Stable name for plugin-side logs and audits.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Continue => "continue",
            Self::Paused => "paused",
            Self::Cancelled => "cancelled",
        }
    }
}

impl AbiCode for CheckpointOutcome {
    fn abi_code(self) -> u8 {
        match self {
            Self::Continue => 1,
            Self::Paused => 2,
            Self::Cancelled => 3,
        }
    }

    fn try_from_abi_code(code: u8) -> Result<Self, UnknownAbiCode> {
        match code {
            1 => Ok(Self::Continue),
            2 => Ok(Self::Paused),
            3 => Ok(Self::Cancelled),
            other => Err(UnknownAbiCode::new(other)),
        }
    }
}

impl fmt::Display for CheckpointOutcome {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// A phase and the checkpoint answer the host gave for it.
///
/// Only constructible through [`Self::new`], because an answer that disagrees
/// with the operation's phase is a bug with product-visible consequences: a
/// `Continue` after cancellation keeps a cancelled plugin writing files, and a
/// `Paused` for a running operation means a checkpoint reported a wait that never
/// happened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CheckpointDecision {
    phase: OperationPhase,
    outcome: CheckpointOutcome,
}

impl CheckpointDecision {
    /// Pairs an observed phase with an answer, rejecting the contradictory pairs.
    pub const fn new(
        phase: OperationPhase,
        outcome: CheckpointOutcome,
    ) -> Result<Self, CheckpointContradiction> {
        match (phase, outcome) {
            (OperationPhase::Queued, _) => Err(CheckpointContradiction::OperationHasNotStarted),
            (OperationPhase::Running, CheckpointOutcome::Paused) => {
                Err(CheckpointContradiction::PauseReportedWhileRunning)
            }
            (OperationPhase::Completed | OperationPhase::Error | OperationPhase::Cancelled, CheckpointOutcome::Continue) => {
                Err(CheckpointContradiction::ContinueAfterTerminalPhase { phase })
            }
            (OperationPhase::Completed | OperationPhase::Error | OperationPhase::Cancelled, CheckpointOutcome::Paused) => {
                Err(CheckpointContradiction::PauseAfterTerminalPhase { phase })
            }
            (phase, outcome) => Ok(Self { phase, outcome }),
        }
    }

    /// The operation phase the answer was produced for.
    pub const fn phase(self) -> OperationPhase {
        self.phase
    }

    /// The answer the plugin received.
    pub const fn outcome(self) -> CheckpointOutcome {
        self.outcome
    }

    /// True when this decision released a checkpoint that was held by a pause,
    /// which is the resume and cancel path of ADR-0066's chain.
    pub const fn released_a_waiting_checkpoint(self) -> bool {
        matches!(self.phase, OperationPhase::Paused)
            && !matches!(self.outcome, CheckpointOutcome::Paused)
    }

    /// Whether the plugin must stop.
    pub const fn is_hard_stop(self) -> bool {
        self.outcome.is_hard_stop()
    }
}

/// A checkpoint answer that cannot follow from the operation's phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckpointContradiction {
    /// The operation never started, so no plugin call could checkpoint.
    OperationHasNotStarted,
    /// A running operation reported a pause it is not waiting in.
    PauseReportedWhileRunning,
    /// A terminal operation would have kept a plugin working after it ended.
    ContinueAfterTerminalPhase {
        /// The terminal phase that was paired with `Continue`.
        phase: OperationPhase,
    },
    /// A terminal operation reported a pause.
    PauseAfterTerminalPhase {
        /// The terminal phase that was paired with `Paused`.
        phase: OperationPhase,
    },
}

impl fmt::Display for CheckpointContradiction {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::OperationHasNotStarted => {
                formatter.write_str("a queued operation has no plugin call to checkpoint")
            }
            Self::PauseReportedWhileRunning => {
                formatter.write_str("a running operation cannot report a paused checkpoint")
            }
            Self::ContinueAfterTerminalPhase { phase } => write!(
                formatter,
                "checkpoint returned continue after the operation reached {phase}"
            ),
            Self::PauseAfterTerminalPhase { phase } => write!(
                formatter,
                "checkpoint reported pause after the operation reached {phase}"
            ),
        }
    }
}

impl std::error::Error for CheckpointContradiction {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::abi_code::assert_codes_round_trip;

    const VALID_PAIRS: &[(OperationPhase, CheckpointOutcome)] = &[
        (OperationPhase::Running, CheckpointOutcome::Continue),
        (OperationPhase::Running, CheckpointOutcome::Cancelled),
        (OperationPhase::Paused, CheckpointOutcome::Paused),
        (OperationPhase::Paused, CheckpointOutcome::Continue),
        (OperationPhase::Paused, CheckpointOutcome::Cancelled),
        (OperationPhase::Completed, CheckpointOutcome::Cancelled),
        (OperationPhase::Error, CheckpointOutcome::Cancelled),
        (OperationPhase::Cancelled, CheckpointOutcome::Cancelled),
    ];

    #[test]
    fn outcome_codes_round_trip() {
        assert_codes_round_trip(CheckpointOutcome::ALL);
        assert_eq!(CheckpointOutcome::Cancelled.as_str(), "cancelled");
    }

    #[test]
    fn exactly_the_adr_pairs_are_constructible() {
        let mut constructed = Vec::new();
        for phase in OperationPhase::ALL {
            for outcome in CheckpointOutcome::ALL {
                if let Ok(decision) = CheckpointDecision::new(*phase, *outcome) {
                    constructed.push((decision.phase(), decision.outcome()));
                }
            }
        }
        // Order-insensitive: `ALL` iteration order is not the contract, membership is.
        for pair in &constructed {
            assert!(VALID_PAIRS.contains(pair), "constructed pair missing from the ADR list: {pair:?}");
        }
        for pair in VALID_PAIRS {
            assert!(constructed.contains(pair), "ADR pair is not constructible: {pair:?}");
        }
        assert_eq!(constructed.len(), VALID_PAIRS.len());
    }

    #[test]
    fn continue_after_cancellation_is_a_contradiction() {
        // The case that matters: cancelOperation() flags the operation before the
        // terminal phase is written, so a late checkpoint must never say continue.
        for phase in [
            OperationPhase::Completed,
            OperationPhase::Error,
            OperationPhase::Cancelled,
        ] {
            assert_eq!(
                CheckpointDecision::new(phase, CheckpointOutcome::Continue),
                Err(CheckpointContradiction::ContinueAfterTerminalPhase { phase }),
                "{phase} accepted continue"
            );
            assert!(
                CheckpointDecision::new(phase, CheckpointOutcome::Cancelled).is_ok(),
                "{phase} rejected the hard stop it is supposed to force"
            );
        }
    }

    #[test]
    fn queued_operations_cannot_checkpoint() {
        for outcome in CheckpointOutcome::ALL {
            assert_eq!(
                CheckpointDecision::new(OperationPhase::Queued, *outcome),
                Err(CheckpointContradiction::OperationHasNotStarted)
            );
        }
    }

    #[test]
    fn pause_is_only_reported_while_actually_paused() {
        assert_eq!(
            CheckpointDecision::new(OperationPhase::Running, CheckpointOutcome::Paused),
            Err(CheckpointContradiction::PauseReportedWhileRunning)
        );
        let observation = CheckpointDecision::new(OperationPhase::Paused, CheckpointOutcome::Paused)
            .expect("paused observation");
        assert!(
            !observation.released_a_waiting_checkpoint(),
            "an observation is not a release"
        );
    }

    #[test]
    fn resume_and_cancel_release_paths_are_distinguishable() {
        let resumed = CheckpointDecision::new(OperationPhase::Paused, CheckpointOutcome::Continue)
            .expect("resume release");
        let cancelled =
            CheckpointDecision::new(OperationPhase::Paused, CheckpointOutcome::Cancelled)
                .expect("cancel release");
        assert!(resumed.released_a_waiting_checkpoint());
        assert!(cancelled.released_a_waiting_checkpoint());
        assert!(!resumed.is_hard_stop());
        assert!(cancelled.is_hard_stop());
    }

    #[test]
    fn contradiction_messages_name_the_phase() {
        let error = CheckpointContradiction::ContinueAfterTerminalPhase {
            phase: OperationPhase::Cancelled,
        };
        assert!(error.to_string().contains("cancelled"), "{error}");
    }
}
