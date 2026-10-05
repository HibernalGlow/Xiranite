//! Behavioural contract for the ported TimeU core.
//!
//! The four cases in `packages/nodes/timeu/src/core.test.ts` are reproduced first,
//! in the same shape and against the same fake host (`crate::test_runtime`),
//! because that file is the specification. The remaining cases cover what `core.ts`
//! defines but that file leaves unpinned — target collection and ordering, the
//! derived record path, the `dryRun` gate, the restore fall-through for an
//! unrecognised action, the merge that leaves untouched records unstamped, the fact
//! that restore stamps the *record file's* path text rather than the freshly listed
//! one, and the ADR-0066 checkpoint.

use serde_json::json;

use crate::test_runtime::{
    FAKE_NOW_ISO, FAKE_NOW_MS, FakeTimeuRuntime, RECORD_PATH, data_json, event_pairs, record,
    records_from, run, run_with_sink, written_records,
};
use crate::timeu_core::{
    TIMEU_NO_PATHS_MESSAGE, build_backup_plan, build_restore_plan, build_timeu_data,
    collect_timeu_targets, current_timestamp_records, default_record_path, dump_timestamp_records,
    load_timestamp_records, mark_plan_success, merge_timestamp_records,
};
use crate::timeu_model::{
    TimeuPlanOperation, TimeuPlanStatus, TimeuRunEventKind, TimeuTimestampRecord,
};
use crate::timeu_runtime::CollectingTimeuEventSink;

// ---------------------------------------------------------------------------
// The four cases from core.test.ts.
// ---------------------------------------------------------------------------

#[test]
fn backs_up_timestamps_into_a_json_record_file() {
    let runtime = FakeTimeuRuntime::new().with_file("/root/a.txt", 1000.0, 2000.0);
    let result = run(
        &runtime,
        json!({ "action": "backup", "paths": ["/root/a.txt"], "recordPath": RECORD_PATH, "dryRun": false }),
    );

    assert!(result.success, "{}", result.message);
    assert_eq!(result.message, "TimeU backed up 1 timestamp record(s).");
    assert_eq!(data_json(&result)["backupCount"], json!(1));

    let parsed = written_records(&runtime, RECORD_PATH);
    assert_eq!(parsed[0]["path"], json!("/root/a.txt"));
    assert_eq!(parsed[0]["atimeMs"], json!(1000));
    assert_eq!(parsed[0]["mtimeMs"], json!(2000));
    assert_eq!(parsed[0]["backedUpAt"], json!(FAKE_NOW_ISO));
    assert_eq!(runtime.writes().len(), 1, "the record file is the only write");
    assert!(runtime.listing_paths().is_empty(), "a file target is never listed");
}

#[test]
fn restores_atime_and_mtime_from_stored_records() {
    let runtime = FakeTimeuRuntime::new()
        .with_file("/root/a.txt", 1000.0, 2000.0)
        .with_stored_records(RECORD_PATH, &[record("/root/a.txt", 11, 22, FAKE_NOW_ISO)]);

    let result = run(
        &runtime,
        json!({ "action": "restore", "paths": ["/root/a.txt"], "recordPath": RECORD_PATH, "dryRun": false }),
    );

    assert!(result.success, "{}", result.message);
    assert_eq!(result.message, "TimeU restored 1 timestamp(s).");
    assert_eq!(data_json(&result)["restoredCount"], json!(1));
    assert_eq!(
        runtime.applied_times(),
        vec![("/root/a.txt".to_string(), 11.0, 22.0)],
        "core.ts:133 passes the stored atime/mtime through untouched"
    );
    assert!(runtime.writes().is_empty(), "restore never rewrites the record file");
}

#[test]
fn reports_missing_restore_targets_as_skipped() {
    // No `dryRun` in the TypeScript case, so the default `true` keeps this a plan.
    let runtime = FakeTimeuRuntime::new()
        .with_stored_records(RECORD_PATH, &[record("/root/missing.txt", 11, 22, FAKE_NOW_ISO)]);

    let result = run(
        &runtime,
        json!({ "action": "restore", "paths": ["/root/missing.txt"], "recordPath": RECORD_PATH }),
    );

    assert!(result.success, "{}", result.message);
    let data = data_json(&result);
    assert_eq!(data["skippedCount"], json!(1));
    assert_eq!(data["plan"][0]["reason"], json!("path_missing"));
    assert_eq!(data["plan"][0]["status"], json!("skipped"));
    assert_eq!(data["recordPath"], json!(RECORD_PATH));
    assert!(runtime.applied_times().is_empty());
}

