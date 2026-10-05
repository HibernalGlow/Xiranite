//! The Extism guest boundary: memory blocks, host imports and the JSON envelope.
//!
//! Everything version-specific about crossing the WASM border lives in this module
//! and nowhere else, which is why it exists at all instead of `extism-pdk`: the
//! host crate that will pin the PDK version (`crates/xiranite-plugins`, ADR-0063)
//! does not exist yet, so depending on a guessed PDK version here would be worse
//! than a thin, explicit shim. If that pin names a different spelling, only the
//! `#[link(...)]` attribute, the `#[link_name]` values below and
//! [`allocate_block`] change; the core and [`crate::host_runtime`] talk to a trait.
//!
//! # Border shape
//!
//! Bulk data never crosses as a struct or a return value: the host writes a
//! request into guest memory obtained from the guest's exported `alloc`, the entry
//! point answers with a packed block reference, and the host reads it back and
//! calls `free` (ADR-0066: path/handle tokens over bytes).
//!
//! * exported `alloc(length: u32) -> u32` — returns the offset of a live block of
//!   `length` bytes, preceded by an eight-byte little-endian length header so
//!   `free(offset)` needs no second argument;
//! * exported `free(offset: u32)` — releases a block made by `alloc`;
//! * entry points `(offset: u32, length: u32) -> u64`, where the result packs
//!   `(length << 32) | offset` of the response block, or `0` for "no response";
//! * host functions take the offset and length of a guest request block holding
//!   UTF-8 JSON and return a packed block reference to a guest block the host
//!   filled with the JSON answer. Host response blocks must also come from the
//!   guest's `alloc`, which is what lets [`call_host_json`] release them.
//!
//! The address casts assume a 32-bit wasm address space; compiling this feature
//! for a 64-bit target keeps the types working but is not a supported
//! configuration, so [`allocate_block`] asserts instead of silently truncating.
//!
//! # Host imports
//!
//! The logical names are the `host_functions` entries of `manifest.toml`. Extism registers a host
//! function as a namespace plus a name, so the wasm import is module `extism:host/user` with the
//! dotted name flattened to underscores:
//!
//! | Logical name (`manifest.toml`) | Import field | Signature |
//! | --- | --- | --- |
//! | `xiranite.operation.checkpoint` | `xiranite_operation_checkpoint` | `() -> u32` |
//! | `xiranite.operation.emit` | `xiranite_operation_emit` | `(u32, u32) -> u32` |
//! | `xiranite.now` | `xiranite_now` | `(u32, u32) -> u64` |
//!
//! That is the whole list. **ADR-0071 retired the `xiranite.fs.*` family**, so the six file imports
//! this module used to declare (`file.stat`, `file.list`, `file.readText`, `file.writeText`,
//! `file.ensureDirectory`, `file.setTimes`) are gone and their work happens in
//! [`crate::std_fs_runtime`] with `std::fs` against the WASI preopens the host grants. Nothing else
//! from ADR-0068's nine-name vocabulary is imported either: TimeU never moves, deletes or spawns, and
//! ADR-0066 defines no release counterpart for `xiranite.scheduler.acquire`, so a plugin cannot hold
//! an admission permit across a call — `lib.rs` records that as an open host-side decision rather
//! than stubbing it.
//!
//! # Response envelope
//!
//! Every JSON answer from the host uses one shape, so a refusal is data instead of
//! a WASM trap:
//!
//! ```json
//! { "ok": true, "data": { } }
//! { "ok": false, "error": "EPERM: operation not permitted" }
//! ```

use std::ptr;

use serde::Deserialize;
use serde_json::Value;

use crate::timeu_model::TimeuRunEvent;
use crate::timeu_runtime::{TimeuCheckpointOutcome, TimeuHostError};

/// Mirrors the `#[link(wasm_import_module = ...)]` attribute below, which cannot
/// take a constant. A test keeps the two in step.
pub const HOST_IMPORT_MODULE: &str = "extism:host/user";

/// `xiranite.checkpoint()` codes. The host owns the operation record, so it is the
/// only side that knows whether this call blocked.
pub const CHECKPOINT_CONTINUE: u32 = 0;
/// The host waited for a resume and the operation kept running.
pub const CHECKPOINT_RESUMED: u32 = 1;
/// The operation was cancelled; the plugin must stop at this boundary.
pub const CHECKPOINT_CANCELLED: u32 = 2;

/// The message ADR-0066 cancellation carries into the `failure` result. The
/// checkpoint signature is `() -> u32`, so the text cannot come from the host; the
/// operation's own cancellation reason stays in the host's event stream.
pub const CHECKPOINT_CANCELLED_MESSAGE: &str = "Operation cancelled.";

/// Bytes of the length header `alloc` writes before the offset it returns.
const BLOCK_HEADER_BYTES: usize = 8;

