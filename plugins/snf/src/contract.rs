//! The frozen wire vocabulary of the SNF node.
//!
//! Every type here is a one-to-one mirror of an interface in
//! `packages/nodes/snf/src/core.ts`, and the names below are load-bearing: ADR-0063
//! principle 1 keeps the React card (`src/nodes/snf/Component.tsx`) and principle 3
//! keeps the Operation/History payloads, so `camelCase` field names, the status
//! vocabulary and the message strings are the product contract this plugin has to
//! reproduce byte-for-byte.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize, de::Deserializer};
use serde_json::Value;

use crate::javascript_text::coerce_to_javascript_string;

/// `core.ts:138`'s machine-readable skip reason, shown by the card's result rows.
pub const PLAN_REASON_NO_NUMBERED_FOLDERS: &str = "no_numbered_folders";

/// `core.ts:164`'s machine-readable conflict reason.
pub const PLAN_REASON_TARGET_NAME_EXISTS: &str = "target_name_exists";

/// `DEFAULT_PRIORITY_KEYWORDS` at `core.ts:70`, in ranking order.
pub const DEFAULT_PRIORITY_KEYWORDS: [&str; 5] = ["同人志", "商业", "单行", "CG", "画集"];

/// `SnfAction` at `core.ts:3`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SnfAction {
    Scan,
    #[default]
    Plan,
    Rename,
}

impl SnfAction {
    /// `core.ts:94` only ever compares against `"rename"`, and `core.ts:74`
    /// defaults an absent action to `"plan"`, so any other label behaves like a
    /// preview. Known labels are mapped, everything else becomes `Plan`.
    pub fn from_node_value(value: &str) -> Self {
        match value {
            "scan" => Self::Scan,
            "rename" => Self::Rename,
            _ => Self::Plan,
        }
    }
}

impl<'de> Deserialize<'de> for SnfAction {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        Ok(match coerce_to_javascript_string(&value).as_deref() {
            Some(text) => Self::from_node_value(text),
            None => Self::default(),
        })
    }
}

/// `SnfMode` at `core.ts:4`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SnfMode {
    #[default]
    Library,
    Artist,
}

impl SnfMode {
    /// `core.ts:123` only compares against `"artist"`: an unknown mode scans as a
    /// library root, so it maps to `Library` here too.
    pub fn from_node_value(value: &str) -> Self {
        match value {
            "artist" => Self::Artist,
            _ => Self::Library,
        }
    }
}

impl<'de> Deserialize<'de> for SnfMode {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        Ok(match coerce_to_javascript_string(&value).as_deref() {
            Some(text) => Self::from_node_value(text),
            None => Self::default(),
        })
    }
}

/// `SnfPlanStatus` at `core.ts:5`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SnfPlanStatus {
    Ready,
    Unchanged,
    Skipped,
    Renamed,
    Conflict,
    Error,
}

/// `SnfInput` at `core.ts:7-16`. Unknown fields are ignored, as they are in
/// TypeScript.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SnfInput {
    #[serde(default)]
    pub action: SnfAction,
    #[serde(default, deserialize_with = "deserialize_optional_text")]
    pub path: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_text_list")]
    pub paths: Option<Vec<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_text")]
    pub list_text: Option<String>,
    #[serde(default)]
    pub mode: SnfMode,
    #[serde(default)]
    pub keep_timestamp: Option<bool>,
    #[serde(default)]
    pub dry_run: Option<bool>,
    #[serde(default, deserialize_with = "deserialize_optional_text_list")]
    pub priority_keywords: Option<Vec<String>>,
}

/// `Required<SnfInput>` at `core.ts:72`: the shape after `normalizeSnfInput`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedSnfInput {
    pub action: SnfAction,
    pub path: String,
    pub paths: Vec<String>,
    pub list_text: String,
    pub mode: SnfMode,
    pub keep_timestamp: bool,
    pub dry_run: bool,
    pub priority_keywords: Vec<String>,
}

/// `SnfDirEntry` at `core.ts:18-21`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnfDirEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
}

/// `SnfPathInfo` at `core.ts:23-30`. Millisecond timestamps are integers here;
/// `platform.ts:20-22` feeds them to `new Date(atimeMs)`, which rounds the
/// sub-millisecond part anyway, so the host must round when it answers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnfPathInfo {
    pub path: String,
    pub exists: bool,
    pub is_directory: bool,
    pub atime_ms: u64,
    pub mtime_ms: u64,
}

