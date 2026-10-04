//! `xiranite help` and `xiranite help <node>`, built from the definition files the host ships.
//!
//! The pages themselves are the node's own words (`definition.help`, printed by the layout the terminal uses
//! today), so what these tests pin is the host's part: which nodes are found, what happens when a name is wrong,
//! and that a node without a dictionary still gets a page instead of nothing.

use std::path::{Path, PathBuf};

use xiranite_cli_runtime::Catalog;
use xiranite_cli_runtime::CatalogError;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .map(|directory| directory.join("node-definitions").join("trename.json"))
        .find(|candidate| candidate.is_file())
        .and_then(|candidate| candidate.parent().map(|drafts| drafts.parent().expect("repo root above node-definitions").to_path_buf()))
        .expect("node-definitions/trename.json above the crate")
}

fn definition(path: &Path) -> PathBuf {
    path.to_path_buf()
}

#[test]
fn the_host_finds_every_definition_it_ships_and_lists_a_node_once() {
    let catalog = Catalog::discover(&repo_root()).expect("the repo root ships definitions");
    assert!(catalog.entries().len() >= 40, "the scan found only {} definitions, so a wrong root reads as an empty product", catalog.entries().len());

    let ids = catalog.node_ids();
    let mut sorted = ids.clone();
    sorted.sort_unstable();
    assert_eq!(ids, sorted, "the catalog is not in id order, so `xiranite help` shuffles between runs");

    let duplicates: Vec<&&str> = ids.iter().filter(|id| ids.iter().filter(|other| other == id).count() > 1).collect();
    assert!(duplicates.is_empty(), "one node id is listed twice: {duplicates:?}");
    assert!(catalog.entries().iter().any(|entry| entry.published), "no installed plugin definition was found, so the published side of the scan is untested");
    assert!(catalog.entries().iter().any(|entry| !entry.published), "no drafted definition was found");

    let trename = catalog.definition("trename").expect("trename is drafted");
    assert!(trename.help.is_some(), "trename publishes a dictionary, so its definition should carry the block");
}

#[test]
fn the_index_lists_each_node_with_its_own_title_in_the_session_language() {
    let catalog = Catalog::discover(&repo_root()).expect("the repo root ships definitions");
    let zh = catalog.render_index("zh");
    let en = catalog.render_index("en");

    assert!(zh.starts_with("可用节点"), "the zh index lost its heading: {zh}");
    assert!(en.starts_with("Available nodes"), "the en index lost its heading: {en}");
    for entry in catalog.entries() {
        let line = format!("  {} — {}", entry.node_id, entry.definition.title.resolve("en"));
        assert!(en.contains(&line), "the en index omits {} (expected {line:?})", entry.node_id);
    }
    assert_eq!(en.lines().count(), catalog.entries().len() + 1, "the index grew or lost a row");
}

#[test]
fn a_named_node_prints_its_own_page_and_a_node_without_a_dictionary_still_prints_one() {
    let catalog = Catalog::discover(&repo_root()).expect("the repo root ships definitions");
    let trename = catalog.render_node_help("trename", "zh").expect("trename is known");
    let definition = catalog.definition("trename").expect("trename");
    assert!(trename.starts_with("trename — "), "the page should open with the node's own heading: {trename}");
    let help = definition.help.as_ref().expect("block");
    let step = help.workflows.iter().flat_map(|workflow| workflow.entries.iter()).flat_map(|entry| entry.lines.resolve("zh")).next().expect("a step to look for");
    assert!(trename.contains(step.as_str()), "the page dropped the node's step {step:?}");

    // The baselined debt: comfygure ships no dictionary. Its page must still say what the node is and list its
    // fields, rather than rendering an empty screen that looks like a failure.
    let drafted = catalog.render_node_help("comfygure", "en").expect("comfygure is drafted");
    assert!(!drafted.trim().is_empty(), "a node without a help block produced an empty page");
    assert!(drafted.contains("Fields"), "the page omitted the fields the definition declares: {drafted}");
    assert!(catalog.definition("comfygure").expect("definition").help.is_none(), "comfygure gained a help block; this test's premise needs updating");
}

#[test]
fn an_unknown_node_names_the_id_and_lists_what_exists() {
    let catalog = Catalog::discover(&repo_root()).expect("the repo root ships definitions");
    let error = catalog.render_node_help("no-such-node", "en").expect_err("nothing publishes that id");
    assert!(
        matches!(&error, CatalogError::UnknownNode { node_id, known } if node_id == "no-such-node" && known.contains(&"trename".to_owned())),
        "expected UnknownNode naming the id and listing the real nodes, got {error:?}",
    );
    assert!(error.to_string().contains("no-such-node"), "the message does not repeat what the user typed");
}

#[test]
fn an_empty_scan_and_a_broken_file_are_refused_by_name() {
    // Positive control for the vacuous-scan guard: a host that pointed at the wrong directory would otherwise
    // print "no nodes" and look like an empty product rather than a mistake.
    let missing = Catalog::from_files(Path::new("/nonexistent-xiranite-root"), Vec::new()).expect_err("nothing was passed in");
    assert!(matches!(missing, CatalogError::EmptyScan { .. }), "an empty scan returned a catalog: {missing:?}");

    let scratch = std::env::temp_dir().join(format!("xiranite-catalog-{}", std::process::id()));
    std::fs::create_dir_all(&scratch).expect("scratch dir");
    let broken = scratch.join("broken.json");
    std::fs::write(&broken, "{\"definitionVersion\": 999}").expect("writable");
    let error = Catalog::from_files(&scratch, vec![definition(&broken)]).expect_err("a future version is not readable");
    let CatalogError::Invalid { path, message } = error else {
        panic!("expected Invalid, got {error:?}");
    };
    assert_eq!(path, broken, "the report does not name the file the user can open");
    assert!(message.contains("definitionVersion"), "the report does not say what is wrong: {message}");
    let _ = std::fs::remove_dir_all(&scratch);
}
