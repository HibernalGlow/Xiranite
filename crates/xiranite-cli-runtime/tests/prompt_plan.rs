//! The evaluator's own truth table, built from synthetic definitions.
//!
//! The tree tests prove the real definitions read and behave; these prove the algebra itself, including the
//! shapes no node happens to use yet (`anyAll` with two clauses, `fieldEquals` on a number, an inverted
//! `fieldFlag`). A face that re-implemented these rules instead of calling here would be the drift ADR-0069
//! forbids, so the rules get their own coverage.
//!
//! Every fixture authors its copy in both languages and every expectation names one language, because the
//! plan resolves text out of the definition rather than out of a renderer default.

use xiranite_cli_runtime::plan::{Danger, Values, danger_required, predicate_holds, prompt_plan, test_holds};
use xiranite_plugin_api::node_definition::{
    Condition, DangerGate, DangerPrompt, FieldDefinition, FieldKind, FieldOption, GuardedRule, LocalizedText,
    NodeAction, NodeDefinition, Predicate, Rule, Scalar, Test,
};

/// Both sides of one piece of copy. The two languages deliberately differ, so a step that matches only one
/// side proves the `language` argument was threaded through instead of defaulted.
fn text(zh: &str, en: &str) -> LocalizedText {
    LocalizedText::new(zh, en)
}

fn answers(pairs: &[(&str, Scalar)]) -> Values {
    pairs.iter().map(|(id, value)| ((*id).to_owned(), value.clone())).collect()
}

/// The condition a field carries when the answer set is supposed to decide everything.
fn always_visible() -> Condition {
    Condition::Single(Predicate::holds(Test::Always))
}

/// A field with the whole vocabulary filled in, its labels authored per language.
fn field(id: &str, kind: FieldKind, visible: Condition, rules: Vec<GuardedRule>) -> FieldDefinition {
    FieldDefinition {
        default: None,
        description: Some(LocalizedText::new(format!("说明 {id}"), format!("Help for {id}."))),
        id: id.to_owned(),
        is_action_selector: false,
        kind,
        label: LocalizedText::new(format!("中文 {id}"), id.to_owned()),
        lines: None,
        options: Vec::new(),
        placeholder: None,
        range: None,
        rules,
        visible,
    }
}

fn gated(id: &str, visible: Condition) -> FieldDefinition {
    field(id, FieldKind::Boolean, visible, Vec::new())
}

/// The booleans the condition shapes read. They are declared so a fixture stays self-consistent and hidden
/// with `never`, so the visible ids of a plan are exactly the gated fields being asserted on.
fn carriers() -> Vec<FieldDefinition> {
    let hidden = Condition::Single(Predicate::holds(Test::Never));
    vec![field("on", FieldKind::Boolean, hidden.clone(), Vec::new()), field("off", FieldKind::Boolean, hidden, Vec::new())]
}

/// One gated field plus the carriers its predicates read.
fn probe(condition: Condition) -> Vec<FieldDefinition> {
    let mut fields = carriers();
    fields.push(gated("probe", condition));
    fields
}

/// The confirmation copy a node authors, in both languages.
fn authored_prompt() -> DangerPrompt {
    DangerPrompt {
        title: text("确认覆盖", "Confirm overwrite"),
        body: text("目标文件将被替换且不可撤销。", "Targets are replaced and this cannot be undone."),
        confirm_label: text("我确认覆盖", "Yes, overwrite them"),
    }
}

fn definition(fields: Vec<FieldDefinition>, danger: DangerGate) -> NodeDefinition {
    definition_prompt(fields, danger, Some(authored_prompt()), None)
}

/// The same fixture with the danger copy's source changed, which is precisely what [`Danger`] reports: a fixed
/// prompt, no prompt at all, or a plugin export producing it.
fn definition_prompt(fields: Vec<FieldDefinition>, danger: DangerGate, prompt: Option<DangerPrompt>, prompt_export: Option<String>) -> NodeDefinition {
    NodeDefinition {
        actions: vec![NodeAction { id: "run".to_owned(), label: text("执行", "Run") }],
        danger,
        danger_prompt: prompt,
        danger_prompt_export: prompt_export,
        dashboard: None,
        definition_version: 1,
        description: text("一个节点", "A node."),
        fields,
        groups: Vec::new(),
        input_bindings: Vec::new(),
        node_id: xiranite_plugin_api::identifiers::PluginId::try_new("probe").expect("the fixture id is not blank"),
        preview_export: None,
        publishes_output_path: false,
        reports_progress: false,
        result_export: None,
        result_table: None,
        help: None,
        title: text("探测节点", "Probe node"),
    }
}

