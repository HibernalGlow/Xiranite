//! The ported `packages/nodes/dissolvef/src/core.test.ts` cases, plus the coverage the new boundary needs.
//!
//! Each test names the TypeScript it comes from. The assertions keep the same messages, counters and field
//! values, because those are the node's published contract. `core.test.ts` ran against a real temporary
//! directory; here `InMemoryDissolvefHost` reproduces `platform.ts`'s filesystem behaviour, so "the file
//! moved and the folder is gone" means the same thing.
//!
//! The extra tests cover what `core.ts` had no equivalent for: the ADR-0066 checkpoint, Windows drive and
//! UNC path spellings, the conflict modes a plan carries into the host, and the journal cap.

use crate::contract::{
    DissolvefConflictMode, DissolvefInput, DissolvefRunScope, normalize_dissolvef_input,
};
use crate::document::{
    CANCELLED_STAT_KEY, DissolveUndoOperation, DissolvefOperation, DissolvefPlanItem, DissolvefResult,
};
use crate::host::DissolvefHost;
use crate::in_memory_host::InMemoryDissolvefHost;
use crate::criteria::normalize_conflict;
use crate::run::run_dissolvef;
use xiranite_plugin_api::CheckpointOutcome;

fn scope() -> DissolvefRunScope {
    DissolvefRunScope {
        operation_id: "op-test".to_string(),
        default_history_path: "/config/artifacts/undo/dissolvef.undo.json".to_string(),
        undo_record_id_suffix: None,
    }
}

fn input(raw: &str) -> DissolvefInput {
    serde_json::from_str(raw).unwrap_or_else(|error| panic!("{raw} is not a DissolveF input: {error}"))
}

fn run(host: &mut InMemoryDissolvefHost, raw: &str) -> DissolvefResult {
    run_dissolvef(&input(raw), &scope(), host)
}

fn first_move(result: &DissolvefResult) -> &DissolvefPlanItem {
    result
        .data
        .plan
        .iter()
        .find(|item| item.operation == DissolvefOperation::Move)
        .expect("the plan carries a move row")
}

/// `core.test.ts:18-21` — "calculates useful filename similarity".
#[test]
fn calculates_useful_filename_similarity() {
    use crate::similarity::calculate_dissolvef_similarity;
    assert_eq!(calculate_dissolvef_similarity("series_a", "series_a.zip"), 1.0);
    assert!(calculate_dissolvef_similarity("alpha", "beta") < 0.9);
}

/// `core.test.ts:23-47` — "collects single archive paths with similarity filtering".
#[test]
fn collects_single_archive_paths_with_similarity_filtering() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("/root/series_a/series_a.zip", "zip");
    host.make_file("/root/series_b/series_b.zip", "zip");
    host.make_file("/root/series_b/readme.txt", "extra");
    host.make_file("/root/alpha/beta.zip", "zip");

    let result = run(
        &mut host,
        r#"{"action":"collect_archives","path":"/root","protectFirstLevel":false,"similarityThreshold":0.9,"skipBlacklist":true}"#,
    );

    assert!(result.success, "{}", result.message);
    assert_eq!(result.message, "Collected 1 archive path(s).");
    assert_eq!(result.data.archive_paths, vec!["/root/series_a/series_a.zip".to_string()]);
    assert_eq!(result.data.skipped_count, 0);
    assert!(host.moves.is_empty() && host.deletes.is_empty(), "the action is read-only");
}

/// `core.test.ts:49-66` — "previews direct dissolve with rename conflict".
#[test]
fn previews_direct_dissolve_with_rename_conflict() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("/root/a.txt", "old");
    host.make_file("/root/box/a.txt", "new");

    let result =
        run(&mut host, r#"{"action":"direct","path":"/root/box","preview":true,"fileConflict":"rename"}"#);

    assert!(result.success, "{}", result.message);
    assert_eq!(result.message, "Plan generated: 2 operation(s).");
    assert_eq!(result.data.direct_files, 1);
    let moved = first_move(&result);
    assert!(moved.target_path.ends_with("a_1.txt"), "target was {}", moved.target_path);
    assert_eq!(moved.source_path, "/root/box/a.txt");
    assert!(host.moves.is_empty() && host.deletes.is_empty(), "a preview never writes");
}

