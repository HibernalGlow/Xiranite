//! The machine surface a ClassQ run needs: a filesystem, an event sink and a cooperative yield.
//!
//! `ClassqRuntime` (`packages/nodes/classq/src/core.ts:66-75`) had seven members. Four of them were OS work
//! (`pathInfo`, `listDir`, `ensureDir`, `transfer`, bound to `node:fs/promises` in `platform.ts:1`) and three were
//! path text (`join`, `dirname`, `basename`, `relative`). ADR-0071 is what changed the split: the four IO members
//! are no longer host functions, they are `std::fs` against the WASI preopens the host grants from `allowed_paths`
//! ([`crate::std_file_system`]), so the trait here exists to make that code testable rather than to cross the
//! boundary. The three text members moved to [`crate::path_text`] and are called directly.
//!
//! What still *is* a host call is only product semantics: `xiranite.operation.emit` for the two progress events
//! `core.ts:97` and `:101` emitted, and `xiranite.operation.checkpoint` for ADR-0066's pause/cancel yield, which has
//! no TypeScript counterpart because the old in-process runner could simply be awaited.

use std::fmt;

use crate::contract::{ClassqDirEntry, ClassqPathInfo, ClassqRunEvent, ClassqTransferMode};

/// A failure from the machine layer.
///
/// `core.ts:253-255` turned any thrown value into `error.message` and put it in the item's `reason`; that is still
/// the only use of this type, so it carries one string rather than an error taxonomy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClassqRuntimeError {
    /// The message a plan item's `reason` shows.
    pub message: String,
}

impl ClassqRuntimeError {
    /// Wraps a message.
    #[must_use]
    pub fn new(message: impl Into<String>) -> Self {
        Self { message: message.into() }
    }
}

impl fmt::Display for ClassqRuntimeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ClassqRuntimeError {}

impl From<std::io::Error> for ClassqRuntimeError {
    /// `platform.ts:9-13` let `stat` answer "does not exist" and let every other call throw; the thrown message is
    /// the operating system's own, which is what reaches `reason`.
    fn from(error: std::io::Error) -> Self {
        Self { message: error.to_string() }
    }
}

/// The filesystem the node walks and writes (the IO half of `core.ts:66-75`).
pub trait ClassqFileSystem {
    /// `runtime.pathInfo` (`core.ts:67`, `platform.ts:7-14`). A path that cannot be read is reported as
    /// `exists: false`, never as an error, which is why an unusable root becomes one `error` row instead of
    /// aborting the run (`core.ts:126-130`).
    fn path_info(&self, path: &str) -> ClassqPathInfo;

    /// `runtime.listDir` (`core.ts:68`, `platform.ts:15-18`). Unlike `path_info` this one may fail, and a failure
    /// aborts the plan into the `failure` result `core.ts:117-119` produced.
    fn list_dir(&self, path: &str) -> Result<Vec<ClassqDirEntry>, ClassqRuntimeError>;

    /// `runtime.ensureDir` (`core.ts:69`, `platform.ts:19-21`): `mkdir(path, { recursive: true })`.
    fn ensure_dir(&self, path: &str) -> Result<(), ClassqRuntimeError>;

    /// `runtime.transfer` (`core.ts:70`, `platform.ts:22-28`): `cp(recursive, errorOnExist, !force)` for copy,
    /// `rename` for move.
    fn transfer(&self, source: &str, target: &str, mode: ClassqTransferMode) -> Result<(), ClassqRuntimeError>;
}

/// Where a checkpoint was reached, for the host's own progress reporting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClassqPhase {
    /// Walking roots and listings (`core.ts:97`).
    Scan,
    /// Applying wait transfers (`core.ts:101`).
    Apply,
}

impl ClassqPhase {
    /// The wire name carried in a checkpoint request.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Scan => "scan",
            Self::Apply => "apply",
        }
    }
}

