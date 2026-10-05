//! The shape a shipping host binary takes, runnable before one exists in a contended crate.
//!
//! ADR-0074 §6 says the host binary carries every linked node. Two rules make that real, and this example is
//! the measurement of both:
//!
//! 1. the bundle text is embedded at compile time (`include_str!` inside the generated registration), and
//! 2. the binary must *name* each runnable through [`link_nodes!`], because an object file nobody references
//!    can be dropped by the linker and the registry then comes back empty — the silent failure
//!    `crates/xiranite-node-registry/src/lib.rs:425-435` says it exists to prevent.
//!
//! Run it with `cargo run --manifest-path crates/xiranite-scripted-nodes/Cargo.toml --example host_smoke`.

// The anchor a real host declares. `crates/xiranite-scripted-nodes/examples/unanchored.rs` measures what
// actually happens when a binary omits this line, instead of trusting the rule as folklore.
xiranite_node_registry::link_nodes!(xiranite_scripted_nodes::LINEDUP_RUNNABLE);

use xiranite_node_registry::{
    NodeCheckpointRequest, NodeDirEntry, NodeHost, NodeHostResult, NodePathInfo, NodeRegistry,
};
use xiranite_plugin_api::checkpoint::CheckpointOutcome;
use xiranite_scripted_nodes::SCRIPTED_NODE_IDS;

/// A host with no environment to offer. `stat`/`read_text` answer the way the seam documents a refused path
/// (missing, not an error); every arm that would perform an effect refuses by panicking, because a node the
/// manifest measures as `pure-logic` must never reach one.
struct NoEnvironmentHost;

impl NodeHost for NoEnvironmentHost {
    fn stat(&mut self, path: &str) -> NodeHostResult<NodePathInfo> {
        Ok(NodePathInfo::missing(path))
    }
    fn list_dir(&mut self, path: &str) -> NodeHostResult<Vec<NodeDirEntry>> {
        panic!("a pure node asked to list {path:?}");
    }
    fn ensure_dir(&mut self, path: &str) -> NodeHostResult<()> {
        panic!("a pure node asked to create {path:?}");
    }
    fn move_path(&mut self, source: &str, target: &str) -> NodeHostResult<()> {
        panic!("a pure node asked to move {source:?} to {target:?}");
    }
    fn delete_path(&mut self, path: &str, recursive: bool) -> NodeHostResult<()> {
        panic!("a pure node asked to delete {path:?} (recursive={recursive})");
    }
    fn read_text(&mut self, _path: &str) -> NodeHostResult<Option<String>> {
        Ok(None)
    }
    fn write_text(&mut self, path: &str, _content: &str) -> NodeHostResult<()> {
        panic!("a pure node asked to write {path:?}");
    }
    fn now(&mut self) -> NodeHostResult<String> {
        panic!("a pure node asked the host for the clock");
    }
    fn emit(&mut self, _event: &xiranite_plugin_api::run_events::PluginRunEvent) -> NodeHostResult<()> {
        Ok(())
    }
    fn checkpoint(&mut self, _request: &NodeCheckpointRequest) -> NodeHostResult<CheckpointOutcome> {
        Ok(CheckpointOutcome::Continue)
    }
}

fn main() {
    assert!(
        !LINKED_NODES.is_empty(),
        "this binary names no node, so it is not a host shape at all"
    );
    let registry = NodeRegistry::builtin().expect("one entry per node");

    for link in LINKED_NODES {
        assert!(
            SCRIPTED_NODE_IDS.contains(&link.id()),
            "{} is anchored but not registered, which the registry refuses to serve",
            link.id()
        );
        assert!(
            registry.runnable(link.id()).is_some(),
            "{} is anchored but missing from the table",
            link.id()
        );
    }

    let request = r#"{"sourceLines":["alpha","beta","gamma","beta"],"filterLines":["beta"],"caseSensitive":false,"sort":true}"#;
    let mut host = NoEnvironmentHost;
    let document = registry
        .runnable("linedup")
        .expect("the scripted node is reachable by id")
        .run(request, &mut host)
        .expect("the embedded bundle answers");

    println!("linked anchors : {}", LINKED_NODES.len());
    println!("registry ids   : {:?}", registry.ids().collect::<Vec<_>>());
    println!("answer         : {document}");
}
