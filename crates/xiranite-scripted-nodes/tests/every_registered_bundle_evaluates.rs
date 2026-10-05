//! Every embedded bundle has to *evaluate*, not merely compile.
//!
//! A registration is `include_str!` of a build product, and this repo has already been bitten by artifacts
//! that linked and registered fine but threw on the first evaluation (the rolldown `__esmMin` ordering
//! defect: four of 24 host bundles were dead on arrival, invisible to `cargo check`, `clippy` and every
//! Rust test). Measured 2026-10-05: all registered bundles evaluate in the realm, and this file is what
//! keeps that from being a one-off claim.
//!
//! The classification is the point. A node reaching the host with an empty request is **expected** for
//! platform nodes (the host arms here panic, which proves the run got into business logic), and a node
//! answering `{"success":false,"message":"… is required"}` is the node's own validation. Neither is a
//! migration defect. Only an evaluation failure — the artifact never running at all — is.

use std::panic::{catch_unwind, AssertUnwindSafe};

use xiranite_node_registry::{
    NodeCheckpointRequest, NodeDescriptor, NodeDirEntry, NodeHost, NodeHostResult, NodePathInfo,
    NodeRegistry,
};
use xiranite_plugin_api::checkpoint::CheckpointOutcome;
use xiranite_plugin_api::run_events::PluginRunEvent;
use xiranite_quickjs_executor::{JsNode, JsNodeSpec};
use xiranite_scripted_nodes::{SCRIPTED_LINKED_NODES, SCRIPTED_NODE_IDS};

xiranite_node_registry::link_nodes!(
    xiranite_scripted_nodes::CLASSQ_RUNNABLE,
    xiranite_scripted_nodes::LINEDUP_RUNNABLE,
    xiranite_scripted_nodes::LOGX_RUNNABLE,
    xiranite_scripted_nodes::NAMEU_RUNNABLE,
    xiranite_scripted_nodes::SAMEA_RUNNABLE,
    xiranite_scripted_nodes::TIMEU_RUNNABLE,
);

/// Effectful arms panic on purpose: the panic escaping through `JsNode::run` is positive evidence that the
/// bundle evaluated far enough to call a host operation.
struct PanickingHost {
    reached: Vec<String>,
}

impl NodeHost for PanickingHost {
    fn stat(&mut self, path: &str) -> NodeHostResult<NodePathInfo> {
        self.reached.push(format!("stat({path})"));
        panic!("probe host: stat({path})");
    }
    fn list_dir(&mut self, path: &str) -> NodeHostResult<Vec<NodeDirEntry>> {
        self.reached.push(format!("list_dir({path})"));
        panic!("probe host: list_dir({path})");
    }
    fn ensure_dir(&mut self, path: &str) -> NodeHostResult<()> {
        self.reached.push(format!("ensure_dir({path})"));
        panic!("probe host: ensure_dir({path})");
    }
    fn move_path(&mut self, source: &str, target: &str) -> NodeHostResult<()> {
        self.reached.push(format!("move_path({source},{target})"));
        panic!("probe host: move_path");
    }
    fn delete_path(&mut self, path: &str, recursive: bool) -> NodeHostResult<()> {
        self.reached.push(format!("delete_path({path},{recursive})"));
        panic!("probe host: delete_path");
    }
    fn read_text(&mut self, path: &str) -> NodeHostResult<Option<String>> {
        self.reached.push(format!("read_text({path})"));
        panic!("probe host: read_text({path})");
    }
    fn write_text(&mut self, path: &str, _content: &str) -> NodeHostResult<()> {
        self.reached.push(format!("write_text({path})"));
        panic!("probe host: write_text({path})");
    }
    fn now(&mut self) -> NodeHostResult<String> {
        self.reached.push("now".to_string());
        panic!("probe host: now()");
    }
    fn emit(&mut self, _event: &PluginRunEvent) -> NodeHostResult<()> {
        Ok(())
    }
    fn checkpoint(&mut self, _request: &NodeCheckpointRequest) -> NodeHostResult<CheckpointOutcome> {
        Ok(CheckpointOutcome::Continue)
    }
}

#[derive(Debug, PartialEq)]
enum Outcome {
    Document,
    ReachedHost,
    /// A failure the executor reports for a reason other than the bundle failing to evaluate.
    RunError,
}