/// `core.test.ts:68-86` — "does not double-plan archive folders in bundle mode".
#[test]
fn does_not_double_plan_archive_folders_in_bundle_mode() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("/root/series_a/series_a.zip", "zip");

    let result = run(
        &mut host,
        r#"{"action":"dissolve","path":"/root","preview":true,"protectFirstLevel":false,"similarityThreshold":0,"skipBlacklist":true}"#,
    );

    assert!(result.success, "{}", result.message);
    assert_eq!(result.data.media_count, 1);
    assert_eq!(result.data.archive_count, 0);
    assert_eq!(result.data.nested_count, 0, "media's claim on the folder blocks the nested group");
    assert_eq!(result.data.total_count, 2);
}

/// `core.test.ts:88-112` — "executes nested dissolve and undo".
#[test]
fn executes_nested_dissolve_and_undo() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("/root/a/b/c/test.txt", "hello");

    let result = run(
        &mut host,
        r#"{"action":"nested","path":"/root/a","historyPath":"/root/history.json","enableSimilarity":false}"#,
    );

    assert!(result.success, "{}", result.message);
    assert_eq!(result.data.nested_count, 1);
    assert_eq!(result.data.success_count, 2, "the move and the recursive delete");
    assert_eq!(result.message, "Dissolve completed: 2 success, 0 skipped, 0 failed.");
    assert!(host.exists("/root/a/test.txt"));
    assert!(!host.exists("/root/a/b"));
    assert_eq!(host.deletes, vec![("/root/a/b".to_string(), true)]);

    // The journal recorded both applied rows, and the id it was given is the document's `operationId`.
    let journal = host.read("/root/history.json").expect("the journal was written");
    let parsed = crate::history::parse_dissolve_history(Some(&journal));
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].id, result.data.operation_id);
    assert!(parsed[0].id.starts_with("dissolve-20260721160454-"), "{}", parsed[0].id);
    assert_eq!(parsed[0].path, "/root/a");
    assert_eq!(parsed[0].count, 2);
    assert_eq!(parsed[0].operations.len(), 2);
    assert_eq!(parsed[0].undone, None);

    let undo = run(&mut host, r#"{"action":"undo","historyPath":"/root/history.json"}"#);
    assert!(undo.success, "{}", undo.message);
    assert_eq!(undo.message, "Undo completed: 2 success, 0 failed.");
    assert!(host.exists("/root/a/b/c/test.txt"));
    assert!(!host.exists("/root/a/test.txt"));

    let journal = host.read("/root/history.json").expect("the journal was rewritten");
    let parsed = crate::history::parse_dissolve_history(Some(&journal));
    assert_eq!(parsed[0].undone, Some(true), "a second undo must not reapply it");
}

/// `core.test.ts:114-146` — "reads and undoes a legacy Python single-record journal".
#[test]
fn reads_and_undoes_a_legacy_python_single_record_journal() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("/root/outer/test.txt", "hello");
    host.make_file(
        "/root/legacy-undo.json",
        r#"{
          "id": "dissolve-legacy",
          "timestamp": "2026-07-21T16:04:54.445129",
          "mode": "nested",
          "path": "/root",
          "count": 2,
          "operations": [
            { "type": "move", "src": "/root/outer/inner/test.txt", "dst": "/root/outer/test.txt", "timestamp": "2026-07-21T16:02:57.405605" },
            { "type": "delete_dir", "src": "/root/outer/inner", "dst": null, "timestamp": "2026-07-21T16:02:57.408122" }
          ]
        }"#,
    );

    let parsed = crate::history::parse_dissolve_history(host.read("/root/legacy-undo.json").as_deref());
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].operations.len(), 2);
    assert_eq!(parsed[0].operations[0].source_path, "/root/outer/inner/test.txt");
    assert_eq!(parsed[0].operations[0].target_path.as_deref(), Some("/root/outer/test.txt"));
    assert_eq!(parsed[0].operations[1].source_path, "/root/outer/inner");
    assert_eq!(parsed[0].operations[1].target_path, None, "a null dst is not a target path");

    let undo = run(&mut host, r#"{"action":"undo","historyPath":"/root/legacy-undo.json"}"#);
    assert!(undo.success, "{}", undo.message);
    assert_eq!(undo.data.success_count, 2);
    assert_eq!(undo.data.failed_count, 0);
    assert!(host.exists("/root/outer/inner/test.txt"));
    assert!(!host.exists("/root/outer/test.txt"));
}

