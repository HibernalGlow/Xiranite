//! The Extism shell: five zero-parameter exports, one capability import, block plumbing.
//!
//! Compiled only for `--features wasm` on a wasm32 target (`src/lib.rs` gates it), because the imports
//! resolve solely inside an Extism isolate.
//!
//! ## The calling convention, and why it is this one
//!
//! `crates/xiranite-extism-adapter/src/compiled.rs:129-138` calls the manifest's `entry_point` through
//! `Plugin::call_with_host_context`, and the official Extism Rust host invokes exports with **no
//! arguments** (`raw_call` passes `&[]`; `function_exists` only accepts a `(0) -> i32` signature). So:
//!
//! * the request document arrives through `extism:host/env` `input_length` / `input_load_u64` /
//!   `input_load_u8`, never as a parameter;
//! * the answer leaves through `alloc` + `store_*` + `output_set`;
//! * the return value is an exit code, and the engine enforces the convention — ADR-0071 §3 measured a
//!   positive control returning `7` coming back as `Returned non-zero exit code: 7`. `0` therefore means
//!   "the output document is the result"; non-zero follows `error_set` and is reserved for the one case
//!   where there is no document to hand back.
//!
//! `plugins/{snf,transq,nameu,timeu}` export the `(u64) -> u64` PDK shape and are unlinkable by this
//! host (recorded in ADR-0068's "Follow-up this measurement created"); `crates/nodes/dissolvef` and
//! `plugins/logx` match the settled shape, and this file follows them.
//!
//! ## Capability imports
//!
//! Exactly one, in `extism:host/user`, named by the flattening rule `host_function_names.rs` publishes
//! (`xiranite.operation.checkpoint` → `xiranite_operation_checkpoint`): one block handle in and — for
//! this capability only — an integer out, because ADR-0066 puts a checkpoint on every item boundary and
//! wrapping a three-value enum in an allocated block per item would be the hottest allocation in the run
//! (`compiled.rs:208-215`). ADR-0071 retired the file family, so `std::fs` in [`crate::file_access`] is
//! what reaches the machine and there is no second import to declare.

use crate::contract::LinedupResult;
use crate::file_access::NativeFiles;
use crate::plugin_entry::{
    LINEDUP_DESCRIBE_ENTRY_POINT, LINEDUP_NORMALIZE_ENTRY_POINT, LINEDUP_PREVIEW_ENTRY_POINT,
    LINEDUP_RESULT_VIEW_ENTRY_POINT, LINEDUP_RUN_ENTRY_POINT, linedup_operation_id_of,
};
use crate::run_control::{CheckpointOutcome, LinedupRunControl};

/// A host function that answers with an integer code rather than a block: the checkpoint.
type HostCodeCall = unsafe extern "C" fn(request: u64) -> u64;

#[link(wasm_import_module = "extism:host/env")]
unsafe extern "C" {
    fn alloc(length: u64) -> u64;
    fn free(offset: u64);
    fn input_length() -> u64;
    fn input_load_u8(offset: u64) -> u8;
    fn input_load_u64(offset: u64) -> u64;
    fn store_u8(offset: u64, value: u8);
    fn store_u64(offset: u64, value: u64);
    fn output_set(offset: u64, length: u64);
    fn error_set(offset: u64);
}

/// The plugin's whole machine-capability surface: one import, reached through Extism's user-function
/// namespace, kept behind one type so a rename of the namespace has exactly one place to happen.
#[link(wasm_import_module = "extism:host/user")]
unsafe extern "C" {
    fn xiranite_operation_checkpoint(request: u64) -> u64;
}

/// The control that yields to the host once per batch.
struct HostCheckpointControl {
    operation_id: String,
}

impl LinedupRunControl for HostCheckpointControl {
    fn checkpoint(&mut self) -> CheckpointOutcome {
        // The adapter reads a live block for every capability call, including this one
        // (`compiled.rs:155-165` refuses an offset that is not a block), so the request is a real
        // document even though the answer is an integer. ADR-0068 requires the operation scope on every
        // cross-boundary call, and a pooled instance serves many operations.
        let request = serde_json::to_vec(&serde_json::json!({ "operationId": self.operation_id }))
            .unwrap_or_else(|_| b"{}".to_vec());
        let offset = unsafe { alloc(request.len() as u64) };
        write_bytes_at(offset, &request);
        let code = invoke(xiranite_operation_checkpoint, offset);
        // The host consumed the block during the call, so it is released before the next batch allocates.
        unsafe { free(offset) };
        CheckpointOutcome::from_abi_code(u8::try_from(code).unwrap_or(u8::MAX))
    }
}

