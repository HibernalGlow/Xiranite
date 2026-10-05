//! The machine seam of the ported core.
//!
//! `packages/nodes/snf/src/core.ts` is written against an injected `SnfRuntime`
//! (`core.ts:58-66`) whose filesystem half is `platform.ts`'s `node:fs/promises`. ADR-0071 moved
//! that half out of the host function table and into the engine: the plugin uses `std::fs` against
//! the WASI preopens the host opens from the manifest's authorized roots, and
//! `crate::std_file_system::StdFileSystem` is that implementation. The three pure path members
//! became `crate::path_tools`. The core below the trait stays side-effect free and unit-testable
//! against `crate::memory_file_system`.
//!
//! The trait itself stays, because the seam is where the ported behaviour is pinned: the double in
//! `memory_file_system` proves the plan rules, and `StdFileSystem`'s own tests prove the same methods
//! against real directories.
//!
//! `join`/`dirname`/`basename` are intentionally *not* trait members: they are text
//! operations, and making them host calls would pay a boundary crossing per
//! candidate folder name for no permission benefit.

use crate::contract::{SnfDirEntry, SnfPathInfo};
use crate::host_surface::CheckpointOutcome;

/// Everything SNF needs from the machine.
///
/// Methods take `&self` and return synchronously: an Extism host function blocks
/// the plugin call, so the async shape of `SnfRuntime` does not survive the
/// boundary and would only add a runtime dependency here.
pub trait SnfFileSystem {
    /// `SnfRuntime.pathInfo`.
    ///
    /// Contract both implementations must honour, because `platform.ts:7-13`
    /// swallows a `stat` failure and reports `exists: false`: a missing path is
    /// `Ok(SnfPathInfo { exists: false, .. })`, never an `Err`. Other failures
    /// (permission denied, host-side IO error) are `Err` and reach the same place
    /// `core.ts:113` puts them.
    fn path_info(&self, path: &str) -> Result<SnfPathInfo, SnfFileAccessError>;

    /// `SnfRuntime.listDir`. A directory that cannot be listed is an error, as it
    /// is in `platform.ts:15-18`.
    fn list_directory(&self, path: &str) -> Result<Vec<SnfDirEntry>, SnfFileAccessError>;

    /// `SnfRuntime.rename`, which is `std::fs::rename` on a granted preopen since ADR-0071.
    fn rename_folder(&self, source_path: &str, target_path: &str) -> Result<(), SnfFileAccessError>;

    /// `SnfRuntime.setTimes` (`node:fs/promises`' `utimes`). SNF is the only node
    /// that needs this, and `keepTimestamp` (`core.ts:106`) depends on it running
    /// *after* the rename, on the target path.
    fn set_folder_timestamps(&self, path: &str, atime_ms: u64, mtime_ms: u64)
    -> Result<(), SnfFileAccessError>;
}

/// A host or fake filesystem refusal.
///
/// `Display` prints only the message, mirroring `errorMessage` (`core.ts:227-229`)
/// whose `error.message` is what lands in `SnfPlanItem.reason` and in `errors`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnfFileAccessError {
    pub code: String,
    pub message: String,
}

impl SnfFileAccessError {
    #[must_use]
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    /// The host's not-found answer, which every `SnfFileSystem` turns into
    /// `exists: false` rather than an error.
    pub const NOT_FOUND_CODE: &'static str = "not_found";

    #[must_use]
    pub fn is_not_found(&self) -> bool {
        self.code == Self::NOT_FOUND_CODE
    }
}

impl std::fmt::Display for SnfFileAccessError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for SnfFileAccessError {}

/// `onEvent` of `runSnf` (`core.ts:85`): progress the operation monitor streams.
pub trait SnfEventSink {
    fn on_event(&self, event: &crate::contract::NodeRunEvent);
}

/// The default no-op sink, matching `core.ts:85`'s `= () => {}`.
pub struct NoopEventSink;

impl SnfEventSink for NoopEventSink {
    fn on_event(&self, _event: &crate::contract::NodeRunEvent) {}
}

/// The cooperative control plane ADR-0066 puts between work items.
pub trait SnfRunControl {
    /// Called at every item boundary. Implementations must be cheap and must not
    /// fake a transaction: ADR-0066 says a checkpoint is a yield and a reporting
    /// point, not a resumable mid-file boundary.
    fn checkpoint(&self) -> CheckpointOutcome;

    /// `xiranite.scheduler.acquire` for one disk-bound phase, called once before
    /// the rename loop starts. Returns whether the host granted admission; a run
    /// proceeds either way because the host's own permit table is authoritative.
    fn acquire_disk_admission(&self) -> bool;
}

/// Behaviour of `runSnf` today: nothing pauses or cancels inside the core, so the
/// host-side tests and the non-plugin callers use this.
pub struct ContinueThroughRunControl;

impl SnfRunControl for ContinueThroughRunControl {
    fn checkpoint(&self) -> CheckpointOutcome {
        CheckpointOutcome::Continue
    }

    fn acquire_disk_admission(&self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_display_is_the_message_only() {
        let error = SnfFileAccessError::new("permission_denied", "EPERM: operation not permitted, rename");
        assert_eq!(error.to_string(), "EPERM: operation not permitted, rename");
        assert!(!error.is_not_found());
        assert!(SnfFileAccessError::new(SnfFileAccessError::NOT_FOUND_CODE, "gone").is_not_found());
    }
}
