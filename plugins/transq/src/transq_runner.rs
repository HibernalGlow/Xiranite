//! The TransQ run: preview or organize, exactly as `core.ts:113-194`.
//!
//! The order of host operations is part of the product contract, not an
//! implementation detail: copies first, then work-artifact cleanup, then the result
//! move, and only after a successful move the completed `original_images` folder.
//! A failure anywhere in that chain stops the item, leaves the counters at whatever
//! actually happened, and pushes the host's message into the item's error list — the
//! behaviour `core.test.ts:36-55` pins down.
//!
//! ADR-0066 adds one thing the TypeScript version did not need: a
//! `checkpoint()` yield per queue item, so `HTTP pause -> operation paused -> plugin
//! checkpoint blocks` reaches a batch that runs inside a WASM isolate. A cancelled
//! checkpoint is a hard stop — the remaining items keep their planned status and the
//! result says the run was cancelled instead of pretending nothing happened.

use crate::transq_contract::{TransqAction, TransqData, TransqInput, TransqQueueItem, TransqQueueStatus, TransqRunEvent, TransqRunResult};
use crate::transq_host::{CheckpointDecision, TransqHost};
use crate::transq_path::parse_transq_paths;
use crate::transq_queue_planner::{plan_transq_queue, summarize_transq_items, TransqRunTally};
use crate::transq_workspace_scan::scan_translation_workspaces;

/// `core.ts:122`.
pub const STATUS_MESSAGE: &str =
    "Native TransQ is ready. Provide one or more translation workspace paths to plan a queue.";
/// `core.ts:129`.
pub const MISSING_ROOTS_MESSAGE: &str = "Provide at least one translation workspace path.";
/// `core.ts:132`.
pub const SCANNING_MESSAGE: &str = "Scanning translation workspaces.";
/// `core.ts:140`.
pub const NO_QUEUES_MESSAGE: &str =
    "No original_images folders with a manga_translator_work/result queue were found.";
/// `core.ts:186`.
pub const FINISHED_WITH_ERRORS_MESSAGE: &str = "Translation queue finished with errors.";
/// `core.ts:186`.
pub const ORGANIZED_MESSAGE: &str = "Translation queue organized.";
/// New in the Rust port: ADR-0066 says a cancelled checkpoint is a hard stop, and the
/// TypeScript node never had to report one from inside the run.
pub const CANCELLED_MESSAGE: &str = "Translation queue organization was cancelled.";

/// `runTransq` (`core.ts:113-194`). Events go to the host (`xiranite.operation.emit`) instead of
/// the `onEvent` callback the Bun host used to receive.
pub fn run_transq(input: &TransqInput, host: &mut dyn TransqHost) -> TransqRunResult {
    let action = input.resolved_action();
    if action == TransqAction::Status {
        return TransqRunResult { success: true, message: STATUS_MESSAGE.to_string(), data: TransqData::empty() };
    }

    let roots = parse_transq_paths(&input.paths);
    if roots.is_empty() {
        return TransqRunResult {
            success: false,
            message: MISSING_ROOTS_MESSAGE.to_string(),
            data: TransqData::empty(),
        };
    }

    host.emit_event(&TransqRunEvent::progress(10, SCANNING_MESSAGE));
    let snapshots = scan_translation_workspaces(host, &roots);
    let mut items: Vec<TransqQueueItem> = snapshots.iter().map(plan_transq_queue).collect();
    let planned = summarize_transq_items(&items, &TransqRunTally::default());

    if items.is_empty() {
        return TransqRunResult { success: false, message: NO_QUEUES_MESSAGE.to_string(), data: planned };
    }

    // Preview stays the default (`core.ts:9` and `core.ts:145`): only an explicit
    // `preview: false` with a `run` action may change files.
    let preview = action == TransqAction::Plan || input.preview != Some(false);
    if preview {
        host.emit_event(&TransqRunEvent::progress(
            100,
            format!("Planned {} translation queue(s); no files were changed.", items.len()),
        ));
        return TransqRunResult {
            success: planned.conflict_count == 0 && planned.errors.is_empty(),
            message: format!(
                "Planned {} translation queue(s); {} need missing-file copies and {} need attention.",
                items.len(),
                planned.pending_count,
                planned.conflict_count
            ),
            data: planned,
        };
    }

    organize_queues(host, &mut items, planned)
}

