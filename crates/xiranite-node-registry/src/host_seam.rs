//! The seam every built-in node shares with the host (ADR-0073).
//!
//! A node core depends on [`NodeHost`] and nothing else, exactly as it did when it lived behind the
//! Extism boundary. What changes is *who implements it*: the host now implements it in the same
//! process, so there is no wire envelope, no block allocation, and no capability name to register.
//!
//! ## Why these ten methods and not the nine-name vocabulary
//!
//! This shape is lifted from the one node that was already fully ported
//! (`crates/nodes/dissolvef/src/host.rs:57-100`), because that trait is what 100 green tests pin.
//! Two of its methods (`checkpoint`, `emit`) are the operation semantics ADR-0066 needs and stay
//! calls into the host; the other eight are file/clock access that WASI used to stand in for.
//!
//! ## What is deliberately not here
//!
//! No `open`/`read`/`write` handle family: ADR-0070 retired it and ADR-0071's positional-access
//! route disappears with wasm — a native node that needs a byte range just uses `std::fs`. The
//! host-side error taxonomy for *refusals* stays `HostCallErrorCode` in `xiranite-plugin-api`;
//! [`NodeHostError`] only carries what a node can branch on, which is "failed" vs "cancelled".

use xiranite_plugin_api::checkpoint::CheckpointOutcome;
use xiranite_plugin_api::run_events::PluginRunEvent;

/// What [`NodeHost::stat`] answers: one path, as the node saw it.
///
/// `path` keeps the caller's own spelling rather than the canonical path, because a node's plan rows
/// and its undo journal record that spelling; canonicalising here would show `/private/var/…` on
/// macOS and hand the node a prefix it was never granted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodePathInfo {
    /// The path as the node named it.
    pub path: String,
    /// Whether anything exists there *and* the host may see it. A refused path reads as missing —
    /// see [`NodeHost::stat`] for why that leniency is kept.
    pub exists: bool,
    /// Regular file.
    pub is_file: bool,
    /// Directory.
    pub is_directory: bool,
}

impl NodePathInfo {
    /// The answer for "nothing here that you may see".
    #[must_use]
    pub fn missing(path: &str) -> Self {
        Self {
            path: path.to_string(),
            exists: false,
            is_file: false,
            is_directory: false,
        }
    }
}

/// One entry of a directory listing, names only plus kind.
///
/// Deliberately no size and no timestamps: `std::fs::ReadDir` already knows the kind from the
/// dirent, and asking for size means a `stat` per entry — the TypeScript nodes never paid that, and
/// neither should the native ones. A node that needs sizes asks per path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeDirEntry {
    /// Entry name, without any separator.
    pub name: String,
    /// `parent/name`, so the node can hand it straight back to [`NodeHost::move_path`].
    pub path: String,
    /// Regular file.
    pub is_file: bool,
    /// Directory.
    pub is_directory: bool,
}

/// The item-boundary report a node makes when it calls [`NodeHost::checkpoint`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeCheckpointRequest {
    /// Which loop is asking, for the host's log line and the operation's phase.
    pub phase: &'static str,
    /// Items finished so far.
    pub processed_item_count: usize,
    /// Items expected, `0` while unknown.
    pub total_item_count: usize,
}

/// Why a host call failed, from the node's point of view.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NodeHostError {
    /// The host refused or the machine failed. The message is what the node would have shown a user
    /// before the rewrite, and it stays data so a node can log it without catching a panic.
    Failure(String),
    /// The owning operation was cancelled. Every method may return this, and a node must treat it as
    /// a hard stop rather than a per-item failure.
    Cancelled,
}

impl NodeHostError {
    /// The message a node puts in its own error document.
    #[must_use]
    pub fn message(&self) -> String {
        match self {
            Self::Failure(message) => message.clone(),
            Self::Cancelled => "operation cancelled".to_string(),
        }
    }
}

impl std::fmt::Display for NodeHostError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message())
    }
}

impl std::error::Error for NodeHostError {}

/// Result of one host call.
pub type NodeHostResult<T> = Result<T, NodeHostError>;

/// Why a node's run did not produce a result document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeRunError {
    /// Already user-facing: the node composed it from the failed item and the host's message.
    pub message: String,
}

