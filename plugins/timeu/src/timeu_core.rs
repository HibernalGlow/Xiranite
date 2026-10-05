//! The TimeU run: target collection, plan generation, the record document and the
//! operation loop, ported from `packages/nodes/timeu/src/core.ts`.
//!
//! Every function here is pure with respect to the process: the only effects go
//! through [`TimeuRuntime`], which is what makes the same code usable as a WASM
//! plugin (`src/plugin.rs`) and as a native library for tests. Line references in
//! the doc comments point at the TypeScript that is the behavioural contract.

use std::collections::{BTreeMap, HashSet};

use crate::path_shape::{compare_paths_naturally, normalize_path_key};
use crate::timeu_clock::{iso8601_from_epoch_ms, js_math_round};
use crate::timeu_input::{NormalizedTimeuInput, TimeuInput, normalize_timeu_input};
use crate::timeu_model::{
    TimeuData, TimeuDirectoryEntry, TimeuNodeDescription, TimeuPathInfo, TimeuPlanItem,
    TimeuPlanOperation, TimeuPlanStatus, TimeuRunEvent, TimeuRunResult, TimeuTimestampRecord,
};
use crate::timeu_runtime::{
    TimeuCheckpointOutcome, TimeuEventSink, TimeuHostError, TimeuRuntime,
};

/// `defaultRecordPath`'s file name (`core.ts:247`).
pub const TIMEU_DEFAULT_RECORD_FILE_NAME: &str = "timeu-timestamps.json";

/// The failure message for an empty path list (`core.ts:100`).
pub const TIMEU_NO_PATHS_MESSAGE: &str = "At least one file or directory path is required.";

/// Anything the `try` body at `core.ts:99-142` could throw. The outer `catch`
/// turns each of these into a `failure` result whose message is the display text.
#[derive(Debug, Clone, PartialEq)]
pub enum TimeuCoreError {
    /// A host refusal: `stat`, listing, writing or stamping.
    Host(String),
    /// `xiranite.checkpoint()` reported cancellation (ADR-0066). The TypeScript
    /// core had no equivalent because the host aborted the awaited promise.
    Cancelled(String),
    /// `new Date(value).toISOString()` rejecting with a `RangeError`, which
    /// `core.ts:119`/`core.ts:170` would have propagated as `Invalid time value`.
    InvalidTimeValue,
    /// `JSON.parse` on a record file that is not JSON (`core.ts:203`).
    MalformedRecordJson(String),
}

impl TimeuCoreError {
    fn from_clock(_error: crate::timeu_clock::TimeuClockError) -> Self {
        Self::InvalidTimeValue
    }
}

impl std::fmt::Display for TimeuCoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Host(message) | Self::Cancelled(message) | Self::MalformedRecordJson(message) => {
                formatter.write_str(message)
            }
            Self::InvalidTimeValue => formatter.write_str("Invalid time value"),
        }
    }
}

impl std::error::Error for TimeuCoreError {}

impl From<TimeuHostError> for TimeuCoreError {
    fn from(error: TimeuHostError) -> Self {
        Self::Host(error.message)
    }
}

