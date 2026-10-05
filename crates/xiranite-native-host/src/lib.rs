//! The host side of the built-in node seam (ADR-0073).
//!
//! A node depends on [`xiranite_node_registry::NodeHost`] and nothing else. Before the rewrite that
//! trait was implemented by an Extism shim: each capability name was a wasm import, every call
//! round-tripped a JSON block, and pause was a 50 ms poll because a wasm host call cannot await
//! (`crates/xiranite-node-runtime/src/capabilities.rs:21-27` said so out loud). This crate implements
//! the same trait against the real machine, in the same process: the granted [`FileCapability`], the
//! host [`Clock`], and the operation's own [`OperationControl`].
//!
//! ## What this crate is not
//!
//! It is not a scheduler and not a launcher. It holds one operation's worth of machine access and is
//! built per run, exactly where `capabilities.rs` used to build `OperationCapabilities`
//! (`crates/xiranite-node-runtime/src/launcher.rs:100-106`). Whoever owns the runtime keeps deciding
//! *when* a node runs; this decides only what a running node may ask the machine for.
//!
//! The one thing a run-builder may pull out of it is the grant itself ([`NativeNodeHost::files`]).
//! [`NodeHost`]'s ten methods carry documents and kinds, and a scripted (QuickJS) run also needs sizes,
//! times, byte ranges, links and temp directories; those go through the same [`FileCapability`], never a
//! second copy of the policy.
//!
//! ## Why pause keeps two arms
//!
//! [`NodeHost::checkpoint`] is synchronous, so waiting has two honest shapes depending on where the
//! node happens to be running. On a blocking thread inside a tokio runtime the call parks on
//! `OperationControl::checkpoint`'s real oneshot waiters — no polling, and `resume`/`cancel` wake it.
//! On a plain thread there is no reactor to park on, so the same state is re-read on an interval;
//! that is the loop the wasm shim needed, kept only where it is still legitimate. A caller that wants
//! the cooperative arm runs the node through `tokio::task::spawn_blocking`, which is what the runtime
//! already does today.

use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, SecondsFormat, Utc};
use tokio::runtime::RuntimeFlavor;
use xiranite_core::filesystem::FileCapability;
use xiranite_core::{
    Clock, NodeRunEventRecord, OperationControl, OperationManager, OperationPhase,
};
use xiranite_node_registry::{
    NodeCheckpointRequest, NodeDirEntry, NodeHost, NodeHostError, NodeHostResult, NodePathInfo,
};
use xiranite_plugin_api::PluginRunEvent;
use xiranite_plugin_api::checkpoint::CheckpointOutcome;

/// The interval the plain-thread checkpoint loop re-reads the operation's phase at.
///
/// 50 ms is the number the wasm shim used (`capabilities.rs:67`): well under what a human notices,
/// and cheap enough that a paused operation does not spin on the mutex.
pub const PAUSE_POLL_INTERVAL: Duration = Duration::from_millis(50);

/// The machine, as one operation may ask for it.
#[derive(Clone, Debug)]
pub struct NativeNodeHost {
    manager: OperationManager,
    control: OperationControl,
    files: FileCapability,
    clock: Arc<dyn Clock>,
    pause_poll_interval: Duration,
}

impl NativeNodeHost {
    /// Binds the seam to one already-started operation.
    #[must_use]
    pub fn new(
        manager: OperationManager,
        control: OperationControl,
        files: FileCapability,
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self { manager, control, files, clock, pause_poll_interval: PAUSE_POLL_INTERVAL }
    }

    /// Overrides the plain-thread poll interval. Tests use it to keep a pause assertion short.
    #[must_use]
    pub fn with_pause_poll_interval(mut self, interval: Duration) -> Self {
        self.pause_poll_interval = interval;
        self
    }

    /// The operation this host serves; every event and checkpoint belongs to it.
    #[must_use]
    pub fn operation_id(&self) -> &str {
        self.control.operation_id()
    }

    /// The grant this host serves, for the machine surface [`NodeHost`] cannot carry.
    ///
    /// [`NodeHost::stat`] answers kind only, because that is the shape the ported native nodes were
    /// written against, and its ten methods carry documents rather than bytes. A scripted run needs
    /// sizes, times, byte ranges, links and temp directories on top of that, and the honest way to give
    /// it is to hand the *same* [`FileCapability`] to the executor rather than a second accessor that
    /// could disagree with the first. `xiranite-native-host` stays free of the executor: this is the
    /// seam the run-builder pulls on (`quickjs-run.rs`, and the runtime's launcher when it adopts
    /// `JsNode`).
    #[must_use]
    pub fn files(&self) -> &FileCapability {
        &self.files
    }

    /// The decision the operation's current state owes a checkpoint.
    ///
    /// Split out because the two wait arms must not disagree: whatever this returns, that is what the
    /// node sees after it stops waiting.
    fn decision(cancel_requested: bool, phase: OperationPhase) -> NodeHostResult<CheckpointOutcome> {
        if cancel_requested || phase.is_terminal() {
            return Err(NodeHostError::Cancelled);
        }
        match phase {
            // `Queued` checkpoints as continue, matching `OperationControl::outcome_for`: the runner
            // writes `running` before the first node call, so a queued phase means nothing to wait for.
            OperationPhase::Paused => Ok(CheckpointOutcome::Paused),
            _ => Ok(CheckpointOutcome::Continue),
        }
    }

