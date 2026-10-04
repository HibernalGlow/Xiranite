//! The run: nine actions, one entry point, and the response document.
//!
//! Port of `runDissolvef`, `history`, `undo`, `collectSingleArchivePaths`, `dataFromPlan` and the
//! `success`/`failure` builders (`core.ts:167-218`, `core.ts:551-605`, `core.ts:872-915`). Action names,
//! message wording and counters are the node's published vocabulary, so every string here is the string
//! `core.ts` produced; `interaction.ts:3`'s `result` renderer reads `totalCount`/`successCount`/
//! `skippedCount`/`failedCount` out of the document below.
//!
//! ADR-0066 adds the cancellation exits: a read-only action that stops at a checkpoint reports
//! `stats.cancelled` with nothing applied, and a stop after work was applied is reported by `execute.rs`
//! with the applied rows intact.

use crate::contract::{
    DissolvefAction, DissolvefInput, DissolvefMode, DissolvefRunScope, NormalizedDissolvefInput,
    normalize_dissolvef_input,
};
use crate::document::{
    DissolveUndoOperation, DissolvefData, DissolvefItemKind, DissolvefOperation, DissolvefPlanItem,
    DissolvefPlanStatus, DissolvefResult,
};
use crate::execute::execute_plan;
use crate::history::{dump_dissolve_history, parse_dissolve_history, resolve_history_path};
use crate::host::{
    DissolvefHost, DissolvefHostError, DissolvefHostResult, PHASE_SCANNING, PHASE_UNDOING,
    finished_event, progress_event, report_progress,
};
use crate::paths::dirname_of;
use crate::plan::{build_dissolvef_plan, checkpoint, plan_archive_for_collection};
use crate::similarity::compare_names_locale_aware;

/// `runDissolvef` (`core.ts:167-189`).
pub fn run_dissolvef(
    input: &DissolvefInput,
    scope: &DissolvefRunScope,
    host: &mut dyn DissolvefHost,
) -> DissolvefResult {
    let normalized = normalize_dissolvef_input(input);
    match run_action(&normalized, scope, host) {
        Ok(result) => result,
        // The `catch` in `core.ts:186-188`: any thrown message becomes a failed result document.
        Err(DissolvefHostError::Failure(message)) => DissolvefResult::failure(&message),
        Err(DissolvefHostError::Cancelled) => {
            cancelled_while_reading("Dissolve cancelled before the next item.")
        }
    }
}

fn run_action(
    input: &NormalizedDissolvefInput,
    scope: &DissolvefRunScope,
    host: &mut dyn DissolvefHost,
) -> DissolvefHostResult<DissolvefResult> {
    match input.action {
        DissolvefAction::History => return history_action(input, scope, host),
        DissolvefAction::Undo => return undo_action(input, scope, host),
        DissolvefAction::CollectArchives => return collect_archives_action(input, host),
        _ => {}
    }

    let plan = build_dissolvef_plan(input, host)?;
    if input.action == DissolvefAction::Plan || input.preview {
        let pending = plan.iter().filter(|item| item.status == DissolvefPlanStatus::Pending).count();
        return Ok(DissolvefResult::completed(
            &format!("Plan generated: {pending} operation(s)."),
            data_from_plan(&plan),
        ));
    }

    // The journal location is settled before anything moves. `core.ts` could take it for granted because
    // `defaultHistoryPath()` always returned a config-directory path; here a run that cannot record its own
    // undo information must not start applying operations at all.
    let history_path = history_path_or_refusal(input, scope)?;
    execute_plan(input, &plan, &history_path, scope, host)
        .map(crate::execute::DissolvefExecution::into_result)
}

/// `collect_archives` (`core.ts:176-179` plus `collectSingleArchivePaths`, `core.ts:214-218`).
fn collect_archives_action(
    input: &NormalizedDissolvefInput,
    host: &mut dyn DissolvefHost,
) -> DissolvefHostResult<DissolvefResult> {
    let archive_paths = collect_single_archive_paths(input, host)?;
    let count = archive_paths.len();
    Ok(DissolvefResult::completed(
        &format!("Collected {count} archive path(s)."),
        DissolvefData { archive_paths, ..DissolvefData::default() },
    ))
}

