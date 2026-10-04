//! DissolveF as a built-in node (ADR-0073): the seam bridge, the registration, and nothing else.
//!
//! The business code keeps depending on [`DissolvefHost`] — that trait is what 100 green tests pin, and
//! rewriting every call site to a second trait name would change nothing observable while putting the
//! port at risk. What changes is who stands behind it: [`HostBridge`] adapts the shared
//! [`NodeHost`] that the host now implements *in this process*, so the Extism envelope, the block
//! allocation and the `xiranite.fs.*` symbol names all disappear without the planner noticing.
//!
//! ## Why the bridge is field-for-field
//!
//! [`NodePathInfo`] and [`NodeDirEntry`] were lifted from the node's own shapes rather than invented,
//! so the mapping is a copy with no reinterpretation. The one asymmetry worth naming:
//! [`NodeHostError::Cancelled`] must stay distinguishable from a refusal, because `run_dissolvef`
//! turns a refusal into a failure document and a cancel into `stats.cancelled` (ADR-0066). A bridge
//! that flattened both into `Failure` would report a cancelled run as a broken folder.
//!
//! ## What stays unported here
//!
//! No requirement in [`DESCRIPTOR`] grants an external program: DissolveF detects archives, images and
//! videos by extension (`criteria.rs`), never by running `ffmpeg` or `unzip`, and its old manifest
//! listed no `xiranite.process.run`. Declaring a program it does not use would widen the allowlist for
//! free, which is exactly what the requirements field exists to prevent.

use crate::contract::{DissolvefRunRequest, DissolvefRunScope};
use crate::document::{DissolvefDirEntry, DissolvefPathInfo};
use crate::host::{DissolvefCheckpointRequest, DissolvefHost, DissolvefHostError, DissolvefHostResult};
use crate::run::run_dissolvef;
use xiranite_node_registry::{
    BuiltInNode, NodeCheckpointRequest, NodeDescriptor, NodeHost, NodeHostError, NodeRunError,
    RootAccess, RootRequirement,
};
use xiranite_plugin_api::{CheckpointOutcome, PluginRunEvent};

/// The node's registration, spelled once. Both [`BuiltInNode::descriptor`] and `register_node!` read
/// this same `static`, so the registry and the runnable node cannot disagree about the id or the policy.
static DESCRIPTOR: NodeDescriptor = NodeDescriptor::new("dissolvef", "0.1.0", 1)
    .with_roots(&[RootRequirement {
        role: "workspace",
        access: RootAccess::ReadWrite,
    }])
    .walk_tree(true)
    // `max_live_bytes` carries the ceiling the node shipped with: `manifest.toml`'s
    // `memory_max_pages = 256` is 256 x 64 KiB. Keeping the number rather than rounding it to a
    // rounder one means a native run that exceeds what a wasm run could hold is still refused.
    .budget(16_777_216, 1);

xiranite_node_registry::register_node!(DESCRIPTOR);

/// Turns the shared host seam into the trait the node's business modules already call.
pub struct HostBridge<'host> {
    host: &'host mut dyn NodeHost,
}

impl<'host> HostBridge<'host> {
    /// Wraps the host the operation was started with.
    pub fn new(host: &'host mut dyn NodeHost) -> Self {
        Self { host }
    }
}

impl From<NodeHostError> for DissolvefHostError {
    fn from(error: NodeHostError) -> Self {
        match error {
            NodeHostError::Failure(message) => Self::Failure(message),
            NodeHostError::Cancelled => Self::Cancelled,
        }
    }
}

impl<'host> DissolvefHost for HostBridge<'host> {
    fn stat(&mut self, path: &str) -> DissolvefHostResult<DissolvefPathInfo> {
        self.host
            .stat(path)
            .map(|info| DissolvefPathInfo {
                path: info.path,
                exists: info.exists,
                is_file: info.is_file,
                is_directory: info.is_directory,
            })
            .map_err(Into::into)
    }