/// `core.test.ts:148-168` — "resumes a partially applied undo without overwriting restored files".
#[test]
fn resumes_a_partially_applied_undo_without_overwriting_restored_files() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("/root/inner/test.txt", "already restored");
    host.make_file(
        "/root/legacy-undo.json",
        r#"{"id":"dissolve-partial","timestamp":"2026-07-21T16:04:54.445129","mode":"nested","path":"/root","count":1,"operations":[{"type":"move","src":"/root/inner/test.txt","dst":"/root/test.txt"}]}"#,
    );

    let undo = run(&mut host, r#"{"action":"undo","historyPath":"/root/legacy-undo.json"}"#);
    assert!(undo.success, "{}", undo.message);
    assert_eq!(undo.data.success_count, 1);
    assert!(host.exists("/root/inner/test.txt"));
    assert_eq!(host.read("/root/inner/test.txt").as_deref(), Some("already restored"));
    assert!(host.moves.is_empty(), "an already-restored file must not move again");
}

// --- coverage the new boundary needs ---------------------------------------------------------------

/// ADR-0066: a checkpoint that answers `3` stops the run before it touches the machine.
#[test]
fn a_cancelled_checkpoint_before_any_work_reports_cancellation() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("/root/a/b/c/test.txt", "hello");
    host.checkpoint_outcome = CheckpointOutcome::Cancelled;
    host.continue_checkpoint_count = 0;

    let result = run(&mut host, r#"{"action":"nested","path":"/root/a","historyPath":"/root/h.json"}"#);

    assert!(!result.success);
    assert!(result.stats.contains_key(CANCELLED_STAT_KEY));
    assert_eq!(result.message, "Dissolve cancelled before the next item.");
    assert!(host.moves.is_empty() && host.deletes.is_empty());
    assert!(host.read("/root/h.json").is_none(), "nothing was journaled");
    assert!(host.exists("/root/a/b/c/test.txt"));
    assert_eq!(host.checkpoints.len(), 1);
    assert_eq!(host.checkpoints[0].phase, crate::host::PHASE_SCANNING);
}

/// ADR-0066 safety: work already applied is still journaled, so it stays undoable.
#[test]
fn a_cancelled_run_journals_the_moves_it_already_applied() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("/root/a/b/c/test.txt", "hello");
    host.checkpoint_outcome = CheckpointOutcome::Cancelled;
    // Four scanning checkpoints (three directories plus one subfolder descent), then the write loop: the
    // first item runs, the checkpoint before the second one stops the run.
    host.continue_checkpoint_count = 5;

    let result = run(
        &mut host,
        r#"{"action":"nested","path":"/root/a","historyPath":"/root/h.json","enableSimilarity":false}"#,
    );

    assert!(!result.success);
    assert!(result.stats.contains_key(CANCELLED_STAT_KEY));
    assert_eq!(result.message, "Dissolve cancelled: 1 success, 0 skipped, 0 failed.");
    assert_eq!(result.data.success_count, 1);
    assert_eq!(result.data.plan.len(), 1, "the row that never ran is not reported");
    assert!(host.exists("/root/a/test.txt"));
    assert!(host.exists("/root/a/b/c"), "the delete never ran, so the chain is still there");
    assert!(!result.data.operation_id.is_empty());
    let parsed = crate::history::parse_dissolve_history(host.read("/root/h.json").as_deref());
    assert_eq!(parsed[0].operations.len(), 1);
    assert_eq!(parsed[0].operations[0].target_path.as_deref(), Some("/root/a/test.txt"));
    assert_eq!(parsed[0].undone, None);
}

/// A pause the host reports without holding the call is not a stop (`CheckpointOutcome::is_hard_stop`).
#[test]
fn a_reported_pause_keeps_the_run_going() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("/root/a/b/c/test.txt", "hello");
    host.checkpoint_outcome = CheckpointOutcome::Paused;
    host.continue_checkpoint_count = 0;

    let result = run(
        &mut host,
        r#"{"action":"nested","path":"/root/a","historyPath":"/root/h.json","enableSimilarity":false}"#,
    );

    assert!(result.success, "{}", result.message);
    assert!(host.exists("/root/a/test.txt"));
    assert!(!host.checkpoints.is_empty());
}

#[test]
fn auto_file_conflict_skips_and_the_following_delete_reports_the_refusal() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("/root/a.txt", "old");
    host.make_file("/root/box/a.txt", "new");

    // `auto` for a file is `skip` (`core.ts:653`), so only the delete is pending — and the folder still has
    // content, which the host must refuse.
    let result = run(&mut host, r#"{"action":"direct","path":"/root/box"}"#);

    assert!(!result.success);
    assert_eq!(result.message, "Dissolve completed: 0 success, 1 skipped, 1 failed.");
    assert_eq!(result.data.skipped_count, 1);
    assert_eq!(result.data.error_count, 1);
    assert_eq!(result.data.errors.len(), 1);
    assert!(result.data.errors[0].contains("ENOTEMPTY"), "{}", result.data.errors[0]);
    assert_eq!(host.read("/root/a.txt").as_deref(), Some("old"));
    assert_eq!(host.read("/root/box/a.txt").as_deref(), Some("new"));
    let skipped =
        result.data.plan.iter().find(|item| item.reason.as_deref() == Some("target_exists"));
    assert!(skipped.is_some(), "the skipped row keeps `core.ts`'s reason");
}

