//! DissolveF's input vocabulary: the node's actions, modes, defaults and extension/blacklist tables.
//!
//! The field names are the names `packages/nodes/dissolvef/src/core.ts` publishes (`DissolvefInput`,
//! `NormalizedDissolvefInput`) and the values are the ones `interaction.ts:2-3` offers, because the CLI, the
//! TUI and the GUI all read this one vocabulary and none of them may redefine it (ADR-0069). The response
//! half of the contract lives in [`crate::document`].
//!
//! Deserialization stays deliberately lenient: `core.ts` trusts its caller and coerces (`Number()`,
//! `parseList`, `Boolean()`), so an unexpected JSON type is coerced the way JavaScript would coerce it
//! rather than rejected as a malformed request.

use serde::{Deserialize, Serialize};

/// `DissolvefAction` (`core.ts:3`). An unrecognised spelling behaves exactly like `dissolve`, which is
/// what `core.ts` does with an untyped string: it is not one of the named actions, so it takes the
/// bundled-mode path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DissolvefAction {
    Dissolve,
    Plan,
    Nested,
    Media,
    Archive,
    Direct,
    CollectArchives,
    History,
    Undo,
}

impl DissolvefAction {
    /// The `interaction.ts` option value and the `DissolvefAction` union member.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Dissolve => "dissolve",
            Self::Plan => "plan",
            Self::Nested => "nested",
            Self::Media => "media",
            Self::Archive => "archive",
            Self::Direct => "direct",
            Self::CollectArchives => "collect_archives",
            Self::History => "history",
            Self::Undo => "undo",
        }
    }

    fn parse(value: &str) -> Self {
        match value {
            "plan" => Self::Plan,
            "nested" => Self::Nested,
            "media" => Self::Media,
            "archive" => Self::Archive,
            "direct" => Self::Direct,
            "collect_archives" => Self::CollectArchives,
            "history" => Self::History,
            "undo" => Self::Undo,
            _ => Self::Dissolve,
        }
    }
}

/// `DissolvefMode` (`core.ts:4`) — which dissolution rule produced a plan row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DissolvefMode {
    Nested,
    Media,
    Archive,
    Direct,
}

impl DissolvefMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Nested => "nested",
            Self::Media => "media",
            Self::Archive => "archive",
            Self::Direct => "direct",
        }
    }
}

/// `DissolvefConflictMode` (`core.ts:5`). `auto` means "skip for files, overwrite for directories"
/// (`normalizeConflict`, `core.ts:652-655`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DissolvefConflictMode {
    Auto,
    Skip,
    Overwrite,
    Rename,
}

impl DissolvefConflictMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Skip => "skip",
            Self::Overwrite => "overwrite",
            Self::Rename => "rename",
        }
    }

    fn parse(value: &str) -> Self {
        match value {
            "skip" => Self::Skip,
            "overwrite" => Self::Overwrite,
            "rename" => Self::Rename,
            _ => Self::Auto,
        }
    }
}

/// `DissolvefMediaType` (`core.ts:6`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DissolvefMediaType {
    Video,
    Archive,
    Image,
}

impl DissolvefMediaType {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Video => "video",
            Self::Archive => "archive",
            Self::Image => "image",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "video" => Some(Self::Video),
            "archive" => Some(Self::Archive),
            "image" => Some(Self::Image),
            _ => None,
        }
    }
}


