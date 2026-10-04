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
    Condition, DangerGate, FieldDefinition, LocalizedText, NodeDefinition, Predicate, Rule, Scalar, Test,
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
