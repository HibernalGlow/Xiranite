//! The host seam: one injectable capability trait, the pinned wire shapes for its calls, and the
//! wasm32-only Extism shim that implements it.
//!
//! This is the only module in the crate that may name an Extism mechanism (`core.ts`'s `DissolvefRuntime`
//! abstraction becomes these ten methods), and every Extism symbol sits behind
//! `#[cfg(target_arch = "wasm32")]` so the same business path runs natively against the in-memory host in
//! `in_memory_host.rs` (ADR-0068's layering: business code knows the API, the shim knows the adapter).
//!
//! Boundary rules this module implements:
//!
//! - Module `extism:host/user`; symbol names are ADR-0068's capability names with the dots flattened to
//!   underscores, which is the injection the host derives from the manifest.
//! - Every call carries one JSON block (a `u64` offset) and is scoped to an `operationId` (ADR-0068: plugin
//!   lifecycle is not operation lifecycle).
//! - Replies use the `{"ok":true,"data":...}` / `{"ok":false,"error":{code,message}}` envelope, so a locked
//!   or missing path is data one plan row can carry rather than a trap that ends the run.
//! - Paths cross as strings. This node moves metadata and small journals only — never file bytes — which is
//!   the ADR-0068 exception to handle-plus-chunk transfers.
//! - `xiranite_operation_checkpoint` answers a bare ABI code (`1` continue, `2` paused, `3` cancelled, per
//!   [`xiranite_plugin_api::CheckpointOutcome`]); `is_hard_stop` is what ends the run.

use serde::{Deserialize, Serialize};
use xiranite_plugin_api::{
    CheckpointOutcome, HostCallErrorCode, PluginRunEvent, ProgressPercent,
};

use crate::document::{DissolvefDirEntry, DissolvefPathInfo, JsonNumber};

/// A host call that did not succeed, or the cancellation that ended the run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DissolvefHostError {
    /// A refusal whose message becomes the plan row's `reason`, which is what `core.ts:506` did with a
    /// thrown `Error`.
    Failure(String),
    /// A checkpoint answered `Cancelled`, or a capability reported the operation is cancelled: stop without
    /// starting another item (ADR-0066).
    Cancelled,
}

impl DissolvefHostError {
    /// The text `core.ts` would have put in `error.message`.
    #[must_use]
    pub fn message(&self) -> String {
        match self {
            Self::Failure(message) => message.clone(),
            Self::Cancelled => "operation cancelled".to_string(),
        }
    }
}

pub type DissolvefHostResult<T> = Result<T, DissolvefHostError>;

/// What the plugin may ask the machine to do. Business modules depend on this trait and nothing else.
///
/// Each method is the TypeScript runtime method named in its doc comment; the mapping to `platform.ts`'s
/// syscalls is the host's contract to keep.
pub trait DissolvefHost {
    /// `DissolvefRuntime.pathInfo` (`platform.ts:70-78`: `resolve` + `lstat`).
    ///
    /// A path that is missing, unreadable or refused reports `exists: false` instead of failing, exactly as
    /// `platform.ts:76`'s `catch` did; cancellation still propagates.
    fn stat(&mut self, path: &str) -> DissolvefHostResult<DissolvefPathInfo>;

    /// `DissolvefRuntime.listDir` (`platform.ts:80-88`: `readdir` with file types).
    ///
    /// Implementations report entry names and kinds; the plugin rebuilds each entry's path with its own
    /// `join_paths`, so a plan never depends on the host's separator choice.
    fn list_dir(&mut self, path: &str) -> DissolvefHostResult<Vec<DissolvefDirEntry>>;

    /// `DissolvefRuntime.ensureDir` (`platform.ts:11`: `mkdir`, recursive).
    fn ensure_dir(&mut self, path: &str) -> DissolvefHostResult<()>;

    /// `DissolvefRuntime.movePath` (`platform.ts:90-98`: `mkdir(dirname)`, then `rename`, falling back to
    /// copy-then-remove).
    fn move_path(&mut self, source: &str, target: &str) -> DissolvefHostResult<()>;

    /// `DissolvefRuntime.deletePath` (`platform.ts:100-108`).
    ///
    /// `recursive: false` must refuse a non-empty directory (`rmdir` semantics), because that refusal is
    /// what keeps DissolveF from discarding content it never planned to move.
    fn delete_path(&mut self, path: &str, recursive: bool) -> DissolvefHostResult<()>;

