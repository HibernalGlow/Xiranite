//! Every host service the retained-node manifest declares must be answered by this crate's table.
//!
//! This is the arm that makes the feature plan honest. `docs/xiranite-target-node-manifest.json` is the
//! single source for what a node may reach, and three of its `retain-rewrite` rows already name a service
//! (`findz`, `kisaki`, `linku`), each backed by an `evidence` line pointing at the aliased import. A cargo
//! feature that compiles one of those rows out of `host_services::SERVICES` has to turn *this* test red at
//! the same commit, rather than letting a bundle discover the missing engine at its first `service.invoke`.
//!
//! The generated descriptors are not enough coverage on their own: a node still needs a byte ceiling and
//! named program grants before it is registered, so `declared_services_are_answered.rs` in
//! `crates/xiranite-scripted-nodes` walks an empty declaration set today. Reading the manifest instead of
//! the generated table gives this gate a non-empty sample right now, which is the difference between a
//! guard that runs and a guard that merely compiles.

use std::path::Path;

use xiranite_quickjs_executor::published_services;

fn repo_root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("crates/<crate> sits under the repository root")
}

/// `(node id, service name)` for every retained node that declares one.
fn manifest_declared_services() -> Vec<(String, String)> {
    let path = repo_root().join("docs").join("xiranite-target-node-manifest.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{} could not be read: {error}", path.display()));
    let document: serde_json::Value =
        serde_json::from_str(&text).expect("the retained-node manifest is JSON");

    let mut rows = Vec::new();
    let nodes = document["nodes"].as_array().expect("nodes is an array");
    for node in nodes {
        if node["disposition"].as_str() != Some("retain-rewrite") {
            continue;
        }
        let id = node["id"].as_str().unwrap_or("?").to_string();
        for name in node["services"].as_array().map(|list| list.iter()).into_iter().flatten() {
            if let Some(service) = name.as_str() {
                rows.push((id.clone(), service.to_string()));
            }
        }
    }
    rows
}

fn is_answered(answered: &[&'static str], service: &str) -> bool {
    answered.contains(&service)
}

fn unanswered<'a>(answered: &[&'static str], declared: impl Iterator<Item = &'a str>) -> Vec<String> {
    declared.filter(|service| !is_answered(answered, service)).map(str::to_string).collect()
}

/// Without a non-empty manifest sample the main assertion below would pass by enumerating nothing.
#[test]
fn the_manifest_actually_declares_services() {
    let declared = manifest_declared_services();
    assert!(
        !declared.is_empty(),
        "no retain-rewrite node declares a host service, so this gate cannot see a violation",
    );
    for (id, service) in &declared {
        println!("{id} declares service {service}");
    }
}

#[test]
fn every_manifest_service_is_answered_by_this_host() {
    let answered = published_services();
    let declared = manifest_declared_services();
    let missing = unanswered(&answered, declared.iter().map(|(_id, service)| service.as_str()));
    assert!(
        missing.is_empty(),
        "the manifest grants {missing:?} but this build answers only: {} — the row needs a feature \
         listing and a matching descriptor, not a silent refusal at run time",
        answered.join(", "),
    );
}

/// Positive control: the same helper must report a name the host does not link.
#[test]
fn a_service_the_host_does_not_answer_is_caught() {
    let answered = published_services();
    let declared = ["findz", "__definitely_not_a_host_service__"];
    assert_eq!(
        unanswered(&answered, declared.iter().copied()),
        vec!["__definitely_not_a_host_service__".to_string()],
        "the gate let through a name this host cannot answer: {}",
        answered.join(", "),
    );
}