/// `core.ts:145-166`: expand files and (optionally) directories into the flat,
/// de-duplicated, naturally sorted target list.
///
/// The TypeScript recursed per directory entry; this descends from an explicit
/// stack so a deep tree cannot exhaust a WASM call stack, and tracks descended
/// directories so a symlink cycle stops after one descent instead of looping.
/// Every push the TypeScript made is still made, including the raw text of a
/// missing path and the host-resolved text of an existing one, so the resulting
/// set is the same.
pub fn collect_timeu_targets(
    paths: &[String],
    recursive: bool,
    include_directories: bool,
    runtime: &dyn TimeuRuntime,
) -> Result<Vec<String>, TimeuCoreError> {
    let mut targets: Vec<String> = Vec::new();
    let mut seen_targets: HashSet<String> = HashSet::new();
    let mut descended_directories: HashSet<String> = HashSet::new();
    let mut pending: Vec<String> = paths.iter().rev().cloned().collect();

    while let Some(path) = pending.pop() {
        yield_timeu_checkpoint(runtime)?;

        let info = runtime.path_info(&path)?;
        if !info.exists {
            push_timeu_target(&mut targets, &mut seen_targets, path);
            continue;
        }

        if info.is_file || (include_directories && info.is_directory) {
            push_timeu_target(&mut targets, &mut seen_targets, info.path.clone());
        }

        if !(info.is_directory && recursive) {
            continue;
        }
        if !descended_directories.insert(info.path.clone()) {
            continue;
        }

        let entries: Vec<TimeuDirectoryEntry> = runtime.list_directory(&info.path)?;
        for entry in &entries {
            if entry.is_file {
                push_timeu_target(&mut targets, &mut seen_targets, entry.path.clone());
            }
            if entry.is_directory {
                if include_directories {
                    push_timeu_target(&mut targets, &mut seen_targets, entry.path.clone());
                }
                pending.push(entry.path.clone());
            }
        }
    }

    targets.sort_by(|left, right| compare_paths_naturally(left, right));
    Ok(targets)
}

fn push_timeu_target(
    targets: &mut Vec<String>,
    seen_targets: &mut HashSet<String>,
    path: String,
) {
    if seen_targets.insert(path.clone()) {
        targets.push(path);
    }
}

/// `core.ts:168-184`: read the current timestamps of every target, with
/// `Math.round` on the four millisecond fields and one shared `backedUpAt`.
pub fn current_timestamp_records(
    paths: &[String],
    runtime: &dyn TimeuRuntime,
) -> Result<Vec<TimeuTimestampRecord>, TimeuCoreError> {
    let backed_up_at = iso8601_from_epoch_ms(runtime.now_epoch_ms()?)
        .map_err(TimeuCoreError::from_clock)?;
    let mut records: Vec<TimeuTimestampRecord> = Vec::new();

    for path in paths {
        yield_timeu_checkpoint(runtime)?;
        let info: TimeuPathInfo = runtime.path_info(path)?;
        if !info.exists {
            continue;
        }
        records.push(TimeuTimestampRecord::new(
            &info.path,
            js_math_round(info.atime_ms),
            js_math_round(info.mtime_ms),
            js_math_round(info.ctime_ms),
            js_math_round(info.birthtime_ms),
            &backed_up_at,
        ));
    }

    Ok(records)
}

/// `buildBackupPlan` (`core.ts:186-188`).
pub fn build_backup_plan(records: &[TimeuTimestampRecord]) -> Vec<TimeuPlanItem> {
    records
        .iter()
        .map(|record| TimeuPlanItem {
            path: record.path.clone(),
            operation: TimeuPlanOperation::Backup,
            status: TimeuPlanStatus::Pending,
            current: Some(record.clone()),
            stored: None,
            reason: None,
        })
        .collect()
}

/// `buildRestorePlan` (`core.ts:190-197`): one item per stored record, skipped
/// with reason `path_missing` when the path no longer exists.
pub fn build_restore_plan(
    current_records: &[TimeuTimestampRecord],
    stored_records: &[TimeuTimestampRecord],
) -> Vec<TimeuPlanItem> {
    let mut current_by_path = BTreeMap::new();
    for record in current_records {
        current_by_path.insert(normalize_path_key(&record.path), record.clone());
    }

    stored_records
        .iter()
        .map(|stored| match current_by_path.get(&normalize_path_key(&stored.path)) {
            None => TimeuPlanItem {
                path: stored.path.clone(),
                operation: TimeuPlanOperation::Restore,
                status: TimeuPlanStatus::Skipped,
                current: None,
                stored: Some(stored.clone()),
                reason: Some("path_missing".to_string()),
            },
            Some(current) => TimeuPlanItem {
                path: stored.path.clone(),
                operation: TimeuPlanOperation::Restore,
                status: TimeuPlanStatus::Pending,
                current: Some(current.clone()),
                stored: Some(stored.clone()),
                reason: None,
            },
        })
        .collect()
}

