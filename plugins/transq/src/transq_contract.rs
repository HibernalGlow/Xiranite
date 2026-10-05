//! TransQ's domain vocabulary and wire contract.
//!
//! Field names, string messages and object key order mirror
//! `packages/nodes/transq/src/core.ts` because the React card
//! (`src/nodes/transq/Component.tsx`, `controls.tsx`) and the HTTP/Operation
//! payload are preserved verbatim (ADR-0063 principles 1 and 3). Anything the UI
//! reads has to keep arriving under the same camelCase key.

use crate::json_document::JsonValue;
use crate::json_text::JsonWriter;

/// `TransqAction` (`core.ts:3`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransqAction {
    Status,
    Plan,
    Run,
}

impl TransqAction {
    pub const DEFAULT: TransqAction = TransqAction::Status;

    pub fn as_str(self) -> &'static str {
        match self {
            TransqAction::Status => "status",
            TransqAction::Plan => "plan",
            TransqAction::Run => "run",
        }
    }

    pub fn parse(value: &str) -> Option<TransqAction> {
        match value {
            "status" => Some(TransqAction::Status),
            "plan" => Some(TransqAction::Plan),
            "run" => Some(TransqAction::Run),
            _ => None,
        }
    }
}

/// `TransqQueueStatus` (`core.ts:4`), the lane a queue item is rendered in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransqQueueStatus {
    Pending,
    Ready,
    Output,
    Conflict,
    Missing,
}

impl TransqQueueStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            TransqQueueStatus::Pending => "pending",
            TransqQueueStatus::Ready => "ready",
            TransqQueueStatus::Output => "output",
            TransqQueueStatus::Conflict => "conflict",
            TransqQueueStatus::Missing => "missing",
        }
    }
}

/// `TransqInput` (`core.ts:6-11`). `preview` stays optional so the TypeScript
/// rule `action === "plan" || input.preview !== false` (`core.ts:145`) ports
/// exactly: an absent field means preview.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TransqInput {
    pub action: Option<TransqAction>,
    pub paths: Vec<String>,
    pub preview: Option<bool>,
}

impl TransqInput {
    /// Decodes the node-runner JSON body. Unknown fields are ignored, matching the
    /// structural typing the TypeScript core has always had; an unreadable body or
    /// a non-string action is a hard request error rather than a silent `status`.
    pub fn from_json_str(source: &str) -> Result<TransqInput, String> {
        let document = crate::json_document::parse_json(source).map_err(|error| error.to_string())?;
        if !matches!(document, JsonValue::Object(_)) {
            return Err("TransQ input must be a JSON object".to_string());
        }
        let action = match document.get("action") {
            None => None,
            Some(value) => match value.as_str().and_then(TransqAction::parse) {
                Some(action) => Some(action),
                None => return Err(format!("unknown TransQ action: {:?}", value.as_str())),
            },
        };
        let paths = match document.get("paths") {
            Some(JsonValue::Array(values)) => values
                .iter()
                .filter_map(JsonValue::as_str)
                .map(|path| path.to_string())
                .collect(),
            Some(_) => return Err("TransQ paths must be an array of strings".to_string()),
            None => Vec::new(),
        };
        Ok(TransqInput { action, paths, preview: document.get("preview").and_then(JsonValue::as_bool) })
    }

    pub fn resolved_action(&self) -> TransqAction {
        self.action.unwrap_or(TransqAction::DEFAULT)
    }
}

/// `TransqDirectorySnapshot` (`core.ts:13-22`): one discovered
/// `original_images` workspace, as the host's directory facts describe it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransqDirectorySnapshot {
    pub original_images_path: String,
    pub result_path: String,
    pub output_path: String,
    pub output_exists: bool,
    pub original_files: Vec<String>,
    pub result_files: Vec<String>,
    pub mapped_files: Vec<String>,
    pub cleanup_paths: Vec<String>,
}

/// `TransqCopyOperation` (`core.ts:24-28`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransqCopyOperation {
    pub source_path: String,
    pub destination_path: String,
    pub filename: String,
}

/// `TransqQueueItem` (`core.ts:30-43`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransqQueueItem {
    pub id: String,
    pub original_images_path: String,
    pub result_path: String,
    pub output_path: String,
    pub status: TransqQueueStatus,
    pub original_count: usize,
    pub result_count: usize,
    pub missing_files: Vec<String>,
    pub extra_files: Vec<String>,
    pub copies: Vec<TransqCopyOperation>,
    pub cleanup_paths: Vec<String>,
    pub errors: Vec<String>,
}

