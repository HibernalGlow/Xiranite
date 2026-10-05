//! The JSON documents on either side of the plugin boundary, as pure Rust.
//!
//! Structurally this is `plugins/timeu/src/plugin_entry.rs`: one module that turns a request document into a response
//! document without ever naming Extism, so the whole border is unit-testable with no host and no wasm. Only
//! `src/wasm_plugin.rs` knows about blocks and imports.
//!
//! The pair follows the protocol the React layer and the operation manager already speak
//! (`packages/shared/src/index.ts:140-151`):
//!
//! ```text
//! request : { "input": { …ClassqInput… }, "context": { "componentId", "workspaceId" }, "runOptions": {…} }
//! response: { "result": { "success", "message", "data" }, "events": [ …NodeRunEvent… ] }
//! ```
//!
//! A bare `ClassqInput` is accepted as well, because `nodeRunRequestSchema.input` is optional and the old in-process
//! runner called `runClassq(input, runtime, onEvent)` with the input directly.
//!
//! Events are deliberately reported twice — streamed through `xiranite.operation.emit` while the run works, and
//! collected into the response document — which is what keeps the operation's history durable (`crates/xiranite-node-
//! runtime` replays them) while `nodeRunResponseSchema.events` stays satisfiable for a caller that only has the
//! reply. `crates/xiranite-plugin-api/src/invocation.rs:5-9` documents the other half of that rule: a host may not
//! *wait* for the response to learn about progress, because the same call may be sitting in a paused checkpoint.
//!
//! The `preview` and `result_view` exports are separate documents, not part of the run pair: they are the
//! `previewExport`/`resultExport` names the published definition declares, and both are pure functions of their input
//! (`interaction.ts:25` and `:28`), so neither touches the filesystem.

use serde_json::{Value, json};

use crate::contract::{ClassqRunEvent, ClassqRunResult};
use crate::input_normalization::{ClassqInput, NormalizedClassqInput, normalize_classq_input};
use crate::interaction_rules::{ClassqLanguage, classq_preview, classq_result_view};
use crate::run::{failure_classq_result, run_classq};
use crate::runtime::{ClassqEventSink, ClassqFileSystem, ClassqRunControl};

/// The exported function the host calls for one ClassQ operation.
pub const CLASSQ_RUN_ENTRY_POINT: &str = "classq_run";
/// The exported function that answers with the normalized input and no host work at all.
pub const CLASSQ_NORMALIZE_ENTRY_POINT: &str = "classq_normalize_input";
/// The exported function that answers with the node description and the host surface.
pub const CLASSQ_DESCRIBE_ENTRY_POINT: &str = "classq_describe";
/// The `previewExport` name in `node-definitions/classq.json`: `preview(input) => string[]`.
pub const CLASSQ_PREVIEW_ENTRY_POINT: &str = "preview";
/// The `resultExport` name in `node-definitions/classq.json`: `result(result) => {…}`.
pub const CLASSQ_RESULT_VIEW_ENTRY_POINT: &str = "result_view";

/// Every exported entry point, in the order `describe` reports them.
pub const CLASSQ_ENTRY_POINTS: [&str; 5] = [
    CLASSQ_RUN_ENTRY_POINT,
    CLASSQ_NORMALIZE_ENTRY_POINT,
    CLASSQ_DESCRIBE_ENTRY_POINT,
    CLASSQ_PREVIEW_ENTRY_POINT,
    CLASSQ_RESULT_VIEW_ENTRY_POINT,
];

/// The capabilities this plugin calls, and the only ones `manifest.toml` may declare.
///
/// ADR-0071 closed the vocabulary at nine names; ClassQ uses two of them. File IO is `std::fs` over the granted
/// preopens, so it appears nowhere here — and `xiranite.now` is absent because the node has no clock in its output,
/// `xiranite.process.run` because it spawns nothing.
pub const CLASSQ_HOST_FUNCTIONS: [&str; 2] = ["xiranite.operation.checkpoint", "xiranite.operation.emit"];