    fn list_dir(&mut self, path: &str) -> DissolvefHostResult<Vec<DissolvefDirEntry>> {
        self.host
            .list_dir(path)
            .map(|entries| {
                entries
                    .into_iter()
                    .map(|entry| DissolvefDirEntry {
                        name: entry.name,
                        path: entry.path,
                        is_file: entry.is_file,
                        is_directory: entry.is_directory,
                    })
                    .collect()
            })
            .map_err(Into::into)
    }

    fn ensure_dir(&mut self, path: &str) -> DissolvefHostResult<()> {
        self.host.ensure_dir(path).map_err(Into::into)
    }

    fn move_path(&mut self, source: &str, target: &str) -> DissolvefHostResult<()> {
        self.host.move_path(source, target).map_err(Into::into)
    }

    fn delete_path(&mut self, path: &str, recursive: bool) -> DissolvefHostResult<()> {
        self.host.delete_path(path, recursive).map_err(Into::into)
    }

    fn read_text(&mut self, path: &str) -> DissolvefHostResult<Option<String>> {
        self.host.read_text(path).map_err(Into::into)
    }

    fn write_text(&mut self, path: &str, content: &str) -> DissolvefHostResult<()> {
        self.host.write_text(path, content).map_err(Into::into)
    }

    fn now(&mut self) -> DissolvefHostResult<String> {
        self.host.now().map_err(Into::into)
    }

    fn emit(&mut self, event: &PluginRunEvent) -> DissolvefHostResult<()> {
        self.host.emit(event).map_err(Into::into)
    }

    fn checkpoint(
        &mut self,
        request: &DissolvefCheckpointRequest,
    ) -> DissolvefHostResult<CheckpointOutcome> {
        let shared = NodeCheckpointRequest {
            phase: request.phase,
            processed_item_count: request.processed_item_count,
            total_item_count: request.total_item_count,
        };
        self.host.checkpoint(&shared).map_err(Into::into)
    }
}

/// DissolveF, ready to be run by name from inside the host binary.
pub struct DissolvefNode;

impl BuiltInNode for DissolvefNode {
    fn descriptor(&self) -> NodeDescriptor {
        DESCRIPTOR
    }