/// `DissolvefInput` (`core.ts:8-34`) as it arrives on the wire.
///
/// The duplicated snake_case fields are not accidents to clean up: `core.ts:154-159` reads both spellings
/// with camelCase winning, and `cli.ts` has been passing the snake_case form.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DissolvefInput {
    #[serde(default)]
    pub action: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub nested: Option<bool>,
    #[serde(default)]
    pub media: Option<bool>,
    #[serde(default)]
    pub archive: Option<bool>,
    #[serde(default)]
    pub direct: Option<bool>,
    #[serde(default)]
    pub preview: Option<bool>,
    #[serde(default)]
    pub dry_run: Option<bool>,
    /// `string | string[]`, kept raw so `parse_list` can apply `core.ts:803-806` verbatim.
    #[serde(default)]
    pub exclude: Option<serde_json::Value>,
    #[serde(default)]
    pub file_conflict: Option<String>,
    #[serde(default)]
    pub dir_conflict: Option<String>,
    #[serde(rename = "file_conflict", default)]
    pub file_conflict_legacy: Option<String>,
    #[serde(rename = "dir_conflict", default)]
    pub dir_conflict_legacy: Option<String>,
    #[serde(default)]
    pub similarity_threshold: Option<serde_json::Value>,
    #[serde(rename = "similarity_threshold", default)]
    pub similarity_threshold_legacy: Option<serde_json::Value>,
    #[serde(default)]
    pub enable_similarity: Option<bool>,
    #[serde(rename = "enable_similarity", default)]
    pub enable_similarity_legacy: Option<bool>,
    #[serde(default)]
    pub protect_first_level: Option<bool>,
    #[serde(rename = "protect_first_level", default)]
    pub protect_first_level_legacy: Option<bool>,
    #[serde(default)]
    pub undo_id: Option<String>,
    #[serde(rename = "undo_id", default)]
    pub undo_id_legacy: Option<String>,
    #[serde(default)]
    pub history_path: Option<String>,
    #[serde(default)]
    pub history_limit: Option<serde_json::Value>,
    #[serde(default)]
    pub media_types: Option<Vec<String>>,
    #[serde(default)]
    pub skip_blacklist: Option<bool>,
}

/// `runOptions` of the request document. The host owns all three: the operation the run belongs to
/// (ADR-0068 — every cross-boundary call carries an `operation_id`), the location `platform.ts:21-25`
/// derives from the Xiranite config directory, and an optional uniqueness suffix that stands in for
/// `crypto.randomUUID()`, whose source does not exist inside a sandboxed plugin.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DissolvefRunOptions {
    #[serde(default)]
    pub operation_id: Option<String>,
    #[serde(default)]
    pub default_history_path: Option<String>,
    #[serde(default)]
    pub undo_record_id_suffix: Option<String>,
}

/// The request document: `{"input": {...}, "runOptions": {...}}`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DissolvefRunRequest {
    #[serde(default)]
    pub input: DissolvefInput,
    #[serde(default)]
    pub run_options: Option<DissolvefRunOptions>,
}

/// The host-supplied part of one run, after defaults. `DissolvefRuntime.defaultHistoryPath()` and
/// `DissolvefRuntime.randomId()` (`core.ts:108-113`) were machine-owned values in TypeScript; they arrive
/// here instead, because the pinned capability set exposes no config-directory or randomness call.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DissolvefRunScope {
    /// `runOptions.operationId`: scopes every `xiranite.*` call (ADR-0068).
    pub operation_id: String,
    /// `runOptions.defaultHistoryPath`: the fallback when `input.historyPath` is empty.
    pub default_history_path: String,
    /// `runOptions.undoRecordIdSuffix`: the uniqueness part of a new journal id, when the host has one.
    pub undo_record_id_suffix: Option<String>,
}

impl DissolvefRunScope {
    #[must_use]
    pub fn from_options(options: &Option<DissolvefRunOptions>) -> Self {
        let Some(options) = options else { return Self::default() };
        Self {
            operation_id: clean(options.operation_id.as_deref()),
            // The path is used verbatim: `historyPath()` (`core.ts:799-801`) only ever cleaned
            // `input.historyPath`, never the value `defaultHistoryPath()` produced.
            default_history_path: options.default_history_path.clone().unwrap_or_default(),
            undo_record_id_suffix: options
                .undo_record_id_suffix
                .as_deref()
                .map(|suffix| clean(Some(suffix)))
                .filter(|suffix| !suffix.is_empty()),
        }
    }
}

