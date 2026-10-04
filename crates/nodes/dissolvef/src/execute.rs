//! Execution: apply a plan, journal what was applied so it can be undone.
//!
//! Port of `executePlan` and `recordUndoIfNeeded` (`core.ts:481-549`). The row order of the returned plan is
//! part of the contract: `core.ts:513` puts the skipped rows first, then the applied ones, because the GUI
//! and the terminal result view render `data.plan` as it arrives.
//!
//! What `core.ts` could not express and ADR-0066 requires: a checkpoint per applied item, and the fact that a
//! cancelled run must still journal the moves it already made. Files that moved without a record in the undo
//! journal would be unrecoverable, so the journal write is attempted even on the cancellation path.

use crate::contract::{DissolvefMode, DissolvefRunScope, NormalizedDissolvefInput};
use crate::document::{
    DissolveUndoMode, DissolveUndoOperation, DissolveUndoRecord, DissolvefData, DissolvefOperation,
    DissolvefPlanItem, DissolvefPlanStatus, DissolvefResult,
};
use crate::history::{dissolve_record_id, dump_dissolve_history, parse_dissolve_history};
use crate::host::{
    DissolvefHost, DissolvefHostError, DissolvefHostResult, PHASE_DISSOLVING, finished_event,
    progress_event, report_progress,
};
use crate::paths::dirname_of;
use crate::plan::checkpoint;

/// The journal cap `core.ts:547` writes with (`records.slice(0, 100)`).
const DISSOLVE_HISTORY_WRITE_CAP: usize = 100;

/// What an applied plan produced. `cancelled` is the ADR-0066 stop; everything else is `core.ts`'s own shape.
#[derive(Debug, Clone)]
pub(crate) struct DissolvefExecution {
    pub plan: Vec<DissolvefPlanItem>,
    pub success_count: usize,
    pub failed_count: usize,
    pub operation_id: String,
    pub cancelled: bool,
}

impl DissolvefExecution {
    /// The result document `executePlan` returned (`core.ts:515-525`), where `success` is
    /// `failedCount === 0` even though the message always reads "Dissolve completed".
    #[must_use]
    pub fn into_result(self) -> DissolvefResult {
        // `core.ts:518-524`: spread `dataFromPlan(finalPlan)`, then overwrite the counters and `operationId`,
        // so `skippedCount`/`errorCount`/`totalCount` stay consistent with the rows the document carries.
        let base = crate::run::data_from_plan(&self.plan);
        let data = DissolvefData {
            success_count: self.success_count,
            failed_count: self.failed_count,
            operation_id: self.operation_id,
            ..base
        };
        let message = format!(
            "Dissolve {}: {} success, {} skipped, {} failed.",
            if self.cancelled { "cancelled" } else { "completed" },
            data.success_count,
            data.skipped_count,
            data.failed_count
        );
        let success = data.failed_count == 0;
        if self.cancelled {
            return DissolvefResult::cancelled(&message, data);
        }
        DissolvefResult::reported(&message, data, success)
    }
}

