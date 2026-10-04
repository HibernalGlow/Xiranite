//! A `NodeHost` double for this crate's own unit tests.
//!
//! Kept small and boring on purpose: the seam's behaviour under cancel and refusal is already
//! pinned by `crates/xiranite-native-host/tests/native_node_host.rs`, so what these tests need is a
//! host that records that a call *landed* and can be told to cancel from a given checkpoint.
//! Integration tests use the real [`xiranite_native_host::NativeNodeHost`] instead, which is what
//! makes their event-stream and grant assertions worth something.

use xiranite_node_registry::{
    NodeCheckpointRequest, NodeDirEntry, NodeHost, NodeHostError, NodeHostResult, NodePathInfo,
};
use xiranite_plugin_api::PluginRunEvent;
use xiranite_plugin_api::checkpoint::CheckpointOutcome;

/// The clock answer every scripted run gets, so a test can assert on it literally.
pub(crate) const SCRIPTED_NOW: &str = "2023-11-14T22:13:20.000Z";

/// Records calls, answers from data, and starts cancelling at a chosen checkpoint.
pub(crate) struct CountingHost {
    /// Every call, in order, in the `verb argument` shape the seam's own double uses.
    pub(crate) calls: Vec<String>,
    /// `Some(path)` makes that path's `read_text` answer `None` and its `stat` answer missing.
    pub(crate) missing_path: Option<String>,
    /// Which checkpoint starts answering `Cancelled`; `None` never cancels. Stated as data: a host
    /// that cancels by accident makes "the run finished" unprovable.
    pub(crate) cancel_at: Option<usize>,
    checkpoints: usize,
}

impl CountingHost {
    #[must_use]
    pub(crate) fn new() -> Self {
        Self { calls: Vec::new(), missing_path: None, cancel_at: None, checkpoints: 0 }
    }

    fn note(&mut self, call: String) {
        self.calls.push(call);
    }
}

impl Default for CountingHost {
    fn default() -> Self {
        Self::new()
    }
}

impl NodeHost for CountingHost {
    fn stat(&mut self, path: &str) -> NodeHostResult<NodePathInfo> {
        self.note(format!("stat {path}"));
        if self.missing_path.as_deref() == Some(path) {
            return Ok(NodePathInfo::missing(path));
        }
        Ok(NodePathInfo {
            path: path.to_string(),
            exists: true,
            is_file: !path.ends_with('/'),
            is_directory: path.ends_with('/'),
        })
    }

    fn list_dir(&mut self, path: &str) -> NodeHostResult<Vec<NodeDirEntry>> {
        self.note(format!("list_dir {path}"));
        if self.missing_path.as_deref() == Some(path) {
            return Err(NodeHostError::Failure(format!("permission denied: {path}")));
        }
        Ok(vec![NodeDirEntry {
            name: "a.txt".to_string(),
            path: format!("{path}/a.txt"),
            is_file: true,
            is_directory: false,
        }])
    }

    fn ensure_dir(&mut self, path: &str) -> NodeHostResult<()> {
        self.note(format!("ensure_dir {path}"));
        Ok(())
    }

    fn move_path(&mut self, source: &str, target: &str) -> NodeHostResult<()> {
        self.note(format!("move_path {source} {target}"));
        Ok(())
    }

    fn delete_path(&mut self, path: &str, recursive: bool) -> NodeHostResult<()> {
        self.note(format!("delete_path {path} {recursive}"));
        Ok(())
    }

    fn read_text(&mut self, path: &str) -> NodeHostResult<Option<String>> {
        self.note(format!("read_text {path}"));
        if self.missing_path.as_deref() == Some(path) {
            return Ok(None);
        }
        Ok(Some(format!("body of {path}")))
    }

    fn write_text(&mut self, path: &str, content: &str) -> NodeHostResult<()> {
        self.note(format!("write_text {path} {}", content.len()));
        Ok(())
    }

    fn now(&mut self) -> NodeHostResult<String> {
        self.note("now".to_string());
        Ok(SCRIPTED_NOW.to_string())
    }

    fn emit(&mut self, event: &PluginRunEvent) -> NodeHostResult<()> {
        self.note(format!("emit {:?} {}", event.kind(), event.message()));
        Ok(())
    }

    fn checkpoint(
        &mut self,
        request: &NodeCheckpointRequest,
    ) -> NodeHostResult<CheckpointOutcome> {
        self.checkpoints += 1;
        self.note(format!(
            "checkpoint {} {}/{}",
            request.phase, request.processed_item_count, request.total_item_count
        ));
        if self.cancel_at.is_some_and(|number| self.checkpoints >= number) {
            return Err(NodeHostError::Cancelled);
        }
        Ok(CheckpointOutcome::Continue)
    }
}