/// `NormalizedDissolvefInput` (`core.ts:113-132`).
#[derive(Debug, Clone, PartialEq)]
pub struct NormalizedDissolvefInput {
    pub action: DissolvefAction,
    pub path: String,
    pub nested: bool,
    pub media: bool,
    pub archive: bool,
    pub direct: bool,
    pub preview: bool,
    pub exclude: Vec<String>,
    pub file_conflict: DissolvefConflictMode,
    pub dir_conflict: DissolvefConflictMode,
    pub similarity_threshold: f64,
    pub enable_similarity: bool,
    pub protect_first_level: bool,
    pub undo_id: String,
    pub history_path: String,
    pub history_limit: usize,
    pub media_types: Vec<DissolvefMediaType>,
    pub skip_blacklist: bool,
}

/// `normalizeDissolvefInput` (`core.ts:142-165`).
#[must_use]
pub fn normalize_dissolvef_input(input: &DissolvefInput) -> NormalizedDissolvefInput {
    let action = DissolvefAction::parse(input.action.as_deref().unwrap_or("dissolve"));
    let direct = input.direct.unwrap_or(action == DissolvefAction::Direct);
    NormalizedDissolvefInput {
        action,
        path: clean(input.path.as_deref()),
        nested: input
            .nested
            .unwrap_or(!direct && action != DissolvefAction::Media && action != DissolvefAction::Archive),
        media: input
            .media
            .unwrap_or(!direct && action != DissolvefAction::Nested && action != DissolvefAction::Archive),
        archive: input
            .archive
            .unwrap_or(!direct && action != DissolvefAction::Nested && action != DissolvefAction::Media),
        direct,
        // `Boolean(input.preview ?? input.dryRun)` (`core.ts:152`).
        preview: input.preview.or(input.dry_run).unwrap_or(false),
        exclude: parse_list(input.exclude.as_ref()),
        file_conflict: conflict(input.file_conflict.as_ref(), input.file_conflict_legacy.as_ref()),
        dir_conflict: conflict(input.dir_conflict.as_ref(), input.dir_conflict_legacy.as_ref()),
        similarity_threshold: clamp_number(
            coerce_f64(input.similarity_threshold.as_ref())
                .or_else(|| coerce_f64(input.similarity_threshold_legacy.as_ref())),
            0.6,
            0.0,
            1.0,
        ),
        enable_similarity: flag_or_legacy(input.enable_similarity, input.enable_similarity_legacy, true),
        protect_first_level: flag_or_legacy(
            input.protect_first_level,
            input.protect_first_level_legacy,
            true,
        ),
        undo_id: clean(
            input.undo_id.as_ref().or(input.undo_id_legacy.as_ref()).map(String::as_str),
        ),
        history_path: clean(input.history_path.as_deref()),
        history_limit: history_limit(coerce_f64(input.history_limit.as_ref())),
        media_types: media_types(input.media_types.as_ref()),
        skip_blacklist: input.skip_blacklist.unwrap_or(false),
    }
}

/// `DISSOLVEF_VIDEO_EXTENSIONS` (`core.ts:136`).
pub const DISSOLVEF_VIDEO_EXTENSIONS: &[&str] = &[
    ".mp4", ".nov", ".avi", ".mkv", ".wmv", ".flv", ".webm", ".mov", ".m4v", ".mpg", ".mpeg", ".3gp",
    ".rmvb",
];

/// `DISSOLVEF_ARCHIVE_EXTENSIONS` (`core.ts:137`).
pub const DISSOLVEF_ARCHIVE_EXTENSIONS: &[&str] = &[".zip", ".rar", ".7z", ".cbz", ".cbr"];

/// `DISSOLVEF_IMAGE_EXTENSIONS` (`core.ts:138`).
pub const DISSOLVEF_IMAGE_EXTENSIONS: &[&str] = &[
    ".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".bmp", ".tif", ".tiff",
];