fn organize_queues(host: &mut dyn TransqHost, items: &mut [TransqQueueItem], planned: TransqData) -> TransqRunResult {
    let mut tally = TransqRunTally { errors: planned.errors.clone(), ..TransqRunTally::default() };
    // `conflict` and `missing` queues are skipped, exactly as the TypeScript filter
    // (`core.ts:159`) does: a queue whose output folder already exists is never
    // overwritten automatically.
    let runnable: Vec<usize> = items
        .iter()
        .enumerate()
        .filter(|(_, item)| matches!(item.status, TransqQueueStatus::Pending | TransqQueueStatus::Ready))
        .map(|(index, _)| index)
        .collect();

    let mut cancelled = false;
    for (position, &index) in runnable.iter().enumerate() {
        let original_images_path = items[index].original_images_path.clone();
        host.emit_event(&TransqRunEvent::progress(
            organize_progress_percent(position, runnable.len()),
            format!("Organizing {original_images_path}"),
        ));

        if host.checkpoint() == CheckpointDecision::Cancelled {
            cancelled = true;
            break;
        }

        match organize_one_queue(host, index, items) {
            Ok(counts) => {
                tally.copied_files += counts.copied_files;
                tally.deleted_work_items += counts.deleted_work_items;
                tally.deleted_originals += counts.deleted_originals;
                items[index].status = TransqQueueStatus::Output;
            }
            Err((message, counts)) => {
                tally.copied_files += counts.copied_files;
                tally.deleted_work_items += counts.deleted_work_items;
                items[index].status = TransqQueueStatus::Conflict;
                items[index].errors.push(message.clone());
                tally.errors.push(format!("{original_images_path}: {message}"));
            }
        }
    }

    let completed = summarize_transq_items(items, &tally);
    if cancelled {
        host.emit_event(&TransqRunEvent::progress(100, CANCELLED_MESSAGE));
        return TransqRunResult { success: false, message: CANCELLED_MESSAGE.to_string(), data: completed };
    }

    host.emit_event(&TransqRunEvent::progress(
        100,
        if completed.errors.is_empty() { ORGANIZED_MESSAGE } else { FINISHED_WITH_ERRORS_MESSAGE },
    ));
    TransqRunResult {
        success: completed.errors.is_empty() && completed.conflict_count == 0,
        message: if completed.errors.is_empty() {
            format!("Organized {} translation queue(s).", completed.output_count)
        } else {
            format!(
                "Organized {} translation queue(s); {} queue(s) need attention.",
                completed.output_count,
                completed.errors.len()
            )
        },
        data: completed,
    }
}

/// Partial counters for one queue: TypeScript increments its totals as each call
/// succeeds, so a queue that fails halfway still reports what really happened.
#[derive(Debug, Default, Clone, Copy)]
struct OrganizedCounts {
    copied_files: usize,
    deleted_work_items: usize,
    deleted_originals: usize,
}

/// The per-item chain from `core.ts:164-176`.
fn organize_one_queue(
    host: &mut dyn TransqHost,
    index: usize,
    items: &[TransqQueueItem],
) -> Result<OrganizedCounts, (String, OrganizedCounts)> {
    let item = &items[index];
    let mut counts = OrganizedCounts::default();

    for copy in &item.copies {
        match host.copy_file(&copy.source_path, &copy.destination_path) {
            Ok(()) => counts.copied_files += 1,
            Err(error) => return Err((error.message, counts)),
        }
    }
    for cleanup_path in &item.cleanup_paths {
        match host.remove_path(cleanup_path) {
            Ok(()) => counts.deleted_work_items += 1,
            Err(error) => return Err((error.message, counts)),
        }
    }
    if let Err(error) = host.move_directory(&item.result_path, &item.output_path) {
        return Err((error.message, counts));
    }
    // The completed `original_images` folder goes last, after the move landed, which
    // is why the help text promises it is never removed first.
    if let Err(error) = host.remove_path(&item.original_images_path) {
        return Err((error.message, counts));
    }
    counts.deleted_originals += 1;
    Ok(counts)
}

