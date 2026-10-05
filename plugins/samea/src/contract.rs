//! The SameA data contract: the node's `def`, the plan documents `core.ts` produces, and the literals
//! the preserved protocol pins.
//!
//! Field names and camelCase spelling are product contract (ADR-0063 principles 1-3): the React card in
//! `src/nodes/samea`, the operation event stream and `interaction.ts:48`'s result lines all read these
//! keys. The port map for this module is `packages/nodes/samea/src/core.ts:3-74` (the type block) and
//! `packages/nodes/samea/src/index.ts:4-8` (the registry `def`).

use serde::{Deserialize, Serialize};

/// The node id, `index.ts:5` and `interaction.ts:40`.
pub const SAMEA_NODE_ID: &str = "samea";
/// `index.ts:5` `name`.
pub const SAMEA_NODE_NAME: &str = "SameA";
/// `index.ts:5` `version`. This is the node's own release, which is `version` in `manifest.toml`
/// (ADR-0068 `pluginVersion`); the Plugin API and Extism runtime versions are separate facts.
pub const SAMEA_NODE_VERSION: &str = "0.1.0";
/// `index.ts:6` `description`.
pub const SAMEA_NODE_DESCRIPTION: &str =
    "Extract artist metadata from archive names and organize matching archives.";
/// `index.ts:6` `icon`.
pub const SAMEA_NODE_ICON: &str = "ScanSearch";
/// `index.ts:7` `keywords`.
pub const SAMEA_NODE_KEYWORDS: [&str; 5] =
    ["artist", "archive", "organize", "extract", "classification"];

/// `core.ts:76` `DEFAULT_ARTIST_BLACKLIST`, in the TypeScript order.
pub const DEFAULT_ARTIST_BLACKLIST: [&str; 11] = [
    "pixiv",
    "twitter",
    "various",
    "anthology",
    "unknown",
    "trash",
    "artbook",
    "汉化",
    "漫畫",
    "翻译",
    "translation",
];

/// `core.ts:77` `DEFAULT_PATH_BLACKLIST`.
pub const DEFAULT_PATH_BLACKLIST: [&str; 3] = ["[00画师分类]", "trash", "temp"];

/// `core.ts:78` `DEFAULT_ARCHIVE_EXTENSIONS`. Lowercased on use, like `core.ts:95`.
pub const DEFAULT_ARCHIVE_EXTENSIONS: [&str; 3] = [".zip", ".rar", ".7z"];

/// `minOccurrences` bounds: the field `range` in `node-definitions/samea.json:134-138`, which is also
/// `interaction.ts:31`'s `min`/`max` and what `clampInt` (`core.ts:87`, `core.ts:253`) enforces.
pub const MIN_OCCURRENCES: usize = 1;
/// Upper bound of the same triple.
pub const MAX_OCCURRENCES: usize = 100;

/// `core.ts:102`, the guard the node's own validation mirrors (`interaction.ts:44`).
pub const NO_ARCHIVE_ROOTS_MESSAGE: &str = "At least one archive root directory is required.";
/// `core.ts:103` the first progress event.
pub const PROGRESS_SCANNING: (u32, &str) = (15, "Scanning SameA archive roots.");
/// `core.ts:108`, before the move loop.
pub const PROGRESS_ORGANIZING: (u32, &str) = (65, "Organizing detected artist archives.");
/// `core.ts:120`, after the move loop.
pub const PROGRESS_COMPLETED: (u32, &str) = (100, "SameA organization completed.");
/// `core.ts:105`, the fallback when a plan produced errors but no error text.
pub const NO_PLAN_MESSAGE: &str = "SameA could not build a plan.";

/// `core.ts:3` `SameaAction`.
///
/// `normalizeSameaInput` (`core.ts:82`) only defaults an *absent* action, and the only test on it is
/// `normalized.action !== "classify"` (`core.ts:106`), so an unknown label behaves like `plan` while
/// still being echoed into `data.action`. [`SameaAction::Other`] keeps that echo honest instead of
/// silently rewriting a caller's string.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SameaAction {
    /// `core.ts:106`'s default branch: plan only, never moves.
    Plan,
    /// The only action that can move files, and the dangerous one (`interaction.ts:46`).
    Classify,
    /// Any other string the caller sent; behaves like `plan`, echoes verbatim.
    Other(String),
}

