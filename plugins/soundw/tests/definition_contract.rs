//! `definition.json` against the published single source of truth, and against the TypeScript that
//! authored its copy.
//!
//! ADR-0069 makes the definition the one vocabulary the CLI, the TUI and the GUI read, so a plugin
//! that shipped its own dialect would fork the product's interface exactly the way ADR-0068's
//! capability list was forking. Two checks follow: the file is byte-identical to
//! `node-definitions/soundw.json`, and every human-language string in it is found verbatim in
//! `packages/nodes/soundw/src/help.ts` or `interaction.ts` — the copy is quoted, never reworded.

#![cfg(not(target_arch = "wasm32"))]

use std::path::{Path, PathBuf};

use serde_json::Value;
use xiranite_plugin_soundw::soundw_input::{PROFILE_NAME_REQUIRED_EN, PROFILE_NAME_REQUIRED_ZH};
use xiranite_plugin_soundw::soundw_view::{LABEL_DESCRIPTION, LABEL_NAME, LABEL_PATH, LABEL_PROFILE_NAME, action_label};
use xiranite_plugin_soundw::{SOUNDW_ENTRY_POINTS, SOUNDW_PREVIEW_EXPORT, SOUNDW_RESULT_VIEW_EXPORT, SoundwAction};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("plugins/soundw sits two levels below the repository root")
        .to_path_buf()
}

fn read(path: &Path) -> String {
    std::fs::read_to_string(path)
        .unwrap_or_else(|error| panic!("{} must be readable: {error}", path.display()))
}

fn definition() -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("definition.json");
    serde_json::from_str(&read(&path)).expect("definition.json must parse")
}

fn published() -> String {
    read(&repo_root().join("node-definitions/soundw.json"))
}

fn interaction_source() -> String {
    read(&repo_root().join("packages/nodes/soundw/src/interaction.ts"))
}

fn help_source() -> String {
    read(&repo_root().join("packages/nodes/soundw/src/help.ts"))
}

#[test]
fn the_definition_is_the_published_document() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("definition.json");
    let local = read(&path);
    let shipped = published();
    assert_eq!(
        local.trim_end(),
        shipped.trim_end(),
        "plugins/soundw/definition.json drifted from node-definitions/soundw.json; the published \
         file is the single source of truth (ADR-0069), so the plugin copy must follow it"
    );
    let document = definition();
    assert_eq!(document["definitionVersion"], Value::from(1));
    assert_eq!(document["nodeId"], Value::String("soundw".to_owned()));
}

#[test]
fn the_actions_and_the_selector_are_the_declared_eight() {
    let document = definition();
    let actions = document["actions"].as_array().expect("actions").clone();
    assert!(!actions.is_empty(), "a definition with no actions is a build mistake, not an empty menu");
    assert_eq!(actions.len(), SoundwAction::ALL.len());

    let declared: Vec<&str> = actions
        .iter()
        .map(|action| action["id"].as_str().expect("an action id"))
        .collect();
    let expected: Vec<&str> = SoundwAction::ALL.iter().map(|action| action.as_str()).collect();
    assert_eq!(declared, expected, "the order is the tab and subcommand order (interaction.ts:8)");

    let fields = document["fields"].as_array().expect("fields");
    assert_eq!(fields.len(), 3, "action, profileName, soundSwitchPath");
    let selector = &fields[0];
    assert_eq!(selector["id"], Value::String("action".to_owned()));
    assert_eq!(selector["isActionSelector"], Value::Bool(true));
    let options: Vec<&str> = selector["options"]
        .as_array()
        .expect("options")
        .iter()
        .map(|option| option["value"]["text"].as_str().expect("an option value"))
        .collect();
    assert_eq!(options, expected, "the action selector's options are exactly the declared actions");
    assert_eq!(selector["default"]["text"], Value::String("status".to_owned()), "interaction.ts:16");
    assert_eq!(selector["rules"][0]["rule"]["type"], Value::String("oneOfDeclaredOptions".to_owned()));
}

