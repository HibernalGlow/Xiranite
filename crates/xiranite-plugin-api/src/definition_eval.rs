//! The one evaluator for a node's published definition: which fields are visible, which are required, and
//! whether the run owes a danger confirmation.
//!
//! This lives with the definition model, not in a face, for a reason: the CLI's prompts, the TUI's sections and
//! the Web UI's form must answer these questions identically, and every previous implementation of them was a
//! closure inside a node's `interaction.ts` that each face re-read in its own way. ADR-0069's "shared
//! semantics, per-face composition" is only true if there is exactly one place that reads a `Condition`, and a
//! port that copies the rules into a face is the drift this module exists to make impossible.
//!
//! Like the rest of the Plugin API it depends on nothing but `core`/`alloc`, so a plugin compiled to wasm and a
//! host binary evaluate the same code.

use crate::node_definition::{
    Condition, DangerGate, FieldDefinition, GuardedRule, LocalizedText, NodeDefinition, Predicate, Rule, Scalar, Test,
};

use std::collections::BTreeMap;

/// Answers collected so far, keyed by field id.
pub type Values = BTreeMap<String, Scalar>;

/// Whether the run owes a danger confirmation, and where its text comes from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DangerDecision {
    /// The node declared no gate, or the gate does not hold, so the run proceeds.
    NotRequired,
    /// The gate holds and the node authored the copy; the strings are resolved in the requested language.
    Confirm { title: String, body: String, confirm_label: String },
    /// The decision or its copy belongs to a plugin export the host has to call — either the gate is a
    /// [`DangerGate::PluginExport`], which no answer map can settle, or the node writes its prompt through
    /// `dangerPromptExport` — so no face may answer it from the values.
    FromPlugin { export_name: String },
    /// The gate holds and the node declared no prompt, which must surface as a contract bug rather than a
    /// silent pass or an invented sentence.
    MissingPrompt,
}

/// The text form a value takes when a leaf compares it against authored option strings.
#[must_use]
pub fn text_of(value: &Scalar) -> String {
    match value {
        Scalar::Text(text) => text.clone(),
        Scalar::Number(number) => {
            if number.fract() == 0.0 { format!("{}", *number as i64) } else { number.to_string() }
        }
        Scalar::Boolean(flag) => flag.to_string(),
    }
}

/// Whether a value counts as "set and on", the way the legacy `interaction.ts` truthiness did.
#[must_use]
pub fn is_truthy(value: &Scalar) -> bool {
    match value {
        Scalar::Boolean(flag) => *flag,
        Scalar::Text(text) => !text.trim().is_empty(),
        Scalar::Number(number) => *number != 0.0,
    }
}

/// Evaluate one leaf against the answers.
#[must_use]
pub fn test_holds(test: &Test, values: &Values) -> bool {
    match test {
        Test::Always => true,
        // `never` is how a node writes a field nothing shows (`packages/nodes/cleanf/src/interaction.ts`).
        Test::Never => false,
        Test::ActionIs { action_field, allowed } => values
            .get(action_field)
            .is_some_and(|value| allowed.iter().any(|candidate| *candidate == text_of(value))),
        // Equality is by value and kind: a number answer never equals a text one.
        Test::FieldEquals { field_id, value } => values.get(field_id).is_some_and(|current| current == value),
        Test::FieldFilled { field_id } => values.get(field_id).is_some_and(|value| !text_of(value).trim().is_empty()),
        Test::FieldTrue { field_id } => values.get(field_id).is_some_and(is_truthy),
        Test::NumberAtLeast { field_id, minimum } => values
            .get(field_id)
            .is_some_and(|value| matches!(value, Scalar::Number(number) if number >= minimum)),
    }
}

/// A predicate is a leaf plus an optional negation — depth one, never nested (ADR-0068).
#[must_use]
pub fn predicate_holds(predicate: &Predicate, values: &Values) -> bool {
    test_holds(&predicate.test, values) != predicate.negated
}

#[must_use]
pub fn condition_holds(condition: &Condition, values: &Values) -> bool {
    match condition {
        Condition::Single(predicate) => predicate_holds(predicate, values),
        Condition::All(predicates) => predicates.iter().all(|predicate| predicate_holds(predicate, values)),
        Condition::Any(predicates) => predicates.iter().any(|predicate| predicate_holds(predicate, values)),
        Condition::AnyAll(clauses) => clauses
            .iter()
            .any(|clause| clause.iter().all(|predicate| predicate_holds(predicate, values))),
    }
}

#[must_use]
pub fn is_visible(field: &FieldDefinition, values: &Values) -> bool {
    condition_holds(&field.visible, values)
}

/// Does this field's rules demand an answer? Only `required`/`nonBlank` gate a question; the range and format
/// rules constrain whatever the user typed instead. A rule with its own `when` binds only while it holds.
#[must_use]
pub fn is_required(field: &FieldDefinition, values: &Values) -> bool {
    field.rules.iter().any(|guarded| {
        guarded.when.as_ref().is_none_or(|condition| condition_holds(condition, values))
            && matches!(guarded.rule, Rule::Required | Rule::NonBlank)
    })
}

