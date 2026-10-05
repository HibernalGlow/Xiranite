//! The Extism guest boundary: block memory, the host-function imports, and the byte conventions.
//!
//! Everything version-specific about crossing the WASM border lives here and nowhere else. It is
//! deliberately not `extism-pdk`: ADR-0063 has not fixed the PDK version for the crate that will own
//! it, so a guessed dependency would be worse than a thin, explicit shim. `plugins/logx` uses the
//! same shape and is the port ADR-0068 measured as matching the settled entry convention, so this
//! file follows it:
//!
//! * an entry point is **zero-parameter and returns `i32`** (`extism` 1.30.0 calls exports with
//!   `&[]`, and a non-zero return is read as failure by the engine — ADR-0068's bullet on the entry
//!   convention, re-measured in ADR-0071 §3 with a `quick() -> 7` positive control);
//! * the request document arrives through `input_length`/`input_load_u64`/`input_load_u8`;
//! * the answer is written into an `alloc`'d block, published with `output_set`, and the entry
//!   returns `0`; a refusal writes the message with `error_set` and returns `1`;
//! * a capability call is one block offset in, one block offset out, in module
//!   `extism:host/user`, named by the flattened symbol in
//!   [`crate::host_functions::host_function_symbol`]. The offset — not an offset/length pair — is
//!   what the official PDK passes (`extism-pdk-1.4.1/src/memory.rs`: `From<Memory> for u64` yields
//!   `m.0.offset`), and the callee reads the size with `length(offset)`.
//!
//! ## What is *not* imported
//!
//! `std::fs` is used directly (`crate::cli_locator`), because ADR-0071 serves file IO through the
//! WASI preopens the manifest grants; and `std::process::Command` is not used, because the same
//! measurement found it answering `Unsupported` — hence `xiranite_process_run` below.

use serde_json::Value;

use crate::host_functions::{HostFailure, HostResponse, PluginError};

/// Mirrors the `#[link(wasm_import_module = ...)]` attributes, which cannot take a constant. A test
/// keeps the two in step.
pub const HOST_ENV_MODULE: &str = "extism:host/env";
/// The module every Xiranite capability is registered in by the Extism adapter.
pub const HOST_USER_MODULE: &str = "extism:host/user";

/// `xiranite.operation.checkpoint`'s import symbol (`host_function_names.rs:76`).
pub const CHECKPOINT_SYMBOL: &str = "xiranite_operation_checkpoint";
/// `xiranite.operation.emit`'s import symbol (`host_function_names.rs:78`).
pub const EMIT_SYMBOL: &str = "xiranite_operation_emit";
/// `xiranite.process.run`'s import symbol (`host_function_names.rs:79`).
pub const PROCESS_RUN_SYMBOL: &str = "xiranite_process_run";

#[link(wasm_import_module = "extism:host/env")]
unsafe extern "C" {
    fn input_length() -> u64;
    fn input_load_u8(offset: u64) -> u8;
    fn input_load_u64(offset: u64) -> u64;
    fn length(offset: u64) -> u64;
    fn alloc(length: u64) -> u64;
    fn free(offset: u64);
    fn load_u8(offset: u64) -> u8;
    fn load_u64(offset: u64) -> u64;
    fn store_u8(offset: u64, value: u8);
    fn store_u64(offset: u64, value: u64);
    fn output_set(offset: u64, length: u64);
    fn error_set(offset: u64);
}

#[link(wasm_import_module = "extism:host/user")]
unsafe extern "C" {
    #[link_name = "xiranite_operation_checkpoint"]
    fn host_checkpoint(offset: u64) -> u64;

    #[link_name = "xiranite_operation_emit"]
    fn host_emit(offset: u64) -> u64;

    #[link_name = "xiranite_process_run"]
    fn host_process_run(offset: u64) -> u64;
}

/// One capability entry, passed to [`call_host_json`] as a value so the block and envelope
/// handling exists once for all three.
pub type HostCall = unsafe extern "C" fn(u64) -> u64;