    /// Wait out a pause, then answer the state that ended the wait.
    fn checkpoint_now(&self) -> NodeHostResult<CheckpointOutcome> {
        // The cooperative arm: park on the operation's own waiters. `block_in_place` is only legal on
        // a multi-thread runtime; on a current-thread runtime it panics, so that case falls through to
        // the poll arm instead of taking the host down.
        let cooperative = tokio::runtime::Handle::try_current().is_ok_and(|handle| {
            handle.runtime_flavor() == RuntimeFlavor::MultiThread
        });
        if cooperative {
            let control = self.control.clone();
            let decision = tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current().block_on(control.checkpoint())
            });
            // `OperationControl::checkpoint` re-reads until the state is no longer paused, so the
            // outcome it returns is only ever continue or cancel; `Paused` cannot arrive here.
            return match decision.outcome() {
                CheckpointOutcome::Cancelled => Err(NodeHostError::Cancelled),
                outcome => Ok(outcome),
            };
        }

        loop {
            match Self::decision(self.control.cancel_requested(), self.control.phase())? {
                CheckpointOutcome::Paused => std::thread::sleep(self.pause_poll_interval),
                outcome => return Ok(outcome),
            }
        }
    }
}

impl NodeHost for NativeNodeHost {
    fn stat(&mut self, path: &str) -> NodeHostResult<NodePathInfo> {
        match self.files.stat(path) {
            Ok(info) => Ok(NodePathInfo {
                path: info.path,
                exists: info.exists,
                is_file: info.is_file,
                is_directory: info.is_directory,
            }),
            // Kept lenient on purpose: a path outside the grant, unreadable or gone answers
            // `exists: false`, which is what `platform.ts:76`'s `catch` did and what the ported
            // planners branch on. The cost is a mis-set root reading as a missing folder, so the
            // refusal is logged here instead of being pushed into the node.
            Err(error) => {
                tracing::warn!(
                    operation_id = self.operation_id(),
                    path,
                    cause = %error.message(),
                    "stat refused; reporting the path as missing"
                );
                Ok(NodePathInfo::missing(path))
            }
        }
    }

    fn list_dir(&mut self, path: &str) -> NodeHostResult<Vec<NodeDirEntry>> {
        self.files
            .list(path)
            .map(|entries| {
                entries
                    .into_iter()
                    .map(|entry| NodeDirEntry {
                        name: entry.name,
                        path: entry.path,
                        is_file: entry.is_file,
                        is_directory: entry.is_directory,
                    })
                    .collect()
            })
            .map_err(|error| NodeHostError::Failure(error.message()))
    }

    fn ensure_dir(&mut self, path: &str) -> NodeHostResult<()> {
        self.files.ensure_dir(path).map_err(|error| NodeHostError::Failure(error.message()))
    }

    fn move_path(&mut self, source: &str, target: &str) -> NodeHostResult<()> {
        self.files
            .move_path(source, target)
            .map_err(|error| NodeHostError::Failure(error.message()))
    }

    fn delete_path(&mut self, path: &str, recursive: bool) -> NodeHostResult<()> {
        self.files.delete(path, recursive).map_err(|error| NodeHostError::Failure(error.message()))
    }

    fn read_text(&mut self, path: &str) -> NodeHostResult<Option<String>> {
        match self.files.read_text(path) {
            Ok(contents) => Ok(contents),
            Err(error) => {
                tracing::debug!(
                    operation_id = self.operation_id(),
                    path,
                    cause = %error.message(),
                    "read_text failed; the node reads this path as absent"
                );
                Ok(None)
            }
        }
    }

    fn write_text(&mut self, path: &str, content: &str) -> NodeHostResult<()> {
        self.files.write_text(path, content).map_err(|error| NodeHostError::Failure(error.message()))
    }

    fn now(&mut self) -> NodeHostResult<String> {
        Ok(iso_text(self.clock.now_ms()))
    }

    fn emit(&mut self, event: &PluginRunEvent) -> NodeHostResult<()> {
        let record = NodeRunEventRecord {
            kind: event.kind(),
            progress: event.percent().map(xiranite_plugin_api::ProgressPercent::get),
            message: event.message().to_string(),
            data: None,
        };
        match self.manager.push_event(self.operation_id(), record) {
            Some(_) => Ok(()),
            // `push_event` answers `None` for an operation that is gone or already terminal. That is a
            // failed report, not an ended run: only a cancel may end it (see the seam's `emit` doc).
            None => Err(NodeHostError::Failure(format!(
                "operation {} no longer accepts events",
                self.operation_id()
            ))),
        }
    }

    fn checkpoint(&mut self, request: &NodeCheckpointRequest) -> NodeHostResult<CheckpointOutcome> {
        // The request's counters are for the host's own log line; a node that reports nothing still
        // gets the same wait, because pause is a property of the operation, not of the report.
        tracing::debug!(
            operation_id = self.operation_id(),
            phase = request.phase,
            processed = request.processed_item_count,
            total = request.total_item_count,
            "checkpoint"
        );
        self.checkpoint_now()
    }
}

/// The clock spelling the nodes' history rows already carry: `new Date().toISOString()` in
/// `platform.ts:94`, i.e. RFC 3339 with milliseconds and a `Z`, never a local offset.
#[must_use]
pub fn iso_text(epoch_ms: u64) -> String {
    DateTime::<Utc>::from_timestamp_millis(i64::try_from(epoch_ms).unwrap_or_default())
        .map(|moment| moment.to_rfc3339_opts(SecondsFormat::Millis, true))
        .unwrap_or_else(|| "1970-01-01T00:00:00.000Z".to_string())
}