/// The authored copy for one language, in the shared `zh`-default resolution.
#[must_use]
pub fn resolve_text(text: &LocalizedText, language: &str) -> String {
    text.resolve(language).to_owned()
}

/// Number of non-blank lines a value carries, which is how a path list counts entries.
fn line_count(value: Option<&Scalar>) -> usize {
    value.map(|held| text_of(held).lines().filter(|line| !line.trim().is_empty()).count()).unwrap_or(0)
}

fn within_range(field: &FieldDefinition, value: Option<&Scalar>, integer_only: bool) -> bool {
    let Some(Scalar::Number(number)) = value else { return true };
    if integer_only && number.fract() != 0.0 {
        return false;
    }
    match &field.range {
        Some(range) => number >= &range.min.unwrap_or(f64::MIN) && number <= &range.max.unwrap_or(f64::MAX),
        None => true,
    }
}

/// Does one rule hold for this field, given the answers so far?
///
/// A field nobody answered only fails the rules that demand an answer: an optional number left empty is not a
/// range violation. [`Rule::Custom`] answers `true` because the host cannot decide it — a face that has to check
/// one calls the named plugin export, and a face that skips it is not silently passing the node.
#[must_use]
pub fn rule_holds(field: &FieldDefinition, rule: &Rule, values: &Values) -> bool {
    let own = values.get(&field.id);
    let filled = own.is_some_and(|value| !text_of(value).trim().is_empty());
    match rule {
        Rule::Required | Rule::NonBlank => filled,
        Rule::IntegerAtLeast { minimum } => {
            own.is_some_and(|value| matches!(value, Scalar::Number(number) if number.fract() == 0.0 && number >= &(*minimum as f64)))
        }
        Rule::IntegerInRange => within_range(field, own, true),
        Rule::NumberAtLeast { minimum } => own.is_some_and(|value| matches!(value, Scalar::Number(number) if number >= minimum)),
        Rule::NumberInRange => within_range(field, own, false),
        Rule::OneOfDeclaredOptions => own.is_some_and(|value| field.options.iter().any(|option| &option.value == value)),
        Rule::AtLeastLines { minimum } => line_count(own) >= *minimum as usize,
        Rule::AnyFilled { field_ids } => {
            field_ids.iter().any(|id| values.get(id).is_some_and(|value| !text_of(value).trim().is_empty()))
        }
        Rule::Custom { .. } => true,
    }
}

/// The first rule the answers break, returning the field's own guarded entry so a face prints the node's
/// message instead of inventing one. Guarded rules whose `when` does not hold are skipped, which is what makes a
/// per-action requirement ("compress needs a config or a folder path") one piece of data rather than per-face code.
#[must_use]
pub fn first_violation<'a>(field: &'a FieldDefinition, values: &Values) -> Option<&'a GuardedRule> {
    field.rules.iter().find(|guarded| {
        guarded.when.as_ref().is_none_or(|condition| condition_holds(condition, values)) && !rule_holds(field, &guarded.rule, values)
    })
}

/// Every visible field whose answers break a rule, in declaration order — the report a face prints before a run.
#[must_use]
pub fn violations<'a>(definition: &'a NodeDefinition, values: &Values) -> Vec<(&'a FieldDefinition, &'a GuardedRule)> {
    definition
        .fields
        .iter()
        .filter(|field| is_visible(field, values))
        .filter_map(|field| first_violation(field, values).map(|guarded| (field, guarded)))
        .collect()
}

/// Decide the danger confirmation for a run.
///
/// The language is a parameter because the copy is node-authored: hard-coding one side would show Chinese
/// confirmation text in an English session, which is the drift ADR-0069 forbids.
#[must_use]
pub fn evaluate_danger(definition: &NodeDefinition, values: &Values, language: &str) -> DangerDecision {
    let holds = match &definition.danger {
        DangerGate::None => false,
        DangerGate::ActionIn { action_field, dangerous } => values
            .get(action_field)
            .is_some_and(|value| dangerous.iter().any(|candidate| *candidate == text_of(value))),
        DangerGate::FieldFlag { field_id, inverted } => {
            let set = values.get(field_id).is_some_and(is_truthy);
            if *inverted { !set } else { set }
        }
        DangerGate::All(predicates) => predicates.iter().all(|predicate| predicate_holds(predicate, values)),
        DangerGate::Any(predicates) => predicates.iter().any(|predicate| predicate_holds(predicate, values)),
        // An export-computed gate is not answerable from the values at all. Reporting `Confirm` here would show
        // the node's copy for a run the plugin might judge harmless, then let it proceed on the user's shrug,
        // so the export name is what the host must call first; faces refuse to guess instead.
        DangerGate::PluginExport { export_name } => return DangerDecision::FromPlugin { export_name: export_name.clone() },
    };

    if !holds {
        return DangerDecision::NotRequired;
    }
    if let Some(export_name) = &definition.danger_prompt_export {
        return DangerDecision::FromPlugin { export_name: export_name.clone() };
    }
    definition
        .danger_prompt
        .as_ref()
        .map(|prompt| DangerDecision::Confirm {
            title: resolve_text(&prompt.title, language),
            body: resolve_text(&prompt.body, language),
            confirm_label: resolve_text(&prompt.confirm_label, language),
        })
        .unwrap_or(DangerDecision::MissingPrompt)
}