/// `TransqData` (`core.ts:45-55`), the card's whole result payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransqData {
    pub items: Vec<TransqQueueItem>,
    pub pending_count: usize,
    pub ready_count: usize,
    pub output_count: usize,
    pub conflict_count: usize,
    pub copied_files: usize,
    pub deleted_originals: usize,
    pub deleted_work_items: usize,
    pub errors: Vec<String>,
}

impl TransqData {
    /// `emptyData()` (`core.ts:219-231`).
    pub fn empty() -> TransqData {
        TransqData {
            items: Vec::new(),
            pending_count: 0,
            ready_count: 0,
            output_count: 0,
            conflict_count: 0,
            copied_files: 0,
            deleted_originals: 0,
            deleted_work_items: 0,
            errors: Vec::new(),
        }
    }

    pub fn write_json(&self, writer: &mut JsonWriter) {
        writer.begin_object();
        writer.key("items");
        writer.begin_array();
        for item in &self.items {
            item.write_json(writer);
        }
        writer.end_array();
        writer.key("pendingCount");
        writer.value_usize(self.pending_count);
        writer.key("readyCount");
        writer.value_usize(self.ready_count);
        writer.key("outputCount");
        writer.value_usize(self.output_count);
        writer.key("conflictCount");
        writer.value_usize(self.conflict_count);
        writer.key("copiedFiles");
        writer.value_usize(self.copied_files);
        writer.key("deletedOriginals");
        writer.value_usize(self.deleted_originals);
        writer.key("deletedWorkItems");
        writer.value_usize(self.deleted_work_items);
        writer.key("errors");
        writer.begin_array();
        for error in &self.errors {
            writer.value_str(error);
        }
        writer.end_array();
        writer.end_object();
    }

    pub fn to_json_string(&self) -> String {
        let mut writer = JsonWriter::new();
        self.write_json(&mut writer);
        writer.string()
    }
}

impl TransqQueueItem {
    pub fn write_json(&self, writer: &mut JsonWriter) {
        writer.begin_object();
        writer.key("id");
        writer.value_str(&self.id);
        writer.key("originalImagesPath");
        writer.value_str(&self.original_images_path);
        writer.key("resultPath");
        writer.value_str(&self.result_path);
        writer.key("outputPath");
        writer.value_str(&self.output_path);
        writer.key("status");
        writer.value_str(self.status.as_str());
        writer.key("originalCount");
        writer.value_usize(self.original_count);
        writer.key("resultCount");
        writer.value_usize(self.result_count);
        writer.key("missingFiles");
        write_string_array(writer, &self.missing_files);
        writer.key("extraFiles");
        write_string_array(writer, &self.extra_files);
        writer.key("copies");
        writer.begin_array();
        for copy in &self.copies {
            copy.write_json(writer);
        }
        writer.end_array();
        writer.key("cleanupPaths");
        write_string_array(writer, &self.cleanup_paths);
        writer.key("errors");
        write_string_array(writer, &self.errors);
        writer.end_object();
    }
}

impl TransqCopyOperation {
    pub fn write_json(&self, writer: &mut JsonWriter) {
        writer.begin_object();
        writer.key("sourcePath");
        writer.value_str(&self.source_path);
        writer.key("destinationPath");
        writer.value_str(&self.destination_path);
        writer.key("filename");
        writer.value_str(&self.filename);
        writer.end_object();
    }
}

/// `NodeRunEvent` (`packages/shared/src/index.ts:91-98`). TransQ only ever emits
/// `progress` events, but `log` stays in the model so the host can pass through
/// whatever the operation manager already accepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransqRunEventKind {
    Progress,
    Log,
}

impl TransqRunEventKind {
    pub fn as_str(self) -> &'static str {
        match self {
            TransqRunEventKind::Progress => "progress",
            TransqRunEventKind::Log => "log",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransqRunEvent {
    pub kind: TransqRunEventKind,
    pub progress: Option<usize>,
    pub message: String,
}

impl TransqRunEvent {
    pub fn progress(percent: usize, message: impl Into<String>) -> TransqRunEvent {
        TransqRunEvent { kind: TransqRunEventKind::Progress, progress: Some(percent), message: message.into() }
    }

    pub fn to_json_string(&self) -> String {
        let mut writer = JsonWriter::new();
        writer.begin_object();
        writer.key("type");
        writer.value_str(self.kind.as_str());
        if let Some(progress) = self.progress {
            writer.key("progress");
            writer.value_usize(progress);
        }
        writer.key("message");
        writer.value_str(&self.message);
        writer.end_object();
        writer.string()
    }
}

/// `NodeRunResultDTO` (`packages/shared/src/index.ts:363-369`). `stats` and
/// `outputPath` stay absent because `runTransq` never filled them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransqRunResult {
    pub success: bool,
    pub message: String,
    pub data: TransqData,
}

impl TransqRunResult {
    pub fn to_json_string(&self) -> String {
        let mut writer = JsonWriter::new();
        writer.begin_object();
        writer.key("success");
        writer.value_bool(self.success);
        writer.key("message");
        writer.value_str(&self.message);
        writer.key("data");
        self.data.write_json(&mut writer);
        writer.end_object();
        writer.string()
    }
}

/// The `NodeDef` from `index.ts:4-12`, kept here so the host registry and the
/// plugin agree on one identity without a second generator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TransqNodeDefinition {
    pub id: &'static str,
    pub name: &'static str,
    pub version: &'static str,
    pub category: &'static str,
    pub description: &'static str,
    pub icon: &'static str,
    pub keywords: &'static [&'static str],
}