/// A plan row flattened to owned text. [`prompt_plan`] returns steps that borrow the definition, and the
/// helpers below build a definition of their own, so a `Vec<Step<'_>>` would dangle; these are the four
/// things a face reads off a step.
struct Row {
    id: String,
    label: String,
    help: Option<String>,
    options: Vec<(String, bool)>,
    required: bool,
}

fn plan(fields: &[FieldDefinition], values: &Values, language: &str) -> Vec<Row> {
    let node = definition(fields.to_vec(), DangerGate::None);
    prompt_plan(&node, values, language)
        .into_iter()
        .map(|step| Row {
            id: step.field.id.clone(),
            label: step.label,
            help: step.help,
            options: step.options,
            required: step.required,
        })
        .collect()
}

/// The ids a plan offers, in declaration order.
fn visible_ids(fields: &[FieldDefinition], values: &Values, language: &str) -> Vec<String> {
    plan(fields, values, language).into_iter().map(|row| row.id).collect()
}

/// Whether one condition shape reaches the plan at all. This goes through `prompt_plan` rather than
/// `condition_holds`, so what a face would actually be handed is what is under test.
fn offered(condition: &Condition, values: &Values, language: &str) -> bool {
    visible_ids(&probe(condition.clone()), values, language).iter().any(|id| id == "probe")
}

fn row<'a>(rows: &'a [Row], id: &str) -> &'a Row {
    rows.iter().find(|row| row.id == id).unwrap_or_else(|| panic!("no plan row for {id}"))
}

/// The choices flattened to borrowed text, because `(String, bool)` cannot compare against `(&str, bool)`.
fn option_texts(options: &[(String, bool)]) -> Vec<(&str, bool)> {
    options.iter().map(|(label, disabled)| (label.as_str(), *disabled)).collect()
}

#[test]
fn every_test_leaf_evaluates_the_way_the_contract_defines_it() {
    let values = answers(&[
        ("action", Scalar::Text("scan".to_owned())),
        ("limit", Scalar::Number(12.0)),
        ("dryRun", Scalar::Boolean(true)),
        ("blank", Scalar::Text("   ".to_owned())),
        ("mode", Scalar::Text("normal".to_owned())),
    ]);

    assert!(test_holds(&Test::Always, &values));
    assert!(!test_holds(&Test::Never, &values));

    // actionIs compares the raw text form of the answer, not the kind the field had.
    assert!(test_holds(&Test::ActionIs { action_field: "action".to_owned(), allowed: vec!["scan".to_owned()] }, &values));
    assert!(!test_holds(&Test::ActionIs { action_field: "action".to_owned(), allowed: vec!["rename".to_owned()] }, &values));
    assert!(test_holds(&Test::ActionIs { action_field: "limit".to_owned(), allowed: vec!["12".to_owned()] }, &values), "a whole number answers as `12`");
    assert!(test_holds(&Test::ActionIs { action_field: "dryRun".to_owned(), allowed: vec!["true".to_owned()] }, &values));

    assert!(test_holds(&Test::FieldEquals { field_id: "limit".to_owned(), value: Scalar::Number(12.0) }, &values));
    // A number answer never equals a text one: the kinds are not interchangeable at the leaf.
    assert!(!test_holds(&Test::FieldEquals { field_id: "limit".to_owned(), value: Scalar::Text("12".to_owned()) }, &values));
    assert!(!test_holds(&Test::FieldEquals { field_id: "missing".to_owned(), value: Scalar::Number(12.0) }, &values), "an unanswered field matches nothing");

    assert!(test_holds(&Test::FieldFilled { field_id: "mode".to_owned() }, &values));
    assert!(!test_holds(&Test::FieldFilled { field_id: "blank".to_owned() }, &values), "whitespace is not an answer");

    assert!(test_holds(&Test::FieldTrue { field_id: "dryRun".to_owned() }, &values));
    assert!(test_holds(&Test::FieldTrue { field_id: "mode".to_owned() }, &values), "a non-blank text answer reads as true too");
    assert!(!test_holds(&Test::FieldTrue { field_id: "blank".to_owned() }, &values));

    // numberAtLeast is inclusive at the bound, and a text answer is not a number at all.
    assert!(test_holds(&Test::NumberAtLeast { field_id: "limit".to_owned(), minimum: 12.0 }, &values));
    assert!(!test_holds(&Test::NumberAtLeast { field_id: "limit".to_owned(), minimum: 13.0 }, &values));
    assert!(!test_holds(&Test::NumberAtLeast { field_id: "mode".to_owned(), minimum: 0.0 }, &values));

    // Negation is a flag on the leaf, so it inverts exactly one step.
    assert!(predicate_holds(&Predicate::holds(Test::FieldTrue { field_id: "dryRun".to_owned() }), &values));
    assert!(!predicate_holds(&Predicate::fails(Test::FieldTrue { field_id: "dryRun".to_owned() }), &values));
    assert!(predicate_holds(&Predicate::fails(Test::FieldFilled { field_id: "blank".to_owned() }), &values), "negating a failing leaf holds");

    // Nothing answered yet: every leaf that reads a value is false, and only the constants keep their meaning.
    let empty = Values::new();
    assert!(test_holds(&Test::Always, &empty));
    assert!(!test_holds(&Test::FieldTrue { field_id: "dryRun".to_owned() }, &empty));
    assert!(!test_holds(&Test::FieldFilled { field_id: "mode".to_owned() }, &empty));
    assert!(!test_holds(&Test::NumberAtLeast { field_id: "limit".to_owned(), minimum: 0.0 }, &empty));
    assert!(!test_holds(&Test::ActionIs { action_field: "action".to_owned(), allowed: vec!["scan".to_owned()] }, &empty));
}

