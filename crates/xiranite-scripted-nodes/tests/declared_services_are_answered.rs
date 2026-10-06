//! A node's declared host services must be answerable by the binary that ships the node.
//!
//! Today no generated descriptor declares a service — `scripts/embed-node-bundles.ts` refuses that whole
//! branch — so a test that only walked the real table would pass by enumerating nothing. The two control
//! tests below run the *same* helper against a name the host does not answer and a name it does, so "the
//! gate is empty" and "the gate works" are different results. That separation is what a cargo feature
//! compiled out of `host_services::SERVICES` will be judged by: the feature removes the row, and this is
//! the check that then turns the declaration red instead of letting it fail at the first operation.
//!
//! The set comes from the host itself (`xiranite_quickjs_executor::published_services`), never from a list
//! copied into a script. Reading the Rust source from TypeScript is not available here — the
//! `@ast-grep/napi` build in this repo does not support Rust — and text scanning would keep reporting a
//! service a feature has compiled out.

use xiranite_node_registry::NodeDescriptor;
use xiranite_quickjs_executor::published_services;
use xiranite_scripted_nodes::SCRIPTED_REGISTRATIONS;

/// The services this node declares that the running host cannot answer.
fn unanswerable(descriptor: &NodeDescriptor, answered: &[&str]) -> Vec<String> {
    descriptor
        .requirements
        .services
        .iter()
        .filter(|declared| !answered.contains(declared))
        .map(|declared| (*declared).to_string())
        .collect()
}

/// Without a non-empty table every assertion below is vacuous, so the table's contents are asserted first.
#[test]
fn the_host_publishes_a_non_empty_service_table() {
    let answered = published_services();
    assert!(
        !answered.is_empty(),
        "this host links no services at all, so the gate below could not see a violation"
    );
}

#[test]
fn every_declared_service_is_answered_by_the_host() {
    let answered = published_services();
    for &(descriptor, _node) in SCRIPTED_REGISTRATIONS {
        let missing = unanswerable(descriptor, &answered);
        assert!(
            missing.is_empty(),
            "{} declares {missing:?} but this build answers only: {}",
            descriptor.id,
            answered.join(", "),
        );
    }
}

/// Positive control: a service the host does not link must come back as a violation.
#[test]
fn a_service_the_host_does_not_answer_is_reported() {
    static DECLARED: &[&str] = &["__no_such_host_service__"];
    let descriptor = NodeDescriptor::new("control", "0.0.0", 1).with_services(DECLARED);
    let answered = published_services();
    assert_eq!(
        unanswerable(&descriptor, &answered),
        vec!["__no_such_host_service__".to_string()],
        "the gate let through a service this host cannot answer: {}",
        answered.join(", "),
    );
}

/// The mirror control: the same helper must not be stuck red on a name the host really does answer.
#[test]
fn a_service_the_host_does_answer_passes_the_same_check() {
    let answered = published_services();
    let real = *answered
        .first()
        .expect("the host publishes at least one service");
    let declared: &'static [&'static str] = Box::leak(Box::new([real]));
    let descriptor = NodeDescriptor::new("control", "0.0.0", 1).with_services(declared);
    assert!(
        unanswerable(&descriptor, &answered).is_empty(),
        "{real} is published by this host yet the gate reported it missing",
    );
}
