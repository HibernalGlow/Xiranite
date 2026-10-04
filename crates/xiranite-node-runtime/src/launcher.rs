//! The launcher that turns an `xiranite-api` operation into one plugin run.
//!
//! This is the seam `crates/xiranite-api/src/lib.rs` left open for the Extism host: the routes write
//! `queued`, hand the run over, and learn the rest from the event stream. The order of writes here
//! mirrors `executeOperation()` in `packages/services/src/index.ts`: `running` before the first
//! plugin call, then exactly one terminal phase with the plugin's result document.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{Map, Value, json};
use xiranite_api::{LaunchRequest, OperationLauncher};
use xiranite_core::filesystem::FileCapability;
use xiranite_core::{Clock, NodeRunResultRecord, OperationControl, OperationManager, OperationPhase};

use crate::capabilities::OperationCapabilities;
use crate::registry::NodeRegistry;

/// Runs node plugins for every face that needs one: the Tauri host, a node CLI, a node TUI.
///
/// The registry (staged wasm plus the compiled cache) is shared; the grants and the clock are per
/// host process. A run gets its own [`OperationCapabilities`], which is what keeps one compiled
/// plugin serving many operations (ADR-0068).
pub struct NodeRuntime {
    registry: Arc<NodeRegistry>,
    clock: Arc<dyn Clock>,
    grants: Vec<PathBuf>,
    data_dir: PathBuf,
}

impl NodeRuntime {
    /// Builds a runtime over staged nodes.
    ///
    /// `grants` are the roots every operation may reach through `xiranite.fs.*`; `data_dir` is where
    /// the host keeps per-node artifacts, which is what a node's default undo history lives under
    /// (`<data_dir>/artifacts/undo/<nodeId>.undo.json`, the same path `platform.ts:22-27` computed).
    #[must_use]
    pub fn new(
        registry: Arc<NodeRegistry>,
        clock: Arc<dyn Clock>,
        grants: Vec<PathBuf>,
        data_dir: PathBuf,
    ) -> Self {
        Self { registry, clock, grants, data_dir }
    }

    /// The staged nodes this runtime can run.
    #[must_use]
    pub fn registry(&self) -> &NodeRegistry {
        &self.registry
    }

    /// The granted roots, for the host's own audit line.
    #[must_use]
    pub fn grants(&self) -> &[PathBuf] {
        &self.grants
    }
}

impl OperationLauncher for NodeRuntime {
    /// Hands the run to a blocking thread and returns immediately, which is what lets the route
    /// answer with the `queued` record while the plugin works.
    ///
    /// A plugin call is synchronous CPU work inside a wasm frame plus sleep-based waits in
    /// `xiranite.operation.checkpoint`, so it belongs on `spawn_blocking` rather than on an async task
    /// that would hold a worker thread hostage.
    fn launch(&self, request: LaunchRequest) {
        let registry = Arc::clone(&self.registry);
        let clock = Arc::clone(&self.clock);
        let grants = self.grants.clone();
        let data_dir = self.data_dir.clone();
        // A dropped `JoinHandle` still runs the task to completion; the operation reaches a terminal
        // phase because every path in `run` writes one.
        let _handle = tokio::task::spawn_blocking(move || run(request, registry, clock, grants, data_dir));
    }
}

/// Drives one operation from `running` to a terminal phase.
fn run(
    request: LaunchRequest,
    registry: Arc<NodeRegistry>,
    clock: Arc<dyn Clock>,
    grants: Vec<PathBuf>,
    data_dir: PathBuf,
) {
    let LaunchRequest { manager, control, node_id, input } = request;
    if manager.mark_running(control.operation_id()).is_none() {
        // The operation was cleaned up between `start()` and here; there is nothing to report to.
        return;
    }

    let compiled = match registry.compiled(&node_id) {
        Ok(compiled) => compiled,
        Err(error) => {
            finish(&manager, &control, OperationPhase::Error, &error.to_string());
            return;
        }
    };

    let files = FileCapability::new(grants.iter().map(PathBuf::as_path));
    let capabilities = Arc::new(OperationCapabilities::new(
        manager.clone(),
        control.clone(),
        files,
        Arc::clone(&clock),
    ));
    let request_document = invocation_document(control.operation_id(), &node_id, &input, &data_dir);

    match compiled.run(capabilities, &request_document) {
        Ok(document) => finish_from_document(&manager, &control, &document),
        Err(error) => finish(&manager, &control, OperationPhase::Error, &error.to_string()),
    }
}

/// `nodeRunRequestSchema.input` plus the run options, as the document the plugin's entry point reads.
///
/// The input is re-embedded as the raw JSON it already is; the host never round-trips a node's input
/// through a Rust model, because the field names belong to the node (ADR-0068: JSON is an encoding,
/// not the ABI). The run options are the machine-owned values the TypeScript read from `runtime`:
/// the operation id, the default undo-history path under the host's data directory, and the record-id
/// seed — the settled vocabulary has no randomness call, so the run's identity stands in, and one
/// value per run is what `dissolve_record_id` needs because it also mixes in the timestamp, the path
/// and the operation list.
fn invocation_document(operation_id: &str, node_id: &str, input: &[u8], data_dir: &Path) -> String {
    let parsed: Value = serde_json::from_slice(input).unwrap_or_else(|_| Value::Object(Map::new()));
    let history_path =
        data_dir.join("artifacts").join("undo").join(format!("{node_id}.undo.json"));
    let mut document = Map::new();
    document.insert("input".to_string(), parsed);
    document.insert(
        "runOptions".to_string(),
        json!({
            "operationId": operation_id,
            "defaultHistoryPath": history_path.to_string_lossy(),
            "undoRecordIdSuffix": operation_id,
        }),
    );
    Value::Object(document).to_string()
}

/// Writes the plugin's result document as the terminal transition.
fn finish_from_document(manager: &OperationManager, control: &OperationControl, document: &str) {
    let Ok(result) = serde_json::from_str::<NodeRunResultRecord>(document) else {
        // A plugin that answers with anything else has broken `nodeRunResultSchema`; quoting the
        // first bytes is what makes that debuggable from the monitor card alone.
        let excerpt: String = document.chars().take(400).collect();
        finish(
            manager,
            control,
            OperationPhase::Error,
            &format!("the plugin's result document was not nodeRunResultSchema JSON: {excerpt}"),
        );
        return;
    };
    // Cancel wins over what the plugin returned, which is the TypeScript runner's rule: the user
    // asked for a stop, and a run that finished anyway after the flag is reported as cancelled.
    let phase = if control.cancel_requested() {
        OperationPhase::Cancelled
    } else if result.success {
        OperationPhase::Completed
    } else {
        OperationPhase::Error
    };
    manager.finish(control.operation_id(), phase, result);
}

/// The host's own failure line, for the paths where no plugin result exists.
fn finish(manager: &OperationManager, control: &OperationControl, phase: OperationPhase, message: &str) {
    manager.finish(control.operation_id(), phase, NodeRunResultRecord::failed(message));
}
