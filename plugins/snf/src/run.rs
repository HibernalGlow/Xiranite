//! The run orchestration — `runSnf` at `core.ts:85-116`.
//!
//! Message text, progress percentages, the order of counters and the rule that a
//! conflict does *not* make a run unsuccessful (`core.ts:208`, keyed on
//! `errorCount` only) are the observable operation contract, so they are copied
//! exactly rather than improved.
//!
//! The one addition over TypeScript is ADR-0066's cooperative control plane:
//! `xiranite.checkpoint()` is called at each item boundary, `xiranite.emit()` backs
//! the event sink, and `xiranite.scheduler.acquire()` is asked once before the
//! rename phase. On a `Cancelled` answer the run stops at the next boundary,
//! publishes the work it already did, and reports a failed result — the TypeScript
//! core has no equivalent because its host cancels by dropping the worker, while a
//! plugin must obey the checkpoint answer itself.

use crate::contract::{
    NodeRunEvent, NormalizedSnfInput, SnfAction, SnfData, SnfInput, SnfPlanItem, SnfPlanStatus, SnfRunResult,
};
use crate::file_system::{SnfEventSink, SnfFileSystem, SnfRunControl};
use crate::input_normalization::normalize_snf_input;
use crate::plan::{collect_artist_folders, plan_artist_folder};

/// `core.ts:88`.
pub const MESSAGE_AT_LEAST_ONE_FOLDER: &str = "At least one library or artist folder is required.";
/// `core.ts:89`.
pub const MESSAGE_SCANNING_NUMBERED_FOLDERS: &str = "Scanning numbered folders.";
/// `core.ts:96`.
pub const MESSAGE_RENAMING_SEQUENCE_FOLDERS: &str = "Renaming sequence folders.";
/// The two progress values the card's progress bar reads.
pub const PROGRESS_SCANNING_PERCENT: u32 = 20;
pub const PROGRESS_RENAMING_PERCENT: u32 = 70;
/// `runSnf(input, runtime, onEvent)`.
///
/// Never returns a `Result`: `core.ts` catches everything into a failure result, so
/// a run always produces the document the operation protocol and the history row
/// expect.
#[must_use]
pub fn run_snf(
    input: &SnfInput,
    file_system: &dyn SnfFileSystem,
    events: &dyn SnfEventSink,
    control: &dyn SnfRunControl,
) -> SnfRunResult {
    // Normalization sits outside `core.ts`'s try block (line 86 versus 87): a
    // document that cannot even be deserialized is the caller's problem, so the JSON
    // entry point lets that failure escape instead of wrapping it as a result.
    let normalized = normalize_snf_input(input);
    run_normalized(&normalized, file_system, events, control)
}