impl Default for SameaAction {
    /// `core.ts:82`: an absent action is `plan`.
    fn default() -> Self {
        Self::Plan
    }
}

impl SameaAction {
    /// The wire text, which is also what `data.action` carries.
    #[must_use]
    pub fn as_str(&self) -> &str {
        match self {
            Self::Plan => "plan",
            Self::Classify => "classify",
            Self::Other(text) => text,
        }
    }

    /// `action === "classify"` (`core.ts:106`, `interaction.ts:46`).
    #[must_use]
    pub fn is_classify(&self) -> bool {
        matches!(self, Self::Classify)
    }
}

impl From<&str> for SameaAction {
    fn from(value: &str) -> Self {
        match value {
            "plan" => Self::Plan,
            "classify" => Self::Classify,
            other => Self::Other(other.to_string()),
        }
    }
}

/// `core.ts:4` `SameaPlanStatus`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SameaPlanStatus {
    /// Ready to move; the only status the apply loop acts on (`core.ts:111`).
    Ready,
    /// Blacklisted, below threshold, or no artist detected (`core.ts:146-155`).
    Ignored,
    /// Target resolves to the source itself (`core.ts:160`).
    Skipped,
    /// Something already lives at the target (`core.ts:164`, reported as a conflict per
    /// `node-definitions/samea.json:462`).
    Conflict,
    /// Written by the apply loop after a successful move (`core.ts:115`).
    Moved,
    /// A root that is not a directory, or a move that failed (`core.ts:146`, `core.ts:117`).
    Error,
}

impl SameaPlanStatus {
    /// The wire text, for `reason ?? status` fallbacks (`core.ts:227`).
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::Ignored => "ignored",
            Self::Skipped => "skipped",
            Self::Conflict => "conflict",
            Self::Moved => "moved",
            Self::Error => "error",
        }
    }
}

/// `core.ts:44` `SameaArtistGroup["status"]`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SameaGroupStatus {
    /// Meets `minOccurrences` and is not blacklisted (`core.ts:206`).
    Ready,
    /// Fewer detections than the threshold.
    BelowThreshold,
    /// Every detection carries an artist on the blacklist.
    Blacklisted,
}

/// `core.ts:25` `SameaPathInfo`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SameaPathInfo {
    /// The path that was asked about.
    pub path: String,
    /// `stat` succeeded (`platform.ts:8`).
    pub exists: bool,
    /// A regular file (`platform.ts:8`).
    pub is_file: bool,
    /// A directory (`platform.ts:8`).
    pub is_directory: bool,
}

/// `core.ts:26` `SameaDirEntry`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SameaDirEntry {
    /// The entry name as the directory reports it.
    pub name: String,
    /// `join(directory, name)` (`platform.ts:11`).
    pub path: String,
    /// A file.
    pub is_file: bool,
    /// A directory.
    pub is_directory: bool,
}

/// `core.ts:28-37` `SameaPlanItem`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SameaPlanItem {
    /// The archive root this item was collected under.
    pub root_path: String,
    /// Where the archive is now.
    pub source_path: String,
    /// Where a ready archive would go; equal to the source for the non-moving statuses (`core.ts:146-150`).
    pub target_path: String,
    /// `basename(sourcePath)` at collection time (`core.ts:145`).
    pub source_name: String,
    /// `artist.key`, `""` when nothing was detected (`core.ts:146`).
    pub artist_key: String,
    /// `artist.label`, the bracketed display name.
    pub artist_name: String,
    /// The plan verdict.
    pub status: SameaPlanStatus,
    /// Why; omitted from the document when absent, because `JSON.stringify` drops `undefined`
    /// (`core.ts:164` only sets it for a conflict).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// `core.ts:39-45` `SameaArtistGroup`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SameaArtistGroup {
    /// `"<group>\0<artist>"` lowercased (`core.ts:221`).
    pub key: String,
    /// The bracketed label, e.g. `[Circle (Artist A)]`.
    pub name: String,
    /// `join(centralize ? join(root, "[00画师分类]") : root, label)` (`core.ts:205-207`).
    pub target_dir: String,
    /// Detections of this artist across the whole run (`core.ts:140`, `core.ts:204`).
    pub count: usize,
    /// Threshold/blacklist verdict.
    pub status: SameaGroupStatus,
}