#[test]
fn the_four_condition_shapes_agree_with_the_definition_language() {
    let on = Test::FieldTrue { field_id: "on".to_owned() };
    let off = Test::FieldTrue { field_id: "off".to_owned() };
    // `on` answered true, `off` answered false: the one answer set that separates all four shapes.
    let one_of_two = answers(&[("on", Scalar::Boolean(true)), ("off", Scalar::Boolean(false))]);
    let both = answers(&[("on", Scalar::Boolean(true)), ("off", Scalar::Boolean(true))]);

    assert!(offered(&Condition::Single(Predicate::holds(on.clone())), &one_of_two, "en"), "single reads the predicate as written");
    assert!(!offered(&Condition::Single(Predicate::holds(off.clone())), &one_of_two, "en"), "a false predicate hides the field");
    assert!(offered(&Condition::Single(Predicate::fails(off.clone())), &one_of_two, "en"), "and the negation of that predicate shows it");

    let all = Condition::All(vec![Predicate::holds(on.clone()), Predicate::holds(off.clone())]);
    assert!(!offered(&all, &one_of_two, "en"), "all() must fail when one predicate fails");
    assert!(offered(&all, &both, "en"), "all() holds when every predicate does");

    assert!(offered(&Condition::Any(vec![Predicate::holds(off.clone()), Predicate::holds(on.clone())]), &one_of_two, "en"), "any() must hold when one predicate holds");
    assert!(!offered(&Condition::Any(vec![Predicate::holds(off.clone()), Predicate::fails(on.clone())]), &one_of_two, "en"), "any() fails only when every predicate does");

    // `(on and off) or (not off)`: the first clause fails on `off`, the second holds.
    let normal_form = Condition::AnyAll(vec![
        vec![Predicate::holds(on.clone()), Predicate::holds(off.clone())],
        vec![Predicate::fails(off.clone())],
    ]);
    assert!(offered(&normal_form, &one_of_two, "en"), "a normal form holds when any clause holds");
    assert!(offered(&Condition::AnyAll(vec![vec![Predicate::fails(off.clone())]]), &one_of_two, "en"), "a single satisfied clause is enough");
    assert!(!offered(&Condition::AnyAll(vec![vec![Predicate::holds(off.clone())]]), &one_of_two, "en"), "a clause whose only predicate fails hides the field");
    assert!(
        offered(&Condition::AnyAll(vec![vec![Predicate::holds(off.clone())], vec![Predicate::fails(off.clone())]]), &one_of_two, "en"),
        "the failing clause is first and the field still shows, so clause order is not doing the work"
    );

    // All four shapes in one definition: the plan keeps declaration order and drops exactly the hidden fields.
    let mut fields = carriers();
    fields.extend([
        gated("single", Condition::Single(Predicate::fails(off.clone()))),
        gated("all", all.clone()),
        gated("any", Condition::Any(vec![Predicate::holds(off.clone()), Predicate::holds(on.clone())])),
        gated("anyAll", normal_form.clone()),
        gated("never", Condition::Single(Predicate::holds(Test::Never))),
    ]);
    assert_eq!(visible_ids(&fields, &one_of_two, "en"), ["single", "any", "anyAll"], "one_of_two hides all() and never()");
    assert_eq!(visible_ids(&fields, &both, "en"), ["all", "any", "anyAll"], "with both flags answered the only hidden fields are not(off) and never()");
}