/// The `xiranite.operation.checkpoint` import.
#[must_use]
pub fn checkpoint_import() -> HostCall {
    host_checkpoint
}

/// The `xiranite.operation.emit` import.
#[must_use]
pub fn emit_import() -> HostCall {
    host_emit
}

/// The `xiranite.process.run` import.
#[must_use]
pub fn process_run_import() -> HostCall {
    host_process_run
}

/// The whole request document as text. A non-UTF-8 request reads as the empty string, which every
/// entry point below reports as a failed result rather than a trap.
#[must_use]
pub fn read_request_text() -> String {
    let bytes = read_input_bytes();
    String::from_utf8(bytes).unwrap_or_default()
}

fn read_input_bytes() -> Vec<u8> {
    let total = unsafe { input_length() };
    read_block_from(total, |offset| unsafe { input_load_u64(offset) }, |offset| unsafe { input_load_u8(offset) })
}

/// The bytes of a guest block the host filled, using `length()` as the size.
fn read_host_block(offset: u64) -> Vec<u8> {
    if offset == 0 {
        return Vec::new();
    }
    let total = unsafe { length(offset) };
    read_block_from(total, |at| unsafe { load_u64(at) }, |at| unsafe { load_u8(at) })
}

fn read_block_from<F, G>(total: u64, mut load_chunk: F, mut load_byte: G) -> Vec<u8>
where
    F: FnMut(u64) -> u64,
    G: FnMut(u64) -> u8,
{
    let length = usize::try_from(total).unwrap_or(usize::MAX);
    let mut bytes = vec![0u8; length];
    let mut index = 0usize;
    while index + 8 <= length {
        let chunk = load_chunk(index as u64);
        bytes[index..index + 8].copy_from_slice(&chunk.to_le_bytes());
        index += 8;
    }
    while index < length {
        bytes[index] = load_byte(index as u64);
        index += 1;
    }
    bytes
}

/// Writes bytes into a fresh guest block and returns its offset.
fn write_block(bytes: &[u8]) -> u64 {
    let offset = unsafe { alloc(bytes.len() as u64) };
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
    offset
}

/// Publishes the answer document and returns the engine's success code (`0`).
///
/// The entry returns rather than calling `output_set` with nothing: ADR-0071 §3 measured that a
/// non-zero return *is* the failure signal, so `0` here means "the output document is the answer".
pub fn respond(text: &str) -> i32 {
    let bytes = text.as_bytes();
    let offset = write_block(bytes);
    unsafe { output_set(offset, bytes.len() as u64) };
    0
}

/// Publishes an error message and returns the engine's failure code (`1`).
pub fn report_error(message: &str) -> i32 {
    let bytes = message.as_bytes();
    if bytes.is_empty() {
        return 1;
    }
    let offset = write_block(bytes);
    unsafe { error_set(offset) };
    1
}

/// One capability round trip: JSON in a block, envelope out, `ok` unwrapped.
///
/// A refusal inside a well-formed envelope comes back as [`HostFailure::Refusal`] with its
/// `PluginError`, so the caller can branch on the code (`xiranite.process.run`'s `not_found *is*
/// the node's "SoundSwitch is not installed" answer). Only an answer the adapter cannot read at all
/// becomes [`HostFailure::MalformedAnswer`].
///
/// # Errors
///
/// See above: a refusal or an unreadable answer, never a panic.
pub fn call_host_json(call: HostCall, request: &Value) -> Result<Value, HostFailure> {
    let payload = serde_json::to_vec(request)
        .map_err(|error| HostFailure::MalformedAnswer(format!("host request failed: {error}")))?;
    let offset = write_block(&payload);
    let response_offset = unsafe { call(offset) };
    unsafe { free(offset) };

    let response_bytes = read_host_block(response_offset);
    if response_offset != 0 {
        unsafe { free(response_offset) };
    }
    if response_bytes.is_empty() {
        return Err(HostFailure::MalformedAnswer(
            "host function returned no response block".to_owned(),
        ));
    }
    let text = String::from_utf8(response_bytes)
        .map_err(|_| HostFailure::MalformedAnswer("host response was not UTF-8".to_owned()))?;
    match HostResponse::decode(&text) {
        Ok(HostResponse::Ok(value)) => Ok(value),
        Ok(HostResponse::Err(refusal)) => Err(HostFailure::Refusal(refusal)),
        Err(detail) => Err(HostFailure::MalformedAnswer(detail)),
    }
}

