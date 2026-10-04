//! The host side of the seam, against a real filesystem and a real operation.
//!
//! These run the same code path a built-in node runs in production, which is the point of ADR-0073:
//! there is no wasm guest in this loop any more, so the assertions are about granted roots, event
//! streams and pause semantics instead of about envelopes and ABI codes.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use xiranite_core::ManualClock;
use xiranite_core::filesystem::FileCapability;
use xiranite_core::{OperationManager, OperationManagerOptions};
use xiranite_native_host::NativeNodeHost;
use xiranite_node_registry::{NodeCheckpointRequest, NodeHost, NodeHostError};
use xiranite_plugin_api::PluginRunEvent;
use xiranite_plugin_api::checkpoint::CheckpointOutcome;

struct Harness {
    root: tempfile::TempDir,
    manager: OperationManager,
    operation_id: String,
    clock: ManualClock,
}

impl Harness {
    fn new() -> Self {
        let root = tempfile::tempdir().expect("grant root");
        let clock = ManualClock::new(1_700_000_000_000);
        let manager = OperationManager::with_clock(
            Arc::new(clock.clone()),
            OperationManagerOptions::default(),
        );
        let control = manager.start("dissolvef", None, None);
        let operation_id = control.operation_id().to_string();
        manager.mark_running(&operation_id).expect("running");
        Self { root, manager, operation_id, clock }
    }

    fn host(&self) -> NativeNodeHost {
        let granted: Vec<&Path> = vec![self.root.path()];
        NativeNodeHost::new(
            self.manager.clone(),
            self.manager
                .control(&self.operation_id)
                .expect("the operation this harness started"),
            FileCapability::new(granted),
            Arc::new(self.clock.clone()),
        )
    }

    fn path(&self, name: &str) -> PathBuf {
        self.root.path().join(name)
    }
}

fn text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[test]
fn file_access_round_trips_through_the_granted_root() {
    let harness = Harness::new();
    let mut host = harness.host();

    let dir = text(&harness.path("work"));
    host.ensure_dir(&dir).expect("create_dir_all");
    let file = text(&harness.path("work/notes.txt"));
    host.write_text(&file, "first line\n")
        .expect("write_text creates the parent");

    let info = host.stat(&file).expect("stat answers");
    assert!(info.exists && info.is_file && !info.is_directory);
    assert_eq!(info.path, file, "the caller's own spelling must survive");

    let listing = host
        .list_dir(&dir)
        .expect("one level of the granted directory");
    assert_eq!(listing.len(), 1);
    assert_eq!(listing[0].name, "notes.txt");
    assert_eq!(listing[0].path, file);

    assert_eq!(
        host.read_text(&file).expect("readable"),
        Some("first line\n".to_string())
    );

    let moved = text(&harness.path("work/moved.txt"));
    host.move_path(&file, &moved).expect("rename");
    assert!(
        !host.stat(&file).expect("stat after move").exists,
        "the source must read as gone, not as an error"
    );
    assert!(host.stat(&moved).expect("stat target").exists);

    host.delete_path(&moved, false).expect("a file deletes");
    assert!(!host.stat(&moved).expect("stat after delete").exists);
}

#[test]
fn a_path_outside_the_grant_reads_as_missing_to_the_node_and_fails_the_listing() {
    let harness = Harness::new();
    let mut host = harness.host();
    let outside = "/definitely/not/granted/x.txt";

    let info = host
        .stat(outside)
        .expect("a refusal must not become a failed run");
    assert!(
        !info.exists,
        "the seam documents a refused path as missing; a Failure here would stop a whole plan"
    );
    assert_eq!(info.path, outside, "the lenient arm keeps the caller's spelling");

    // The asymmetry is deliberate and asserted so it cannot drift silently: listing has no "missing"
    // answer, so a refusal crosses as a failure the caller can see.
    let listing = host.list_dir(outside);
    assert!(
        matches!(listing, Err(NodeHostError::Failure(_))),
        "list_dir must not pretend an ungranted directory is empty: {listing:?}"
    );

    // Positive control for both arms: inside the grant, both still work.
    let inside = text(&harness.path("inside"));
    host.ensure_dir(&inside).expect("granted create");
    assert!(host.stat(&inside).expect("granted stat").is_directory);
    assert_eq!(host.list_dir(&inside).expect("granted list").len(), 0);
}

#[test]
fn delete_without_recursion_refuses_a_non_empty_directory() {
    let harness = Harness::new();
    let mut host = harness.host();
    let dir = text(&harness.path("folder"));
    host.ensure_dir(&dir).expect("create");
    host.write_text(&text(&harness.path("folder/keep.txt")), "x")
        .expect("fill");

    let error = host
        .delete_path(&dir, false)
        .expect_err("rmdir semantics are what stops a batch node discarding content");
    assert!(matches!(error, NodeHostError::Failure(_)), "{error:?}");
    assert!(host.stat(&dir).expect("still there").is_directory);

    host.delete_path(&dir, true).expect("recursive delete");
    assert!(!host.stat(&dir).expect("stat after recursive").exists);
}