/// The run body against an already-normalized work order, kept separate because the
/// card and the host both normalize once and re-run the same work order.
#[must_use]
pub fn run_normalized(
    normalized: &NormalizedSnfInput,
    file_system: &dyn SnfFileSystem,
    events: &dyn SnfEventSink,
    control: &dyn SnfRunControl,
) -> SnfRunResult {
    if normalized.paths.is_empty() {
        return build_failure(MESSAGE_AT_LEAST_ONE_FOLDER, normalized);
    }

    events.on_event(&NodeRunEvent::progress(
        PROGRESS_SCANNING_PERCENT,
        MESSAGE_SCANNING_NUMBERED_FOLDERS,
    ));

    let artist_folders = match collect_artist_folders(normalized, file_system) {
        Ok(folders) => folders,
        Err(error) => return build_failure(&error.to_string(), normalized),
    };
    let artist_count = artist_folders.len();

    let mut plan: Vec<SnfPlanItem> = Vec::new();
    for artist_path in &artist_folders {
        match plan_artist_folder(artist_path, normalized, file_system) {
            Ok(items) => plan.extend(items),
            Err(error) => return build_failure(&error.to_string(), normalized),
        }
        if control.checkpoint().is_hard_stop() {
            let message = format!("SNF cancelled while planning ({} item(s) planned).", plan.len());
            return build_cancelled(message, normalized, artist_count, plan);
        }
    }

    if normalized.action != SnfAction::Rename || normalized.dry_run {
        let message = format!("SNF planned {} item(s).", plan.len());
        return build_success(message, SnfData::summarize(normalized, artist_count, plan));
    }

    events.on_event(&NodeRunEvent::progress(
        PROGRESS_RENAMING_PERCENT,
        MESSAGE_RENAMING_SEQUENCE_FOLDERS,
    ));
    control.acquire_disk_admission();

    let mut applied: Vec<SnfPlanItem> = Vec::with_capacity(plan.len());
    let mut iterator = plan.into_iter();
    while let Some(item) = iterator.next() {
        if item.status != SnfPlanStatus::Ready {
            applied.push(item);
            continue;
        }
        if control.checkpoint().is_hard_stop() {
            // Stop before starting another item, then publish the untouched plan
            // unchanged so `readyCount` still reports what was never attempted.
            let renamed_count = count_status(&applied, SnfPlanStatus::Renamed);
            applied.push(item);
            applied.extend(iterator);
            let message = format!("SNF cancelled after {renamed_count} rename(s).");
            return build_cancelled(message, normalized, artist_count, applied);
        }
        let outcome = apply_rename(&item.source_path, &item.target_path, normalized, file_system);
        applied.push(match outcome {
            Ok(()) => SnfPlanItem {
                status: SnfPlanStatus::Renamed,
                ..item
            },
            // `core.ts:109` stores `errorMessage(error)` verbatim as the reason.
            Err(error) => SnfPlanItem {
                status: SnfPlanStatus::Error,
                reason: Some(error.to_string()),
                ..item
            },
        });
    }

    let renamed_count = count_status(&applied, SnfPlanStatus::Renamed);
    let message = format!("SNF renamed {renamed_count} folder(s).");
    build_success(message, SnfData::summarize(normalized, artist_count, applied))
}

/// `core.ts:104-106` in order: read the source timestamps, rename, then restore the
/// timestamps on the *target*. A `setTimes` failure is reported as an error even
/// though the rename already landed, exactly as the `try` block does.
fn apply_rename(
    source_path: &str,
    target_path: &str,
    normalized: &NormalizedSnfInput,
    file_system: &dyn SnfFileSystem,
) -> Result<(), crate::file_system::SnfFileAccessError> {
    let info = file_system.path_info(source_path)?;
    file_system.rename_folder(source_path, target_path)?;
    if normalized.keep_timestamp {
        file_system.set_folder_timestamps(target_path, info.atime_ms, info.mtime_ms)?;
    }
    Ok(())
}

fn count_status(items: &[SnfPlanItem], status: SnfPlanStatus) -> usize {
    items.iter().filter(|item| item.status == status).count()
}

/// `success()` at `core.ts:207-209`: only an `errorCount` above zero makes the run
/// unsuccessful, so a plan full of conflicts still reports `success: true`.
#[must_use]
pub fn build_success(message: String, data: SnfData) -> SnfRunResult {
    SnfRunResult {
        success: data.error_count == 0,
        message,
        data: Some(data),
        stats: None,
        output_path: None,
    }
}

/// `failure()` at `core.ts:211-213`: one synthetic `error` item with empty paths and
/// the message as its reason, `artistCount` 0.
#[must_use]
pub fn build_failure(message: &str, normalized: &NormalizedSnfInput) -> SnfRunResult {
    let item = SnfPlanItem {
        artist_path: String::new(),
        source_path: String::new(),
        target_path: String::new(),
        source_name: String::new(),
        target_name: String::new(),
        sequence: None,
        status: SnfPlanStatus::Error,
        reason: Some(message.to_string()),
    };
    let data = SnfData::summarize(normalized, 0, vec![item]);
    SnfRunResult {
        success: false,
        message: message.to_string(),
        data: Some(data),
        stats: None,
        output_path: None,
    }
}

