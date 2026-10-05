//! The JSON documents on either side of the plugin boundary, as pure Rust.
//!
//! The structure follows `plugins/timeu/src/plugin_entry.rs`: this module owns the request/response
//! *shape* and never touches the machine, while `src/extism_host.rs` owns the Extism mechanics and
//! `src/run.rs` owns the node's decisions. That separation is what lets `cargo test` exercise the entry
//! logic with a [`crate::memory_files::MemoryFiles`] and a scripted control, and it is why the shim can
//! be replaced wholesale by a WIT adapter without moving a rule (ADR-0068's three layers).
//!
//! ```text
//! request : { "input": { …LinedupInput… }, "context": { "componentId", "workspaceId" } }
//! `run`    : { "success", "message", "data" }                 nodeRunResultSchema, no events
//! ```
//!
//! A bare `LinedupInput` is accepted as well, because `nodeRunRequestSchema.input` is optional and the
//! old in-process runner called `runLinedupInteraction(input)` with the input directly
//! (`packages/nodes/linedup/src/interaction.ts`).
//!
//! There is no `events` array in the response, unlike TimeU: `definition.json:162` sets
//! `reportsProgress: false`, the node declares no `xiranite.operation.emit`, and
//! `crates/xiranite-plugin-api/src/invocation.rs:5-8` states the rule — a plugin that reports progress
//! does it live through the capability, and the response carries the result only.
//!
//! Nothing here catches a panicking host call. A checkpoint that cannot be served answers with the
//! reserved `0` tag, which [`crate::run_control::CheckpointOutcome::from_abi_code`] reads as the safe
//! stop, so a lost operation arrives as a `failure` result rather than as a trap.

use serde_json::Value;

use crate::contract::{LinedupInput, LinedupResult, result_view_of};
use crate::file_access::LinedupFileSystem;
use crate::run::run_linedup;
use crate::run_control::LinedupRunControl;

pub use crate::node_metadata::{
    LINEDUP_DESCRIBE_ENTRY_POINT, LINEDUP_ENTRY_POINTS, LINEDUP_HOST_FUNCTIONS, LINEDUP_NORMALIZE_ENTRY_POINT,
    LINEDUP_PREVIEW_ENTRY_POINT, LINEDUP_RESULT_VIEW_ENTRY_POINT, LINEDUP_RUN_ENTRY_POINT,
};

/// The `input` document of a request, tolerating a request that already unwrapped it.
///
/// `context` is read but not used: Linedup has no workspace or component state, and its output is text
/// the caller holds rather than a record file with an owner.
#[must_use]
pub fn linedup_input_value_of(request: &Value) -> &Value {
    match request.get("input") {
        Some(input) => input,
        None => request,
    }
}

/// `linedup_run` for an already parsed request.
///
/// The returned document is `nodeRunResultSchema` in both outcomes: `crates/xiranite-node-runtime`'s
/// launcher parses exactly that shape and writes the terminal phase from `success`
/// (`launcher.rs:143-164`), so a Linedup refusal is a result and never a plugin error.
#[must_use]
pub fn run_linedup_request(
    request: &Value,
    files: &dyn LinedupFileSystem,
    control: &mut dyn LinedupRunControl,
) -> Value {
    let input = LinedupInput::from_json(linedup_input_value_of(request));
    run_linedup(&input, files, control).to_json()
}

/// `linedup_run` for the raw request text, which is what the exported function receives.
///
/// Unparseable or non-UTF-8 input becomes a `failure` result rather than a trap, so the card shows a
/// message instead of an Extism error. There is no TypeScript counterpart: `runLinedupInteraction` was
/// always handed typed fields by `toInput`, and the typed-ness is enforced on the host side after the
/// rewrite, so the plugin reports what it could not read.
#[must_use]
pub fn run_linedup_request_text(
    text: &str,
    files: &dyn LinedupFileSystem,
    control: &mut dyn LinedupRunControl,
) -> String {
    match parse_request_document(text) {
        Ok(request) => run_linedup_request(&request, files, control).to_string(),
        Err(message) => LinedupResult::failure(message).to_json().to_string(),
    }
}

/// `linedup_normalize_input`: `interaction.ts`'s `toInput`, no filesystem and no checkpoint.
#[must_use]
pub fn normalize_linedup_request_text(text: &str) -> String {
    match parse_request_document(text) {
        Ok(request) => serde_json::to_string(&LinedupInput::from_json(linedup_input_value_of(&request)).to_json())
            .unwrap_or_else(|_| "{}".to_owned()),
        Err(message) => LinedupResult::failure(message).to_json().to_string(),
    }
}