fn classify(node_id: &str) -> Outcome {
    let registry = NodeRegistry::builtin().expect("the anchors in this file must be collected");
    let node = registry
        .runnable(node_id)
        .unwrap_or_else(|| panic!("{node_id} is in SCRIPTED_NODE_IDS but not runnable"));
    let mut host = PanickingHost { reached: Vec::new() };
    match catch_unwind(AssertUnwindSafe(|| node.run("{}", &mut host))) {
        Ok(Ok(document)) => {
            let parsed: serde_json::Value = serde_json::from_str(&document)
                .unwrap_or_else(|error| panic!("{node_id} answered a non-document: {error}: {document}"));
            assert!(
                parsed.get("success").is_some(),
                "{node_id} answered without the envelope's success field: {parsed}"
            );
            assert!(
                !document.contains("rejected while evaluating"),
                "{node_id} never evaluated: {document}"
            );
            Outcome::Document
        }
        Ok(Err(error)) => {
            let message = error.message.to_lowercase();
            assert!(
                !(message.contains("rejected while evaluating") || message.contains("could not be read")),
                "{node_id} failed to evaluate: {}",
                error.message
            );
            Outcome::RunError
        }
        Err(panic) => {
            let text = panic
                .downcast_ref::<String>()
                .cloned()
                .unwrap_or_else(|| String::from("a panic without a message"));
            assert!(
                text.starts_with("probe host:") || text.contains("probe host"),
                "{node_id} panicked for a reason other than reaching the host: {text}"
            );
            Outcome::ReachedHost
        }
    }
}

#[test]
fn every_registered_bundle_evaluates_and_answers_or_reaches_the_host() {
    assert_eq!(
        SCRIPTED_LINKED_NODES.len(),
        SCRIPTED_NODE_IDS.len(),
        "this file's anchor list drifted from the table; add the new node here too"
    );
    let outcomes = SCRIPTED_NODE_IDS.iter().map(|id| (*id, classify(id))).collect::<Vec<_>>();
    assert!(outcomes.len() > 1, "a one-node loop is not coverage of a table");
    let documents = outcomes.iter().filter(|(_, kind)| *kind == Outcome::Document).count();
    assert!(documents > 0, "no bundle answered a document at all: {outcomes:?}");
    // Nothing may come back as `RunError`: that arm is where "the executor refused to schedule this node"
    // lives, and a registered id that cannot be scheduled is the half-wired host this repo calls false green.
    // (This is not a theoretical branch — 10 registrations once failed exactly here for `max_live_bytes = 0`.)
    let refused: Vec<_> = outcomes.iter().filter(|(_, kind)| *kind == Outcome::RunError).collect();
    assert!(refused.is_empty(), "registered nodes the run refused to schedule: {refused:?}");
    println!("evaluated {} bundle(s), {} answered a document", outcomes.len(), documents);
}

/// A deliberately broken artifact, so the loop above is provably able to see the defect it guards.
///
/// Without this, "no bundle reported a load failure" is equally consistent with "load failures are invisible
/// to this classification". This bundle throws at module scope — the `__esmMin`-style failure mode the file
/// exists for: it registers fine and compiles fine, and dies on first evaluation.
static BROKEN_SPEC: JsNodeSpec = JsNodeSpec::pure(
    NodeDescriptor::new("probe-broken-bundle", "0.0.0", 1).budget(1_048_576, 1),
    "throw new Error(\"probe bundle cannot evaluate\");",
    "run",
    "never reached",
);
static BROKEN_NODE: JsNode = JsNode::new(&BROKEN_SPEC);

#[test]
fn a_module_level_throw_is_visible_rather_than_silent() {
    let registry = NodeRegistry::from_registrations(
        [&BROKEN_SPEC.descriptor],
        [&BROKEN_NODE as &dyn xiranite_node_registry::BuiltInNode],
    )
    .expect("the probe node registers on its own");
    let node = registry.runnable("probe-broken-bundle").expect("probe node reachable");
    let mut host = PanickingHost { reached: Vec::new() };
    let outcome = catch_unwind(AssertUnwindSafe(|| node.run("{}", &mut host)));
    let text = match outcome {
        Ok(Ok(document)) => document,
        Ok(Err(error)) => error.message.to_string(),
        Err(panic) => panic
            .downcast_ref::<String>()
            .cloned()
            .unwrap_or_else(|| String::from("a panic without a message")),
    };
    assert!(
        text.contains("rejected while evaluating") || text.contains("probe bundle cannot evaluate"),
        "a bundle that throws at module scope answered like a healthy node, so the classifier is blind: {text}"
    );
}
