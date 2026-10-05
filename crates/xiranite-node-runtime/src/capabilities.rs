//! The capability host one operation gets: `xiranite.fs.*`, `xiranite.operation.*` and
//! `xiranite.now`, served against `xiranite-core`.
//!
//! ## What crosses the boundary
//!
//! Every call is one JSON document in, one answer out, and every request names the operation it
//! belongs to (`operationId`), which ADR-0068 requires because one plugin instance serves many
//! operations. The answer is `{ "ok": true, "data": … }` / `{ "ok": false, "error": { code, message } }`
//! except for `xiranite.operation.checkpoint`, whose three-valued answer is the ABI code itself.
//!
//! Paths cross as text and metadata as records. File *contents* cross two ways: a bounded text
//! document through `fs.read_text`/`fs.write_text` (capped at
//! [`xiranite_core::filesystem::MAX_TEXT_BYTES`]), or a byte chunk through the handle family
//! (`fs.open` → `fs.read` → `fs.close`, capped at
//! [`xiranite_core::file_stream::MAX_CHUNK_BYTES`] per call). The chunk bytes ride the same JSON
//! envelope as everything else, base64-encoded, because ADR-0068 makes a refusal data rather than a
//! trap and a raw answer block cannot carry one. `fs.write` — the *streamed* write of ADR-0068's
//! table — stays unserved until the file-operation journal exists, so a plugin that declares it gets
//! `not_implemented` instead of an unjournalable handle.
//!
//! ## Why checkpoint sleeps instead of awaiting
//!
//! A wasm host call is synchronous: while `xiranite.operation.checkpoint` has not returned, the
//! plugin's frame sits on the call (ADR-0066). `OperationControl::checkpoint` is an `async` park, and
//! awaiting it from inside a wasmtime host call would mean driving a runtime from the thread already
//! inside a plugin call. The wait is therefore a bounded sleep loop over the same state the async
//! version reads — same cooperative semantics, no nested runtime.

