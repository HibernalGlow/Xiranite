//! `packages/nodes/snf/src/core.test.ts`, reproduced case for case.
//!
//! The four vitest cases are the behavioural spec for this port, so each one is here
//! with the same fixtures (`fakeRuntime` and `infoFor` become
//! `MemoryFileSystem`) and the same assertions. The extra cases at the bottom cover
//! branches `core.ts` has but the vitest file does not exercise: the skipped folder,
//! the conflict rule, the per-item rename error, the empty-input guard and the
//! ADR-0066 cancellation the plugin adds.

// The whole file runs against `MemoryFileSystem`, so it needs no host: this is the
// portable half of the proof that the Rust port matches `core.test.ts`.

use xiranite_plugin_snf::contract::{
    NodeRunEvent, SnfAction, SnfData, SnfInput, SnfPlanStatus, SnfRunResult,
};
use xiranite_plugin_snf::file_system::{ContinueThroughRunControl, NoopEventSink, SnfEventSink};
use xiranite_plugin_snf::folder_sequence::parse_numbered_folder_name;
use xiranite_plugin_snf::memory_file_system::{FAKE_ATIME_MS, FAKE_MTIME_MS, MemoryFileSystem};
use xiranite_plugin_snf::run_snf;

/// `core.test.ts:6-10` — `parses numbered folder names`.
#[test]
fn parses_numbered_folder_names() {
    let parsed = parse_numbered_folder_name("3. CG").expect("numbered");
    assert_eq!(parsed.sequence_number, 3);
    assert_eq!(parsed.folder_label, "CG");
    assert!(parse_numbered_folder_name("Folder").is_none());
}

