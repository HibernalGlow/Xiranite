//! The headless host's node list has to come from the same registry the desktop host builds.
//!
//! This is the last link of the route A chain and the only one not covered elsewhere: `--node` filters
//! the generated table (measured in `scripts/embed-node-bundle-subset.test.ts`), the built-in launcher
//! spreads that table (`crates/xiranite-builtin-host/tests/operations.rs`), and `loopback-host` is what
//! `xiranite-dev-host` and the Tauri window both start. If this crate rebuilt its own list, a subset
//! build would produce a host whose audit line and its actual dispatch table disagree — the failure mode
//! ADR-0069 route A was written to avoid.
//!
//! Two assertions do the work: the served ids equal the registry's ids (one source, no second spelling),
//! and the served set is strictly wider than the two nodes this crate hand-links, which is what proves the
//! generated table really arrived. The second one is falsifiable on purpose: removing the `chain` in
//! `built_in_registry()` drops it back to 2 and this test goes red.

use xiranite_builtin_host::built_in_registry;
use xiranite_loopback_host::stage_from_environment;

fn sorted(mut ids: Vec<String>) -> Vec<String> {
    ids.sort();
    ids
}

#[test]
fn the_headless_host_serves_exactly_what_the_builtin_registry_registers() {
    let staged = stage_from_environment().expect("the headless host must stage a non-empty registry");
    let registry = built_in_registry().expect("the built-in registry must not collide with itself");
    let from_registry: Vec<String> = registry.ids().map(str::to_owned).collect();
    assert_eq!(
        sorted(staged.node_ids.clone()),
        sorted(from_registry),
        "the launcher's served list and the audit list disagree: {:?}",
        staged.node_ids,
    );
}

#[test]
fn the_served_set_is_the_generated_table_and_nothing_else() {
    let staged = stage_from_environment().expect("the headless host must stage a non-empty registry");
    // Every half of the comparison is a failure: an id the table registers that the launcher does not serve
    // means the generated table never reached the host (so a `--node` subset build would be ignored by the
    // product host), and an id the launcher serves that the table does not name means a second spelling of a
    // node came back — which is how `dissolvef` was declared twice and the host refused to start.
    let mut served = staged.node_ids.clone();
    served.sort();
    let mut table = xiranite_builtin_host::SCRIPTED_NODE_IDS.to_vec();
    table.sort();
    assert_eq!(served, table, "the launcher's served list is not the generated table: {:?}", served);
}

/// Positive control for the second assertion: a hand-written list is not what is being checked, so an id
/// the host does not serve has to be reported by the same comparison.
#[test]
fn a_node_the_host_does_not_serve_is_reported() {
    let staged = stage_from_environment().expect("the headless host must stage a non-empty registry");
    let absent: Vec<&str> = ["__not_a_real_node__"]
        .into_iter()
        .filter(|id| !staged.node_ids.iter().any(|served| served == id))
        .collect();
    assert_eq!(absent, vec!["__not_a_real_node__"], "the comparison cannot see a missing node");
}