use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use chrono::{DateTime, SecondsFormat, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use xiranite_core::file_stream::FileReadStream;
use xiranite_core::filesystem::{FileCapability, FsCapabilityError};
use xiranite_core::{
    Clock, NodeRunEventRecord, OperationControl, OperationManager, OperationPhase,
};
use xiranite_extism_adapter::{CapabilityAnswer, CapabilityHost, CapabilityRefusal};
use xiranite_plugin_api::{AbiCode, CheckpointOutcome, FileAccessMode, FileHandleToken};

/// The capabilities this host serves. Anything else in a manifest is refused as `not_implemented`,
/// which keeps an unimplemented capability visible in the operation's error rather than in a trap.
pub const SERVED_CAPABILITIES: &[&str] = &[
    "xiranite.fs.stat",
    "xiranite.fs.list",
    "xiranite.fs.ensure_dir",
    "xiranite.fs.move",
    "xiranite.fs.delete",
    "xiranite.fs.open",
    "xiranite.fs.read",
    "xiranite.fs.close",
    "xiranite.fs.read_text",
    "xiranite.fs.write_text",
    "xiranite.operation.checkpoint",
    "xiranite.operation.emit",
    "xiranite.now",
];

/// How long a paused checkpoint sleeps before re-reading the phase. 50 ms is well under the interval
/// a human perceives and keeps a pause release from spinning on the mutex.
const CHECKPOINT_POLL_INTERVAL: Duration = Duration::from_millis(50);

// The settled names, spelled once. A drift in `host_function_names.rs` fails the plugin API crate's
// own test, so binding them to constants here keeps the match arms readable and honest.
const HOST_CHECKPOINT: &str = "xiranite.operation.checkpoint";
const HOST_EMIT: &str = "xiranite.operation.emit";
const HOST_NOW: &str = "xiranite.now";
const HOST_FS_STAT: &str = "xiranite.fs.stat";
const HOST_FS_LIST: &str = "xiranite.fs.list";
const HOST_FS_ENSURE_DIR: &str = "xiranite.fs.ensure_dir";
const HOST_FS_MOVE: &str = "xiranite.fs.move";
const HOST_FS_DELETE: &str = "xiranite.fs.delete";
const HOST_FS_OPEN: &str = "xiranite.fs.open";
const HOST_FS_READ: &str = "xiranite.fs.read";
const HOST_FS_CLOSE: &str = "xiranite.fs.close";
const HOST_FS_READ_TEXT: &str = "xiranite.fs.read_text";
const HOST_FS_WRITE_TEXT: &str = "xiranite.fs.write_text";

/// The capabilities one running operation may call.
pub struct OperationCapabilities {
    manager: OperationManager,
    control: OperationControl,
    files: FileCapability,
    /// The handle family's table, over the same grant as `files`, and dying with this operation.
    streams: FileReadStream,
    clock: Arc<dyn Clock>,
}

impl OperationCapabilities {
    /// Binds the capability surface to one operation.
    #[must_use]
    pub fn new(
        manager: OperationManager,
        control: OperationControl,
        files: FileCapability,
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self { streams: FileReadStream::new(files.clone()), manager, control, files, clock }
    }

    /// The operation these capabilities serve.
    #[must_use]
    pub fn operation_id(&self) -> &str {
        self.control.operation_id()
    }
}

impl CapabilityHost for OperationCapabilities {
    fn capability(&self, name: &str, request: &str) -> Result<CapabilityAnswer, CapabilityRefusal> {
        if !SERVED_CAPABILITIES.contains(&name) {
            // A manifest may legitimately declare a capability this build has not served yet; the
            // plugin then sees a refusal with a code it can report instead of a missing import.
            return Err(CapabilityRefusal::new(
                "not_implemented",
                format!("{name} is a settled capability name but this host does not serve it yet"),
            ));
        }
        match name {
            HOST_CHECKPOINT => self.checkpoint(request),
            HOST_EMIT => self.emit(request),
            HOST_NOW => self.now(request),
            HOST_FS_STAT => self.stat(request),
            HOST_FS_LIST => self.list(request),
            HOST_FS_ENSURE_DIR => self.ensure_dir(request),
            HOST_FS_MOVE => self.move_path(request),
            HOST_FS_DELETE => self.delete(request),
            HOST_FS_OPEN => self.file_open(request),
            HOST_FS_READ => self.read_chunk(request),
            HOST_FS_CLOSE => self.file_close(request),
            HOST_FS_READ_TEXT => self.read_text(request),
            HOST_FS_WRITE_TEXT => self.write_text(request),
            other => Err(CapabilityRefusal::new(
                "internal_inconsistency",
                format!("{other} is served by no branch of this host"),
            )),
        }
    }
}

/// The `operationId` every request carries (ADR-0068: a cross-boundary call is scoped to one
/// operation). Factored out so each capability's own struct stays about the capability.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Scoped {
    operation_id: String,
}

/// `{"operationId","path"}`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathRequest {
    operation_id: String,
    path: String,
}

/// `{"operationId","sourcePath","targetPath"}` — the two paths of a move; the host streams nothing.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoveRequest {
    operation_id: String,
    source_path: String,
    target_path: String,
}

/// `{"operationId","path","recursive"}`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteRequest {
    operation_id: String,
    path: String,
    #[serde(default)]
    recursive: bool,
}

/// `{"operationId","path","text"}` — a bounded text document.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteRequest {
    operation_id: String,
    path: String,
    text: String,
}

/// `{"operationId","path","mode"}` — one `fs.open`. `mode` is named, not coded, so a paused run's log
/// line says what the plugin asked for.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenRequest {
    operation_id: String,
    path: String,
    mode: String,
}

/// `{"operationId","handle","offset","maxBytes"}` — one chunk of an open handle.
///
/// `offset` has no default on purpose: "read from wherever the last read stopped" would put a cursor
/// in the host that the plugin cannot see, and ADR-0068 wants the offset validated by the host, which
/// presupposes the caller naming it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadChunkRequest {
    operation_id: String,
    handle: u64,
    offset: u64,
    max_bytes: u32,
}