#[test]
fn overwrite_file_conflict_replaces_the_existing_target() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("/root/a.txt", "old");
    host.make_file("/root/box/a.txt", "new");

    let result =
        run(&mut host, r#"{"action":"direct","path":"/root/box","fileConflict":"overwrite"}"#);

    assert!(result.success, "{}", result.message);
    assert_eq!(host.read("/root/a.txt").as_deref(), Some("new"));
    assert!(!host.exists("/root/box/a.txt"));
    assert!(!host.exists("/root/box"));
    assert_eq!(first_move(&result).delete_target, Some(true));
}

#[test]
fn rename_file_conflict_keeps_both_files() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("/root/a.txt", "old");
    host.make_file("/root/box/a.txt", "new");

    let result = run(&mut host, r#"{"action":"direct","path":"/root/box","fileConflict":"rename"}"#);

    assert!(result.success, "{}", result.message);
    assert_eq!(host.read("/root/a.txt").as_deref(), Some("old"));
    assert_eq!(host.read("/root/a_1.txt").as_deref(), Some("new"));
    assert!(!host.exists("/root/box"));
}

#[test]
fn skip_file_conflict_leaves_everything_in_place() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("/root/a.txt", "old");
    host.make_file("/root/box/a.txt", "new");

    let result = run(&mut host, r#"{"action":"direct","path":"/root/box","fileConflict":"skip"}"#);

    assert!(!result.success, "the folder cannot be deleted while its file was skipped");
    assert_eq!(host.read("/root/a.txt").as_deref(), Some("old"));
    assert_eq!(host.read("/root/box/a.txt").as_deref(), Some("new"));
}

#[test]
fn a_directory_collision_merges_under_the_default_dir_conflict() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_directory("/root/shared");
    host.make_file("/root/box/shared/s.txt", "s");
    host.make_file("/root/box/x.txt", "x");

    let result = run(&mut host, r#"{"action":"direct","path":"/root/box"}"#);

    assert!(result.success, "{}", result.message);
    assert_eq!(result.message, "Dissolve completed: 4 success, 0 skipped, 0 failed.");
    assert_eq!(result.data.direct_files, 2);
    assert_eq!(host.read("/root/shared/s.txt").as_deref(), Some("s"));
    assert_eq!(host.read("/root/x.txt").as_deref(), Some("x"));
    assert!(!host.exists("/root/box/shared"));
    assert!(!host.exists("/root/box"));
    assert_eq!(normalize_conflict(DissolvefConflictMode::Auto, true), DissolvefConflictMode::Overwrite);
}

#[test]
fn blacklist_and_exclude_rows_appear_in_the_plan() {
    // `zzz` gives the root two children, so the root itself never qualifies and the two named folders have
    // to be judged as candidates on their own.
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("/root/画集/inner/one.png", "1");
    host.make_file("/root/bonus pack/inner/two.png", "2");
    host.make_file("/root/zzz/a/x.png", "3");
    host.make_file("/root/zzz/b/y.png", "4");

    let result = run(
        &mut host,
        r#"{"action":"nested","path":"/root","preview":true,"protectFirstLevel":false,"exclude":"bonus","enableSimilarity":false}"#,
    );

    assert!(result.success, "{}", result.message);
    let mut reasons: Vec<String> = result.data.plan.iter().filter_map(|item| item.reason.clone()).collect();
    reasons.sort();
    assert_eq!(
        reasons,
        vec![
            "blacklisted".to_string(),
            "blacklisted".to_string(),
            "excluded".to_string(),
            "excluded".to_string()
        ]
    );
    // The substring match is over the whole path (`core.ts:671`), so `画集/inner` is blacklisted too.
    assert_eq!(result.data.skipped_count, 4);
    assert_eq!(result.data.nested_count, 0);

    // Exclude is checked before the blacklist (`core.ts:671-672`), so a name on both lists reads `excluded`.
    let both = run(
        &mut host,
        r#"{"action":"nested","path":"/root","preview":true,"protectFirstLevel":false,"exclude":"画集","enableSimilarity":false}"#,
    );
    assert!(both.data.plan.iter().any(|item| item.reason.as_deref() == Some("excluded")));
    assert!(both.data.plan.iter().all(|item| item.reason.as_deref() != Some("blacklisted")));
}

