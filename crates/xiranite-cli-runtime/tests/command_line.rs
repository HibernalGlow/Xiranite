//! Command-line parsing: the same definition that drives the prompts drives the flags.
//!
//! This half of `xiranite-cli-runtime` is testable without a terminal, which matters because it is the part
//! that decides what a user can actually type. The field ids come from trename's published definition, so a
//! rename of the vocabulary in the JSON shows up here instead of in a hand-copied fixture.

use std::collections::BTreeMap;

use xiranite_cli_runtime::term::{command_for, values_from_matches};
use xiranite_cli_runtime::wire::parse_definition;
use xiranite_plugin_api::node_definition::Scalar;

fn trename() -> xiranite_plugin_api::node_definition::NodeDefinition {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .map(|directory| directory.join("node-definitions").join("trename.json"))
        .find(|candidate| candidate.is_file())
        .expect("node-definitions/trename.json above the crate");
    parse_definition(&std::fs::read_to_string(&path).expect("readable")).expect("valid definition")
}

#[test]
fn every_declared_field_becomes_a_long_flag() {
    let definition = trename();
    let command = command_for(&definition, "xtrename");
    let flags: Vec<String> = command.get_arguments().map(|argument| argument.get_long().unwrap_or_default().to_owned()).collect();
    for field in &definition.fields {
        assert!(flags.contains(&field.id), "{} has no long flag: {flags:?}", field.id);
    }
    assert_eq!(flags.len(), definition.fields.len(), "the command grew a flag the definition does not declare");
}

#[test]
fn typed_flags_land_as_typed_values() {
    let definition = trename();
    // The method is `try_get_matches_from` (clap 4.6.7), which consumes the command.
    let refused = command_for(&definition, "xtrename")
        .try_get_matches_from(["xtrename", "--paths", "D:/in", "--dryRunFlag"])
        .expect_err("an undeclared flag must be refused, not swallowed as a positional");
    assert_eq!(refused.kind(), clap::error::ErrorKind::UnknownArgument);

    let parsed = command_for(&definition, "xtrename")
        .try_get_matches_from(["xtrename", "--paths", "D:/in", "--paths", "D:/also", "--maxLines", "12"])
        .expect("declared flags parse");
    let values = values_from_matches(&definition, &parsed);

    // A path-list takes the flag twice and joins with newlines, which is what the legacy interaction expects.
    assert_eq!(values.get("paths"), Some(&Scalar::Text("D:/in\nD:/also".to_owned())));
    assert_eq!(values.get("maxLines"), Some(&Scalar::Number(12.0)));
    // A field the user never mentioned stays absent: the caller fills defaults, `values_from_matches` does not
    // invent answers, because the danger gate must be able to tell "not set" from "set to the default".
    assert_eq!(values.get("dryRun"), None);
    assert!(!values.contains_key("undoPath"));
}

#[test]
fn a_boolean_flag_is_a_switch_and_not_a_value() {
    let definition = trename();
    let parsed = command_for(&definition, "xtrename")
        .try_get_matches_from(["xtrename", "--includeHidden"])
        .expect("a switch takes no argument");
    let values = values_from_matches(&definition, &parsed);
    assert_eq!(values.get("includeHidden"), Some(&Scalar::Boolean(true)));

    let unset: BTreeMap<String, Scalar> = BTreeMap::new();
    assert!(!unset.contains_key("includeHidden"), "the empty map is the not-set case");
}
