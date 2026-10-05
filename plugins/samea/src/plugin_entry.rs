//! The JSON documents on either side of the plugin boundary, as pure Rust.
//!
//! Structure follows `plugins/timeu/src/plugin_entry.rs`: this module owns the request and response
//! *shapes* and nothing else, so they are testable without a host, and `src/plugin.rs` is the only file
//! that names Extism. The protocol is the one the React layer and the operation manager already speak
//! (ADR-0063 principles 1-3):
//!
//! ```text
//! request : { "input": { …SameaInput… }, "context": { "componentId", "workspaceId" }, "language"?: "zh"|"en" }
//! response: { "result": { "success", "message", "data" }, "events": [ …NodeRunEvent… ] }
//! ```
//!
//! A bare `SameaInput` is accepted as well, because `nodeRunRequestSchema.input` is optional and the old
//! in-process runner called `runSamea(input, runtime, onEvent)` with the input directly
//! (`core.ts:99`).
//!
//! The two extra exports are the ones the published definition names: `previewExport: "preview"` and
//! `resultExport: "result_view"` (`node-definitions/samea.json:399-400`), implemented from
//! `interaction.ts:45` and `interaction.ts:48`. They are pure — neither touches the filesystem — so a face
//! can call them on every keystroke.
//!
//! Nothing here catches a panicking host call: a refusal from `xiranite.operation.checkpoint` arrives as a
//! `Cancelled` answer and becomes the failure result `core.ts:123`'s `catch` produced for any thrown error.

use serde_json::{Value, json};

use crate::contract::{SAMEA_NODE_ID, SameaRunEvent, SameaRunResult};
use crate::definition::{
    SameaLanguage, danger_prompt, preview_lines, result_view, validate_action,
};
use crate::fs_surface::{SameaEventSink, SameaFileSystem, SameaRunControl};
use crate::input::{normalize_samea_input, SameaInputError};
use crate::node_metadata::{samea_node_description, samea_node_help};
use crate::run::run_samea;

/// The `[backend] entry_point` in `manifest.toml`: one SameA operation, JSON in and JSON out.
pub const SAMEA_RUN_ENTRY_POINT: &str = "samea_run";
/// The export named by `previewExport` (`node-definitions/samea.json:399`).
pub const SAMEA_PREVIEW_ENTRY_POINT: &str = "preview";
/// The export named by `resultExport` (`node-definitions/samea.json:400`).
pub const SAMEA_RESULT_ENTRY_POINT: &str = "result_view";
/// The pure defaulting rule, for a host that wants to preview or persist what the node resolved.
pub const SAMEA_NORMALIZE_ENTRY_POINT: &str = "normalizeInput";
/// The self-description export.
pub const SAMEA_DESCRIBE_ENTRY_POINT: &str = "describe";
/// Every export this module answers for, in the order `describe` lists them.
pub const SAMEA_ENTRY_POINTS: [&str; 5] = [
    SAMEA_RUN_ENTRY_POINT,
    SAMEA_PREVIEW_ENTRY_POINT,
    SAMEA_RESULT_ENTRY_POINT,
    SAMEA_NORMALIZE_ENTRY_POINT,
    SAMEA_DESCRIBE_ENTRY_POINT,
];

/// The capabilities this plugin imports, which `manifest.toml` must declare exactly.
///
/// File IO is not on this list: ADR-0071 serves it through the WASI preopens the manifest's
/// `allowed_paths` grants, and the node needs no other capability — it reads no clock, spawns no command,
/// resolves no path token and holds no scheduler lease (see `docs/adr/0071-…` and
/// `plugins/timeu/src/lib.rs` for the lease argument).
pub const SAMEA_HOST_FUNCTIONS: [&str; 2] = [
    "xiranite.operation.checkpoint",
    "xiranite.operation.emit",
];

/// Collects the events that go into `nodeRunResponseSchema.events` while still forwarding each one to the
/// live stream, so the operation keeps its "events are durable in history" behaviour
/// (`xiranite.operation.emit`) and the response stays self-contained.
pub struct ForwardingSameaEventSink<'stream> {
    stream: &'stream mut dyn SameaEventSink,
    collected: Vec<SameaRunEvent>,
}

impl<'stream> ForwardingSameaEventSink<'stream> {
    #[must_use]
    pub fn new(stream: &'stream mut dyn SameaEventSink) -> Self {
        Self { stream, collected: Vec::new() }
    }

    #[must_use]
    pub fn into_events(self) -> Vec<SameaRunEvent> {
        self.collected
    }
}

impl SameaEventSink for ForwardingSameaEventSink<'_> {
    fn on_event(&mut self, event: SameaRunEvent) {
        self.collected.push(event.clone());
        self.stream.on_event(event);
    }
}

