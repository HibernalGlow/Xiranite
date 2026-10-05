//! Extism-facing entry points for the NameU plugin.
//!
//! Only three functions are exported. `plan` and `undo_plan` are read-only and `rename` is the only
//! entry that writes — that boundary did not move with ADR-0071. What did move is *how* a write
//! happens: the file half of [`NameuRuntime`] is [`crate::std_fs_runtime::StdFilesystem`], plain
//! `std::fs` against the WASI preopens the host grants from the manifest's `allowed_paths`, so this
//! file no longer declares `xiranite.fs.*` imports.
//!
//! Two capability calls stay, because they are product semantics and no WASI proposal covers them
//! (ADR-0071 decision 4): `xiranite.operation.emit` for the node's progress stream and
//! `xiranite.operation.checkpoint` for ADR-0066's cooperative yield. Both answer with the same
//! `NameuHostReply` envelope, so a refusal is data and not a trapped isolate — the `error` row the
//! TypeScript produced for a thrown `rename` (`core.ts:125-126`) is still produced here.

use extism_pdk::{host_fn, plugin_fn, FnResult, Json};
use serde::{Deserialize, Serialize};
use serde::de::DeserializeOwned;

use crate::contract::{
    NameuCheckpointReply, NameuCheckpointRequest, NameuCheckpointStatus, NameuDirEntry, NameuInput,
    NameuPathInfo, NameuPlanItem, NameuResult, NameuRunEvent,
};
use crate::path::{basename_of, dirname_of, join_paths};
use crate::plan::{NameuRuntime, NameuRuntimeError, NameuRuntimeResult, run_nameu};
use crate::std_fs_runtime::StdFilesystem;
use crate::undo::{NameuUndoPlan, build_nameu_undo_plan};

/// The two capabilities NameU actually imports, and nothing else.
///
/// `extism_pdk::host_fn` turns each declaration into a Rust identifier by flattening the manifest's
/// dotted name, so `xiranite.operation.checkpoint` in `manifest.toml` is the Extism user function
/// `xiranite_operation_checkpoint`. The flattening is injective and is derived from
/// `xiranite_plugin_api::host_function_names`, which is the single source of truth for the
/// vocabulary; the retired `xiranite.fs.*` names that used to sit in this block are gone rather than
/// renamed.
#[host_fn]
extern "ExtismHost" {
    fn xiranite_operation_checkpoint(request: String) -> String;
    fn xiranite_operation_emit(event: String) -> String;
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NameuHostReply<T> {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
}

/// The `NameuRuntime` half that a WASM plugin reaches: `std::fs` for the files, JSON over host calls
/// for the operation.
pub(crate) struct ExtismNameuRuntime {
    filesystem: StdFilesystem,
}

impl ExtismNameuRuntime {
    pub(crate) fn new() -> Self {
        Self { filesystem: StdFilesystem::new() }
    }
}

fn decode_reply<T: DeserializeOwned>(raw: String) -> NameuRuntimeResult<NameuHostReply<T>> {
    serde_json::from_str::<NameuHostReply<T>>(&raw)
        .map_err(|error| NameuRuntimeError::Failure(format!("malformed host reply: {error}")))
}

/// An event or checkpoint reply: the `ok` flag decides, `data` is absent.
fn unwrap_ack(raw: String) -> NameuRuntimeResult<()> {
    let reply = decode_reply::<()>(raw)?;
    if reply.ok {
        return Ok(());
    }
    Err(NameuRuntimeError::Failure(
        reply.error.unwrap_or_else(|| "host call failed".to_string()),
    ))
}

impl NameuRuntime for ExtismNameuRuntime {
    fn path_info(&mut self, path: &str) -> NameuRuntimeResult<NameuPathInfo> {
        self.filesystem.path_info(path)
    }

    fn list_dir(&mut self, path: &str) -> NameuRuntimeResult<Vec<NameuDirEntry>> {
        self.filesystem.list_dir(path)
    }

    fn rename(&mut self, from: &str, to: &str) -> NameuRuntimeResult<()> {
        self.filesystem.rename(from, to)
    }

    fn set_times(&mut self, path: &str, atime_ms: f64, mtime_ms: f64) -> NameuRuntimeResult<()> {
        self.filesystem.set_times(path, atime_ms, mtime_ms)
    }

    // Path shaping stays in the plugin: it is pure string work, and routing it through the host
    // would add a call per planned row for no permission benefit.
    fn join(&self, parts: &[&str]) -> String {
        join_paths(parts)
    }

    fn dirname(&self, path: &str) -> String {
        dirname_of(path)
    }

    fn basename(&self, path: &str) -> String {
        basename_of(path)
    }

    fn emit(&mut self, event: &NameuRunEvent) -> NameuRuntimeResult<()> {
        let payload = serde_json::to_string(event)
            .map_err(|error| NameuRuntimeError::Failure(error.to_string()))?;
        unwrap_ack(xiranite_operation_emit(payload))
    }

    fn checkpoint(&mut self, request: &NameuCheckpointRequest) -> NameuRuntimeResult<NameuCheckpointStatus> {
        let payload = serde_json::to_string(request)
            .map_err(|error| NameuRuntimeError::Failure(error.to_string()))?;
        let reply: NameuCheckpointReply = serde_json::from_str(&xiranite_operation_checkpoint(payload))
            .map_err(|error| NameuRuntimeError::Failure(format!("malformed checkpoint reply: {error}")))?;
        Ok(reply.status)
    }
}

/// `action: "plan"` (and `"scan"`) — dry-run by construction, no write goes to the filesystem.
#[plugin_fn]
pub fn plan(input: Json<NameuInput>) -> FnResult<Json<NameuResult>> {
    let result = run_nameu(&input.0, &mut ExtismNameuRuntime::new());
    Ok(Json(result))
}

/// `action: "rename"`. Still honours `dryRun`, which is the default, so a caller
/// that forgets to clear it cannot mutate anything (core.ts:91, 109).
#[plugin_fn]
pub fn rename(input: Json<NameuInput>) -> FnResult<Json<NameuResult>> {
    let mut payload = input.0;
    payload.action = Some(crate::contract::NameuAction::Rename);
    let result = run_nameu(&payload, &mut ExtismNameuRuntime::new());
    Ok(Json(result))
}

/// Reversal of an applied plan; pure, so the host can call it without granting write access.
#[plugin_fn]
pub fn undo_plan(applied: Json<Vec<NameuPlanItem>>) -> FnResult<Json<NameuUndoPlan>> {
    Ok(Json(build_nameu_undo_plan(&applied.0)))
}
