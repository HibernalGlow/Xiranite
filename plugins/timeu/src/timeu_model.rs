//! Domain types whose JSON shape is the preserved protocol.
//!
//! Field names and key order mirror the TypeScript literals in
//! `packages/nodes/timeu/src/core.ts`, because `src/nodes/timeu/Component.tsx`
//! reads `result.data.plan`, `result.data.records` and the counters directly
//! (ADR-0063 principles 1-3). Manual `Serialize` implementations exist for the
//! record file and the plan item so key order and the omission of absent optional
//! fields stay identical to `JSON.stringify`, which is what makes a record file
//! written by this plugin diffable against one written by the old core.

use serde::Serializer;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};

/// `TimeuAction` (`core.ts:3`).
///
/// `Other` is not a validation bucket: `core.ts:82` defaults with `?? "scan"` and
/// then only compares against `"restore"`, `"scan"` and `"backup"`, so an
/// unrecognised action falls through to the restore branch while still planning a
/// backup. `core.ts:109-127` is reproduced by keeping the value, not by rejecting
/// it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TimeuAction {
    Scan,
    Backup,
    Restore,
    Other(String),
}

impl TimeuAction {
    pub const DEFAULT: TimeuAction = TimeuAction::Scan;

    pub fn from_text(text: &str) -> Self {
        match text {
            "scan" => Self::Scan,
            "backup" => Self::Backup,
            "restore" => Self::Restore,
            other => Self::Other(other.to_string()),
        }
    }

    pub fn as_text(&self) -> &str {
        match self {
            Self::Scan => "scan",
            Self::Backup => "backup",
            Self::Restore => "restore",
            Self::Other(text) => text,
        }
    }

    pub fn is_scan(&self) -> bool {
        matches!(self, Self::Scan)
    }

    pub fn is_backup(&self) -> bool {
        matches!(self, Self::Backup)
    }

    pub fn is_restore(&self) -> bool {
        matches!(self, Self::Restore)
    }
}

impl Serialize for TimeuAction {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_text())
    }
}

/// `TimeuPlanItem.operation` (`core.ts:46`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TimeuPlanOperation {
    Backup,
    Restore,
}

/// `TimeuPlanStatus` (`core.ts:4`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TimeuPlanStatus {
    Pending,
    Success,
    Skipped,
    Error,
}

/// `TimeuPathInfo` (`core.ts:17-26`): one host `stat` reading.
#[derive(Debug, Clone, PartialEq)]
pub struct TimeuPathInfo {
    pub path: String,
    pub exists: bool,
    pub is_file: bool,
    pub is_directory: bool,
    pub atime_ms: f64,
    pub mtime_ms: f64,
    pub ctime_ms: f64,
    pub birthtime_ms: f64,
}

impl TimeuPathInfo {
    /// The `catch` branch of `platform.ts:37`: a failed or missing `stat` keeps
    /// the caller's path text, reports absence and zeroes every timestamp.
    pub fn missing(path: &str) -> Self {
        Self {
            path: path.to_string(),
            exists: false,
            is_file: false,
            is_directory: false,
            atime_ms: 0.0,
            mtime_ms: 0.0,
            ctime_ms: 0.0,
            birthtime_ms: 0.0,
        }
    }
}

/// `TimeuDirEntry` (`core.ts:28-33`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeuDirectoryEntry {
    pub name: String,
    pub path: String,
    pub is_file: bool,
    pub is_directory: bool,
}

/// `TimeuTimestampRecord` (`core.ts:35-42`).
///
/// Millisecond fields are `f64` because a JS `number` is `f64`: `core.ts:250-253`
/// validates only `path`, `atimeMs` and `mtimeMs`, and `core.ts:133` passes the
/// stored values straight into `utimes`. Values the old core would have written as
/// `12.5` therefore have to survive the round trip.
#[derive(Debug, Clone, PartialEq)]
pub struct TimeuTimestampRecord {
    pub path: String,
    pub atime_ms: f64,
    pub mtime_ms: f64,
    pub ctime_ms: Option<f64>,
    pub birthtime_ms: Option<f64>,
    pub backed_up_at: Option<String>,
    /// Properties the record file carries but this struct does not model. The old
    /// core spread them through `mergeTimestampRecords` (`core.ts:214`) and wrote
    /// them back, so dropping one would delete user data on the next backup.
    pub unmapped_fields: Map<String, Value>,
}