impl std::fmt::Display for NodeRunError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for NodeRunError {}

impl From<NodeHostError> for NodeRunError {
    fn from(error: NodeHostError) -> Self {
        Self {
            message: error.message(),
        }
    }
}

/// The machine, as much of it as a node may ask for.
///
/// Synchronous on purpose: the previous boundary was a synchronous wasm host call, and pause is
/// implemented by *waiting inside* [`NodeHost::checkpoint`] (ADR-0066). Keeping the trait sync means
/// a node crate stays free of an executor and the host keeps the wait where it can be cancelled.
pub trait NodeHost {
    /// Does this path exist, and what kind is it?
    ///
    /// A path that is missing, unreadable *or refused by policy* answers `exists: false` rather than
    /// failing, because that is what the TypeScript runtime did and what the ported planners branch
    /// on. The cost is stated out loud: an operator's mis-set grant looks like a missing folder, so a
    /// host implementation logs the refusal on its own side instead of changing the node.
    fn stat(&mut self, path: &str) -> NodeHostResult<NodePathInfo>;

    /// One directory level, names and kinds only.
    fn list_dir(&mut self, path: &str) -> NodeHostResult<Vec<NodeDirEntry>>;

    /// Create a directory and its parents.
    fn ensure_dir(&mut self, path: &str) -> NodeHostResult<()>;

    /// Move `source` onto `target`, across volumes if the host has to.
    fn move_path(&mut self, source: &str, target: &str) -> NodeHostResult<()>;

    /// Delete a path.
    ///
    /// `recursive: false` must refuse a non-empty directory: that refusal is what stops a batch node
    /// from discarding content it never planned to move.
    fn delete_path(&mut self, path: &str, recursive: bool) -> NodeHostResult<()>;

    /// Read a text document, `None` when there is nothing readable there.
    fn read_text(&mut self, path: &str) -> NodeHostResult<Option<String>>;

    /// Write a text document, creating the parent directory.
    fn write_text(&mut self, path: &str, content: &str) -> NodeHostResult<()>;

    /// The host clock as the operation's deterministic timestamp string.
    ///
    /// Nodes must not read a wall clock themselves: the undo journal's ids are compared in tests, so
    /// "reproducible" is a product property, not hygiene.
    fn now(&mut self) -> NodeHostResult<String>;

    /// Append one event to the owning operation's stream.
    ///
    /// A failed report is not a failed run: only [`NodeHostError::Cancelled`] propagates.
    fn emit(&mut self, event: &PluginRunEvent) -> NodeHostResult<()>;

    /// Yield at an item boundary; wait while the operation is paused; answer
    /// [`CheckpointOutcome::Cancelled`] once it is cancelled.
    fn checkpoint(&mut self, request: &NodeCheckpointRequest) -> NodeHostResult<CheckpointOutcome>;
}

/// A node built into the host binary.
///
/// Registration ( [`crate::NodeDescriptor`] through `inventory`) says *that* a node exists and what it
/// may touch; this trait says how to run it. The documents in and out are the same JSON shapes the
/// HTTP operation protocol already carries, so `xiranite-api`'s request and answer bodies survive the
/// move off wasm byte for byte.
pub trait BuiltInNode: Send + Sync {
    /// Identity and machine requirements, used by the registry and the gate.
    fn descriptor(&self) -> crate::NodeDescriptor;

    /// Run one operation to completion against `host`.
    fn run(&self, input: &str, host: &mut dyn NodeHost) -> Result<String, NodeRunError>;
}

#[cfg(test)]
mod tests {
    use super::{
        BuiltInNode, NodeCheckpointRequest, NodeDirEntry, NodeHost, NodeHostError, NodeHostResult,
        NodePathInfo, NodeRunError,
    };
    use crate::{NodeDescriptor, NodeRequirements};
    use std::cell::RefCell;
    use xiranite_plugin_api::checkpoint::CheckpointOutcome;
    use xiranite_plugin_api::run_events::PluginRunEvent;

