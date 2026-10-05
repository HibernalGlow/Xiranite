//! The Extism border: `extism:host/env` blocks, the two capability imports and the zero-parameter exports.
//!
//! This is the thinnest layer in the crate on purpose. Every ClassQ decision lives in [`crate::run`] and
//! [`crate::plan`], every JSON document in [`crate::plugin_entry`], and file access in [`crate::std_file_system`];
//! replacing the Extism adapter with a WIT adapter (ADR-0068) rewrites this file and nothing else.
//!
//! # Exports
//!
//! | Export | Signature | Purpose |
//! | --- | --- | --- |
//! | `classq_run` | `() -> i32` | one operation; answers `nodeRunResponseSchema` |
//! | `classq_normalize_input` | `() -> i32` | the pure defaulting rule, for a host that wants to preview or persist it |
//! | `classq_describe` | `() -> i32` | registry `def`, entry points and the host surface this module imports |
//! | `preview` | `() -> i32` | the definition's `previewExport` (`interaction.ts:25`) |
//! | `result_view` | `() -> i32` | the definition's `resultExport` (`interaction.ts:28`) |
//!
//! All five are zero-parameter and return `i32`, because the official Extism Rust host invokes exports with no
//! arguments and `crates/xiranite-extism-adapter/src/compiled.rs:129` only recognises `(0,1)->i32`. `0` means the
//! document on the output is the answer; a non-zero return carries an `error_set` message for a failure too broken to
//! become a result document. `manifest.toml`'s `backend.entry_point` names `classq_run`.
//!
//! # Imports
//!
//! `extism:host/env` is the memory contract; `extism:host/user` is where Xiranite's capabilities land. The import
//! *field* for a logical name is that name with dots flattened to underscores — the rule
//! `crates/xiranite-plugin-api/src/host_function_names.rs` states as part of the contract, so this declaration and the
//! host's registration derive the same text from `manifest.toml`:
//!
//! | Logical name | Import field | Signature |
//! | --- | --- | --- |
//! | `xiranite.operation.checkpoint` | `xiranite_operation_checkpoint` | `(u64) -> u64` |
//! | `xiranite.operation.emit` | `xiranite_operation_emit` | `(u64) -> u64` |
//!
//! There are no file imports. ADR-0071 retired the thirteen `xiranite.fs.*` names; [`crate::std_file_system`] uses
//! `std::fs` against the preopens the host granted from `allowed_paths`, and a run out of fuel, a cancelled epoch or a
//! memory-limit breach is stopped by the engine (ADR-0066's mechanism, measured in ADR-0071 §3) — which is why this
//! plugin needs no process boundary either.

use serde::Serialize;
use serde_json::Value;

use crate::plugin_entry::{
    CLASSQ_DESCRIBE_ENTRY_POINT, CLASSQ_NORMALIZE_ENTRY_POINT, CLASSQ_PREVIEW_ENTRY_POINT,
    CLASSQ_RESULT_VIEW_ENTRY_POINT, CLASSQ_RUN_ENTRY_POINT, ForwardingClassqEventSink, classq_input_of_value,
    classq_input_value_of, classq_language_of, classq_operation_id_of, describe_classq_plugin,
    normalize_classq_input_document, preview_document, result_view_request_text, run_classq_input,
    run_classq_request_text,
};
use crate::runtime::{ClassqCheckpointOutcome, ClassqEventSink, ClassqFileSystem, ClassqPhase, ClassqRunControl};
use crate::std_file_system::StdClassqFileSystem;

/// Mirrors the `#[link(wasm_import_module = ...)]` attribute below, which cannot take a constant. A test in
/// `tests/manifest_contract.rs` keeps the two in step, as `plugins/timeu/src/extism_boundary.rs:77` does.
pub const HOST_ENV_IMPORT_MODULE: &str = "extism:host/env";
/// The module one Xiranite capability becomes when the host registers it as an Extism user function.
pub const HOST_USER_IMPORT_MODULE: &str = "extism:host/user";

/// `extism:host/env`: the only place linear-memory ownership is spelled in this crate.
#[link(wasm_import_module = "extism:host/env")]
unsafe extern "C" {
    fn alloc(length: u64) -> u64;
    fn free(offset: u64);
    fn input_length() -> u64;
    fn input_load_u8(offset: u64) -> u8;
    fn input_load_u64(offset: u64) -> u64;
    fn length(offset: u64) -> u64;
    fn load_u8(offset: u64) -> u8;
    fn load_u64(offset: u64) -> u64;
    fn store_u8(offset: u64, value: u8);
    fn store_u64(offset: u64, value: u64);
    fn output_set(offset: u64, length: u64);
    fn error_set(offset: u64);
}

/// `extism:host/user`: ADR-0068's capability names as closed by ADR-0071, dots flattened to underscores.
#[link(wasm_import_module = "extism:host/user")]
unsafe extern "C" {
    /// ADR-0066: waits while the owning operation is paused, answers with a checkpoint ABI code.
    fn xiranite_operation_checkpoint(offset: u64) -> u64;
    /// Reports one event into the operation's stream.
    fn xiranite_operation_emit(offset: u64) -> u64;
}