#[link(wasm_import_module = "extism:host/user")]
unsafe extern "C" {
    #[link_name = "xiranite_operation_checkpoint"]
    fn host_checkpoint() -> u32;

    #[link_name = "xiranite_operation_emit"]
    fn host_emit(offset: u32, length: u32) -> u32;

    #[link_name = "xiranite_now"]
    fn host_now(offset: u32, length: u32) -> u64;
}

/// The import for one JSON request/response host function, passed to
/// [`call_host_json`] as a value so the envelope handling exists once.
pub type HostJsonCall = unsafe extern "C" fn(u32, u32) -> u64;

pub fn now_import() -> HostJsonCall {
    host_now
}

/// `{ "ok": bool, "data": any, "error": string }`.
#[derive(Debug, Clone, Deserialize)]
struct HostEnvelope {
    #[serde(default)]
    ok: bool,
    #[serde(default)]
    data: Value,
    #[serde(default)]
    error: Option<String>,
}

/// Reserves `bytes.len()` bytes plus a length header and returns the payload
/// offset the host writes to and reads from.
pub fn allocate_block(bytes: &[u8]) -> u32 {
    let mut buffer: Vec<u8> = Vec::with_capacity(BLOCK_HEADER_BYTES + bytes.len());
    buffer.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
    buffer.extend_from_slice(bytes);

    let raw = Box::into_raw(buffer.into_boxed_slice()) as *mut u8;
    let payload = unsafe { raw.add(BLOCK_HEADER_BYTES) } as usize;
    assert!(
        payload <= u32::MAX as usize,
        "the Extism boundary addresses blocks as u32; build this feature for wasm32"
    );
    payload as u32
}

/// Reserves `length` zeroed bytes for the host to fill, returning the payload
/// offset. `alloc` exports this.
pub fn allocate_empty_block(length: u32) -> u32 {
    let mut buffer: Vec<u8> = vec![0u8; BLOCK_HEADER_BYTES + length as usize];
    buffer[..BLOCK_HEADER_BYTES].copy_from_slice(&(length as u64).to_le_bytes());

    let raw = Box::into_raw(buffer.into_boxed_slice()) as *mut u8;
    let payload = unsafe { raw.add(BLOCK_HEADER_BYTES) } as usize;
    assert!(
        payload <= u32::MAX as usize,
        "the Extism boundary addresses blocks as u32; build this feature for wasm32"
    );
    payload as u32
}

/// Copies a request block out and releases it.
///
/// # Safety
/// `offset` must come from an earlier `alloc` call for this same request.
pub unsafe fn take_request(offset: u32, length: u32) -> Vec<u8> {
    let bytes = unsafe { read_block(offset, length as usize) };
    unsafe { release_block(offset) };
    bytes
}

/// Reads `length` payload bytes without releasing the block.
///
/// # Safety
/// The bytes must be live guest memory.
unsafe fn read_block(offset: u32, length: usize) -> Vec<u8> {
    if length == 0 {
        return Vec::new();
    }
    // Never read past what `alloc` recorded, whatever the host claims.
    let recorded = unsafe { block_header_length(offset) };
    let trusted_length = length.min(recorded);
    let slice = unsafe { std::slice::from_raw_parts(offset as *const u8, trusted_length) };
    slice.to_vec()
}

/// # Safety
/// `offset` must point just past an eight-byte length header.
unsafe fn block_header_length(offset: u32) -> usize {
    let header = unsafe {
        std::slice::from_raw_parts((offset as usize - BLOCK_HEADER_BYTES) as *const u8, BLOCK_HEADER_BYTES)
    };
    u64::from_le_bytes(header.try_into().unwrap_or([0u8; BLOCK_HEADER_BYTES])) as usize
}

/// Releases a block made by `alloc`, using its own length header.
///
/// # Safety
/// `offset` must come from `alloc` and must not have been released yet.
pub unsafe fn release_block(offset: u32) {
    let length = unsafe { block_header_length(offset) };
    let raw = (offset as usize - BLOCK_HEADER_BYTES) as *mut u8;
    let total = BLOCK_HEADER_BYTES + length;
    // `Box::into_raw` produced a thin pointer with this exact size, so the
    // reconstructed slice has the allocation's real layout.
    unsafe {
        drop(Box::<[u8]>::from_raw(ptr::from_raw_parts_mut(raw, total)));
    }
}

/// `(length << 32) | offset`, the single `i64` a wasm function may return.
pub fn pack_block(offset: u32, length: u32) -> u64 {
    ((length as u64) << 32) | offset as u64
}

/// The inverse of [`pack_block`]; `0` means the host answered with nothing.
pub fn unpack_block(packed: u64) -> Option<(u32, u32)> {
    if packed == 0 {
        return None;
    }
    let offset = (packed & 0xFFFF_FFFF) as u32;
    let length = (packed >> 32) as u32;
    if offset == 0 || length == 0 {
        return None;
    }
    Some((offset, length))
}

