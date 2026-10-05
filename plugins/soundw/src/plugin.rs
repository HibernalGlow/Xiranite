//! The Extism exports of `soundw.wasm`, compiled only for feature `wasm` on a wasm32 target.
//!
//! The thinnest layer in the crate: read the request block, hand the text to `crate::plugin_entry`,
//! publish the answer block. All SoundW decisions live in `soundw_core`, the boundary's block and
//! import conventions live in `extism_boundary`, and the host's machine capabilities are reached
//! through `host_runtime`, so replacing any one of the three does not touch the others.
//!
//! # Exports
//!
//! Each one is zero-parameter and answers `i32`, which is the shape the official Extism Rust host
//! can actually call (ADR-0068: `extism` invokes an export with `&[]`, and ADR-0071 §3 measured that
//! a non-zero return is read as failure). The document each export reads and writes is documented
//! in `crate::plugin_entry`.
//!
//! | Export | Reads | Answers |
//! | --- | --- | --- |
//! | `soundw_run` | `nodeRunRequestSchema` (or a bare `SoundwInput`) | `nodeRunResponseSchema` |
//! | `soundw_normalize_input` | the same request | `{ normalized, violations, dangerous }` or `{ error }` |
//! | `soundw_preview` | `{ input, language }` | `{ lines: string[] }` |
//! | `soundw_result_view` | `{ result }` | `{ success, message, lines }` |
//! | `soundw_describe` | nothing | the node `def`, entry points, capability surface and commands |
//!
//! `manifest.toml` `[backend] entry_point` names `soundw_run`, which is the one the operation
//! manager calls.

use serde_json::Value;

use crate::extism_boundary::{self, HostCall};
use crate::host_functions::emit_request;
use crate::host_runtime::HostSoundwRuntime;
use crate::plugin_entry::{
    describe_soundw_plugin, normalize_soundw_request_text, preview_request_text,
    result_view_request_text, run_soundw_request_text, soundw_operation_id_of,
};
use crate::soundw_model::SoundwRunEvent;
use crate::soundw_runtime::SoundwEventSink;

/// Streams every event to `xiranite.operation.emit` while `plugin_entry` collects the same events
/// into the response document, so the operation's history and its answer agree.
struct HostSoundwEventStream {
    operation_id: String,
}

impl SoundwEventSink for HostSoundwEventStream {
    fn on_event(&mut self, event: SoundwRunEvent) {
        // Progress reporting is best effort on purpose: a refused emit must not fail a command that
        // already ran, and the event-buffer ceiling is the host's concern (ADR-0063 principle 9).
        let _ = emit_event_for(self.operation_id.as_str(), &event);
    }
}

/// The one emit call, split out so a host that wants to route events through a different import can
/// replace exactly this line.
fn emit_event_for(operation_id: &str, event: &SoundwRunEvent) -> Result<Value, crate::host_functions::HostFailure> {
    let request = emit_request(operation_id, &event.to_json());
    // `emit_import` is fetched through the boundary's accessor so the import list in
    // `extism_boundary` stays the single place the three capability symbols are declared.
    let call: HostCall = extism_boundary::emit_import();
    extism_boundary::call_host_json(call, &request)
}

/// Runs one SoundW operation.
#[no_mangle]
pub extern "C" fn soundw_run() -> i32 {
    let text = extism_boundary::read_request_text();
    // The request is parsed once here for its operation identity and again inside `plugin_entry` for
    // its input: the extra parse is a few hundred bytes of JSON, and it keeps `plugin_entry` free of
    // any Extism knowledge, which is the whole point of the boundary split (ADR-0068).
    let operation_id = serde_json::from_str::<Value>(&text)
        .ok()
        .map(|request| soundw_operation_id_of(&request))
        .unwrap_or_default();
    let runtime = HostSoundwRuntime::new(operation_id.clone());
    let mut stream = HostSoundwEventStream { operation_id };
    extism_boundary::respond(&run_soundw_request_text(&text, &runtime, &mut stream))
}

/// Answers with the normalized input and the declared rule violations, without any host call.
#[no_mangle]
pub extern "C" fn soundw_normalize_input() -> i32 {
    extism_boundary::respond(&normalize_soundw_request_text(&extism_boundary::read_request_text()))
}

/// The definition's `preview` binding.
#[no_mangle]
pub extern "C" fn soundw_preview() -> i32 {
    extism_boundary::respond(&preview_request_text(&extism_boundary::read_request_text()))
}

/// The definition's `result_view` binding.
#[no_mangle]
pub extern "C" fn soundw_result_view() -> i32 {
    extism_boundary::respond(&result_view_request_text(&extism_boundary::read_request_text()))
}

/// Answers with the registry `def`, the entry points, the capability surface and the command the
/// host must register.
#[no_mangle]
pub extern "C" fn soundw_describe() -> i32 {
    extism_boundary::respond(&describe_soundw_plugin().to_string())
}