/// `{"operationId","handle"}` — one `fs.close`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloseRequest {
    operation_id: String,
    handle: u64,
}

/// `{"operationId","phase","processedItemCount","totalItemCount"}` — the item-boundary report
/// ADR-0066 puts next to the yield.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckpointRequest {
    operation_id: String,
    #[serde(default)]
    #[allow(dead_code)]
    phase: String,
    #[serde(default)]
    #[allow(dead_code)]
    processed_item_count: usize,
    #[serde(default)]
    #[allow(dead_code)]
    total_item_count: usize,
}

/// `{"operationId","event":{…nodeRunEventSchema…}}`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EmitRequest {
    operation_id: String,
    event: NodeRunEventRecord,
}

impl OperationCapabilities {
    /// Parses the request document.
    fn scoped<T>(&self, name: &str, request: &str) -> Result<T, CapabilityRefusal>
    where
        T: for<'de> Deserialize<'de>,
    {
        serde_json::from_str(request).map_err(|error| {
            CapabilityRefusal::new(
                "malformed_request",
                format!("{name} request is not the expected JSON document: {error}"),
            )
        })
    }

    /// The one place the operation identity is compared, so no capability can forget it by accident.
    fn check_scope(&self, name: &str, operation_id: &str) -> Result<(), CapabilityRefusal> {
        if operation_id == self.control.operation_id() {
            Ok(())
        } else {
            Err(CapabilityRefusal::new(
                "operation_mismatch",
                format!(
                    "{name} was called for operation `{operation_id}` by a run serving `{}`",
                    self.control.operation_id()
                ),
            ))
        }
    }

    /// ADR-0066: yield at an item boundary, park while paused, answer `Cancelled` once cancelled.
    fn checkpoint(&self, request: &str) -> Result<CapabilityAnswer, CapabilityRefusal> {
        let request: CheckpointRequest = self.scoped(HOST_CHECKPOINT, request)?;
        self.check_scope(HOST_CHECKPOINT, &request.operation_id)?;
        while self.control.phase() == OperationPhase::Paused && !self.control.cancel_requested() {
            std::thread::sleep(CHECKPOINT_POLL_INTERVAL);
        }
        let outcome = if self.control.cancel_requested() || self.control.phase().is_terminal() {
            CheckpointOutcome::Cancelled
        } else {
            CheckpointOutcome::Continue
        };
        Ok(CapabilityAnswer::Code(u64::from(outcome.abi_code())))
    }

    /// Appends one `nodeRunEventSchema` document to the operation's stream and answers with the index
    /// the host assigned.
    fn emit(&self, request: &str) -> Result<CapabilityAnswer, CapabilityRefusal> {
        let request: EmitRequest = self.scoped(HOST_EMIT, request)?;
        self.check_scope(HOST_EMIT, &request.operation_id)?;
        let operation_id = self.control.operation_id();
        let Some(index) = self.manager.push_event(operation_id, request.event) else {
            return Err(CapabilityRefusal::new(
                "event_refused",
                format!("operation {operation_id} is terminal or gone, so its event was dropped"),
            ));
        };
        // `push_event` already fans the `Event` frame out to every live listener (`OperationState::push_event`
        // appends to the retained window *and* emits), so a second `publish` here would deliver every event
        // twice to a client that subscribed before the run emitted — which is what every browser face does.
        // The retained window is the replay path, the listener fan-out is the live path; `tests/event_stream.rs`
        // is the gauge, and it is blind to nothing only because a late subscriber stays green by design.
        Ok(CapabilityAnswer::Document(json!(index.get())))
    }

