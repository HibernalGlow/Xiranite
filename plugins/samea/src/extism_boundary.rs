//! The Extism mechanism of `samea.wasm`, and nothing else.
//!
//! Block handles, the `extism:host/env` imports, the two `extism:host/user` capabilities, and the
//! read-request/answer-response plumbing. `crate::plugin` calls in here and `crate::plugin_entry` holds the
//! document shapes; neither knows that a block offset is a `u64`.
//!
//! Calling convention (ADR-0068, as the adapter enforces it):
//! the entry point takes **zero** wasm parameters and returns an `i32` exit code, because the official
//! Extism Rust host calls exports with `&[]` and `function_exists` only accepts a `(0, i32)` signature
//! (`crates/xiranite-extism-adapter/src/compiled.rs:27-35`). `0` means "the output block is the answer";
//! anything else carries an `error_set` message. Non-zero-on-failure is enforced by the engine, not by us
//! (ADR-0071 §3's positive control measured `quick() -> 7` arriving as `Returned non-zero exit code: 7`).
//!
//! Capability wire shape, from the same file (`compiled.rs:148-195`): one JSON block in, one `i64` out.
//! For `xiranite.operation.checkpoint` the `i64` is the ABI code (`1` continue, `2` paused, `3`
//! cancelled, `0` reserved for a host refusal — read as cancelled, which is the safe answer); for every
//! other capability the `i64` is the offset of a `{"ok":true,"data":…}` / `{"ok":false,"error":{…}}`
//! document, so a refusal is data one plan row can carry rather than a trap that ends the run.
//!
//! This module is `#[cfg(target_arch = "wasm32")]` and is compiled only by
//! `cargo build --target wasm32-wasip1`. A `wasm32-unknown-unknown` artifact would link but see no
//! preopens, so it is not a valid product for this node (ADR-0071 §8).

use serde::Serialize;
use serde_json::Value;

use crate::contract::SameaRunEvent;
use crate::fs_surface::{CheckpointOutcome, SameaEventSink, SameaRunControl};

#[link(wasm_import_module = "extism:host/env")]
unsafe extern "C" {
    fn alloc(length: u64) -> u64;
    fn free(offset: u64);
    fn input_length() -> u64;
    fn input_load_u8(offset: u64) -> u8;
    fn input_load_u64(offset: u64) -> u64;
    fn load_u8(offset: u64) -> u8;
    fn load_u64(offset: u64) -> u64;
    fn length(offset: u64) -> u64;
    fn store_u8(offset: u64, value: u8);
    fn store_u64(offset: u64, value: u64);
    fn output_set(offset: u64, value: u64);
    fn error_set(offset: u64);
}

// ADR-0068's capability names with the dots flattened to underscores, which is the injection the host
// derives from the manifest (`xiranite_plugin_api::host_function_symbol`).
#[link(wasm_import_module = "extism:host/user")]
unsafe extern "C" {
    fn xiranite_operation_checkpoint(offset: u64) -> u64;
    fn xiranite_operation_emit(offset: u64) -> u64;
}

/// `runOptions.operationId`, the scope every capability call carries (ADR-0068: plugin lifecycle is not
/// operation lifecycle). A host that omits it gets `""`, and the host's own authorization check is what
/// refuses a call that cannot be scoped.
#[derive(Debug, Clone, Default)]
pub struct SameaRunScope {
    /// The operation this call belongs to.
    pub operation_id: String,
}

impl SameaRunScope {
    /// Reads the scope out of a request document: `runOptions.operationId`, then `context.operationId`.
    #[must_use]
    pub fn from_request(request: &Value) -> Self {
        let from_run_options = request
            .get("runOptions")
            .and_then(|options| options.get("operationId"))
            .and_then(Value::as_str);
        let from_context = request
            .get("context")
            .and_then(|context| context.get("operationId"))
            .and_then(Value::as_str);
        Self {
            operation_id: from_run_options.or(from_context).unwrap_or_default().to_string(),
        }
    }
}

/// The request document of one export call: the node's `input` plus whatever scope the host supplied.
#[must_use]
pub fn read_request_document() -> Result<Value, String> {
    let text = read_request_text();
    serde_json::from_str(&text).map_err(|error| format!("Invalid SameA request: {error}"))
}

/// The request block as text. A block that is not valid UTF-8 reads lossily, which every handler below
/// then reports as a failed document rather than as a trap — the same rule
/// `plugin_entry::run_samea_request_text` applies to text it is handed.
#[must_use]
pub fn read_request_text() -> String {
    String::from_utf8_lossy(&read_input_bytes()).into_owned()
}

/// Answers with a JSON document and the success exit code.
pub fn respond(document: &str) -> i32 {
    let bytes = document.as_bytes();
    let offset = unsafe { alloc(bytes.len() as u64) };
    write_bytes_at(offset, bytes);
    unsafe { output_set(offset, bytes.len() as u64) };
    0
}

/// Reports a failure the plugin could not even turn into a result document, and returns the non-zero code
/// the engine reads as failure.
pub fn report_error(message: &str) -> i32 {
    let bytes = message.as_bytes();
    if bytes.is_empty() {
        return 1;
    }
    let offset = unsafe { alloc(bytes.len() as u64) };
    write_bytes_at(offset, bytes);
    unsafe { error_set(offset) };
    1
}