/// `core.ts:47-62` `SameaData`.
///
/// `#[serde(default)]` on every field, because `result_view` may be handed a stored or truncated document
/// (`interaction.ts:48` reads four counters off whatever the host kept) and reading it must not fail the
/// way a strict struct would.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SameaData {
    /// Echoed from the normalized input (`core.ts:229`).
    pub action: SameaAction,
    /// Echoed: whether targets gather under `[00画师分类]`.
    pub centralize: bool,
    /// Echoed: the effective threshold.
    pub min_occurrences: usize,
    /// Every collected entry, in scan order.
    pub items: Vec<SameaPlanItem>,
    /// Artist groups, most-frequent first (`core.ts:209`).
    pub groups: Vec<SameaArtistGroup>,
    /// Collected entries, excluding roots that were not directories (`core.ts:166`).
    pub scanned_count: usize,
    /// Items with a non-empty `artistKey` (`core.ts:230`).
    pub detected_count: usize,
    pub ready_count: usize,
    pub moved_count: usize,
    pub ignored_count: usize,
    pub skipped_count: usize,
    pub conflict_count: usize,
    pub error_count: usize,
    /// `"<sourcePath>: <reason ?? status>"` for every error or conflict item (`core.ts:227`).
    pub errors: Vec<String>,
}

/// `core.ts:74` `SameaResult`, i.e. `NodeRunResult<SameaData>`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SameaRunResult {
    /// Whether the run may be reported as done.
    pub success: bool,
    /// The one-line message the UI and `interaction.ts:48` show.
    pub message: String,
    /// The plan document. Always present in practice; optional so a host can feed a bare
    /// `{ success, message }` back through `result_view`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<SameaData>,
}

/// `core.ts:99`'s `onEvent` payload, the `NodeRunEvent` shape
/// (`packages/shared/src/index.ts` progress/log pair).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum SameaRunEvent {
    /// `{ type: "progress", progress, message }` (`core.ts:103`).
    Progress {
        /// 0..=100.
        progress: u32,
        /// Human-readable phase text.
        message: String,
    },
    /// `{ type: "log", message }`, which the node does not emit today but the host event stream accepts.
    Log {
        /// The line.
        message: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_echoes_unknown_labels_and_recognises_the_two_declared_ones() {
        assert!(!SameaAction::Plan.is_classify());
        assert!(SameaAction::Classify.is_classify());
        assert_eq!(SameaAction::from("classify"), SameaAction::Classify);
        assert_eq!(SameaAction::from("plan"), SameaAction::Plan);
        assert_eq!(SameaAction::from("whatever").as_str(), "whatever");
        // Negative control: an unknown label must not read as the dangerous action.
        assert!(!SameaAction::from("whatever").is_classify());
    }

    #[test]
    fn plan_status_wire_names_match_core_ts() {
        for (status, name) in [
            (SameaPlanStatus::Ready, "ready"),
            (SameaPlanStatus::Ignored, "ignored"),
            (SameaPlanStatus::Skipped, "skipped"),
            (SameaPlanStatus::Conflict, "conflict"),
            (SameaPlanStatus::Moved, "moved"),
            (SameaPlanStatus::Error, "error"),
        ] {
            assert_eq!(status.as_str(), name);
            assert_eq!(serde_json::to_value(status).unwrap(), serde_json::json!(name));
        }
        assert_eq!(
            serde_json::to_value(SameaGroupStatus::BelowThreshold).unwrap(),
            serde_json::json!("below_threshold"),
            "`core.ts:44` spells the middle status with an underscore"
        );
    }

    #[test]
    fn plan_item_omits_an_absent_reason() {
        let item = SameaPlanItem {
            root_path: "/archive".to_string(),
            source_path: "/archive/a.zip".to_string(),
            target_path: "/archive/a.zip".to_string(),
            source_name: "a.zip".to_string(),
            artist_key: String::new(),
            artist_name: String::new(),
            status: SameaPlanStatus::Ignored,
            reason: None,
        };
        let document = serde_json::to_value(&item).expect("serializable");
        assert!(document.get("reason").is_none(), "{document}");
        assert_eq!(document["status"], serde_json::json!("ignored"));
    }
}