/// The six keys `core.ts:35-42` produces, in the order `JSON.stringify` emits them.
pub const TIMEU_TIMESTAMP_RECORD_KEYS: [&str; 6] = [
    "path",
    "atimeMs",
    "mtimeMs",
    "ctimeMs",
    "birthtimeMs",
    "backedUpAt",
];

impl TimeuTimestampRecord {
    pub fn new(
        path: &str,
        atime_ms: f64,
        mtime_ms: f64,
        ctime_ms: f64,
        birthtime_ms: f64,
        backed_up_at: &str,
    ) -> Self {
        Self {
            path: path.to_string(),
            atime_ms,
            mtime_ms,
            ctime_ms: Some(ctime_ms),
            birthtime_ms: Some(birthtime_ms),
            backed_up_at: Some(backed_up_at.to_string()),
            unmapped_fields: Map::new(),
        }
    }

    /// `{ ...record, backedUpAt }` (`core.ts:214`): the stamp is replaced, every
    /// other property, including unmapped ones, is carried over.
    pub fn with_backed_up_at(&self, backed_up_at: &str) -> Self {
        let mut stamped = self.clone();
        stamped.backed_up_at = Some(backed_up_at.to_string());
        stamped
    }

    /// `isTimestampRecord` (`core.ts:250-253`) plus field capture. A record that
    /// fails the predicate is filtered out by the caller rather than errored, so
    /// this returns `None` instead of `Result`.
    pub fn from_json(value: &Value) -> Option<Self> {
        let fields = value.as_object()?;
        let path = fields.get("path")?.as_str()?.to_string();
        let atime_ms = number_field(fields, "atimeMs")?;
        let mtime_ms = number_field(fields, "mtimeMs")?;

        let mut unmapped_fields = Map::new();
        for (key, raw) in fields {
            if !TIMEU_TIMESTAMP_RECORD_KEYS.contains(&key.as_str()) {
                unmapped_fields.insert(key.clone(), raw.clone());
            } else if is_malformed_canonical_field(key, raw) {
                // Present with a type the struct cannot hold: keep the original
                // value so a rewrite does not silently lose it.
                unmapped_fields.insert(key.clone(), raw.clone());
            }
        }

        Some(Self {
            path,
            atime_ms,
            mtime_ms,
            ctime_ms: number_field(fields, "ctimeMs"),
            birthtime_ms: number_field(fields, "birthtimeMs"),
            backed_up_at: fields.get("backedUpAt").and_then(Value::as_str).map(str::to_string),
            unmapped_fields,
        })
    }

    pub fn to_json(&self) -> Value {
        let mut object = Map::new();
        object.insert("path".to_string(), Value::String(self.path.clone()));
        object.insert("atimeMs".to_string(), js_number_to_json_value(self.atime_ms));
        object.insert("mtimeMs".to_string(), js_number_to_json_value(self.mtime_ms));
        if let Some(ctime_ms) = self.ctime_ms {
            object.insert("ctimeMs".to_string(), js_number_to_json_value(ctime_ms));
        }
        if let Some(birthtime_ms) = self.birthtime_ms {
            object.insert("birthtimeMs".to_string(), js_number_to_json_value(birthtime_ms));
        }
        if let Some(backed_up_at) = &self.backed_up_at {
            object.insert(
                "backedUpAt".to_string(),
                Value::String(backed_up_at.clone()),
            );
        }
        for (key, raw) in &self.unmapped_fields {
            // A canonical key that had to be preserved verbatim wins over the
            // struct's own value, which is absent precisely in that case.
            object.insert(key.clone(), raw.clone());
        }
        Value::Object(object)
    }
}

impl Serialize for TimeuTimestampRecord {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.to_json().serialize(serializer)
    }
}

fn number_field(fields: &Map<String, Value>, key: &str) -> Option<f64> {
    fields.get(key).and_then(Value::as_f64).or_else(|| {
        fields
            .get(key)
            .and_then(Value::as_i64)
            .map(|value| value as f64)
    })
}

/// Whether a canonical key exists but with a type `TimeuTimestampRecord` cannot
/// represent, in which case the raw value is preserved instead.
fn is_malformed_canonical_field(key: &str, raw: &Value) -> bool {
    match key {
        "path" => !raw.is_string(),
        "backedUpAt" => !raw.is_string(),
        _ => !raw.is_number(),
    }
}