/// `xiranite.process.run`: the one call that reaches another program.
///
/// # Errors
///
/// Propagates whatever [`call_host_json`] reports; `crate::soundw_runtime::SoundwProcessOutput`
/// turns both kinds into a non-zero exit, which is what `platform.ts:21-24`'s `catch` did.
pub fn call_process_run(request: &Value) -> Result<Value, HostFailure> {
    call_host_json(process_run_import(), request)
}

/// `xiranite.operation.emit`, best effort: the caller logs and carries on, because a refused
/// progress event must not fail a command that already ran.
///
/// # Errors
///
/// Propagates whatever [`call_host_json`] reports.
pub fn emit_event(event: &Value) -> Result<Value, HostFailure> {
    call_host_json(emit_import(), event)
}

/// `xiranite.operation.checkpoint`.
///
/// # Errors
///
/// Propagates whatever [`call_host_json`] reports. A refusal here is not a cancellation: only
/// `HostCheckpointOutcome::Cancelled` stops the run.
pub fn checkpoint(request: &Value) -> Result<Value, HostFailure> {
    call_host_json(checkpoint_import(), request)
}

/// The `PluginError` half of a failure, when there is one.
#[must_use]
pub fn refusal_of(failure: &HostFailure) -> Option<&PluginError> {
    match failure {
        HostFailure::Refusal(error) => Some(error),
        HostFailure::MalformedAnswer(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host_functions::HostErrorCode;

    #[test]
    fn import_modules_match_the_documented_names() {
        // The `#[link]` attributes cannot take constants, so this is the guard that keeps the
        // documented module names and the compiled imports identical.
        assert_eq!(HOST_ENV_MODULE, "extism:host/env");
        assert_eq!(HOST_USER_MODULE, "extism:host/user");
    }

    #[test]
    fn symbols_match_the_capability_vocabulary() {
        use crate::host_functions::{
            HOST_FUNCTION_OPERATION_CHECKPOINT, HOST_FUNCTION_OPERATION_EMIT,
            HOST_FUNCTION_PROCESS_RUN, host_function_symbol,
        };
        assert_eq!(host_function_symbol(HOST_FUNCTION_OPERATION_CHECKPOINT), Some(CHECKPOINT_SYMBOL));
        assert_eq!(host_function_symbol(HOST_FUNCTION_OPERATION_EMIT), Some(EMIT_SYMBOL));
        assert_eq!(host_function_symbol(HOST_FUNCTION_PROCESS_RUN), Some(PROCESS_RUN_SYMBOL));
    }

    #[test]
    fn a_failure_keeps_its_code_and_its_text() {
        let refusal = HostFailure::Refusal(PluginError {
            code: HostErrorCode::NotFound,
            reported_code: None,
            message: "SoundSwitch.CLI.exe is not registered".to_owned(),
        });
        assert_eq!(refusal.code(), HostErrorCode::NotFound);
        assert_eq!(refusal.message(), "SoundSwitch.CLI.exe is not registered");
        assert_eq!(refusal_of(&refusal).map(PluginError::code), Some(HostErrorCode::NotFound));

        // Negative control: an unreadable answer is *not* a refusal, so it can never be reported to
        // the user as though the operation had declined.
        let malformed = HostFailure::MalformedAnswer("host response was not UTF-8".to_owned());
        assert_eq!(refusal_of(&malformed), None);
        assert_eq!(malformed.code(), HostErrorCode::HostFailure);
        assert_eq!(malformed.to_string(), "host response was not UTF-8");
    }
}
