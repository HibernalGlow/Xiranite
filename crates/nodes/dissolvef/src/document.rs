//! DissolveF's response document: plan rows, undo journal records and the result shape.
//!
//! Every field name here is the name `packages/nodes/dissolvef/src/core.ts` publishes
//! (`DissolvefResult`, `DissolvefData`, `DissolvefPlanItem`, `DissolveUndoRecord`) because the GUI's
//! `src/nodes/dissolvef` views and the operation history rows read the response document unchanged
//! (ADR-0063 principle 3). Declaration order and the omission of absent optional fields keep the JSON
//! shaped like `JSON.stringify` of the `core.ts` object literals.
//!
//! The input half of the contract is [`crate::contract`]; the row-discriminator enums below are output
//! vocabulary only, which is why they live here.

use std::collections::BTreeMap;

use serde::{Serialize, Serializer};

use crate::contract::DissolvefMode;
/// `DissolvefPlanItem.operation` (`core.ts:52`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DissolvefOperation {
    Move,
    DeleteDir,
}

impl DissolvefOperation {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Move => "move",
            Self::DeleteDir => "delete_dir",
        }
    }
}

/// `DissolvefPlanItem.itemKind` (`core.ts:55`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DissolvefItemKind {
    File,
    Directory,
}

impl DissolvefItemKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Directory => "directory",
        }
    }

    fn from_directory(is_directory: bool) -> Self {
        if is_directory { Self::Directory } else { Self::File }
    }
}

/// `DissolvefPlanItem.status` (`core.ts:56`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DissolvefPlanStatus {
    Pending,
    Skipped,
    Success,
    Error,
}

impl DissolvefPlanStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Skipped => "skipped",
            Self::Success => "success",
            Self::Error => "error",
        }
    }
}

/// `DissolveUndoRecord.mode` (`core.ts:72`): one mode, or `mixed` for a bundled run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DissolveUndoMode {
    Nested,
    Media,
    Archive,
    Direct,
    Mixed,
}

impl DissolveUndoMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Nested => "nested",
            Self::Media => "media",
            Self::Archive => "archive",
            Self::Direct => "direct",
            Self::Mixed => "mixed",
        }
    }

    /// `isUndoMode` (`core.ts:868-870`): anything else the journal holds becomes `mixed`.
    pub(crate) fn parse(value: &str) -> Self {
        match value {
            "nested" => Self::Nested,
            "media" => Self::Media,
            "archive" => Self::Archive,
            "direct" => Self::Direct,
            _ => Self::Mixed,
        }
    }
}

/// The journal records one mode when every applied row came from the same planner, and `mixed` otherwise
/// (`core.ts:540`). `DissolvefMode::Direct` maps to itself, which is why the two enums are separate but
/// convertible.
impl From<DissolvefMode> for DissolveUndoMode {
    fn from(mode: DissolvefMode) -> Self {
        match mode {
            DissolvefMode::Nested => Self::Nested,
            DissolvefMode::Media => Self::Media,
            DissolvefMode::Archive => Self::Archive,
            DissolvefMode::Direct => Self::Direct,
        }
    }
}

/// `DissolvefPathInfo` (`core.ts:36-41`). `path` is the host's resolved form of the requested path, which
/// `buildDissolvefPlan` (`core.ts:193`) then uses as the traversal root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DissolvefPathInfo {
    pub path: String,
    pub exists: bool,
    pub is_file: bool,
    pub is_directory: bool,
}

impl DissolvefPathInfo {
    /// `platform.ts:76`: a failed `lstat` is reported as "does not exist", never as an error.
    #[must_use]
    pub fn missing(path: &str) -> Self {
        Self { path: path.to_string(), exists: false, is_file: false, is_directory: false }
    }
}

/// `DissolvefDirEntry` (`core.ts:43-48`). `path` is rebuilt plugin-side from the listed directory and the
/// entry name, so a plan never depends on how one host spelled the separator.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DissolvefDirEntry {
    pub name: String,
    pub path: String,
    pub is_file: bool,
    pub is_directory: bool,
}

/// `DissolvefPlanItem` (`core.ts:50-61`). Declaration order and the omission of absent optional fields
/// keep the document shaped like `JSON.stringify` of the `core.ts` object literals.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DissolvefPlanItem {
    pub mode: DissolvefMode,
    pub operation: DissolvefOperation,
    pub source_path: String,
    pub target_path: String,
    pub item_kind: DissolvefItemKind,
    pub status: DissolvefPlanStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub similarity: Option<JsonNumber>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delete_target: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recursive_delete: Option<bool>,
}

impl DissolvefPlanItem {
    #[must_use]
    pub fn new(
        mode: DissolvefMode,
        operation: DissolvefOperation,
        source_path: &str,
        target_path: &str,
        is_directory: bool,
        status: DissolvefPlanStatus,
    ) -> Self {
        Self {
            mode,
            operation,
            source_path: source_path.to_string(),
            target_path: target_path.to_string(),
            item_kind: DissolvefItemKind::from_directory(is_directory),
            status,
            reason: None,
            similarity: None,
            delete_target: None,
            recursive_delete: None,
        }
    }