/// `DISSOLVEF_SINGLE_ARCHIVE_BLACKLIST` (`core.ts:139`).
pub const DISSOLVEF_SINGLE_ARCHIVE_BLACKLIST: &[&str] = &["画集", "商业志", "同人志", "#compare"];

/// `DISSOLVEF_NESTED_BLACKLIST` (`core.ts:140`).
pub const DISSOLVEF_NESTED_BLACKLIST: &[&str] = &[
    "画集",
    "商业志",
    "同人志",
    "#compare",
    "CG",
    "pixiv",
    "fan",
    "patreon",
];

fn conflict(camel: Option<&String>, legacy: Option<&String>) -> DissolvefConflictMode {
    DissolvefConflictMode::parse(camel.or(legacy).map(String::as_str).unwrap_or("auto"))
}

fn flag_or_legacy(camel: Option<bool>, legacy: Option<bool>, fallback: bool) -> bool {
    camel.or(legacy).unwrap_or(fallback)
}

fn media_types(values: Option<&Vec<String>>) -> Vec<DissolvefMediaType> {
    const EVERY_TYPE: [DissolvefMediaType; 3] =
        [DissolvefMediaType::Video, DissolvefMediaType::Archive, DissolvefMediaType::Image];
    let Some(values) = values else { return EVERY_TYPE.to_vec() };
    if values.is_empty() {
        return EVERY_TYPE.to_vec();
    }
    // `[...new Set(input.mediaTypes)]` (`core.ts:162`): first occurrence wins. An entry that is not a
    // known media type stays unknown, so a list of only unknown names selects no media at all rather than
    // silently falling back to every type.
    let mut picked: Vec<DissolvefMediaType> = Vec::with_capacity(values.len());
    for value in values {
        if let Some(kind) = DissolvefMediaType::parse(value)
            && !picked.contains(&kind)
        {
            picked.push(kind);
        }
    }
    picked
}

fn history_limit(value: Option<f64>) -> usize {
    // `Math.max(1, Math.trunc(input.historyLimit ?? 20))`. `Math.trunc` of a non-finite value is NaN and
    // `Math.max(1, NaN)` is NaN, which `records.slice(0, NaN)` reads as an empty list.
    match value {
        Some(parsed) if parsed.is_finite() => parsed.trunc().max(1.0) as usize,
        None => 20,
        Some(_) => 0,
    }
}

/// `clampNumber` (`core.ts:812-816`).
fn clamp_number(value: Option<f64>, fallback: f64, min: f64, max: f64) -> f64 {
    match value {
        Some(parsed) if parsed.is_finite() => parsed.min(max).max(min),
        _ => fallback,
    }
}

/// `Number(value)` for whatever JSON arrived, string forms included, because `core.ts` coerced them.
fn coerce_f64(value: Option<&serde_json::Value>) -> Option<f64> {
    match value? {
        serde_json::Value::Number(number) => number.as_f64(),
        serde_json::Value::Bool(enabled) => Some(if *enabled { 1.0 } else { 0.0 }),
        serde_json::Value::String(text) => text.trim().parse::<f64>().ok(),
        _ => None,
    }
}