/// `linedup_preview`: `interaction.ts`'s `preview(i)`, so a `string[]` and not a wrapper object — the
/// callback's own return type is the contract a face reads.
#[must_use]
pub fn preview_linedup_request_text(text: &str) -> String {
    match parse_request_document(text) {
        Ok(request) => {
            let input = LinedupInput::from_json(linedup_input_value_of(&request));
            serde_json::to_string(&input.preview_lines()).unwrap_or_else(|_| "[]".to_owned())
        }
        Err(message) => LinedupResult::failure(message).to_json().to_string(),
    }
}

/// `linedup_result_view`: `interaction.ts`'s `result(r)`, over a finished result document.
///
/// A result that does not parse answers with the zeroed view the callback would produce for
/// `{ data: undefined }`, because the view is display text and the operation has already ended.
#[must_use]
pub fn result_view_linedup_request_text(text: &str) -> String {
    match parse_request_document(text) {
        Ok(request) => {
            let result: LinedupResult = serde_json::from_value(request).unwrap_or_else(|_| LinedupResult::failure(
                "Linedup received a result document it cannot read",
            ));
            serde_json::to_string(&result_view_of(&result)).unwrap_or_else(|_| "{}".to_owned())
        }
        Err(message) => LinedupResult::failure(message).to_json().to_string(),
    }
}

/// `linedup_describe`: identity, entry points, capabilities and the export-binding table.
#[must_use]
pub fn describe_linedup_plugin() -> Value {
    crate::node_metadata::plugin_descriptor()
}

/// The one export that answers without a request document.
#[must_use]
pub fn describe_linedup_plugin_text() -> String {
    describe_linedup_plugin().to_string()
}

/// Decodes a request document, reporting what `serde_json` said.
fn parse_request_document(text: &str) -> Result<Value, String> {
    if text.trim().is_empty() {
        // `interaction.ts` reads an absent field as the empty one, so an absent request is the default
        // request and the blank-source rule is what refuses it.
        return Ok(Value::Object(serde_json::Map::new()));
    }
    serde_json::from_str(text).map_err(|error| format!("Linedup request was not valid JSON: {error}"))
}

/// The operation this call belongs to, as the shim must put it in every capability request.
///
/// ADR-0068 scopes a cross-boundary call to one operation because a plugin instance is pooled across
/// them, and `crates/xiranite-node-runtime/src/capabilities.rs:146-152` deserializes exactly
/// `{"operationId": …}` for the checkpoint. Where the field sits is a host-wiring detail rather than a
/// plugin decision, so both spellings are read, and the empty string is the documented "the host did
/// not scope this call" answer instead of a guessed id.
#[must_use]
pub fn linedup_operation_id_of(request: &Value) -> &str {
    match request
        .get("runOptions")
        .and_then(|options| options.get("operationId"))
        .or_else(|| request.get("operationId"))
    {
        Some(Value::String(operation_id)) => operation_id,
        _ => "",
    }
}

