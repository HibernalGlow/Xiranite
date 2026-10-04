//! The deterministic [`NodeHost`] double the crate's own tests run against.
//!
//! It replaces the retired `plugins/linedup/src/memory_files.rs` (`MemoryFiles`) plus the two
//! `run_control.rs` doubles (`ContinueThroughRunControl`, `CancelAfterCheckpoints`) with one host,
//! because ADR-0073 gives a native node one machine to talk to instead of a file port and a control
//! port. It is `#[cfg(test)]`, not a public module the way `memory_files.rs` was: the reason that
//! module gave for being public — "the CLI and the TUI read the same business implementation and both
//! need to run the file flows against a buffer" — no longer holds, since a native face is handed the
//! host's real `NodeHost` and can pass a buffer-backed one of its own if it wants a preview.
//!
//! The methods Linedup has no use for (`stat`, `list_dir`, `ensure_dir`, `move_path`, `delete_path`,
//! `now`, `emit`) record the call and answer with a failure naming itself. That is the test-side half of
//! the node's requirement declaration: if the node ever starts asking for a listing or a clock, every
//! affected run turns red instead of quietly widening what the descriptor claims.

use std::collections::BTreeMap;

use xiranite_node_registry::{
    NodeCheckpointRequest, NodeDirEntry, NodeHost, NodeHostError, NodeHostResult, NodePathInfo,
};
use xiranite_plugin_api::{CheckpointOutcome, PluginRunEvent};

/// A host with an in-memory file table and scripted boundary answers.
pub struct TestHost {
    /// Every call in order, as `"<method> <args…>"`.
    pub calls: Vec<String>,
    pub files: BTreeMap<String, String>,
    pub read_failures: BTreeMap<String, String>,
    pub write_failures: BTreeMap<String, String>,
    /// How many `checkpoint` calls have been answered.
    pub checkpoints: usize,
    /// Which checkpoint starts answering `Cancelled`; `None` never cancels. Data on purpose, the way
    /// `xiranite-node-registry`'s own double states it: a host that cancels by accident makes
    /// "the run completed" unprovable.
    pub cancel_at: Option<usize>,
    /// Answer every `checkpoint` with `Ok(Paused)` — a report, not a stop.
    pub pause_first: bool,
    /// Answer every `read_text` with `Err(Cancelled)`, so the file arm of the cancel path is reachable
    /// without a second batch loop.
    pub cancel_on_read: bool,
    /// Answer the first `checkpoint` with `Err(Failure(..))` — the host broke, nobody pressed cancel.
    pub fail_checkpoint: bool,
}

impl TestHost {
    /// A host with no files and no cancellation.
    #[must_use]
    pub fn new() -> Self {
        Self {
            calls: Vec::new(),
            files: BTreeMap::new(),
            read_failures: BTreeMap::new(),
            write_failures: BTreeMap::new(),
            checkpoints: 0,
            cancel_at: None,
            pause_first: false,
            cancel_on_read: false,
            fail_checkpoint: false,
        }
    }

    /// A host where `path` holds `content`, chained.
    #[must_use]
    pub fn with_file(mut self, path: &str, content: &str) -> Self {
        self.files.insert(path.to_owned(), content.to_owned());
        self
    }

    /// A host where reading `path` fails with `reason`, chained.
    #[must_use]
    pub fn with_read_failure(mut self, path: &str, reason: &str) -> Self {
        self.read_failures.insert(path.to_owned(), reason.to_owned());
        self
    }

    /// A host where writing `path` fails with `reason`, chained.
    #[must_use]
    pub fn with_write_failure(mut self, path: &str, reason: &str) -> Self {
        self.write_failures.insert(path.to_owned(), reason.to_owned());
        self
    }

    /// A host whose `nth` checkpoint (1-based) answers `Cancelled`.
    #[must_use]
    pub fn cancelling_at(mut self, checkpoint_number: usize) -> Self {
        self.cancel_at = Some(checkpoint_number);
        self
    }

    /// A host that reports the operation paused at every boundary — and never stops the run for it.
    ///
    /// Only sound for a run that yields more than once, which means a batch under
    /// `crate::filter_core::CHECKPOINT_LINE_BATCH`; the test that uses it says so in its own call.
    #[must_use]
    pub fn pausing_once(mut self) -> Self {
        self.pause_first = true;
        self
    }

    /// A host that breaks at the first boundary instead of being cancelled.
    #[must_use]
    pub fn with_failing_checkpoint(mut self) -> Self {
        self.fail_checkpoint = true;
        self
    }

