//! The published `definition.json` against this crate's behaviour, and against the copy the repository
//! carries at `node-definitions/samea.json`.
//!
//! ADR-0069 makes the definition the one vocabulary the CLI, the TUI and the GUI read, so the rule is:
//! * `plugins/samea/definition.json` is byte-identical to `node-definitions/samea.json` — the port does not
//!   get its own dialect;
//! * every executable rule the definition declares (field rules, the danger gate, the input bindings, the
//!   two export names, the help prose) is evaluated here against the Rust implementation, because a face
//!   that evaluates the JSON and a plugin that evaluates Rust must agree.
//!
//! The tables are runners with the same non-empty guard as `core_cases.rs`, and every group carries a
//! negative control.

use samea::artist::{Blacklists, PatternList, extract_artist};
use samea::contract::{MAX_OCCURRENCES, MIN_OCCURRENCES, SameaAction};
use samea::definition::{
    ACTION_OPTIONS, PATHS_MINIMUM_LINES, SameaLanguage, danger_prompt, is_dangerous, preview_lines,
    result_view, transform_as_boolean, transform_as_integer, transform_lines, transform_trim,
    validate_action, validate_input, validate_min_occurrences, validate_paths_text,
};
use samea::input::normalize_samea_input;
use samea::node_metadata::{HELP_COMMAND_LINE, HELP_SAFETY_DESTRUCTIVE, HELP_WHEN_TO_USE, samea_node_help};
use samea::plugin_entry::{SAMEA_PREVIEW_ENTRY_POINT, SAMEA_RESULT_ENTRY_POINT};
use serde_json::{Value, json};

