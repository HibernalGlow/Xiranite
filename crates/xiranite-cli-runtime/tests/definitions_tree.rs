//! The reader and the evaluator against the repository's real definitions.
//!
//! Two things these tests exist for: every published definition must read into the model (a definition that
//! only the TypeScript validator accepts would make the CLI refuse a node the gate greened), and the
//! visibility/danger answers must come out of the data rather than be asserted as frozen counts, so a node
//! changing its definition changes the expectation by itself.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use xiranite_cli_runtime::wire::DefinitionReadError;
use xiranite_cli_runtime::{Danger, Values, danger_required, parse_definition, prompt_plan};
use xiranite_plugin_api::node_definition::{Condition, NodeDefinition, Predicate, Scalar, Test};

/// The repository root, found by its manifest marker rather than by a directory name: `artifacts/` holds
/// stale copies of `node-definitions/`, so matching on that directory alone would find the wrong root.
fn repo_root() -> PathBuf {
    let start = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let marker = Path::new("docs").join("xiranite-target-node-manifest.json");
    let mut current = Some(start.as_path());
    while let Some(directory) = current {
        if directory.join(&marker).is_file() {
            return directory.to_path_buf();
        }
        current = directory.parent();
    }
    panic!("no repository root above {start:?} (needs {})", marker.display());
}

fn definition_paths() -> Vec<PathBuf> {
    let root = repo_root();
    let mut paths = Vec::new();
    let drafts = root.join("node-definitions");
    for entry in fs::read_dir(&drafts).expect("node-definitions/").flatten() {
        if entry.path().extension().is_some_and(|suffix| suffix == "json") {
            paths.push(entry.path());
        }
    }
    let plugins = root.join("plugins");
    for entry in fs::read_dir(&plugins).expect("plugins/").flatten() {
        let published = entry.path().join("definition.json");
        if published.is_file() {
            paths.push(published);
        }
    }
    paths.sort();
    paths
}

fn read(definition: &Path) -> NodeDefinition {
    let text = fs::read_to_string(definition).unwrap_or_else(|error| panic!("{}: {error}", definition.display()));
    parse_definition(&text).unwrap_or_else(|error| panic!("{}: {error}", definition.display()))
}

/// The first field gated on `actionIs`, which is how every node hides a field outside its action.
fn action_gated_field(definition: &NodeDefinition) -> Option<&str> {
    definition.fields.iter().find_map(|field| match &field.visible {
        Condition::Single(Predicate { test: Test::ActionIs { .. }, negated: false, .. }) => Some(field.id.as_str()),
        _ => None,
    })
}

#[test]
fn every_published_and_drafting_definition_reads_into_the_model() {
    let paths = definition_paths();
    assert!(paths.len() >= 41, "expected at least the 41 published and drafted definitions, found {}", paths.len());

    let failures: Vec<String> = paths
        .iter()
        .filter_map(|path| {
            let text = fs::read_to_string(path).expect("readable");
            parse_definition(&text).err().map(|error| format!("{}: {error}", path.display()))
        })
        .collect();
    assert!(failures.is_empty(), "{} definition(s) failed to read:\n{}", failures.len(), failures.join("\n"));
}

#[test]
fn an_action_gated_field_is_hidden_for_other_actions_and_shown_for_its_own() {
    let definition = read(&repo_root().join("node-definitions/trename.json"));
    let field_id = action_gated_field(&definition).expect("trename gates a field on its action");
    let field = definition.fields.iter().find(|candidate| candidate.id == field_id).expect("declared field");
    let Condition::Single(Predicate { test: Test::ActionIs { action_field, allowed }, .. }) = &field.visible else {
        panic!("{field_id} is not gated by actionIs");
    };

    let outside = |action: &str| {
        let mut values: Values = BTreeMap::new();
        values.insert(action_field.clone(), Scalar::Text(action.to_owned()));
        values
    };
    let hidden_by = allowed[0].clone();
    let outside_action = if hidden_by == "scan" { "rename" } else { "scan" };

    let shown = prompt_plan(&definition, &outside(hidden_by.as_str()), "en");
    assert!(shown.iter().any(|step| step.field.id == *field_id), "{field_id} missing while its own action was active");

    let hidden = prompt_plan(&definition, &outside(outside_action), "en");
    assert!(hidden.iter().all(|step| step.field.id != *field_id), "{field_id} offered for action {outside_action}");

    // A gate is not a label: the plan must stay non-empty, or the node would look like it has no fields at all.
    assert!(!shown.is_empty() && !hidden.is_empty(), "trename declares fields for both actions");
}

