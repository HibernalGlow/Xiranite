//! The JSON documents on either side of the plugin boundary, as pure Rust.
//!
//! Structure mirrors `plugins/timeu/src/plugin_entry.rs`: every entry point is a function over a
//! `serde_json::Value` plus an injected runtime and event sink, so the whole boundary is testable
//! without a host, and `src/plugin.rs` stays a shim that moves bytes. The protocol is the one the
//! React layer and the operation manager already speak —
//! `nodeRunRequestSchema` / `nodeRunResponseSchema` (`packages/shared/src/index.ts:140-151`) — and
//! the two `*Export` bindings of the published definition (`preview`, `result_view`) are entry
//! points here rather than re-implementations in a face (ADR-0069).
//!
//! ```text
//! request : { "input": { …SoundwInput… }, "context": { "componentId", "workspaceId" }, "operationId": "…" }
//! response: { "result": { "success", "message", "data" }, "events": [ …NodeRunEvent… ] }
//! ```
//!
//! A bare `SoundwInput` is accepted as well, because `nodeRunRequestSchema.input` is optional and
//! `cli.ts:203-205` called `runSoundw({ action, soundSwitchPath, profileName }, …)` directly.
//!
//! Nothing here traps: an unusable request answers with the same `failure` result document
//! `core.ts:11,19` produces, and ADR-0068's `PluginError` envelope only appears on the pure entry
//! points (`normalize_input`, `preview`, `result_view`) that have no result document to put it in.

use serde_json::Value;

use crate::host_functions::{SOUNDW_HOST_FUNCTIONS, SOUNDW_REGISTERED_COMMAND};
use crate::soundw_core::run_soundw;
use crate::soundw_input::{
    NormalizedSoundwInput, SoundwInputRejection, normalize_soundw_values,
};
use crate::soundw_model::{SoundwData, SoundwInput, SoundwRunEvent, SoundwRunResult, soundw_node_description};
use crate::soundw_runtime::{SoundwEventSink, SoundwRuntime};
use crate::soundw_view::{SoundwResultView, is_dangerous, preview, result_view};

/// The exported function the host calls for one SoundW operation.
pub const SOUNDW_RUN_ENTRY_POINT: &str = "soundw_run";
/// The export that answers with the normalized input and nothing else.
pub const SOUNDW_NORMALIZE_ENTRY_POINT: &str = "soundw_normalize_input";
/// The export behind the definition's `"previewExport": "preview"`.
pub const SOUNDW_PREVIEW_ENTRY_POINT: &str = "soundw_preview";
/// The export behind the definition's `"resultExport": "result_view"`.
pub const SOUNDW_RESULT_VIEW_ENTRY_POINT: &str = "soundw_result_view";
/// The export that answers with the node description, entry points and capability surface.
pub const SOUNDW_DESCRIBE_ENTRY_POINT: &str = "soundw_describe";

/// The logical export name the definition uses for the preview binding
/// (`node-definitions/soundw.json:271`).
pub const SOUNDW_PREVIEW_EXPORT: &str = "preview";
/// The logical export name the definition uses for the result binding
/// (`node-definitions/soundw.json:272`).
pub const SOUNDW_RESULT_VIEW_EXPORT: &str = "result_view";

/// Every export `soundw.wasm` publishes, in `src/plugin.rs` order. Names are `soundw_`-prefixed
/// because Extism resolves an export by name inside one shared isolate pool, so a bare `run` would
/// collide with every other plugin the host loads.
pub const SOUNDW_ENTRY_POINTS: [&str; 5] = [
    SOUNDW_RUN_ENTRY_POINT,
    SOUNDW_NORMALIZE_ENTRY_POINT,
    SOUNDW_PREVIEW_ENTRY_POINT,
    SOUNDW_RESULT_VIEW_ENTRY_POINT,
    SOUNDW_DESCRIBE_ENTRY_POINT,
];

/// Collects the events that go into `nodeRunResponseSchema.events` while still forwarding each one
/// to the live stream, so the operation keeps its durable-history behaviour
/// (`xiranite.operation.emit`) and the response stays self-contained.
pub struct ForwardingSoundwEventSink<'stream> {
    stream: &'stream mut dyn SoundwEventSink,
    collected: Vec<SoundwRunEvent>,
}

impl<'stream> ForwardingSoundwEventSink<'stream> {
    /// Wraps a live sink.
    #[must_use]
    pub fn new(stream: &'stream mut dyn SoundwEventSink) -> Self {
        Self { stream, collected: Vec::new() }
    }

