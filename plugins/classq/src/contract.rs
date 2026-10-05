//! ClassQ's vocabulary plus the documents that cross the plugin boundary.
//!
//! Field names here are a preserved product contract rather than a Rust choice: `packages/nodes/classq/src/core.ts:35-64`
//! defines `ClassqPlanItem`/`ClassqData` and `:21-33` defines the directory-entry and path-info records, and those
//! exact camelCase keys are what the React view (`src/nodes/classq`), the operation history row and the old CLI
//! text (`packages/nodes/classq/src/cli.ts:48`) already read. ADR-0063 keeps the HTTP/Operation payload shape, so
//! serde renames to camelCase and nothing else.
//!
//! Flatness is deliberate (ADR-0068): every type below is string / bool / fixed-width number / list / option /
//! fieldless enum, which is what a WIT adapter will be able to express without a redesign. There are no trait
//! objects, no lifetimes and no serialization tricks crossing the border, and errors are `reason` text on a plan
//! item rather than a trap.

use std::fmt;

use serde::{Deserialize, Serialize};

/// The workflow a run performs (`ClassqAction`, `core.ts:3`). `Plan` is the default the normalizer picks
/// (`core.ts:81`), so a document that names no workflow never writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ClassqAction {
    /// Scan and plan only; never writes.
    #[default]
    Plan,
    /// Apply the planned wait transfers.
    Classify,
}

impl ClassqAction {
    /// Every action in declaration order, matching `definition.json` `actions[]`.
    pub const ALL: &'static [Self] = &[Self::Plan, Self::Classify];

    /// The wire name, which is also the option value the published definition declares.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Plan => "plan",
            Self::Classify => "classify",
        }
    }

    /// `values.action === "classify" ? "classify" : "plan"` (`interaction.ts:31`): anything that is not exactly
    /// `classify` selects the read-only plan, so a typo cannot become a live run by accident.
    #[must_use]
    pub fn from_field_text(text: &str) -> Self {
        if text.trim() == Self::Classify.as_str() {
            Self::Classify
        } else {
            Self::Plan
        }
    }
}

impl fmt::Display for ClassqAction {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// How a ready item reaches its wait folder (`ClassqTransferMode`, `core.ts:4`). `Move` is `core.ts:87`'s default.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ClassqTransferMode {
    /// `fs::rename` (`platform.ts:27`).
    #[default]
    Move,
    /// Recursive copy (`platform.ts:23-25`).
    Copy,
}

impl ClassqTransferMode {
    /// Every mode in declaration order, matching `definition.json` `transferMode` options.
    pub const ALL: &'static [Self] = &[Self::Move, Self::Copy];

    /// The wire name.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Move => "move",
            Self::Copy => "copy",
        }
    }

    /// `values.transferMode === "copy" ? "copy" : "move"` (`interaction.ts:31`): only the exact word copies.
    #[must_use]
    pub fn from_field_text(text: &str) -> Self {
        if text.trim() == Self::Copy.as_str() {
            Self::Copy
        } else {
            Self::Move
        }
    }
}

impl fmt::Display for ClassqTransferMode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// What a run does when the wait target already exists (`ClassqExistingPolicy`, `core.ts:5`). `Merge` is
/// `core.ts:88`'s default.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ClassqExistingPolicy {
    /// Report the collision as `target_exists` (`core.ts:201`).
    #[default]
    Merge,
    /// Report the same collision as `target_exists_skip` (`core.ts:201`).
    Skip,
}

impl ClassqExistingPolicy {
    /// Every policy in declaration order, matching `definition.json` `existingPolicy` options.
    pub const ALL: &'static [Self] = &[Self::Merge, Self::Skip];

    /// The wire name.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Merge => "merge",
            Self::Skip => "skip",
        }
    }

    /// `values.existingPolicy === "skip" ? "skip" : "merge"` (`interaction.ts:31`).
    #[must_use]
    pub fn from_field_text(text: &str) -> Self {
        if text.trim() == Self::Skip.as_str() {
            Self::Skip
        } else {
            Self::Merge
        }
    }
}

impl fmt::Display for ClassqExistingPolicy {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// One plan item's state (`ClassqPlanStatus`, `core.ts:6`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClassqPlanStatus {
    /// A keyword folder was found; nothing about it moves (`core.ts:182`).
    Found,
    /// A sibling is transferable (`core.ts:202`).
    Ready,
    /// Retained vocabulary: `core.ts:6` declares it and no code path produces it. Kept because the status set is
    /// the published contract the React view switches on, not because the planner emits it.
    Skipped,
    /// A live `move` finished (`core.ts:111`).
    Moved,
    /// A live `copy` finished (`core.ts:111`).
    Copied,
    /// The wait target already exists (`core.ts:201`).
    Conflict,
    /// The root was unusable, the keyword folder was absent, or the host call failed (`core.ts:128`, `:134`, `:113`).
    Error,
}