/// `JSON.stringify` of a JS number: integral values print without a decimal
/// point, and `NaN`/`Infinity` print as `null`.
pub fn js_number_to_json_value(value: f64) -> Value {
    if !value.is_finite() {
        return Value::Null;
    }
    if value.fract() == 0.0
        && value >= -9_007_199_254_740_991.0
        && value <= 9_007_199_254_740_991.0
    {
        return Value::Number(Number::from(value as i64));
    }
    Number::from_f64(value).map(Value::Number).unwrap_or(Value::Null)
}

/// `TimeuPlanItem` (`core.ts:44-51`).
#[derive(Debug, Clone, PartialEq)]
pub struct TimeuPlanItem {
    pub path: String,
    pub operation: TimeuPlanOperation,
    pub status: TimeuPlanStatus,
    pub current: Option<TimeuTimestampRecord>,
    pub stored: Option<TimeuTimestampRecord>,
    pub reason: Option<String>,
}

impl TimeuPlanItem {
    pub fn to_json(&self) -> Value {
        let mut object = Map::new();
        object.insert("path".to_string(), Value::String(self.path.clone()));
        object.insert(
            "operation".to_string(),
            Value::String(
                match self.operation {
                    TimeuPlanOperation::Backup => "backup",
                    TimeuPlanOperation::Restore => "restore",
                }
                .to_string(),
            ),
        );
        object.insert(
            "status".to_string(),
            Value::String(
                match self.status {
                    TimeuPlanStatus::Pending => "pending",
                    TimeuPlanStatus::Success => "success",
                    TimeuPlanStatus::Skipped => "skipped",
                    TimeuPlanStatus::Error => "error",
                }
                .to_string(),
            ),
        );
        if let Some(current) = &self.current {
            object.insert("current".to_string(), current.to_json());
        }
        if let Some(stored) = &self.stored {
            object.insert("stored".to_string(), stored.to_json());
        }
        if let Some(reason) = &self.reason {
            object.insert("reason".to_string(), Value::String(reason.clone()));
        }
        Value::Object(object)
    }
}

impl Serialize for TimeuPlanItem {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.to_json().serialize(serializer)
    }
}

/// `TimeuData` (`core.ts:53-63`), the payload `Component.tsx` renders.
#[derive(Debug, Clone, PartialEq)]
pub struct TimeuData {
    pub plan: Vec<TimeuPlanItem>,
    pub records: Vec<TimeuTimestampRecord>,
    pub record_path: String,
    pub scanned_count: usize,
    pub backup_count: usize,
    pub restored_count: usize,
    pub skipped_count: usize,
    pub error_count: usize,
    pub errors: Vec<String>,
}

impl TimeuData {
    pub fn to_json(&self) -> Value {
        let mut object = Map::new();
        object.insert(
            "plan".to_string(),
            Value::Array(self.plan.iter().map(TimeuPlanItem::to_json).collect()),
        );
        object.insert(
            "records".to_string(),
            Value::Array(self.records.iter().map(TimeuTimestampRecord::to_json).collect()),
        );
        object.insert(
            "recordPath".to_string(),
            Value::String(self.record_path.clone()),
        );
        object.insert("scannedCount".to_string(), Value::from(self.scanned_count as i64));
        object.insert("backupCount".to_string(), Value::from(self.backup_count as i64));
        object.insert("restoredCount".to_string(), Value::from(self.restored_count as i64));
        object.insert("skippedCount".to_string(), Value::from(self.skipped_count as i64));
        object.insert("errorCount".to_string(), Value::from(self.error_count as i64));
        object.insert(
            "errors".to_string(),
            Value::Array(self.errors.iter().cloned().map(Value::String).collect()),
        );
        Value::Object(object)
    }
}

impl Serialize for TimeuData {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.to_json().serialize(serializer)
    }
}

/// `NodeRunResultDTO` (`packages/shared/src/index.ts:363-369`) for TimeU's data.
#[derive(Debug, Clone, PartialEq)]
pub struct TimeuRunResult {
    pub success: bool,
    pub message: String,
    pub data: Option<TimeuData>,
    pub output_path: Option<String>,
}