#[test]
fn the_declared_rules_are_the_ones_the_interaction_schema_writes() {
    let fields = definition()["fields"].as_array().expect("fields").clone();
    let profile_name = &fields[1];
    assert_eq!(profile_name["id"], Value::String("profileName".to_owned()));
    assert_eq!(profile_name["kind"], Value::String("text".to_owned()));

    // `interaction.ts:21` shows the field only for `profile`, and validates it only there.
    let predicate = &profile_name["visible"]["predicate"];
    assert_eq!(predicate["test"]["type"], Value::String("actionIs".to_owned()));
    assert_eq!(predicate["test"]["actionField"], Value::String("action".to_owned()));
    assert_eq!(predicate["test"]["allowed"], serde_json::json!(["profile"]));
    assert_eq!(predicate["negated"], Value::Bool(false));

    let rule = &profile_name["rules"][0];
    assert_eq!(rule["rule"]["type"], Value::String("nonBlank".to_owned()));
    assert_eq!(rule["when"]["predicate"]["test"]["allowed"], serde_json::json!(["profile"]));
    assert_eq!(rule["message"]["zh"], Value::String(PROFILE_NAME_REQUIRED_ZH.to_owned()));
    assert_eq!(rule["message"]["en"], Value::String(PROFILE_NAME_REQUIRED_EN.to_owned()));
    // Negative control: `soundSwitchPath` declares no rules, so the plugin must not invent any.
    assert_eq!(fields[2]["id"], Value::String("soundSwitchPath".to_owned()));
    assert_eq!(fields[2]["rules"].as_array().expect("rules").len(), 0);
}

#[test]
fn the_input_bindings_match_to_input() {
    let bindings = definition()["inputBindings"].as_array().expect("inputBindings").clone();
    let expected = [
        ("action", "action", "trim"),
        ("profileName", "profileName", "trimOrOmit"),
        ("soundSwitchPath", "soundSwitchPath", "trimOrOmit"),
    ];
    assert_eq!(bindings.len(), expected.len(), "interaction.ts:24 maps three slots and no more");
    for (index, (field_id, slot, transform)) in expected.into_iter().enumerate() {
        assert_eq!(bindings[index]["fieldId"], Value::String(field_id.to_owned()));
        assert_eq!(bindings[index]["slot"], Value::String(slot.to_owned()));
        assert_eq!(bindings[index]["transform"], Value::String(transform.to_owned()));
    }
    // The two export bindings name entry points this crate actually publishes.
    assert_eq!(definition()["previewExport"], Value::String(SOUNDW_PREVIEW_EXPORT.to_owned()));
    assert_eq!(definition()["resultExport"], Value::String(SOUNDW_RESULT_VIEW_EXPORT.to_owned()));
    let described = xiranite_plugin_soundw::describe_soundw_plugin();
    assert_eq!(described["exports"]["previewExport"], Value::String(SOUNDW_PREVIEW_EXPORT.to_owned()));
    assert!(
        described["entryPoints"]
            .as_array()
            .expect("entryPoints")
            .contains(&Value::String(SOUNDW_ENTRY_POINTS[2].to_owned())),
        "the preview binding must have an export behind it"
    );
}

#[test]
fn the_danger_gate_and_progress_flags_are_the_ones_the_node_declares() {
    let document = definition();
    assert_eq!(document["danger"]["type"], Value::String("none".to_owned()), "interaction.ts:26");
    assert_eq!(document["reportsProgress"], Value::Bool(true), "core.ts:20,31 emit two progress events");
    assert_eq!(document["publishesOutputPath"], Value::Bool(false), "SoundW never produces a path");
    // Negative control: a node that asked would carry a prompt; this one must not.
    assert!(document.get("dangerPrompt").is_none(), "danger.type is none, so no prompt was authored");
}