/// The result document `run_linedup_request` embeds, exposed so a caller that only needs the result (a
/// future CLI host that renders the panel itself) can reach it.
#[must_use]
pub fn linedup_result_of_run_response(response: &Value) -> Option<&Value> {
    response.get("result").or(Some(response))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_access::NoFiles;
    use crate::memory_files::MemoryFiles;
    use crate::node_metadata::PLUGIN_ID;
    use crate::run_control::{CancelAfterCheckpoints, ContinueThroughRunControl};
    use serde_json::json;

    fn run(text: &str) -> Value {
        let mut control = ContinueThroughRunControl;
        serde_json::from_str(&run_linedup_request_text(text, &NoFiles, &mut control)).expect("json")
    }

    #[test]
    fn a_wrapped_request_and_a_bare_input_produce_the_same_run() {
        let input = json!({ "sourceText": "alpha\nbeta", "filterText": "beta" });
        let wrapped = run(&json!({ "input": input.clone(), "context": { "componentId": "card-1", "workspaceId": "ws-1" } }).to_string());
        let bare = run(&input.to_string());
        assert_eq!(wrapped, bare, "nodeRunRequestSchema.input is optional");
        assert_eq!(wrapped["success"], json!(true));
        assert_eq!(wrapped["message"], json!("Filtered 1 line(s); kept 1."));
        assert_eq!(wrapped["data"]["filteredLines"], json!(["alpha"]));
        assert_eq!(wrapped["data"]["details"], json!([{ "line": "beta", "matchedFilter": "beta" }]));
        assert!(wrapped.get("events").is_none(), "reportsProgress is false, so no event list exists");
    }

    #[test]
    fn malformed_request_text_answers_with_a_failure_result_document() {
        let value = run("{ not json");
        assert_eq!(value["success"], json!(false));
        assert!(
            value["message"].as_str().expect("message").starts_with("Linedup request was not valid JSON:"),
            "{value}"
        );
        assert!(value.get("data").is_none(), "a request that never parsed produced no data");
    }

    #[test]
    fn an_empty_request_is_the_blank_source_rule() {
        let value = run("");
        assert_eq!(value["success"], json!(false));
        assert_eq!(value["message"], json!("请输入原文本。"));
    }

    #[test]
    fn normalize_answers_with_the_defaulted_document() {
        let normalized: Value =
            serde_json::from_str(&normalize_linedup_request_text(r#"{"input":{"sourceText":"a\nb"}}"#)).expect("json");
        assert_eq!(normalized, json!({
            "sourceText": "a\nb",
            "filterText": "",
            "caseSensitive": true,
            "sort": true,
            "language": "zh"
        }));
        // The negative control: an explicit false survives normalization instead of being defaulted.
        let kept: Value = serde_json::from_str(&normalize_linedup_request_text(r#"{"sort":false,"caseSensitive":false}"#))
            .expect("json");
        assert_eq!(kept["sort"], json!(false));
        assert_eq!(kept["caseSensitive"], json!(false));
    }

    #[test]
    fn preview_answers_with_the_two_count_lines_as_an_array() {
        let lines: Value =
            serde_json::from_str(&preview_linedup_request_text(r#"{"sourceText":"a\nb\n","filterText":"x\n\ny"}"#))
                .expect("json");
        assert_eq!(lines, json!(["3 行", "2 filters"]));
        assert!(lines.is_array(), "interaction.ts's preview returns string[]");
    }

    #[test]
    fn result_view_reads_a_finished_result_document() {
        let view: Value = serde_json::from_str(&result_view_linedup_request_text(
            r#"{"success":true,"message":"Filtered 2 line(s); kept 3.","data":{"keptCount":3,"removedCount":2}}"#,
        ))
        .expect("json");
        assert_eq!(view, json!({
            "success": true,
            "message": "Filtered 2 line(s); kept 3.",
            "lines": ["Kept: 3", "Removed: 2"]
        }));

        let unreadable: Value = serde_json::from_str(&result_view_linedup_request_text("{}")).expect("json");
        assert_eq!(unreadable["lines"], json!(["Kept: 0", "Removed: 0"]), "the zeroed view, not a trap");
    }

    #[test]
    fn describe_lists_the_identity_and_the_imported_surface() {
        let described = describe_linedup_plugin();
        assert_eq!(described["id"], json!(PLUGIN_ID));
        assert_eq!(described["entryPoint"], json!(LINEDUP_RUN_ENTRY_POINT));
        assert_eq!(described["hostFunctions"].as_array().expect("array").len(), LINEDUP_HOST_FUNCTIONS.len());
        assert_eq!(described["exportBindings"]["preview"], json!(LINEDUP_PREVIEW_ENTRY_POINT));
        assert_eq!(described["actions"], json!(["filter"]));
        assert_eq!(described["reportsProgress"], json!(false));
    }

    #[test]
    fn the_operation_scope_is_read_from_either_spelling() {
        assert_eq!(linedup_operation_id_of(&json!({ "operationId": "op-7" })), "op-7");
        assert_eq!(linedup_operation_id_of(&json!({ "runOptions": { "operationId": "op-8" } })), "op-8");
        assert_eq!(linedup_operation_id_of(&json!({ "context": { "componentId": "card" } })), "", "no scope, no guess");
        assert_eq!(linedup_operation_id_of(&json!({ "operationId": 7 })), "", "an operation id is text");
    }

    #[test]
    fn a_cancelled_checkpoint_reaches_the_boundary_as_a_failure_result() {
        let files = MemoryFiles::new();
        let mut control = CancelAfterCheckpoints::new(0);
        let document = run_linedup_request_text(r#"{"sourceText":"a\nb","filterText":"z"}"#, &files, &mut control);
        let value: Value = serde_json::from_str(&document).expect("json");
        assert_eq!(value["success"], json!(false));
        assert!(value["message"].as_str().expect("message").starts_with("Linedup stopped after"), "{value}");
    }

    #[test]
    fn the_result_of_a_response_is_reachable() {
        let document = run_linedup_request(
            &json!({ "sourceText": "alpha", "filterText": "zz" }),
            &NoFiles,
            &mut ContinueThroughRunControl,
        );
        assert_eq!(linedup_result_of_run_response(&document), Some(&document));
        assert_eq!(linedup_result_of_run_response(&json!({ "result": document.clone() })), Some(&document));
    }
}
