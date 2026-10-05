//! NameU data contract, mirroring the exported types of
//! `packages/nodes/nameu/src/core.ts` field-for-field.

use serde::{Deserialize, Serialize};

use crate::text::{clean, parse_list};

/// `DEFAULT_ARCHIVE_EXTENSIONS` (core.ts:76).
pub const DEFAULT_ARCHIVE_EXTENSIONS: [&str; 5] = [".zip", ".rar", ".7z", ".cbz", ".cbr"];
/// `DEFAULT_EXCLUDE_KEYWORDS` (core.ts:77).
pub const DEFAULT_EXCLUDE_KEYWORDS: [&str; 3] = ["[00待分类]", "[00去图]", "[01来]"];
/// `DEFAULT_FORBIDDEN_ARTIST_KEYWORDS` (core.ts:78).
pub const DEFAULT_FORBIDDEN_ARTIST_KEYWORDS: [&str; 3] = ["[bili]", "[weibo]", "[02来]"];

/// `NameuAction` (core.ts:3). `Scan` shares the plan code path in the
/// TypeScript; only the reported `action` differs.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NameuAction {
    Scan,
    #[default]
    Plan,
    Rename,
}

/// `NameuMode` (core.ts:4).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NameuMode {
    #[default]
    Multi,
    Single,
}

/// `NameuPlanStatus` (core.ts:5).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NameuPlanStatus {
    Ready,
    Unchanged,
    Skipped,
    Renamed,
    Conflict,
    Error,
}

/// `NameuPlanItem["kind"]` (core.ts:45).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NameuItemKind {
    Archive,
    Folder,
}

/// `NameuInput` (core.ts:7-21). Absent fields keep the TypeScript defaults.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NameuInput {
    pub action: Option<NameuAction>,
    pub path: Option<String>,
    pub paths: Option<Vec<String>>,
    pub list_text: Option<String>,
    pub mode: Option<NameuMode>,
    pub recursive: Option<bool>,
    pub add_artist_name: Option<bool>,
    pub normalize_folders: Option<bool>,
    pub keep_timestamp: Option<bool>,
    pub dry_run: Option<bool>,
    pub exclude_keywords: Option<Vec<String>>,
    pub forbidden_artist_keywords: Option<Vec<String>>,
    pub archive_extensions: Option<Vec<String>>,
}

/// `Required<NameuInput>` produced by `normalizeNameuInput` (core.ts:80-96).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedNameuInput {
    pub action: NameuAction,
    pub path: String,
    pub paths: Vec<String>,
    pub list_text: String,
    pub mode: NameuMode,
    pub recursive: bool,
    pub add_artist_name: bool,
    pub normalize_folders: bool,
    pub keep_timestamp: bool,
    pub dry_run: bool,
    pub exclude_keywords: Vec<String>,
    pub forbidden_artist_keywords: Vec<String>,
    pub archive_extensions: Vec<String>,
}

/// The `Pick<Required<NameuInput>, "addArtistName" | "excludeKeywords" |
/// "forbiddenArtistKeywords">` argument of `normalizeArchiveName`
/// (core.ts:225).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NameuNameRules {
    pub add_artist_name: bool,
    pub exclude_keywords: Vec<String>,
    pub forbidden_artist_keywords: Vec<String>,
}

impl From<&NormalizedNameuInput> for NameuNameRules {
    fn from(value: &NormalizedNameuInput) -> Self {
        Self {
            add_artist_name: value.add_artist_name,
            exclude_keywords: value.exclude_keywords.clone(),
            forbidden_artist_keywords: value.forbidden_artist_keywords.clone(),
        }
    }
}

/// `NameuDirEntry` (core.ts:23-28).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NameuDirEntry {
    pub name: String,
    pub path: String,
    pub is_file: bool,
    pub is_directory: bool,
}

/// `NameuPathInfo` (core.ts:30-37). Millisecond timestamps stay `f64` because
/// the host reports sub-millisecond `atimeMs`/`mtimeMs` and feeds them straight
/// back into `set_times`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NameuPathInfo {
    pub path: String,
    pub exists: bool,
    pub is_file: bool,
    pub is_directory: bool,
    pub atime_ms: f64,
    pub mtime_ms: f64,
}