#[test]
fn merges_records_by_path() {
    let existing = records_from(&json!([record("/root/a.txt", 1, 2, "old")]));
    let current = records_from(&json!([record("/root/a.txt", 5, 6, "new")]));

    let merged = merge_timestamp_records(&existing, &current, FAKE_NOW_MS).expect("merge");
    assert_eq!(merged.len(), 1);
    assert_eq!(
        merged[0],
        TimeuTimestampRecord::new("/root/a.txt", 5.0, 6.0, 7.0, 8.0, FAKE_NOW_ISO),
        "core.test.ts:48-50: the current record wins and only backedUpAt is replaced"
    );
}

// ---------------------------------------------------------------------------
// Behaviour core.ts defines but core.test.ts left unpinned.
// ---------------------------------------------------------------------------

#[test]
fn empty_path_list_fails_without_touching_the_host() {
    let runtime = FakeTimeuRuntime::new();
    let result = run(&runtime, json!({ "action": "backup", "dryRun": false }));

    assert!(!result.success);
    assert_eq!(result.message, TIMEU_NO_PATHS_MESSAGE);
    let data = data_json(&result);
    assert_eq!(data["plan"][0]["path"], json!(""));
    assert_eq!(data["plan"][0]["status"], json!("error"));
    assert_eq!(data["plan"][0]["reason"], json!(TIMEU_NO_PATHS_MESSAGE));
    assert_eq!(data["recordPath"], json!(""));
    assert_eq!(data["errorCount"], json!(1));
    assert_eq!(runtime.checkpoint_count(), 0);
}

#[test]
fn scan_and_dry_run_emit_the_same_progress_chain_and_never_write() {
    let cases: [(&str, serde_json::Value); 3] = [
        ("scan", json!({ "action": "scan", "paths": ["/root/a.txt"] })),
        ("backup with the dryRun default", json!({ "action": "backup", "paths": ["/root/a.txt"] })),
        ("backup with explicit dryRun", json!({ "action": "backup", "paths": ["/root/a.txt"], "dryRun": true })),
    ];

    for (label, input) in cases {
        let runtime = FakeTimeuRuntime::new().with_file("/root/a.txt", 1000.0, 2000.0);
        let mut sink = CollectingTimeuEventSink::new();
        let result = run_with_sink(&runtime, input, &mut sink);

        assert!(result.success, "{label}: {}", result.message);
        assert_eq!(result.message, "TimeU planned 1 item(s).", "{label}");
        assert_eq!(
            event_pairs(&sink),
            vec![
                (Some(15.0), "Collecting timestamp targets.".to_string()),
                (Some(45.0), "Planning 1 timestamp item(s).".to_string()),
            ],
            "{label}: core.ts:102 and core.ts:106 are the only events before the dry-run return"
        );
        assert!(
            sink.events.iter().all(|event| event.kind == TimeuRunEventKind::Progress),
            "{label}"
        );
        assert!(runtime.writes().is_empty(), "{label} must not write");
        assert!(runtime.applied_times().is_empty(), "{label} must not stamp");
    }
}

#[test]
fn backup_and_restore_progress_events_use_the_typescript_percentages() {
    let runtime = FakeTimeuRuntime::new()
        .with_file("/root/a.txt", 1000.0, 2000.0)
        .with_stored_records(RECORD_PATH, &[record("/root/a.txt", 11, 22, FAKE_NOW_ISO)]);
    let mut sink = CollectingTimeuEventSink::new();
    let _ = run_with_sink(
        &runtime,
        json!({ "action": "restore", "paths": ["/root/a.txt"], "recordPath": RECORD_PATH, "dryRun": false }),
        &mut sink,
    );
    assert_eq!(
        event_pairs(&sink),
        vec![
            (Some(15.0), "Collecting timestamp targets.".to_string()),
            (Some(45.0), "Planning 1 timestamp item(s).".to_string()),
            (Some(75.0), "Restoring timestamps.".to_string()),
        ]
    );

    let backup_runtime = FakeTimeuRuntime::new().with_file("/root/a.txt", 1000.0, 2000.0);
    let mut backup_sink = CollectingTimeuEventSink::new();
    let _ = run_with_sink(
        &backup_runtime,
        json!({ "action": "backup", "paths": ["/root/a.txt"], "recordPath": RECORD_PATH, "dryRun": false }),
        &mut backup_sink,
    );
    assert_eq!(
        event_pairs(&backup_sink)[2],
        (Some(75.0), "Writing timestamp records.".to_string()),
        "core.ts:118 is the backup branch's third event"
    );
}