    /// `DissolvefRuntime.readText` (`platform.ts:110-116`: `null` for anything that cannot be read).
    fn read_text(&mut self, path: &str) -> DissolvefHostResult<Option<String>>;

    /// `DissolvefRuntime.writeText` (`platform.ts:118-121`: `mkdir(dirname)` then `writeFile`).
    fn write_text(&mut self, path: &str, content: &str) -> DissolvefHostResult<()>;

    /// `DissolvefRuntime.now` (`platform.ts:19`) through `xiranite.now`, so the plugin never reads a wall
    /// clock itself and a journal id stays reproducible.
    fn now(&mut self) -> DissolvefHostResult<String>;

    /// `onEvent` (`core.ts:170`) through `xiranite.operation.emit`.
    fn emit(&mut self, event: &PluginRunEvent) -> DissolvefHostResult<()>;

    /// `xiranite.operation.checkpoint` (ADR-0066): the yield point between items.
    fn checkpoint(
        &mut self,
        request: &DissolvefCheckpointRequest,
    ) -> DissolvefHostResult<CheckpointOutcome>;
}

/// The item-boundary report that goes with a checkpoint call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DissolvefCheckpointRequest {
    /// Which loop is asking, for the host's log line.
    pub phase: &'static str,
    pub processed_item_count: usize,
    pub total_item_count: usize,
}

/// The checkpoint phase the plan-building traversal reports under.
pub const PHASE_SCANNING: &str = "scanning";
/// The checkpoint phase the write loop reports under.
pub const PHASE_DISSOLVING: &str = "dissolving";
/// The checkpoint phase the undo loop reports under.
pub const PHASE_UNDOING: &str = "undoing";

/// A `progress` event shaped like `onEvent({ type: "progress", progress, message })` (`core.ts:494`),
/// where `progress` is `Math.round(index / total * 100)`.
#[must_use]
pub fn progress_event(message: &str, index: usize, total: usize) -> PluginRunEvent {
    let percent =
        if total == 0 { 0.0 } else { (index as f64 / total as f64 * 100.0).round() };
    PluginRunEvent::progress_message(message.to_string(), ProgressPercent::try_new(percent).ok())
}

/// A closing progress line, `core.ts:514` and `core.ts:599`'s `{ progress: 100, message }`.
#[must_use]
pub fn finished_event(message: &str) -> PluginRunEvent {
    PluginRunEvent::progress_message(message.to_string(), ProgressPercent::try_new(100.0).ok())
}

/// `onEvent` was a plain callback in `core.ts`; here it is a host call that must not be able to end a run on
/// its own. Cancellation still propagates, because that is the operation ending, not the report failing.
pub(crate) fn report_progress(
    host: &mut dyn DissolvefHost,
    event: &PluginRunEvent,
) -> DissolvefHostResult<()> {
    match host.emit(event) {
        Ok(()) => Ok(()),
        Err(DissolvefHostError::Cancelled) => Err(DissolvefHostError::Cancelled),
        Err(DissolvefHostError::Failure(_)) => Ok(()),
    }
}