impl ClassqPlanStatus {
    /// Every status in declaration order.
    pub const ALL: &'static [Self] = &[
        Self::Found,
        Self::Ready,
        Self::Skipped,
        Self::Moved,
        Self::Copied,
        Self::Conflict,
        Self::Error,
    ];

    /// The wire name.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Found => "found",
            Self::Ready => "ready",
            Self::Skipped => "skipped",
            Self::Moved => "moved",
            Self::Copied => "copied",
            Self::Conflict => "conflict",
            Self::Error => "error",
        }
    }
}

impl fmt::Display for ClassqPlanStatus {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// Which half of the rule an item belongs to (`ClassqStage`, `core.ts:7`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClassqStage {
    /// The keyword folder itself, reported as `found` (`core.ts:181`).
    Keyword,
    /// A sibling queued for the wait folder (`core.ts:198`).
    Wait,
}

impl ClassqStage {
    /// The wire name.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Keyword => "keyword",
            Self::Wait => "wait",
        }
    }
}

/// Whether a plan item names a file or a folder (`kind` union, `core.ts:43`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClassqItemKind {
    /// A regular file.
    File,
    /// A directory — also what the synthetic error items claim (`core.ts:230`, `:234`).
    Folder,
}

impl ClassqItemKind {
    /// The wire name.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Folder => "folder",
        }
    }
}

/// One entry of a directory listing (`ClassqDirEntry`, `core.ts:21-26`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassqDirEntry {
    /// File-system name, the part the keyword match and the target name use.
    pub name: String,
    /// The full path the listing produced.
    pub path: String,
    /// Regular file.
    pub is_file: bool,
    /// Directory.
    pub is_directory: bool,
}

impl ClassqDirEntry {
    /// A directory entry (`core.ts:24-25` sets both flags from `readdir`'s `Dirent`).
    #[must_use]
    pub fn directory(name: impl Into<String>, path: impl Into<String>) -> Self {
        Self { name: name.into(), path: path.into(), is_file: false, is_directory: true }
    }

    /// A file entry.
    #[must_use]
    pub fn file(name: impl Into<String>, path: impl Into<String>) -> Self {
        Self { name: name.into(), path: path.into(), is_file: true, is_directory: false }
    }

    /// Neither file nor directory. `core.ts:152` drops such an entry instead of planning it.
    #[must_use]
    pub fn other(name: impl Into<String>, path: impl Into<String>) -> Self {
        Self { name: name.into(), path: path.into(), is_file: false, is_directory: false }
    }
}

/// What the runtime knows about one path (`ClassqPathInfo`, `core.ts:28-33`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassqPathInfo {
    /// The path as asked for.
    pub path: String,
    /// Whether it resolved at all.
    pub exists: bool,
    /// Regular file.
    pub is_file: bool,
    /// Directory.
    pub is_directory: bool,
}

impl ClassqPathInfo {
    /// `platform.ts:11-13`: a `stat` that throws is reported as "does not exist", never as an error, which is why
    /// an unusable root becomes an `error` plan item rather than a failed run.
    #[must_use]
    pub fn missing(path: impl Into<String>) -> Self {
        Self { path: path.into(), exists: false, is_file: false, is_directory: false }
    }
}

/// One row of the plan (`ClassqPlanItem`, `core.ts:35-47`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassqPlanItem {
    /// The root the scan started from.
    pub root_path: String,
    /// The keyword folder's parent, which is where the wait folder lives.
    pub parent_path: String,
    /// The keyword folder that made this item interesting.
    pub keyword_path: String,
    /// What would be transferred.
    pub source_path: String,
    /// Where it would land.
    pub target_path: String,
    /// `basename(sourcePath)` (`core.ts:178`, `:195`).
    pub source_name: String,
    /// `relative(rootPath, targetPath)`, the display form (`core.ts:180`, `:196`).
    pub target_relative: String,
    /// File or folder.
    pub kind: ClassqItemKind,
    /// Keyword row or wait-transfer row.
    pub stage: ClassqStage,
    /// Current state.
    pub status: ClassqPlanStatus,
    /// `reason`: only present on `error` and `conflict` rows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// The run payload (`ClassqData`, `core.ts:49-64`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ClassqData {
    /// Echoed input, so a history row stays readable on its own.
    pub action: ClassqAction,
    /// Echoed keyword folder name.
    pub keyword: String,
    /// Echoed wait folder name.
    pub wait_keyword: String,
    /// Echoed transfer mode.
    pub transfer_mode: ClassqTransferMode,
    /// Every row the run produced, in plan order.
    pub items: Vec<ClassqPlanItem>,
    /// `paths.len()` (`core.ts:213`).
    pub root_count: usize,
    /// Keyword rows found (`core.ts:214`).
    pub keyword_count: usize,
    /// Rows still ready to transfer (`core.ts:215`).
    pub ready_count: usize,
    /// Rows in the wait stage, whatever their status (`core.ts:216`).
    pub wait_count: usize,
    /// Moves applied (`core.ts:217`).
    pub moved_count: usize,
    /// Copies applied (`core.ts:218`).
    pub copied_count: usize,
    /// Existing-target conflicts (`core.ts:219`).
    pub conflict_count: usize,
    /// Error rows (`core.ts:220`).
    pub error_count: usize,
    /// `"<sourcePath>: <reason>"` for every error or conflict row (`core.ts:206`).
    pub errors: Vec<String>,
}