    /// `{ ...item, status: "success" | "error" }` (`core.ts:503,506`): the row keeps its shape and only
    /// the status changes, plus a reason on the error path.
    #[must_use]
    pub fn with_status(&self, status: DissolvefPlanStatus, reason: Option<String>) -> Self {
        let mut updated = self.clone();
        updated.status = status;
        if reason.is_some() {
            updated.reason = reason;
        }
        updated
    }
}

/// `skipped()` (`core.ts:709-720`): a directory-shaped `move` row whose only payload is a reason.
#[must_use]
pub fn skipped_plan_item(
    mode: DissolvefMode,
    path: &str,
    reason: &str,
    similarity: Option<f64>,
) -> DissolvefPlanItem {
    DissolvefPlanItem {
        reason: Some(reason.to_string()),
        similarity: similarity.map(JsonNumber::new),
        ..DissolvefPlanItem::new(
            mode,
            DissolvefOperation::Move,
            path,
            "",
            true,
            DissolvefPlanStatus::Skipped,
        )
    }
}

/// `DissolveUndoOperation` (`core.ts:63-67`). `target_path` is absent for a `delete_dir` row, which is the
/// key `JSON.stringify` omits in the journal file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DissolveUndoOperation {
    #[serde(rename = "type")]
    pub kind: DissolvefOperation,
    pub source_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_path: Option<String>,
}

/// `DissolveUndoRecord` (`core.ts:69-77`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DissolveUndoRecord {
    pub id: String,
    pub timestamp: String,
    pub mode: DissolveUndoMode,
    pub path: String,
    pub count: i64,
    pub operations: Vec<DissolveUndoOperation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub undone: Option<bool>,
}

/// `DissolvefData` (`core.ts:79-95`). `data()` (`core.ts:888-907`) always fills every field, so none of
/// these are optional on the wire.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DissolvefData {
    pub plan: Vec<DissolvefPlanItem>,
    pub history: Vec<DissolveUndoRecord>,
    pub archive_paths: Vec<String>,
    pub nested_count: usize,
    pub media_count: usize,
    pub archive_count: usize,
    pub direct_files: usize,
    pub direct_dirs: usize,
    pub skipped_count: usize,
    pub total_count: usize,
    pub success_count: usize,
    pub failed_count: usize,
    pub error_count: usize,
    pub operation_id: String,
    pub errors: Vec<String>,
}

impl Default for DissolvefData {
    /// `data()` (`core.ts:888-907`).
    fn default() -> Self {
        Self {
            plan: Vec::new(),
            history: Vec::new(),
            archive_paths: Vec::new(),
            nested_count: 0,
            media_count: 0,
            archive_count: 0,
            direct_files: 0,
            direct_dirs: 0,
            skipped_count: 0,
            total_count: 0,
            success_count: 0,
            failed_count: 0,
            error_count: 0,
            operation_id: String::new(),
            errors: Vec::new(),
        }
    }
}

/// `NodeRunResult<DissolvefData>` (`packages/shared/src/index.ts:100-106`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DissolvefResult {
    pub success: bool,
    pub message: String,
    pub data: DissolvefData,
    /// `stats`: carries only the ADR-0066 cancellation marker, because `nodeRunResultSchema` has no field
    /// for it and `DissolvefData` must not gain one.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub stats: BTreeMap<String, JsonNumber>,
    /// `outputPath`: DissolveF never produced one, so it stays absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
}

impl DissolvefResult {
    /// The document `executePlan` and `undo` return (`core.ts:515-525`, `core.ts:600-604`): `success` is
    /// `failedCount === 0`, while the message keeps the wording it had either way.
    #[must_use]
    pub fn reported(message: &str, data: DissolvefData, success: bool) -> Self {
        Self {
            success,
            message: message.to_string(),
            data,
            stats: BTreeMap::new(),
            output_path: None,
        }
    }

    /// `success(message, partial)` (`core.ts:909-911`) once `data()` has filled the defaults.
    #[must_use]
    pub fn completed(message: &str, data: DissolvefData) -> Self {
        Self::reported(message, data, true)
    }

    /// `failure(message)` (`core.ts:913-915`).
    #[must_use]
    pub fn failure(message: &str) -> Self {
        Self {
            success: false,
            message: message.to_string(),
            data: DissolvefData {
                errors: vec![message.to_string()],
                failed_count: 1,
                error_count: 1,
                ..DissolvefData::default()
            },
            stats: BTreeMap::new(),
            output_path: None,
        }
    }

    /// The ADR-0066 hard stop: the run ended at a checkpoint that answered `Cancelled`, so the work already
    /// done is reported but the operation is not a success. `stats.cancelled` is what lets the host write
    /// the `cancelled` phase instead of `error`.
    #[must_use]
    pub fn cancelled(message: &str, data: DissolvefData) -> Self {
        let mut result = Self::failure(message);
        result.data = data;
        result.stats.insert(CANCELLED_STAT_KEY.to_string(), JsonNumber::new(1.0));
        result
    }
}

