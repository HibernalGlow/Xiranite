//! The exports of `samea.wasm`, and the thinnest layer in the crate.
//!
//! Every function here does three things: read the request block, hand its text to `crate::plugin_entry`,
//! answer with a block. All SameA decisions live in `plan`/`run`, all document shapes in `plugin_entry`,
//! all Extism mechanics in `extism_boundary`, so replacing any one of those sides does not touch this file.
//!
//! # Exports
//!
//! | Export | Signature | Purpose |
//! | --- | --- | --- |
//! | `samea_run` | `() -> i32` | one SameA operation, answering `nodeRunResponseSchema`; this is `manifest.toml`'s `entry_point` |
//! | `preview` | `() -> i32` | the `previewExport` the definition names (`node-definitions/samea.json:399`), no filesystem access |
//! | `result_view` | `() -> i32` | the `resultExport` the definition names (`:400`), no filesystem access |
//! | `normalizeInput` | `() -> i32` | the pure defaulting rule of `core.ts:80-97` |
//! | `describe` | `() -> i32` | the node `def`, the help block, the entry points and the capability surface |
//!
//! No `alloc`/`free` exports: on `wasm32-wasip1` those names already belong to the WASI libc's dlmalloc (a
//! `#[no_mangle] pub extern "C" fn free` fails to link with `duplicate symbol: free`), and the host
//! allocates the request block itself through `extism:host/env` (`CurrentPlugin::memory_new`, which is what
//! `compiled.rs:203` calls). `crates/nodes/dissolvef` exports its entry point alone for the same reason.
//!
//! Zero parameters everywhere, per `extism_boundary`'s note: the adapter drives exports through
//! `call_with_host_context`, which passes no wasm arguments, and a `(u64) -> u64` export is unlinkable there
//! (`crates/xiranite-extism-adapter/src/compiled.rs:27-35`). `plugins/timeu/src/plugin.rs` still shows the
//! older two-parameter form; ADR-0068's entry convention and the newest port
//! (`crates/nodes/dissolvef/src/host.rs:578-589`) are the current shape, and this crate follows those.
//!
//! `xiranite.operation.emit` and `xiranite.operation.checkpoint` are the only capabilities reached, and only
//! from `samea_run`; `preview`, `result_view`, `normalizeInput` and `describe` are pure and cannot touch the
//! machine.

use crate::contract::SameaRunResult;
use crate::extism_boundary::{
    ExtismSameaEventStream, ExtismSameaRunControl, SameaRunScope, read_request_document,
    read_request_text, respond,
};
use crate::fs_runtime::NativeSameaFileSystem;
use crate::plugin_entry::{
    describe_samea_plugin, normalize_samea_request_text, preview_samea_request_text,
    result_view_request_text, run_samea_request,
};

/// Reads the request, runs one operation, answers with the response document.
#[unsafe(no_mangle)]
pub extern "C" fn samea_run() -> i32 {
    let request = match read_request_document() {
        Ok(request) => request,
        // The same shape `core.ts:123`'s `catch` gave an unusable input: a failed run, not a trap.
        Err(message) => return respond(&failure_response_text(&message)),
    };
    let scope = SameaRunScope::from_request(&request);
    let mut stream = ExtismSameaEventStream::new(&scope);
    let mut control = ExtismSameaRunControl::new(&scope);
    let response =
        run_samea_request(&request, &mut NativeSameaFileSystem::new(), &mut stream, &mut control);
    respond(&response.to_string())
}

/// The `preview` export: the two summary lines plus the normalized input.
#[unsafe(no_mangle)]
pub extern "C" fn preview() -> i32 {
    respond(&preview_samea_request_text(&read_request_text()))
}

/// The `result_view` export: `{ success, message, lines }` from a stored or fresh result document.
#[unsafe(no_mangle)]
pub extern "C" fn result_view() -> i32 {
    respond(&result_view_request_text(&read_request_text()))
}

/// The `normalizeInput` export. The camelCase name is protocol rather than Rust style, so it is set as an
/// unsafe `export_name`, which takes precedence over `no_mangle` and is the only attribute needed here.
#[unsafe(export_name = "normalizeInput")]
pub extern "C" fn normalize_input() -> i32 {
    respond(&normalize_samea_request_text(&read_request_text()))
}

/// The `describe` export. No request is read: the answer is a property of the module.
#[unsafe(no_mangle)]
pub extern "C" fn describe() -> i32 {
    respond(&describe_samea_plugin().to_string())
}

/// The `nodeRunResponseSchema` answer for a request the plugin could not parse at all.
///
/// `plugin_entry::run_samea_request_text` has the same rule for text that *did* arrive but is not JSON;
/// this is the case where the block itself could not be read as a request.
fn failure_response_text(message: &str) -> String {
    let result =
        SameaRunResult { success: false, message: message.to_string(), data: None };
    serde_json::json!({
        "result": serde_json::to_value(&result).expect("a failure result is serializable"),
        "events": [],
    })
    .to_string()
}