#[test]
fn skip_blacklist_lets_a_blacklisted_folder_through() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("/root/zzz/a/x.png", "3");
    host.make_file("/root/zzz/b/y.png", "4");
    host.make_file("/root/画集/inner/one.png", "1");

    let guarded = run(
        &mut host,
        r#"{"action":"nested","path":"/root","preview":true,"protectFirstLevel":false,"enableSimilarity":false}"#,
    );
    // `画集` and the folder inside it both match the blacklist on path text (`core.ts:671`).
    assert_eq!(guarded.data.skipped_count, 2);
    assert_eq!(guarded.data.nested_count, 0);

    let unguarded = run(
        &mut host,
        r#"{"action":"nested","path":"/root","preview":true,"protectFirstLevel":false,"skipBlacklist":true,"enableSimilarity":false}"#,
    );
    assert!(unguarded.data.plan.iter().all(|item| item.reason.is_none()));
    assert_eq!(unguarded.data.nested_count, 1);
}

#[test]
fn a_weakly_matching_child_is_skipped_with_its_score() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_directory("/root/alpha/beta");

    let strict = run(
        &mut host,
        r#"{"action":"nested","path":"/root","preview":true,"protectFirstLevel":false,"similarityThreshold":0.9}"#,
    );
    // `/root` is judged against `alpha` (no shared letters: score 0) and `/root/alpha` against `beta`
    // (4 of 5 letters differ: score 0.2). Both are below 0.9.
    assert_eq!(strict.data.skipped_count, 2);
    let row = &strict.data.plan[0];
    assert_eq!(row.reason.as_deref(), Some("similarity_below_threshold"));
    assert_eq!(row.source_path, "/root/alpha");
    assert_eq!(row.similarity.expect("a score is reported").get(), 0.0);
    let second = &strict.data.plan[1];
    assert_eq!(second.source_path, "/root/alpha/beta");
    assert!((second.similarity.expect("a score is reported").get() - 0.2).abs() < 1e-12);

    // Turning the gate off is what `interaction.ts`'s `enableSimilarity` boolean is for.
    let lenient = run(
        &mut host,
        r#"{"action":"nested","path":"/root","preview":true,"protectFirstLevel":false,"similarityThreshold":0.9,"enableSimilarity":false}"#,
    );
    assert_eq!(lenient.data.nested_count, 1);
    assert_eq!(lenient.data.skipped_count, 0);
}