/// `xiranite.operation.checkpoint`'s typed request (ADR-0068: every capability has one).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckpointRequest<'scope> {
    operation_id: &'scope str,
    phase: &'scope str,
    processed_item_count: usize,
    total_item_count: usize,
}

/// `xiranite.operation.emit`'s typed request.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EmitRequest<'scope> {
    operation_id: &'scope str,
    event: Value,
}

/// The export names this module declares, next to the `#[unsafe(no_mangle)]` items themselves so
/// `tests/manifest_contract.rs` can compare them with `plugin_entry`'s list.
pub const CLASSQ_EXPORTED_ENTRY_POINTS: [&str; 5] = [
    CLASSQ_RUN_ENTRY_POINT,
    CLASSQ_NORMALIZE_ENTRY_POINT,
    CLASSQ_DESCRIBE_ENTRY_POINT,
    CLASSQ_PREVIEW_ENTRY_POINT,
    CLASSQ_RESULT_VIEW_ENTRY_POINT,
];

/// One operation's scope, read from the request document. ADR-0068 requires a `operationId` on every capability call,
/// and one plugin serves many operations.
#[derive(Debug, Clone)]
pub struct ExtismClassqScope {
    operation_id: String,
}

impl ExtismClassqScope {
    /// Reads the scope out of a parsed request document.
    #[must_use]
    pub fn of(request: &Value) -> Self {
        Self { operation_id: classq_operation_id_of(request).to_owned() }
    }

    /// The yield half of the surface: a separate type because `run_classq` holds the sink and the yield at the same
    /// time, and one `&mut` cannot be borrowed twice.
    #[must_use]
    pub fn run_control(&self) -> ExtismClassqRunControl {
        ExtismClassqRunControl { operation_id: self.operation_id.clone() }
    }

    /// The event half of the surface.
    #[must_use]
    pub fn event_sink(&self) -> ExtismClassqEventSink {
        ExtismClassqEventSink { operation_id: self.operation_id.clone() }
    }
}

/// `xiranite.operation.checkpoint`.
pub struct ExtismClassqRunControl {
    operation_id: String,
}

impl ExtismClassqRunControl {
    /// Binds the yield to an operation id.
    #[must_use]
    pub fn new(operation_id: &str) -> Self {
        Self { operation_id: operation_id.to_owned() }
    }
}

impl ClassqRunControl for ExtismClassqRunControl {
    fn checkpoint(
        &mut self,
        phase: ClassqPhase,
        processed_count: usize,
        total_count: usize,
    ) -> ClassqCheckpointOutcome {
        let request = CheckpointRequest {
            operation_id: &self.operation_id,
            phase: phase.as_str(),
            processed_item_count: processed_count,
            total_item_count: total_count,
        };
        let code = call_unit(&request, |offset| unsafe { xiranite_operation_checkpoint(offset) });
        // `0` is the ABI's reserved code, so an answer the vocabulary does not define is read as the safe one: stop
        // rather than keep moving folders for an operation this plugin cannot name. Same reading as
        // `crates/nodes/dissolvef/src/host.rs:576-579`.
        match ClassqCheckpointOutcome::try_from_abi_code(u8::try_from(code).unwrap_or(u8::MAX)) {
            Some(outcome) => outcome,
            None => ClassqCheckpointOutcome::Cancelled,
        }
    }
}

/// `xiranite.operation.emit`.
pub struct ExtismClassqEventSink {
    operation_id: String,
}

impl ExtismClassqEventSink {
    /// Binds the stream to an operation id.
    #[must_use]
    pub fn new(operation_id: &str) -> Self {
        Self { operation_id: operation_id.to_owned() }
    }
}

impl ClassqEventSink for ExtismClassqEventSink {
    fn on_event(&mut self, event: crate::contract::ClassqRunEvent) {
        // Progress reporting is best effort on purpose: a refused emit must not abort a classify that has already
        // moved files, and the event-buffer ceiling is the host's concern (ADR-0063 principle 9).
        let request = EmitRequest {
            operation_id: &self.operation_id,
            event: serde_json::to_value(&event).unwrap_or(Value::Null),
        };
        let _ = call_unit(&request, |offset| unsafe { xiranite_operation_emit(offset) });
    }
}

/// `classq_run`: one ClassQ operation, one JSON document in and one out.
#[unsafe(no_mangle)]
pub extern "C" fn classq_run() -> i32 {
    let request = match read_request_document() {
        Ok(request) => request,
        // A request that cannot be read cannot be answered as a result document either.
        Err(message) => return report_error(&message),
    };
    let scope = ExtismClassqScope::of(&request);
    let input = classq_input_of_value(classq_input_value_of(&request));
    let file_system = StdClassqFileSystem::new();
    let mut control = scope.run_control();
    let mut stream = scope.event_sink();
    let mut sink = ForwardingClassqEventSink::new(&mut stream);
    let response = run_classq_input(&input, &file_system, &mut sink, &mut control);
    respond(&response.to_string())
}