#[test]
fn the_clock_crosses_as_the_millisecond_utc_spelling_the_journals_already_carry() {
    let harness = Harness::new();
    let mut host = harness.host();
    assert_eq!(
        host.now().expect("host clock"),
        "2023-11-14T22:13:20.000Z",
        "1_700_000_000_000 ms must render exactly as `new Date().toISOString()` did"
    );
    harness.clock.set(0);
    assert_eq!(host.now().expect("epoch"), "1970-01-01T00:00:00.000Z");
}

#[test]
fn an_event_lands_in_the_operations_stream_and_a_dead_operation_fails_the_report_only() {
    let harness = Harness::new();
    let mut host = harness.host();

    host.emit(&PluginRunEvent::progress_message("scanning folders", None))
        .expect("a running operation accepts events");
    let page = harness
        .manager
        .events(&harness.operation_id, None, None)
        .expect("the operation exists");
    assert_eq!(page.events.len(), 1, "{:?}", page.events);
    assert_eq!(page.total, 1);

    harness.manager.cancel(&harness.operation_id, "test");
    let error = host
        .emit(&PluginRunEvent::log_message("after cancel"))
        .expect_err("a terminal operation rejects the line");
    assert!(
        matches!(error, NodeHostError::Failure(_)),
        "a dropped report is not a cancelled run: {error:?}"
    );
}

fn request() -> NodeCheckpointRequest {
    NodeCheckpointRequest {
        phase: "dissolving",
        processed_item_count: 1,
        total_item_count: 4,
    }
}

#[test]
fn a_running_operation_continues_and_a_cancelled_one_stops_the_run() {
    let harness = Harness::new();
    let mut host = harness.host();
    assert_eq!(
        host.checkpoint(&request()).expect("running"),
        CheckpointOutcome::Continue
    );

    harness.manager.cancel(&harness.operation_id, "operator");
    assert_eq!(
        host.checkpoint(&request()),
        Err(NodeHostError::Cancelled),
        "the node must be able to tell a cancel from a failed item"
    );
}

#[test]
fn a_pause_on_a_plain_thread_waits_for_the_resume_instead_of_lying_about_it() {
    let harness = Harness::new();
    let mut host = harness.host().with_pause_poll_interval(Duration::from_millis(5));
    harness.manager.pause(&harness.operation_id);

    let waiter = std::thread::spawn(move || host.checkpoint(&request()));
    std::thread::sleep(Duration::from_millis(60));
    assert!(!waiter.is_finished(), "a paused operation must not release the node");
    harness.manager.resume(&harness.operation_id);

    assert_eq!(
        waiter.join().expect("the wait ended"),
        Ok(CheckpointOutcome::Continue)
    );
}

#[test]
fn a_cancel_arrives_while_the_plain_thread_is_waiting() {
    let harness = Harness::new();
    let mut host = harness.host().with_pause_poll_interval(Duration::from_millis(5));
    harness.manager.pause(&harness.operation_id);

    let waiter = std::thread::spawn(move || host.checkpoint(&request()));
    std::thread::sleep(Duration::from_millis(20));
    harness.manager.cancel(&harness.operation_id, "operator");

    assert_eq!(waiter.join().expect("cancelled while parked"), Err(NodeHostError::Cancelled));
}

/// The cooperative arm: inside a multi-thread runtime the wait is the operation's own oneshot
/// waiters, not a sleep loop. `spawn_blocking` is how the runtime lane already drives a node.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_pause_on_a_blocking_thread_parks_on_the_real_waiters() {
    let harness = Harness::new();
    let mut host = harness.host();
    harness.manager.pause(&harness.operation_id);

    let started = Instant::now();
    let waiter = tokio::task::spawn_blocking(move || host.checkpoint(&request()));
    std::thread::sleep(Duration::from_millis(80));
    harness.manager.resume(&harness.operation_id);

    assert_eq!(
        waiter.await.expect("task ran").expect("resumed"),
        CheckpointOutcome::Continue
    );
    assert!(
        started.elapsed() >= Duration::from_millis(40),
        "the call returned in {:?}, so it did not actually wait for the resume",
        started.elapsed()
    );
}

#[tokio::test(flavor = "current_thread")]
async fn a_single_thread_runtime_falls_back_to_the_wait_loop_instead_of_panicking() {
    let harness = Harness::new();
    let mut host = harness.host().with_pause_poll_interval(Duration::from_millis(5));
    harness.manager.pause(&harness.operation_id);

    let waiter = std::thread::spawn(move || host.checkpoint(&request()));
    std::thread::sleep(Duration::from_millis(30));
    harness.manager.resume(&harness.operation_id);

    assert_eq!(
        waiter.join().expect("the poll arm served a current-thread runtime"),
        Ok(CheckpointOutcome::Continue)
    );
}