/// One call through a code-answering capability import.
fn invoke(import: HostCodeCall, request: u64) -> u64 {
    unsafe { import(request) }
}

/// `linedup_run`: one Linedup operation, answering `nodeRunResultSchema`.
#[unsafe(no_mangle)]
pub extern "C" fn linedup_run() -> i32 {
    let text = read_input_text();
    let document = match serde_json::from_str(&text) {
        Ok(request) => {
            let operation_id = linedup_operation_id_of(&request).to_owned();
            let mut control = HostCheckpointControl { operation_id };
            crate::plugin_entry::run_linedup_request(&request, &NativeFiles, &mut control).to_string()
        }
        // The same branch as `run_linedup_request_text`, reached from the raw bytes so a garbage
        // request still answers with a document instead of an exit code.
        Err(error) => {
            LinedupResult::failure(format!("Linedup request was not valid JSON: {error}")).to_json().to_string()
        }
    };
    respond(&document)
}

/// `linedup_normalize_input`: the `toInput` defaults, no filesystem, no checkpoint.
#[unsafe(no_mangle)]
pub extern "C" fn linedup_normalize_input() -> i32 {
    text_entry(crate::plugin_entry::normalize_linedup_request_text)
}

/// `linedup_preview`: the card's two count lines.
#[unsafe(no_mangle)]
pub extern "C" fn linedup_preview() -> i32 {
    text_entry(crate::plugin_entry::preview_linedup_request_text)
}

/// `linedup_result_view`: the `Kept:` / `Removed:` view of a finished result.
#[unsafe(no_mangle)]
pub extern "C" fn linedup_result_view() -> i32 {
    text_entry(crate::plugin_entry::result_view_linedup_request_text)
}

/// `linedup_describe`: identity, entry points and the capability surface.
#[unsafe(no_mangle)]
pub extern "C" fn linedup_describe() -> i32 {
    respond(&crate::plugin_entry::describe_linedup_plugin_text())
}

/// The exports that take a document and answer a document with no host interaction at all.
fn text_entry(handler: impl Fn(&str) -> String) -> i32 {
    let document = handler(&read_input_text());
    if document.is_empty() {
        // Defensive: an empty output block would reach the launcher as a JSON parse failure with a
        // quoted empty excerpt, which is undebuggable. Nothing today returns empty.
        return report_error("Linedup produced an empty response document");
    }
    respond(&document)
}

fn read_input_text() -> String {
    String::from_utf8(read_input_bytes()).unwrap_or_default()
}

fn read_input_bytes() -> Vec<u8> {
    let length = unsafe { input_length() };
    let Ok(size) = usize::try_from(length) else {
        return Vec::new();
    };
    let mut bytes = vec![0u8; size];
    let mut index = 0;
    while index + 8 <= size {
        let chunk = unsafe { input_load_u64(index as u64) };
        bytes[index..index + 8].copy_from_slice(&chunk.to_le_bytes());
        index += 8;
    }
    while index < size {
        bytes[index] = unsafe { input_load_u8(index as u64) };
        index += 1;
    }
    bytes
}

fn respond(document: &str) -> i32 {
    let bytes = document.as_bytes();
    let offset = unsafe { alloc(bytes.len() as u64) };
    write_bytes_at(offset, bytes);
    unsafe { output_set(offset, bytes.len() as u64) };
    0
}

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

/// Every exported name, checked against `LINEDUP_ENTRY_POINTS` by `tests/plugin_contract.rs`.
pub const EXPORTED_NAMES: [&str; 5] = [
    LINEDUP_RUN_ENTRY_POINT,
    LINEDUP_NORMALIZE_ENTRY_POINT,
    LINEDUP_PREVIEW_ENTRY_POINT,
    LINEDUP_RESULT_VIEW_ENTRY_POINT,
    LINEDUP_DESCRIBE_ENTRY_POINT,
];