/// `executePlan` (`core.ts:481-526`).
pub(crate) fn execute_plan(
    input: &NormalizedDissolvefInput,
    plan: &[DissolvefPlanItem],
    history_path: &str,
    scope: &DissolvefRunScope,
    host: &mut dyn DissolvefHost,
) -> DissolvefHostResult<DissolvefExecution> {
    let pending: Vec<&DissolvefPlanItem> =
        plan.iter().filter(|item| item.status == DissolvefPlanStatus::Pending).collect();
    let total = pending.len();
    let mut completed: Vec<DissolvefPlanItem> = Vec::with_capacity(total);
    let mut success_count = 0usize;
    let mut failed_count = 0usize;
    let mut cancelled = false;

    for (index, item) in pending.iter().enumerate() {
        match checkpoint(host, PHASE_DISSOLVING, index, total) {
            Ok(()) => {}
            // A checkpoint that answered `Cancelled`, or a capability that reported the operation as
            // cancelled, stops before this item is attempted.
            Err(DissolvefHostError::Cancelled) => {
                cancelled = true;
                break;
            }
            Err(error) => return Err(error),
        }
        report_progress(host, &progress_event(&item.source_path, index, total))?;

        match apply_item(item, host) {
            Ok(()) => {
                completed.push(item.with_status(DissolvefPlanStatus::Success, None));
                success_count += 1;
            }
            Err(DissolvefHostError::Cancelled) => {
                // Refused because the operation ended: neither a success row nor an error row.
                cancelled = true;
                break;
            }
            Err(DissolvefHostError::Failure(message)) => {
                // `core.ts:506`: the item's error message becomes this row's `reason`.
                completed.push(item.with_status(DissolvefPlanStatus::Error, Some(message)));
                failed_count += 1;
            }
        }
    }

    let skipped: Vec<DissolvefPlanItem> = plan
        .iter()
        .filter(|item| item.status == DissolvefPlanStatus::Skipped)
        .cloned()
        .collect();

    let mut operation_id = String::new();
    match record_undo_if_needed(input, history_path, scope, &completed, host) {
        Ok(id) => operation_id = id,
        // On the cancellation path a refused journal write is not worth a second failure: the moves that
        // happened are still reported, and the host's own file-operation journal covers recovery.
        Err(DissolvefHostError::Cancelled) if cancelled => {}
        Err(error) => return Err(error),
    }

    if !cancelled {
        report_progress(host, &finished_event("Dissolve completed."))?;
    }

    let mut final_plan = skipped;
    final_plan.extend(completed);
    Ok(DissolvefExecution {
        plan: final_plan,
        success_count,
        failed_count,
        operation_id,
        cancelled,
    })
}

/// One row of the plan, performed. `core.ts:496-502`: a delete is a delete; a move makes room for its parent
/// directory, drops the file it was told to replace, then moves.
fn apply_item(
    item: &DissolvefPlanItem,
    host: &mut dyn DissolvefHost,
) -> DissolvefHostResult<()> {
    if item.operation == DissolvefOperation::DeleteDir {
        return host.delete_path(&item.source_path, item.recursive_delete.unwrap_or(false));
    }
    host.ensure_dir(&dirname_of(&item.target_path))?;
    if item.delete_target.unwrap_or(false) {
        host.delete_path(&item.target_path, false)?;
    }
    host.move_path(&item.source_path, &item.target_path)
}

/// `recordUndoIfNeeded` (`core.ts:528-549`): the newest record goes first, and the file stays capped.
fn record_undo_if_needed(
    input: &NormalizedDissolvefInput,
    history_path: &str,
    scope: &DissolvefRunScope,
    completed: &[DissolvefPlanItem],
    host: &mut dyn DissolvefHost,
) -> DissolvefHostResult<String> {
    let applied: Vec<&DissolvefPlanItem> = completed
        .iter()
        .filter(|item| item.status == DissolvefPlanStatus::Success)
        .collect();
    let operations: Vec<DissolveUndoOperation> = applied
        .iter()
        .map(|item| DissolveUndoOperation {
            kind: item.operation,
            source_path: item.source_path.clone(),
            // A `delete_dir` row records only what it removed; a move records where it went (`core.ts:531`).
            target_path: (item.operation == DissolvefOperation::Move)
                .then(|| item.target_path.clone()),
        })
        .collect();
    if operations.is_empty() {
        // `core.ts:534`: nothing was applied, so there is no journal entry and no `operationId`.
        return Ok(String::new());
    }

    let mut modes: Vec<DissolvefMode> = Vec::new();
    for item in &applied {
        if !modes.contains(&item.mode) {
            modes.push(item.mode);
        }
    }
    // `modes.length === 1 ? modes[0] : "mixed"` (`core.ts:540`).
    let mode = match modes.as_slice() {
        [single] => DissolveUndoMode::from(*single),
        _ => DissolveUndoMode::Mixed,
    };

    let timestamp = host.now()?;
    let id = dissolve_record_id(&timestamp, scope, &input.path, &operations);
    let record = DissolveUndoRecord {
        id: id.clone(),
        timestamp,
        mode,
        path: input.path.clone(),
        count: operations.len() as i64,
        operations,
        undone: None,
    };

    let content = host.read_text(history_path)?;
    let mut records = parse_dissolve_history(content.as_deref());
    records.insert(0, record);
    records.truncate(records.len().min(DISSOLVE_HISTORY_WRITE_CAP));
    host.write_text(history_path, &dump_dissolve_history(&records))?;
    Ok(id)
}