/// The `input` document of a request, tolerating a request that already unwrapped it.
///
/// `context` is read but not used: SameA has no workspace or component state, which is why its data lives
/// entirely in the caller's paths.
#[must_use]
pub fn samea_input_value_of(request: &Value) -> &Value {
    match request.get("input") {
        Some(input) => input,
        None => request,
    }
}

/// The `"language"` a preview or danger prompt should render in; `interaction.ts:18` defaults to `zh`.
#[must_use]
pub fn samea_language_of(request: &Value) -> SameaLanguage {
    let raw = request
        .get("language")
        .or_else(|| request.get("context").and_then(|context| context.get("language")))
        .and_then(Value::as_str)
        .unwrap_or("zh");
    SameaLanguage::from(raw)
}

/// `run` for an already parsed request. The returned document is a full `nodeRunResponseSchema`, including
/// when the run failed: the operation protocol never carries a SameA failure as a plugin error.
pub fn run_samea_request(
    request: &Value,
    file_system: &mut dyn SameaFileSystem,
    stream: &mut dyn SameaEventSink,
    control: &mut dyn SameaRunControl,
) -> Value {
    let mut sink = ForwardingSameaEventSink::new(stream);
    let result = run_samea(samea_input_value_of(request), file_system, &mut sink, control);
    let events = sink.into_events();
    response_document(&result, &events)
}

/// `run` for the raw request text, which is what the exported function receives. Unparseable or non-UTF-8
/// input becomes a failure result rather than a trap, so the UI shows a message instead of an Extism error,
/// and the answer keeps the full `nodeRunResponseSchema` shape with an empty event list.
pub fn run_samea_request_text(
    text: &str,
    file_system: &mut dyn SameaFileSystem,
    stream: &mut dyn SameaEventSink,
    control: &mut dyn SameaRunControl,
) -> String {
    match serde_json::from_str::<Value>(text) {
        Ok(request) => run_samea_request(&request, file_system, stream, control).to_string(),
        Err(error) => json!({
            "result": {
                "success": false,
                "message": format!("SameA request was not valid JSON: {error}"),
            },
            "events": [],
        })
        .to_string(),
    }
}

/// `normalizeInput`: the pure defaulting rule of `core.ts:80-97`, no filesystem access at all.
#[must_use]
pub fn normalize_samea_request_text(text: &str) -> String {
    match serde_json::from_str::<Value>(text) {
        Ok(request) => match normalize_samea_input(samea_input_value_of(&request)) {
            Ok(normalized) => {
                let violation = samea_field_violation(samea_input_value_of(&request));
                json!({ "normalized": normalized.to_json(), "violation": violation }).to_string()
            }
            Err(error) => json!({ "error": input_error_text(&error) }).to_string(),
        },
        Err(error) => json!({ "error": format!("SameA request was not valid JSON: {error}") }).to_string(),
    }
}

/// `preview`: the two summary lines `interaction.ts:45` builds, plus the normalized input.
#[must_use]
pub fn preview_samea_request_text(text: &str) -> String {
    match serde_json::from_str::<Value>(text) {
        Ok(request) => {
            let language = samea_language_of(&request);
            match normalize_samea_input(samea_input_value_of(&request)) {
                Ok(normalized) => json!({
                    "preview": preview_lines(&normalized, language),
                    "input": normalized.to_json(),
                    "violation": samea_field_violation(samea_input_value_of(&request)),
                })
                .to_string(),
                Err(error) => json!({ "error": input_error_text(&error) }).to_string(),
            }
        }
        Err(error) => json!({ "error": format!("SameA request was not valid JSON: {error}") }).to_string(),
    }
}

/// `result_view`: `{ success, message, lines }` from `interaction.ts:48`, accepting either a bare result
/// document or one wrapped the way `run` answers.
#[must_use]
pub fn result_view_request_text(text: &str) -> String {
    let parsed: Value = match serde_json::from_str(text) {
        Ok(parsed) => parsed,
        Err(error) => {
            return json!({ "error": format!("SameA result was not valid JSON: {error}") }).to_string();
        }
    };
    let candidate = parsed.get("result").unwrap_or(&parsed);
    match serde_json::from_value::<SameaRunResult>(candidate.clone()) {
        Ok(result) => result_view(&result).to_string(),
        Err(error) => json!({ "error": format!("SameA result did not match NodeRunResult: {error}") })
            .to_string(),
    }
}