/// The repository copy, read at the path the audit script uses.
fn published_definition() -> Value {
    let path = format!("{}/../../node-definitions/samea.json", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{path}: {error}"));
    serde_json::from_str(&text).unwrap_or_else(|error| panic!("{path}: {error}"))
}

/// The plugin's own copy, which the manifest gate reads (`scripts/audit-plugin-manifests.ts:169-176`).
fn shipped_definition() -> Value {
    let path = format!("{}/definition.json", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{path}: {error}"));
    serde_json::from_str(&text).unwrap_or_else(|error| panic!("{path}: {error}"))
}

fn text_value(value: &Value) -> String {
    value.as_str().unwrap_or_else(|| panic!("expected a string, got {value}")).to_string()
}

#[test]
fn the_shipped_definition_is_the_repository_copy_byte_for_byte() {
    let shipped_path = format!("{}/definition.json", env!("CARGO_MANIFEST_DIR"));
    let published_path = format!("{}/../../node-definitions/samea.json", env!("CARGO_MANIFEST_DIR"));
    let shipped = std::fs::read(&shipped_path).expect("the plugin publishes a definition");
    let published = std::fs::read(&published_path).expect("the node definition exists");
    assert_eq!(
        shipped, published,
        "`plugins/samea/definition.json` must be the copy at `node-definitions/samea.json`, not a dialect"
    );
    // Negative control: the port disagrees with the TypeScript nowhere, so nothing was "fixed" locally.
    assert_eq!(shipped_definition()["nodeId"], json!("samea"));
}

#[test]
fn the_action_options_and_the_field_set_are_what_the_node_declares() {
    let definition = shipped_definition();
    let actions: Vec<String> = definition["actions"]
        .as_array()
        .expect("actions")
        .iter()
        .map(|action| text_value(&action["id"]))
        .collect();
    assert_eq!(actions, ACTION_OPTIONS.to_vec(), "node-definitions/samea.json:12-27");
    assert_eq!(
        definition["fields"].as_array().expect("fields").len(),
        10,
        "the ten fields of `interaction.ts:27-38`"
    );
    assert_eq!(definition["previewExport"], json!(SAMEA_PREVIEW_ENTRY_POINT), "samea.json:399");
    assert_eq!(definition["resultExport"], json!(SAMEA_RESULT_ENTRY_POINT), "samea.json:400");
    assert_eq!(definition["reportsProgress"], json!(true), "core.ts:103 emits progress events");
    assert_eq!(definition["publishesOutputPath"], json!(false));
    // Negative control: `classify` is the only destructive action the help admits.
    assert_eq!(definition["help"]["safety"]["destructive"]["en"], json!(HELP_SAFETY_DESTRUCTIVE.to_vec()));
}

/// One row of a rule table: a value, and whether the declared rule accepts it.
struct RuleCase {
    value: Value,
    accepted: bool,
}

/// `oneOfDeclaredOptions` (`samea.json:69-75`), evaluated the way
/// `packages/node-definitions/src/form-bridge.ts:195-198` evaluates it.
const ACTION_RULE_CASES: &[RuleCase] = &[
    RuleCase { value: json!("plan"), accepted: true },
    RuleCase { value: json!("classify"), accepted: true },
    RuleCase { value: json!("delete"), accepted: false },
    RuleCase { value: json!(""), accepted: false },
    RuleCase { value: json!("Plan"), accepted: false, /* case-sensitive: form-bridge.ts:197 */ },
];

/// `atLeastLines` with `minimum: 1` (`samea.json:97-104`, `form-bridge.ts:200-203`).
const PATHS_RULE_CASES: &[RuleCase] = &[
    RuleCase { value: json!("D:/archives"), accepted: true },
    RuleCase { value: json!("D:/a\nD:/b"), accepted: true },
    RuleCase { value: json!("  \n  "), accepted: false },
    RuleCase { value: json!(""), accepted: false },
];

/// `integerInRange` over `range: { min: 1, max: 100 }` (`samea.json:134-157`, `form-bridge.ts:185-193`).
const MIN_OCCURRENCES_RULE_CASES: &[RuleCase] = &[
    RuleCase { value: json!(MIN_OCCURRENCES), accepted: true },
    RuleCase { value: json!(MAX_OCCURRENCES), accepted: true },
    RuleCase { value: json!(0), accepted: false },
    RuleCase { value: json!(101), accepted: false },
    RuleCase { value: json!(2.5), accepted: false },
];

fn run_rule_table(name: &str, cases: &[RuleCase], mut check: impl FnMut(&Value) -> bool) -> usize {
    assert!(!cases.is_empty(), "a rule table with no cases proves nothing ({name})");
    for case in cases {
        assert_eq!(
            check(&case.value),
            case.accepted,
            "{name}: {} should be accepted = {}",
            case.value,
            case.accepted
        );
    }
    cases.len()
}

#[test]
fn every_declared_field_rule_agrees_with_the_rust_validator() {
    let action_checked = run_rule_table("oneOfDeclaredOptions", ACTION_RULE_CASES, |value| {
        validate_action(value.as_str().unwrap_or("§absent§")).is_ok()
    });
    let paths_checked = run_rule_table("atLeastLines", PATHS_RULE_CASES, |value| {
        validate_paths_text(value.as_str().unwrap_or(""), PATHS_MINIMUM_LINES).is_ok()
    });
    let threshold_checked = run_rule_table("integerInRange", MIN_OCCURRENCES_RULE_CASES, |value| {
        validate_min_occurrences(value.as_f64().unwrap_or(f64::NAN)).is_ok()
    });
    assert_eq!(
        (action_checked, paths_checked, threshold_checked),
        (5, 4, 5),
        "the three declared rules must keep their case counts, or a rule stopped being checked"
    );
}

#[test]
fn an_empty_rule_table_is_refused_rather_than_green() {
    let result = std::panic::catch_unwind(|| run_rule_table("empty", &[], |_| true));
    assert!(result.is_err(), "a rule table with no cases must not pass");
}

/// `interaction.ts:44`, the input-level rule the terminal applies after the field rules.
#[test]
fn the_input_rule_names_the_same_message_as_the_terminal() {
    let empty = normalize_samea_input(&json!({ "paths": [] })).expect("normalized");
    assert_eq!(
        validate_input(&empty, SameaLanguage::Zh),
        Some("请至少输入一个归档根目录。".to_string()),
        "interaction.ts:44"
    );
    assert_eq!(
        validate_input(&empty, SameaLanguage::En),
        Some("Enter at least one archive root.".to_string())
    );
    // Negative control: one root clears it, and the run-level guard in `core.ts:102` agrees.
    let filled = normalize_samea_input(&json!({ "paths": ["/archive"] })).expect("normalized");
    assert_eq!(validate_input(&filled, SameaLanguage::En), None);
}

/// Evaluates the definition's `danger` block as data, exactly as a face would, and compares it with the
/// node's own `is_dangerous`. Both readings must agree or the gate is two gates.
fn evaluate_declared_danger(action: &str, dry_run: bool) -> bool {
    let definition = shipped_definition();
    let danger = &definition["danger"];
    assert_eq!(danger["type"], json!("all"), "samea.json:364");
    danger["predicates"]
        .as_array()
        .expect("predicates")
        .iter()
        .all(|predicate| {
            let negated = predicate["negated"].as_bool().unwrap_or(false);
            let holds = match predicate["test"]["type"].as_str().expect("test type") {
                "actionIs" => {
                    assert_eq!(predicate["test"]["actionField"], json!("action"));
                    predicate["test"]["allowed"]
                        .as_array()
                        .expect("allowed")
                        .iter()
                        .any(|allowed| allowed.as_str() == Some(action))
                }
                "fieldTrue" => {
                    assert_eq!(predicate["test"]["fieldId"], json!("dryRun"));
                    dry_run
                }
                other => panic!("unsupported test {other} in the published danger block"),
            };
            if negated { !holds } else { holds }
        })
}

#[test]
fn the_danger_gate_and_the_published_json_decide_the_same_four_cases() {
    let cases = [
        ("classify", false, true),
        ("classify", true, false),
        ("plan", false, false),
        ("plan", true, false),
    ];
    assert_eq!(cases.len(), 4, "the two booleans times the two actions");
    for (action, dry_run, expected) in cases {
        let from_json = evaluate_declared_danger(action, dry_run);
        let from_node = is_dangerous(&SameaAction::from(action), dry_run);
        assert_eq!(from_json, expected, "definition gate for {action}/dryRun={dry_run}");
        assert_eq!(from_node, expected, "is_dangerous for {action}/dryRun={dry_run} (interaction.ts:46)");
        // Negative control baked in: the only dangerous combination is the live classify.
        assert_eq!(from_json, from_node);
    }
}

#[test]
fn the_danger_prompt_matches_the_published_block_in_both_languages() {
    let definition = shipped_definition();
    let prompt = &definition["dangerPrompt"];
    assert_eq!(prompt["title"]["zh"], danger_prompt(SameaLanguage::Zh)["title"]);
    assert_eq!(prompt["body"]["zh"], danger_prompt(SameaLanguage::Zh)["body"]);
    assert_eq!(prompt["confirmLabel"]["zh"], danger_prompt(SameaLanguage::Zh)["confirmLabel"]);
    assert_eq!(prompt["title"]["en"], danger_prompt(SameaLanguage::En)["title"]);
    assert_eq!(prompt["body"]["en"], danger_prompt(SameaLanguage::En)["body"]);
    assert_eq!(prompt["confirmLabel"]["en"], danger_prompt(SameaLanguage::En)["confirmLabel"]);
    // Negative control: the two languages are not the same string, so a swap cannot pass.
    assert_ne!(
        danger_prompt(SameaLanguage::Zh)["body"],
        danger_prompt(SameaLanguage::En)["body"]
    );
}

#[test]
fn the_input_bindings_are_the_transforms_the_definition_names() {
    let definition = shipped_definition();
    let bindings = definition["inputBindings"].as_array().expect("inputBindings");
    assert_eq!(bindings.len(), 10, "samea.json:311-361");
    for binding in bindings {
        let transform = binding["transform"].as_str().expect("transform");
        assert!(
            matches!(transform, "trim" | "lines" | "asBoolean" | "asInteger"),
            "samea declares only these four (`packages/node-definitions/src/contract.ts:30`), got {transform}"
        );
        // Each Rust transform must accept the shape its binding names implies.
        match transform {
            "trim" => assert_eq!(transform_trim(" classify "), "classify"),
            "lines" => assert_eq!(
                transform_lines("pixiv\n\n twitter "),
                vec!["pixiv".to_string(), "twitter".to_string()]
            ),
            "asBoolean" => {
                assert!(transform_as_boolean(Some(&json!(true))));
                assert!(!transform_as_boolean(Some(&json!("true"))));
            }
            _ => assert_eq!(transform_as_integer(Some(&json!("7"))), 7),
        }
    }

    // Negative control: the `lines` transform does not split on commas, unlike `core.ts:249`'s `parseList`,
    // which is why `pathsText` and `listText` can disagree by design.
    assert_eq!(transform_lines("a,b"), vec!["a,b".to_string()]);
    assert_eq!(
        normalize_samea_input(&json!({ "listText": "a,b" })).expect("normalized").paths,
        vec!["a".to_string(), "b".to_string()]
    );
}

#[test]
fn the_preview_and_result_exports_match_the_terminal_functions() {
    // `interaction.ts:45` for the preview lines, `interaction.ts:48` for the result view.
    let input = normalize_samea_input(&json!({ "paths": ["/a", "/b"], "action": "classify", "minOccurrences": 3 }))
        .expect("normalized");
    assert_eq!(
        preview_lines(&input, SameaLanguage::En),
        vec!["2 archive root(s)".to_string(), "classify · min 3".to_string()]
    );
    assert_eq!(
        preview_lines(&input, SameaLanguage::Zh),
        vec!["2 个归档根目录".to_string(), "classify · min 3".to_string()]
    );

    let view = result_view(&samea::contract::SameaRunResult {
        success: true,
        message: "SameA organized 3 archive(s).".to_string(),
        data: None,
    });
    assert_eq!(view["lines"], json!([]), "interaction.ts:48 yields no lines without data");
    assert_eq!(view["success"], json!(true));
    assert_eq!(view["message"], json!("SameA organized 3 archive(s)."));
}

#[test]
fn the_help_block_and_the_rust_quotes_do_not_drift() {
    let help = shipped_definition()["help"].clone();
    let quoted = samea_node_help();
    assert_eq!(help["whenToUse"]["en"], json!(HELP_WHEN_TO_USE.to_vec()), "help.ts:7");
    assert_eq!(help["commands"][0]["command"], json!(HELP_COMMAND_LINE), "help.ts:9");
    assert_eq!(help["safety"]["defaultMode"], json!("dry-run"), "help.ts:10");
    assert_eq!(help["safety"]["notes"]["en"], quoted["safety"]["notes"], "the quoted English notes");
    assert_eq!(
        help["workflows"][0]["ui"]["en"],
        quoted["workflows"][0]["ui"],
        "help.ts:8's workflow steps"
    );
    // Negative control: the description prose is not the short line.
    assert_ne!(help["whenToUse"]["en"], json!([""]));
    assert_eq!(shipped_definition()["description"]["en"], json!(node_description_text()));
}

/// The `description.en` the definition publishes, reached without re-spelling the string.
#[must_use]
fn node_description_text() -> String {
    samea::contract::SAMEA_NODE_DESCRIPTION.to_string()
}

#[test]
fn a_centralized_plan_target_survives_the_default_path_blacklist_check() {
    // `core.ts:205` puts centralized targets under `[00画师分类]`, and `core.ts:77` blacklists that very
    // folder, so a second run must skip the gathered archives instead of moving them again.
    let artist_list: Vec<String> =
        samea::contract::DEFAULT_ARTIST_BLACKLIST.iter().map(|term| (*term).to_string()).collect();
    let path_list: Vec<String> =
        samea::contract::DEFAULT_PATH_BLACKLIST.iter().map(|term| (*term).to_string()).collect();
    let patterns = PatternList::empty();
    let blacklists =
        Blacklists { artist: &artist_list, path: &path_list, patterns: &patterns };
    assert!(blacklists.path_hit("/archive/[00画师分类]/[Artist]/a.zip"));
    // Negative control: an ordinary archive path is not on the list.
    assert!(!blacklists.path_hit("/archive/[Artist] a.zip"));

    let found = extract_artist("[Artist] a.zip", &blacklists).expect("artist");
    assert_eq!(found.label, "[Artist]");
    assert_eq!(found.key, "\0artist");
}