/// `collectSingleArchivePaths` (`core.ts:214-218`): the pending move sources of the archive planner, unique
/// and sorted. It reuses `planArchive` on the resolved root, so it inherits the blacklist, the exclude list
/// and the similarity gate — and it skips `buildDissolvefPlan`'s existence checks.
fn collect_single_archive_paths(
    input: &NormalizedDissolvefInput,
    host: &mut dyn DissolvefHost,
) -> DissolvefHostResult<Vec<String>> {
    let plan = plan_archive_for_collection(input, host)?;
    let mut paths: Vec<String> = Vec::new();
    for item in plan.iter().filter(|item| {
        item.operation == DissolvefOperation::Move && item.status == DissolvefPlanStatus::Pending
    }) {
        if !paths.contains(&item.source_path) {
            paths.push(item.source_path.clone());
        }
    }
    paths.sort_by(|left, right| compare_names_locale_aware(left, right));
    Ok(paths)
}

/// `history` (`core.ts:551-554`).
fn history_action(
    input: &NormalizedDissolvefInput,
    scope: &DissolvefRunScope,
    host: &mut dyn DissolvefHost,
) -> DissolvefHostResult<DissolvefResult> {
    checkpoint(host, PHASE_SCANNING, 0, 1)?;
    let path = history_path_or_refusal(input, scope)?;
    let content = host.read_text(&path)?;
    let records = parse_dissolve_history(content.as_deref());
    let shown: Vec<_> = records.into_iter().take(input.history_limit).collect();
    let count = shown.len();
    Ok(DissolvefResult::completed(
        &format!("Loaded {count} history record(s)."),
        DissolvefData { history: shown, ..DissolvefData::default() },
    ))
}

/// `undo` (`core.ts:556-605`), including the two refusal messages `core.ts` distinguishes.
fn undo_action(
    input: &NormalizedDissolvefInput,
    scope: &DissolvefRunScope,
    host: &mut dyn DissolvefHost,
) -> DissolvefHostResult<DissolvefResult> {
    let path = history_path_or_refusal(input, scope)?;
    let content = host.read_text(&path)?;
    let mut records = parse_dissolve_history(content.as_deref());

    // `records.find(item => item.id === undoId)` else `records.find(item => !item.undone)`; `undone` that is
    // absent or `false` both read as "not undone yet".
    let selected = if input.undo_id.is_empty() {
        records.iter().position(|record| record.undone != Some(true))
    } else {
        records.iter().position(|record| record.id == input.undo_id)
    };
    let Some(record_index) = selected else {
        let message = if input.undo_id.is_empty() {
            "No undoable record found.".to_string()
        } else {
            format!("Undo record not found: {}", input.undo_id)
        };
        return Ok(DissolvefResult::failure(&message));
    };
    if records[record_index].undone == Some(true) {
        let id = records[record_index].id.clone();
        return Ok(DissolvefResult::failure(&format!("Undo record already applied: {id}")));
    }

    let operations = records[record_index].operations.clone();
    let total = operations.len();
    let mut success_count = 0usize;
    let mut failed_count = 0usize;
    let mut errors: Vec<String> = Vec::new();
    let mut cancelled = false;

    // `[...record.operations].reverse()`: the journal is undone newest-first.
    for (position, operation) in operations.iter().rev().enumerate() {
        match checkpoint(host, PHASE_UNDOING, position, total) {
            Ok(()) => {}
            Err(DissolvefHostError::Cancelled) => {
                cancelled = true;
                break;
            }
            Err(error) => return Err(error),
        }
        report_progress(host, &progress_event(&operation.source_path, position, total))?;
        match undo_operation(operation, host) {
            Ok(()) => success_count += 1,
            Err(DissolvefHostError::Cancelled) => {
                cancelled = true;
                break;
            }
            Err(DissolvefHostError::Failure(message)) => {
                failed_count += 1;
                errors.push(message);
            }
        }
    }

    // `record.undone = failedCount === 0` — and never on a cancelled run, whose remaining operations were not
    // performed: marking it undone would hide a half-restored folder from the next `undo`.
    if !cancelled {
        records[record_index].undone = Some(failed_count == 0);
    }
    host.write_text(&path, &dump_dissolve_history(&records))?;
    if !cancelled {
        report_progress(host, &finished_event("Undo completed."))?;
    }

    let message = if cancelled {
        format!("Undo cancelled: {success_count} success, {failed_count} failed.")
    } else {
        format!("Undo completed: {success_count} success, {failed_count} failed.")
    };
    let data = DissolvefData {
        history: records,
        success_count,
        failed_count,
        errors,
        ..DissolvefData::default()
    };
    if cancelled {
        return Ok(DissolvefResult::cancelled(&message, data));
    }
    Ok(DissolvefResult::reported(&message, data, failed_count == 0))
}