/// The registry `def` (`packages/nodes/classq/src/index.ts:4-12`), which the Rust registry reads from `describe`.
#[must_use]
pub fn classq_node_description() -> Value {
    json!({
        "id": "classq",
        "name": "ClassQ",
        "version": "0.1.0",
        "category": "file",
        "description": "Find keyword folders and plan sibling items into wait folders.",
    })
}

/// Collects the events that go into `nodeRunResponseSchema.events` while still forwarding each one to the live
/// stream, so the response stays self-contained without duplicating the emit path.
pub struct ForwardingClassqEventSink<'stream> {
    stream: &'stream mut dyn ClassqEventSink,
    collected: Vec<ClassqRunEvent>,
}

impl<'stream> ForwardingClassqEventSink<'stream> {
    /// Wraps a live stream.
    pub fn new(stream: &'stream mut dyn ClassqEventSink) -> Self {
        Self { stream, collected: Vec::new() }
    }

    /// The events in the order they were reported.
    pub fn into_events(self) -> Vec<ClassqRunEvent> {
        self.collected
    }
}

impl ClassqEventSink for ForwardingClassqEventSink<'_> {
    fn on_event(&mut self, event: ClassqRunEvent) {
        self.collected.push(event.clone());
        self.stream.on_event(event);
    }
}

/// The `input` document of a request, tolerating a request that already unwrapped it. `context` is read but not
/// used: ClassQ keeps no workspace or component state, its whole answer is the file tree it walked.
#[must_use]
pub fn classq_input_value_of(request: &Value) -> &Value {
    match request.get("input") {
        Some(input) => input,
        None => request,
    }
}

/// The language a face asked for: `runOptions.language`, falling back to the node's own default (`interaction.ts:9`).
#[must_use]
pub fn classq_language_of(request: &Value) -> ClassqLanguage {
    request
        .get("runOptions")
        .and_then(|options| options.get("language"))
        .and_then(Value::as_str)
        .map(ClassqLanguage::from_language_tag)
        .unwrap_or_default()
}

/// The `runOptions.operationId` this run belongs to. ADR-0068 requires a capability call to name its operation, and
/// one plugin instance serves many; a host that never sends one leaves the empty string, which the host reads as
/// "the current operation" rather than as a made-up id.
#[must_use]
pub fn classq_operation_id_of(request: &Value) -> &str {
    request
        .get("runOptions")
        .and_then(|options| options.get("operationId"))
        .and_then(Value::as_str)
        .or_else(|| request.get("context").and_then(|context| context.get("operationId")).and_then(Value::as_str))
        .unwrap_or_default()
}

/// The input document as `ClassqInput`. Anything that does not decode is reported the way `core.ts:117-119`'s catch
/// did — the run fails with an unusable input rather than trapping — except for a plain string, which is the CLI
/// pipe shape (`cli.ts:43-44` reads root paths from stdin, one per line) and becomes the root list.
#[must_use]
pub fn classq_input_of_value(value: &Value) -> ClassqInput {
    serde_json::from_value::<ClassqInput>(value.clone())
        .unwrap_or_else(|_| ClassqInput { list_text: Some(text_of_value(value)), ..ClassqInput::default() })
}

/// One input document, already normalized: the typed body of the `classq_normalize_input` export.
#[must_use]
pub fn normalize_classq_input_document(input: &ClassqInput) -> NormalizedClassqInput {
    normalize_classq_input(input)
}

/// The `preview` export's answer document: `preview(input) => string[]` (`interaction.ts:25`).
#[must_use]
pub fn preview_document(normalized: &NormalizedClassqInput, language: ClassqLanguage) -> Value {
    json!({ "lines": classq_preview(normalized, language) })
}

/// `run` for one typed input. Both the JSON request path and a native host (the CLI, the TUI) go through here, so
/// there is exactly one place that decides what a run answers with.
#[must_use]
pub fn run_classq_input(
    input: &ClassqInput,
    file_system: &dyn ClassqFileSystem,
    sink: &mut dyn ClassqEventSink,
    control: &mut dyn ClassqRunControl,
) -> Value {
    let mut forwarding = ForwardingClassqEventSink::new(sink);
    let result = run_classq(input, file_system, &mut forwarding, control);
    let events = forwarding.into_events();
    json!({
        "result": serde_json::to_value(&result).unwrap_or(Value::Null),
        "events": events.iter().map(classq_event_value).collect::<Vec<Value>>(),
    })
}