/// `nodeRunResultSchema` as ClassQ produces it (`ClassqResult`, `core.ts:77`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassqRunResult {
    /// `success`: a run that produced any error row is not successful (`core.ts:226`).
    pub success: bool,
    /// The one-line message the history row and the CLI print.
    pub message: String,
    /// `data`: always present for ClassQ, because `core.ts:229-231` builds the same record even on failure.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<ClassqData>,
}

/// The `type` tag of `nodeRunEventSchema` (`packages/shared/src/index.ts`, mirrored by ADR-0063).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClassqRunEventKind {
    /// A percentage update with a message.
    Progress,
    /// A plain message line.
    Log,
}

impl ClassqRunEventKind {
    /// The wire name.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Progress => "progress",
            Self::Log => "log",
        }
    }
}

/// One progress or log event (`NodeRunEvent`, emitted at `core.ts:97` and `:101`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassqRunEvent {
    /// `type`.
    #[serde(rename = "type")]
    pub kind: ClassqRunEventKind,
    /// `progress`, a percentage; absent for log events.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<f64>,
    /// `message`.
    pub message: String,
}

impl ClassqRunEvent {
    /// `{ type: "progress", progress, message }`, the only shape this node emits.
    #[must_use]
    pub fn progress(progress: f64, message: impl Into<String>) -> Self {
        Self { kind: ClassqRunEventKind::Progress, progress: Some(progress), message: message.into() }
    }

    /// `{ type: "log", message }`.
    #[must_use]
    pub fn log(message: impl Into<String>) -> Self {
        Self { kind: ClassqRunEventKind::Log, progress: None, message: message.into() }
    }
}

/// The `resultExport` view model (`interaction.ts:28`'s `result(result)`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassqResultView {
    /// Copied from the run result.
    pub success: bool,
    /// Copied from the run result.
    pub message: String,
    /// The three counter lines the legacy schema rendered.
    pub lines: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_names_are_the_published_ones() {
        assert_eq!(serde_json::to_string(&ClassqAction::Plan).expect("json"), r#""plan""#);
        assert_eq!(serde_json::to_string(&ClassqTransferMode::Copy).expect("json"), r#""copy""#);
        assert_eq!(serde_json::to_string(&ClassqExistingPolicy::Skip).expect("json"), r#""skip""#);
        assert_eq!(serde_json::to_string(&ClassqPlanStatus::Copied).expect("json"), r#""copied""#);
        assert_eq!(serde_json::to_string(&ClassqStage::Keyword).expect("json"), r#""keyword""#);
        assert_eq!(serde_json::to_string(&ClassqItemKind::File).expect("json"), r#""file""#);
    }

    #[test]
    fn field_text_clamps_towards_the_safe_choice() {
        // `interaction.ts:31`: only the exact word selects the risky value.
        assert_eq!(ClassqAction::from_field_text(" classify "), ClassqAction::Classify);
        assert_eq!(ClassqAction::from_field_text("Classify"), ClassqAction::Plan);
        assert_eq!(ClassqAction::from_field_text(""), ClassqAction::Plan);
        assert_eq!(ClassqTransferMode::from_field_text("COPY"), ClassqTransferMode::Move);
        assert_eq!(ClassqExistingPolicy::from_field_text("nope"), ClassqExistingPolicy::Merge);
    }

    #[test]
    fn skipped_is_declared_but_never_produced() {
        assert!(ClassqPlanStatus::ALL.contains(&ClassqPlanStatus::Skipped));
        assert_eq!(ClassqPlanStatus::ALL.len(), 7, "`core.ts:6` declares seven statuses");
        // Negative control for the case tables: no branch of `buildClassqPlan`/`runClassq` writes this status, so a
        // row that expected `skipped` would be asserting a state the node cannot reach. `plan_cases.rs` checks the
        // same property over every fixture it runs.
        assert_eq!(serde_json::to_string(&ClassqPlanStatus::Skipped).expect("json"), r#""skipped""#);
    }

    #[test]
    fn camel_case_is_the_record_spelling() {
        let item = ClassqDirEntry::directory("already", "/root/already");
        assert_eq!(
            serde_json::to_string(&item).expect("json"),
            r#"{"name":"already","path":"/root/already","isFile":false,"isDirectory":true}"#
        );
    }

    #[test]
    fn an_absent_reason_is_absent_on_the_wire() {
        let item = ClassqPlanItem {
            root_path: "/root".into(),
            parent_path: "/root".into(),
            keyword_path: "/root/already".into(),
            source_path: "/root/already".into(),
            target_path: "/root/wait".into(),
            source_name: "already".into(),
            target_relative: "wait".into(),
            kind: ClassqItemKind::Folder,
            stage: ClassqStage::Keyword,
            status: ClassqPlanStatus::Found,
            reason: None,
        };
        let text = serde_json::to_string(&item).expect("json");
        assert!(!text.contains("reason"), "{text}");
    }
}