impl TimeuRunResult {
    pub fn to_json(&self) -> Value {
        let mut object = Map::new();
        object.insert("success".to_string(), Value::Bool(self.success));
        object.insert("message".to_string(), Value::String(self.message.clone()));
        if let Some(data) = &self.data {
            object.insert("data".to_string(), data.to_json());
        }
        if let Some(output_path) = &self.output_path {
            object.insert("outputPath".to_string(), Value::String(output_path.clone()));
        }
        Value::Object(object)
    }

    /// The exact document the operation manager stores as `operation.result`.
    pub fn to_json_string(&self) -> String {
        serde_json::to_string(&self.to_json()).unwrap_or_else(|error| {
            format!(
                "{{\"success\":false,\"message\":\"TimeU result could not be serialized: {error}\"}}"
            )
        })
    }
}

/// `nodeRunEventSchema.type` (`packages/shared/src/index.ts:91-98`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimeuRunEventKind {
    Progress,
    Log,
}

impl TimeuRunEventKind {
    pub fn as_text(self) -> &'static str {
        match self {
            Self::Progress => "progress",
            Self::Log => "log",
        }
    }
}

/// One `NodeRunEventDTO`. `Component.tsx:119-124` switches on `type` and reads
/// `progress`/`message`, so those keys keep their exact names.
#[derive(Debug, Clone, PartialEq)]
pub struct TimeuRunEvent {
    pub kind: TimeuRunEventKind,
    pub progress: Option<f64>,
    pub message: String,
    pub data: Option<Value>,
}

impl TimeuRunEvent {
    pub fn progress(percent: f64, message: impl Into<String>) -> Self {
        Self {
            kind: TimeuRunEventKind::Progress,
            progress: Some(percent),
            message: message.into(),
            data: None,
        }
    }

    pub fn log(message: impl Into<String>) -> Self {
        Self {
            kind: TimeuRunEventKind::Log,
            progress: None,
            message: message.into(),
            data: None,
        }
    }

    pub fn to_json(&self) -> Value {
        let mut object = Map::new();
        object.insert(
            "type".to_string(),
            Value::String(self.kind.as_text().to_string()),
        );
        if let Some(progress) = self.progress {
            object.insert("progress".to_string(), js_number_to_json_value(progress));
        }
        object.insert("message".to_string(), Value::String(self.message.clone()));
        if let Some(data) = &self.data {
            object.insert("data".to_string(), data.clone());
        }
        Value::Object(object)
    }
}

impl Serialize for TimeuRunEvent {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.to_json().serialize(serializer)
    }
}

/// `def` from `index.ts:4-12`, the metadata the code-generated node registry
/// carries and the React card title/icon come from.
#[derive(Debug, Clone, PartialEq)]
pub struct TimeuNodeDescription {
    pub id: &'static str,
    pub name: &'static str,
    pub version: &'static str,
    pub category: &'static str,
    pub description: &'static str,
    pub icon: &'static str,
    pub keywords: &'static [&'static str],
}

impl TimeuNodeDescription {
    /// Key order follows the `def` literal in `index.ts:4-12`.
    pub fn to_json(&self) -> Value {
        let mut object = Map::new();
        object.insert("id".to_string(), Value::String(self.id.to_string()));
        object.insert("name".to_string(), Value::String(self.name.to_string()));
        object.insert("version".to_string(), Value::String(self.version.to_string()));
        object.insert("category".to_string(), Value::String(self.category.to_string()));
        object.insert(
            "description".to_string(),
            Value::String(self.description.to_string()),
        );
        object.insert("icon".to_string(), Value::String(self.icon.to_string()));
        object.insert(
            "keywords".to_string(),
            Value::Array(self.keywords.iter().map(|word| Value::String((*word).to_string())).collect()),
        );
        Value::Object(object)
    }
}