/// `danger`: whether the resolved input must pass a confirmation, and what the prompt says.
///
/// `node-definitions/samea.json:363-398` publishes the same gate as data; this is the executable half that
/// the three faces call instead of re-deciding (`danger` is not declared as a `pluginExport`, so a host may
/// evaluate the JSON itself — both readings must agree, which `tests/definition_contract.rs` checks).
#[must_use]
pub fn danger_samea_request_text(text: &str) -> String {
    let parsed: Value = match serde_json::from_str(text) {
        Ok(parsed) => parsed,
        Err(error) => {
            return json!({ "error": format!("SameA request was not valid JSON: {error}") }).to_string();
        }
    };
    let language = samea_language_of(&parsed);
    match normalize_samea_input(samea_input_value_of(&parsed)) {
        Ok(normalized) => json!({
            "dangerous": crate::definition::is_dangerous(&normalized.action, normalized.dry_run),
            "prompt": danger_prompt(language),
        })
        .to_string(),
        Err(error) => json!({ "error": input_error_text(&error) }).to_string(),
    }
}

/// `describe`: the registry `def`, the help block, the entry points and the capability surface.
#[must_use]
pub fn describe_samea_plugin() -> Value {
    json!({
        "id": SAMEA_NODE_ID,
        "description": samea_node_description(),
        "help": samea_node_help(),
        "entryPoints": SAMEA_ENTRY_POINTS.to_vec(),
        "hostFunctions": SAMEA_HOST_FUNCTIONS.iter().map(|name| json!(name)).collect::<Vec<Value>>(),
        "actions": ["plan", "classify"],
    })
}

/// The result document `run_samea_request` embeds, exposed so a caller that only needs the result (a future
/// CLI host) can reach it.
#[must_use]
pub fn samea_result_of_run_response(response: &Value) -> Option<&Value> {
    response.get("result")
}

fn response_document(result: &SameaRunResult, events: &[SameaRunEvent]) -> Value {
    json!({
        "result": serde_json::to_value(result).expect("SameaRunResult is serializable by construction"),
        "events": events.iter().map(|event| serde_json::to_value(event).expect("SameaRunEvent is serializable")).collect::<Vec<Value>>(),
    })
}

/// The declared field rules that a raw request can still violate (`node-definitions/samea.json:69-75`,
/// `:97-104`, `:151-157`). Normalization clamps `minOccurrences` and defaults `action`, so the only rule
/// worth reporting back is the one the caller can actually fix: `action` outside the declared options, or
/// no root line at all.
fn samea_field_violation(input: &Value) -> Option<String> {
    let action = input.get("action").and_then(Value::as_str);
    if let Some(action) = action {
        if let Err(violation) = validate_action(action) {
            return Some(violation);
        }
    }
    let roots = input
        .get("paths")
        .and_then(Value::as_array)
        .map(|items| !items.is_empty())
        .unwrap_or(false)
        || input
            .get("path")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty());
    if roots { None } else { Some("pathsText needs at least 1 line(s)".to_string()) }
}