/// Streams each event through `xiranite.operation.emit`.
///
/// Progress reporting is best effort on purpose: a refused emit must not abort a classification that has
/// already moved some archives, and the event buffer ceiling is the host's concern
/// (ADR-0063 principle 9).
pub struct ExtismSameaEventStream<'scope> {
    scope: &'scope SameaRunScope,
}

impl<'scope> ExtismSameaEventStream<'scope> {
    #[must_use]
    pub fn new(scope: &'scope SameaRunScope) -> Self {
        Self { scope }
    }
}

impl SameaEventSink for ExtismSameaEventStream<'_> {
    fn on_event(&mut self, event: SameaRunEvent) {
        let request = EmitRequest {
            operation_id: self.scope.operation_id.clone(),
            event: serde_json::to_value(&event).expect("SameaRunEvent is serializable by construction"),
        };
        let _ = call_capability(&request, xiranite_operation_emit);
    }
}

/// Yields at every item boundary through `xiranite.operation.checkpoint`.
pub struct ExtismSameaRunControl<'scope> {
    scope: &'scope SameaRunScope,
}

impl<'scope> ExtismSameaRunControl<'scope> {
    #[must_use]
    pub fn new(scope: &'scope SameaRunScope) -> Self {
        Self { scope }
    }
}

impl SameaRunControl for ExtismSameaRunControl<'_> {
    fn checkpoint(
        &mut self,
        phase: &str,
        processed_item_count: usize,
        total_item_count: usize,
    ) -> CheckpointOutcome {
        let request = CheckpointRequest {
            operation_id: self.scope.operation_id.clone(),
            phase: phase.to_string(),
            processed_item_count,
            total_item_count,
        };
        let bytes = match serde_json::to_vec(&request) {
            Ok(bytes) => bytes,
            Err(_) => return CheckpointOutcome::Cancelled,
        };
        let offset = unsafe { alloc(bytes.len() as u64) };
        write_bytes_at(offset, &bytes);
        let code = unsafe { xiranite_operation_checkpoint(offset) };
        unsafe { free(offset) };
        // `0` is the ABI's reserved code, so an answer the vocabulary does not define is read as the safe
        // one: stop rather than keep renaming files for an operation that has ended.
        match code {
            1 => CheckpointOutcome::Continue,
            2 => CheckpointOutcome::Paused,
            3 => CheckpointOutcome::Cancelled,
            _ => CheckpointOutcome::Cancelled,
        }
    }
}

/// `{ operationId, phase, processedItemCount, totalItemCount }`, the checkpoint request the host reads.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckpointRequest {
    operation_id: String,
    phase: String,
    processed_item_count: usize,
    total_item_count: usize,
}

/// `{ operationId, event }`, where `event` keeps the `NodeRunEvent` shape the operation stream already
/// carries.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EmitRequest {
    operation_id: String,
    event: Value,
}

/// One capability call: encode, hand the host the block, read the block it answered with, and free both,
/// so a run over thousands of archives does not grow linear memory.
fn call_capability(request: &impl Serialize, invoke: unsafe extern "C" fn(u64) -> u64) -> Value {
    let bytes = match serde_json::to_vec(request) {
        Ok(bytes) => bytes,
        Err(error) => return refusal(&format!("could not encode the capability request: {error}")),
    };
    let offset = unsafe { alloc(bytes.len() as u64) };
    write_bytes_at(offset, &bytes);
    let reply_offset = unsafe { invoke(offset) };
    unsafe { free(offset) };
    if reply_offset == 0 {
        return refusal("the host answered without a reply block");
    }
    let text = read_block(reply_offset);
    unsafe { free(reply_offset) };
    serde_json::from_str(&text).unwrap_or_else(|error| {
        refusal(&format!("the host reply was not JSON: {error}"))
    })
}

fn refusal(message: &str) -> Value {
    serde_json::json!({ "ok": false, "error": { "code": "host_unavailable", "message": message } })
}

/// Reads a block the host allocated: its size from `length`, its bytes from `load_*`.
fn read_block(offset: u64) -> String {
    let bytes = read_bytes_at(offset, unsafe { length(offset) } as usize, load_u8, load_u64);
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Reads the request block the host installed for this call.
fn read_input_bytes() -> Vec<u8> {
    read_bytes_at_current(unsafe { input_length() } as usize)
}

fn read_bytes_at_current(length: usize) -> Vec<u8> {
    let mut bytes = vec![0u8; length];
    let mut index = 0usize;
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

fn read_bytes_at(
    offset: u64,
    length: usize,
    load_byte: unsafe extern "C" fn(u64) -> u8,
    load_word: unsafe extern "C" fn(u64) -> u64,
) -> Vec<u8> {
    let mut bytes = vec![0u8; length];
    let mut index = 0usize;
    while index + 8 <= length {
        let chunk = unsafe { load_word(offset + index as u64) };
        bytes[index..index + 8].copy_from_slice(&chunk.to_le_bytes());
        index += 8;
    }
    while index < length {
        bytes[index] = unsafe { load_byte(offset + index as u64) };
        index += 1;
    }
    bytes
}

fn write_bytes_at(offset: u64, bytes: &[u8]) {
    let mut index = 0usize;
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
