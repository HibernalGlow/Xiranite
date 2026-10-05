//! The JSON documents on either side of the plugin boundary, as pure Rust.
//!
//! `plugin.rs` is the only wasm-specific adapter, so these request and response
//! shapes are testable without a host. They follow the protocol the React layer and
//! the operation manager already speak (`packages/shared/src/index.ts:91-106` for
//! events and results, `:140-151` for the request/response pair):
//!
//! ```text
//! request : { "input": { …TimeuInput… }, "context": { "componentId", "workspaceId" } }
//! response: { "result": { "success", "message", "data" }, "events": [ …NodeRunEvent… ] }
//! ```
//!
//! A bare `TimeuInput` is accepted as well, because `nodeRunRequestSchema.input` is
//! optional and the old in-process runner called `runTimeu(input, runtime, onEvent)`
//! with the input directly.
//!
//! Nothing here catches a panicking host call: a filesystem refusal already arrives as a `failure`
//! result through `run_timeu_into_result`, which is what the TypeScript `catch` at `core.ts:140`
//! produced — only now it comes from `std::fs` on a granted preopen (ADR-0071) instead of from a
//! `xiranite.fs.*` reply.

use serde_json::{Value, json};

use xiranite_plugin_api::host_function_names::{
    HOST_FUNCTION_NOW, HOST_FUNCTION_OPERATION_CHECKPOINT, HOST_FUNCTION_OPERATION_EMIT,
};

use crate::timeu_core::{failure_timeu_result, run_timeu_into_result, timeu_node_description};
use crate::timeu_input::{TimeuInput, normalize_timeu_input_json};
use crate::timeu_model::{TimeuRunEvent, TimeuRunResult};
use crate::timeu_runtime::{TimeuEventSink, TimeuRuntime};

/// Exported function the host calls for one TimeU operation.
pub const TIMEU_RUN_ENTRY_POINT: &str = "run";
/// Exported function that answers with the normalized input, no host IO at all.
pub const TIMEU_NORMALIZE_ENTRY_POINT: &str = "normalizeInput";
/// Exported function that answers with the node description and the host surface.
pub const TIMEU_DESCRIBE_ENTRY_POINT: &str = "describe";

/// The capabilities TimeU calls, named from `xiranite_plugin_api::host_function_names` so this list
/// cannot drift from the vocabulary the host registers.
///
/// ADR-0071 retired the six `xiranite.fs.*` names this array used to carry; the clock stays because a
/// plugin must not read a wall clock itself, and the two operation names stay because a paused
/// operation and a progress stream are product semantics. Everything the retired names did is
/// `std::fs` in [`crate::std_fs_runtime`] against the manifest's authorized roots.
///
/// Every entry must be a settled capability name; the test
/// `describe_lists_the_registry_def_and_the_imported_host_surface` checks that against
/// `HOST_FUNCTION_NAMES`. The gate it replaces asserted that a retired `xiranite.fs.set_times` was
/// present — stamping still happens, it just goes through `std::fs` now, and
/// `std_fs_runtime`'s own test pins that.
pub const TIMEU_HOST_FUNCTIONS: [&str; 3] = [
    HOST_FUNCTION_OPERATION_CHECKPOINT,
    HOST_FUNCTION_OPERATION_EMIT,
    HOST_FUNCTION_NOW,
];

/// Collects the events that go into `nodeRunResponseSchema.events` while still
/// forwarding each one to the live stream, so the operation keeps its existing
/// "events are durable in history" behaviour (`xiranite.operation.emit`) and the response
/// stays self-contained.
pub struct ForwardingTimeuEventSink<'stream> {
    stream: &'stream mut dyn TimeuEventSink,
    collected: Vec<TimeuRunEvent>,
}

impl<'stream> ForwardingTimeuEventSink<'stream> {
    pub fn new(stream: &'stream mut dyn TimeuEventSink) -> Self {
        Self { stream, collected: Vec::new() }
    }

    pub fn into_events(self) -> Vec<TimeuRunEvent> {
        self.collected
    }
}

impl TimeuEventSink for ForwardingTimeuEventSink<'_> {
    fn on_event(&mut self, event: TimeuRunEvent) {
        self.collected.push(event.clone());
        self.stream.on_event(event);
    }
}

/// The `input` document of a request, tolerating a request that already unwrapped
/// it. `context` is read but not used: TimeU has no workspace or component state,
/// which is why its data stays in the caller's paths and record file.
pub fn timeu_input_value_of(request: &Value) -> &Value {
    match request.get("input") {
        Some(input) => input,
        None => request,
    }
}