/// `run` for an already parsed request. The returned document is a full `nodeRunResponseSchema`, including when the
/// run failed: the operation protocol never carries a ClassQ failure as a plugin error.
#[must_use]
pub fn run_classq_request(
    request: &Value,
    file_system: &dyn ClassqFileSystem,
    stream: &mut dyn ClassqEventSink,
    control: &mut dyn ClassqRunControl,
) -> Value {
    let input = classq_input_of_value(classq_input_value_of(request));
    run_classq_input(&input, file_system, stream, control)
}

/// `run` for the raw request text, which is what the exported function receives. Unparseable or non-UTF-8 input
/// becomes a `failure` result rather than a trap, so the UI shows a message instead of an Extism error, and the
/// answer keeps the full response shape with an empty event list.
#[must_use]
pub fn run_classq_request_text(
    text: &str,
    file_system: &dyn ClassqFileSystem,
    stream: &mut dyn ClassqEventSink,
    control: &mut dyn ClassqRunControl,
) -> String {
    match parse_request(text) {
        Ok(request) => run_classq_request(&request, file_system, stream, control).to_string(),
        Err(message) => {
            let normalized = normalize_classq_input(&ClassqInput::default());
            json!({
                "result": serde_json::to_value(failure_classq_result(&message, &normalized)).unwrap_or(Value::Null),
                "events": [],
            })
            .to_string()
        }
    }
}

/// `classq_normalize_input`: the pure defaulting rule of `core.ts:79-91` plus the definition-driven `preview` lines,
/// no filesystem and no host call.
#[must_use]
pub fn normalize_classq_request_text(text: &str) -> String {
    match parse_request(text) {
        Ok(request) => {
            let language = classq_language_of(&request);
            let normalized = normalize_classq_input(&classq_input_of_value(classq_input_value_of(&request)));
            json!({
                "normalized": serde_json::to_value(&normalized).unwrap_or(Value::Null),
                "preview": classq_preview(&normalized, language),
                "dangerous": crate::interaction_rules::is_dangerous(&normalized),
            })
            .to_string()
        }
        Err(message) => json!({ "error": message }).to_string(),
    }
}

/// `preview` (`interaction.ts:25`): the `previewExport` document, a list of strings.
#[must_use]
pub fn preview_classq_request_text(text: &str) -> String {
    match parse_request(text) {
        Ok(request) => {
            let language = classq_language_of(&request);
            let normalized = normalize_classq_input(&classq_input_of_value(classq_input_value_of(&request)));
            preview_document(&normalized, language).to_string()
        }
        Err(message) => json!({ "error": message }).to_string(),
    }
}

/// `result_view` (`interaction.ts:28`): the `resultExport` document, from a run result.
#[must_use]
pub fn result_view_request_text(text: &str) -> String {
    match serde_json::from_str::<Value>(text) {
        Ok(document) => {
            let language = classq_language_of(&document);
            let result_value = document.get("result").cloned().unwrap_or(document.clone());
            match serde_json::from_value::<ClassqRunResult>(result_value) {
                Ok(result) => {
                    serde_json::to_value(classq_result_view(&result, language)).unwrap_or(json!({ "error": "encoding failed" }))
                        .to_string()
                }
                Err(error) => json!({ "error": format!("ClassQ result was not a NodeRunResult: {error}") }).to_string(),
            }
        }
        Err(error) => json!({ "error": format!("ClassQ request was not valid JSON: {error}") }).to_string(),
    }
}

/// `classq_describe`: the registry `def`, the entry points, and the host surface the module imports.
#[must_use]
pub fn describe_classq_plugin() -> Value {
    json!({
        "description": classq_node_description(),
        "entryPoints": CLASSQ_ENTRY_POINTS.iter().map(|name| Value::String(name.to_string())).collect::<Vec<Value>>(),
        "hostFunctions": CLASSQ_HOST_FUNCTIONS.iter().map(|name| Value::String(name.to_string())).collect::<Vec<Value>>(),
        "definitionVersion": 1,
        "fileAccess": "wasi-preopens",
    })
}