#[cfg(test)]
mod rule_tests {
    use super::*;
    use crate::node_definition::{FieldKind, GuardedRule, LocalizedText};

    fn field(id: &str, rules: Vec<Rule>) -> FieldDefinition {
        FieldDefinition {
            default: None,
            description: None,
            id: id.to_owned(),
            is_action_selector: false,
            kind: FieldKind::Text,
            label: LocalizedText::new("字段", "Field"),
            lines: None,
            options: Vec::new(),
            placeholder: None,
            range: None,
            rules: rules.into_iter().map(|rule| GuardedRule::only(rule, Condition::Single(Predicate::holds(Test::Always)))).collect(),
            visible: Condition::Single(Predicate::holds(Test::Always)),
        }
    }

    #[test]
    fn any_filled_holds_when_any_named_field_answered_and_names_the_alternative() {
        let rule = Rule::AnyFilled { field_ids: vec!["paths".to_owned(), "mappingText".to_owned()] };
        let target = field("paths", vec![rule.clone()]);
        // bandia's real case: paths empty but mappings present must not block the run...
        let with_mapping: Values = [("action", "export_efu"), ("paths", ""), ("mappingText", "a => b")]
            .into_iter()
            .map(|(id, value)| (id.to_owned(), Scalar::Text(value.to_owned())))
            .collect();
        assert!(rule_holds(&target, &rule, &with_mapping), "a filled alternative satisfies the rule");
        // ...while both blank is exactly the mistake the rule guards.
        let neither: Values = [("paths", "  "), ("mappingText", "")]
            .into_iter()
            .map(|(id, value)| (id.to_owned(), Scalar::Text(value.to_owned())))
            .collect();
        assert!(!rule_holds(&target, &rule, &neither), "neither alternative filled must fail");
        assert!(first_violation(&target, &neither).is_some(), "the guarded entry is reported, not just the failure");
        assert!(first_violation(&target, &with_mapping).is_none(), "the same field passes when an alternative is answered");
    }

    #[test]
    fn an_unguarded_rule_only_fails_when_it_demands_an_answer() {
        let target = field("paths", vec![Rule::Required, Rule::AtLeastLines { minimum: 2 }]);
        let empty: Values = [("paths", "")].into_iter().map(|(id, value)| (id.to_owned(), Scalar::Text(value.to_owned()))).collect();
        assert_eq!(first_violation(&target, &empty).map(|guarded| guarded.rule.clone()), Some(Rule::Required));

        // An optional number left blank is not a range violation; only an out-of-range answer is.
        let optional = FieldDefinition { kind: FieldKind::Number, range: Some(crate::node_definition::FieldRange { min: Some(1.0), max: Some(8.0), step: None }), rules: vec![GuardedRule::only(Rule::NumberInRange, Condition::Single(Predicate::holds(Test::Always)))], ..target.clone() };
        let blank: Values = Vec::new().into_iter().collect();
        assert!(first_violation(&optional, &blank).is_none(), "an unanswered optional field breaks no range rule");
        let too_big: Values = [(target.id.clone(), Scalar::Number(9.0))].into_iter().collect();
        assert!(first_violation(&optional, &too_big).is_some(), "9 is outside 1..=8");
    }

    #[test]
    fn a_custom_rule_is_never_answered_here_and_a_stale_guard_is_skipped() {
        let target = field("paths", vec![Rule::Custom { export_name: "validate_rows".to_owned() }]);
        let anything: Values = [("paths", "junk")].into_iter().map(|(id, value)| (id.to_owned(), Scalar::Text(value.to_owned()))).collect();
        assert!(rule_holds(&target, &Rule::Custom { export_name: "validate_rows".to_owned() }, &anything), "the host must call the export rather than guess");
        assert!(first_violation(&target, &anything).is_none(), "a custom rule leaves no verdict for the face");

        // The guard travels with the rule: an export_efu requirement must not fire during a compress run.
        let guarded = FieldDefinition {
            rules: vec![GuardedRule {
                message: Some(LocalizedText::new("需要路径或映射。", "Provide paths or mappings.")),
                rule: Rule::AnyFilled { field_ids: vec!["paths".to_owned(), "mappingText".to_owned()] },
                when: Some(Condition::Single(Predicate::holds(Test::ActionIs {
                    action_field: "action".to_owned(),
                    allowed: vec!["export_efu".to_owned()],
                }))),
            }],
            ..target
        };
        let compress: Values = [("action", "compress"), ("paths", ""), ("mappingText", "")]
            .into_iter()
            .map(|(id, value)| (id.to_owned(), Scalar::Text(value.to_owned())))
            .collect();
        assert!(first_violation(&guarded, &compress).is_none(), "the rule does not apply to this action");
    }
}
