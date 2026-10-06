//! The production [`OperationLauncher`] for built-in nodes (ADR-0074).
//!
//! `crates/xiranite-api` left this seam open: the routes write `queued` and hand the run over, and the
//! launcher owns the rest — `running` first, then exactly one terminal phase carrying the node's own
//! result document. [`xiranite_node_runtime::NodeRuntime`] does that for staged plugins; this type does it
//! for nodes that are *linked in*, whether their implementation is a native crate or a TypeScript bundle
//! executed by the embedded QuickJS ([`xiranite_quickjs_executor::JsNode`]).
//!
//! ## Why it is a registry of `BuiltInNode` and not a registry of scripts
//!
//! The launcher never learns that JavaScript is involved. It asks the registry for the runnable behind an
//! id and calls [`xiranite_node_registry::BuiltInNode::run`] with a [`NodeHost`] built over the
//! operation's grant — the same call a native Rust node receives (`crates/nodes/dissolvef/src/builtin.rs`),
//! from the same [`NativeNodeHost`], with the same event stream, clock and pause/cancel. Choosing the
//! executor is the registration's decision (`src/dissolvef.rs`), not this file's.
//!
//! ## The one grant
//!
//! A host process passes the roots every operation may reach, exactly as the wasm runtime does, and each
//! run gets a fresh [`FileCapability`] over them plus its own `OperationControl`. The QuickJS executor
//! refuses to widen that: its `fs.copy`/`mkdtemp`/link arms read the grant through
//! [`xiranite_quickjs_executor`]'s machine surface, and an operation outside it is a refusal, not a path.

use std::path::PathBuf;
use std::sync::Arc;

use xiranite_api::{LaunchRequest, OperationLauncher};
use xiranite_core::filesystem::FileCapability;
use xiranite_core::{Clock, NodeRunResultRecord, OperationControl, OperationManager, OperationPhase};
use xiranite_node_registry::{BuiltInNode, NodeHost, NodeRegistry};
use xiranite_scripted_nodes::SCRIPTED_REGISTRATIONS;

/// The ids the generated table registers, re-exported so a host built on this crate can name the table it
/// serves without adding a second dependency edge (`crates/xiranite-loopback-host/tests/` is the reader: it
/// compares the launcher's served list against the table itself, which is the check that a `--node` subset
/// build actually reached the product host).
pub use xiranite_scripted_nodes::SCRIPTED_NODE_IDS;
use xiranite_native_host::NativeNodeHost;

/// Runs linked-in nodes for every face: the Tauri host, a node CLI, a node TUI.
pub struct BuiltInNodeLauncher {
    registry: Arc<NodeRegistry>,
    clock: Arc<dyn Clock>,
    grants: Vec<PathBuf>,
}

impl BuiltInNodeLauncher {
    /// Builds the launcher over the nodes this crate links.
    ///
    /// # Errors
    ///
    /// [`NodeRegistry`]'s own refusal: two linked nodes claiming one id is a build-time disagreement the
    /// host must not resolve by picking one.
    pub fn new(clock: Arc<dyn Clock>, grants: Vec<PathBuf>) -> Result<Self, String> {
        Self::with_registry(built_in_registry().map_err(|error| error.to_string())?, clock, grants)
    }

    /// Builds the launcher over a registry the caller assembled (the desktop host's staging step, tests).
    pub fn with_registry(
        registry: NodeRegistry,
        clock: Arc<dyn Clock>,
        grants: Vec<PathBuf>,
    ) -> Result<Self, String> {
        let node_ids = registry.ids().collect::<Vec<_>>();
        if node_ids.is_empty() {
            return Err(String::from(
                "the built-in host was asked to run with an empty node registry; a host that answers every \
                 operation with \"unknown node\" is not a passing startup",
            ));
        }
        Ok(Self { registry: Arc::new(registry), clock, grants })
    }

    /// The ids this host can run, for the startup line and the faces' node pickers.
    #[must_use]
    pub fn node_ids(&self) -> Vec<&'static str> {
        self.registry.ids().collect()
    }

    /// The granted roots, for the host's own audit line.
    #[must_use]
    pub fn grants(&self) -> &[PathBuf] {
        &self.grants
    }
}