#[test]
fn protect_first_level_hides_the_direct_children_of_the_root() {
    // Two first-level chains, so the root itself never qualifies and only its children could.
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("/root/a/x/one.png", "1");
    host.make_file("/root/b/y/two.png", "2");

    let guarded =
        run(&mut host, r#"{"action":"nested","path":"/root","preview":true,"enableSimilarity":false}"#);
    assert!(guarded.success, "{}", guarded.message);
    assert_eq!(guarded.data.total_count, 0, "both candidates are direct children of the root");

    let unguarded = run(
        &mut host,
        r#"{"action":"nested","path":"/root","preview":true,"protectFirstLevel":false,"enableSimilarity":false}"#,
    );
    assert_eq!(unguarded.data.nested_count, 2);
    assert_eq!(unguarded.data.total_count, 4);
}

#[test]
fn a_missing_root_path_fails_with_the_core_ts_message() {
    let mut host = InMemoryDissolvefHost::default();
    let no_path = run(&mut host, r#"{"action":"plan","path":""}"#);
    assert!(!no_path.success);
    assert_eq!(no_path.message, "Path is required.");
    assert_eq!(no_path.data.errors, vec!["Path is required.".to_string()]);

    let missing = run(&mut host, r#"{"action":"plan","path":"/root/nope"}"#);
    assert_eq!(missing.message, "Path does not exist: /root/nope");

    host.make_file("/root/file.txt", "x");
    let not_a_dir = run(&mut host, r#"{"action":"plan","path":"/root/file.txt"}"#);
    assert_eq!(not_a_dir.message, "Path is not a directory: /root/file.txt");
}

#[test]
fn a_host_refusal_becomes_the_row_reason_not_an_aborted_run() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("/root/a/b/c/test.txt", "hello");
    host.failing_deletes.push("/root/a/b".to_string());

    let result = run(
        &mut host,
        r#"{"action":"nested","path":"/root/a","historyPath":"/root/h.json","enableSimilarity":false}"#,
    );

    assert!(!result.success, "{}", result.message);
    assert_eq!(result.message, "Dissolve completed: 1 success, 0 skipped, 1 failed.");
    assert_eq!(result.data.error_count, 1);
    assert!(result.data.errors[0].contains("EPERM"), "{}", result.data.errors[0]);
    assert!(host.exists("/root/a/test.txt"), "the move still happened");
    // The refused row is the delete: the folder the host would not remove is still there, and its content
    // already moved out — which is exactly why the run must report the failure instead of hiding it.
    assert!(host.exists("/root/a/b/c"), "the refused directory is untouched");
    // Only the successful move is journaled, so the refusal stays undoable without a phantom row.
    let parsed = crate::history::parse_dissolve_history(host.read("/root/h.json").as_deref());
    assert_eq!(parsed[0].operations.len(), 1);
}

#[test]
fn the_history_action_lists_records_up_to_the_limit() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_file(
        "/root/h.json",
        r#"[{"id":"b","timestamp":"2","mode":"nested","path":"/p","count":1,"operations":[{"type":"delete_dir","sourcePath":"/p/x"}]},
           {"id":"a","timestamp":"1","mode":"media","path":"/p","count":1,"operations":[{"type":"delete_dir","sourcePath":"/p/y"}]}]"#,
    );

    let all = run(&mut host, r#"{"action":"history","historyPath":"/root/h.json"}"#);
    assert!(all.success);
    assert_eq!(all.message, "Loaded 2 history record(s).");
    assert_eq!(all.data.history.len(), 2);
    assert_eq!(all.data.history[0].id, "b", "the newest record stays first");
    assert_eq!(all.data.media_count, 0, "history reports the journal, not a plan");

    let clipped = run(&mut host, r#"{"action":"history","historyPath":"/root/h.json","historyLimit":1}"#);
    assert_eq!(clipped.message, "Loaded 1 history record(s).");
    assert_eq!(clipped.data.history.len(), 1);

    let nothing = run(&mut host, r#"{"action":"history","historyPath":"/root/absent.json"}"#);
    assert_eq!(nothing.message, "Loaded 0 history record(s).");
    assert!(nothing.success);
}

#[test]
fn undo_reports_the_three_refusal_messages_core_ts_distinguishes() {
    let mut host = InMemoryDissolvefHost::default();
    let missing_file = run(&mut host, r#"{"action":"undo","historyPath":"/root/none.json"}"#);
    assert_eq!(missing_file.message, "No undoable record found.");

    host.make_file(
        "/root/h.json",
        r#"[{"id":"one","timestamp":"1","mode":"nested","path":"/p","count":0,"operations":[],"undone":true}]"#,
    );
    let all_done = run(&mut host, r#"{"action":"undo","historyPath":"/root/h.json"}"#);
    assert_eq!(all_done.message, "No undoable record found.");

    let unknown_id = run(&mut host, r#"{"action":"undo","historyPath":"/root/h.json","undoId":"nope"}"#);
    assert_eq!(unknown_id.message, "Undo record not found: nope");

    let already = run(&mut host, r#"{"action":"undo","historyPath":"/root/h.json","undoId":"one"}"#);
    assert_eq!(already.message, "Undo record already applied: one");
    for failure in [&missing_file, &all_done, &unknown_id, &already] {
        assert!(!failure.success);
        assert_eq!(failure.data.failed_count, 1);
        assert_eq!(failure.data.error_count, 1);
        assert_eq!(failure.data.errors, vec![failure.message.clone()]);
    }
}

#[test]
fn an_undo_conflict_is_reported_per_operation_and_keeps_the_record_retryable() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("/root/inner/test.txt", "restored");
    host.make_file("/root/test.txt", "still there");
    host.make_file(
        "/root/h.json",
        r#"[{"id":"one","timestamp":"1","mode":"nested","path":"/root","count":1,"operations":[{"type":"move","sourcePath":"/root/inner/test.txt","targetPath":"/root/test.txt"}]}]"#,
    );

    let undo = run(&mut host, r#"{"action":"undo","historyPath":"/root/h.json"}"#);
    assert!(!undo.success);
    assert_eq!(undo.message, "Undo completed: 0 success, 1 failed.");
    assert_eq!(
        undo.data.errors,
        vec!["Undo conflict: both source and target exist: /root/inner/test.txt".to_string()]
    );
    let parsed = crate::history::parse_dissolve_history(host.read("/root/h.json").as_deref());
    assert_eq!(parsed[0].undone, Some(false), "a failed undo is retryable");
    assert_eq!(host.read("/root/inner/test.txt").as_deref(), Some("restored"));
}

#[test]
fn an_undo_reports_a_missing_target_and_still_counts_the_other_rows() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_file(
        "/root/h.json",
        r#"[{"id":"one","timestamp":"1","mode":"archive","path":"/root","count":2,"operations":[
            {"type":"move","sourcePath":"/root/keep.txt","targetPath":"/root/gone.zip"},
            {"type":"delete_dir","sourcePath":"/root/box"}
        ]}]"#,
    );

    let undo = run(&mut host, r#"{"action":"undo","historyPath":"/root/h.json"}"#);
    // The delete row runs first when reversed, so the folder is back; the move has nothing to restore.
    assert!(!undo.success);
    assert_eq!(undo.message, "Undo completed: 1 success, 1 failed.");
    assert_eq!(undo.data.errors, vec!["Undo source is missing: /root/gone.zip".to_string()]);
    assert!(host.exists("/root/box"));
}

#[test]
fn a_record_is_not_marked_undone_when_the_run_was_cancelled() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("/root/target.txt", "here");
    host.make_file(
        "/root/h.json",
        r#"[{"id":"one","timestamp":"1","mode":"nested","path":"/root","count":2,"operations":[
            {"type":"move","sourcePath":"/root/inner/a.txt","targetPath":"/root/target.txt"},
            {"type":"move","sourcePath":"/root/inner/b.txt","targetPath":"/root/other.txt"}
        ]}]"#,
    );
    host.checkpoint_outcome = CheckpointOutcome::Cancelled;
    host.continue_checkpoint_count = 0;

    let undo = run(&mut host, r#"{"action":"undo","historyPath":"/root/h.json"}"#);
    assert!(undo.message.starts_with("Undo cancelled"), "{}", undo.message);
    assert!(undo.stats.contains_key(CANCELLED_STAT_KEY));
    assert_eq!(undo.data.success_count, 0);
    let parsed = crate::history::parse_dissolve_history(host.read("/root/h.json").as_deref());
    assert_eq!(parsed[0].undone, None, "a half-applied undo must stay selectable");
}

#[test]
fn a_record_is_capped_and_the_newest_record_goes_first() {
    let mut host = InMemoryDissolvefHost::default();
    let mut rows = String::from("[");
    for index in 0..105 {
        if index > 0 {
            rows.push(',');
        }
        rows.push_str(&format!(
            r#"{{"id":"old-{index}","timestamp":"t","mode":"mixed","path":"/p","count":0,"operations":[]}}"#
        ));
    }
    rows.push(']');
    host.make_file("/root/h.json", &rows);
    host.make_file("/root/a/b/c/test.txt", "hello");

    let result = run(
        &mut host,
        r#"{"action":"nested","path":"/root/a","historyPath":"/root/h.json","enableSimilarity":false}"#,
    );
    assert!(result.success, "{}", result.message);
    let journal = host.read("/root/h.json").expect("the journal was written");
    let parsed = crate::history::parse_dissolve_history(Some(&journal));
    assert_eq!(parsed.len(), 100, "core.ts:547 truncates to 100 records");
    assert_eq!(parsed[0].id, result.data.operation_id);
}

#[test]
fn the_default_history_path_comes_from_the_host() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("/config/artifacts/undo/dissolvef.undo.json", "[]\n");
    host.make_file("/root/a/b/c/test.txt", "hello");

    let result = run(&mut host, r#"{"action":"nested","path":"/root/a","enableSimilarity":false}"#);
    assert!(result.success, "{}", result.message);
    let journal = host
        .read("/config/artifacts/undo/dissolvef.undo.json")
        .expect("runOptions.defaultHistoryPath is the fallback");
    assert_eq!(crate::history::parse_dissolve_history(Some(&journal)).len(), 1);

    // With neither an input path nor a host default, the journal is refused rather than written to "".
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("/root/a/b/c/test.txt", "hello");
    let result = run_dissolvef(
        &input(r#"{"action":"nested","path":"/root/a","enableSimilarity":false}"#),
        &DissolvefRunScope::default(),
        &mut host,
    );
    assert!(!result.success);
    assert_eq!(
        result.message,
        "History path is required: set input.historyPath or runOptions.defaultHistoryPath."
    );
    assert!(host.exists("/root/a/b/c/test.txt"), "a refused journal must not have moved anything");
}

#[test]
fn an_explicit_undo_record_suffix_keeps_the_old_uuid_shape() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("/root/a/b/c/test.txt", "hello");
    let scope = DissolvefRunScope {
        operation_id: "op-9".to_string(),
        default_history_path: String::new(),
        undo_record_id_suffix: Some("cafe0001".to_string()),
    };
    let result = run_dissolvef(
        &input(r#"{"action":"nested","path":"/root/a","historyPath":"/root/h.json","enableSimilarity":false}"#),
        &scope,
        &mut host,
    );
    assert_eq!(result.data.operation_id, "dissolve-20260721160454-cafe0001");
}

#[test]
fn two_runs_of_the_same_plan_get_different_record_ids_from_different_operations() {
    let scope_a = DissolvefRunScope { operation_id: "op-a".to_string(), ..DissolvefRunScope::default() };
    let scope_b = DissolvefRunScope { operation_id: "op-b".to_string(), ..DissolvefRunScope::default() };
    let operations = vec![DissolveUndoOperation {
        kind: DissolvefOperation::Move,
        source_path: "/root/a/b/c/test.txt".to_string(),
        target_path: Some("/root/a/test.txt".to_string()),
    }];
    let first =
        crate::history::dissolve_record_id("2026-07-21T16:04:54.445Z", &scope_a, "/root/a", &operations);
    let second =
        crate::history::dissolve_record_id("2026-07-21T16:04:54.445Z", &scope_b, "/root/a", &operations);
    assert_ne!(first, second, "the operation id is part of the suffix");
    assert_eq!(first.len(), 9 + 14 + 1 + 8);
}

#[test]
fn windows_drive_paths_plan_and_execute_identically() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("D:\\lib\\a\\b\\c\\test.txt", "hello");

    let result = run(
        &mut host,
        r#"{"action":"nested","path":"D:\\lib\\a","historyPath":"D:\\lib\\h.json","enableSimilarity":false}"#,
    );

    assert!(result.success, "{}", result.message);
    assert_eq!(result.data.nested_count, 1);
    assert!(host.exists("D:\\lib\\a\\test.txt"));
    assert!(!host.exists("D:\\lib\\a\\b"));
    assert_eq!(result.data.plan[0].source_path, "D:\\lib\\a\\b\\c\\test.txt");
    assert_eq!(result.data.plan[0].target_path, "D:\\lib\\a\\test.txt");

    let journal = host.read("D:\\lib\\h.json").expect("the journal was written under the drive root");
    assert!(journal.contains(r"D:\\lib\\a\\b\\c\\test.txt"), "{journal}");
}

#[test]
fn unc_paths_survive_a_nested_plan() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("\\\\server\\share\\a\\b\\c\\test.txt", "hello");

    let result = run(
        &mut host,
        r#"{"action":"nested","path":"\\\\server\\share\\a","preview":true,"enableSimilarity":false}"#,
    );

    assert!(result.success, "{}", result.message);
    assert_eq!(result.data.plan[0].target_path, "\\\\server\\share\\a\\test.txt");
    assert_eq!(result.data.plan[0].source_path, "\\\\server\\share\\a\\b\\c\\test.txt");
    // The share is the root: it is its own parent, so the chain never truncates to the server name.
    assert_eq!(crate::paths::dirname_of("\\\\server\\share\\a"), "\\\\server\\share");
    assert_eq!(crate::paths::dirname_of("\\\\server\\share"), "\\\\server\\share");
}

#[test]
fn mixed_separators_in_one_path_are_kept_as_text() {
    let mut host = InMemoryDissolvefHost::default();
    host.make_file("D:/lib\\a/b\\test.txt", "hello");
    host.make_directory("D:/lib\\a/chain");

    let result = run(
        &mut host,
        r#"{"action":"nested","path":"D:/lib\\a","preview":true,"enableSimilarity":false}"#,
    );
    assert!(result.success, "{}", result.message);
    assert_eq!(result.data.total_count, 0, "the folder holds two children, so nothing qualifies");

    let listed = host.list_dir("D:/lib\\a").expect("a listing keeps both separator styles");
    assert_eq!(listed.len(), 2);
    let names: Vec<&str> = listed.iter().map(|entry| entry.name.as_str()).collect();
    assert_eq!(names, vec!["b", "chain"]);
}

#[test]
fn normalize_is_a_pure_function_the_faces_can_share() {
    // `interaction.ts`'s `toInput` output must normalize into the same plan the CLI/GUI expects.
    let normalized = normalize_dissolvef_input(&input(
        r#"{"action":"plan","path":"  \"D:/lib\"  ","fileConflict":"rename","similarityThreshold":0.75}"#,
    ));
    assert_eq!(normalized.path, "D:/lib");
    assert_eq!(normalized.file_conflict, DissolvefConflictMode::Rename);
    assert_eq!(normalized.similarity_threshold, 0.75);
}