/// The result document [`run_classq_request`] embeds, exposed so a caller that only needs the result (a future CLI
/// host) can reach it.
#[must_use]
pub fn classq_result_of_run_response(response: &Value) -> Option<&Value> {
    response.get("result")
}

/// One event as the protocol spells it.
fn classq_event_value(event: &ClassqRunEvent) -> Value {
    serde_json::to_value(event).unwrap_or(Value::Null)
}

/// The request document, or the message the boundary answers with.
fn parse_request(text: &str) -> Result<Value, String> {
    serde_json::from_str::<Value>(text).map_err(|error| format!("ClassQ request was not valid JSON: {error}"))
}

/// A request whose `input` was a plain string is the CLI pipe shape: that text is the root list.
fn text_of_value(value: &Value) -> String {
    value.as_str().map(str::to_owned).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::in_memory_runtime::{CollectingClassqEventSink, MemoryFileSystem, ScriptedClassqRunControl};
    use crate::runtime::{AlwaysContinueClassqRunControl, NoopClassqEventSink};

    fn fixture() -> MemoryFileSystem {
        MemoryFileSystem::new()
            .with_directory("/root", &[("already", true), ("pending.zip", false)])
            .with_directory("/root/already", &[])
    }

    #[test]
    fn a_wrapped_request_and_a_bare_input_produce_the_same_run() {
        let mut wrapped = CollectingClassqEventSink::default();
        let wrapped = run_classq_request(
            &json!({ "input": { "action": "plan", "paths": ["/root"] }, "context": { "componentId": "card-1" } }),
            &fixture(),
            &mut wrapped,
            &mut AlwaysContinueClassqRunControl::default(),
        );
        let mut bare = CollectingClassqEventSink::default();
        let bare = run_classq_request(
            &json!({ "action": "plan", "paths": ["/root"] }),
            &fixture(),
            &mut bare,
            &mut AlwaysContinueClassqRunControl::default(),
        );

        assert_eq!(wrapped, bare, "nodeRunRequestSchema.input is optional");
        assert_eq!(wrapped["result"]["success"], json!(true));
        assert_eq!(wrapped["result"]["message"], json!("ClassQ planned 2 item(s)."));
        assert_eq!(
            wrapped["events"],
            json!([{ "type": "progress", "progress": 20.0, "message": "Scanning keyword folders." }]),
            "the response replays the event stream the host already saw"
        );
        assert_eq!(classq_result_of_run_response(&bare), Some(&bare["result"]));
    }

    #[test]
    fn streaming_and_collected_events_are_the_same_events_in_the_same_order() {
        let mut stream = CollectingClassqEventSink::default();
        let response = run_classq_request(
            &json!({ "input": { "action": "classify", "paths": ["/root"], "dryRun": false } }),
            &fixture(),
            &mut stream,
            &mut AlwaysContinueClassqRunControl::default(),
        );
        let streamed: Vec<Value> = stream.events.iter().map(classq_event_value).collect();
        assert_eq!(response["events"], Value::Array(streamed));
        assert_eq!(response["events"].as_array().expect("array").len(), 2, "scan then apply");
        assert_eq!(response["events"][1]["progress"], json!(70.0));
        assert_eq!(response["result"]["data"]["movedCount"], json!(1));
    }

    #[test]
    fn malformed_request_text_answers_with_a_failure_result_document() {
        let answered = run_classq_request_text(
            "{ not json",
            &fixture(),
            &mut NoopClassqEventSink,
            &mut AlwaysContinueClassqRunControl::default(),
        );
        let value: Value = serde_json::from_str(&answered).expect("json answer");

        assert_eq!(value["events"].as_array().expect("events").len(), 0);
        assert_eq!(value["result"]["success"], json!(false));
        assert!(
            value["result"]["message"].as_str().expect("message").starts_with("ClassQ request was not valid JSON:"),
            "{answered}"
        );
    }

    #[test]
    fn an_undeodable_input_document_fails_the_run_instead_of_trapping() {
        let answered = run_classq_request_text(
            r#"{"input":{"paths":{"a":1}}}"#,
            &fixture(),
            &mut NoopClassqEventSink,
            &mut ScriptedClassqRunControl::continuing(),
        );
        let value: Value = serde_json::from_str(&answered).expect("json answer");
        assert_eq!(value["result"]["success"], json!(false));
        assert_eq!(value["result"]["message"], json!(crate::run::CLASSQ_NO_ROOTS_MESSAGE));
    }

    #[test]
    fn normalize_input_answers_with_the_defaulted_document_and_preview() {
        let answered: Value =
            serde_json::from_str(&normalize_classq_request_text(r#"{"input":{"listText":"/a\n/b"}}"#)).expect("json");
        assert_eq!(answered["normalized"]["action"], json!("plan"));
        assert_eq!(answered["normalized"]["paths"], json!(["/a", "/b"]));
        assert_eq!(answered["normalized"]["keyword"], json!("already"));
        assert_eq!(answered["normalized"]["dryRun"], json!(true));
        assert_eq!(answered["preview"][0], json!("规则: already → wait"));
        assert_eq!(answered["dangerous"], json!(false));

        let rejected: Value = serde_json::from_str(&normalize_classq_request_text("{ oops")).expect("json");
        assert!(rejected["error"].as_str().expect("error").starts_with("ClassQ request was not valid JSON:"));
    }

    #[test]
    fn the_two_definition_exports_answer_from_documents_alone() {
        let preview: Value =
            serde_json::from_str(&preview_classq_request_text(
                r#"{"input":{"paths":"/a;/b","dryRun":false,"action":"classify"},"runOptions":{"language":"en"}}"#,
            ))
            .expect("json");
        assert_eq!(preview["lines"], json!(["Rule: already → wait", "Roots: 2", "Live transfer"]));

        let view: Value = serde_json::from_str(&result_view_request_text(
            r#"{"result":{"success":true,"message":"ClassQ planned 3 item(s).","data":{"keywordCount":2,"readyCount":1,"conflictCount":0}}}"#,
        ))
        .expect("json");
        assert_eq!(view["lines"], json!(["关键词命中: 2", "就绪: 1", "冲突: 0"]));
        assert_eq!(view["success"], json!(true));

        // Negative control: a result document with no `data` produces no lines, exactly like `interaction.ts:28`.
        let empty: Value =
            serde_json::from_str(&result_view_request_text(r#"{"result":{"success":false,"message":"boom"}}"#))
                .expect("json");
        assert_eq!(empty["lines"], json!([]));
    }

    #[test]
    fn describe_lists_the_registry_def_and_the_imported_host_surface() {
        let described = describe_classq_plugin();
        assert_eq!(described["description"]["id"], json!("classq"));
        assert_eq!(described["description"]["category"], json!("file"));
        assert_eq!(described["entryPoints"][0], json!(CLASSQ_RUN_ENTRY_POINT));
        assert_eq!(
            described["hostFunctions"].as_array().expect("array").len(),
            CLASSQ_HOST_FUNCTIONS.len(),
            "one list, one producer"
        );
        // Negative control: no file capability may appear in the surface ADR-0071 retired.
        for name in CLASSQ_HOST_FUNCTIONS {
            assert!(!name.starts_with("xiranite.fs."), "{name} is a retired capability name");
        }
    }

    #[test]
    fn a_string_request_is_read_as_the_cli_pipe_root_list() {
        let answered = run_classq_request_text(
            r#""/root""#,
            &fixture(),
            &mut NoopClassqEventSink,
            &mut AlwaysContinueClassqRunControl::default(),
        );
        let value: Value = serde_json::from_str(&answered).expect("json");
        assert_eq!(value["result"]["data"]["rootCount"], json!(1));
        assert_eq!(value["result"]["message"], json!("ClassQ planned 2 item(s)."));
    }
}
