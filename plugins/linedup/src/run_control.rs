//! The pause/cancel yield point a run needs and nothing else.
//!
//! ADR-0066 replaced runtime suspension with one host function: `xiranite.operation.checkpoint()` is
//! a yield *and* a reporting point, and when the operation is paused the host waits **inside** the
//! call. So the plugin's side of the contract is exactly one synchronous method, called between work
//! items, and a `Cancelled` answer means "do not start another item". Nothing here is async, which is
//! what lets the same core run in an isolate, in a CLI process and in a test.

/// Source lines partitioned between two checkpoint calls (ADR-0066's item boundary).
///
/// The batch is a pause-latency bound, not a performance knob: pause is cooperative, so an operation
/// becomes unresponsive for at most one batch of work. 4096 is roughly the largest paste the card
/// accepts, which keeps an ordinary run at a single checkpoint while a 500 000-line `source.txt` yields
/// 122 times.
pub const CHECKPOINT_LINE_BATCH: usize = 4096;

/// What `xiranite.operation.checkpoint` answered.
///
/// Mirrors `xiranite_plugin_api::checkpoint::CheckpointOutcome` and its ABI tags (1 continue, 2
/// paused, 3 cancelled, 0 reserved-unassigned). `tests/plugin_contract.rs` pins these numbers against
/// the published vocabulary, because the five earlier plugin ports each invented their own dialect and
/// that is the fork ADR-0068 was written to stop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckpointOutcome {
    /// Keep processing the next batch.
    Continue,
    /// The operation is paused and the host answered without holding the call.
    Paused,
    /// Hard stop: do not start another batch.
    Cancelled,
}

impl CheckpointOutcome {
    /// Every outcome in wire order, for the contract test.
    pub const ALL: &'static [Self] = &[Self::Continue, Self::Paused, Self::Cancelled];

    /// The boundary tag, matching the Plugin API's enum.
    #[must_use]
    pub const fn abi_code(self) -> u8 {
        match self {
            Self::Continue => 1,
            Self::Paused => 2,
            Self::Cancelled => 3,
        }
    }

    /// Reads a boundary tag. Anything the vocabulary does not define — including the `0` the adapter
    /// answers when the operation is gone or already terminal
    /// (`crates/xiranite-extism-adapter/src/compiled.rs:180-187`) — is the safe stop: cancelling a run
    /// that has ended is correct, while continuing one that has is how a cancelled operation keeps
    /// writing files.
    #[must_use]
    pub const fn from_abi_code(code: u8) -> Self {
        match code {
            1 => Self::Continue,
            2 => Self::Paused,
            _ => Self::Cancelled,
        }
    }

    /// Whether this answer forbids starting another batch.
    #[must_use]
    pub const fn is_hard_stop(self) -> bool {
        matches!(self, Self::Cancelled)
    }

    /// The stable name used in logs and in the descriptor document.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Continue => "continue",
            Self::Paused => "paused",
            Self::Cancelled => "cancelled",
        }
    }
}

/// The control a run yields to.
pub trait LinedupRunControl {
    /// Yields to the host once, at an item boundary.
    fn checkpoint(&mut self) -> CheckpointOutcome;
}

/// The control for a run driven inside the calling process — a CLI, a TUI, or a test that does not
/// model pause: never waits, never cancels.
#[derive(Debug, Clone, Copy, Default)]
pub struct ContinueThroughRunControl;

impl LinedupRunControl for ContinueThroughRunControl {
    fn checkpoint(&mut self) -> CheckpointOutcome {
        CheckpointOutcome::Continue
    }
}

/// A control that cancels after a fixed number of checkpoints, so the cancel path is reachable from a
/// table-driven test without an Extism host.
#[derive(Debug, Clone)]
pub struct CancelAfterCheckpoints {
    remaining: usize,
    /// How many checkpoints were actually taken, for the assertion that the batch size is what the
    /// manifest and this module claim.
    pub checkpoints_taken: usize,
}

impl CancelAfterCheckpoints {
    /// Cancels on the `after`th call (1-based); `0` cancels on the first.
    #[must_use]
    pub fn new(after: usize) -> Self {
        Self { remaining: after, checkpoints_taken: 0 }
    }
}

impl LinedupRunControl for CancelAfterCheckpoints {
    fn checkpoint(&mut self) -> CheckpointOutcome {
        self.checkpoints_taken += 1;
        if self.remaining == 0 {
            return CheckpointOutcome::Cancelled;
        }
        self.remaining -= 1;
        CheckpointOutcome::Continue
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn abi_tags_are_the_published_ones_and_zero_is_never_continue() {
        assert_eq!(CheckpointOutcome::Continue.abi_code(), 1);
        assert_eq!(CheckpointOutcome::Paused.abi_code(), 2);
        assert_eq!(CheckpointOutcome::Cancelled.abi_code(), 3);
        for variant in CheckpointOutcome::ALL {
            assert_eq!(CheckpointOutcome::from_abi_code(variant.abi_code()), *variant);
        }
        assert_eq!(CheckpointOutcome::from_abi_code(0), CheckpointOutcome::Cancelled, "the reserved tag");
        assert_eq!(CheckpointOutcome::from_abi_code(200), CheckpointOutcome::Cancelled);
        assert!(CheckpointOutcome::Paused.is_hard_stop() == false, "a paused report is not a stop");
    }

    #[test]
    fn the_scripted_control_cancels_when_it_is_told_to() {
        let mut control = CancelAfterCheckpoints::new(2);
        assert_eq!(control.checkpoint(), CheckpointOutcome::Continue);
        assert_eq!(control.checkpoint(), CheckpointOutcome::Continue);
        assert_eq!(control.checkpoint(), CheckpointOutcome::Cancelled);
        assert_eq!(control.checkpoints_taken, 3);
    }
}