/// `classq_normalize_input`: the defaulting rule, no filesystem and no host call.
#[unsafe(no_mangle)]
pub extern "C" fn classq_normalize_input() -> i32 {
    match read_request_document() {
        Ok(request) => {
            let normalized = normalize_classq_input_document(&classq_input_of_value(classq_input_value_of(&request)));
            respond(
                &serde_json::to_value(&normalized).unwrap_or(Value::Null).to_string(),
            )
        }
        Err(message) => report_error(&message),
    }
}

/// `classq_describe`: the registry `def`, the entry points and the imported host surface.
#[unsafe(no_mangle)]
pub extern "C" fn classq_describe() -> i32 {
    respond(&describe_classq_plugin().to_string())
}

/// `preview`: the definition's `previewExport`, answering `preview(input) => string[]`.
#[unsafe(no_mangle)]
pub extern "C" fn preview() -> i32 {
    match read_request_document() {
        Ok(request) => {
            let input = classq_input_of_value(classq_input_value_of(&request));
            let language = classq_language_of(&request);
            let normalized = normalize_classq_input_document(&input);
            respond(&preview_document(&normalized, language).to_string())
        }
        Err(message) => report_error(&message),
    }
}

/// `result_view`: the definition's `resultExport`, answering `result(result) => {…}`.
#[unsafe(no_mangle)]
pub extern "C" fn result_view() -> i32 {
    match read_input_text() {
        Ok(text) => respond(&result_view_request_text(&text)),
        Err(message) => report_error(&message),
    }
}

/// One capability call whose answer is a number: write the request, invoke, release. Blocks are freed on every path,
/// so a batch of thousands of rows never grows linear memory per call.
fn call_unit(request: &impl Serialize, invoke: impl Fn(u64) -> u64) -> u64 {
    let bytes = serde_json::to_vec(request).unwrap_or_default();
    let offset = unsafe { alloc(bytes.len() as u64) };
    write_bytes_at(offset, &bytes);
    let code = invoke(offset);
    unsafe { free(offset) };
    code
}

/// The request document, decoded as JSON.
fn read_request_document() -> Result<Value, String> {
    let bytes = read_input_bytes();
    let text =
        String::from_utf8(bytes).map_err(|error| format!("ClassQ input is not valid UTF-8: {error}"))?;
    serde_json::from_str::<Value>(&text).map_err(|error| format!("Invalid ClassQ request: {error}"))
}

/// The input text, or the message to report.
fn read_input_text() -> Result<String, String> {
    let bytes = read_input_bytes();
    String::from_utf8(bytes).map_err(|error| format!("ClassQ input is not valid UTF-8: {error}"))
}

fn read_input_bytes() -> Vec<u8> {
    let length = unsafe { input_length() } as usize;
    let mut bytes = vec![0u8; length];
    let mut index = 0;
    while index + 8 <= length {
        let chunk = unsafe { input_load_u64(index as u64) };
        bytes[index..index + 8].copy_from_slice(&chunk.to_le_bytes());
        index += 8;
    }
    while index < length {
        bytes[index] = unsafe { input_load_u8(index as u64) };
        index += 1;
    }
    bytes
}

/// A block the host allocated: its size comes from `length`, its bytes from `load_*`. Both capabilities this plugin
/// calls answer with an ABI code rather than a block, so this is here for the adapter's own debugging and is not
/// wired into a call path; a capability that ever needs a reply block (a path-token resolution) reads it through
/// `extism:host/env`'s `length`/`load_u64`.
#[allow(dead_code)]
fn read_block(offset: u64) -> String {
    let length = unsafe { length(offset) } as usize;
    let mut bytes = vec![0u8; length];
    let mut index = 0;
    while index + 8 <= length {
        let chunk = unsafe { load_u64(offset + index as u64) };
        bytes[index..index + 8].copy_from_slice(&chunk.to_le_bytes());
        index += 8;
    }
    while index < length {
        bytes[index] = unsafe { load_u8(offset + index as u64) };
        index += 1;
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

fn write_bytes_at(offset: u64, bytes: &[u8]) {
    let mut index = 0;
    while index + 8 <= bytes.len() {
        let mut chunk = [0u8; 8];
        chunk.copy_from_slice(&bytes[index..index + 8]);
        unsafe { store_u64(offset + index as u64, u64::from_le_bytes(chunk)) };
        index += 8;
    }
    while index < bytes.len() {
        unsafe { store_u8(offset + index as u64, bytes[index]) };
        index += 1;
    }
}

/// Answers with a document on the output; `0` is the convention's "the output is the result".
fn respond(text: &str) -> i32 {
    let bytes = text.as_bytes();
    let offset = unsafe { alloc(bytes.len() as u64) };
    write_bytes_at(offset, bytes);
    unsafe { output_set(offset, bytes.len() as u64) };
    0
}

/// Reports a failure the plugin could not turn into a result document, returning non-zero so the host reads it as an
/// Extism error rather than an empty answer.
fn report_error(message: &str) -> i32 {
    let bytes = message.as_bytes();
    if bytes.is_empty() {
        return 1;
    }
    let offset = unsafe { alloc(bytes.len() as u64) };
    write_bytes_at(offset, bytes);
    unsafe { error_set(offset) };
    1
}