    /// What a run wrote, for the assertions that must not read the repository's disk.
    #[must_use]
    pub fn contents_of(&self, path: &str) -> Option<String> {
        self.files.get(path).cloned()
    }

    /// Every path currently held, in key order.
    #[must_use]
    pub fn paths(&self) -> Vec<String> {
        self.files.keys().cloned().collect()
    }

    fn note(&mut self, call: &str) {
        self.calls.push(call.to_owned());
    }

    /// The answer for a method Linedup's descriptor does not ask for.
    fn unexpected(&mut self, method: &str) -> NodeHostError {
        self.note(method);
        NodeHostError::Failure(format!("{method}: linedup declares no need for this host call"))
    }
}

impl Default for TestHost {
    fn default() -> Self {
        Self::new()
    }
}

impl NodeHost for TestHost {
    fn stat(&mut self, path: &str) -> NodeHostResult<NodePathInfo> {
        Err(self.unexpected(&format!("stat {path}")))
    }

    fn list_dir(&mut self, path: &str) -> NodeHostResult<Vec<NodeDirEntry>> {
        Err(self.unexpected(&format!("list_dir {path}")))
    }

    fn ensure_dir(&mut self, path: &str) -> NodeHostResult<()> {
        Err(self.unexpected(&format!("ensure_dir {path}")))
    }

    fn move_path(&mut self, source: &str, target: &str) -> NodeHostResult<()> {
        Err(self.unexpected(&format!("move_path {source} {target}")))
    }

    fn delete_path(&mut self, path: &str, recursive: bool) -> NodeHostResult<()> {
        Err(self.unexpected(&format!("delete_path {path} {recursive}")))
    }

    fn read_text(&mut self, path: &str) -> NodeHostResult<Option<String>> {
        self.note(&format!("read_text {path}"));
        if self.cancel_on_read {
            return Err(NodeHostError::Cancelled);
        }
        if let Some(reason) = self.read_failures.get(path) {
            return Err(NodeHostError::Failure(reason.clone()));
        }
        Ok(self.files.get(path).cloned())
    }

    fn write_text(&mut self, path: &str, content: &str) -> NodeHostResult<()> {
        self.note(&format!("write_text {path} {}", content.len()));
        if let Some(reason) = self.write_failures.get(path) {
            return Err(NodeHostError::Failure(reason.clone()));
        }
        self.files.insert(path.to_owned(), content.to_owned());
        Ok(())
    }

    fn now(&mut self) -> NodeHostResult<String> {
        Err(self.unexpected("now"))
    }

    fn emit(&mut self, event: &PluginRunEvent) -> NodeHostResult<()> {
        Err(self.unexpected(&format!("emit {:?}", event.kind())))
    }

    fn checkpoint(&mut self, request: &NodeCheckpointRequest) -> NodeHostResult<CheckpointOutcome> {
        self.checkpoints += 1;
        self.note(&format!(
            "checkpoint {} {}/{}",
            request.phase, request.processed_item_count, request.total_item_count
        ));
        if self.fail_checkpoint {
            return Err(NodeHostError::Failure("operation row disappeared".to_string()));
        }
        if self.pause_first {
            return Ok(CheckpointOutcome::Paused);
        }
        if self.cancel_at.is_some_and(|number| self.checkpoints >= number) {
            return Err(NodeHostError::Cancelled);
        }
        Ok(CheckpointOutcome::Continue)
    }
}

#[cfg(test)]
mod tests {
    use super::TestHost;
    use xiranite_node_registry::NodeHost;

    /// The double's own contract, so a green run assertion cannot mean "the double never answered".
    #[test]
    fn a_file_effect_the_node_never_declares_is_recorded_and_refused() {
        let mut host = TestHost::new();
        let error = host
            .list_dir("/data")
            .expect_err("an undeclared listing must not answer successfully");
        assert!(matches!(error, xiranite_node_registry::NodeHostError::Failure(_)));
        assert_eq!(host.calls, vec!["list_dir /data".to_owned()]);
        // The batch bound the node documents, asserted where it is defined rather than in a manifest
        // nothing reads any more.
        assert_eq!(crate::filter_core::CHECKPOINT_LINE_BATCH, 4096);
    }

    #[test]
    fn a_read_of_an_absent_path_answers_none_the_way_the_seam_defines_it() {
        let mut host = TestHost::new();
        assert_eq!(host.read_text("/data/nope.txt").expect("a miss is not a failure"), None);
    }
}
