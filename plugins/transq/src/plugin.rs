//! The Extism shim: the two operation control-plane host calls TransQ still needs, plus the
//! WASM entry points.
//!
//! Built with `cargo build --target wasm32-wasip1 --features wasm`, because the imports below exist
//! only inside an Extism host; the domain core stays dependency-free and testable natively
//! (ADR-0063 principle 8).
//!
//! Boundary rules this file implements:
//!
//! - Only product semantics cross the boundary now (ADR-0071 decision 4): `xiranite.operation.emit`
//!   for the event stream and `xiranite.operation.checkpoint` for the cooperative yield.
//!   `xiranite.scheduler.acquire` is intentionally absent — the host classifies this node's
//!   resource class, the plugin does not negotiate one.
//! - File IO is `std::fs` against the WASI preopens the host grants from the manifest's
//!   `allowed_paths` (ADR-0071), so this file declares no `xiranite.fs.*` import and the whole
//!   file half of [`TransqHost`] comes from [`crate::transq_std_fs::StdFilesystem`].
//! - Media bytes never cross the boundary at all: a copy or a move is one `std::fs` call inside the
//!   sandbox, and only small structured payloads (the translation map, a progress event) are read
//!   or written as JSON here.
//! - Expected failures stay data: a per-queue filesystem failure becomes
//!   [`HostCallError`](crate::transq_host::HostCallError) and marks that one queue conflicting while
//!   the run continues (`core.ts:177-182`), so one locked folder never aborts the operation.
//!
//! ADR-0071's other consequence is a path one: a `wasm32-wasip1` guest sees POSIX separators, so
//! TransQ never reasons about drive letters or backslashes here — the host owns that
//! (`docs/adr/0071-…:§5`), and [`crate::transq_path`] keeps the text-level rules the queue needs.
//!
//! Entry points: `run` is the one the node runner calls (`runTransq`, see
//! `packages/runtime/src/node-runner.generated.ts:289`), and `node_def` serves the
//! `def` object from `packages/nodes/transq/src/index.ts:4-12` to the Rust registry.
//! Both use the current Extism call convention: the export takes the input block
//! handle and returns the output block handle. Under the legacy no-parameter
//! convention the host would read input through `extism:host/env input_offset` and
//! `input_length`; those two are deliberately not declared so the convention this
//! plugin needs stays explicit.

use crate::transq_contract::{NODE_DEFINITION, TransqInput, TransqRunEvent};
use crate::transq_host::{CheckpointDecision, DirectoryListing, HostCallError, TransqHost};
use crate::transq_runner::run_transq;
use crate::transq_std_fs::StdFilesystem;

/// Extism's own memory imports, the same set the official PDKs declare.
#[link(wasm_import_module = "extism:host/env")]
unsafe extern "C" {
    fn alloc(length: u64) -> u64;
    fn free(offset: u64);
    fn length(offset: u64) -> u64;
    fn load_u8(offset: u64) -> u32;
    fn store_u8(offset: u64, value: u32);
    fn load_u64(offset: u64) -> u64;
    fn store_u64(offset: u64, value: u64);
    fn error_set(offset: u64);
}

/// The capabilities TransQ still imports (ADR-0071 closed the vocabulary at nine names; this plugin
/// uses two of them). The import symbol is the flattened manifest name, which is what
/// `xiranite_plugin_api::host_function_names` documents, so these link names are
/// `operation.checkpoint` / `operation.emit` inside the `xiranite` module.
#[link(wasm_import_module = "xiranite")]
unsafe extern "C" {
    /// ADR-0066/0068: waits while the owning operation is paused, reports cancellation.
    #[link_name = "operation.checkpoint"]
    fn host_checkpoint() -> i64;
    /// One `NodeRunEvent` into the operation's event stream.
    #[link_name = "operation.emit"]
    fn host_emit(input: i64) -> i64;
}

/// `xiranite.operation.checkpoint` return value that means "keep going".
pub const CHECKPOINT_CONTINUE: i64 = 0;

/// The `TransqHost` implementation: `std::fs` for the machine, host calls for the operation.
#[derive(Debug, Default)]
pub struct XiraniteExtismHost {
    filesystem: StdFilesystem,
}

impl TransqHost for XiraniteExtismHost {
    fn list_directory(&mut self, path: &str, include_entries: bool) -> Result<DirectoryListing, HostCallError> {
        self.filesystem.list_directory(path, include_entries)
    }