    /// `dissolvef_run` minus the ABI: the same request document in, the same response document out.
    ///
    /// The scope still comes from `runOptions` rather than from the node, because the journal location
    /// and the undo-id suffix are machine-owned values the node must not invent for itself.
    fn run(&self, input: &str, host: &mut dyn NodeHost) -> Result<String, NodeRunError> {
        let request: DissolvefRunRequest = serde_json::from_str(input).map_err(|error| NodeRunError {
            message: format!("invalid DissolveF request document: {error}"),
        })?;
        let scope = DissolvefRunScope::from_options(&request.run_options);
        let mut bridge = HostBridge::new(host);
        let result = run_dissolvef(&request.input, &scope, &mut bridge);
        serde_json::to_string(&result).map_err(|error| NodeRunError {
            message: format!("DissolveF result document could not be serialized: {error}"),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{DESCRIPTOR, DissolvefNode, HostBridge};
    use crate::host::{DissolvefCheckpointRequest, DissolvefHost, DissolvefHostError};
    use xiranite_node_registry::{
        BuiltInNode, NetworkAccess, NodeCheckpointRequest, NodeDirEntry, NodeHost, NodeHostError,
        NodeHostResult, NodePathInfo, NodeRegistry, RootAccess,
    };
    use xiranite_plugin_api::PluginRunEvent;
    use xiranite_plugin_api::checkpoint::CheckpointOutcome;

    /// A seam host that answers from data the test supplies, and records every call so a green
    /// assertion cannot mean "the bridge never ran".
    struct ScriptedHost {
        calls: Vec<String>,
        /// What `stat` answers for the requested path.
        root: NodePathInfo,
        /// Which path answers a machine failure instead of the scripted answer. A policy *refusal* is
        /// not modelled here because the seam documents refusals as `exists: false`; this is the other
        /// arm, the one that has to cross as `Failure` and become a plan row's reason.
        failing_path: Option<String>,
        /// Which checkpoint starts answering `Cancelled`; `None` never cancels.
        cancel_at: Option<usize>,
        checkpoints: usize,
    }

    impl ScriptedHost {
        fn missing() -> Self {
            Self {
                calls: Vec::new(),
                root: NodePathInfo::missing("/placeholder"),
                failing_path: None,
                cancel_at: None,
                checkpoints: 0,
            }
        }
        fn existing_dir() -> Self {
            let mut host = Self::missing();
            host.root = NodePathInfo {
                path: "/work".to_string(),
                exists: true,
                is_file: false,
                is_directory: true,
            };
            host
        }
        fn failure_for(&self, path: &str) -> Option<NodeHostError> {
            self.failing_path
                .as_deref()
                .filter(|failing| *failing == path)
                .map(|failing| NodeHostError::Failure(format!("permission denied: {failing}")))
        }
    }

    impl NodeHost for ScriptedHost {
        fn stat(&mut self, path: &str) -> NodeHostResult<NodePathInfo> {
            self.calls.push(format!("stat {path}"));
            if let Some(error) = self.failure_for(path) {
                return Err(error);
            }
            Ok(self.root.clone())
        }
        fn list_dir(&mut self, path: &str) -> NodeHostResult<Vec<NodeDirEntry>> {
            self.calls.push(format!("list_dir {path}"));
            Ok(Vec::new())
        }
        fn ensure_dir(&mut self, path: &str) -> NodeHostResult<()> {
            self.calls.push(format!("ensure_dir {path}"));
            Ok(())
        }
        fn move_path(&mut self, source: &str, target: &str) -> NodeHostResult<()> {
            self.calls.push(format!("move_path {source} {target}"));
            Ok(())
        }
        fn delete_path(&mut self, path: &str, recursive: bool) -> NodeHostResult<()> {
            self.calls.push(format!("delete_path {path} {recursive}"));
            Ok(())
        }
        fn read_text(&mut self, path: &str) -> NodeHostResult<Option<String>> {
            self.calls.push(format!("read_text {path}"));
            Ok(None)
        }
        fn write_text(&mut self, path: &str, content: &str) -> NodeHostResult<()> {
            self.calls
                .push(format!("write_text {path} {}", content.len()));
            Ok(())
        }
        fn now(&mut self) -> NodeHostResult<String> {
            self.calls.push("now".to_string());
            Ok("2026-10-04T00:00:00.000Z".to_string())
        }
        fn emit(&mut self, event: &PluginRunEvent) -> NodeHostResult<()> {
            self.calls.push(format!("emit {:?}", event.kind()));
            Ok(())
        }
        fn checkpoint(
            &mut self,
            request: &NodeCheckpointRequest,
        ) -> NodeHostResult<CheckpointOutcome> {
            self.checkpoints += 1;
            self.calls.push(format!(
                "checkpoint {} {}/{}",
                request.phase, request.processed_item_count, request.total_item_count
            ));
            if self
                .cancel_at
                .is_some_and(|number| self.checkpoints >= number)
            {
                return Err(NodeHostError::Cancelled);
            }
            Ok(CheckpointOutcome::Continue)
        }
    }

    #[test]
    fn a_built_in_crate_reaches_the_registry_of_the_binary_it_was_linked_into() {
        let registry = NodeRegistry::builtin().expect("no duplicate id in this test binary");
        assert!(
            !registry.is_empty(),
            "an empty table means link-time collection silently failed, not that the node is absent"
        );
        let descriptor = registry
            .get("dissolvef")
            .unwrap_or_else(|| panic!("dissolvef never reached the table: {:?}", registry.ids().collect::<Vec<_>>()));
        assert_eq!(*descriptor, DESCRIPTOR);
        assert_eq!(descriptor.node_version, "0.1.0");
        assert_eq!(
            descriptor.requirements.network,
            NetworkAccess::Disabled,
            "the collected copy must not have lost the safest default"
        );
    }

    #[test]
    fn the_registration_declares_exactly_what_the_node_does() {
        assert_eq!(DESCRIPTOR.requirements.roots.len(), 1);
        assert_eq!(DESCRIPTOR.requirements.roots[0].role, "workspace");
        assert_eq!(
            DESCRIPTOR.requirements.roots[0].access,
            RootAccess::ReadWrite,
            "the node renames and deletes, so a read-only root would refuse its whole purpose"
        );
        assert!(
            DESCRIPTOR.requirements.processes.is_empty(),
            "DissolveF detects by extension; a program grant here would widen the allowlist for free"
        );
        assert!(
            DESCRIPTOR.requirements.enumerates_recursively,
            "nested mode walks the tree, so the host must route it through the budgeted walker"
        );
        assert_eq!(DESCRIPTOR.requirements.max_live_bytes, 16_777_216);
        assert_eq!(DESCRIPTOR.requirements.max_concurrent_items, 1);
    }

    #[test]
    fn a_request_document_that_is_not_json_is_a_run_error_not_a_result_document() {
        let error = DissolvefNode
            .run("{not json", &mut ScriptedHost::missing())
            .expect_err("the entry point used to trap here; a native node must say so in words");
        assert!(
            error.message.starts_with("invalid DissolveF request document:"),
            "unexpected message: {}",
            error.message
        );
    }

    #[test]
    fn a_plan_run_sends_the_nodes_stat_through_the_seam() {
        let mut host = ScriptedHost::missing();
        let answer = DissolvefNode
            .run(
                r#"{"input":{"action":"plan","path":"/nowhere"}}"#,
                &mut host,
            )
            .expect("a missing path is a result document, not a failed run");
        let document: serde_json::Value = serde_json::from_str(&answer).expect("response is JSON");
        assert_eq!(document["success"], false);
        assert_eq!(document["message"], "Path does not exist: /nowhere");
        assert_eq!(
            host.calls.first().map(String::as_str),
            Some("stat /nowhere"),
            "the assertion above would also pass if the bridge never reached the host"
        );
    }

    #[test]
    fn a_cancelled_host_call_becomes_the_cancelled_document_not_a_failure() {
        let mut host = ScriptedHost::existing_dir();
        host.cancel_at = Some(1);
        let answer = DissolvefNode
            .run(
                r#"{"input":{"action":"dissolve","path":"/work","preview":true}}"#,
                &mut host,
            )
            .expect("a cancel is still a well-formed response");
        let document: serde_json::Value = serde_json::from_str(&answer).expect("response is JSON");
        assert_eq!(document["success"], false);
        assert_eq!(
            document["stats"]["cancelled"], 1,
            "ADR-0066: the host tells a cancel apart from a failure by this key, got {document}"
        );
    }

    #[test]
    fn the_bridge_keeps_refusal_and_cancellation_apart() {
        let mut host = ScriptedHost::existing_dir();
        host.failing_path = Some("/locked".to_string());
        host.cancel_at = Some(1);
        let mut bridge = HostBridge::new(&mut host);

        assert_eq!(
            bridge.stat("/locked"),
            Err(DissolvefHostError::Failure(
                "permission denied: /locked".to_string()
            )),
            "a machine failure must stay a failure: its message becomes a plan row's reason"
        );
        assert_eq!(
            bridge.checkpoint(&DissolvefCheckpointRequest {
                phase: "dissolving",
                processed_item_count: 1,
                total_item_count: 2,
            }),
            Err(DissolvefHostError::Cancelled),
            "and a cancel must stay a cancel: flattening both would report a cancelled run as a broken folder"
        );
        assert_eq!(
            host.calls.last().map(String::as_str),
            Some("checkpoint dissolving 1/2"),
            "the phase and counters must cross the seam intact"
        );
    }
}