pub const NODE_DEFINITION: TransqNodeDefinition = TransqNodeDefinition {
    id: "transq",
    name: "TransQ",
    version: "0.1.0",
    category: "text",
    description: "Organize manga-translator result queues with native filesystem operations.",
    icon: "Languages",
    keywords: &["translation", "manga-translator", "organize", "queue"],
};

impl TransqNodeDefinition {
    pub fn to_json_string(&self) -> String {
        let mut writer = JsonWriter::new();
        writer.begin_object();
        writer.key("id");
        writer.value_str(self.id);
        writer.key("name");
        writer.value_str(self.name);
        writer.key("version");
        writer.value_str(self.version);
        writer.key("category");
        writer.value_str(self.category);
        writer.key("description");
        writer.value_str(self.description);
        writer.key("icon");
        writer.value_str(self.icon);
        writer.key("keywords");
        writer.begin_array();
        for keyword in self.keywords {
            writer.value_str(keyword);
        }
        writer.end_array();
        writer.end_object();
        writer.string()
    }
}

fn write_string_array(writer: &mut JsonWriter, values: &[String]) {
    writer.begin_array();
    for value in values {
        writer.value_str(value);
    }
    writer.end_array();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_defaults_to_the_status_action() {
        let parsed = TransqInput::from_json_str("{}").expect("empty input");
        assert_eq!(parsed.resolved_action(), TransqAction::Status);
        assert_eq!(parsed.preview, None);
    }

    #[test]
    fn input_reads_the_documented_fields() {
        let parsed =
            TransqInput::from_json_str(r#"{"action":"run","paths":["D:/a"],"preview":false,"extra":1}"#)
                .expect("input");
        assert_eq!(parsed.resolved_action(), TransqAction::Run);
        assert_eq!(parsed.paths, vec!["D:/a".to_string()]);
        assert_eq!(parsed.preview, Some(false));
    }

    #[test]
    fn input_rejects_unknown_actions_and_non_array_paths() {
        assert!(TransqInput::from_json_str(r#"{"action":"destroy"}"#).is_err());
        assert!(TransqInput::from_json_str(r#"{"paths":"D:/a"}"#).is_err());
        assert!(TransqInput::from_json_str("[]").is_err());
    }

    #[test]
    fn result_payload_keeps_the_typescript_field_names() {
        let mut data = TransqData::empty();
        data.items.push(TransqQueueItem {
            id: "D:/c/original_images".to_string(),
            original_images_path: "D:/c/original_images".to_string(),
            result_path: "D:/c/original_images/manga_translator_work/result".to_string(),
            output_path: "D:/c/result".to_string(),
            status: TransqQueueStatus::Pending,
            original_count: 2,
            result_count: 1,
            missing_files: vec!["002.png".to_string()],
            extra_files: Vec::new(),
            copies: vec![TransqCopyOperation {
                source_path: "D:/c/original_images/002.png".to_string(),
                destination_path: "D:/c/original_images/manga_translator_work/result/002.png".to_string(),
                filename: "002.png".to_string(),
            }],
            cleanup_paths: vec!["D:/c/original_images/manga_translator_work/inpainted".to_string()],
            errors: Vec::new(),
        });
        data.pending_count = 1;

        let json = TransqRunResult { success: true, message: "done".to_string(), data }.to_json_string();
        assert!(json.starts_with(r#"{"success":true,"message":"done","data":{"items":[{"id":"D:/c/original_images""#));
        assert!(json.contains(r#""originalImagesPath":"D:/c/original_images""#));
        assert!(json.contains(r#""missingFiles":["002.png"]"#));
        assert!(json.contains(r#""copiedFiles":0,"deletedOriginals":0,"deletedWorkItems":0,"errors":[]}}"#));
    }

    #[test]
    fn progress_events_match_the_run_event_schema() {
        assert_eq!(
            TransqRunEvent::progress(10, "Scanning translation workspaces.").to_json_string(),
            r#"{"type":"progress","progress":10,"message":"Scanning translation workspaces."}"#
        );
    }
}