#[test]
fn target_collection_is_recursive_deduplicated_and_naturally_sorted() {
    let runtime = FakeTimeuRuntime::new()
        .with_file("/root/a.txt", 1.0, 2.0)
        .with_file("/root/b/file-10.txt", 1.0, 2.0)
        .with_file("/root/b/file-2.txt", 1.0, 2.0)
        .with_directory("/root", &["/root/a.txt", "/root/b"])
        .with_directory("/root/b", &["/root/b/file-10.txt", "/root/b/file-2.txt"]);

    let targets =
        collect_timeu_targets(&["/root".to_string()], true, false, &runtime).expect("collection");

    assert_eq!(
        targets,
        vec![
            "/root/a.txt".to_string(),
            "/root/b/file-2.txt".to_string(),
            "/root/b/file-10.txt".to_string(),
        ],
        "the directory itself is not a target without includeDirectories, and 2 sorts before 10"
    );
    assert_eq!(runtime.listing_paths(), vec!["/root".to_string(), "/root/b".to_string()]);
}

#[test]
fn include_directories_adds_each_directory_once() {
    let runtime = FakeTimeuRuntime::new()
        .with_file("/root/b/c.txt", 1.0, 2.0)
        .with_directory("/root", &["/root/b"])
        .with_directory("/root/b", &["/root/b/c.txt"]);

    let targets =
        collect_timeu_targets(&["/root".to_string(), "/root/b".to_string()], true, true, &runtime)
            .expect("collection");

    assert_eq!(
        targets,
        vec!["/root".to_string(), "/root/b".to_string(), "/root/b/c.txt".to_string()],
        "the double visit core.ts:160 performs collapses through the Set"
    );
}

#[test]
fn non_recursive_collection_never_lists_a_directory() {
    let runtime = FakeTimeuRuntime::new()
        .with_file("/root/a.txt", 1.0, 2.0)
        .with_file("/root/b/deep.txt", 1.0, 2.0)
        .with_directory("/root", &["/root/a.txt", "/root/b"])
        .with_directory("/root/b", &["/root/b/deep.txt"]);

    let targets = collect_timeu_targets(
        &[
            "/root".to_string(),
            "/root/a.txt".to_string(),
            "/root/b".to_string(),
            "/root/missing.txt".to_string(),
        ],
        false,
        false,
        &runtime,
    )
    .expect("collection");

    assert_eq!(
        targets,
        vec!["/root/a.txt".to_string(), "/root/missing.txt".to_string()],
        "a listed directory is not a target unless it is included, and a missing path keeps its raw text"
    );
    assert!(runtime.listing_paths().is_empty(), "core.ts:154 only lists when recursive is set");
}

#[test]
fn listing_failure_propagates_as_the_failure_result_the_catch_produced() {
    let runtime = FakeTimeuRuntime::new()
        .with_directory("/root", &["/root/a.txt"])
        .with_list_failure("/root", "EACCES: permission denied, scandir '/root'");
    let result = run(
        &runtime,
        json!({ "action": "scan", "paths": ["/root"], "recordPath": RECORD_PATH }),
    );

    assert!(!result.success);
    assert_eq!(result.message, "EACCES: permission denied, scandir '/root'");
    assert_eq!(data_json(&result)["recordPath"], json!(RECORD_PATH));
    assert_eq!(data_json(&result)["plan"][0]["status"], json!("error"));
}