impl fmt::Display for ClassqPhase {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// `xiranite.operation.checkpoint`'s answer (`crates/xiranite-plugin-api/src/checkpoint.rs`'s `CheckpointOutcome`).
///
/// The numeric codes are copied from that enum's `AbiCode` implementation — `0` stays unassigned so a zeroed buffer
/// cannot decode as `Continue` — because the boundary must agree with the host without either side importing the
/// other. `tests/manifest_contract.rs` pins them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClassqCheckpointOutcome {
    /// Keep processing the next item.
    Continue,
    /// The operation is paused, reported without holding the call.
    Paused,
    /// Stop without starting another item.
    Cancelled,
}

impl ClassqCheckpointOutcome {
    /// Every outcome in wire order.
    pub const ALL: &'static [Self] = &[Self::Continue, Self::Paused, Self::Cancelled];

    /// The stable ABI tag.
    #[must_use]
    pub const fn abi_code(self) -> u8 {
        match self {
            Self::Continue => 1,
            Self::Paused => 2,
            Self::Cancelled => 3,
        }
    }

    /// Whether the plugin must stop working immediately.
    #[must_use]
    pub const fn is_hard_stop(self) -> bool {
        matches!(self, Self::Cancelled)
    }

    /// Decodes a tag; `0` and anything unknown are refused, and the shim reads a refusal as cancellation because
    /// continuing to move files for an operation the vocabulary cannot name is the unsafe guess.
    #[must_use]
    pub const fn try_from_abi_code(code: u8) -> Option<Self> {
        match code {
            1 => Some(Self::Continue),
            2 => Some(Self::Paused),
            3 => Some(Self::Cancelled),
            _ => None,
        }
    }
}

/// The cooperative yield (ADR-0066).
pub trait ClassqRunControl {
    /// One yield point: waits while the owning operation is paused and reports cancellation.
    fn checkpoint(
        &mut self,
        phase: ClassqPhase,
        processed_count: usize,
        total_count: usize,
    ) -> ClassqCheckpointOutcome;
}

/// Where progress and log events go (`core.ts:93`'s `onEvent`).
pub trait ClassqEventSink {
    /// Reports one event.
    fn on_event(&mut self, event: ClassqRunEvent);
}

/// A sink that drops every event, for a caller with no progress UI.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoopClassqEventSink;

impl ClassqEventSink for NoopClassqEventSink {
    fn on_event(&mut self, _event: ClassqRunEvent) {}
}

/// A control that never pauses and never cancels: the behaviour of the old in-process runner.
#[derive(Debug, Clone, Copy, Default)]
pub struct AlwaysContinueClassqRunControl;

impl ClassqRunControl for AlwaysContinueClassqRunControl {
    fn checkpoint(
        &mut self,
        _phase: ClassqPhase,
        _processed_count: usize,
        _total_count: usize,
    ) -> ClassqCheckpointOutcome {
        ClassqCheckpointOutcome::Continue
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checkpoint_codes_keep_zero_unassigned() {
        assert_eq!(ClassqCheckpointOutcome::Continue.abi_code(), 1);
        assert_eq!(ClassqCheckpointOutcome::Paused.abi_code(), 2);
        assert_eq!(ClassqCheckpointOutcome::Cancelled.abi_code(), 3);
        assert_eq!(ClassqCheckpointOutcome::try_from_abi_code(0), None);
        assert_eq!(ClassqCheckpointOutcome::try_from_abi_code(4), None);
        for outcome in ClassqCheckpointOutcome::ALL {
            assert_eq!(ClassqCheckpointOutcome::try_from_abi_code(outcome.abi_code()), Some(*outcome));
        }
        // Negative control: only cancellation stops a run.
        assert!(ClassqCheckpointOutcome::Cancelled.is_hard_stop());
        assert!(!ClassqCheckpointOutcome::Paused.is_hard_stop());
    }

    #[test]
    fn runtime_errors_keep_the_message_the_item_shows() {
        let error: ClassqRuntimeError = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "nope").into();
        assert_eq!(error.message, "nope");
        assert_eq!(ClassqRuntimeError::new("x").to_string(), "x");
    }
}