/// `loadTimestampRecords` (`core.ts:199-206`). An empty path, an unreadable file
/// and a file whose text is whitespace all mean "no stored records"; a file that
/// is not valid JSON is the `JSON.parse` throw it was in TypeScript; a valid JSON
/// document that is not an array parses to no records.
pub fn load_timestamp_records(
    path: &str,
    runtime: &dyn TimeuRuntime,
) -> Result<Vec<TimeuTimestampRecord>, TimeuCoreError> {
    if path.is_empty() {
        return Ok(Vec::new());
    }
    let Some(text) = runtime.read_text(path) else {
        return Ok(Vec::new());
    };
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }

    let parsed: serde_json::Value = match serde_json::from_str(text.as_str()) {
        Ok(value) => value,
        Err(error) => return Err(TimeuCoreError::MalformedRecordJson(error.to_string())),
    };
    let items = match parsed {
        serde_json::Value::Array(items) => items,
        _ => return Ok(Vec::new()),
    };

    Ok(items
        .iter()
        .filter_map(TimeuTimestampRecord::from_json)
        .collect())
}

/// `dumpTimestampRecords` (`core.ts:208-210`): two-space pretty JSON plus the
/// trailing newline, which is what `JSON.stringify(records, null, 2) + "\n"` wrote.
pub fn dump_timestamp_records(records: &[TimeuTimestampRecord]) -> String {
    let document = serde_json::Value::Array(
        records.iter().map(TimeuTimestampRecord::to_json).collect(),
    );
    let rendered = serde_json::to_string_pretty(&document)
        .unwrap_or_else(|_| "[]".to_string());
    format!("{rendered}\n")
}

/// `mergeTimestampRecords` (`core.ts:212-216`): stored records first, current
/// records overwriting by normalized path key, every surviving record re-stamped
/// with `backedUpAt`, then sorted by path.
pub fn merge_timestamp_records(
    existing: &[TimeuTimestampRecord],
    current: &[TimeuTimestampRecord],
    epoch_ms: f64,
) -> Result<Vec<TimeuTimestampRecord>, TimeuCoreError> {
    let backed_up_at =
        iso8601_from_epoch_ms(epoch_ms).map_err(TimeuCoreError::from_clock)?;

    let mut merged: BTreeMap<String, TimeuTimestampRecord> = BTreeMap::new();
    for record in existing {
        merged.insert(normalize_path_key(&record.path), record.clone());
    }
    for record in current {
        merged.insert(
            normalize_path_key(&record.path),
            record.with_backed_up_at(&backed_up_at),
        );
    }

    let mut merged: Vec<TimeuTimestampRecord> = merged.into_values().collect();
    merged.sort_by(|left, right| compare_paths_naturally(&left.path, &right.path));
    Ok(merged)
}

/// `markSuccess` (`core.ts:218-220`).
pub fn mark_plan_success(plan: &[TimeuPlanItem]) -> Vec<TimeuPlanItem> {
    plan.iter()
        .map(|item| TimeuPlanItem {
            path: item.path.clone(),
            operation: item.operation,
            status: TimeuPlanStatus::Success,
            current: item.current.clone(),
            stored: item.stored.clone(),
            reason: item.reason.clone(),
        })
        .collect()
}

/// `data` (`core.ts:222-235`): the counters `Component.tsx` and the CLI result
/// panel read, plus one `"<path>: <reason>"` line per errored item.
pub fn build_timeu_data(
    plan: &[TimeuPlanItem],
    records: &[TimeuTimestampRecord],
    record_path: &str,
) -> TimeuData {
    let errors = plan
        .iter()
        .filter(|item| item.status == TimeuPlanStatus::Error)
        .map(|item| {
            format!(
                "{}: {}",
                item.path,
                item.reason.clone().unwrap_or_else(|| "error".to_string())
            )
        })
        .collect();

    let backup_count = plan
        .iter()
        .filter(|item| {
            item.operation == TimeuPlanOperation::Backup && item.status == TimeuPlanStatus::Success
        })
        .count();
    let restored_count = plan
        .iter()
        .filter(|item| {
            item.operation == TimeuPlanOperation::Restore && item.status == TimeuPlanStatus::Success
        })
        .count();
    let skipped_count = plan
        .iter()
        .filter(|item| item.status == TimeuPlanStatus::Skipped)
        .count();
    let error_count = plan
        .iter()
        .filter(|item| item.status == TimeuPlanStatus::Error)
        .count();

    TimeuData {
        plan: plan.to_vec(),
        records: records.to_vec(),
        record_path: record_path.to_string(),
        scanned_count: plan.len(),
        backup_count,
        restored_count,
        skipped_count,
        error_count,
        errors,
    }
}