/// The registry document stays a JSON object rather than a Rust type tree so the
/// host can forward it without a second schema definition.
impl Serialize for TimeuNodeDescription {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.to_json().serialize(serializer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn action_text_matches_the_typescript_union() {
        assert_eq!(TimeuAction::from_text("restore"), TimeuAction::Restore);
        assert_eq!(TimeuAction::from_text("wipe"), TimeuAction::Other("wipe".into()));
        assert_eq!(TimeuAction::DEFAULT, TimeuAction::Scan);
        assert!(!TimeuAction::Other("scan ".into()).is_scan());
    }

    #[test]
    fn record_json_keeps_key_order_and_optional_omission() {
        let record = TimeuTimestampRecord::new("/root/a.txt", 1000.0, 2000.0, 2001.0, 2002.0, "2026-01-01T00:00:00.000Z");
        let rendered = serde_json::to_string(&record.to_json()).unwrap();
        assert_eq!(
            rendered,
            r#"{"path":"/root/a.txt","atimeMs":1000,"mtimeMs":2000,"ctimeMs":2001,"birthtimeMs":2002,"backedUpAt":"2026-01-01T00:00:00.000Z"}"#
        );

        let minimal = TimeuTimestampRecord {
            path: "/root/a.txt".into(),
            atime_ms: 1.0,
            mtime_ms: 2.0,
            ctime_ms: None,
            birthtime_ms: None,
            backed_up_at: None,
            unmapped_fields: Map::new(),
        };
        assert_eq!(
            serde_json::to_string(&minimal.to_json()).unwrap(),
            r#"{"path":"/root/a.txt","atimeMs":1,"mtimeMs":2}"#
        );
    }

    #[test]
    fn record_round_trip_preserves_numbers_and_unknown_properties() {
        let stored = json!({
            "path": "/root/a.txt",
            "atimeMs": 11.5,
            "mtimeMs": 22,
            "note": "kept by the old spread",
        });
        let record = TimeuTimestampRecord::from_json(&stored).expect("valid record");
        assert_eq!(record.atime_ms, 11.5);
        assert_eq!(record.ctime_ms, None);
        let rendered = serde_json::to_string(&record.to_json()).unwrap();
        assert!(rendered.contains("\"atimeMs\":11.5"), "{rendered}");
        assert!(rendered.contains("\"note\":\"kept by the old spread\""), "{rendered}");
    }

    #[test]
    fn records_without_the_three_required_fields_are_rejected_like_the_predicate() {
        // core.ts:250-253: path must be a string, atimeMs/mtimeMs must be numbers.
        assert!(TimeuTimestampRecord::from_json(&json!({ "path": 1, "atimeMs": 1, "mtimeMs": 2 })).is_none());
        assert!(TimeuTimestampRecord::from_json(&json!({ "path": "a", "atimeMs": "1", "mtimeMs": 2 })).is_none());
        assert!(TimeuTimestampRecord::from_json(&json!({ "path": "a", "atimeMs": 1, "mtimeMs": 2 })).is_some());
        assert!(TimeuTimestampRecord::from_json(&json!("not an object")).is_none());
    }

    #[test]
    fn non_finite_millis_become_null_like_json_stringify() {
        assert_eq!(js_number_to_json_value(f64::NAN), Value::Null);
        assert_eq!(js_number_to_json_value(f64::INFINITY), Value::Null);
        assert_eq!(js_number_to_json_value(-0.0), Value::from(0_i64));
    }

    #[test]
    fn result_and_event_json_match_the_dto_field_names() {
        let result = TimeuRunResult {
            success: true,
            message: "TimeU planned 0 item(s).".into(),
            data: Some(TimeuData {
                plan: Vec::new(),
                records: Vec::new(),
                record_path: "timeu-timestamps.json".into(),
                scanned_count: 0,
                backup_count: 0,
                restored_count: 0,
                skipped_count: 0,
                error_count: 0,
                errors: Vec::new(),
            }),
            output_path: None,
        };
        let rendered = serde_json::to_string(&result.to_json()).unwrap();
        assert!(rendered.starts_with(r#"{"success":true,"message":"#), "{rendered}");
        assert!(rendered.contains(r#""scannedCount":0"#), "{rendered}");
        assert!(rendered.contains(r#""recordPath":"timeu-timestamps.json""#), "{rendered}");

        let event = TimeuRunEvent::progress(15.0, "Collecting timestamp targets.");
        assert_eq!(
            serde_json::to_string(&event.to_json()).unwrap(),
            r#"{"type":"progress","progress":15,"message":"Collecting timestamp targets."}"#
        );
    }

    #[test]
    fn path_info_missing_matches_the_platform_catch_branch() {
        let info = TimeuPathInfo::missing("D:/nope");
        assert!(!info.exists);
        assert_eq!(info.path, "D:/nope");
        assert_eq!(info.mtime_ms, 0.0);
    }
}