#[test]
fn the_help_block_is_quoted_from_help_ts_and_not_reworded() {
    let help = help_source();
    let block = &definition()["help"];
    let mut quoted = 0usize;
    for path in [
        &block["whenToUse"]["zh"][0],
        &block["workflows"][0]["summary"]["zh"],
        &block["workflows"][0]["ui"]["zh"][0],
        &block["workflows"][0]["ui"]["zh"][2],
        &block["workflows"][1]["summary"]["zh"],
        &block["workflows"][1]["cli"]["zh"][0],
        &block["workflows"][1]["cli"]["zh"][2],
        &block["commands"][0]["title"]["zh"],
        &block["commands"][0]["description"]["zh"],
        &block["safety"]["notes"]["zh"][0],
        &block["safety"]["notes"]["zh"][1],
    ] {
        let text = path.as_str().unwrap_or_default();
        assert!(help.contains(text), "help.ts does not contain {text:?}");
        quoted += 1;
    }
    assert!(quoted >= 10, "the help block must be checked string by string, got {quoted}");
    assert_eq!(block["safety"]["defaultMode"], Value::String("guided".to_owned()), "help.ts:13");
    assert_eq!(block["commands"][0]["command"], Value::String("xsoundw".to_owned()));

    // The localized en sides duplicate the zh copy because `help.ts:14` only translates
    // title/short/description — the definition must not invent an English workflow list either.
    assert_eq!(block["whenToUse"]["en"], block["whenToUse"]["zh"]);
}

#[test]
fn the_published_description_is_the_help_short_line_in_both_languages() {
    let help = help_source();
    let document = definition();
    let zh = document["description"]["zh"].as_str().expect("zh");
    let en = document["description"]["en"].as_str().expect("en");
    assert!(help.contains(&format!("short: \"{zh}\"")), "{zh:?} is not help.ts's `short`");
    assert!(help.contains(&format!("short: \"{en}\"")), "{en:?} is not help.ts's English `short`");
    assert_eq!(document["title"]["zh"], Value::String("SoundW".to_owned()));
    assert_eq!(document["title"]["en"], Value::String("SoundW".to_owned()));
}

#[test]
fn every_label_the_plugin_prints_is_the_nodes_own_copy() {
    let interaction = interaction_source();
    let mut checked = 0usize;
    for label in [LABEL_NAME, LABEL_DESCRIPTION, LABEL_PATH, LABEL_PROFILE_NAME] {
        for text in [label.zh, label.en] {
            assert!(interaction.contains(text), "interaction.ts does not contain {text:?}");
            checked += 1;
        }
    }
    for action in SoundwAction::ALL {
        let label = action_label(action);
        for text in [label.zh, label.en] {
            assert!(interaction.contains(text), "interaction.ts does not contain the {action:?} label {text:?}");
            checked += 1;
        }
    }
    assert!(checked >= 24, "the label table must be verified in full, got {checked} strings");

    // The definition's own labels agree with the same table, so no face can render a third variant.
    let actions = definition()["actions"].as_array().expect("actions").clone();
    for (index, action) in SoundwAction::ALL.iter().enumerate() {
        assert_eq!(actions[index]["label"]["zh"], Value::String(action_label(*action).zh.to_owned()));
        assert_eq!(actions[index]["label"]["en"], Value::String(action_label(*action).en.to_owned()));
    }
}

#[test]
fn the_definition_refuses_an_empty_vocabulary() {
    // The guard the audit depends on: a definition file that parsed to nothing must not read as OK.
    let document = definition();
    for key in ["actions", "fields", "inputBindings"] {
        assert!(
            document[key].as_array().is_some_and(|entries| !entries.is_empty()),
            "{key} is empty"
        );
    }
    assert!(document["help"]["workflows"].as_array().is_some_and(|entries| !entries.is_empty()));
    assert!(document["help"]["commands"].as_array().is_some_and(|entries| !entries.is_empty()));
    // Negative control: the same reader applied to a stub definition reports the hole.
    let stub: Value = serde_json::from_str(r#"{"nodeId":"soundw","actions":[]}"#).expect("json");
    assert!(stub["fields"].is_null(), "a missing key must read as absent, not as empty");
    assert!(stub["actions"].as_array().is_some_and(Vec::is_empty));
}