/// One journal row reversed (`core.ts:570-595`).
fn undo_operation(
    operation: &DissolveUndoOperation,
    host: &mut dyn DissolvefHost,
) -> DissolvefHostResult<()> {
    if operation.kind == DissolvefOperation::DeleteDir {
        // The directory the run deleted is created again; its contents come back through the move rows.
        return host.ensure_dir(&operation.source_path);
    }
    let Some(target_path) = operation.target_path.clone() else {
        // `core.ts:573`'s `else if (operation.targetPath)`: a move row without a target counts as done.
        return Ok(());
    };
    let source = host.stat(&operation.source_path)?;
    let target = host.stat(&target_path)?;
    if source.exists && target.exists {
        return Err(DissolvefHostError::Failure(format!(
            "Undo conflict: both source and target exist: {}",
            operation.source_path
        )));
    }
    if source.exists {
        // Already restored by an earlier attempt; nothing to move, and it still counts as a success.
        return Ok(());
    }
    if !target.exists {
        return Err(DissolvefHostError::Failure(format!("Undo source is missing: {target_path}")));
    }
    host.ensure_dir(&dirname_of(&operation.source_path))?;
    host.move_path(&target_path, &operation.source_path)
}

/// `dataFromPlan` (`core.ts:872-886`).
pub(crate) fn data_from_plan(plan: &[DissolvefPlanItem]) -> DissolvefData {
    let active: Vec<&DissolvefPlanItem> = plan
        .iter()
        .filter(|item| {
            item.status == DissolvefPlanStatus::Pending || item.status == DissolvefPlanStatus::Success
        })
        .collect();
    let deleted_in = |mode: DissolvefMode| {
        active
            .iter()
            .filter(|item| item.mode == mode && item.operation == DissolvefOperation::DeleteDir)
            .count()
    };
    let moved_direct = |kind: DissolvefItemKind| {
        active
            .iter()
            .filter(|item| {
                item.mode == DissolvefMode::Direct
                    && item.operation == DissolvefOperation::Move
                    && item.item_kind == kind
            })
            .count()
    };
    let errors: Vec<String> = plan
        .iter()
        .filter(|item| item.status == DissolvefPlanStatus::Error)
        .map(|item| item.reason.clone().unwrap_or_else(|| "unknown_error".to_string()))
        .collect();
    DissolvefData {
        plan: plan.to_vec(),
        nested_count: deleted_in(DissolvefMode::Nested),
        media_count: deleted_in(DissolvefMode::Media),
        archive_count: deleted_in(DissolvefMode::Archive),
        direct_files: moved_direct(DissolvefItemKind::File),
        direct_dirs: moved_direct(DissolvefItemKind::Directory),
        skipped_count: plan.iter().filter(|item| item.status == DissolvefPlanStatus::Skipped).count(),
        error_count: errors.len(),
        total_count: plan.len(),
        errors,
        ..DissolvefData::default()
    }
}

/// `historyPath` for the two actions that need a journal, with a missing host default reported instead of
/// writing to an empty path.
fn history_path_or_refusal(
    input: &NormalizedDissolvefInput,
    scope: &DissolvefRunScope,
) -> DissolvefHostResult<String> {
    resolve_history_path(input, scope).ok_or_else(|| {
        DissolvefHostError::Failure(
            "History path is required: set input.historyPath or runOptions.defaultHistoryPath.".to_string(),
        )
    })
}