/// `20 + Math.round((index / Math.max(runnable.length, 1)) * 70)` (`core.ts:162`).
/// The division-then-multiply order is kept, and `f64::round` matches `Math.round`
/// for the non-negative values produced here.
fn organize_progress_percent(position: usize, runnable_count: usize) -> usize {
    let denominator = runnable_count.max(1) as f64;
    let scaled = (position as f64 / denominator) * 70.0;
    20 + scaled.round() as usize
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transq_host::{DirectoryEntry, DirectoryEntryKind, DirectoryListing, PathKind};
    use crate::transq_test_host::VirtualTransqHost;

    const CHAPTER: &str = "D:/translation/chapter";
    const ORIGINAL_IMAGES: &str = "D:/translation/chapter/original_images";
    const WORK: &str = "D:/translation/chapter/original_images/manga_translator_work";
    const RESULT: &str = "D:/translation/chapter/original_images/manga_translator_work/result";

    fn entry(name: &str, kind: DirectoryEntryKind) -> DirectoryEntry {
        DirectoryEntry { name: name.to_string(), kind }
    }

    fn directory_listing(path: &str, entries: Vec<DirectoryEntry>) -> DirectoryListing {
        DirectoryListing { path: path.to_string(), kind: PathKind::Directory, entries }
    }

    fn populated_chapter_host() -> VirtualTransqHost {
        let mut host = VirtualTransqHost::new();
        host.add_listing(directory_listing(CHAPTER, vec![entry("original_images", DirectoryEntryKind::Directory)]));
        host.add_listing(directory_listing(
            ORIGINAL_IMAGES,
            vec![
                entry("001.png", DirectoryEntryKind::File),
                entry("002.png", DirectoryEntryKind::File),
                entry("manga_translator_work", DirectoryEntryKind::Directory),
            ],
        ));
        host.add_listing(directory_listing(
            WORK,
            vec![
                entry("result", DirectoryEntryKind::Directory),
                entry("inpainted", DirectoryEntryKind::Directory),
                entry("config.yaml", DirectoryEntryKind::File),
                entry("mask_list.json", DirectoryEntryKind::File),
            ],
        ));
        host.add_listing(directory_listing(
            RESULT,
            vec![entry("001.png", DirectoryEntryKind::File), entry("translation_map.json", DirectoryEntryKind::File)],
        ));
        host.add_translation_map(RESULT, r#"{"002.png":"./original_images/002.png","001.png":"./original_images/001.png"}"#);
        host
    }

    fn input(action: TransqAction, paths: &[&str], preview: Option<bool>) -> TransqInput {
        TransqInput {
            action: Some(action),
            paths: paths.iter().map(|path| path.to_string()).collect(),
            preview,
        }
    }

    /// `core.test.ts:36-55`: a native queue, no Python and no PackU arguments.
    #[test]
    fn executes_a_native_queue_without_python_or_packu_arguments() {
        let mut host = populated_chapter_host();
        let result = run_transq(&input(TransqAction::Run, &["D:/translation"], Some(false)), &mut host);

        assert!(result.success);
        assert_eq!(result.data.output_count, 1);
        assert_eq!(
            host.operations,
            vec![
                format!("copy {ORIGINAL_IMAGES}/002.png -> {RESULT}/002.png"),
                format!("remove {WORK}/inpainted"),
                format!("remove {WORK}/mask_list.json"),
                format!("move {RESULT} -> {CHAPTER}/result"),
                format!("remove {ORIGINAL_IMAGES}"),
            ]
        );
        assert_eq!(result.message, "Organized 1 translation queue(s).");
        assert_eq!((host.checkpoint_calls, result.data.copied_files, result.data.deleted_work_items, result.data.deleted_originals), (1, 1, 2, 1));
        assert_eq!(host.reads, vec![format!("{RESULT}/translation_map.json")]);
    }

    #[test]
    fn reports_progress_events_in_the_typescript_order() {
        let mut host = populated_chapter_host();
        run_transq(&input(TransqAction::Run, &["D:/translation"], Some(false)), &mut host);

        let messages = host.emitted_progress_messages();
        assert_eq!(messages[0], SCANNING_MESSAGE);
        assert_eq!(messages[1], format!("Organizing {ORIGINAL_IMAGES}"));
        assert_eq!(messages[2], ORGANIZED_MESSAGE);
        let percents: Vec<Option<usize>> = host.emitted_events.iter().map(|event| event.progress).collect();
        assert_eq!(percents, vec![Some(10), Some(20), Some(100)]);
    }

    #[test]
    fn status_answers_without_touching_the_machine() {
        let mut host = VirtualTransqHost::new();
        let result = run_transq(&input(TransqAction::Status, &[], None), &mut host);

        assert!(result.success);
        assert_eq!(result.message, STATUS_MESSAGE);
        assert!(result.data.items.is_empty());
        assert!(host.operations.is_empty() && host.listed_paths().is_empty());
    }

    #[test]
    fn empty_paths_are_rejected() {
        let mut host = VirtualTransqHost::new();
        for paths in [Vec::new(), vec!["   ".to_string()], vec!["''".to_string()]] {
            let result = run_transq(
                &TransqInput { action: Some(TransqAction::Plan), paths, preview: None },
                &mut host,
            );
            assert!(!result.success);
            assert_eq!(result.message, MISSING_ROOTS_MESSAGE);
        }
    }

    #[test]
    fn nothing_is_changed_without_an_explicit_preview_false() {
        let mut host = populated_chapter_host();
        let result = run_transq(&input(TransqAction::Run, &["D:/translation"], None), &mut host);

        assert!(result.success);
        assert_eq!(result.message, "Planned 1 translation queue(s); 1 need missing-file copies and 0 need attention.");
        assert!(host.operations.is_empty(), "a run without preview:false must not touch files");
        assert_eq!(result.data.pending_count, 1);
        assert_eq!(host.emitted_progress_messages()[1], "Planned 1 translation queue(s); no files were changed.");
    }

    #[test]
    fn a_plan_action_previews_even_without_the_preview_flag() {
        let mut host = populated_chapter_host();
        let result = run_transq(&input(TransqAction::Plan, &["D:/translation"], Some(false)), &mut host);

        assert!(host.operations.is_empty());
        assert_eq!(result.data.pending_count, 1);
    }

    #[test]
    fn a_preview_with_a_conflict_is_not_successful() {
        let mut host = populated_chapter_host();
        host.add_listing(directory_listing(&format!("{CHAPTER}/result"), Vec::new()));
        let result = run_transq(&input(TransqAction::Plan, &["D:/translation"], None), &mut host);

        assert!(!result.success);
        assert_eq!(result.data.conflict_count, 1);
        assert_eq!(result.message, "Planned 1 translation queue(s); 0 need missing-file copies and 1 need attention.");
    }

    #[test]
    fn a_scan_that_finds_no_queue_reports_the_original_message() {
        let mut host = VirtualTransqHost::new();
        host.add_listing(directory_listing("D:/empty", vec![entry("notes.txt", DirectoryEntryKind::File)]));
        let result = run_transq(&input(TransqAction::Plan, &["D:/empty"], None), &mut host);

        assert!(!result.success);
        assert_eq!(result.message, NO_QUEUES_MESSAGE);
        assert!(result.data.items.is_empty());
    }

    #[test]
    fn a_failed_item_keeps_what_it_already_changed_and_skips_nothing() {
        let mut host = populated_chapter_host();
        host.fail_next_operation(&format!("move {RESULT}"), "EPERM: operation not permitted");
        let result = run_transq(&input(TransqAction::Run, &["D:/translation"], Some(false)), &mut host);

        assert!(!result.success);
        assert_eq!(result.data.output_count, 0);
        assert_eq!(result.data.conflict_count, 1);
        assert_eq!(result.data.copied_files, 1);
        assert_eq!(result.data.deleted_work_items, 2);
        assert_eq!(result.data.deleted_originals, 0, "the completed folder must survive a failed move");
        assert_eq!(
            result.data.errors,
            vec![format!("{ORIGINAL_IMAGES}: EPERM: operation not permitted")]
        );
        assert_eq!(result.message, "Organized 0 translation queue(s); 1 queue(s) need attention.");
        assert_eq!(result.data.items[0].status, TransqQueueStatus::Conflict);
    }

    #[test]
    fn a_cancelled_checkpoint_stops_before_the_first_queue() {
        let mut host = populated_chapter_host();
        host.checkpoint_decision = CheckpointDecision::Cancelled;
        let result = run_transq(&input(TransqAction::Run, &["D:/translation"], Some(false)), &mut host);

        assert!(!result.success);
        assert_eq!(result.message, CANCELLED_MESSAGE);
        assert!(host.operations.is_empty(), "a cancelled checkpoint is a hard stop");
        assert_eq!(result.data.pending_count, 1, "the queue stays planned, not half-organized");
        assert_eq!(*host.emitted_progress_messages().last().unwrap(), CANCELLED_MESSAGE);
    }

    #[test]
    fn progress_spreads_over_the_runnable_queues() {
        assert_eq!(organize_progress_percent(0, 4), 20);
        assert_eq!(organize_progress_percent(1, 4), 38);
        assert_eq!(organize_progress_percent(3, 4), 73);
        assert_eq!(organize_progress_percent(0, 1), 20);
        assert_eq!(organize_progress_percent(0, 0), 20, "the Math.max guard keeps a zero-length batch at 20");
    }
}