/// Answers with a JSON document in a fresh block the host reads and frees.
pub fn respond(text: &str) -> u64 {
    let bytes = text.as_bytes();
    let offset = allocate_block(bytes);
    pack_block(offset, bytes.len() as u32)
}

/// One JSON round trip against a host function, envelope unwrapped.
pub fn call_host_json(call: HostJsonCall, request: &Value) -> Result<Value, TimeuHostError> {
    let payload = serde_json::to_vec(request)
        .map_err(|error| TimeuHostError::new(format!("host request failed: {error}")))?;
    let offset = allocate_block(&payload);
    let packed = unsafe { call(offset, payload.len() as u32) };
    unsafe { release_block(offset) };

    let (response_offset, response_length) = unpack_block(packed)
        .ok_or_else(|| TimeuHostError::new("host function returned no response block"))?;
    let response_bytes = unsafe { take_request(response_offset, response_length) };
    let text = String::from_utf8(response_bytes)
        .map_err(|_| TimeuHostError::new("host response was not UTF-8"))?;

    let envelope: HostEnvelope = serde_json::from_str(&text).map_err(|error| {
        TimeuHostError::new(format!("host response was not a Xiranite envelope: {error}"))
    })?;
    if !envelope.ok {
        return Err(TimeuHostError::new(
            envelope.error.unwrap_or_else(|| "host call failed".to_string()),
        ));
    }
    Ok(envelope.data)
}

/// A host call whose answer carries no data.
pub fn call_host_unit(call: HostJsonCall, request: &Value) -> Result<(), TimeuHostError> {
    call_host_json(call, request).map(|_| ())
}

/// `xiranite.operation.checkpoint()`.
pub fn checkpoint() -> TimeuCheckpointOutcome {
    match unsafe { host_checkpoint() } {
        CHECKPOINT_CANCELLED => TimeuCheckpointOutcome::Cancelled {
            message: CHECKPOINT_CANCELLED_MESSAGE.to_string(),
        },
        CHECKPOINT_RESUMED => TimeuCheckpointOutcome::Resumed,
        _ => TimeuCheckpointOutcome::Continue,
    }
}

/// `xiranite.operation.emit()` with one `NodeRunEvent`.
pub fn emit(event: &TimeuRunEvent) -> Result<(), TimeuHostError> {
    let payload = serde_json::to_vec(&event.to_json())
        .map_err(|error| TimeuHostError::new(format!("event encoding failed: {error}")))?;
    let offset = allocate_block(&payload);
    let code = unsafe { host_emit(offset, payload.len() as u32) };
    unsafe { release_block(offset) };
    if code != 0 {
        return Err(TimeuHostError::new("xiranite.emit refused the event"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_module_constant_matches_the_link_attribute() {
        // The attribute cannot take a constant, so this is the guard that keeps
        // the documented name and the compiled import identical.
        assert_eq!(HOST_IMPORT_MODULE, "extism:host/user");
    }

    // `allocate_block`/`read_block`/`release_block` are deliberately not tested
    // here: they hand out `u32` offsets, so on a 64-bit host the documented
    // address assertion fires before any interesting behaviour runs. That layer is
    // covered by the host integration test `crates/xiranite-plugins` will own.
    #[test]
    fn host_envelope_accepts_both_answers_and_defaults() {
        let ok: HostEnvelope = serde_json::from_str(r#"{"ok":true,"data":{"text":null}}"#).unwrap();
        assert!(ok.ok);
        assert_eq!(ok.data["text"], serde_json::Value::Null);

        let refused: HostEnvelope = serde_json::from_str(r#"{"ok":false,"error":"EPERM"}"#).unwrap();
        assert!(!refused.ok);
        assert_eq!(refused.error.as_deref(), Some("EPERM"));

        let sparse: HostEnvelope = serde_json::from_str("{}").unwrap();
        assert!(!sparse.ok, "a host answer without `ok` is a refusal, not a success");
        assert_eq!(sparse.data, serde_json::Value::Null);
        assert_eq!(refused.data, serde_json::Value::Null);
    }

    #[test]
    fn packed_blocks_round_trip_and_zero_means_absent() {
        assert_eq!(unpack_block(0), None);
        assert_eq!(unpack_block(pack_block(16, 1024)), Some((16, 1024)));
        assert_eq!(unpack_block(pack_block(0, 8)), None);
        assert_eq!(unpack_block(pack_block(8, 0)), None);
    }

    #[test]
    fn checkpoint_codes_map_onto_the_runtime_verdicts() {
        assert_eq!(CHECKPOINT_CONTINUE, 0);
        assert_eq!(CHECKPOINT_RESUMED, 1);
        assert_eq!(CHECKPOINT_CANCELLED, 2);
        assert_eq!(CHECKPOINT_CANCELLED_MESSAGE, "Operation cancelled.");
    }
}