/// `success` (`core.ts:237-239`): an errored plan is a failed operation even when
/// the message describes what was partially done.
pub fn success_timeu_result(message: impl Into<String>, data: TimeuData) -> TimeuRunResult {
    TimeuRunResult {
        success: data.error_count == 0,
        message: message.into(),
        data: Some(data),
        output_path: None,
    }
}

/// `failure` (`core.ts:241-243`): one synthetic errored backup item, so the UI's
/// plan table always has a row to show the reason in, and `success: false`
/// regardless of the counters.
pub fn failure_timeu_result(message: &str, record_path: &str) -> TimeuRunResult {
    let plan = vec![TimeuPlanItem {
        path: String::new(),
        operation: TimeuPlanOperation::Backup,
        status: TimeuPlanStatus::Error,
        current: None,
        stored: None,
        reason: Some(message.to_string()),
    }];
    TimeuRunResult {
        success: false,
        message: message.to_string(),
        data: Some(build_timeu_data(&plan, &[], record_path)),
        output_path: None,
    }
}

/// `defaultRecordPath` (`core.ts:245-248`): next to the first collected target,
/// or the bare file name when there is no target.
pub fn default_record_path(targets: &[String], runtime: &dyn TimeuRuntime) -> String {
    match targets.first() {
        Some(first) => {
            let directory = runtime.dirname(first);
            runtime.join(&[directory.as_str(), TIMEU_DEFAULT_RECORD_FILE_NAME])
        }
        None => TIMEU_DEFAULT_RECORD_FILE_NAME.to_string(),
    }
}

/// `def` from `index.ts:4-12`.
pub fn timeu_node_description() -> TimeuNodeDescription {
    TimeuNodeDescription {
        id: "timeu",
        name: "TimeU",
        version: "0.1.0",
        category: "file",
        description: "Back up and restore file timestamps from JSON records.",
        icon: "Clock3",
        keywords: &["timestamp", "backup", "restore", "mtime", "atime"],
    }
}

/// `runTimeu` (`core.ts:93-143`).
///
/// `Err` is reserved for the one throw the TypeScript left outside its `try`:
/// `normalizeTimeuInput` at `core.ts:98`. Everything else already arrived as a
/// `failure` result, so callers that must answer with JSON use
/// [`run_timeu_into_result`].
pub fn run_timeu(
    input: &TimeuInput,
    runtime: &dyn TimeuRuntime,
    events: &mut dyn TimeuEventSink,
) -> Result<TimeuRunResult, TimeuHostError> {
    let normalized = normalize_timeu_input(input)?;
    Ok(run_timeu_normalized(&normalized, runtime, events))
}

/// Same as [`run_timeu`], but folds a normalization rejection into the
/// `failure` shape the operation protocol needs.
pub fn run_timeu_into_result(
    input: &TimeuInput,
    runtime: &dyn TimeuRuntime,
    events: &mut dyn TimeuEventSink,
) -> TimeuRunResult {
    match run_timeu(input, runtime, events) {
        Ok(result) => result,
        Err(error) => failure_timeu_result(&error.to_string(), ""),
    }
}

/// The body of `runTimeu`'s `try`, with the `catch` applied at the end.
pub fn run_timeu_normalized(
    normalized: &NormalizedTimeuInput,
    runtime: &dyn TimeuRuntime,
    events: &mut dyn TimeuEventSink,
) -> TimeuRunResult {
    match run_timeu_body(normalized, runtime, events) {
        Ok(result) => result,
        Err(error) => failure_timeu_result(&error.to_string(), &normalized.record_path),
    }
}

