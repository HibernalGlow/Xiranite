//! The ceremony-free assembly path, measured.
//!
//! AGENTS.md retires the per-node `register_node!`/`link_nodes!` ritual and `NodeRegistry::builtin()`, so a
//! host should be able to get its scripted nodes from the generated table alone. This file deliberately
//! contains **no** `link_nodes!` anchor — if the registry still comes up full here, the table is genuinely
//! self-sufficient rather than working by accident through an anchor declared somewhere else.

use xiranite_node_registry::{NodeRegistry, RegistryError};
use xiranite_scripted_nodes::{SCRIPTED_NODE_IDS, SCRIPTED_REGISTRATIONS, scripted_registry};

#[test]
fn the_table_alone_serves_every_registered_id() {
    let registry = scripted_registry().expect("the generated table must assemble a registry");
    assert_eq!(
        registry.ids().count(),
        SCRIPTED_NODE_IDS.len(),
        "the table has {} pairs but the registry serves {}",
        SCRIPTED_REGISTRATIONS.len(),
        registry.ids().count(),
    );
    for id in SCRIPTED_NODE_IDS {
        assert!(registry.contains(id), "{id} missing from the policy half");
        assert!(registry.runnable(id).is_some(), "{id} missing from the runnable half");
    }
    assert!(
        !SCRIPTED_NODE_IDS.is_empty(),
        "an empty table would pass every assertion above, so this test would prove nothing"
    );
}

/// A pair list that repeats an id has to fail the assembly, not silently drop to whichever entry the
/// iterator reaches second. Without this control the loop above cannot tell "the table is consistent" from
/// "nothing checked the table".
#[test]
fn a_repeated_pair_is_refused_rather_than_resolved_by_order() {
    let (descriptor, node) = SCRIPTED_REGISTRATIONS
        .first()
        .expect("the table must not be empty for this control to mean anything");
    let error = NodeRegistry::from_registrations([*descriptor, *descriptor], [*node, *node])
        .expect_err("the same id declared twice must be refused");
    assert_eq!(error, RegistryError::DuplicateId { id: descriptor.id });
}

/// Each pair must be a matched couple: the runnable's own descriptor has to agree with the policy entry
/// sitting next to it, or a host would advertise one policy and run another node's code.
#[test]
fn each_pair_agrees_with_itself() {
    for (descriptor, node) in SCRIPTED_REGISTRATIONS {
        assert_eq!(
            node.descriptor().id, descriptor.id,
            "a pair in the table claims two different ids"
        );
    }
}