/// `run` for an already parsed request. The returned document is a full
/// `nodeRunResponseSchema`, including when the run failed: the operation protocol
/// never carries a TimeU failure as a plugin error.
pub fn run_timeu_request(
    request: &Value,
    runtime: &dyn TimeuRuntime,
    stream: &mut dyn TimeuEventSink,
) -> Value {
    let mut sink = ForwardingTimeuEventSink::new(stream);
    let result = run_timeu_into_result(
        &TimeuInput::from_json(timeu_input_value_of(request)),
        runtime,
        &mut sink,
    );
    let events = sink.into_events();

    json!({
        "result": result.to_json(),
        "events": events.iter().map(TimeuRunEvent::to_json).collect::<Vec<Value>>(),
    })
}

/// `run` for the raw request text, which is what the exported function receives.
/// Unparseable or non-UTF-8 input becomes a `failure` result rather than a trap, so
/// the UI shows a message instead of an Extism error, and the answer keeps the full
/// `nodeRunResponseSchema` shape with an empty event list.
pub fn run_timeu_request_text(
    text: &str,
    runtime: &dyn TimeuRuntime,
    stream: &mut dyn TimeuEventSink,
) -> String {
    match serde_json::from_str::<Value>(text) {
        Ok(request) => run_timeu_request(&request, runtime, stream).to_string(),
        Err(error) => json!({
            "result": failure_timeu_result(
                &format!("TimeU request was not valid JSON: {error}"),
                "",
            )
            .to_json(),
            "events": [],
        })
        .to_string(),
    }
}

/// `normalizeInput`: the pure defaulting rule of `core.ts:80-91`, no host call.
pub fn normalize_timeu_request_text(text: &str) -> String {
    match serde_json::from_str::<Value>(text) {
        Ok(request) => match normalize_timeu_input_json(timeu_input_value_of(&request)) {
            Ok(normalized) => json!({ "normalized": normalized.to_json() }).to_string(),
            Err(error) => json!({ "error": error.to_string() }).to_string(),
        },
        Err(error) => json!({ "error": format!("TimeU request was not valid JSON: {error}") }).to_string(),
    }
}

/// `describe`: the registry `def` plus the host surface the plugin imports.
pub fn describe_timeu_plugin() -> Value {
    json!({
        "description": timeu_node_description().to_json(),
        "entryPoints": [
            TIMEU_RUN_ENTRY_POINT,
            TIMEU_NORMALIZE_ENTRY_POINT,
            TIMEU_DESCRIBE_ENTRY_POINT,
        ],
        "hostFunctions": TIMEU_HOST_FUNCTIONS.iter().map(|name| Value::String(name.to_string())).collect::<Vec<Value>>(),
    })
}

/// The result document `run_timeu_request` embeds, exposed so a caller that only
/// needs the result (a future CLI host) can reach it.
pub fn timeu_result_of_run_response(response: &Value) -> Option<&Value> {
    response.get("result")
}