impl NameuPathInfo {
    /// The shape `platform.ts:14-16` produced when `stat` failed. It is not test-only: since
    /// ADR-0071 the plugin's own `std::fs` path builds it too, so the absent-path contract has one
    /// producer instead of two.
    pub(crate) fn missing(path: &str) -> Self {
        Self {
            path: path.to_string(),
            exists: false,
            is_file: false,
            is_directory: false,
            atime_ms: 0.0,
            mtime_ms: 0.0,
        }
    }
}

/// `NameuPlanItem` (core.ts:39-48).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NameuPlanItem {
    pub source_path: String,
    pub target_path: String,
    pub source_name: String,
    pub target_name: String,
    pub artist_name: String,
    pub kind: NameuItemKind,
    pub status: NameuPlanStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// `NodeRunEvent` (`packages/shared/src/index.ts:91-98`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NameuRunEvent {
    #[serde(rename = "type")]
    pub kind: NameuRunEventKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<f64>,
    pub message: String,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NameuRunEventKind {
    #[default]
    Progress,
    Log,
}

impl NameuRunEvent {
    pub(crate) fn progress(value: f64, message: &str) -> Self {
        Self {
            kind: NameuRunEventKind::Progress,
            progress: Some(value),
            message: message.to_string(),
        }
    }
}

/// Payload of `xiranite.checkpoint()`; the yield is also the reporting point
/// required by ADR-0066, so it carries how far the batch has advanced.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NameuCheckpointRequest {
    pub phase: String,
    pub processed_item_count: u64,
}

/// Status returned by `xiranite.checkpoint()`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NameuCheckpointStatus {
    #[default]
    Continue,
    Cancelled,
}

/// The `xiranite.checkpoint()` reply envelope.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NameuCheckpointReply {
    pub status: NameuCheckpointStatus,
}

/// `NameuData` (core.ts:50-62), with `data()` counts (core.ts:305-320).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NameuData {
    pub action: NameuAction,
    pub mode: NameuMode,
    pub items: Vec<NameuPlanItem>,
    pub scanned_count: usize,
    pub ready_count: usize,
    pub renamed_count: usize,
    pub unchanged_count: usize,
    pub skipped_count: usize,
    pub conflict_count: usize,
    pub error_count: usize,
    pub errors: Vec<String>,
}

impl NameuData {
    pub(crate) fn summarize(input: &NormalizedNameuInput, items: Vec<NameuPlanItem>) -> Self {
        let errors: Vec<String> = items
            .iter()
            // `data()` reports `sourcePath: reason` for rows that carry a reason
            // and are either errors or conflicts (core.ts:306).
            .filter(|item| item.reason.is_some() && matches!(item.status, NameuPlanStatus::Error | NameuPlanStatus::Conflict))
            .map(|item| format!("{}: {}", item.source_path, item.reason.clone().unwrap_or_default()))
            .collect();
        // Counts are read before `items` is moved into the returned summary.
        let scanned_count = items.len();
        let ready_count = count_status(&items, NameuPlanStatus::Ready);
        let renamed_count = count_status(&items, NameuPlanStatus::Renamed);
        let unchanged_count = count_status(&items, NameuPlanStatus::Unchanged);
        let skipped_count = count_status(&items, NameuPlanStatus::Skipped);
        let conflict_count = count_status(&items, NameuPlanStatus::Conflict);
        let error_count = count_status(&items, NameuPlanStatus::Error);
        Self {
            action: input.action,
            mode: input.mode,
            scanned_count,
            ready_count,
            renamed_count,
            unchanged_count,
            skipped_count,
            conflict_count,
            error_count,
            errors,
            items,
        }
    }
}

fn count_status(items: &[NameuPlanItem], status: NameuPlanStatus) -> usize {
    items.iter().filter(|item| item.status == status).count()
}