/// The registry this host's launcher runs against: every node the generated table spells, both halves.
///
/// As of 2026-10-06 this is *only* the table. `dissolvef` left the hand-linked side on the 6th and `kisaki`
/// followed the same night, so there is no second spelling of any node here — which is the point, because a
/// node declared in both places registers its id twice and the host refuses to start.
///
/// # Errors
///
/// [`NodeRegistry::from_registrations`]'s `DuplicateId` — which for this crate means the generated table
/// itself declared one id twice, not that a plugin staged a conflicting file.
pub fn built_in_registry() -> Result<NodeRegistry, xiranite_node_registry::RegistryError> {
    NodeRegistry::from_registrations(
        SCRIPTED_REGISTRATIONS.iter().map(|(descriptor, _node)| *descriptor),
        SCRIPTED_REGISTRATIONS.iter().map(|(_descriptor, node)| *node),
    )
}

impl OperationLauncher for BuiltInNodeLauncher {
    /// Hands the run to a blocking thread and returns, which is what lets the route answer `queued`.
    ///
    /// A QuickJS run is CPU-bound JavaScript plus host calls the pump answers, with `waitWhilePaused`
    /// implemented by sleeping and re-reading the control — it belongs on `spawn_blocking`, the same arm
    /// `xiranite-node-runtime/src/launcher.rs:60-76` uses, not on an async task that would hold a worker.
    fn launch(&self, request: LaunchRequest) {
        let registry = Arc::clone(&self.registry);
        let clock = Arc::clone(&self.clock);
        let grants = self.grants.clone();
        // A dropped `JoinHandle` still runs the task to completion: every path in `run` writes a
        // terminal phase, so no operation is left `queued` because nobody awaited this.
        let _handle = tokio::task::spawn_blocking(move || run(request, registry, clock, grants));
    }
}

/// Drives one operation from `running` to a terminal phase.
fn run(
    request: LaunchRequest,
    registry: Arc<NodeRegistry>,
    clock: Arc<dyn Clock>,
    grants: Vec<PathBuf>,
) {
    let LaunchRequest { manager, control, node_id, input } = request;
    if manager.mark_running(control.operation_id()).is_none() {
        // Cleaned up between `start()` and here; there is nothing left to report to.
        return;
    }

    let node: &dyn BuiltInNode = match registry.runnable(&node_id) {
        Some(node) => node,
        None => {
            finish(
                &manager,
                &control,
                OperationPhase::Error,
                &format!("node {node_id:?} is not linked into this host"),
            );
            return;
        }
    };

    let files = FileCapability::new(grants.iter().map(PathBuf::as_path));
    let mut host = NativeNodeHost::new(manager.clone(), control.clone(), files, Arc::clone(&clock));
    let document = input_document(&input);
    match node.run(&document, &mut host as &mut dyn NodeHost) {
        Ok(answer) => finish_from_document(&manager, &control, &answer),
        Err(error) => finish(&manager, &control, OperationPhase::Error, &error.message),
    }
}

/// The node's input JSON as text: the raw bytes the client sent, or `{}` when it sent none.
///
/// `routes.rs:94-97` accepts an empty body, and a scripted node reads `input.path` off the document, so
/// the host supplies the empty object rather than letting a bundle see a syntax error.
fn input_document(input: &[u8]) -> String {
    let text = String::from_utf8_lossy(input);
    if text.trim().is_empty() { String::from("{}") } else { text.into_owned() }
}

/// Writes the node's result document as the terminal transition.
fn finish_from_document(manager: &OperationManager, control: &OperationControl, document: &str) {
    let Ok(result) = serde_json::from_str::<NodeRunResultRecord>(document) else {
        let excerpt: String = document.chars().take(400).collect();
        finish(
            manager,
            control,
            OperationPhase::Error,
            &format!("the node's result document was not nodeRunResultSchema JSON: {excerpt}"),
        );
        return;
    };
    // Cancel wins over what the node returned — the TypeScript runner's rule, kept identical here so a
    // face cannot see `completed` for a run the user stopped.
    let phase = if control.cancel_requested() {
        OperationPhase::Cancelled
    } else if result.success {
        OperationPhase::Completed
    } else {
        OperationPhase::Error
    };
    manager.finish(control.operation_id(), phase, result);
}

/// The host's own failure line, for the paths where no node result exists.
fn finish(
    manager: &OperationManager,
    control: &OperationControl,
    phase: OperationPhase,
    message: &str,
) {
    manager.finish(control.operation_id(), phase, NodeRunResultRecord::failed(message));
}
