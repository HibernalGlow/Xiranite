//! Extism entry points for the LogX plugin: JSON in, JSON out, plus the two host functions this port
//! actually calls (`xiranite.checkpoint`, `xiranite.emit`).
//!
//! Compiled only with the `wasm` feature, since the import symbols resolve solely inside an Extism host.
//! Each exported name below is also the wasm export name the Axum/Extism host calls. Input and output
//! follow Extism's current plugin ABI (`extism:host/env`, matching `extism/rust-pdk` `src/extism.rs`) so
//! the crate stays free of the PDK and its derive macro.

use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::envelope::LogEnvelope;
use crate::query::LogQuery;
use crate::run::{LogxCheckpointDecision, LogxInput, LogxProgressEvent, LogxResult, LogxSource};

#[link(wasm_import_module = "extism:host/user")]
unsafe extern "C" {
    fn xiranite_checkpoint() -> i32;
    fn xiranite_emit(offset: u64);
}

#[link(wasm_import_module = "extism:host/env")]
unsafe extern "C" {
    fn input_length() -> u64;
    fn input_load_u8(offset: u64) -> u8;
    fn input_load_u64(offset: u64) -> u64;
    fn alloc(length: u64) -> u64;
    fn free(offset: u64);
    fn store_u8(offset: u64, value: u8);
    fn store_u64(offset: u64, value: u64);
    fn output_set(offset: u64, length: u64);
    fn error_set(offset: u64);
}

/// `runLogx(input, runtime)` (`core.ts:133`). The host hands over decoded JSONL text per file because
/// directory discovery, gzip decode and path permissions are machine capability (ADR-0063 principle 8).
#[no_mangle]
pub extern "C" fn run_logx() -> i32 {
    let request = match read_request::<LogxRunRequest>() {
        Ok(request) => request,
        // The same shape as the `catch` in `core.ts:155-157`: an unusable request is a failed result.
        Err(message) => return respond(&LogxResult::failure(message)),
    };
    // Two separate bindings because the pipeline borrows each host callback mutably for its whole run.
    let mut emit: fn(&LogxProgressEvent) = ExtismHostBridge::emit;
    let mut wait_for_checkpoint: fn() -> LogxCheckpointDecision = ExtismHostBridge::checkpoint;
    let result = crate::run::run_logx_from_source(
        &request.input,
        &request.source,
        &mut emit,
        &mut wait_for_checkpoint,
    );
    respond(&result)
}

/// `parseLogJsonl` for hosts that stream a file in pieces instead of passing its whole text to `run_logx`.
#[no_mangle]
pub extern "C" fn parse_log_jsonl() -> i32 {
    json_entry(|request: LogJsonlRequest| crate::jsonl::parse_log_jsonl(&request.text))
}

#[no_mangle]
pub extern "C" fn query_log_events() -> i32 {
    json_entry(|request: LogEventQueryRequest| {
        crate::query::query_logs(&request.events, &request.query)
    })
}

#[no_mangle]
pub extern "C" fn aggregate_log_events() -> i32 {
    json_entry(|request: LogEventsRequest| crate::query::aggregate_logs(&request.events))
}

#[no_mangle]
pub extern "C" fn summarize_logx_sessions() -> i32 {
    json_entry(|request: LogEventsRequest| {
        crate::telemetry::summarize_logx_sessions(&request.events)
    })
}

#[no_mangle]
pub extern "C" fn create_logx_telemetry() -> i32 {
    json_entry(|request: LogEventsRequest| crate::telemetry::create_logx_telemetry(&request.events))
}

#[no_mangle]
pub extern "C" fn normalize_logx_input() -> i32 {
    json_entry(|input: LogxInput| crate::run::normalize_logx_input(&input))
}

/// The structured query LogX would run, limit-free the way `createLogxQuery(normalized, false)` is so the
/// host receives every match and applies the result limit itself.
#[no_mangle]
pub extern "C" fn create_logx_query() -> i32 {
    json_entry(|input: LogxInput| crate::run::create_logx_query_with_limit(&input, false))
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogxRunRequest {
    pub input: LogxInput,
    pub source: LogxSource,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogJsonlRequest {
    pub text: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEventsRequest {
    pub events: Vec<LogEnvelope>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEventQueryRequest {
    pub events: Vec<LogEnvelope>,
    pub query: LogQuery,
}

fn json_entry<T, R, F>(handle: F) -> i32
where
    T: DeserializeOwned,
    R: Serialize,
    F: FnOnce(T) -> R,
{
    let request = match read_request::<T>() {
        Ok(request) => request,
        Err(message) => return report_error(&message),
    };
    respond(&handle(request))
}

fn read_request<T: DeserializeOwned>() -> Result<T, String> {
    let bytes = read_input_bytes();
    let text = std::str::from_utf8(&bytes)
        .map_err(|error| format!("LogX input is not valid UTF-8: {error}"))?;
    serde_json::from_str(text).map_err(|error| format!("Invalid LogX request: {error}"))
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

fn respond<T: Serialize>(value: &T) -> i32 {
    match serde_json::to_vec(value) {
        Ok(bytes) => {
            write_output_bytes(&bytes);
            0
        }
        Err(error) => report_error(&format!("LogX could not serialize its result: {error}")),
    }
}

fn write_output_bytes(bytes: &[u8]) {
    let offset = unsafe { alloc(bytes.len() as u64) };
    write_bytes_at(offset, bytes);
    unsafe { output_set(offset, bytes.len() as u64) };
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

/// The plugin's whole machine-capability surface: two host functions, both reached through Extism's
/// user-function namespace. Keeping them behind one type leaves a single place to re-point if the host
/// registers `xiranite` as the import namespace instead of folding it into the function name.
struct ExtismHostBridge;

impl ExtismHostBridge {
    /// `xiranite.emit`: progress stays a host event, so the operation monitor sees the payloads the Bun
    /// node produced.
    fn emit(event: &LogxProgressEvent) {
        let bytes = match serde_json::to_vec(event) {
            Ok(bytes) => bytes,
            Err(_) => return,
        };
        let offset = unsafe { alloc(bytes.len() as u64) };
        write_bytes_at(offset, &bytes);
        unsafe { xiranite_emit(offset) };
        // The host consumed the handle during the call, so it returns before the next file allocates.
        unsafe { free(offset) };
    }

    /// `xiranite.checkpoint` per parsed file (ADR-0066): the host blocks inside this call while the
    /// operation is paused and answers non-zero once it is cancelled.
    fn checkpoint() -> LogxCheckpointDecision {
        match unsafe { xiranite_checkpoint() } {
            0 => LogxCheckpointDecision::Continue,
            _ => LogxCheckpointDecision::Cancel,
        }
    }
}