/// `NameuResult` = `NodeRunResult<NameuData>` (`packages/shared/src/index.ts:363`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NameuResult {
    pub success: bool,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<NameuData>,
}

/// `normalizeNameuInput` (core.ts:80-96).
pub fn normalize_nameu_input(input: &NameuInput) -> NormalizedNameuInput {
    NormalizedNameuInput {
        action: input.action.unwrap_or_default(),
        path: clean(input.path.as_deref()),
        paths: dedupe_non_empty(
            input
                .path
                .as_deref()
                .map(|value| clean(Some(value)))
                .into_iter()
                .chain(input.paths.clone().unwrap_or_default().into_iter().map(|value| clean(Some(&value))))
                .chain(parse_list(input.list_text.as_deref())),
        ),
        list_text: input.list_text.clone().unwrap_or_default(),
        mode: input.mode.unwrap_or_default(),
        recursive: input.recursive.unwrap_or(true),
        add_artist_name: input.add_artist_name.unwrap_or(true),
        normalize_folders: input.normalize_folders.unwrap_or(true),
        keep_timestamp: input.keep_timestamp.unwrap_or(true),
        // Dry-run is the default: a plan never mutates (core.ts:91).
        dry_run: input.dry_run.unwrap_or(true),
        exclude_keywords: keyword_list(input.exclude_keywords.as_ref(), &DEFAULT_EXCLUDE_KEYWORDS),
        forbidden_artist_keywords: keyword_list(
            input.forbidden_artist_keywords.as_ref(),
            &DEFAULT_FORBIDDEN_ARTIST_KEYWORDS,
        ),
        archive_extensions: match input.archive_extensions.as_ref() {
            Some(exts) if !exts.is_empty() => exts.iter().map(|ext| crate::text::lower_key(ext)).collect(),
            _ => DEFAULT_ARCHIVE_EXTENSIONS.iter().map(|ext| (*ext).to_string()).collect(),
        },
    }
}

/// A supplied but empty keyword array falls back to the defaults, matching
/// `input.excludeKeywords?.length ? ... : DEFAULT` (core.ts:92-94).
fn keyword_list(provided: Option<&Vec<String>>, defaults: &[&str]) -> Vec<String> {
    match provided {
        Some(values) if !values.is_empty() => values.clone(),
        _ => defaults.iter().map(|keyword| (*keyword).to_string()).collect(),
    }
}