/// Convenience for tests and hosts: the failure document on its own.
pub fn timeu_failure_result(message: &str) -> TimeuRunResult {
    failure_timeu_result(message, "")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_runtime::{FAKE_NOW_ISO, FakeTimeuRuntime, record};
    use crate::timeu_runtime::CollectingTimeuEventSink;

    #[test]
    fn a_wrapped_request_and_a_bare_input_produce_the_same_run() {
        let runtime = FakeTimeuRuntime::new().with_file("/root/a.txt", 1000.0, 2000.0);
        let input = json!({ "action": "scan", "paths": ["/root/a.txt"] });

        let mut wrapped_sink = CollectingTimeuEventSink::new();
        let wrapped = run_timeu_request(
            &json!({ "input": input.clone(), "context": { "componentId": "card-1", "workspaceId": "ws-1" } }),
            &runtime,
            &mut wrapped_sink,
        );

        let mut bare_sink = CollectingTimeuEventSink::new();
        let bare = run_timeu_request(&input, &runtime, &mut bare_sink);

        assert_eq!(wrapped, bare, "nodeRunRequestSchema.input is optional");
        assert_eq!(wrapped["result"]["success"], json!(true));
        assert_eq!(wrapped["result"]["message"], json!("TimeU planned 1 item(s)."));
        assert_eq!(
            wrapped["events"],
            json!([
                { "type": "progress", "progress": 15, "message": "Collecting timestamp targets." },
                { "type": "progress", "progress": 45, "message": "Planning 1 timestamp item(s)." },
            ]),
            "the response replays the event stream the host already saw"
        );
        assert_eq!(bare_sink.events.len(), 2);
    }

    #[test]
    fn streaming_and_collected_events_are_the_same_events_in_the_same_order() {
        let runtime = FakeTimeuRuntime::new()
            .with_file("/root/a.txt", 1000.0, 2000.0)
            .with_stored_records("/root/timeu.json", &[record("/root/a.txt", 11, 22, FAKE_NOW_ISO)]);
        let mut stream = CollectingTimeuEventSink::new();
        let response = run_timeu_request(
            &json!({ "input": { "action": "restore", "paths": ["/root/a.txt"], "recordPath": "/root/timeu.json", "dryRun": false } }),
            &runtime,
            &mut stream,
        );

        let streamed: Vec<Value> = stream
            .events
            .iter()
            .map(TimeuRunEvent::to_json)
            .collect();
        assert_eq!(response["events"], Value::Array(streamed));
        assert_eq!(response["events"].as_array().expect("array").len(), 3);
        assert_eq!(response["result"]["data"]["restoredCount"], json!(1));
        assert_eq!(timeu_result_of_run_response(&response), Some(&response["result"]));
    }

    #[test]
    fn malformed_request_text_answers_with_a_failure_result_document() {
        let runtime = FakeTimeuRuntime::new();
        let mut stream = CollectingTimeuEventSink::new();
        let answered = run_timeu_request_text("{ not json", &runtime, &mut stream);
        let value: Value = serde_json::from_str(&answered).expect("json answer");

        assert_eq!(value["events"].as_array().expect("events").len(), 0);
        assert_eq!(value["result"]["success"], json!(false));
        assert!(
            value["result"]["message"]
                .as_str()
                .expect("message")
                .starts_with("TimeU request was not valid JSON:"),
            "{answered}"
        );
        assert_eq!(stream.events.len(), 0, "a request that never parsed never ran");
    }

    #[test]
    fn normalize_input_answers_with_the_defaulted_document() {
        let answered: Value =
            serde_json::from_str(&normalize_timeu_request_text(r#"{"input":{"listText":"a.txt,b.txt"}}"#))
                .expect("json answer");

        assert_eq!(answered["normalized"]["action"], json!("scan"));
        assert_eq!(answered["normalized"]["paths"], json!(["a.txt", "b.txt"]));
        assert_eq!(answered["normalized"]["recursive"], json!(true));
        assert_eq!(answered["normalized"]["includeDirectories"], json!(false));
        assert_eq!(answered["normalized"]["dryRun"], json!(true));

        let rejected: Value =
            serde_json::from_str(&normalize_timeu_request_text(r#"{"paths":{"a":1}}"#)).expect("json");
        assert_eq!(rejected["error"], json!("input.paths is not iterable"));
    }

    #[test]
    fn describe_lists_the_registry_def_and_the_imported_host_surface() {
        use xiranite_plugin_api::host_function_names::HOST_FUNCTION_NAMES;

        let described = describe_timeu_plugin();
        assert_eq!(described["description"]["id"], json!("timeu"));
        assert_eq!(described["description"]["icon"], json!("Clock3"));
        assert_eq!(described["description"]["version"], json!("0.1.0"));
        assert_eq!(described["entryPoints"][0], json!("run"));
        let declared: Vec<&str> = described["hostFunctions"]
            .as_array()
            .expect("array")
            .iter()
            .map(|name| name.as_str().expect("host function name"))
            .collect();
        assert_eq!(declared.len(), TIMEU_HOST_FUNCTIONS.len());

        // Every declared name comes from the one vocabulary, so `describe` cannot invent a capability
        // the host never registers.
        for name in &declared {
            assert!(HOST_FUNCTION_NAMES.contains(name), "{name} is not an ADR-0071 capability name");
        }

        // The clock is the reason TimeU still needs a host at all: a plugin may not read a wall clock
        // itself, and `backedUpAt` has to come from the host that owns the operation.
        assert!(
            declared.contains(&"xiranite.now"),
            "the record document's `backedUpAt` is host time, so a manifest without xiranite.now is a bug"
        );

        // The assertion this replaces pinned `xiranite.fs.set_times` as "the reason this node needs a
        // host". Stamping did not go away — it moved to `std::fs::File::set_times` on a granted
        // preopen (ADR-0071), which `std_fs_runtime::tests::set_times_writes_both_timestamps_back_
        // through_std_fs` proves against a real file. What must not come back is the retired family.
        for name in &declared {
            assert!(!name.starts_with("xiranite.fs."), "{name} was retired by ADR-0071");
        }
    }

    #[test]
    fn failure_result_helper_produces_the_protocol_document() {
        let result = timeu_failure_result("boom");
        assert!(!result.success);
        assert_eq!(result.message, "boom");
        assert_eq!(result.data.expect("data").record_path, "");
    }
}