#[test]
fn required_and_localized_text_come_from_the_definition_not_the_renderer() {
    let values = answers(&[("askForPath", Scalar::Boolean(false))]);
    let unconditional = field("paths", FieldKind::PathList, always_visible(), vec![GuardedRule::always(Rule::Required)]);
    let conditional = field(
        "undoPath",
        FieldKind::Text,
        always_visible(),
        vec![GuardedRule::only(Rule::Required, Condition::Single(Predicate::holds(Test::FieldTrue { field_id: "askForPath".to_owned() })))],
    );
    let mut mode = field("mode", FieldKind::Select, always_visible(), Vec::new());
    mode.options = vec![
        FieldOption { value: Scalar::Text("fast".to_owned()), label: text("快速", "Fast"), hint: None, disabled: false },
        FieldOption { value: Scalar::Text("safe".to_owned()), label: text("安全", "Safe"), hint: None, disabled: true },
    ];
    let ask = field("askForPath", FieldKind::Boolean, always_visible(), Vec::new());
    let fields = vec![unconditional, conditional, mode, ask];

    let english = plan(&fields, &values, "en");
    assert!(row(&english, "paths").required, "an unconditional `required` rule must ask");
    assert!(!row(&english, "undoPath").required, "a rule gated on an unanswered field must not force the question");
    assert_eq!(
        english.iter().map(|row| row.id.as_str()).collect::<Vec<&str>>(),
        ["paths", "undoPath", "mode", "askForPath"],
        "the plan is the declaration order, nothing else"
    );

    // The same rule with its condition satisfied: the gate is live, not decoration.
    let answered = answers(&[("askForPath", Scalar::Boolean(true))]);
    assert!(row(&plan(&fields, &answered, "en"), "undoPath").required, "the rule applies once its condition holds");

    // The language selects the authored side verbatim; a face may not translate.
    let chinese = plan(&fields, &values, "zh");
    assert_eq!(row(&english, "paths").label, "paths");
    assert_eq!(row(&english, "paths").help.as_deref(), Some("Help for paths."));
    assert_eq!(row(&chinese, "paths").label, "中文 paths");
    assert_eq!(row(&chinese, "paths").help.as_deref(), Some("说明 paths"));

    // `Step::options` resolve through the same language and keep the declared `disabled` flag for a face to
    // grey out; the value a face submits stays the field's own, not the label.
    assert_eq!(option_texts(&row(&english, "mode").options), [("Fast", false), ("Safe", true)]);
    assert_eq!(option_texts(&row(&chinese, "mode").options), [("快速", false), ("安全", true)]);
}