fn run_timeu_body(
    normalized: &NormalizedTimeuInput,
    runtime: &dyn TimeuRuntime,
    events: &mut dyn TimeuEventSink,
) -> Result<TimeuRunResult, TimeuCoreError> {
    if normalized.paths.is_empty() {
        return Ok(failure_timeu_result(TIMEU_NO_PATHS_MESSAGE, &normalized.record_path));
    }

    events.on_event(TimeuRunEvent::progress(15.0, "Collecting timestamp targets."));
    let targets = collect_timeu_targets(
        &normalized.paths,
        normalized.recursive,
        normalized.include_directories,
        runtime,
    )?;
    let record_path = if normalized.record_path.is_empty() {
        default_record_path(&targets, runtime)
    } else {
        normalized.record_path.clone()
    };

    events.on_event(TimeuRunEvent::progress(
        45.0,
        format!("Planning {} timestamp item(s).", targets.len()),
    ));
    let stored_records = load_timestamp_records(&record_path, runtime)?;
    let current_records = current_timestamp_records(&targets, runtime)?;
    let plan = if normalized.action.is_restore() {
        build_restore_plan(&current_records, &stored_records)
    } else {
        build_backup_plan(&current_records)
    };

    if normalized.action.is_scan() || normalized.dry_run {
        return Ok(success_timeu_result(
            format!("TimeU planned {} item(s).", plan.len()),
            build_timeu_data(&plan, &stored_records, &record_path),
        ));
    }

    if normalized.action.is_backup() {
        events.on_event(TimeuRunEvent::progress(75.0, "Writing timestamp records."));
        let epoch_ms = runtime.now_epoch_ms()?;
        let merged = merge_timestamp_records(&stored_records, &current_records, epoch_ms)?;
        let record_directory = runtime.dirname(&record_path);
        runtime.ensure_directory(&record_directory)?;
        runtime.write_text(&record_path, &dump_timestamp_records(&merged))?;
        return Ok(success_timeu_result(
            format!("TimeU backed up {} timestamp record(s).", current_records.len()),
            build_timeu_data(&mark_plan_success(&plan), &merged, &record_path),
        ));
    }

    // `core.ts:125-139`. Reached by `restore` and, as in the TypeScript, by any
    // action value that is not `scan`, `backup` or `restore`.
    events.on_event(TimeuRunEvent::progress(75.0, "Restoring timestamps."));
    let mut restored: Vec<TimeuPlanItem> = Vec::with_capacity(plan.len());
    for item in plan {
        yield_timeu_checkpoint(runtime)?;
        let applied: Option<Result<(), TimeuHostError>> = match &item {
            // `core.ts:128`: only a pending item that still has a stored record is
            // applied; everything else travels through unchanged.
            TimeuPlanItem { status: TimeuPlanStatus::Pending, stored: Some(stored), .. } => {
                Some(runtime.set_times(&item.path, stored.atime_ms, stored.mtime_ms))
            }
            _ => None,
        };

        restored.push(match applied {
            None => item,
            Some(Ok(())) => TimeuPlanItem { status: TimeuPlanStatus::Success, ..item },
            Some(Err(error)) => TimeuPlanItem {
                status: TimeuPlanStatus::Error,
                reason: Some(error.message),
                ..item
            },
        });
    }

    let restored_count = restored
        .iter()
        .filter(|item| item.status == TimeuPlanStatus::Success)
        .count();
    Ok(success_timeu_result(
        format!("TimeU restored {restored_count} timestamp(s)."),
        build_timeu_data(&restored, &stored_records, &record_path),
    ))
}

/// One ADR-0066 yield between work items.
fn yield_timeu_checkpoint(runtime: &dyn TimeuRuntime) -> Result<(), TimeuCoreError> {
    match runtime.checkpoint()? {
        TimeuCheckpointOutcome::Cancelled { message } => Err(TimeuCoreError::Cancelled(message)),
        TimeuCheckpointOutcome::Continue | TimeuCheckpointOutcome::Resumed => Ok(()),
    }
}
