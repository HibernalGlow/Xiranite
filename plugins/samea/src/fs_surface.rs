//! The machine surface: four filesystem effects, an event sink and a checkpoint.
//!
//! `SameaRuntime` (`core.ts:64-72`) had seven members; three of them (`join`, `dirname`, `basename`) are
//! pure and moved to [`crate::path_tools`], leaving exactly the four effects `platform.ts` performed with
//! `node:fs/promises`. ADR-0071 §2-§3 is why those four are `std::fs` calls against the WASI preopens the
//! host grants from `manifest.toml`'s `allowed_paths`, rather than `xiranite.fs.*` host functions: that
//! family was retired, and the engine's own containment gives errno-checked refusal. The trait stays
//! because the plan and the apply loop must be testable without touching a disk.
//!
//! | `core.ts` runtime member | Trait method | Where it runs in the plugin |
//! | --- | --- | --- |
//! | `pathInfo` (`core.ts:65`, `platform.ts:7-10`) | `SameaFileSystem::path_info` | `std::fs::metadata` (`fs_runtime`) |
//! | `listDir` (`core.ts:66`, `platform.ts:11`) | `SameaFileSystem::list_dir` | `std::fs::read_dir` |
//! | `ensureDir` (`core.ts:67`, `platform.ts:12`) | `SameaFileSystem::ensure_dir` | `std::fs::create_dir_all` |
//! | `movePath` (`core.ts:68`, `platform.ts:13`) | `SameaFileSystem::move_path` | `std::fs::rename` |
//! | `onEvent` (`core.ts:99`) | `SameaEventSink::on_event` | `xiranite.operation.emit` |
//! | pause/cancel (host side today) | `SameaRunControl::checkpoint` | `xiranite.operation.checkpoint` |

use crate::contract::{SameaDirEntry, SameaPathInfo, SameaRunEvent};

/// A filesystem effect that failed. The text becomes an item's `reason` (`core.ts:117`), which is what
/// `errorMessage` (`core.ts:254`) did with a thrown `Error`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SameaIoError {
    /// The path or pair of paths the operation named.
    pub path: String,
    /// The underlying message, host text in the plugin, test text in the double.
    pub message: String,
}

impl SameaIoError {
    #[must_use]
    pub fn new(path: impl Into<String>, message: impl Into<String>) -> Self {
        Self { path: path.into(), message: message.into() }
    }
}

impl std::fmt::Display for SameaIoError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for SameaIoError {}

/// The four machine effects SameA performs.
///
/// `path_info` cannot fail: `platform.ts:7-10` wrapped `stat` in a `try` and reported
/// `exists: false` for anything it could not read, including a refused path. A refused path therefore
/// reads as "not a directory" and becomes the `root_not_directory` error item at `core.ts:133`, which is
/// the behaviour the node's own report text describes
/// (`node-definitions/samea.json:462`).
pub trait SameaFileSystem {
    /// `core.ts:65` / `platform.ts:7`.
    fn path_info(&mut self, path: &str) -> SameaPathInfo;

    /// `core.ts:66` / `platform.ts:11`. Fails only when the directory itself cannot be read.
    fn list_dir(&mut self, path: &str) -> Result<Vec<SameaDirEntry>, SameaIoError>;

    /// `core.ts:67` / `platform.ts:12` (`mkdir` recursive).
    fn ensure_dir(&mut self, path: &str) -> Result<(), SameaIoError>;

    /// `core.ts:68` / `platform.ts:13` (`mkdir(dirname)`, then `rename`).
    fn move_path(&mut self, source: &str, target: &str) -> Result<(), SameaIoError>;
}

/// `onEvent` (`core.ts:99`).
pub trait SameaEventSink {
    /// One event into the operation's stream.
    fn on_event(&mut self, event: SameaRunEvent);
}

/// A sink that drops everything, for the pure tests.
#[derive(Debug, Default)]
pub struct NoopEventSink;

impl SameaEventSink for NoopEventSink {
    fn on_event(&mut self, _event: SameaRunEvent) {}
}

/// A sink that keeps the events, which is what `plugin_entry` needs for
/// `nodeRunResponseSchema.events`.
#[derive(Debug, Default)]
pub struct CollectingEventSink {
    /// The events in arrival order.
    pub events: Vec<SameaRunEvent>,
}

impl CollectingEventSink {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }
}

impl SameaEventSink for CollectingEventSink {
    fn on_event(&mut self, event: SameaRunEvent) {
        self.events.push(event);
    }
}

/// What `xiranite.operation.checkpoint` answered (ADR-0066, ADR-0068).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckpointOutcome {
    /// Keep going.
    Continue,
    /// The operation is paused; the host already waited inside the call.
    Paused,
    /// The operation was cancelled: stop starting new items.
    Cancelled,
}

impl CheckpointOutcome {
    /// ADR-0066: `Paused` resumed before the call returned, so only `Cancelled` ends the run.
    #[must_use]
    pub fn is_hard_stop(self) -> bool {
        matches!(self, Self::Cancelled)
    }
}

/// The yield point the plugin owes the host between work items.
///
/// `continue_always` is the double the tests use: the TypeScript core had no cooperative checkpoint
/// because its host cancelled by dropping the worker process, so parity tests must not see one.
pub trait SameaRunControl {
    /// Reports one item boundary and returns the engine's answer.
    fn checkpoint(&mut self, phase: &str, processed_item_count: usize, total_item_count: usize)
    -> CheckpointOutcome;
}

/// A run control that always says continue.
pub struct ContinueThroughRunControl;

impl SameaRunControl for ContinueThroughRunControl {
    fn checkpoint(
        &mut self,
        _phase: &str,
        _processed_item_count: usize,
        _total_item_count: usize,
    ) -> CheckpointOutcome {
        CheckpointOutcome::Continue
    }
}

/// A run control that cancels after a fixed number of checkpoints, for the cancellation test.
pub struct CancelAfterRunControl {
    /// Checkpoints granted before the answer turns hard.
    pub allow: usize,
    /// Consumed so far.
    pub seen: usize,
}

impl CancelAfterRunControl {
    #[must_use]
    pub fn new(allow: usize) -> Self {
        Self { allow, seen: 0 }
    }
}

impl SameaRunControl for CancelAfterRunControl {
    fn checkpoint(
        &mut self,
        _phase: &str,
        _processed_item_count: usize,
        _total_item_count: usize,
    ) -> CheckpointOutcome {
        self.seen += 1;
        if self.seen > self.allow { CheckpointOutcome::Cancelled } else { CheckpointOutcome::Continue }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_cancellation_is_a_hard_stop() {
        assert!(CheckpointOutcome::Cancelled.is_hard_stop());
        assert!(!CheckpointOutcome::Paused.is_hard_stop(), "a pause resumed inside the host call");
        assert!(!CheckpointOutcome::Continue.is_hard_stop());
    }

    #[test]
    fn the_cancel_after_control_grants_then_refuses() {
        let mut control = CancelAfterRunControl::new(1);
        assert_eq!(control.checkpoint("organizing", 0, 2), CheckpointOutcome::Continue);
        assert_eq!(control.checkpoint("organizing", 1, 2), CheckpointOutcome::Cancelled);
    }

    #[test]
    fn the_error_display_is_the_message_only() {
        // `core.ts:117` stores `errorMessage(error)`, which is `Error.message` and not the stack.
        let error = SameaIoError::new("/archive/x.zip", "permission denied");
        assert_eq!(error.to_string(), "permission denied");
    }
}
