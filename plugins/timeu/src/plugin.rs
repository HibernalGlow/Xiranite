//! The Extism exports of `timeu.wasm` (compiled only for feature `wasm` on a
//! wasm32 target; see `lib.rs`).
//!
//! This file is deliberately the thinnest layer in the crate: read a request block,
//! hand the JSON text to `plugin_entry`, write the answer block. All TimeU decisions
//! live in `timeu_core`, and the boundary's block/import conventions live in
//! `extism_boundary`, so replacing either side does not touch this one.
//!
//! # Exports
//!
//! | Export | Signature | Purpose |
//! | --- | --- | --- |
//! | `alloc` | `(u32) -> u32` | gives the host a guest block for a request |
//! | `free` | `(u32) -> ()` | releases a block `alloc` made |
//! | `run` | `(u32, u32) -> u64` | one TimeU operation, answering `nodeRunResponseSchema` |
//! | `normalizeInput` | `(u32, u32) -> u64` | the pure defaulting rule, for a host that wants to preview or persist it |
//! | `describe` | `() -> u64` | node `def`, entry points and the host functions this module imports |
//!
//! `run` is the entry point name the operation manager should record in the node
//! registry; `manifest.json` names the module.

use crate::extism_boundary;
use crate::host_runtime::HostTimeuRuntime;
use crate::plugin_entry::{
    describe_timeu_plugin, normalize_timeu_request_text, run_timeu_request_text,
};
use crate::timeu_model::TimeuRunEvent;
use crate::timeu_runtime::TimeuEventSink;

/// Streams every event to `xiranite.emit` while `plugin_entry` collects the same
/// events into the response document.
struct HostTimeuEventStream;

impl TimeuEventSink for HostTimeuEventStream {
    fn on_event(&mut self, event: TimeuRunEvent) {
        // Progress reporting is best effort on purpose: a refused emit must not
        // abort a restore that has already stamped some files, and the operation's
        // event buffer ceiling is the host's concern (ADR-0063 principle 9).
        let _ = extism_boundary::emit(&event);
    }
}

/// Reads a request block, hands the text to `handler`, and answers with a packed
/// response block. A non-UTF-8 request reads as empty text, which every handler
/// below reports as a failure result rather than a trap.
fn answer_with(
    offset: u32,
    length: u32,
    handler: impl Fn(&str) -> String,
) -> u64 {
    let bytes = unsafe { extism_boundary::take_request(offset, length) };
    let text = String::from_utf8(bytes).unwrap_or_default();
    extism_boundary::respond(&handler(&text))
}

/// `alloc(length: u32) -> u32` for the Extism host.
#[no_mangle]
pub extern "C" fn alloc(length: u32) -> u32 {
    extism_boundary::allocate_empty_block(length)
}

/// `free(offset: u32)`, the counterpart of [`alloc`].
///
/// # Safety
/// Called by the host with an offset `alloc` returned, exactly once per block.
#[no_mangle]
pub unsafe extern "C" fn free(offset: u32) {
    unsafe { extism_boundary::release_block(offset) };
}

/// Runs one TimeU operation.
///
/// # Safety
/// `offset`/`length` must describe a request block `alloc` produced.
#[no_mangle]
pub unsafe extern "C" fn run(offset: u32, length: u32) -> u64 {
    answer_with(offset, length, |text| {
        run_timeu_request_text(text, &HostTimeuRuntime::new(), &mut HostTimeuEventStream)
    })
}

/// Answers with the normalized input document, without any host IO.
///
/// # Safety
/// See [`run`].
#[no_mangle]
// The Extism entry point name is `normalizeInput`, matching the registry's
// camelCase function names; the wasm export name is protocol, not Rust style.
#[allow(non_snake_case)]
pub unsafe extern "C" fn normalizeInput(offset: u32, length: u32) -> u64 {
    answer_with(offset, length, normalize_timeu_request_text)
}

/// Answers with the node description and the host surface this module imports.
#[no_mangle]
pub extern "C" fn describe() -> u64 {
    extism_boundary::respond(&describe_timeu_plugin().to_string())
}