/// `SnfPlanItem` at `core.ts:32-41`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnfPlanItem {
    pub artist_path: String,
    pub source_path: String,
    pub target_path: String,
    pub source_name: String,
    pub target_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sequence: Option<u64>,
    pub status: SnfPlanStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// `SnfData` at `core.ts:43-56`, including the derived counters of
/// `data()` at `core.ts:189-205`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnfData {
    pub action: SnfAction,
    pub mode: SnfMode,
    pub items: Vec<SnfPlanItem>,
    pub artist_count: u64,
    pub scanned_count: u64,
    pub ready_count: u64,
    pub renamed_count: u64,
    pub unchanged_count: u64,
    pub skipped_count: u64,
    pub conflict_count: u64,
    pub error_count: u64,
    pub errors: Vec<String>,
}

impl SnfData {
    /// `data()` at `core.ts:189-205`, verbatim: `scannedCount` is the item count
    /// (not the folder count), and only `error`/`conflict` items with a reason
    /// become `errors` rows of `"<sourcePath>: <reason>"`.
    #[must_use]
    pub fn summarize(input: &NormalizedSnfInput, artist_count: usize, items: Vec<SnfPlanItem>) -> Self {
        let count_of = |items: &[SnfPlanItem], status: SnfPlanStatus| -> u64 {
            u64::try_from(items.iter().filter(|item| item.status == status).count()).unwrap_or(u64::MAX)
        };
        let errors = items
            .iter()
            .filter(|item| {
                item.reason.is_some() && matches!(item.status, SnfPlanStatus::Error | SnfPlanStatus::Conflict)
            })
            .map(|item| format!("{}: {}", item.source_path, item.reason.as_deref().unwrap_or_default()))
            .collect();
        let scanned_count = u64::try_from(items.len()).unwrap_or(u64::MAX);
        let ready_count = count_of(items.as_slice(), SnfPlanStatus::Ready);
        let renamed_count = count_of(items.as_slice(), SnfPlanStatus::Renamed);
        let unchanged_count = count_of(items.as_slice(), SnfPlanStatus::Unchanged);
        let skipped_count = count_of(items.as_slice(), SnfPlanStatus::Skipped);
        let conflict_count = count_of(items.as_slice(), SnfPlanStatus::Conflict);
        let error_count = count_of(items.as_slice(), SnfPlanStatus::Error);
        Self {
            action: input.action,
            mode: input.mode,
            items,
            artist_count: u64::try_from(artist_count).unwrap_or(u64::MAX),
            scanned_count,
            ready_count,
            renamed_count,
            unchanged_count,
            skipped_count,
            conflict_count,
            error_count,
            errors,
        }
    }
}

/// `NodeRunResultDTO<SnfData>` at `packages/shared/src/index.ts:363-369`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnfRunResult {
    pub success: bool,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<SnfData>,
    /// SNF never sets `stats` or `outputPath`; the fields stay so a result written
    /// by this plugin cannot lose a field the operation protocol may add later.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stats: Option<BTreeMap<String, f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
}

/// `nodeRunEventSchema` at `packages/shared/src/index.ts:91-98`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeRunEvent {
    #[serde(rename = "type")]
    pub kind: NodeRunEventKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<u32>,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeRunEventKind {
    Progress,
    Log,
}

impl NodeRunEvent {
    /// The two progress events `core.ts:89` and `core.ts:96` emit. SNF emits no `log`
    /// event: the card turns the result message into a log line itself
    /// (`src/nodes/snf/Component.tsx:126`).
    #[must_use]
    pub fn progress(percent: u32, message: &str) -> Self {
        Self {
            kind: NodeRunEventKind::Progress,
            progress: Some(percent),
            message: message.to_string(),
            data: None,
        }
    }
}

/// Deserializes an optional scalar into the text `String(value ?? "")` would
/// produce, dropping `null` and structured values.
fn deserialize_optional_text<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<Value>::deserialize(deserializer)?;
    Ok(value.as_ref().and_then(coerce_to_javascript_string))
}

/// Same coercion applied element-wise; a non-scalar element becomes `None` and is
/// dropped rather than throwing, because `core.ts:76` would only `trim()` it.
fn deserialize_optional_text_list<'de, D>(deserializer: D) -> Result<Option<Vec<String>>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<Value>::deserialize(deserializer)?;
    Ok(value.and_then(|value| match value {
        Value::Array(items) => Some(items.iter().filter_map(coerce_to_javascript_string).collect()),
        other => coerce_to_javascript_string(&other).map(|text| vec![text]),
    }))
}

