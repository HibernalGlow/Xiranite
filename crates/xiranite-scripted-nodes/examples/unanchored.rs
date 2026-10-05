//! The negative control for [`host_smoke`]: a binary that depends on this crate but names **no** anchor.
//!
//! `crates/xiranite-node-registry/src/lib.rs:425-435` claims the linker may drop an unreferenced object file,
//! so `NodeRegistry::builtin()` can come back empty even though the node is compiled into the dependency. This
//! example measures whether that failure actually occurs in this build shape, which decides how much the
//! `link_nodes!` discipline is protecting against.
//!
//! Run: `cargo run --manifest-path crates/xiranite-scripted-nodes/Cargo.toml --example unanchored`

use xiranite_node_registry::NodeRegistry;

fn main() {
    // Only the tables are referenced, never a runnable static: that is the whole point of the probe.
    let ids = xiranite_scripted_nodes::SCRIPTED_NODE_IDS;
    let registry = NodeRegistry::builtin().expect("no duplicate registration");
    let found: Vec<&str> = registry.ids().collect();
    println!("declared ids   : {ids:?}");
    println!("registry sees  : {found:?}");
    println!("anchored?      : {}", found.iter().any(|id| ids.contains(id)));
}