/// `[...new Set(values.map(clean).filter(Boolean))]` (core.ts:84, 346-348).
fn dedupe_non_empty<I: IntoIterator<Item = String>>(values: I) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for value in values {
        if !value.is_empty() && !out.contains(&value) {
            out.push(value);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan_item(source: &str, target: &str, status: NameuPlanStatus, reason: Option<&str>) -> NameuPlanItem {
        NameuPlanItem {
            source_path: source.to_string(),
            target_path: target.to_string(),
            source_name: source.rsplit(['/', '\\']).next().unwrap_or(source).to_string(),
            target_name: target.rsplit(['/', '\\']).next().unwrap_or(target).to_string(),
            artist_name: "Artist".to_string(),
            kind: NameuItemKind::Archive,
            status,
            reason: reason.map(String::from),
        }
    }

    #[test]
    fn defaults_match_the_typescript() {
        let normalized = normalize_nameu_input(&NameuInput::default());
        assert_eq!(normalized.action, NameuAction::Plan);
        assert_eq!(normalized.mode, NameuMode::Multi);
        assert!(normalized.dry_run);
        assert!(normalized.recursive);
        assert!(normalized.add_artist_name);
        assert!(normalized.normalize_folders);
        assert!(normalized.keep_timestamp);
        assert_eq!(normalized.archive_extensions, vec![".zip", ".rar", ".7z", ".cbz", ".cbr"]);
        assert_eq!(normalized.exclude_keywords, vec!["[00待分类]", "[00去图]", "[01来]"]);
        assert_eq!(normalized.forbidden_artist_keywords, vec!["[bili]", "[weibo]", "[02来]"]);
        assert!(normalized.paths.is_empty());
    }

    #[test]
    fn path_paths_and_list_text_merge_in_order_without_duplicates() {
        let normalized = normalize_nameu_input(&NameuInput {
            path: Some(" D:/a ".to_string()),
            paths: Some(vec!["D:/a".to_string(), "D:/b".to_string()]),
            list_text: Some("D:/c,D:/b\r\nD:/d".to_string()),
            ..Default::default()
        });
        assert_eq!(normalized.path, "D:/a");
        assert_eq!(normalized.paths, vec!["D:/a", "D:/b", "D:/c", "D:/d"]);
    }

    #[test]
    fn empty_keyword_arrays_fall_back_to_defaults_while_extensions_lower_case() {
        let normalized = normalize_nameu_input(&NameuInput {
            exclude_keywords: Some(vec![]),
            archive_extensions: Some(vec![".ZIP".to_string(), ".Tar".to_string()]),
            ..Default::default()
        });
        assert_eq!(normalized.exclude_keywords, vec!["[00待分类]", "[00去图]", "[01来]"]);
        assert_eq!(normalized.archive_extensions, vec![".zip", ".tar"]);
    }

    #[test]
    fn provided_keywords_replace_defaults() {
        let normalized = normalize_nameu_input(&NameuInput {
            paths: Some(vec!["D:/a".to_string()]),
            exclude_keywords: Some(vec!["draft".to_string()]),
            forbidden_artist_keywords: Some(vec!["[x]".to_string()]),
            ..Default::default()
        });
        assert_eq!(normalized.paths, vec!["D:/a"]);
        assert_eq!(normalized.exclude_keywords, vec!["draft"]);
        assert_eq!(normalized.forbidden_artist_keywords, vec!["[x]"]);
    }

    #[test]
    fn summarize_counts_and_error_lines() {
        let normalized = normalize_nameu_input(&NameuInput {
            paths: Some(vec!["D:/a".to_string()]),
            ..Default::default()
        });
        let items = vec![
            plan_item(
                "D:/a/one.zip",
                "D:/a/two.zip",
                NameuPlanStatus::Conflict,
                Some("target_name_exists"),
            ),
            plan_item("D:/a/three.zip", "D:/a/four.zip", NameuPlanStatus::Ready, None),
            plan_item("D:/a/five.zip", "D:/a/five.zip", NameuPlanStatus::Error, Some("denied")),
        ];
        let data = NameuData::summarize(&normalized, items);
        assert_eq!(data.action, NameuAction::Plan);
        assert_eq!(data.scanned_count, 3);
        assert_eq!(data.conflict_count, 1);
        assert_eq!(data.ready_count, 1);
        assert_eq!(data.error_count, 1);
        assert_eq!(data.errors, vec!["D:/a/one.zip: target_name_exists", "D:/a/five.zip: denied"]);
    }

    #[test]
    fn statuses_and_actions_serialize_lowercase_like_typescript() {
        assert_eq!(serde_json::to_string(&NameuAction::Scan).unwrap(), "\"scan\"");
        assert_eq!(serde_json::to_string(&NameuMode::Single).unwrap(), "\"single\"");
        assert_eq!(serde_json::to_string(&NameuPlanStatus::Unchanged).unwrap(), "\"unchanged\"");
        assert_eq!(serde_json::to_string(&NameuItemKind::Archive).unwrap(), "\"archive\"");
        assert!(!serde_json::to_string(&plan_item("a", "b", NameuPlanStatus::Ready, None)).unwrap().contains("reason"));
    }

    #[test]
    fn camel_case_input_round_trips_like_the_node_rpc_payload() {
        let parsed: NameuInput =
            serde_json::from_str(r#"{"action":"rename","paths":["D:/a"],"dryRun":false,"mode":"single"}"#)
                .expect("node input json");
        assert_eq!(parsed.action, Some(NameuAction::Rename));
        assert_eq!(parsed.dry_run, Some(false));
        assert_eq!(parsed.mode, Some(NameuMode::Single));
    }
}