/// The pinned request documents: one struct per capability, so a WIT `record` maps onto it mechanically
/// (ADR-0068) and the host has a single list to implement against.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsStatRequest {
    pub operation_id: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsListRequest {
    pub operation_id: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEnsureDirRequest {
    pub operation_id: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsMoveRequest {
    pub operation_id: String,
    pub source_path: String,
    pub target_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsDeleteRequest {
    pub operation_id: String,
    pub path: String,
    pub recursive: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadRequest {
    pub operation_id: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsWriteRequest {
    pub operation_id: String,
    pub path: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointCallRequest {
    pub operation_id: String,
    pub phase: String,
    pub processed_item_count: usize,
    pub total_item_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmitRequest {
    pub operation_id: String,
    pub event: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NowRequest {
    pub operation_id: String,
}

/// The pinned reply documents.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsStatReply {
    /// The host's resolved form of the requested path; absent means "the path I was asked about".
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub exists: bool,
    #[serde(default)]
    pub is_file: bool,
    #[serde(default)]
    pub is_directory: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsListEntry {
    pub name: String,
    /// Accepted for the host's convenience and then ignored: the plugin joins the name onto the directory it
    /// listed, so a plan is spelled the same whichever host answered.
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub is_file: bool,
    #[serde(default)]
    pub is_directory: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadReply {
    /// `null` when the file is not there, which is what `parse_dissolve_history` expects.
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NowReply {
    /// ISO-8601 UTC, the form `Date#toISOString()` produced.
    #[serde(default)]
    pub iso: String,
}

/// `{"ok":true,"data":...}` / `{"ok":false,"error":{"code","message"}}`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostReply<T> {
    pub ok: bool,
    #[serde(default)]
    pub error: Option<HostErrorBody>,
    #[serde(default)]
    pub data: Option<T>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostErrorBody {
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
}

impl<T> HostReply<T> {
    /// The failure of an `ok: false` reply, with `cancelled` recognised as the hard stop it is.
    fn refusal(&self) -> DissolvefHostError {
        let code = self
            .error
            .as_ref()
            .and_then(|body| body.code.clone())
            .unwrap_or_default();
        let message = self
            .error
            .as_ref()
            .and_then(|body| body.message.clone())
            .filter(|text| !text.is_empty())
            .or_else(|| (!code.is_empty()).then(|| code.clone()))
            .unwrap_or_else(|| "host call failed".to_string());
        if code == HostCallErrorCode::Cancelled.as_str() {
            return DissolvefHostError::Cancelled;
        }
        DissolvefHostError::Failure(message)
    }
}

/// Decodes one reply document into its `data`. `T` is the pinned reply type for that capability; an
/// `ok: true` reply with no data is a refusal, because the plugin has nothing to continue from.
pub fn decode_host_reply<T: for<'de> Deserialize<'de>>(raw: &str) -> DissolvefHostResult<T> {
    let decoded: HostReply<Option<T>> = serde_json::from_str(raw).map_err(|error| {
        DissolvefHostError::Failure(format!("malformed host reply: {error}"))
    })?;
    if !decoded.ok {
        return Err(decoded.refusal());
    }
    decoded
        .data
        .flatten()
        .ok_or_else(|| DissolvefHostError::Failure("host replied without data".to_string()))
}

/// The same, for the capabilities whose reply is an ack with no payload.
pub fn decode_host_ack(raw: &str) -> DissolvefHostResult<()> {
    let decoded: HostReply<Option<serde_json::Value>> =
        serde_json::from_str(raw).map_err(|error| {
            DissolvefHostError::Failure(format!("malformed host reply: {error}"))
        })?;
    if decoded.ok {
        Ok(())
    } else {
        Err(decoded.refusal())
    }
}

/// One event as the JSON `nodeRunEventSchema` expects (`packages/shared/src/index.ts:91-98`).
#[must_use]
pub fn run_event_to_value(event: &PluginRunEvent) -> serde_json::Value {
    let mut object = serde_json::Map::new();
    object.insert(
        "type".to_string(),
        serde_json::Value::String(event.kind().as_str().to_string()),
    );
    if let Some(percent) = event.percent() {
        let number = serde_json::to_value(JsonNumber::new(percent.get()))
            .unwrap_or(serde_json::Value::Null);
        object.insert("progress".to_string(), number);
    }
    object.insert("message".to_string(), serde_json::Value::String(event.message().to_string()));
    serde_json::Value::Object(object)
}

/// The Extism adapter: the `dissolvef_run` export plus the ten `xiranite_*` imports.
#[cfg(target_arch = "wasm32")]
pub mod extism {
    use serde::Serialize;
    use serde::de::DeserializeOwned;
    use xiranite_plugin_api::{AbiCode, CheckpointOutcome, PluginRunEvent};

    use super::{
        CheckpointCallRequest, DissolvefCheckpointRequest, DissolvefHost, DissolvefHostError,
        DissolvefHostResult, EmitRequest, FsDeleteRequest, FsEnsureDirRequest, FsListEntry,
        FsListRequest, FsMoveRequest, FsReadReply, FsReadRequest, FsStatReply, FsStatRequest,
        FsWriteRequest, NowReply, NowRequest, decode_host_ack, decode_host_reply, run_event_to_value,
    };
    use crate::contract::DissolvefRunRequest;
    use crate::document::{DissolvefDirEntry, DissolvefPathInfo, DissolvefResult};

    /// `extism:host/env`: the only place linear-memory ownership is spelled.
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

    /// `extism:host/user`: ADR-0068's capability names with the dots flattened to underscores.
    #[link(wasm_import_module = "extism:host/user")]
    unsafe extern "C" {
        fn xiranite_fs_stat(offset: u64) -> u64;
        fn xiranite_fs_list(offset: u64) -> u64;
        fn xiranite_fs_ensure_dir(offset: u64) -> u64;
        fn xiranite_fs_move(offset: u64) -> u64;
        fn xiranite_fs_delete(offset: u64) -> u64;
        fn xiranite_fs_read_text(offset: u64) -> u64;
        fn xiranite_fs_write_text(offset: u64) -> u64;
        fn xiranite_operation_checkpoint(offset: u64) -> u64;
        fn xiranite_operation_emit(offset: u64) -> u64;
        fn xiranite_now(offset: u64) -> u64;
    }

    /// The plugin's whole machine surface for one operation.
    pub struct ExtismDissolvefHost {
        operation_id: String,
    }

    impl ExtismDissolvefHost {
        #[must_use]
        pub fn new(scope: &crate::contract::DissolvefRunScope) -> Self {
            Self { operation_id: scope.operation_id.clone() }
        }

        /// One capability call: encode the request into this instance's memory, hand the host its offset, and
        /// read the block the host answered with. Both blocks are released before returning, so a batch of
        /// thousands of items does not grow linear memory.
        fn call(
            &self,
            request: &impl Serialize,
            invoke: fn(u64) -> u64,
        ) -> DissolvefHostResult<String> {
            let bytes = serde_json::to_vec(request).map_err(|error| {
                DissolvefHostError::Failure(format!("could not encode host request: {error}"))
            })?;
            let offset = unsafe { alloc(bytes.len() as u64) };
            write_bytes_at(offset, &bytes);
            let reply_offset = invoke(offset);
            let reply = if reply_offset == 0 {
                Err(DissolvefHostError::Failure(
                    "host call answered without a reply block".to_string(),
                ))
            } else {
                Ok(read_block(reply_offset))
            };
            unsafe { free(offset) };
            match reply {
                Ok(text) => {
                    unsafe { free(reply_offset) };
                    Ok(text)
                }
                Err(error) => Err(error),
            }
        }

        fn call_json<T: DeserializeOwned>(
            &self,
            request: &impl Serialize,
            invoke: fn(u64) -> u64,
        ) -> DissolvefHostResult<T> {
            decode_host_reply::<T>(&self.call(request, invoke)?)
        }
    }

    impl DissolvefHost for ExtismDissolvefHost {
        fn stat(&mut self, path: &str) -> DissolvefHostResult<DissolvefPathInfo> {
            let request =
                FsStatRequest { operation_id: self.operation_id.clone(), path: path.to_string() };
            let reply =
                self.call_json::<FsStatReply>(&request, |offset| unsafe { xiranite_fs_stat(offset) });
            match reply {
                Ok(data) => Ok(DissolvefPathInfo {
                    path: data.path.unwrap_or_else(|| path.to_string()),
                    exists: data.exists,
                    is_file: data.is_file,
                    is_directory: data.is_directory,
                }),
                // `platform.ts:70-78` turned every `lstat` failure into "does not exist", so a refused or
                // unreadable path cannot abort a whole plan.
                Err(DissolvefHostError::Failure(_)) => Ok(DissolvefPathInfo::missing(path)),
                Err(cancelled) => Err(cancelled),
            }
        }

        fn list_dir(&mut self, path: &str) -> DissolvefHostResult<Vec<DissolvefDirEntry>> {
            let request =
                FsListRequest { operation_id: self.operation_id.clone(), path: path.to_string() };
            let entries: Vec<FsListEntry> =
                self.call_json(&request, |offset| unsafe { xiranite_fs_list(offset) })?;
            Ok(entries
                .into_iter()
                .map(|entry| DissolvefDirEntry {
                    name: entry.name.clone(),
                    path: crate::paths::join_paths(&[path, &entry.name]),
                    is_file: entry.is_file,
                    is_directory: entry.is_directory,
                })
                .collect())
        }

        fn ensure_dir(&mut self, path: &str) -> DissolvefHostResult<()> {
            let request =
                FsEnsureDirRequest { operation_id: self.operation_id.clone(), path: path.to_string() };
            decode_host_ack(&self.call(&request, |offset| unsafe { xiranite_fs_ensure_dir(offset) })?)
        }

        fn move_path(&mut self, source: &str, target: &str) -> DissolvefHostResult<()> {
            let request = FsMoveRequest {
                operation_id: self.operation_id.clone(),
                source_path: source.to_string(),
                target_path: target.to_string(),
            };
            decode_host_ack(&self.call(&request, |offset| unsafe { xiranite_fs_move(offset) })?)
        }

        fn delete_path(&mut self, path: &str, recursive: bool) -> DissolvefHostResult<()> {
            let request = FsDeleteRequest {
                operation_id: self.operation_id.clone(),
                path: path.to_string(),
                recursive,
            };
            decode_host_ack(&self.call(&request, |offset| unsafe { xiranite_fs_delete(offset) })?)
        }

        fn read_text(&mut self, path: &str) -> DissolvefHostResult<Option<String>> {
            let request =
                FsReadRequest { operation_id: self.operation_id.clone(), path: path.to_string() };
            let reply =
                self.call_json::<FsReadReply>(&request, |offset| unsafe {
                    xiranite_fs_read_text(offset)
                });
            match reply {
                Ok(data) => Ok(data.text),
                // `platform.ts:110-116`: an unreadable journal is `null`, which parses as no history.
                Err(DissolvefHostError::Failure(_)) => Ok(None),
                Err(cancelled) => Err(cancelled),
            }
        }

        fn write_text(&mut self, path: &str, content: &str) -> DissolvefHostResult<()> {
            let request = FsWriteRequest {
                operation_id: self.operation_id.clone(),
                path: path.to_string(),
                text: content.to_string(),
            };
            decode_host_ack(&self.call(&request, |offset| unsafe {
                xiranite_fs_write_text(offset)
            })?)
        }

        fn now(&mut self) -> DissolvefHostResult<String> {
            let request = NowRequest { operation_id: self.operation_id.clone() };
            let reply: NowReply = self.call_json(&request, |offset| unsafe { xiranite_now(offset) })?;
            if reply.iso.is_empty() {
                return Err(DissolvefHostError::Failure(
                    "xiranite.now answered without an ISO-8601 timestamp".to_string(),
                ));
            }
            Ok(reply.iso)
        }

        fn emit(&mut self, event: &PluginRunEvent) -> DissolvefHostResult<()> {
            let request = EmitRequest {
                operation_id: self.operation_id.clone(),
                event: run_event_to_value(event),
            };
            decode_host_ack(&self.call(&request, |offset| unsafe { xiranite_operation_emit(offset) })?)
        }

        fn checkpoint(
            &mut self,
            request: &DissolvefCheckpointRequest,
        ) -> DissolvefHostResult<CheckpointOutcome> {
            let payload = CheckpointCallRequest {
                operation_id: self.operation_id.clone(),
                phase: request.phase.to_string(),
                processed_item_count: request.processed_item_count,
                total_item_count: request.total_item_count,
            };
            let bytes = serde_json::to_vec(&payload)
                .map_err(|error| DissolvefHostError::Failure(error.to_string()))?;
            let offset = unsafe { alloc(bytes.len() as u64) };
            write_bytes_at(offset, &bytes);
            let code = unsafe { xiranite_operation_checkpoint(offset) };
            unsafe { free(offset) };
            // `0` is the ABI's reserved code, so an answer the vocabulary does not define is read as the
            // safe one: stop rather than keep writing files for an operation that has ended.
            Ok(match CheckpointOutcome::try_from_abi_code(u8::try_from(code).unwrap_or(u8::MAX)) {
                Ok(outcome) => outcome,
                Err(_) => CheckpointOutcome::Cancelled,
            })
        }
    }

    /// The node's single entry point (ADR-0069): one JSON document in, one JSON document out.
    ///
    /// Zero parameters, because the official Extism Rust host SDK calls exports with no arguments
    /// (`raw_call` passes `&[]`, and `function_exists` only accepts `(0,1)->i32`). `0` means the document on
    /// the output is the node's result; a non-zero return carries an `error_set` message for a failure the
    /// plugin could not even turn into a result document.
    #[unsafe(no_mangle)]
    pub extern "C" fn dissolvef_run() -> i32 {
        let request = match read_request_document() {
            Ok(request) => request,
            // The same shape as `core.ts:186-188`'s `catch`: an unusable request is a failed result.
            Err(message) => return respond(&DissolvefResult::failure(&message)),
        };
        let scope = crate::contract::DissolvefRunScope::from_options(&request.run_options);
        let mut host = ExtismDissolvefHost::new(&scope);
        let result = crate::run::run_dissolvef(&request.input, &scope, &mut host);
        respond(&result)
    }

    fn read_request_document() -> Result<DissolvefRunRequest, String> {
        let bytes = read_input_bytes();
        let text = std::str::from_utf8(&bytes)
            .map_err(|error| format!("DissolveF input is not valid UTF-8: {error}"))?;
        serde_json::from_str(text).map_err(|error| format!("Invalid DissolveF request: {error}"))
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

    /// A block the host allocated: its size comes from `length`, its bytes from `load_*`.
    fn read_block(offset: u64) -> String {
        let length = unsafe { length(offset) } as usize;
        let mut bytes = vec![0u8; length];
        let mut index = 0;
        while index + 8 <= length {
            let chunk = unsafe { load_u64(offset + index as u64) };
            bytes[index..index + 8].copy_from_slice(&chunk.to_le_bytes());
            index += 8;
        }
        while index < length {
            bytes[index] = unsafe { load_u8(offset + index as u64) };
            index += 1;
        }
        String::from_utf8_lossy(&bytes).into_owned()
    }

    fn respond(result: &DissolvefResult) -> i32 {
        match serde_json::to_vec(result) {
            Ok(bytes) => {
                let offset = unsafe { alloc(bytes.len() as u64) };
                write_bytes_at(offset, &bytes);
                unsafe { output_set(offset, bytes.len() as u64) };
                0
            }
            Err(error) => {
                report_error(&format!("DissolveF could not serialize its result: {error}"))
            }
        }
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use xiranite_plugin_api::AbiCode;

    #[test]
    fn capability_requests_carry_the_operation_scope() {
        assert_eq!(
            serde_json::to_string(&FsStatRequest {
                operation_id: "op-1".to_string(),
                path: "D:\\library\\album".to_string(),
            })
            .unwrap(),
            r#"{"operationId":"op-1","path":"D:\\library\\album"}"#
        );
        assert_eq!(
            serde_json::to_string(&FsDeleteRequest {
                operation_id: "op-1".to_string(),
                path: "/a/b".to_string(),
                recursive: true,
            })
            .unwrap(),
            r#"{"operationId":"op-1","path":"/a/b","recursive":true}"#
        );
        assert_eq!(
            serde_json::to_string(&FsMoveRequest {
                operation_id: "op-1".to_string(),
                source_path: "/a/b/c.txt".to_string(),
                target_path: "/a/c.txt".to_string(),
            })
            .unwrap(),
            r#"{"operationId":"op-1","sourcePath":"/a/b/c.txt","targetPath":"/a/c.txt"}"#
        );
        assert_eq!(
            serde_json::to_string(&FsWriteRequest {
                operation_id: "op-1".to_string(),
                path: "/h.json".to_string(),
                text: "[]".to_string(),
            })
            .unwrap(),
            r#"{"operationId":"op-1","path":"/h.json","text":"[]"}"#
        );
        assert_eq!(
            serde_json::to_string(&CheckpointCallRequest {
                operation_id: "op-1".to_string(),
                phase: "dissolving".to_string(),
                processed_item_count: 3,
                total_item_count: 10,
            })
            .unwrap(),
            r#"{"operationId":"op-1","phase":"dissolving","processedItemCount":3,"totalItemCount":10}"#
        );
        assert_eq!(
            serde_json::to_string(&NowRequest { operation_id: "op-1".to_string() }).unwrap(),
            r#"{"operationId":"op-1"}"#
        );
    }

    #[test]
    fn emitted_events_keep_the_node_run_event_shape() {
        // Compared as values, because `serde_json::Map` is a `BTreeMap` and reorders the keys it holds; the
        // field names and the integral `progress` are what the operation stream contract pins.
        let quarter = run_event_to_value(&progress_event("/a/b/c.txt", 1, 4));
        assert_eq!(
            quarter,
            serde_json::json!({ "type": "progress", "progress": 25, "message": "/a/b/c.txt" })
        );
        assert_eq!(
            run_event_to_value(&finished_event("Dissolve completed.")),
            serde_json::json!({ "type": "progress", "progress": 100, "message": "Dissolve completed." })
        );
        assert_eq!(
            run_event_to_value(&progress_event("x", 0, 3)),
            serde_json::json!({ "type": "progress", "progress": 0, "message": "x" })
        );
        // `Math.round` parity on the halfway point (`core.ts:494`).
        assert_eq!(
            run_event_to_value(&progress_event("x", 4, 9)),
            serde_json::json!({ "type": "progress", "progress": 44, "message": "x" })
        );
        assert_eq!(
            run_event_to_value(&PluginRunEvent::log_message("noted")),
            serde_json::json!({ "type": "log", "message": "noted" })
        );
        let request = EmitRequest { operation_id: "op-1".to_string(), event: quarter };
        assert_eq!(
            serde_json::to_string(&request).unwrap(),
            r#"{"operationId":"op-1","event":{"message":"/a/b/c.txt","progress":25,"type":"progress"}}"#
        );
    }

    #[test]
    fn checkpoint_codes_are_the_abi_codes() {
        assert_eq!(CheckpointOutcome::Continue.abi_code(), 1);
        assert_eq!(CheckpointOutcome::Paused.abi_code(), 2);
        assert_eq!(CheckpointOutcome::Cancelled.abi_code(), 3);
        assert!(CheckpointOutcome::Cancelled.is_hard_stop());
        assert!(!CheckpointOutcome::Paused.is_hard_stop());
    }

    #[test]
    fn replies_decode_the_pinned_envelope() {
        let reply: FsStatReply =
            decode_host_reply(r#"{"ok":true,"data":{"path":"/a","exists":true,"isDirectory":true}}"#)
                .expect("stat reply");
        assert_eq!(reply.path.as_deref(), Some("/a"));
        assert!(reply.is_directory);

        let list: Vec<FsListEntry> = decode_host_reply(
            r#"{"ok":true,"data":[{"name":"a.zip","isFile":true},{"name":"sub","isDirectory":true}]}"#,
        )
        .expect("list reply");
        assert_eq!(list.len(), 2);
        assert!(list[0].is_file && !list[1].is_file);
        assert!(!list[1].is_file && list[1].is_directory);

        let read: FsReadReply = decode_host_reply(r#"{"ok":true,"data":{"text":null}}"#).expect("read");
        assert_eq!(read.text, None);
        let read: FsReadReply = decode_host_reply(r#"{"ok":true,"data":{}}"#).expect("read without text");
        assert_eq!(read.text, None);

        assert!(decode_host_ack(r#"{"ok":true}"#).is_ok());
        assert!(decode_host_ack(r#"{"ok":true,"data":null}"#).is_ok());
        let now: NowReply =
            decode_host_reply(r#"{"ok":true,"data":{"iso":"2026-07-21T16:04:54.445Z"}}"#)
                .expect("now reply");
        assert_eq!(now.iso, "2026-07-21T16:04:54.445Z");
    }

    #[test]
    fn a_refusal_becomes_data_and_only_cancellation_is_a_hard_stop() {
        let error = decode_host_reply::<FsReadReply>(
            r#"{"ok":false,"error":{"code":"permission_denied","message":"D:/x is not in allowed_paths"}}"#,
        )
        .expect_err("refusal");
        assert_eq!(error, DissolvefHostError::Failure("D:/x is not in allowed_paths".to_string()));

        let missing = decode_host_reply::<FsReadReply>(r#"{"ok":false,"error":{"code":"not_found"}}"#)
            .expect_err("refusal without a message");
        assert_eq!(missing, DissolvefHostError::Failure("not_found".to_string()));

        let cancelled = decode_host_reply::<FsReadReply>(
            r#"{"ok":false,"error":{"code":"cancelled","message":"operation cancelled"}}"#,
        )
        .expect_err("cancelled");
        assert_eq!(cancelled, DissolvefHostError::Cancelled);
        assert_eq!(cancelled.message(), "operation cancelled");

        // A reply that cannot be read at all is a failure the run reports, never a trap.
        assert!(matches!(
            decode_host_reply::<FsReadReply>("not json"),
            Err(DissolvefHostError::Failure(_))
        ));
        assert!(matches!(
            decode_host_reply::<FsReadReply>(r#"{"ok":true}"#),
            Err(DissolvefHostError::Failure(_))
        ));
    }
}