/// `parseList` (`core.ts:803-806`).
fn parse_list(value: Option<&serde_json::Value>) -> Vec<String> {
    match value {
        Some(serde_json::Value::Array(items)) => items
            .iter()
            .map(|item| clean(item.as_str()))
            .filter(|text| !text.is_empty())
            .collect(),
        Some(serde_json::Value::String(text)) => text
            .split([',', ';', '\r', '\n'])
            .map(|part| clean(Some(part)))
            .filter(|text| !text.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

/// `clean` (`core.ts:808-810`): trim, then drop one quote character from each end.
pub(crate) fn clean(value: Option<&str>) -> String {
    let trimmed = value.unwrap_or("").trim();
    let without_open = trimmed.strip_prefix(['"', '\'']).unwrap_or(trimmed);
    without_open.strip_suffix(['"', '\'']).unwrap_or(without_open).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input_from(raw: &str) -> DissolvefInput {
        serde_json::from_str(raw).expect("request input parses")
    }

    #[test]
    fn defaults_match_core_ts_normalize() {
        let normalized = normalize_dissolvef_input(&DissolvefInput::default());
        assert_eq!(normalized.action, DissolvefAction::Dissolve);
        assert!(normalized.nested && normalized.media && normalized.archive);
        assert!(!normalized.direct);
        assert!(!normalized.preview);
        assert_eq!(normalized.file_conflict, DissolvefConflictMode::Auto);
        assert_eq!(normalized.dir_conflict, DissolvefConflictMode::Auto);
        assert_eq!(normalized.similarity_threshold, 0.6);
        assert!(normalized.enable_similarity);
        assert!(normalized.protect_first_level);
        assert_eq!(normalized.history_limit, 20);
        assert_eq!(
            normalized.media_types,
            vec![DissolvefMediaType::Video, DissolvefMediaType::Archive, DissolvefMediaType::Image]
        );
        assert!(!normalized.skip_blacklist);
        assert_eq!(normalized.path, "");
        assert_eq!(normalized.exclude, Vec::<String>::new());
    }

    #[test]
    fn single_action_mode_disables_the_other_two() {
        let nested = normalize_dissolvef_input(&input_from(r#"{"action":"nested"}"#));
        assert!(nested.nested && !nested.media && !nested.archive);
        let media = normalize_dissolvef_input(&input_from(r#"{"action":"media"}"#));
        assert!(media.media && !media.nested && !media.archive);
        let archive = normalize_dissolvef_input(&input_from(r#"{"action":"archive"}"#));
        assert!(archive.archive && !archive.nested && !archive.media);
        let direct = normalize_dissolvef_input(&input_from(r#"{"action":"direct"}"#));
        assert!(direct.direct && !direct.nested && !direct.media && !direct.archive);
    }

    #[test]
    fn unknown_action_behaves_exactly_like_dissolve() {
        let normalized = normalize_dissolvef_input(&input_from(r#"{"action":"whatever"}"#));
        assert_eq!(normalized.action, DissolvefAction::Dissolve);
        assert!(normalized.nested && normalized.media && normalized.archive);
    }

    #[test]
    fn camel_case_wins_over_the_legacy_snake_case_spelling() {
        let normalized = normalize_dissolvef_input(&input_from(
            r#"{"fileConflict":"rename","file_conflict":"skip","dir_conflict":"overwrite","similarity_threshold":0.2,"enable_similarity":false,"protect_first_level":false,"undo_id":"u-1"}"#,
        ));
        assert_eq!(normalized.file_conflict, DissolvefConflictMode::Rename);
        assert_eq!(normalized.dir_conflict, DissolvefConflictMode::Overwrite);
        assert_eq!(normalized.similarity_threshold, 0.2);
        assert!(!normalized.enable_similarity);
        assert!(!normalized.protect_first_level);
        assert_eq!(normalized.undo_id, "u-1");
        // Snake_case alone is still honoured, and an unknown conflict name is `auto`.
        let legacy = normalize_dissolvef_input(&input_from(r#"{"file_conflict":"skip"}"#));
        assert_eq!(legacy.file_conflict, DissolvefConflictMode::Skip);
        assert_eq!(
            normalize_dissolvef_input(&input_from(r#"{"fileConflict":"bogus"}"#)).file_conflict,
            DissolvefConflictMode::Auto
        );
    }

    #[test]
    fn dry_run_is_the_legacy_preview_flag() {
        assert!(normalize_dissolvef_input(&input_from(r#"{"dryRun":true}"#)).preview);
        assert!(!normalize_dissolvef_input(&input_from(r#"{"dryRun":true,"preview":false}"#)).preview);
    }

    #[test]
    fn threshold_is_clamped_into_zero_to_one() {
        for (raw, expected) in [
            (r#"{"similarityThreshold":9}"#, 1.0),
            (r#"{"similarityThreshold":-3}"#, 0.0),
            (r#"{"similarityThreshold":"0.8"}"#, 0.8),
            (r#"{"similarityThreshold":null}"#, 0.6),
            (r#"{"similarityThreshold":"abc"}"#, 0.6),
            (r#"{"similarityThreshold":0}"#, 0.0),
        ] {
            assert_eq!(
                normalize_dissolvef_input(&input_from(raw)).similarity_threshold,
                expected,
                "{raw}"
            );
        }
    }

    #[test]
    fn exclude_accepts_a_list_or_a_split_string_and_quotes_are_cleaned() {
        let list = normalize_dissolvef_input(&input_from(r#"{"exclude":[" a ","","b"]}"#));
        assert_eq!(list.exclude, vec!["a".to_string(), "b".to_string()]);
        let text = normalize_dissolvef_input(&input_from(r#"{"exclude":"a, b;c\r\n d"}"#));
        assert_eq!(
            text.exclude,
            vec!["a".to_string(), "b".to_string(), "c".to_string(), "d".to_string()]
        );
        assert_eq!(clean(Some("\"quoted\"")), "quoted".to_string());
        assert_eq!(clean(Some("'quoted'")), "quoted".to_string());
        assert_eq!(clean(Some("  spaced  ")), "spaced".to_string());
        assert_eq!(clean(None), "".to_string());
        // Only one quote per side, and only at the edge: `core.ts:809` is `^["']|["']$`.
        assert_eq!(clean(Some("\"inner\"quote\"")), "inner\"quote".to_string());
    }

    #[test]
    fn media_types_deduplicate_and_keep_unknown_names_empty() {
        let normalized =
            normalize_dissolvef_input(&input_from(r#"{"mediaTypes":["image","image","video","bogus"]}"#));
        assert_eq!(normalized.media_types, vec![DissolvefMediaType::Image, DissolvefMediaType::Video]);
        assert_eq!(normalize_dissolvef_input(&input_from(r#"{"mediaTypes":[]}"#)).media_types.len(), 3);
        // `[...new Set(["bogus"])]` is a non-empty list that matches nothing; it must not fall back.
        assert!(normalize_dissolvef_input(&input_from(r#"{"mediaTypes":["bogus"]}"#)).media_types.is_empty());
    }

    #[test]
    fn history_limit_is_truncated_and_floored_at_one() {
        assert_eq!(normalize_dissolvef_input(&input_from(r#"{"historyLimit":7.9}"#)).history_limit, 7);
        assert_eq!(normalize_dissolvef_input(&input_from(r#"{"historyLimit":0}"#)).history_limit, 1);
        assert_eq!(normalize_dissolvef_input(&input_from(r#"{"historyLimit":-5}"#)).history_limit, 1);
    }

    #[test]
    fn request_document_reads_the_pinned_envelope() {
        let request: DissolvefRunRequest = serde_json::from_str(
            r#"{"input":{"action":"plan","path":"D:/library"},"runOptions":{"operationId":"op-1","defaultHistoryPath":"D:/x/dissolvef.undo.json","undoRecordIdSuffix":"deadbeef"}}"#,
        )
        .expect("request document parses");
        assert_eq!(request.input.path.as_deref(), Some("D:/library"));
        assert_eq!(request.input.action.as_deref(), Some("plan"));
        let options = request.run_options.expect("run options");
        assert_eq!(options.operation_id.as_deref(), Some("op-1"));
        assert_eq!(options.default_history_path.as_deref(), Some("D:/x/dissolvef.undo.json"));
        assert_eq!(options.undo_record_id_suffix.as_deref(), Some("deadbeef"));
    }

    #[test]
    fn an_empty_request_document_is_still_a_request() {
        let request: DissolvefRunRequest = serde_json::from_str("{}").expect("bare object");
        assert_eq!(request.input.path, None);
        assert!(request.run_options.is_none());
    }
}
