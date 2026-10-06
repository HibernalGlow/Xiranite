//! Shared scaffolding for the executor's integration tests.
//!
//! Every test here runs against the **real** host chain —
//! [`xiranite_native_host::NativeNodeHost`] over a granted [`xiranite_core::filesystem::FileCapability`],
//! a [`ManualClock`] and a live [`OperationManager`] — rather than a stub, because the claims under
//! test are about that chain: an event landing in the operation's stream, a path outside the grant
//! reading as missing, a pause parking the run. A stub would make all three assertions vacuous.
//!
//! Temp roots live under this crate's own `tests/tmp/`, not `/tmp`: `/tmp` can disappear during a
//! long session, and a fixture that vanishes mid-run reads as a filesystem bug rather than a test
//! problem. The directory is removed on drop.

#![allow(dead_code, reason = "each integration test binary includes this module and uses part of it")]

use std::path::{Path, PathBuf};
use std::sync::Arc;

use xiranite_core::filesystem::FileCapability;
use xiranite_core::{ManualClock, NodeRunEventRecord, OperationManager, OperationManagerOptions};
use xiranite_native_host::NativeNodeHost;

/// The epoch the clock starts at: `2023-11-14T22:13:20.000Z`, the spelling the seam's own tests use.
pub const HARNESS_EPOCH_MS: u64 = 1_700_000_000_000;

/// A temporary directory owned by one test.
pub struct TempRoot {
    path: PathBuf,
}

impl TempRoot {
    /// Creates `<crate>/tests/tmp/<tag>-<counter>-<pid>`, unique per test and per retry.
    #[must_use]
    pub fn new(tag: &str) -> Self {
        let counter = next_sequence();
        let path = workspace_tmp().join(format!("{tag}-{}-{counter}", std::process::id()));
        std::fs::create_dir_all(&path)
            .unwrap_or_else(|error| panic!("could not create {}: {error}", path.display()));
        // Canonicalising matters on macOS: a granted root that is a symlink (`/var` -> `/private/var`)
        // compares unequal to the paths `FileCapability` resolves, so the grant would look empty.
        let canonical = std::fs::canonicalize(&path).unwrap_or(path);
        Self { path: canonical }
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The granted root as a string, the way a node names it.
    #[must_use]
    pub fn text(&self) -> String {
        self.path.to_string_lossy().into_owned()
    }

    #[must_use]
    pub fn join(&self, name: &str) -> PathBuf {
        self.path.join(name)
    }

    /// The path as the text a host call names.
    #[must_use]
    pub fn url(&self, name: &str) -> String {
        self.join(name).to_string_lossy().into_owned()
    }

    /// Writes a file directly, for setting up a run without going through the seam.
    pub fn write(&self, name: &str, contents: &str) {
        let path = self.join(name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("parent directory");
        }
        std::fs::write(path, contents).expect("fixture file written");
    }

    /// Reads a file directly, for asserting what a run left behind.
    #[must_use]
    pub fn read(&self, name: &str) -> Option<String> {
        std::fs::read_to_string(self.join(name)).ok()
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn workspace_tmp() -> PathBuf {
    // `CARGO_MANIFEST_DIR` is this crate's directory, so the tree stays inside the crate the task
    // owns and never depends on a system temporary directory.
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/tmp")
}

fn next_sequence() -> u32 {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    COUNTER.fetch_add(1, Ordering::Relaxed)
}

/// One operation, its machine access, and the files it was granted.
pub struct Harness {
    pub root: TempRoot,
    pub manager: OperationManager,
    pub operation_id: String,
    pub clock: ManualClock,
}

impl Harness {
    /// Starts a running operation over an empty granted root.
    #[must_use]
    pub fn new(tag: &str, node_id: &str) -> Self {
        let root = TempRoot::new(tag);
        let clock = ManualClock::new(HARNESS_EPOCH_MS);
        let manager = OperationManager::with_clock(
            Arc::new(clock.clone()),
            OperationManagerOptions::default(),
        );
        let control = manager.start(node_id, None, None);
        let operation_id = control.operation_id().to_string();
        manager.mark_running(&operation_id).expect("the operation is marked running");
        Self { root, manager, operation_id, clock }
    }

    /// A host bound to this operation, the way the runtime builds one per run.
    #[must_use]
    pub fn host(&self) -> NativeNodeHost {
        let granted: Vec<&Path> = vec![self.root.path()];
        NativeNodeHost::new(
            self.manager.clone(),
            self.manager
                .control(&self.operation_id)
                .expect("the operation this harness started"),
            FileCapability::new(granted),
            Arc::new(self.clock.clone()),
        )
        .with_pause_poll_interval(std::time::Duration::from_millis(5))
    }

    /// A host that grants nothing, for the refusal arms.
    #[must_use]
    pub fn denied_host(&self) -> NativeNodeHost {
        NativeNodeHost::new(
            self.manager.clone(),
            self.manager
                .control(&self.operation_id)
                .expect("the operation this harness started"),
            FileCapability::denied(),
            Arc::new(self.clock.clone()),
        )
        .with_pause_poll_interval(std::time::Duration::from_millis(5))
    }

    /// Asks the operation to cancel, which is what an operator's cancel does today.
    pub fn cancel(&self) {
        self.manager.cancel(&self.operation_id, "integration test");
    }

    /// Asks the operation to pause, parking any run that reaches a checkpoint.
    pub fn pause(&self) {
        self.manager.pause(&self.operation_id);
    }

    pub fn resume(&self) {
        self.manager.resume(&self.operation_id);
    }

    /// The operation's event stream, as the monitor would read it.
    pub fn events(&self) -> Vec<NodeRunEventRecord> {
        let page = self
            .manager
            .events(&self.operation_id, None, None)
            .expect("the operation this harness started");
        page.events.into_iter().map(|indexed| indexed.event).collect()
    }

    /// The event messages, in stream order, as `(kind, message)` pairs.
    pub fn event_lines(&self) -> Vec<(String, String)> {
        self.events()
            .into_iter()
            .map(|event| (event.kind.as_str().to_string(), event.message))
            .collect()
    }
}

/// Loads a fixture from this crate's own `tests/fixtures`.
#[must_use]
pub fn fixture(name: &str) -> &'static str {
    // `include_str!` needs a literal path, so the fixtures are listed here rather than read at run
    // time: a missing or renamed fixture must be a compile error, not a test that fails on this
    // machine only.
    match name {
        "pure-node.js" => include_str!("../fixtures/pure-node.js"),
        "platform-node.js" => include_str!("../fixtures/platform-node.js"),
        "spin-node.js" => include_str!("../fixtures/spin-node.js"),
        "leak-node.js" => include_str!("../fixtures/leak-node.js"),
        "grant-node.js" => include_str!("../fixtures/grant-node.js"),
        "writer-node.js" => include_str!("../fixtures/writer-node.js"),
        "function-node.js" => include_str!("../fixtures/function-node.js"),
        "iife-node.js" => include_str!("../fixtures/iife-node.js"),
        "parked-node.js" => include_str!("../fixtures/parked-node.js"),
        "clock-sleep-node.js" => include_str!("../fixtures/clock-sleep-node.js"),
        "sleep-loop-node.js" => include_str!("../fixtures/sleep-loop-node.js"),
        other => panic!("no fixture named {other:?} is listed in tests/support/mod.rs"),
    }
}