/// The ADR-0066 cancellation answer. The partial plan is kept, the result is a
/// failure, and the phase itself stays the host's business.
#[must_use]
pub fn build_cancelled(
    message: String,
    normalized: &NormalizedSnfInput,
    artist_count: usize,
    items: Vec<SnfPlanItem>,
) -> SnfRunResult {
    SnfRunResult {
        success: false,
        message,
        data: Some(SnfData::summarize(normalized, artist_count, items)),
        stats: None,
        output_path: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_system::{ContinueThroughRunControl, NoopEventSink};
    use crate::host_surface::CheckpointOutcome;
    use crate::memory_file_system::MemoryFileSystem;
    use std::cell::{Cell, RefCell};

    struct ScriptedRunControl {
        answers: RefCell<Vec<CheckpointOutcome>>,
        admissions: Cell<usize>,
    }

    impl ScriptedRunControl {
        fn new(answers: &[CheckpointOutcome]) -> Self {
            Self {
                answers: RefCell::new(answers.to_vec()),
                admissions: Cell::new(0),
            }
        }
    }

    impl SnfRunControl for ScriptedRunControl {
        fn checkpoint(&self) -> CheckpointOutcome {
            let mut answers = self.answers.borrow_mut();
            if answers.len() > 1 {
                answers.remove(0)
            } else {
                answers.first().copied().unwrap_or(CheckpointOutcome::Continue)
            }
        }

        fn acquire_disk_admission(&self) -> bool {
            self.admissions.set(self.admissions.get() + 1);
            true
        }
    }

    #[derive(Default)]
    struct CollectingEventSink(RefCell<Vec<NodeRunEvent>>);

    impl SnfEventSink for CollectingEventSink {
        fn on_event(&self, event: &NodeRunEvent) {
            self.0.borrow_mut().push(event.clone());
        }
    }

    fn input(raw: &str) -> SnfInput {
        serde_json::from_str(raw).expect("input json")
    }

    #[test]
    fn an_empty_plan_reports_the_typescript_message_and_shape() {
        let events = CollectingEventSink::default();
        let result = run_snf(
            &input("{}"),
            &MemoryFileSystem::new(),
            &events,
            &ContinueThroughRunControl,
        );
        assert!(!result.success);
        assert_eq!(result.message, MESSAGE_AT_LEAST_ONE_FOLDER);
        let data = result.data.expect("data");
        assert_eq!(data.artist_count, 0);
        assert_eq!(data.scanned_count, 1);
        assert_eq!(data.error_count, 1);
        assert_eq!(data.errors, vec![": At least one library or artist folder is required."]);
        assert_eq!(data.items[0].source_path, "");
        assert!(events.0.borrow().is_empty(), "the guard runs before any event");
    }

    #[test]
    fn a_listing_failure_becomes_a_failure_result_not_a_panic() {
        let file_system = MemoryFileSystem::new()
            .with_directory("/library/Artist", &[("1. CG", true)])
            .with_failing_listing("/library/Artist", "EACCES: permission denied, scandir");
        let result = run_snf(
            &input(r#"{"paths":["/library/Artist"],"mode":"artist"}"#),
            &file_system,
            &NoopEventSink,
            &ContinueThroughRunControl,
        );
        assert!(!result.success);
        assert_eq!(result.message, "EACCES: permission denied, scandir");
    }

    #[test]
    fn scan_and_plan_share_one_message_and_emit_the_same_progress() {
        let file_system = MemoryFileSystem::new().with_directory("/library/Artist", &[("3. CG", true)]);
        let events = CollectingEventSink::default();
        let result = run_snf(
            &input(r#"{"action":"scan","paths":["/library/Artist"],"mode":"artist"}"#),
            &file_system,
            &events,
            &ContinueThroughRunControl,
        );
        assert_eq!(result.message, "SNF planned 1 item(s).");
        assert_eq!(
            events.0.borrow().clone(),
            vec![NodeRunEvent::progress(20, "Scanning numbered folders.")]
        );
        assert_eq!(result.data.expect("data").action, SnfAction::Scan);
    }

    #[test]
    fn rename_without_dry_run_acquires_admission_once_and_renames_in_plan_order() {
        let file_system = MemoryFileSystem::new().with_directory(
            "/library/Artist",
            &[("3. CG", true), ("9. 同人志", true), ("skipped", true)],
        );
        let control = ScriptedRunControl::new(&[CheckpointOutcome::Continue]);
        let result = run_snf(
            &input(r#"{"action":"rename","paths":["/library/Artist"],"mode":"artist","dryRun":false}"#),
            &file_system,
            &NoopEventSink,
            &control,
        );
        assert_eq!(result.message, "SNF renamed 2 folder(s).");
        assert_eq!(control.admissions.get(), 1);
        assert_eq!(
            file_system.recorded_renames(),
            vec![
                ("/library/Artist/9. 同人志".to_string(), "/library/Artist/1. 同人志".to_string()),
                ("/library/Artist/3. CG".to_string(), "/library/Artist/2. CG".to_string()),
            ]
        );
        let data = result.data.expect("data");
        assert_eq!(data.renamed_count, 2);
        assert_eq!(data.ready_count, 0);
        assert_eq!(data.unchanged_count, 0);
        assert_eq!(data.skipped_count, 0, "a non-numbered directory is not planned at all");
        assert_eq!(data.error_count, 0);
    }

    #[test]
    fn a_rename_refusal_is_reported_per_item_and_keeps_the_rest() {
        let file_system = MemoryFileSystem::new()
            .with_directory("/library/Artist", &[("3. CG", true), ("9. 同人志", true)])
            .with_failing_rename("/library/Artist/9. 同人志", "EPERM: operation not permitted, rename");
        let result = run_snf(
            &input(r#"{"action":"rename","paths":["/library/Artist"],"mode":"artist","dryRun":false}"#),
            &file_system,
            &NoopEventSink,
            &ContinueThroughRunControl,
        );
        let data = result.data.expect("data");
        assert_eq!(data.renamed_count, 1);
        assert_eq!(data.error_count, 1);
        assert!(!result.success, "errorCount decides success (core.ts:208)");
        assert_eq!(
            data.errors,
            vec!["/library/Artist/9. 同人志: EPERM: operation not permitted, rename"]
        );
    }

    #[test]
    fn cancellation_stops_before_the_next_rename_and_publishes_the_partial_plan() {
        let file_system = MemoryFileSystem::new().with_directory(
            "/library/Artist",
            &[("3. CG", true), ("4. 同人志", true), ("9. 画集", true)],
        );
        // Call order: one checkpoint closes the planning phase, then one per rename.
        let control = ScriptedRunControl::new(&[
            CheckpointOutcome::Continue,
            CheckpointOutcome::Continue,
            CheckpointOutcome::Cancelled,
        ]);
        let result = run_snf(
            &input(r#"{"action":"rename","paths":["/library/Artist"],"mode":"artist","dryRun":false}"#),
            &file_system,
            &NoopEventSink,
            &control,
        );
        assert!(!result.success);
        assert_eq!(result.message, "SNF cancelled after 1 rename(s).");
        let data = result.data.expect("data");
        assert_eq!(data.renamed_count, 1);
        assert_eq!(data.ready_count, 2, "the untouched items stay ready in the published plan");
        assert_eq!(file_system.recorded_renames().len(), 1);
    }

    #[test]
    fn cancellation_during_planning_stops_at_the_next_artist_folder() {
        let file_system = MemoryFileSystem::new()
            .with_directory("/library", &[("A", true), ("B", true)])
            .with_directory("/library/A", &[("5. CG", true)])
            .with_directory("/library/B", &[("7. CG", true)]);
        let control = ScriptedRunControl::new(&[CheckpointOutcome::Cancelled]);
        let result = run_snf(
            &input(r#"{"action":"plan","paths":["/library"]}"#),
            &file_system,
            &NoopEventSink,
            &control,
        );
        assert!(!result.success);
        assert_eq!(result.message, "SNF cancelled while planning (1 item(s) planned).");
        let data = result.data.expect("data");
        assert_eq!(data.artist_count, 2, "all folders were collected before the first checkpoint");
        assert_eq!(data.scanned_count, 1);
    }
}
