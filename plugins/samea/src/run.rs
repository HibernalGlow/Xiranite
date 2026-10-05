//! `runSamea` (`core.ts:99-126`): the whole operation, from the root guard to the move loop.
//!
//! The plan is built first and the plan is what a dry run answers with; only `classify` with `dryRun:
//! false` moves anything (`node-definitions/samea.json:363-384`, `interaction.ts:46`). The apply loop is
//! the only place the node writes to the machine, and each of its steps is the pair `core.ts:113-114`
//! performed: create the target's parent, then rename.
//!
//! ## Deviations
//!
//! * **One checkpoint per move** (`PHASE_ORGANIZING`), which TypeScript did not have because its host
//!   cancelled by dropping the worker (ADR-0066). A `Cancelled` answer stops the loop, keeps every effect
//!   already applied, and answers `success: false` with the partial plan in `data` — the same document
//!   shape the run would have produced, so a face can show what actually moved.
//! * **A per-item failure stays per-item.** `core.ts:116-117` caught each rejection and marked only that
//!   item `error`; that behaviour is reproduced, so one refused archive does not abort a hundred-file
//!   classification.

use crate::contract::{
    NO_ARCHIVE_ROOTS_MESSAGE, NO_PLAN_MESSAGE, PROGRESS_COMPLETED, PROGRESS_ORGANIZING,
    PROGRESS_SCANNING, SameaPlanItem, SameaPlanStatus, SameaRunEvent, SameaRunResult,
};
use crate::fs_surface::{SameaEventSink, SameaFileSystem, SameaRunControl};
use crate::input::{NormalizedSameaInput, normalize_samea_input};
use crate::path_tools::path_dirname;
use crate::plan::{PHASE_ORGANIZING, build_samea_plan, summarize};
use serde_json::Value;

/// The message for the plan-only answer (`core.ts:106`).
#[must_use]
pub fn planned_message(ready_count: usize) -> String {
    format!("SameA planned {ready_count} archive transfer(s).")
}

/// The message for the applied answer (`core.ts:122`).
#[must_use]
pub fn organized_message(moved_count: usize) -> String {
    format!("SameA organized {moved_count} archive(s).")
}

/// `runSamea` for a request document, normalizing first (`core.ts:100`).
///
/// An input the old core would have thrown on (a non-iterable `paths`) answers with a failed result and
/// no data rather than escaping as a trap, per ADR-0068's "capability failures are data".
pub fn run_samea(
    input: &Value,
    file_system: &mut dyn SameaFileSystem,
    sink: &mut dyn SameaEventSink,
    control: &mut dyn SameaRunControl,
) -> SameaRunResult {
    match normalize_samea_input(input) {
        Ok(normalized) => run_samea_normalized(&normalized, file_system, sink, control),
        Err(error) => SameaRunResult {
            success: false,
            message: error.to_string(),
            data: None,
        },
    }
}

/// `runSamea` for an already normalized input (`core.ts:99`, minus the normalization line).
pub fn run_samea_normalized(
    input: &NormalizedSameaInput,
    file_system: &mut dyn SameaFileSystem,
    sink: &mut dyn SameaEventSink,
    control: &mut dyn SameaRunControl,
) -> SameaRunResult {
    if input.paths.is_empty() {
        return failure(NO_ARCHIVE_ROOTS_MESSAGE, input);
    }

    emit(sink, PROGRESS_SCANNING);
    let planned = match build_samea_plan(input, file_system, control) {
        Ok(planned) => planned,
        Err(error) => return failure(&error.message(), input),
    };

    if planned.error_count > 0 {
        // `core.ts:105`: the first error text is the message, and the plan is still returned.
        let message = planned.errors.first().cloned().unwrap_or_else(|| NO_PLAN_MESSAGE.to_string());
        return SameaRunResult { success: false, message, data: Some(planned) };
    }

    if !input.action.is_classify() || input.dry_run {
        return success(planned_message(planned.ready_count), planned);
    }

    emit(sink, PROGRESS_ORGANIZING);
    let total = planned.items.len();
    let mut applied: Vec<SameaPlanItem> = Vec::with_capacity(total);
    let mut cancelled = false;
    for (index, item) in planned.items.iter().enumerate() {
        if item.status != SameaPlanStatus::Ready {
            applied.push(item.clone());
            continue;
        }
        if control.checkpoint(PHASE_ORGANIZING, index, total).is_hard_stop() {
            // Stop without starting another item (ADR-0066), and publish the rest of the plan unchanged:
            // the items that never got their turn are still `ready`, which is the truth a face should show.
            cancelled = true;
            applied.extend(planned.items[index..].iter().cloned());
            break;
        }
        match apply_move(file_system, item) {
            Ok(()) => applied.push(SameaPlanItem { status: SameaPlanStatus::Moved, ..item.clone() }),
            Err(error) => applied.push(SameaPlanItem {
                status: SameaPlanStatus::Error,
                reason: Some(error.message),
                ..item.clone()
            }),
        }
    }

    if cancelled {
        let data = summarize(input, applied, planned.groups, planned.scanned_count);
        return SameaRunResult { success: false, message: "SameA was cancelled.".to_string(), data: Some(data) };
    }

    emit(sink, PROGRESS_COMPLETED);
    let data = summarize(input, applied, planned.groups, planned.scanned_count);
    SameaRunResult {
        success: data.error_count == 0,
        message: organized_message(data.moved_count),
        data: Some(data),
    }
}

/// `core.ts:113-114`: the parent is created by the run, then the rename happens.
///
/// `platform.ts:13`'s `movePath` also created the parent itself; keeping both calls costs one
/// `create_dir_all` and preserves the order the old core performed its effects in.
fn apply_move(
    file_system: &mut dyn SameaFileSystem,
    item: &SameaPlanItem,
) -> Result<(), crate::fs_surface::SameaIoError> {
    file_system.ensure_dir(&path_dirname(&item.target_path))?;
    file_system.move_path(&item.source_path, &item.target_path)
}

/// `core.ts:241`.
#[must_use]
pub fn success(message: String, data: crate::contract::SameaData) -> SameaRunResult {
    SameaRunResult { success: true, message, data: Some(data) }
}

/// `core.ts:242`: a failed run still carries a `SameaData`, built from one synthetic error item.
#[must_use]
pub fn failure(message: &str, input: &NormalizedSameaInput) -> SameaRunResult {
    let item = SameaPlanItem {
        root_path: String::new(),
        source_path: String::new(),
        target_path: String::new(),
        source_name: String::new(),
        artist_key: String::new(),
        artist_name: String::new(),
        status: SameaPlanStatus::Error,
        reason: Some(message.to_string()),
    };
    let data = summarize(input, vec![item], Vec::new(), 0);
    SameaRunResult { success: false, message: message.to_string(), data: Some(data) }
}

fn emit(sink: &mut dyn SameaEventSink, event: (u32, &str)) {
    sink.on_event(SameaRunEvent::Progress { progress: event.0, message: event.1.to_string() });
}