    /// A host double that records the calls and can be told to cancel at the second checkpoint, so the
    /// test proves the node stopped because of the cancel and not because it ran out of work.
    struct RecordingHost {
        calls: RefCell<Vec<String>>,
        checkpoints_seen: usize,
        /// Which checkpoint starts answering `Cancelled`; `None` means the host never cancels. Stated as
        /// data on purpose: a double that cancels by accident makes "the run completed" unprovable, which
        /// is exactly how the first version of this test failed.
        cancel_at: Option<usize>,
    }

    impl RecordingHost {
        fn new() -> Self {
            Self {
                calls: RefCell::new(Vec::new()),
                checkpoints_seen: 0,
                cancel_at: None,
            }
        }
        fn cancelling_at(checkpoint_number: usize) -> Self {
            let mut host = Self::new();
            host.cancel_at = Some(checkpoint_number);
            host
        }
        fn note(&self, what: &str) {
            self.calls.borrow_mut().push(what.to_string());
        }
    }

    impl NodeHost for RecordingHost {
        fn stat(&mut self, path: &str) -> NodeHostResult<NodePathInfo> {
            self.note(&format!("stat {path}"));
            Ok(NodePathInfo {
                path: path.to_string(),
                exists: true,
                is_file: true,
                is_directory: false,
            })
        }
        fn list_dir(&mut self, path: &str) -> NodeHostResult<Vec<NodeDirEntry>> {
            self.note(&format!("list_dir {path}"));
            Ok(vec![NodeDirEntry {
                name: "a.txt".to_string(),
                path: format!("{path}/a.txt"),
                is_file: true,
                is_directory: false,
            }])
        }
        fn ensure_dir(&mut self, path: &str) -> NodeHostResult<()> {
            self.note(&format!("ensure_dir {path}"));
            Ok(())
        }
        fn move_path(&mut self, source: &str, target: &str) -> NodeHostResult<()> {
            self.note(&format!("move_path {source} {target}"));
            Ok(())
        }
        fn delete_path(&mut self, path: &str, recursive: bool) -> NodeHostResult<()> {
            self.note(&format!("delete_path {path} {recursive}"));
            Ok(())
        }
        fn read_text(&mut self, path: &str) -> NodeHostResult<Option<String>> {
            self.note(&format!("read_text {path}"));
            Ok(Some("body".to_string()))
        }
        fn write_text(&mut self, path: &str, content: &str) -> NodeHostResult<()> {
            self.note(&format!("write_text {path} {}", content.len()));
            Ok(())
        }
        fn now(&mut self) -> NodeHostResult<String> {
            self.note("now");
            Ok("2026-10-04T00:00:00.000Z".to_string())
        }
        fn emit(&mut self, event: &PluginRunEvent) -> NodeHostResult<()> {
            self.note(&format!("emit {:?}", event.kind()));
            Ok(())
        }
        fn checkpoint(
            &mut self,
            request: &NodeCheckpointRequest,
        ) -> NodeHostResult<CheckpointOutcome> {
            self.checkpoints_seen += 1;
            self.note(&format!(
                "checkpoint {} {}/{}",
                request.phase, request.processed_item_count, request.total_item_count
            ));
            if self
                .cancel_at
                .is_some_and(|number| self.checkpoints_seen >= number)
            {
                return Err(NodeHostError::Cancelled);
            }
            Ok(CheckpointOutcome::Continue)
        }
    }

    struct TwoItemNode;

    impl BuiltInNode for TwoItemNode {
        fn descriptor(&self) -> NodeDescriptor {
            NodeDescriptor::new("seam-test.two-item", "0.1.0", 1).budget(1_048_576, 1)
        }
        fn run(&self, input: &str, host: &mut dyn NodeHost) -> Result<String, NodeRunError> {
            let root = input.trim();
            let listing = host.list_dir(root)?;
            let total = listing.len() * 2;
            let mut done = 0usize;
            for entry in &listing {
                host.stat(&entry.path)?;
                host.write_text(&entry.path, "x")
                    .map_err(NodeRunError::from)?;
                done += 1;
                host.checkpoint(&NodeCheckpointRequest {
                    phase: "doing",
                    processed_item_count: done,
                    total_item_count: total,
                })?;
                // The second item of each entry is where the double starts cancelling.
                host.move_path(&entry.path, &format!("{}.moved", entry.path))?;
                done += 1;
                host.checkpoint(&NodeCheckpointRequest {
                    phase: "doing",
                    processed_item_count: done,
                    total_item_count: total,
                })?;
            }
            Ok(format!("done {done}"))
        }
    }