#[test]
fn each_danger_gate_shape_decides_on_its_own_terms() {
    let gate_fields = || vec![field("action", FieldKind::Text, always_visible(), Vec::new()), field("force", FieldKind::Boolean, always_visible(), Vec::new())];
    let run_without_force = answers(&[("action", Scalar::Text("run".to_owned())), ("force", Scalar::Boolean(false))]);
    let run_with_force = answers(&[("action", Scalar::Text("run".to_owned())), ("force", Scalar::Boolean(true))]);
    let another_action = answers(&[("action", Scalar::Text("scan".to_owned())), ("force", Scalar::Boolean(true))]);

    assert_eq!(
        danger_required(&definition(gate_fields(), DangerGate::None), &run_with_force, "zh"),
        Danger::NotRequired,
        "a node that declares no gate never asks, however authored its prompt is"
    );

    let action_in = definition(gate_fields(), DangerGate::ActionIn { action_field: "action".to_owned(), dangerous: vec!["run".to_owned()] });
    assert_eq!(
        danger_required(&action_in, &run_without_force, "zh"),
        Danger::Confirm {
            title: "确认覆盖".to_owned(),
            body: "目标文件将被替换且不可撤销。".to_owned(),
            confirm_label: "我确认覆盖".to_owned(),
        },
        "the authored Chinese copy is what a Chinese session must show"
    );
    // The regression the `language` parameter exists for: the same gate in an English session shows the
    // English side, not the Chinese one baked into the definition first.
    assert_eq!(
        danger_required(&action_in, &run_without_force, "en"),
        Danger::Confirm {
            title: "Confirm overwrite".to_owned(),
            body: "Targets are replaced and this cannot be undone.".to_owned(),
            confirm_label: "Yes, overwrite them".to_owned(),
        },
        "the same gate must resolve to the English side"
    );
    assert_eq!(danger_required(&action_in, &another_action, "zh"), Danger::NotRequired, "an action outside the list is not the destructive one");

    let flag = definition(gate_fields(), DangerGate::FieldFlag { field_id: "force".to_owned(), inverted: false });
    assert_eq!(danger_required(&flag, &run_without_force, "zh"), Danger::NotRequired, "force=false is not the flag");
    assert!(matches!(danger_required(&flag, &run_with_force, "zh"), Danger::Confirm { .. }), "force=true is");

    let inverted = definition(gate_fields(), DangerGate::FieldFlag { field_id: "force".to_owned(), inverted: true });
    assert!(matches!(danger_required(&inverted, &run_without_force, "zh"), Danger::Confirm { .. }), "an inverted flag fires when the field is false");
    assert_eq!(danger_required(&inverted, &run_with_force, "zh"), Danger::NotRequired, "and stays quiet when it is set");
    assert!(
        matches!(danger_required(&inverted, &Values::new(), "zh"), Danger::Confirm { .. }),
        "an unanswered flag is the not-set case, which an inverted flag reads as false: a default cannot be skipped silently"
    );

    let all = definition(
        gate_fields(),
        DangerGate::All(vec![
            Predicate::holds(Test::ActionIs { action_field: "action".to_owned(), allowed: vec!["run".to_owned()] }),
            Predicate::holds(Test::FieldTrue { field_id: "force".to_owned() }),
        ]),
    );
    assert_eq!(danger_required(&all, &run_without_force, "zh"), Danger::NotRequired, "all() must fail when one predicate fails");
    assert!(matches!(danger_required(&all, &run_with_force, "zh"), Danger::Confirm { .. }), "all() holds when both do");

    let any = definition(
        gate_fields(),
        DangerGate::Any(vec![
            Predicate::holds(Test::ActionIs { action_field: "action".to_owned(), allowed: vec!["scan".to_owned()] }),
            Predicate::fails(Test::FieldTrue { field_id: "force".to_owned() }),
        ]),
    );
    assert!(
        matches!(danger_required(&any, &run_without_force, "zh"), Danger::Confirm { .. }),
        "any() holds on its second predicate, which is repacku's `dryRun === false || deleteAfter === true`"
    );
    assert_eq!(danger_required(&any, &run_with_force, "zh"), Danger::NotRequired, "and fails only when both do");

    // A gate the node computes in its plugin is not the CLI's to answer, even when it also authored the copy:
    // confirming here would let a run the plugin judges destructive proceed on a shrug.
    let plugin = definition(gate_fields(), DangerGate::PluginExport { export_name: "isDangerous".to_owned() });
    assert_eq!(
        danger_required(&plugin, &run_with_force, "zh"),
        Danger::FromPlugin { export_name: "isDangerous".to_owned() },
        "a plugin-computed gate must be reported, not answered here"
    );

    // The other producer of the same outcome: the gate is declarable but the copy is not (enginev, bitv).
    let copy_export = definition_prompt(
        gate_fields(),
        DangerGate::ActionIn { action_field: "action".to_owned(), dangerous: vec!["run".to_owned()] },
        None,
        Some("danger_prompt".to_owned()),
    );
    assert_eq!(
        danger_required(&copy_export, &run_without_force, "zh"),
        Danger::FromPlugin { export_name: "danger_prompt".to_owned() },
        "the export the host must call is named, not guessed"
    );

    let promptless = definition_prompt(gate_fields(), DangerGate::All(vec![Predicate::holds(Test::FieldTrue { field_id: "action".to_owned() })]), None, None);
    assert_eq!(danger_required(&promptless, &run_without_force, "zh"), Danger::MissingPrompt, "a gate without text is a contract bug, not a silent pass");
}