#[test]
fn default_record_path_sits_next_to_the_first_target() {
    let runtime = FakeTimeuRuntime::new();
    assert_eq!(
        default_record_path(&["/root/deep/a.txt".to_string()], &runtime),
        "/root/deep/timeu-timestamps.json"
    );
    assert_eq!(
        default_record_path(&[], &runtime),
        "timeu-timestamps.json",
        "core.ts:247 falls back to the bare file name"
    );

    let collected = FakeTimeuRuntime::new()
        .with_file("/root/a.txt", 1.0, 2.0)
        .with_directory("/root", &["/root/a.txt"]);
    let result = run(
        &collected,
        json!({ "action": "backup", "paths": ["/root/a.txt"], "dryRun": false }),
    );
    assert_eq!(
        data_json(&result)["recordPath"],
        json!("/root/timeu-timestamps.json"),
        "core.ts:104 derives the record path from the collected targets, not from the input"
    );
    assert_eq!(collected.writes()[0].0, "/root/timeu-timestamps.json");
    assert_eq!(collected.ensured_directories(), vec!["/root".to_string()]);
}

#[test]
fn unknown_action_falls_through_to_the_restore_branch_like_the_typescript() {
    let runtime = FakeTimeuRuntime::new().with_file("/root/a.txt", 1000.0, 2000.0);
    let result = run(
        &runtime,
        json!({ "action": "wipe", "paths": ["/root/a.txt"], "recordPath": RECORD_PATH, "dryRun": false }),
    );

    assert!(result.success, "{}", result.message);
    assert_eq!(result.message, "TimeU restored 0 timestamp(s).");
    assert!(runtime.applied_times().is_empty(), "a backup plan has no stored records to apply");
    assert_eq!(data_json(&result)["plan"][0]["operation"], json!("backup"));
    assert_eq!(data_json(&result)["plan"][0]["status"], json!("pending"));
}

#[test]
fn restore_matches_records_case_insensitively_and_stamps_the_record_path_text() {
    let runtime = FakeTimeuRuntime::new()
        .with_file("D:/dir/a.txt", 1.0, 2.0)
        .with_file("D:/dir/b.txt", 1.0, 2.0)
        .with_directory("D:/dir", &["D:/dir/a.txt", "D:/dir/b.txt"])
        .with_stored_records(
            "D:/timeu.json",
            &[
                record("D:/DIR/A.TXT", 11, 22, FAKE_NOW_ISO),
                record("D:/dir/b.txt", 111, 222, FAKE_NOW_ISO),
            ],
        )
        .with_set_times_failure("D:/dir/b.txt", "EPERM: operation not permitted");

    let result = run(
        &runtime,
        json!({ "action": "restore", "paths": ["D:/dir"], "recordPath": "D:/timeu.json", "dryRun": false }),
    );

    assert!(!result.success, "core.ts:238 fails the run when any item errored");
    let data = data_json(&result);
    assert_eq!(data["restoredCount"], json!(1));
    assert_eq!(data["errorCount"], json!(1));
    assert_eq!(data["scannedCount"], json!(2));
    assert_eq!(data["errors"], json!(["D:/dir/b.txt: EPERM: operation not permitted"]));
    assert_eq!(
        runtime.applied_times(),
        vec![("D:/DIR/A.TXT".to_string(), 11.0, 22.0)],
        "normalizePathKey matched the differently-cased record, and core.ts:133 stamps the record's own path text"
    );
}

#[test]
fn backup_keeps_untouched_stored_records_and_their_original_stamp() {
    let runtime = FakeTimeuRuntime::new().with_file("/root/a.txt", 1000.0, 2000.0).with_stored_records(
        RECORD_PATH,
        &[record("/root/gone.txt", 7, 8, "2020-01-01T00:00:00.000Z")],
    );

    let result = run(
        &runtime,
        json!({ "action": "backup", "paths": ["/root/a.txt"], "recordPath": RECORD_PATH, "dryRun": false }),
    );

    let merged = written_records(&runtime, RECORD_PATH);
    assert_eq!(merged.len(), 2);
    assert_eq!(merged[0]["path"], json!("/root/a.txt"));
    assert_eq!(merged[0]["backedUpAt"], json!(FAKE_NOW_ISO));
    assert_eq!(
        merged[1]["backedUpAt"],
        json!("2020-01-01T00:00:00.000Z"),
        "core.ts:214 only re-stamps the records that were just read"
    );
    assert_eq!(data_json(&result)["backupCount"], json!(1));
    assert_eq!(data_json(&result)["scannedCount"], json!(1));
}