fn input_error_text(error: &SameaInputError) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fs_surface::{ContinueThroughRunControl, NoopEventSink};
    use crate::memory_fs::MemoryFileSystem;

    #[test]
    fn a_wrapped_request_and_a_bare_input_produce_the_same_run() {
        let mut tree = MemoryFileSystem::new()
            .with_directory("/archive", &[("[Artist] one.zip", false), ("[Artist] two.zip", false)]);
        let input = json!({ "action": "plan", "paths": ["/archive"] });

        let mut wrapped_stream = crate::fs_surface::CollectingEventSink::new();
        let wrapped = run_samea_request(
            &json!({ "input": input.clone(), "context": { "componentId": "card-1", "workspaceId": "ws-1" } }),
            &mut tree,
            &mut wrapped_stream,
            &mut ContinueThroughRunControl,
        );

        let mut bare_stream = crate::fs_surface::CollectingEventSink::new();
        let mut bare_tree = MemoryFileSystem::new()
            .with_directory("/archive", &[("[Artist] one.zip", false), ("[Artist] two.zip", false)]);
        let bare = run_samea_request(&input, &mut bare_tree, &mut bare_stream, &mut ContinueThroughRunControl);

        assert_eq!(wrapped, bare, "nodeRunRequestSchema.input is optional");
        assert_eq!(wrapped["result"]["success"], json!(true));
        assert_eq!(wrapped["result"]["message"], json!("SameA planned 2 archive transfer(s)."));
        assert_eq!(
            wrapped["events"],
            json!([{ "type": "progress", "progress": 15, "message": "Scanning SameA archive roots." }]),
            "a plan-only run emits the scanning event and nothing else (`core.ts:103`, `core.ts:106`)"
        );
    }

    #[test]
    fn malformed_request_text_answers_with_a_failure_result_document() {
        let mut tree = MemoryFileSystem::new();
        let mut stream = NoopEventSink;
        let answered = run_samea_request_text("{ not json", &mut tree, &mut stream, &mut ContinueThroughRunControl);
        let value: Value = serde_json::from_str(&answered).expect("json answer");

        assert_eq!(value["events"].as_array().expect("events").len(), 0);
        assert_eq!(value["result"]["success"], json!(false));
        assert!(
            value["result"]["message"].as_str().expect("message")
                .starts_with("SameA request was not valid JSON:"),
            "{answered}"
        );
    }

    #[test]
    fn normalize_input_answers_with_defaults_and_the_declared_violation() {
        let answered: Value =
            serde_json::from_str(&normalize_samea_request_text(r#"{"input":{"paths":["/a"],"minOccurrences":"7"}}"#))
                .expect("json answer");
        assert_eq!(answered["normalized"]["action"], json!("plan"));
        assert_eq!(answered["normalized"]["paths"], json!(["/a"]));
        assert_eq!(answered["normalized"]["minOccurrences"], json!(7));
        assert_eq!(answered["normalized"]["dryRun"], json!(true));
        assert_eq!(answered["violation"], json!(null));

        // Negative control: no roots at all is the rule the caller has to fix.
        let empty: Value = serde_json::from_str(&normalize_samea_request_text(r#"{"paths":[]}"#)).expect("json");
        assert_eq!(empty["violation"], json!("pathsText needs at least 1 line(s)"));

        let rejected: Value =
            serde_json::from_str(&normalize_samea_request_text(r#"{"paths":{"a":1}}"#)).expect("json");
        assert!(rejected["error"].as_str().expect("error").ends_with("is not iterable"), "{rejected}");
    }

    #[test]
    fn preview_answers_with_the_two_interaction_lines() {
        let answered: Value = serde_json::from_str(&preview_samea_request_text(
            r#"{"input":{"paths":["/a","/b"],"action":"classify"},"language":"en"}"#,
        ))
        .expect("json answer");
        assert_eq!(answered["preview"], json!(["2 archive root(s)", "classify · min 1"]));

        let zh: Value =
            serde_json::from_str(&preview_samea_request_text(r#"{"paths":["/a"]}"#)).expect("json answer");
        assert_eq!(zh["preview"][0], json!("1 个归档根目录"), "interaction.ts:18 defaults to zh");
    }

    #[test]
    fn result_view_rebuilds_the_terminal_summary() {
        let answered: Value = serde_json::from_str(&result_view_request_text(
            r#"{"result":{"success":true,"message":"SameA organized 3 archive(s).","data":{"scannedCount":4,"readyCount":3,"movedCount":3,"errorCount":0}}}"#,
        ))
        .expect("json answer");
        assert_eq!(answered["lines"], json!(["Scanned: 4", "Ready: 3", "Moved: 3", "Errors: 0"]));
        assert_eq!(answered["message"], json!("SameA organized 3 archive(s)."));

        // Negative control: a document that is not a result is reported, not guessed.
        let broken: Value =
            serde_json::from_str(&result_view_request_text(r#"{"data":42}"#)).expect("json");
        assert!(broken["error"].as_str().expect("error").contains("NodeRunResult"), "{broken}");
    }

    #[test]
    fn danger_reports_the_gate_and_the_prompt() {
        let armed: Value =
            serde_json::from_str(&danger_samea_request_text(r#"{"action":"classify","paths":["/a"],"dryRun":false}"#))
                .expect("json");
        assert_eq!(armed["dangerous"], json!(true));
        assert_eq!(armed["prompt"]["title"], json!("确认实时分类"));

        // Negative control: the same action with dryRun left at its default is not dangerous.
        let safe: Value =
            serde_json::from_str(&danger_samea_request_text(r#"{"action":"classify","paths":["/a"]}"#)).expect("json");
        assert_eq!(safe["dangerous"], json!(false));
    }

    #[test]
    fn describe_lists_the_def_help_and_the_two_capabilities() {
        let described = describe_samea_plugin();
        assert_eq!(described["id"], json!("samea"));
        assert_eq!(described["description"]["icon"], json!("ScanSearch"));
        assert_eq!(described["help"]["safety"]["defaultMode"], json!("dry-run"));
        assert_eq!(described["entryPoints"][0], json!(SAMEA_RUN_ENTRY_POINT));
        assert_eq!(
            described["hostFunctions"].as_array().expect("array").len(),
            SAMEA_HOST_FUNCTIONS.len()
        );
        assert!(
            described["hostFunctions"].as_array().expect("array").contains(&json!("xiranite.operation.checkpoint")),
            "ADR-0066 requires the checkpoint, and it is the only reason this node needs a host call at all"
        );
    }
}
