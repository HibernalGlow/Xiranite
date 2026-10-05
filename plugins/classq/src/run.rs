//! The run: `runClassq` (`packages/nodes/classq/src/core.ts:93-120`) as one typed function.
//!
//! Two rules from the TypeScript are load-bearing and easy to lose in a port, so they are named here:
//!
//! - **A plan never writes.** `core.ts:99` returns as soon as the action is not `classify` *or* `dryRun` is set, and
//!   `dryRun` defaults to `true` (`core.ts:89`). The default state of this node is read-only, which is what
//!   `help.safety.defaultMode` (`help.ts:33`, `:68`) publishes as `"dry-run"`.
//! - **A failed row does not stop the loop, but it does fail the run.** `core.ts:112-114` catches per item, and
//!   `core.ts:226` sets `success = data.errorCount === 0`, so one locked folder reports `success: false` while every
//!   other transfer in the batch stays applied.
//!
//! What the TypeScript could not express and ADR-0066 requires: `xiranite.operation.checkpoint` yields — one call
//! before the walk and one per item while applying, which is the item boundary the pause semantics were designed
//! around. A cancellation is reported as the `failure` result the outer `catch` (`core.ts:117-119`) produced for any
//! thrown error, except that rows the run already processed keep their real status: files that were moved are a fact
//! the user needs, not a detail to hide behind an empty item list.

use crate::contract::{
    ClassqAction, ClassqData, ClassqItemKind, ClassqPlanItem, ClassqPlanStatus, ClassqRunEvent, ClassqRunResult,
    ClassqStage, ClassqTransferMode,
};
use crate::input_normalization::{ClassqInput, NormalizedClassqInput, normalize_classq_input};
use crate::interaction_rules::{
    ClassqDangerPrompt, ClassqLanguage, classq_danger_prompt, classq_preview, is_dangerous, validate_classq_input,
};
use crate::path_text::path_dirname;
use crate::plan::{build_classq_data, build_classq_plan};
use crate::runtime::{ClassqEventSink, ClassqFileSystem, ClassqPhase, ClassqRunControl};

/// `core.ts:96`, the message a run with no root produces. The localized *validator* copy is a different string in a
/// different layer (`interaction.ts:24`, [`crate::interaction_rules::validate_classq_input`]); keeping both is the
/// point, because the CLI prints one and the form shows the other.
pub const CLASSQ_NO_ROOTS_MESSAGE: &str = "At least one root directory is required.";

/// `core.ts:97`.
pub const CLASSQ_SCANNING_MESSAGE: &str = "Scanning keyword folders.";

/// `core.ts:101`.
pub const CLASSQ_APPLYING_MESSAGE: &str = "Applying wait-folder transfers.";

/// The `xiranite.operation.checkpoint` cancellation line. The capability answers with an ABI code, so the wording is
/// the plugin's, and `plugins/timeu/src/extism_boundary.rs:90` already fixed this sentence for the family.
pub const CLASSQ_CANCELLED_MESSAGE: &str = "Operation cancelled.";

/// The `reason` a row stopped at the checkpoint carries. A new reason string, because ADR-0066's cancellation has no
/// `core.ts` counterpart to copy.
pub const CLASSQ_CANCELLED_REASON: &str = "cancelled_by_checkpoint";

/// Runs one ClassQ operation: `runClassq(input, runtime, onEvent)` with ADR-0066's control seam added.
pub fn run_classq(
    input: &ClassqInput,
    file_system: &dyn ClassqFileSystem,
    sink: &mut dyn ClassqEventSink,
    control: &mut dyn ClassqRunControl,
) -> ClassqRunResult {
    let normalized = normalize_classq_input(input);
    if normalized.paths.is_empty() {
        // `core.ts:96`: the guard sits inside the `try`, but it cannot throw, so no checkpoint is spent.
        return failure_classq_result(CLASSQ_NO_ROOTS_MESSAGE, &normalized);
    }

    if control.checkpoint(ClassqPhase::Scan, 0, normalized.paths.len()).is_hard_stop() {
        return failure_classq_result(CLASSQ_CANCELLED_MESSAGE, &normalized);
    }
    sink.on_event(ClassqRunEvent::progress(20.0, CLASSQ_SCANNING_MESSAGE));

    let planned = match build_classq_plan(&normalized, file_system) {
        Ok(data) => data,
        // `core.ts:117-119`: a listing that failed mid-walk aborts the run with the operating system's message.
        Err(error) => return failure_classq_result(&error.message, &normalized),
    };

    // `core.ts:99`: a plan action, or any dry run, stops here with the plan as the answer.
    if normalized.action != ClassqAction::Classify || normalized.dry_run {
        return success_classq_result(format!("ClassQ planned {} item(s).", planned.items.len()), planned);
    }

    sink.on_event(ClassqRunEvent::progress(70.0, CLASSQ_APPLYING_MESSAGE));
    apply_wait_transfers(&normalized, &planned.items, file_system, control)
}