/// Used by the JSON entry points so a serializer failure cannot abort a run with
/// an empty document.
pub(crate) fn write_json_or_placeholder<T>(value: &T) -> String
where
    T: Serialize,
{
    serde_json::to_string(value).unwrap_or_else(|error| {
        format!(
            "{{\"success\":false,\"message\":\"SNF result could not be encoded: {error}\"}}"
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_field_names_are_the_node_contract() {
        let input: SnfInput = serde_json::from_str(
            r#"{"action":"rename","path":"D:/a","paths":["D:/b"],"listText":"D:/c,D:/c","mode":"artist","keepTimestamp":false,"dryRun":false,"priorityKeywords":["CG"]}"#,
        )
        .expect("input");
        assert_eq!(input.action, SnfAction::Rename);
        assert_eq!(input.path.as_deref(), Some("D:/a"));
        assert_eq!(input.paths.as_deref(), Some(&["D:/b".to_string()][..]));
        assert_eq!(input.list_text.as_deref(), Some("D:/c,D:/c"));
        assert_eq!(input.mode, SnfMode::Artist);
        assert_eq!(input.keep_timestamp, Some(false));
        assert_eq!(input.dry_run, Some(false));
        assert_eq!(input.priority_keywords.as_deref(), Some(&["CG".to_string()][..]));
    }

    #[test]
    fn unknown_labels_and_scalars_survive_like_the_typescript_does() {
        let input: SnfInput =
            serde_json::from_str(r#"{"action":"ship","mode":"gallery","path":42,"paths":[null,7,{},"D:/x"]}"#)
                .expect("input");
        assert_eq!(input.action, SnfAction::Plan);
        assert_eq!(input.mode, SnfMode::Library);
        assert_eq!(input.path.as_deref(), Some("42"));
        assert_eq!(input.paths.as_deref(), Some(&["7".to_string(), "D:/x".to_string()][..]));
    }

    #[test]
    fn result_and_event_documents_keep_camel_case_and_skip_absent_fields() {
        let item = SnfPlanItem {
            artist_path: "D:/A".into(),
            source_path: "D:/A/3. CG".into(),
            target_path: "D:/A/1. CG".into(),
            source_name: "3. CG".into(),
            target_name: "1. CG".into(),
            sequence: Some(1),
            status: SnfPlanStatus::Ready,
            reason: None,
        };
        let document = serde_json::to_string(&item).expect("encode");
        assert_eq!(
            document,
            r#"{"artistPath":"D:/A","sourcePath":"D:/A/3. CG","targetPath":"D:/A/1. CG","sourceName":"3. CG","targetName":"1. CG","sequence":1,"status":"ready"}"#
        );
        assert_eq!(
            serde_json::to_string(&NodeRunEvent::progress(20, "Scanning numbered folders.")).expect("encode"),
            r#"{"type":"progress","progress":20,"message":"Scanning numbered folders."}"#
        );
    }

    #[test]
    fn summarize_counts_the_way_data_does() {
        let input = NormalizedSnfInput {
            action: SnfAction::Plan,
            path: String::new(),
            paths: vec!["D:/A".into()],
            list_text: String::new(),
            mode: SnfMode::Artist,
            keep_timestamp: true,
            dry_run: true,
            priority_keywords: DEFAULT_PRIORITY_KEYWORDS.iter().map(|keyword| (*keyword).to_string()).collect(),
        };
        let items = vec![
            SnfPlanItem {
                artist_path: "D:/A".into(),
                source_path: "D:/A/x".into(),
                target_path: "D:/A/y".into(),
                source_name: "x".into(),
                target_name: "y".into(),
                sequence: Some(1),
                status: SnfPlanStatus::Conflict,
                reason: Some(PLAN_REASON_TARGET_NAME_EXISTS.into()),
            },
            SnfPlanItem {
                artist_path: "D:/A".into(),
                source_path: "D:/A/z".into(),
                target_path: "D:/A/z".into(),
                source_name: "z".into(),
                target_name: "z".into(),
                sequence: None,
                status: SnfPlanStatus::Unchanged,
                reason: None,
            },
        ];
        let data = SnfData::summarize(&input, 1, items);
        assert_eq!(data.scanned_count, 2);
        assert_eq!(data.conflict_count, 1);
        assert_eq!(data.unchanged_count, 1);
        assert_eq!(data.ready_count, 0);
        assert_eq!(data.errors, vec!["D:/A/x: target_name_exists".to_string()]);
    }
}