#[test]
fn record_file_that_is_not_json_fails_the_run_and_a_non_array_reads_as_empty() {
    let broken = FakeTimeuRuntime::new()
        .with_file("/root/a.txt", 1.0, 2.0)
        .with_read(RECORD_PATH, "{ not json");
    let result = run(
        &broken,
        json!({ "action": "scan", "paths": ["/root/a.txt"], "recordPath": RECORD_PATH }),
    );
    assert!(!result.success, "{}", result.message);
    assert_eq!(data_json(&result)["recordPath"], json!(RECORD_PATH));
    assert_eq!(data_json(&result)["plan"][0]["status"], json!("error"));

    let object_document = FakeTimeuRuntime::new().with_read(RECORD_PATH, r#"{"a":1}"#);
    assert!(
        load_timestamp_records(RECORD_PATH, &object_document)
            .expect("valid json")
            .is_empty(),
        "core.ts:204 returns no records for a document that is not an array"
    );

    let whitespace = FakeTimeuRuntime::new().with_read(RECORD_PATH, "   \n");
    assert!(load_timestamp_records(RECORD_PATH, &whitespace).expect("blank").is_empty());
    assert!(load_timestamp_records("", &whitespace).expect("no path").is_empty());
    assert!(load_timestamp_records("/root/absent.json", &whitespace).expect("unreadable").is_empty());
}

#[test]
fn invalid_records_are_filtered_and_fractional_milliseconds_are_rounded() {
    let filtered = records_from(&json!([
        { "path": "/root/ok.txt", "atimeMs": 1, "mtimeMs": 2 },
        { "path": 42, "atimeMs": 1, "mtimeMs": 2 },
        { "path": "/root/bad.txt", "atimeMs": "1", "mtimeMs": 2 },
        { "path": "/root/also-ok.txt", "atimeMs": 12.5, "mtimeMs": 20 },
        "not an object",
    ]));
    assert_eq!(
        filtered.iter().map(|entry| entry.path.clone()).collect::<Vec<String>>(),
        vec!["/root/ok.txt".to_string(), "/root/also-ok.txt".to_string()],
        "core.ts:205 keeps only records whose path is a string and whose atime/mtime are numbers"
    );
    assert_eq!(filtered[1].atime_ms, 12.5, "a stored fraction survives to utimes");

    let runtime = FakeTimeuRuntime::new()
        .with_file("/root/0.txt", 1000.4, 1.0)
        .with_file("/root/1.txt", 1000.6, 1.0)
        .with_file("/root/2.txt", 1000.5, 1.0)
        .with_file("/root/3.txt", 999.5, 1.0);
    let paths: Vec<String> = (0..4).map(|index| format!("/root/{index}.txt")).collect();
    let records = current_timestamp_records(&paths, &runtime).expect("records");

    assert_eq!(
        records.iter().map(|entry| entry.atime_ms).collect::<Vec<f64>>(),
        vec![1000.0, 1001.0, 1001.0, 1000.0],
        "core.ts:176 applies ECMAScript Math.round, not half-away-from-zero"
    );
    assert_eq!(records.len(), paths.len(), "every existing target becomes a record");
    assert!(records
        .iter()
        .all(|entry| entry.backed_up_at.as_deref() == Some(FAKE_NOW_ISO)));
}

#[test]
fn a_cancelled_checkpoint_stops_the_run_before_any_write_or_stamp() {
    // Checkpoints: one per collected path, one per current-record read, then one
    // per restore item, so index 3 is the first restore item.
    let restore_runtime = FakeTimeuRuntime::new()
        .with_file("/root/a.txt", 1.0, 2.0)
        .with_stored_records(RECORD_PATH, &[record("/root/a.txt", 11, 22, FAKE_NOW_ISO)])
        .cancelled_at_checkpoint(3);
    let result = run(
        &restore_runtime,
        json!({ "action": "restore", "paths": ["/root/a.txt"], "recordPath": RECORD_PATH, "dryRun": false }),
    );

    assert!(!result.success);
    assert_eq!(result.message, "Operation cancelled.");
    assert_eq!(result.data.as_ref().expect("data").plan[0].status, TimeuPlanStatus::Error);
    assert_eq!(restore_runtime.applied_times().len(), 0);

    let backup_runtime = FakeTimeuRuntime::new()
        .with_file("/root/a.txt", 1.0, 2.0)
        .cancelled_at_checkpoint(2);
    let backup_result = run(
        &backup_runtime,
        json!({ "action": "backup", "paths": ["/root/a.txt"], "recordPath": RECORD_PATH, "dryRun": false }),
    );

    assert!(!backup_result.success);
    assert_eq!(backup_result.message, "Operation cancelled.");
    assert!(backup_runtime.writes().is_empty(), "cancellation before the write phase wrote nothing");
}

#[test]
fn checkpoints_happen_once_per_work_item() {
    let runtime = FakeTimeuRuntime::new()
        .with_file("/root/a.txt", 1.0, 2.0)
        .with_file("/root/b.txt", 1.0, 2.0)
        .with_directory("/root", &["/root/a.txt", "/root/b.txt"])
        .with_stored_records(
            RECORD_PATH,
            &[record("/root/a.txt", 11, 22, FAKE_NOW_ISO), record("/root/b.txt", 33, 44, FAKE_NOW_ISO)],
        );
    let result = run(
        &runtime,
        json!({ "action": "restore", "paths": ["/root"], "recordPath": RECORD_PATH, "dryRun": false }),
    );

    assert!(result.success, "{}", result.message);
    // 1 for the collected `/root`, 2 for the two current-record reads and 2 for the
    // two restore items. The number may move as the phases change, as long as it
    // stays proportional to the work items, which is what ADR-0066's item-length
    // bounded pause latency depends on.
    assert_eq!(runtime.checkpoint_count(), 5);
    assert_eq!(data_json(&result)["restoredCount"], json!(2));
}

#[test]
fn dump_uses_two_space_pretty_json_and_a_trailing_newline() {
    let records = records_from(&json!([record("/root/a.txt", 1000, 2000, FAKE_NOW_ISO)]));
    assert_eq!(
        dump_timestamp_records(&records),
        "[\n  {\n    \"path\": \"/root/a.txt\",\n    \"atimeMs\": 1000,\n    \"mtimeMs\": 2000,\n    \
         \"ctimeMs\": 2001,\n    \"birthtimeMs\": 2002,\n    \"backedUpAt\": \"2026-01-01T00:00:00.000Z\"\n  }\n]\n"
    );
    assert_eq!(dump_timestamp_records(&[]), "[]\n", "JSON.stringify([], null, 2)");
}

#[test]
fn plan_builders_and_summary_counts_follow_the_typescript_shapes() {
    let records = records_from(&json!([record("/root/a.txt", 1, 2, FAKE_NOW_ISO)]));
    let backup_plan = build_backup_plan(&records);
    assert_eq!(backup_plan.len(), 1);
    assert_eq!(backup_plan[0].status, TimeuPlanStatus::Pending);
    assert_eq!(backup_plan[0].operation, TimeuPlanOperation::Backup);
    assert_eq!(backup_plan[0].stored, None);
    assert_eq!(backup_plan[0].current.as_ref().expect("current record").path, "/root/a.txt");

    let restore_plan = build_restore_plan(&[], &records);
    assert_eq!(restore_plan[0].status, TimeuPlanStatus::Skipped);
    assert_eq!(restore_plan[0].reason.as_deref(), Some("path_missing"));
    assert_eq!(restore_plan[0].operation, TimeuPlanOperation::Restore);

    let data = build_timeu_data(&restore_plan, &records, RECORD_PATH);
    assert_eq!(data.scanned_count, 1);
    assert_eq!(data.skipped_count, 1);
    assert_eq!(data.backup_count, 0);
    assert_eq!(data.restored_count, 0);
    assert_eq!(data.error_count, 0);
    assert!(data.errors.is_empty());
    assert_eq!(data.records.len(), 1);

    let marked = mark_plan_success(&backup_plan);
    assert_eq!(marked[0].status, TimeuPlanStatus::Success);
    assert_eq!(
        backup_plan[0].status,
        TimeuPlanStatus::Pending,
        "core.ts:219 maps to new items instead of mutating the plan"
    );
}

#[test]
fn a_missing_target_produces_no_record_and_an_empty_backup_still_writes() {
    let runtime = FakeTimeuRuntime::new();
    let result = run(
        &runtime,
        json!({ "action": "backup", "paths": ["/root/absent.txt"], "recordPath": RECORD_PATH, "dryRun": false }),
    );

    assert!(result.success, "{}", result.message);
    assert_eq!(result.message, "TimeU backed up 0 timestamp record(s).");
    assert_eq!(written_records(&runtime, RECORD_PATH), vec![], "an empty merge still writes the file");
    assert_eq!(data_json(&result)["scannedCount"], json!(0));
}