/// `core.ts:102-116`: the apply loop. `applied` keeps the plan's order and every row, applied or not.
fn apply_wait_transfers(
    normalized: &NormalizedClassqInput,
    items: &[ClassqPlanItem],
    file_system: &dyn ClassqFileSystem,
    control: &mut dyn ClassqRunControl,
) -> ClassqRunResult {
    let mut applied: Vec<ClassqPlanItem> = Vec::with_capacity(items.len());
    let total = items.len();

    for (index, item) in items.iter().enumerate() {
        if control.checkpoint(ClassqPhase::Apply, index, total).is_hard_stop() {
            let mut stopped = applied;
            stopped.push(ClassqPlanItem {
                status: ClassqPlanStatus::Error,
                reason: Some(CLASSQ_CANCELLED_REASON.to_owned()),
                ..item.clone()
            });
            stopped.extend_from_slice(&items[index + 1..]);
            return ClassqRunResult {
                success: false,
                message: CLASSQ_CANCELLED_MESSAGE.to_owned(),
                data: Some(build_classq_data(normalized, &stopped)),
            };
        }

        if item.status != ClassqPlanStatus::Ready {
            // `core.ts:104-107`: found/conflict/error rows travel through untouched.
            applied.push(item.clone());
            continue;
        }

        // `core.ts:109-110`: create the wait folder, then transfer into it.
        let parent = path_dirname(&item.target_path);
        let outcome = file_system
            .ensure_dir(&parent)
            .and_then(|()| file_system.transfer(&item.source_path, &item.target_path, normalized.transfer_mode));
        applied.push(match outcome {
            Ok(()) => ClassqPlanItem {
                status: match normalized.transfer_mode {
                    ClassqTransferMode::Copy => ClassqPlanStatus::Copied,
                    ClassqTransferMode::Move => ClassqPlanStatus::Moved,
                },
                ..item.clone()
            },
            // `core.ts:112-114`: the failure message becomes this row's `reason`.
            Err(error) => {
                ClassqPlanItem { status: ClassqPlanStatus::Error, reason: Some(error.message), ..item.clone() }
            }
        });
    }

    let transferred = applied
        .iter()
        .filter(|item| item.status == ClassqPlanStatus::Moved || item.status == ClassqPlanStatus::Copied)
        .count();
    success_classq_result(format!("ClassQ applied {transferred} transfer(s)."), build_classq_data(normalized, &applied))
}

/// `success` (`core.ts:225-227`): the message plus `errorCount === 0`.
#[must_use]
pub fn success_classq_result(message: impl Into<String>, data: ClassqData) -> ClassqRunResult {
    let success = data.error_count == 0;
    ClassqRunResult { success, message: message.into(), data: Some(data) }
}

/// `failure` (`core.ts:229-231`): the message plus one synthetic error row, so `data` is never absent.
#[must_use]
pub fn failure_classq_result(message: &str, input: &NormalizedClassqInput) -> ClassqRunResult {
    let item = synthetic_failure_item(message);
    ClassqRunResult {
        success: false,
        message: message.to_owned(),
        data: Some(build_classq_data(input, std::slice::from_ref(&item))),
    }
}

/// The `{ …, status: "error", reason: message }` row `core.ts:230` builds: every path field empty, `kind` `folder`,
/// `stage` `wait`.
#[must_use]
pub fn synthetic_failure_item(message: &str) -> ClassqPlanItem {
    ClassqPlanItem {
        root_path: String::new(),
        parent_path: String::new(),
        keyword_path: String::new(),
        source_path: String::new(),
        target_path: String::new(),
        source_name: String::new(),
        target_relative: String::new(),
        kind: ClassqItemKind::Folder,
        stage: ClassqStage::Wait,
        status: ClassqPlanStatus::Error,
        reason: Some(message.to_owned()),
    }
}

/// A pre-flight read of what a face must show before it runs: the validator message, the preview lines and whether
/// the danger gate holds.
///
/// `interaction.ts:24`/`:25`/`:26` were closures the CLI called. A face that only has the JSON input gets the same
/// answers from here, so nobody re-implements a rule (`AGENTS.md`: the definition and its semantics are shared, the
/// composition is not).
#[must_use]
pub fn classq_preflight(input: &ClassqInput, language: ClassqLanguage) -> ClassqPreflight {
    let normalized = normalize_classq_input(input);
    ClassqPreflight {
        validation_message: validate_classq_input(&normalized, language).map(str::to_owned),
        preview: classq_preview(&normalized, language),
        confirmation: is_dangerous(&normalized).then(|| classq_danger_prompt(language)),
        normalized,
    }
}