    /// `xiranite.now`: the host clock as the ISO-8601 UTC text `new Date()#toISOString()` produced in
    /// `platform.ts:94`, so a node's history rows keep the spelling the TypeScript wrote.
    fn now(&self, request: &str) -> Result<CapabilityAnswer, CapabilityRefusal> {
        let request: Scoped = self.scoped(HOST_NOW, request)?;
        self.check_scope(HOST_NOW, &request.operation_id)?;
        let iso = DateTime::<Utc>::from_timestamp_millis(
            i64::try_from(self.clock.now_ms()).unwrap_or_default(),
        )
            .map(|moment| moment.to_rfc3339_opts(SecondsFormat::Millis, true))
            .unwrap_or_else(|| "1970-01-01T00:00:00.000Z".to_string());
        Ok(CapabilityAnswer::Document(json!({ "iso": iso })))
    }

    fn stat(&self, request: &str) -> Result<CapabilityAnswer, CapabilityRefusal> {
        let request: PathRequest = self.scoped(HOST_FS_STAT, request)?;
        self.check_scope(HOST_FS_STAT, &request.operation_id)?;
        let info = self.files.stat(&request.path).map_err(refuse)?;
        Ok(CapabilityAnswer::Document(json!({
            "path": info.path,
            "exists": info.exists,
            "isFile": info.is_file,
            "isDirectory": info.is_directory,
            // Extra fields are allowed by the reply shape and are what a rename node needs to restore
            // times; a node that ignores them costs nothing.
            "sizeBytes": info.size_bytes,
            "atimeMs": info.atime_ms,
            "mtimeMs": info.mtime_ms,
        })))
    }

    /// `fs.list` answers a bare array, the shape `platform.ts:38-47`'s `readdir` mapping produced.
    fn list(&self, request: &str) -> Result<CapabilityAnswer, CapabilityRefusal> {
        let request: PathRequest = self.scoped(HOST_FS_LIST, request)?;
        self.check_scope(HOST_FS_LIST, &request.operation_id)?;
        let entries = self.files.list(&request.path).map_err(refuse)?;
        let entries: Vec<Value> = entries
            .into_iter()
            .map(|entry| {
                json!({
                    "name": entry.name,
                    "path": entry.path,
                    "isFile": entry.is_file,
                    "isDirectory": entry.is_directory,
                })
            })
            .collect();
        Ok(CapabilityAnswer::Document(Value::Array(entries)))
    }

    fn ensure_dir(&self, request: &str) -> Result<CapabilityAnswer, CapabilityRefusal> {
        let request: PathRequest = self.scoped(HOST_FS_ENSURE_DIR, request)?;
        self.check_scope(HOST_FS_ENSURE_DIR, &request.operation_id)?;
        self.files.ensure_dir(&request.path).map_err(refuse)?;
        Ok(CapabilityAnswer::Document(Value::Null))
    }

    fn move_path(&self, request: &str) -> Result<CapabilityAnswer, CapabilityRefusal> {
        let request: MoveRequest = self.scoped(HOST_FS_MOVE, request)?;
        self.check_scope(HOST_FS_MOVE, &request.operation_id)?;
        self.files.move_path(&request.source_path, &request.target_path).map_err(refuse)?;
        Ok(CapabilityAnswer::Document(Value::Null))
    }

    fn delete(&self, request: &str) -> Result<CapabilityAnswer, CapabilityRefusal> {
        let request: DeleteRequest = self.scoped(HOST_FS_DELETE, request)?;
        self.check_scope(HOST_FS_DELETE, &request.operation_id)?;
        self.files.delete(&request.path, request.recursive).map_err(refuse)?;
        Ok(CapabilityAnswer::Document(Value::Null))
    }

    /// `xiranite.fs.open` — authorize the path once, hand back a handle and the size the plugin needs
    /// to plan its chunk count with.
    fn file_open(&self, request: &str) -> Result<CapabilityAnswer, CapabilityRefusal> {
        let request: OpenRequest = self.scoped(HOST_FS_OPEN, request)?;
        self.check_scope(HOST_FS_OPEN, &request.operation_id)?;
        let mode = access_mode(&request.mode)?;
        let (handle, size_bytes) = self.streams.open(&request.path, mode).map_err(refuse)?;
        Ok(CapabilityAnswer::Document(json!({ "handle": handle.get(), "sizeBytes": size_bytes })))
    }