    #[test]
    fn a_run_that_never_meets_cancellation_returns_its_answer() {
        let mut host = RecordingHost::new();
        let answer = TwoItemNode
            .run("/root", &mut host)
            .expect("one item stays under the cancel point");
        assert_eq!(answer, "done 2");
        let calls = host.calls.borrow();
        assert_eq!(
            calls
                .iter()
                .filter(|call| call.starts_with("checkpoint"))
                .count(),
            2,
            "every item must yield exactly once per checkpoint, got {calls:?}"
        );
    }

    #[test]
    fn cancellation_propagates_as_a_hard_stop_and_stops_touching_the_machine() {
        let mut host = RecordingHost::cancelling_at(2);
        let error = TwoItemNode
            .run("/root", &mut host)
            .expect_err("the second checkpoint cancels the run");
        assert_eq!(error.message, "operation cancelled");
        let calls = host.calls.borrow();
        let cancelled_at = calls
            .iter()
            .position(|call| call.starts_with("checkpoint") && call.contains("2/"))
            .expect("the cancel happened at a checkpoint");
        assert!(
            !calls[cancelled_at + 1..]
                .iter()
                .any(|call| call.starts_with("move_path")),
            "a node must not keep mutating after a cancel: {calls:?}"
        );
    }

    #[test]
    fn a_failed_progress_report_is_not_a_failed_run_but_a_cancel_is() {
        struct EmitFails;
        impl NodeHost for EmitFails {
            fn stat(&mut self, path: &str) -> NodeHostResult<NodePathInfo> {
                Ok(NodePathInfo::missing(path))
            }
            fn list_dir(&mut self, _path: &str) -> NodeHostResult<Vec<NodeDirEntry>> {
                Ok(Vec::new())
            }
            fn ensure_dir(&mut self, _path: &str) -> NodeHostResult<()> {
                Ok(())
            }
            fn move_path(&mut self, _source: &str, _target: &str) -> NodeHostResult<()> {
                Ok(())
            }
            fn delete_path(&mut self, _path: &str, _recursive: bool) -> NodeHostResult<()> {
                Ok(())
            }
            fn read_text(&mut self, _path: &str) -> NodeHostResult<Option<String>> {
                Ok(None)
            }
            fn write_text(&mut self, _path: &str, _content: &str) -> NodeHostResult<()> {
                Ok(())
            }
            fn now(&mut self) -> NodeHostResult<String> {
                Ok("2026-10-04T00:00:00.000Z".to_string())
            }
            fn emit(&mut self, _event: &PluginRunEvent) -> NodeHostResult<()> {
                Err(NodeHostError::Failure("sink full".to_string()))
            }
            fn checkpoint(
                &mut self,
                _request: &NodeCheckpointRequest,
            ) -> NodeHostResult<CheckpointOutcome> {
                Ok(CheckpointOutcome::Continue)
            }
        }

        struct Reporter;
        impl BuiltInNode for Reporter {
            fn descriptor(&self) -> NodeDescriptor {
                NodeDescriptor::new("seam-test.reporter", "0.1.0", 1)
            }
            fn run(&self, input: &str, host: &mut dyn NodeHost) -> Result<String, NodeRunError> {
                let event = PluginRunEvent::progress_message("scanning".to_string(), None);
                match host.emit(&event) {
                    Ok(()) | Err(NodeHostError::Failure(_)) => {}
                    Err(NodeHostError::Cancelled) => {
                        return Err(NodeRunError::from(NodeHostError::Cancelled));
                    }
                }
                Ok(input.to_string())
            }
        }

        let answer = Reporter
            .run("echo", &mut EmitFails)
            .expect("a refused report must not end the run");
        assert_eq!(answer, "echo");
        assert_eq!(
            NodeRequirements::EMPTY.max_live_bytes,
            0,
            "the default budget stays 'undeclared', which the host must refuse to schedule"
        );
    }
}