/// What a face needs before prompting; see [`classq_preflight`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClassqPreflight {
    /// `validate`'s localized message; `None` when the input may run.
    pub validation_message: Option<String>,
    /// `preview`'s lines, the `previewExport` document.
    pub preview: Vec<String>,
    /// The confirmation copy, present only when the gate holds.
    pub confirmation: Option<ClassqDangerPrompt>,
    /// The input the answers were computed from.
    pub normalized: NormalizedClassqInput,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::in_memory_runtime::{MemoryFileSystem, ScriptedClassqRunControl};
    use crate::runtime::{AlwaysContinueClassqRunControl, NoopClassqEventSink};

    /// `core.test.ts:65-70`: one keyword folder and one ready sibling.
    fn fixture() -> MemoryFileSystem {
        MemoryFileSystem::new()
            .with_directory("/root", &[("already", true), ("pending.zip", false)])
            .with_directory("/root/already", &[])
    }

    fn fixture_two_siblings() -> MemoryFileSystem {
        MemoryFileSystem::new()
            .with_directory("/root", &[("already", true), ("a.zip", false), ("b.zip", false)])
            .with_directory("/root/already", &[])
    }

    fn fixture_three_siblings() -> MemoryFileSystem {
        MemoryFileSystem::new()
            .with_directory("/root", &[("already", true), ("a.zip", false), ("b.zip", false), ("c.zip", false)])
            .with_directory("/root/already", &[])
    }

    fn run(json: &str, file_system: &MemoryFileSystem, control: &mut dyn ClassqRunControl) -> ClassqRunResult {
        let input: ClassqInput = serde_json::from_str(json).expect("input json");
        run_classq(&input, file_system, &mut NoopClassqEventSink, control)
    }

    #[test]
    fn a_plan_run_reports_the_item_count_and_writes_nothing() {
        let file_system = fixture();
        let result = run(
            r#"{"action":"plan","paths":["/root"]}"#,
            &file_system,
            &mut AlwaysContinueClassqRunControl::default(),
        );
        assert!(result.success);
        assert_eq!(result.message, "ClassQ planned 2 item(s).");
        assert!(file_system.recorded_transfers().is_empty());
        assert!(file_system.recorded_directories().is_empty());
    }

    #[test]
    fn a_dry_run_classify_writes_nothing_even_though_it_is_the_live_action() {
        let file_system = fixture();
        let result = run(
            r#"{"action":"classify","paths":["/root"]}"#,
            &file_system,
            &mut AlwaysContinueClassqRunControl::default(),
        );
        assert!(result.success);
        assert_eq!(result.message, "ClassQ planned 2 item(s).");
        assert!(file_system.recorded_transfers().is_empty(), "core.ts:99 returns before the apply loop");
    }

    #[test]
    fn a_live_classify_moves_and_recounts() {
        let file_system = fixture();
        let result = run(
            r#"{"action":"classify","paths":["/root"],"dryRun":false}"#,
            &file_system,
            &mut AlwaysContinueClassqRunControl::default(),
        );
        assert!(result.success);
        assert_eq!(result.message, "ClassQ applied 1 transfer(s).");
        let data = result.data.clone().expect("data");
        assert_eq!(data.moved_count, 1);
        assert_eq!(data.ready_count, 0, "the applied row is no longer ready");
        assert_eq!(data.wait_count, 1);
        assert_eq!(data.items[0].status, ClassqPlanStatus::Found, "the keyword row still rides along");
    }

    #[test]
    fn a_failing_transfer_is_one_error_row_and_a_failed_run() {
        let file_system = fixture_two_siblings().with_untransferable_source("/root/a.zip");
        let result = run(
            r#"{"action":"classify","paths":["/root"],"dryRun":false}"#,
            &file_system,
            &mut AlwaysContinueClassqRunControl::default(),
        );
        assert!(!result.success, "core.ts:226 makes one error row a failed run");
        let data = result.data.clone().expect("data");
        assert_eq!(data.moved_count, 1, "the other sibling still transferred");
        assert_eq!(data.error_count, 1);
        assert!(data.errors[0].starts_with("/root/a.zip: "), "{:?}", data.errors);
    }

    #[test]
    fn cancellation_stops_at_the_item_boundary() {
        // Checkpoint calls: 0 = the scan, then one per row. The fixture's rows are the `found` keyword row first, so
        // cancelling on the fourth call transfers `a.zip`, stops at `b.zip` and never touches `c.zip`.
        let file_system = fixture_three_siblings();
        let mut control = ScriptedClassqRunControl::cancelling_after(3);
        let result = run_classq(
            &serde_json::from_str(r#"{"action":"classify","paths":["/root"],"dryRun":false}"#).expect("input"),
            &file_system,
            &mut NoopClassqEventSink,
            &mut control,
        );
        assert!(!result.success);
        assert_eq!(result.message, CLASSQ_CANCELLED_MESSAGE);
        let data = result.data.clone().expect("data");
        assert_eq!(
            data.items.iter().map(|item| item.status).collect::<Vec<_>>(),
            vec![
                ClassqPlanStatus::Found,
                ClassqPlanStatus::Moved,
                ClassqPlanStatus::Error,
                ClassqPlanStatus::Ready
            ],
            "the row that was reached reports the stop, the row after it stays ready"
        );
        assert_eq!(data.moved_count, 1, "the transfer that already happened is reported");
        assert_eq!(data.items[2].reason.as_deref(), Some(CLASSQ_CANCELLED_REASON));
        assert_eq!(data.ready_count, 1, "an unprocessed row is still ready, which is what a resume needs");
        assert_eq!(file_system.recorded_transfers().len(), 1);
        assert_eq!(control.recorded_calls().len(), 4, "one scan yield plus one per row reached");
        // Negative control: the same fixture with a run that never cancels transfers all three rows.
        let uncancelled = run(
            r#"{"action":"classify","paths":["/root"],"dryRun":false}"#,
            &fixture_three_siblings(),
            &mut AlwaysContinueClassqRunControl::default(),
        );
        assert_eq!(uncancelled.data.clone().expect("data").moved_count, 3);
    }

    #[test]
    fn cancellation_before_the_walk_is_a_plain_failure_result() {
        let result = run(
            r#"{"action":"classify","paths":["/root"],"dryRun":false}"#,
            &fixture(),
            &mut ScriptedClassqRunControl::cancelling_after(0),
        );
        assert!(!result.success);
        assert_eq!(result.message, CLASSQ_CANCELLED_MESSAGE);
        let data = result.data.clone().expect("data");
        assert_eq!(data.items.len(), 1);
        assert_eq!(data.items[0].source_path, "", "core.ts:230's synthetic row, not a plan");
    }

    #[test]
    fn the_synthetic_row_is_the_shape_core_ts_builds() {
        let item = synthetic_failure_item("boom");
        assert_eq!(item.source_path, "");
        assert_eq!(item.status, ClassqPlanStatus::Error);
        assert_eq!(item.reason.as_deref(), Some("boom"));
        // `data()` quotes `sourcePath` in `errors`, so an empty one produces the leading `": "` the TypeScript did.
        let normalized = normalize_classq_input(&ClassqInput::default());
        let data = build_classq_data(&normalized, std::slice::from_ref(&item));
        assert_eq!(data.errors, vec![": boom"]);
    }

    #[test]
    fn preflight_reports_the_validator_message_and_the_preview() {
        let preflight = classq_preflight(&ClassqInput::default(), ClassqLanguage::En);
        assert_eq!(preflight.validation_message.as_deref(), Some("Enter at least one root directory."));
        assert_eq!(preflight.preview, vec!["Rule: already → wait", "Roots: 0", "Preview"]);
        assert!(preflight.confirmation.is_none(), "a defaulted input is a dry-run plan");

        let live: ClassqInput =
            serde_json::from_str(r#"{"action":"classify","paths":["/root"],"dryRun":false}"#).expect("input");
        let preflight = classq_preflight(&live, ClassqLanguage::Zh);
        assert_eq!(preflight.validation_message, None);
        let confirmation = preflight.confirmation.expect("the gate holds");
        assert_eq!(confirmation.title, "确认真实分类");
        assert_eq!(confirmation.confirm_label, "确认分类");
    }

    #[test]
    fn an_aborted_walk_reports_the_runtime_message() {
        let file_system = MemoryFileSystem::new()
            .with_directory("/root", &[("already", true)])
            .with_directory("/root/already", &[])
            .with_unreadable_directory("/root");
        let result = run(r#"{"paths":["/root"]}"#, &file_system, &mut AlwaysContinueClassqRunControl::default());
        assert!(!result.success);
        assert!(result.message.contains("permission denied"), "{}", result.message);
    }
}