    /// `xiranite.fs.read` — one base64 chunk. An empty `bytes` is end of stream.
    ///
    /// The chunk rides the same envelope as every other answer because ADR-0068 insists a capability
    /// failure be data: a raw answer block cannot carry `{ ok: false, error: … }`, so a locked folder
    /// mid-stream would have to trap the run instead of failing that one read.
    fn read_chunk(&self, request: &str) -> Result<CapabilityAnswer, CapabilityRefusal> {
        let request: ReadChunkRequest = self.scoped(HOST_FS_READ, request)?;
        self.check_scope(HOST_FS_READ, &request.operation_id)?;
        let handle = handle_token(HOST_FS_READ, request.handle)?;
        let bytes = self.streams.read_chunk(handle, request.offset, request.max_bytes).map_err(refuse)?;
        Ok(CapabilityAnswer::Document(json!({ "bytes": BASE64.encode(bytes) })))
    }

    /// `xiranite.fs.close` — drop the descriptor. Dropping this operation's service reclaims any
    /// handle the plugin never closed, so a leak is bounded by the run.
    fn file_close(&self, request: &str) -> Result<CapabilityAnswer, CapabilityRefusal> {
        let request: CloseRequest = self.scoped(HOST_FS_CLOSE, request)?;
        self.check_scope(HOST_FS_CLOSE, &request.operation_id)?;
        let handle = handle_token(HOST_FS_CLOSE, request.handle)?;
        self.streams.close(handle).map_err(refuse)?;
        Ok(CapabilityAnswer::Document(Value::Null))
    }

    /// A bounded text document. `{"text": null}` means "no file", which is how the nodes read an
    /// absent undo history; a directory is refused rather than read.
    fn read_text(&self, request: &str) -> Result<CapabilityAnswer, CapabilityRefusal> {
        let request: PathRequest = self.scoped(HOST_FS_READ_TEXT, request)?;
        self.check_scope(HOST_FS_READ_TEXT, &request.operation_id)?;
        let path = request.path;
        let info = self.files.stat(&path).map_err(refuse)?;
        if info.exists && info.is_directory {
            return Err(CapabilityRefusal::new(
                "is_directory",
                format!("{path} is a directory; fs.read_text carries text documents only"),
            ));
        }
        let text = self.files.read_text(&path).map_err(refuse)?;
        Ok(CapabilityAnswer::Document(json!({ "text": text })))
    }

    fn write_text(&self, request: &str) -> Result<CapabilityAnswer, CapabilityRefusal> {
        let request: WriteRequest = self.scoped(HOST_FS_WRITE_TEXT, request)?;
        self.check_scope(HOST_FS_WRITE_TEXT, &request.operation_id)?;
        self.files.write_text(&request.path, &request.text).map_err(refuse)?;
        Ok(CapabilityAnswer::Document(Value::Null))
    }
}

/// The `fs.open` mode spelling behind the settled [`FileAccessMode`].
fn access_mode(spelling: &str) -> Result<FileAccessMode, CapabilityRefusal> {
    match spelling {
        "read" => Ok(FileAccessMode::Read),
        "write" => Ok(FileAccessMode::Write),
        other => Err(CapabilityRefusal::new(
            "malformed_request",
            format!("`{other}` is not a file access mode; xiranite.fs.open takes read or write"),
        )),
    }
}

/// A plugin-supplied handle id re-presented as the boundary token.
fn handle_token(name: &str, value: u64) -> Result<FileHandleToken, CapabilityRefusal> {
    FileHandleToken::try_from_u64(value).ok_or_else(|| {
        CapabilityRefusal::new(
            "invalid_handle",
            format!("{name} was called with {value}, which is the reserved no-handle value"),
        )
    })
}

/// Turns a capability error into the envelope's error object.
fn refuse(error: FsCapabilityError) -> CapabilityRefusal {
    let details = match &error {
        FsCapabilityError::Refused { .. } => Some(json!({ "code": error.code() })),
        _ => None,
    };
    CapabilityRefusal { code: error.code().to_owned(), message: error.message(), details }
}