/// The `stats` key a cancelled run sets (see [`DissolvefResult::cancelled`]).
pub const CANCELLED_STAT_KEY: &str = "cancelled";
/// A JSON number that keeps integral values integral, so the response document and the undo journal stay
/// comparable with `JSON.stringify` (which writes `1` and `2`, never `1.0` and `2.0`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct JsonNumber(f64);

impl JsonNumber {
    #[must_use]
    pub const fn new(value: f64) -> Self {
        Self(value)
    }

    #[must_use]
    pub const fn get(self) -> f64 {
        self.0
    }
}

impl From<f64> for JsonNumber {
    fn from(value: f64) -> Self {
        Self(value)
    }
}

impl Serialize for JsonNumber {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let integral = self.0.fract() == 0.0
            && (i64::MIN as f64..=i64::MAX as f64).contains(&self.0);
        if integral { serializer.serialize_i64(self.0 as i64) } else { serializer.serialize_f64(self.0) }
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn json_number_keeps_integral_values_integral() {
        assert_eq!(serde_json::to_string(&JsonNumber::new(1.0)).unwrap(), "1");
        assert_eq!(serde_json::to_string(&JsonNumber::new(0.25)).unwrap(), "0.25");
        assert_eq!(serde_json::to_string(&JsonNumber::new(0.0)).unwrap(), "0");
    }


    #[test]
    fn failure_and_cancelled_shapes_follow_core_ts() {
        let failure = DissolvefResult::failure("Path is required.");
        assert!(!failure.success);
        assert_eq!(failure.message, "Path is required.");
        assert_eq!(failure.data.errors, vec!["Path is required.".to_string()]);
        assert_eq!(failure.data.failed_count, 1);
        assert_eq!(failure.data.error_count, 1);
        assert!(!failure.stats.contains_key(CANCELLED_STAT_KEY));

        let cancelled = DissolvefResult::cancelled("Dissolve cancelled: 1 success, 0 skipped, 0 failed.", DissolvefData::default());
        assert!(!cancelled.success);
        assert_eq!(cancelled.stats.get(CANCELLED_STAT_KEY).expect("marker").get(), 1.0);
        let document = serde_json::to_string(&cancelled).expect("serializes");
        assert!(document.contains("\"stats\":{\"cancelled\":1}"), "{document}");
        assert!(!document.contains("outputPath"), "{document}");
    }


    #[test]
    fn serialized_names_are_the_core_ts_wire_names() {
        let item = DissolvefPlanItem {
            similarity: Some(JsonNumber::new(1.0)),
            recursive_delete: Some(true),
            ..DissolvefPlanItem::new(
                DissolvefMode::Nested,
                DissolvefOperation::DeleteDir,
                "/a/b",
                "",
                true,
                DissolvefPlanStatus::Pending,
            )
        };
        let document = serde_json::to_string(&item).expect("serializes");
        assert_eq!(
            document,
            r#"{"mode":"nested","operation":"delete_dir","sourcePath":"/a/b","targetPath":"","itemKind":"directory","status":"pending","similarity":1,"recursiveDelete":true}"#
        );
        let record = DissolveUndoRecord {
            id: "dissolve-1".to_string(),
            timestamp: "2026-07-21T16:04:54.445Z".to_string(),
            mode: DissolveUndoMode::Nested,
            path: "/a".to_string(),
            count: 2,
            operations: vec![
                DissolveUndoOperation {
                    kind: DissolvefOperation::Move,
                    source_path: "/a/b/c.txt".to_string(),
                    target_path: Some("/a/c.txt".to_string()),
                },
                DissolveUndoOperation {
                    kind: DissolvefOperation::DeleteDir,
                    source_path: "/a/b".to_string(),
                    target_path: None,
                },
            ],
            undone: None,
        };
        assert_eq!(
            serde_json::to_string(&record).expect("serializes"),
            r#"{"id":"dissolve-1","timestamp":"2026-07-21T16:04:54.445Z","mode":"nested","path":"/a","count":2,"operations":[{"type":"move","sourcePath":"/a/b/c.txt","targetPath":"/a/c.txt"},{"type":"delete_dir","sourcePath":"/a/b"}]}"#
        );
    }


    #[test]
    fn default_data_is_the_zeroed_shape_core_ts_emits() {
        assert_eq!(
            serde_json::to_string(&DissolvefData::default()).expect("serializes"),
            r#"{"plan":[],"history":[],"archivePaths":[],"nestedCount":0,"mediaCount":0,"archiveCount":0,"directFiles":0,"directDirs":0,"skippedCount":0,"totalCount":0,"successCount":0,"failedCount":0,"errorCount":0,"operationId":"","errors":[]}"#
        );
    }

}
