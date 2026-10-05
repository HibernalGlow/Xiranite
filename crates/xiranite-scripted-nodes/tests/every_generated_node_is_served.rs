//! The generated table has to be covered *as a table*. `registered_scripted_node.rs` runs one node, which
//! leaves fourteen specs that compile but are never asked whether the registry can actually serve them —
//! and a registration list that silently loses an id is exactly the failure ADR-0074 §6 says the host
//! binary must not be able to ship.
//!
//! The anchor line below is not decoration: an object file no binary names can be dropped at link time, so
//! a registry built from inventory is only as full as this list (measured in `examples/unanchored.rs`).

xiranite_node_registry::link_nodes!(
    xiranite_scripted_nodes::CLASSQ_RUNNABLE,
    xiranite_scripted_nodes::CRASHU_RUNNABLE,
    xiranite_scripted_nodes::DISSOLVEF_RUNNABLE,
    xiranite_scripted_nodes::ENCODEB_RUNNABLE,
    xiranite_scripted_nodes::FORMATV_RUNNABLE,
    xiranite_scripted_nodes::GIFU_RUNNABLE,
    xiranite_scripted_nodes::LINEDUP_RUNNABLE,
    xiranite_scripted_nodes::LINKU_RUNNABLE,
    xiranite_scripted_nodes::LOGX_RUNNABLE,
    xiranite_scripted_nodes::MARKU_RUNNABLE,
    xiranite_scripted_nodes::MIGRATEF_RUNNABLE,
    xiranite_scripted_nodes::NAMEU_RUNNABLE,
    xiranite_scripted_nodes::RAWFILTER_RUNNABLE,
    xiranite_scripted_nodes::SAMEA_RUNNABLE,
    xiranite_scripted_nodes::TIMEU_RUNNABLE,
    xiranite_scripted_nodes::TRENAME_RUNNABLE,
);

use std::path::PathBuf;

use xiranite_node_registry::NodeRegistry;
use xiranite_scripted_nodes::{SCRIPTED_LINKED_NODES, SCRIPTED_NODE_IDS, UNREGISTERED_BUNDLES};

/// Every id the table claims must be reachable as both halves of a node: a runnable and a policy descriptor.
/// A list that is only half-populated is the `runnable_without_policy_ids` hole the registry warns about.
#[test]
fn every_generated_id_is_served_with_both_halves() {
    let registry = NodeRegistry::builtin().expect("the generated table must not collide with itself");
    for id in SCRIPTED_NODE_IDS {
        assert!(registry.runnable(id).is_some(), "{id} is listed but not runnable");
        assert!(
            registry.contains(id),
            "{id} is runnable but has no policy descriptor in the registry"
        );
    }
    let served = registry.ids().count();
    assert_eq!(
        served,
        SCRIPTED_NODE_IDS.len(),
        "the registry serves {served} nodes but the table lists {}",
        SCRIPTED_NODE_IDS.len()
    );
    assert!(
        registry.runnable_without_policy_ids().is_empty(),
        "some anchor reached the runnables without a descriptor: {:?}",
        registry.runnable_without_policy_ids()
    );
    // `anchors_not_collected` is the registry's own name for the failure this file exists to catch: an
    // anchor the table declares that inventory never delivered.
    assert!(
        registry
            .anchors_not_collected(SCRIPTED_LINKED_NODES)
            .is_empty(),
        "anchors the table declares but the registry did not collect: {:?}",
        registry.anchors_not_collected(SCRIPTED_LINKED_NODES)
    );
}

/// The two halves of the decision — registered and deliberately refused — must add up to the bundles that
/// are actually embedded, so a node cannot vanish by falling between the two lists.
#[test]
fn the_two_lists_add_up_to_the_embedded_bundles() {
    let index = std::fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../xiranite-quickjs-executor/bundles/index.json"),
    )
    .expect("the embedded bundle index is readable");
    let embedded = index
        .split("\"id\"")
        .skip(1)
        .filter(|chunk| chunk.trim_start().starts_with(':'))
        .count();

    assert!(embedded > 0, "the index named no bundle, so this check proves nothing");
    assert_eq!(
        SCRIPTED_NODE_IDS.len() + UNREGISTERED_BUNDLES.len(),
        embedded,
        "{} registered + {} refused does not equal the {embedded} embedded bundle(s)",
        SCRIPTED_NODE_IDS.len(),
        UNREGISTERED_BUNDLES.len(),
    );

    // A refusal without a reason is the same hole as a refusal without a record.
    for (id, reason) in UNREGISTERED_BUNDLES {
        assert!(!reason.trim().is_empty(), "{id} is refused with no reason attached");
    }
    assert!(
        !SCRIPTED_NODE_IDS.is_empty(),
        "nothing registered: this assertion pair would pass on an empty table"
    );
    assert!(
        SCRIPTED_NODE_IDS.len() > 1,
        "the table is back to a single node, so the loop above tests one case and calls it coverage"
    );
}

/// `SCRIPTED_LINKED_NODES` is what a host spreads into its own `link_nodes!`; if it disagrees with the id
/// list, a host that trusts it links a different set than the one the table advertises.
#[test]
fn the_anchor_list_and_the_id_list_agree() {
    assert_eq!(
        SCRIPTED_LINKED_NODES.len(),
        SCRIPTED_NODE_IDS.len(),
        "the anchor list and the id list drifted apart"
    );
    for node in SCRIPTED_LINKED_NODES {
        assert!(
            SCRIPTED_NODE_IDS.contains(&node.id()),
            "anchor {:?} is not in the id list",
            node.id()
        );
    }
}