#[test]
fn the_danger_gate_follows_the_definition_instead_of_a_hardcoded_action_name() {
    let definition = read(&repo_root().join("node-definitions/trename.json"));
    let gated_action = match &definition.danger {
        xiranite_plugin_api::node_definition::DangerGate::All(predicates) => predicates.iter().find_map(|predicate| match &predicate.test {
            Test::ActionIs { allowed, .. } if !predicate.negated => Some(allowed[0].clone()),
            _ => None,
        }),
        other => panic!("trename's gate is not the expected conjunction: {other:?}"),
    }
    .expect("trename gates on an action");

    let answers = |dry_run: bool| {
        let mut values: Values = BTreeMap::new();
        values.insert("action".to_owned(), Scalar::Text(gated_action.clone()));
        values.insert("dryRun".to_owned(), Scalar::Boolean(dry_run));
        values
    };

    // The node's own semantics: a dry run of the same action is not the destructive case.
    let live = danger_required(&definition, &answers(false));
    let preview = danger_required(&definition, &answers(true));
    assert_ne!(live, preview, "the gate ignored the flag the node declared it on");
    assert!(
        matches!(live, Danger::Confirm { .. } | Danger::FromPlugin { .. }),
        "the destructive answer must ask, got {live:?}"
    );
    assert_eq!(preview, Danger::NotRequired, "a preview run asked for confirmation");
}

#[test]
fn the_reader_refuses_shapes_the_contract_does_not_define() {
    let base = r#"{"definitionVersion":1,"nodeId":"probe","title":{"zh":"探测","en":"Probe"},
        "description":{"zh":"一句","en":"One line."},"actions":[{"id":"run","label":{"zh":"执行","en":"Run"}}],
        "fields":[{"id":"paths","label":{"zh":"路径","en":"Paths"},"kind":"path-list","default":{"text":""},
        "visible":{"type":"single","predicate":{"test":{"type":"always"},"negated":false}}}],
        "groups":[],"inputBindings":[{"fieldId":"paths","slot":"paths","transform":"lines"}],"danger":{"type":"none"}}"#;
    let definition = parse_definition(base).expect("the minimal valid document reads");
    assert_eq!(definition.node_id.as_str(), "probe");

    let cases: Vec<(&str, String)> = vec![
        ("key the contract does not define", base.replace("\"danger\":{\"type\":\"none\"}", "\"dangerous\":{\"type\":\"none\"}")),
        ("discriminant outside the vocabulary", base.replace("\"type\":\"always\"", "\"type\":\"mostly\"")),
        ("transform outside the vocabulary", base.replace("\"transform\":\"lines\"", "\"transform\":\"shout\"")),
        ("scalar with two keys", base.replace("{\"text\":\"\"}", "{\"text\":\"\",\"boolean\":true}")),
        ("missing required key", base.replace("\"slot\":\"paths\",", "")),
        ("blank localized side", base.replace("\"en\":\"One line.\"", "\"en\":\"  \"")),
        ("unknown rule", base.replace("\"kind\":\"path-list\"", "\"kind\":\"path-list\",\"rules\":[{\"rule\":{\"type\":\"mustExist\"}}]")),
        ("future version", base.replace("\"definitionVersion\":1", "\"definitionVersion\":2")),
    ];
    let mut rejected = 0;
    for (label, document) in &cases {
        match parse_definition(document) {
            Err(_) => rejected += 1,
            Ok(_) => panic!("{label}: the reader accepted {document}"),
        }
    }
    assert_eq!(rejected, cases.len(), "every listed shape must be refused");

    // Positive control: the unmodified document still reads, so a rejection is not the default answer.
    assert!(parse_definition(base).is_ok());
    let _: Option<DefinitionReadError> = None;
}