    /// The events to embed in the response document.
    #[must_use]
    pub fn into_events(self) -> Vec<SoundwRunEvent> {
        self.collected
    }
}

impl SoundwEventSink for ForwardingSoundwEventSink<'_> {
    fn on_event(&mut self, event: SoundwRunEvent) {
        self.collected.push(event.clone());
        self.stream.on_event(event);
    }
}

/// The `input` slot of a request, tolerating a request that already unwrapped it.
#[must_use]
pub fn soundw_input_value_of(request: &Value) -> &Value {
    match request.get("input") {
        Some(input) if !input.is_null() => input,
        _ => request,
    }
}

/// The operation this call belongs to (ADR-0068: plugin lifecycle is not operation lifecycle, so
/// every capability call carries it). `context.operationId` is read too, because that is where the
/// operation manager's own document puts it.
#[must_use]
pub fn soundw_operation_id_of(request: &Value) -> String {
    request
        .get("operationId")
        .or_else(|| request.get("context").and_then(|context| context.get("operationId")))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

/// The `language` slot of a `preview` request, defaulting to Chinese the way `interaction.ts:14`
/// does (`language: TerminalLanguage = "zh"`).
#[must_use]
pub fn soundw_language_of(request: &Value) -> &str {
    match request.get("language").and_then(Value::as_str) {
        Some("en") => "en",
        _ => "zh",
    }
}

/// Reads the three declared slots of an input document.
///
/// Text slots follow `interaction.ts:24`, which coerces with `String(value ?? "")` and then trims:
/// a scalar becomes its display text and anything else (including an object or array) becomes
/// absent, because those are client bugs and not values the node can act on.
///
/// # Errors
///
/// Returns the rejection when `action` is not one of the eight declared spellings.
pub fn soundw_input_from_value(value: &Value) -> Result<NormalizedSoundwInput, SoundwInputRejection> {
    let action = slot(value, "action");
    let profile_name = slot(value, "profileName");
    let sound_switch_path = slot(value, "soundSwitchPath");
    normalize_soundw_values(
        action.filter(|text| !text.is_empty()).as_deref(),
        profile_name.as_deref(),
        sound_switch_path.as_deref(),
    )
}

fn slot(value: &Value, key: &str) -> Option<String> {
    match value.get(key) {
        None | Some(Value::Null) => None,
        Some(Value::String(text)) => Some(text.clone()),
        Some(Value::Bool(flag)) => Some(flag.to_string()),
        Some(Value::Number(number)) => Some(number.to_string()),
        Some(_) => None,
    }
}

/// `run` for an already parsed request. The returned document is a full
/// `nodeRunResponseSchema`, including when the run failed or the input was refused.
#[must_use]
pub fn run_soundw_request(
    request: &Value,
    runtime: &dyn SoundwRuntime,
    stream: &mut dyn SoundwEventSink,
) -> Value {
    let input_document = soundw_input_value_of(request);
    let normalized = match soundw_input_from_value(input_document) {
        Ok(normalized) => normalized,
        Err(rejection) => {
            return serde_json::json!({
                "result": rejection_result(&rejection).to_json(),
                "events": [],
            });
        }
    };
    let input: SoundwInput = normalized.to_input();

    let mut sink = ForwardingSoundwEventSink::new(stream);
    let result = run_soundw(&input, runtime, &mut sink);
    let events = sink.into_events();

    serde_json::json!({
        "result": result.to_json(),
        "events": events.iter().map(SoundwRunEvent::to_json).collect::<Vec<Value>>(),
    })
}

/// `run` for the raw request text, which is what the exported function receives.
pub fn run_soundw_request_text(
    text: &str,
    runtime: &dyn SoundwRuntime,
    stream: &mut dyn SoundwEventSink,
) -> String {
    match serde_json::from_str::<Value>(text) {
        Ok(request) => run_soundw_request(&request, runtime, stream).to_string(),
        Err(error) => serde_json::json!({
            "result": SoundwRunResult::failure(
                format!("SoundW request was not valid JSON: {error}"),
                SoundwData::default(),
            )
            .to_json(),
            "events": [],
        })
        .to_string(),
    }
}

/// `normalize_input`: `interaction.ts:24` plus the declared rules, with no host call at all.
///
/// The answer is `{ "normalized": … , "violations": […] }` on success and
/// `{ "error": PluginError }` when the action itself is undeclared. A *rule violation* is not an
/// error document: `interaction.ts:21`'s `validate` is a per-field message the face paints, so the
/// violations travel as data next to the normalized input.
pub fn normalize_soundw_request_text(text: &str) -> String {
    let request = match serde_json::from_str::<Value>(text) {
        Ok(request) => request,
        Err(error) => return rejection_document(&malformed_rejection(&error)),
    };
    match soundw_input_from_value(soundw_input_value_of(&request)) {
        Ok(normalized) => {
            let violations = crate::soundw_input::validate_soundw_input(&normalized);
            serde_json::json!({
                "normalized": normalized.to_json(),
                "violations": violations
                    .iter()
                    .map(|violation| {
                        serde_json::json!({
                            "fieldId": violation.field_id,
                            "rule": violation.rule,
                            "message": violation.message("zh"),
                            "messageEn": violation.message("en"),
                        })
                    })
                    .collect::<Vec<Value>>(),
                "dangerous": is_dangerous(&normalized.to_input()),
            })
            .to_string()
        }
        Err(rejection) => rejection_document(&rejection),
    }
}

/// `preview`: `interaction.ts:25`'s lines.
pub fn preview_request_text(text: &str) -> String {
    let request = match serde_json::from_str::<Value>(text) {
        Ok(request) => request,
        Err(error) => return rejection_document(&malformed_rejection(&error)),
    };
    let language = soundw_language_of(&request);
    match soundw_input_from_value(soundw_input_value_of(&request)) {
        Ok(normalized) => {
            let lines = preview(&normalized.to_input(), language);
            serde_json::json!({ "lines": lines }).to_string()
        }
        Err(rejection) => rejection_document(&rejection),
    }
}

/// `result_view`: `interaction.ts:27`'s `{ success, message, lines }`.
pub fn result_view_request_text(text: &str) -> String {
    let request = match serde_json::from_str::<Value>(text) {
        Ok(request) => request,
        Err(error) => return rejection_document(&malformed_rejection(&error)),
    };
    let document = request.get("result").filter(|value| !value.is_null()).unwrap_or(&request);
    match serde_json::from_value::<SoundwRunResult>(document.clone()) {
        Ok(result) => view_json(&result_view(&result)).to_string(),
        Err(error) => rejection_document(&rejection(
            "input.result_document",
            "result",
            "resultView",
            format!("SoundW result document is not a NodeRunResult: {error}"),
        )),
    }
}

/// `describe`: the registry `def`, the entry points, the capability surface and the command the
/// host must register.
#[must_use]
pub fn describe_soundw_plugin() -> Value {
    serde_json::json!({
        "description": soundw_node_description(),
        "entryPoints": SOUNDW_ENTRY_POINTS,
        "exports": {
            "previewExport": SOUNDW_PREVIEW_EXPORT,
            "resultViewExport": SOUNDW_RESULT_VIEW_EXPORT,
        },
        "hostFunctions": SOUNDW_HOST_FUNCTIONS,
        "registeredCommands": [SOUNDW_REGISTERED_COMMAND],
        "danger": { "type": "none" },
        "reportsProgress": true,
    })
}

/// The `result` document a refused input produces, shaped exactly like `core.ts:43`'s `fail()`.
#[must_use]
pub fn rejection_result(rejection: &SoundwInputRejection) -> SoundwRunResult {
    SoundwRunResult::failure(rejection.message.clone(), SoundwData::default())
}

fn view_json(view: &SoundwResultView) -> Value {
    serde_json::to_value(view).unwrap_or(Value::Null)
}

fn rejection_document(rejection: &SoundwInputRejection) -> String {
    serde_json::json!({ "error": rejection.to_json() }).to_string()
}

fn rejection(code: &'static str, field_id: &'static str, rule: &'static str, message: String) -> SoundwInputRejection {
    SoundwInputRejection { code, field_id, rule, message }
}

fn malformed_rejection(error: &serde_json::Error) -> SoundwInputRejection {
    rejection(
        "input.request_not_json",
        "request",
        "json",
        format!("SoundW request was not valid JSON: {error}"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::soundw_runtime::{
        CollectingSoundwEventSink, SoundwBinaryResolution, SoundwCheckpoint, SoundwProcessOutput,
    };
    use std::cell::RefCell;

    struct Stub {
        output: SoundwProcessOutput,
        found: bool,
        cancel: bool,
        calls: RefCell<Vec<(String, Vec<String>)>>,
    }

    impl Stub {
        fn new(code: i32, stdout: &str, stderr: &str) -> Self {
            Self {
                output: SoundwProcessOutput::new(code, stdout, stderr),
                found: true,
                cancel: false,
                calls: RefCell::new(Vec::new()),
            }
        }
    }

    impl SoundwRuntime for Stub {
        fn resolve(&self, _path_override: Option<&str>) -> SoundwBinaryResolution {
            if self.found {
                SoundwBinaryResolution::found("SoundSwitch.CLI.exe")
            } else {
                SoundwBinaryResolution::missing()
            }
        }

        fn run(&self, program: &str, args: &[String]) -> SoundwProcessOutput {
            self.calls.borrow_mut().push((program.to_owned(), args.to_vec()));
            self.output.clone()
        }

        fn checkpoint(&self) -> SoundwCheckpoint {
            if self.cancel {
                SoundwCheckpoint::Cancelled { message: "Operation cancelled.".to_owned() }
            } else {
                SoundwCheckpoint::Continue
            }
        }
    }

    fn answered(text: &str, runtime: &Stub) -> Value {
        let mut sink = CollectingSoundwEventSink::new();
        let document = run_soundw_request_text(text, runtime, &mut sink);
        serde_json::from_str(&document).expect("the run entry always answers JSON")
    }

    #[test]
    fn a_wrapped_request_and_a_bare_input_produce_the_same_run() {
        let runtime = Stub::new(0, "ok", "");
        let input = r#"{"action":"mute"}"#;

        let wrapped = answered(
            &format!(r#"{{"input":{input},"context":{{"componentId":"card-1","workspaceId":"ws-1"}}}}"#),
            &runtime,
        );
        let bare = answered(input, &runtime);

        assert_eq!(wrapped, bare, "nodeRunRequestSchema.input is optional");
        assert_eq!(wrapped["result"]["data"]["command"], serde_json::json!(["mute", "--state", "true"]));
        assert_eq!(
            wrapped["events"],
            serde_json::json!([
                { "type": "progress", "progress": 30, "message": "Running SoundSwitch mute --state true" },
                { "type": "progress", "progress": 100, "message": "SoundSwitch command completed." },
            ]),
            "the response replays the event stream the host already saw"
        );
    }

    #[test]
    fn an_undeclared_action_is_refused_before_the_cli_runs() {
        let runtime = Stub::new(0, "ok", "");
        let answer = answered(r#"{"action":"recording"}"#, &runtime);
        assert_eq!(answer["result"]["success"], serde_json::json!(false));
        assert!(
            answer["result"]["message"]
                .as_str()
                .expect("message")
                .contains("switch-recording")
        );
        assert_eq!(answer["events"].as_array().expect("events").len(), 0);
        assert!(runtime.calls.borrow().is_empty(), "a refused input never reaches the machine");
    }

    #[test]
    fn a_malformed_request_answers_with_a_failure_result_document() {
        let runtime = Stub::new(0, "ok", "");
        let answer = answered("{ not json", &runtime);
        assert_eq!(answer["events"].as_array().expect("events").len(), 0);
        assert_eq!(answer["result"]["success"], serde_json::json!(false));
        assert!(
            answer["result"]["message"]
                .as_str()
                .expect("message")
                .starts_with("SoundW request was not valid JSON:")
        );
        assert_eq!(answer["result"]["data"]["installed"], serde_json::json!(false));
    }

    #[test]
    fn normalize_reports_the_declared_violation_without_losing_the_input() {
        let document: Value =
            serde_json::from_str(&normalize_soundw_request_text(r#"{"action":"profile","profileName":"  "}"#))
                .expect("json");
        assert_eq!(document["normalized"]["action"], serde_json::json!("profile"));
        assert_eq!(document["violations"][0]["fieldId"], serde_json::json!("profileName"));
        assert_eq!(document["violations"][0]["rule"], serde_json::json!("nonBlank"));
        assert_eq!(document["violations"][0]["message"], serde_json::json!("请输入预设名称。"));
        assert_eq!(document["violations"][0]["messageEn"], serde_json::json!("Enter a profile name."));
        assert_eq!(document["dangerous"], serde_json::json!(false));

        // Negative control: the same blank name under another action is not a violation at all.
        let clean: Value =
            serde_json::from_str(&normalize_soundw_request_text(r#"{"action":"profiles","profileName":"  "}"#))
                .expect("json");
        assert_eq!(clean["violations"].as_array().expect("violations").len(), 0);

        let refused = normalize_soundw_request_text(r#"{"action":"nope"}"#);
        let value: Value = serde_json::from_str(&refused).expect("json");
        assert_eq!(value["error"]["code"], serde_json::json!("input.action_not_declared"));
        assert_eq!(value["error"]["details"][0], serde_json::json!(["field", "action"]));
    }

    #[test]
    fn the_preview_entry_returns_the_same_lines_the_schema_produced() {
        let document: Value = serde_json::from_str(&preview_request_text(
            r#"{"input":{"action":"profile","profileName":"womic"},"language":"en"}"#,
        ))
        .expect("json");
        assert_eq!(document["lines"], serde_json::json!(["Activate profile", "Profile name: womic"]));

        let zh: Value =
            serde_json::from_str(&preview_request_text(r#"{"input":{}}"#)).expect("json");
        assert_eq!(zh["lines"], serde_json::json!(["当前状态"]), "interaction.ts:14 defaults to zh");
    }

    #[test]
    fn the_result_view_entry_reads_a_run_result() {
        let result = SoundwRunResult::ok(
            "Muted",
            SoundwData { output: "Muted\nsecond".to_owned(), ..SoundwData::default() },
        );
        let document = serde_json::json!({ "result": result.to_json() });
        let view: Value =
            serde_json::from_str(&result_view_request_text(&document.to_string())).expect("json");
        assert_eq!(view["success"], serde_json::json!(true));
        assert_eq!(view["lines"], serde_json::json!(["Muted", "second"]));

        // Negative control: a document that is not a result is refused with the PluginError shape.
        let refused: Value =
            serde_json::from_str(&result_view_request_text(r#"{"message":"only a message"}"#)).expect("json");
        assert_eq!(refused["error"]["code"], serde_json::json!("input.result_document"));
    }

    #[test]
    fn describe_publishes_the_binding_names_the_definition_declares() {
        let described = describe_soundw_plugin();
        assert_eq!(described["description"]["id"], serde_json::json!("soundw"));
        assert_eq!(described["description"]["icon"], serde_json::json!("Mic"));
        assert_eq!(described["description"]["version"], serde_json::json!("0.1.0"));
        assert_eq!(described["entryPoints"][0], serde_json::json!(SOUNDW_RUN_ENTRY_POINT));
        assert_eq!(described["exports"]["previewExport"], serde_json::json!("preview"));
        assert_eq!(described["exports"]["resultViewExport"], serde_json::json!("result_view"));
        assert_eq!(described["registeredCommands"], serde_json::json!(["soundswitch-cli"]));
        assert_eq!(described["hostFunctions"].as_array().expect("array").len(), SOUNDW_HOST_FUNCTIONS.len());
    }

    #[test]
    fn a_cancelled_checkpoint_stops_before_the_cli() {
        let mut runtime = Stub::new(0, "ok", "");
        runtime.cancel = true;
        let answer = answered(r#"{"action":"mute"}"#, &runtime);
        assert_eq!(answer["result"]["message"], serde_json::json!("Operation cancelled."));
        assert!(runtime.calls.borrow().is_empty());
        assert_eq!(answer["events"].as_array().expect("events").len(), 0, "ADR-0066: cancel beats the 30% event");
    }

    #[test]
    fn the_operation_id_is_read_from_both_places_it_lives() {
        assert_eq!(soundw_operation_id_of(&serde_json::json!({ "operationId": "op-9" })), "op-9");
        assert_eq!(
            soundw_operation_id_of(&serde_json::json!({ "context": { "operationId": "op-10" } })),
            "op-10"
        );
        // Negative control: an absent identity is an empty string, not a fabricated one.
        assert_eq!(soundw_operation_id_of(&serde_json::json!({ "input": {} })), "");
    }

    #[test]
    fn text_slots_coerce_like_interaction_ts() {
        let normalized =
            soundw_input_from_value(&serde_json::json!({ "profileName": 12, "soundSwitchPath": true }))
                .expect("no action means status");
        assert_eq!(normalized.action, crate::soundw_model::SoundwAction::Status);
        assert_eq!(normalized.profile_name.as_deref(), Some("12"));
        assert_eq!(normalized.sound_switch_path.as_deref(), Some("true"));

        let ignored = soundw_input_from_value(&serde_json::json!({ "profileName": ["womic"] }))
            .expect("a non-scalar is absent, not a crash");
        assert_eq!(ignored.profile_name, None);
    }
}