    fn read_text_file(&mut self, path: &str) -> Result<String, HostCallError> {
        self.filesystem.read_text_file(path)
    }

    fn copy_file(&mut self, source_path: &str, destination_path: &str) -> Result<(), HostCallError> {
        self.filesystem.copy_file(source_path, destination_path)
    }

    fn move_directory(&mut self, source_path: &str, destination_path: &str) -> Result<(), HostCallError> {
        self.filesystem.move_directory(source_path, destination_path)
    }

    fn remove_path(&mut self, path: &str) -> Result<(), HostCallError> {
        self.filesystem.remove_path(path)
    }

    fn emit_event(&mut self, event: &TransqRunEvent) {
        let input = write_block(&event.to_json_string());
        unsafe { host_emit(input as i64) };
        free_block(input);
    }

    fn checkpoint(&mut self) -> CheckpointDecision {
        match unsafe { host_checkpoint() } {
            CHECKPOINT_CONTINUE => CheckpointDecision::Continue,
            // Unrecognized codes stop the organizer: this is the destructive side of
            // the protocol, and ADR-0066 makes cancellation the safe reading.
            _ => CheckpointDecision::Cancelled,
        }
    }
}

// ---------------------------------------------------------------------------
// Extism block plumbing
// ---------------------------------------------------------------------------

/// Copies a host block into plugin-owned bytes.
///
/// Offsets are handed back to `load_*`/`store_*` as handles, the way the official
/// PDKs do, so nothing here decodes the length bits the host packs into the handle;
/// `length` is the only size query.
fn read_block(handle: u64) -> Vec<u8> {
    let size = unsafe { length(handle) } as usize;
    let mut buffer = vec![0u8; size];
    let mut index = 0usize;
    while index + 8 <= size {
        let chunk = unsafe { load_u64(handle + index as u64) }.to_le_bytes();
        buffer[index..index + 8].copy_from_slice(&chunk);
        index += 8;
    }
    while index < size {
        buffer[index] = unsafe { load_u8(handle + index as u64) } as u8;
        index += 1;
    }
    buffer
}

fn read_block_as_str(handle: u64) -> Result<String, HostCallError> {
    let bytes = read_block(handle);
    String::from_utf8(bytes).map_err(|_| HostCallError::new("host payload is not valid UTF-8".to_string()))
}

fn write_block(contents: &str) -> u64 {
    let bytes = contents.as_bytes();
    let handle = unsafe { alloc(bytes.len() as u64) };
    let mut index = 0usize;
    while index + 8 <= bytes.len() {
        let chunk = u64::from_le_bytes(bytes[index..index + 8].try_into().expect("eight byte slice"));
        unsafe { store_u64(handle + index as u64, chunk) };
        index += 8;
    }
    while index < bytes.len() {
        unsafe { store_u8(handle + index as u64, bytes[index] as u32) };
        index += 1;
    }
    handle
}

fn free_block(handle: u64) {
    unsafe { free(handle) };
}

/// `runTransq(input, runtime, onEvent)` behind the Extism call convention: JSON
/// `TransqInput` in, JSON `NodeRunResult` out.
#[unsafe(no_mangle)]
pub extern "C" fn run(input_handle: i64) -> i64 {
    let source = match read_block_as_str(input_handle as u64) {
        Ok(source) => source,
        Err(error) => return abort(&error.message),
    };
    let input = match TransqInput::from_json_str(&source) {
        Ok(input) => input,
        Err(error) => return abort(&format!("invalid TransQ input: {error}")),
    };
    let mut host = XiraniteExtismHost::default();
    let result = run_transq(&input, &mut host);
    write_block(&result.to_json_string()) as i64
}

/// The node definition the registry publishes, so `id`, `icon` and `keywords`
/// cannot drift between the plugin and the host's node manifest.
#[unsafe(no_mangle)]
pub extern "C" fn node_def(_input_handle: i64) -> i64 {
    write_block(&NODE_DEFINITION.to_json_string()) as i64
}

/// Reports a request-level failure through Extism's error channel: a bad body is not
/// a queue conflict, so it must not come back as a `NodeRunResult`.
fn abort(message: &str) -> i64 {
    let report = write_block(message);
    unsafe { error_set(report) };
    0
}