/// The cancellation of a read-only action: nothing was applied, so the document carries the message only.
fn cancelled_while_reading(message: &str) -> DissolvefResult {
    DissolvefResult::cancelled(
        message,
        DissolvefData { errors: vec![message.to_string()], ..DissolvefData::default() },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::DissolvefConflictMode;

    fn row(
        mode: DissolvefMode,
        operation: DissolvefOperation,
        kind: DissolvefItemKind,
        status: DissolvefPlanStatus,
        reason: Option<&str>,
    ) -> DissolvefPlanItem {
        DissolvefPlanItem {
            reason: reason.map(str::to_string),
            ..DissolvefPlanItem::new(mode, operation, "/root/x", "/x", kind == DissolvefItemKind::Directory, status)
        }
    }

    #[test]
    fn plan_counts_split_active_rows_from_the_whole_plan() {
        // `dataFromPlan` counts delete rows only for the nested/media/archive modes, and it counts the
        // direct moves by item kind; `skippedCount`, `errorCount` and `totalCount` see every row.
        let plan = vec![
            row(DissolvefMode::Nested, DissolvefOperation::DeleteDir, DissolvefItemKind::Directory, DissolvefPlanStatus::Pending, None),
            row(DissolvefMode::Media, DissolvefOperation::DeleteDir, DissolvefItemKind::Directory, DissolvefPlanStatus::Success, None),
            row(DissolvefMode::Archive, DissolvefOperation::Move, DissolvefItemKind::File, DissolvefPlanStatus::Pending, None),
            row(DissolvefMode::Direct, DissolvefOperation::Move, DissolvefItemKind::File, DissolvefPlanStatus::Pending, None),
            row(DissolvefMode::Direct, DissolvefOperation::Move, DissolvefItemKind::File, DissolvefPlanStatus::Pending, None),
            row(DissolvefMode::Direct, DissolvefOperation::Move, DissolvefItemKind::Directory, DissolvefPlanStatus::Success, None),
            row(DissolvefMode::Media, DissolvefOperation::Move, DissolvefItemKind::File, DissolvefPlanStatus::Skipped, Some("blacklisted")),
            row(DissolvefMode::Nested, DissolvefOperation::DeleteDir, DissolvefItemKind::Directory, DissolvefPlanStatus::Error, None),
            row(DissolvefMode::Direct, DissolvefOperation::Move, DissolvefItemKind::File, DissolvefPlanStatus::Error, Some("host refusal")),
        ];
        let data = data_from_plan(&plan);
        assert_eq!(data.nested_count, 1);
        assert_eq!(data.media_count, 1);
        assert_eq!(data.archive_count, 0, "an archive move row is not a deleted folder");
        assert_eq!(data.direct_files, 2);
        assert_eq!(data.direct_dirs, 1);
        assert_eq!(data.skipped_count, 1);
        assert_eq!(data.error_count, 2);
        assert_eq!(data.total_count, 9);
        assert_eq!(data.errors, vec!["unknown_error".to_string(), "host refusal".to_string()]);
        assert_eq!(data.plan.len(), 9);
        assert_eq!(data.operation_id, "");
    }

    #[test]
    fn a_plan_of_only_skipped_rows_counts_as_zero_total_operations() {
        let plan = vec![row(
            DissolvefMode::Archive,
            DissolvefOperation::Move,
            DissolvefItemKind::Directory,
            DissolvefPlanStatus::Skipped,
            Some("excluded"),
        )];
        let data = data_from_plan(&plan);
        assert_eq!(data.total_count, 1);
        assert_eq!(data.skipped_count, 1);
        assert_eq!(data.direct_files, 0);
    }

    #[test]
    fn the_cancelled_document_marks_stats_and_keeps_the_failure_semantics() {
        let result = cancelled_while_reading("Dissolve cancelled before the next item.");
        assert!(!result.success);
        assert!(result.stats.contains_key(crate::document::CANCELLED_STAT_KEY));
        assert_eq!(
            result.data.errors,
            vec!["Dissolve cancelled before the next item.".to_string()]
        );
        assert_eq!(result.data.total_count, 0);
    }

    #[test]
    fn normalization_is_applied_before_dispatch() {
        // The action strings `interaction.ts` emits must all reach a branch; `dryRun` alone must preview.
        let input = DissolvefInput {
            action: Some("plan".to_string()),
            ..DissolvefInput::default()
        };
        let normalized = normalize_dissolvef_input(&input);
        assert_eq!(normalized.action, DissolvefAction::Plan);
        let legacy_preview = normalize_dissolvef_input(&DissolvefInput {
            dry_run: Some(true),
            file_conflict: Some("rename".to_string()),
            ..DissolvefInput::default()
        });
        assert!(legacy_preview.preview);
        assert_eq!(legacy_preview.file_conflict, DissolvefConflictMode::Rename);
    }
}