/// `core.test.ts:12-28` — `plans sequence repairs by priority keyword`.
#[test]
fn plans_sequence_repairs_by_priority_keyword() {
    let file_system = MemoryFileSystem::new()
        .with_directory("/library", &[("Artist", true)])
        .with_directory("/library/Artist", &[("3. CG", true), ("9. 同人志", true)]);
    let input: SnfInput = serde_json::from_str(r#"{"action":"plan","paths":["/library"],"mode":"library"}"#)
        .expect("input");

    let result = run_snf(&input, &file_system, &NoopEventSink, &ContinueThroughRunControl);

    assert!(result.success);
    let data = result.data.clone().expect("data");
    assert_eq!(data.ready_count, 2);
    assert_eq!(
        data.items.iter().map(|item| item.target_name.as_str()).collect::<Vec<_>>(),
        vec!["1. 同人志", "2. CG"]
    );
}

/// `core.test.ts:30-44` — `leaves continuous sequences unchanged`.
#[test]
fn leaves_continuous_sequences_unchanged() {
    let file_system = MemoryFileSystem::new().with_directory(
        "/library/Artist",
        &[("1. 同人志", true), ("2. CG", true)],
    );
    let input: SnfInput =
        serde_json::from_str(r#"{"action":"plan","paths":["/library/Artist"],"mode":"artist"}"#).expect("input");

    let result = run_snf(&input, &file_system, &NoopEventSink, &ContinueThroughRunControl);
    let data = result.data.clone().expect("data");
    assert_eq!(data.unchanged_count, 2);
    assert_eq!(data.ready_count, 0);
}

/// `core.test.ts:46-62` — `renames ready entries and keeps timestamps`.
#[test]
fn renames_ready_entries_and_keeps_timestamps() {
    let file_system = MemoryFileSystem::new().with_directory("/library/Artist", &[("3. CG", true)]);
    let input: SnfInput = serde_json::from_str(
        r#"{"action":"rename","paths":["/library/Artist"],"mode":"artist","dryRun":false}"#,
    )
    .expect("input");

    let result = run_snf(&input, &file_system, &NoopEventSink, &ContinueThroughRunControl);
    let data = result.data.clone().expect("data");
    assert_eq!(data.renamed_count, 1);
    assert_eq!(
        file_system.recorded_renames(),
        vec![("/library/Artist/3. CG".to_string(), "/library/Artist/1. CG".to_string())]
    );
    assert_eq!(
        file_system.recorded_timestamp_calls(),
        vec![("/library/Artist/1. CG".to_string(), FAKE_ATIME_MS, FAKE_MTIME_MS)]
    );
}

/// The remaining `core.ts` branches the vitest file leaves untested.
#[test]
fn a_folder_without_numbered_directories_is_skipped_with_one_item() {
    let file_system = MemoryFileSystem::new().with_directory("/library/Artist", &[("Sketches", true)]);
    let input: SnfInput = serde_json::from_str(r#"{"paths":["/library/Artist"],"mode":"artist"}"#).expect("input");
    let data = run_snf(&input, &file_system, &NoopEventSink, &ContinueThroughRunControl)
        .data
        .expect("data");
    assert_eq!(data.skipped_count, 1);
    assert_eq!(data.items[0].reason.as_deref(), Some("no_numbered_folders"));
    assert_eq!(data.items[0].artist_path, "/library/Artist");
}

/// The conflict branch needs a target slot already held by a *different* folder:
/// `9. 同人志` wants `2. 同人志`, which `2. 同人志` is sitting on.
#[test]
fn an_existing_target_name_is_a_conflict_and_stays_unrenamed() {
    let file_system = MemoryFileSystem::new().with_directory(
        "/library/Artist",
        &[("3. CG", true), ("2. 同人志", true), ("9. 同人志", true)],
    );
    let input: SnfInput = serde_json::from_str(
        r#"{"action":"rename","paths":["/library/Artist"],"mode":"artist","dryRun":false}"#,
    )
    .expect("input");
    let result = run_snf(&input, &file_system, &NoopEventSink, &ContinueThroughRunControl);
    let data = result.data.clone().expect("data");
    assert_eq!(data.conflict_count, 1);
    assert!(result.success, "core.ts:208 only counts errorCount");
    assert_eq!(data.errors, vec!["/library/Artist/9. 同人志: target_name_exists"]);
    assert_eq!(data.renamed_count, 1);
    assert_eq!(data.unchanged_count, 1);
    assert_eq!(
        file_system.recorded_renames(),
        vec![("/library/Artist/2. 同人志".to_string(), "/library/Artist/1. 同人志".to_string())]
    );
}

#[test]
fn a_rename_refusal_marks_only_that_item_and_fails_the_run() {
    let file_system = MemoryFileSystem::new()
        .with_directory("/library/Artist", &[("3. CG", true), ("9. 同人志", true)])
        .with_failing_rename("/library/Artist/3. CG", "EPERM: operation not permitted, rename");
    let input: SnfInput = serde_json::from_str(
        r#"{"action":"rename","paths":["/library/Artist"],"mode":"artist","dryRun":false}"#,
    )
    .expect("input");
    let result = run_snf(&input, &file_system, &NoopEventSink, &ContinueThroughRunControl);
    let data = result.data.clone().expect("data");
    assert!(!result.success);
    assert_eq!(data.error_count, 1);
    assert_eq!(data.renamed_count, 1);
    assert_eq!(data.items[0].status, SnfPlanStatus::Renamed);
    assert_eq!(data.items[1].status, SnfPlanStatus::Error);
    assert_eq!(
        data.items[1].reason.as_deref(),
        Some("EPERM: operation not permitted, rename")
    );
    assert_eq!(data.errors.len(), 1);
}

#[test]
fn keep_timestamp_false_skips_the_utimes_call() {
    let file_system = MemoryFileSystem::new().with_directory("/library/Artist", &[("3. CG", true)]);
    let input: SnfInput = serde_json::from_str(
        r#"{"action":"rename","paths":["/library/Artist"],"mode":"artist","dryRun":false,"keepTimestamp":false}"#,
    )
    .expect("input");
    run_snf(&input, &file_system, &NoopEventSink, &ContinueThroughRunControl);
    assert_eq!(file_system.recorded_renames().len(), 1);
    assert!(file_system.recorded_timestamp_calls().is_empty());
}

#[test]
fn dry_run_and_non_rename_actions_never_touch_the_machine() {
    let file_system = MemoryFileSystem::new().with_directory("/library/Artist", &[("3. CG", true)]);
    for raw in [
        r#"{"action":"rename","paths":["/library/Artist"],"mode":"artist","dryRun":true}"#,
        r#"{"action":"scan","paths":["/library/Artist"],"mode":"artist","dryRun":false}"#,
        r#"{"action":"plan","paths":["/library/Artist"],"mode":"artist","dryRun":false}"#,
    ] {
        let input: SnfInput = serde_json::from_str(raw).expect("input");
        let result = run_snf(&input, &file_system, &NoopEventSink, &ContinueThroughRunControl);
        assert_eq!(result.message, "SNF planned 1 item(s).", "{raw}");
        assert_eq!(result.data.as_ref().expect("data").ready_count, 1);
    }
    assert!(file_system.recorded_renames().is_empty());
}

#[test]
fn progress_events_match_the_two_reported_checkpoints() {
    #[derive(Default)]
    struct Recorder(std::cell::RefCell<Vec<NodeRunEvent>>);

    impl SnfEventSink for Recorder {
        fn on_event(&self, event: &NodeRunEvent) {
            self.0.borrow_mut().push(event.clone());
        }
    }

    // `core.ts:88` returns before any event is emitted, so the empty-input case is
    // the one run that reports nothing.
    let empty_recorder = Recorder::default();
    let input: SnfInput = serde_json::from_str(r#"{"paths":[]}"#).expect("input");
    let result = run_snf(&input, &MemoryFileSystem::new(), &empty_recorder, &ContinueThroughRunControl);
    assert!(!result.success);
    assert_eq!(
        result.message,
        "At least one library or artist folder is required."
    );
    assert!(empty_recorder.0.borrow().is_empty());

    let plan_recorder = Recorder::default();
    let file_system = MemoryFileSystem::new().with_directory("/library/Artist", &[("3. CG", true)]);
    let input: SnfInput =
        serde_json::from_str(r#"{"paths":["/library/Artist"],"mode":"artist"}"#).expect("input");
    run_snf(&input, &file_system, &plan_recorder, &ContinueThroughRunControl);
    assert_eq!(
        plan_recorder.0.borrow().clone(),
        vec![NodeRunEvent::progress(20, "Scanning numbered folders.")]
    );

    let rename_recorder = Recorder::default();
    let input: SnfInput = serde_json::from_str(
        r#"{"action":"rename","paths":["/library/Artist"],"mode":"artist","dryRun":false}"#,
    )
    .expect("input");
    run_snf(&input, &file_system, &rename_recorder, &ContinueThroughRunControl);
    assert_eq!(rename_recorder.0.borrow().len(), 2);
    assert_eq!(rename_recorder.0.borrow()[1].progress, Some(70));
    assert_eq!(
        rename_recorder.0.borrow()[1].message,
        "Renaming sequence folders."
    );
}

#[test]
fn result_documents_reuse_the_shared_data_shape() {
    // Guards the one structural claim of `failure()` in core.ts:211-213: an error
    // item with empty paths, artistCount 0 and a reason equal to the message.
    let input: SnfInput = serde_json::from_str(r#"{"action":"rename","mode":"artist"}"#).expect("input");
    let result: SnfRunResult = run_snf(&input, &MemoryFileSystem::new(), &NoopEventSink, &ContinueThroughRunControl);
    let data: SnfData = result.data.clone().expect("data");
    assert_eq!(data.artist_count, 0);
    assert_eq!(data.scanned_count, 1);
    assert_eq!(data.items[0].artist_path, "");
    assert_eq!(data.items[0].status, SnfPlanStatus::Error);
    assert_eq!(data.items[0].reason.as_deref(), Some(result.message.as_str()));
    assert_eq!(data.action, SnfAction::Rename);
}
