//! A real node against a real machine (ADR-0073 step 5's seed).
//!
//! Every other dissolvef test runs against a double, so the strongest claim the port could make was
//! "the trait is implemented somewhere". These two tests run the registered built-in through
//! `xiranite_native_host::NativeNodeHost` over a `tempdir`: files move on disk, the undo journal is
//! written where the run said it would be, and the progress lines land in the operation's event
//! stream. Nothing here stubs the filesystem.

use std::path::Path;
use std::sync::Arc;

use xiranite_core::filesystem::FileCapability;
use xiranite_core::{ManualClock, OperationManager, OperationManagerOptions};
use xiranite_native_host::NativeNodeHost;
use xiranite_node_registry::BuiltInNode;
use xiranite_node_registry::NodeRegistry;

struct RealRun {
    root: tempfile::TempDir,
    manager: OperationManager,
    operation_id: String,
}

impl RealRun {
    /// Starts one running operation granted exactly `root`, with a fixed clock so journal text is
    /// comparable across machines.
    fn new() -> Self {
        let root = tempfile::tempdir().expect("granted root");
        let clock = ManualClock::new(1_700_000_000_000);
        let manager = OperationManager::with_clock(
            Arc::new(clock.clone()),
            OperationManagerOptions::default(),
        );
        let control = manager.start("dissolvef", None, None);
        let operation_id = control.operation_id().to_string();
        manager.mark_running(&operation_id).expect("running");
        Self { root, manager, operation_id }
    }

    fn host(&self) -> NativeNodeHost {
        let granted: Vec<&Path> = vec![self.root.path()];
        NativeNodeHost::new(
            self.manager.clone(),
            self.manager
                .control(&self.operation_id)
                .expect("the operation this run started"),
            FileCapability::new(granted),
            Arc::new(ManualClock::new(1_700_000_000_000)),
        )
    }

    /// The request document as the HTTP operation protocol carries it, with the host-owned scope.
    ///
    /// Paths are absolute because the granted root is the whole rule: `FileCapability::resolve`
    /// (`crates/xiranite-core/src/filesystem.rs:177`) makes a relative path absolute against the
    /// process cwd, which lands outside the grant and reads as missing.
    fn request(&self, input: &str) -> String {
        let history = self.root.path().join("artifacts/dissolvef.undo.json");
        format!(
            r#"{{"input":{input},"runOptions":{{"operationId":"{}","defaultHistoryPath":"{}","undoRecordIdSuffix":"parity"}}}}"#,
            self.operation_id,
            history.to_string_lossy()
        )
    }

    /// `{"action":"nested","path":"<absolute folder>","enableSimilarity":false}` for this run's root.
    fn nested_input(&self, folder: &Path) -> String {
        format!(
            r#"{{"action":"nested","path":"{}","enableSimilarity":false}}"#,
            folder.to_string_lossy()
        )
    }
}

fn write(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("create parent");
    }
    std::fs::write(path, contents).expect("write");
}

#[test]
fn a_dissolve_run_moves_files_on_the_real_disk_and_records_an_undo_journal() {
    let run = RealRun::new();
    let folder = run.root.path().join("a");
    write(&folder.join("b/inner.txt"), "kept\n");

    let node = NodeRegistry::builtin()
        .expect("this test binary links dissolvef")
        .get("dissolvef")
        .expect("dissolvef is registered");
    assert_eq!(node.id, "dissolvef");

    // `DissolvefNode` is the runnable half; the registry hands out the policy, so this also proves
    // the two halves were built from the same declaration.
    let answer = dissolvef::builtin::DissolvefNode
        .run(&run.request(&run.nested_input(&folder)), &mut run.host())
        .expect("a real run either answers or says why in words");

    let document: serde_json::Value = serde_json::from_str(&answer).expect("response document");
    assert!(
        document["success"].as_bool().unwrap_or(false),
        "the run failed: {document}"
    );
    assert_eq!(document["data"]["nestedCount"], 1, "{document}");
    assert_eq!(
        document["data"]["successCount"], 2,
        "one move plus the folder removal: {document}"
    );

    assert!(folder.join("inner.txt").is_file(), "the moved file is where nested mode put it");
    assert!(!folder.join("b").exists(), "the emptied folder is gone");
    assert!(
        run.root.path().join("artifacts/dissolvef.undo.json").is_file(),
        "the journal the node promised is on disk"
    );

    let journal = std::fs::read_to_string(run.root.path().join("artifacts/dissolvef.undo.json"))
        .expect("journal text");
    assert!(journal.contains("inner.txt"), "journal text: {journal}");
    assert!(
        journal.contains("2023-11-14T22:13:20"),
        "the journal id carries the host clock's spelling, got: {journal}"
    );
}

#[test]
fn the_runs_progress_lines_reach_the_operations_event_stream() {
    let run = RealRun::new();
    write(&run.root.path().join("a/b/inner.txt"), "kept\n");

    let folder = run.root.path().join("a");
    let answer = dissolvef::builtin::DissolvefNode
        .run(&run.request(&run.nested_input(&folder)), &mut run.host())
        .expect("the run completes");
    let document: serde_json::Value = serde_json::from_str(&answer).expect("response document");
    assert!(document["success"].as_bool().unwrap_or(false), "{document}");

    let page = run
        .manager
        .events(&run.operation_id, None, None)
        .expect("the operation is registered");
    assert!(
        page.total >= 1,
        "the node reported progress through the seam, so the stream cannot be empty: {page:?}"
    );
    let messages: Vec<String> = page
        .events
        .iter()
        .map(|event| event.event.message.clone())
        .collect();
    assert!(
        messages.iter().any(|message| message.contains("Dissolv") || message.contains("dissolve")),
        "expected a dissolution progress line, got {messages:?}"
    );
}
