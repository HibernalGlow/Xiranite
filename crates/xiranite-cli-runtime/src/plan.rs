//! Turning a node's published definition into the questions a terminal should ask, with the answers
//! evaluated by the same algebra the Web UI and the TUI use.
//!
//! This is the Rust form of `packages/cli-runtime/src/interaction.ts`'s *semantics* — visibility, danger, and
//! the shape of each prompt — as a pure function over [`NodeDefinition`] plus the values collected so far. The
//! execution layer (`crate::term`) only renders the steps; no face re-implements the condition algebra, which
//! is what ADR-0069 means by "shared semantics, per-face composition".

use std::collections::BTreeMap;

use xiranite_plugin_api::node_definition::{
    Condition, DangerGate, FieldDefinition, LocalizedText, NodeDefinition, Predicate, Rule, Scalar, Test,
};

/// Answers collected so far, keyed by field id.
pub type Values = BTreeMap<String, Scalar>;

/// One question the CLI must ask, in the order the definition declares them.
#[derive(Debug, Clone, PartialEq)]
pub struct Step<'a> {
    /// The declared field, so the renderer can reach `placeholder`, `lines`, `range`, and `rules`.
    pub field: &'a FieldDefinition,
    /// Label in the requested language.
    pub label: String,
    /// Help line in the requested language, when the node authored one.
    pub help: Option<String>,
    /// The select/boolean choices, already resolved to this language.
    pub options: Vec<(String, bool)>,
    /// Whether a danger confirmation gates this step's completion; the gate itself is separate, so the
    /// renderer never has to reinterpret the rule vocabulary.
    pub required: bool,
}

/// Whether a danger confirmation is owed before the run may proceed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Danger {
    /// The node declared no gate, so the run proceeds.
    NotRequired,
    /// The gate holds and the node authored the prompt text.
    Confirm { title: String, body: String, confirm_label: String },
    /// The decision or its copy belongs to a plugin export the host has to call — either the gate is a
    /// [`DangerGate::PluginExport`] the values cannot answer, or the node authors its prompt through
    /// `dangerPromptExport` — so the CLI must not answer it from the values map.
    FromPlugin { export_name: String },
    /// The gate holds and the node declared no prompt, which the CLI must not paper over silently.
    MissingPrompt,
}

fn text_of(value: &Scalar) -> String {
    match value {
        Scalar::Text(text) => text.clone(),
        Scalar::Number(number) => {
            if number.fract() == 0.0 { format!("{}", *number as i64) } else { number.to_string() }
        }
        Scalar::Boolean(flag) => flag.to_string(),
    }
}

fn truthy(value: &Scalar) -> bool {
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
        Test::FieldEquals { field_id, value } => values.get(field_id).is_some_and(|current| current == value),
        Test::FieldFilled { field_id } => values.get(field_id).is_some_and(|value| !text_of(value).trim().is_empty()),
        Test::FieldTrue { field_id } => values.get(field_id).is_some_and(truthy),
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
        Condition::AnyAll(clauses) => clauses.iter().any(|clause| {
            clause.iter().all(|predicate| predicate_holds(predicate, values))
        }),
    }
}

#[must_use]
pub fn is_visible(field: &FieldDefinition, values: &Values) -> bool {
    condition_holds(&field.visible, values)
}

/// Does this field's rules demand an answer? Only `required`/`nonBlank` gate the prompt; the range and
/// format rules are validated against whatever the user types.
fn is_required(field: &FieldDefinition, values: &Values) -> bool {
    field.rules.iter().any(|guarded| {
        guarded.when.as_ref().is_none_or(|condition| condition_holds(condition, values))
            && matches!(guarded.rule, Rule::Required | Rule::NonBlank)
    })
}

/// The visible fields, in declaration order, with their labels resolved.
#[must_use]
pub fn prompt_plan<'a>(definition: &'a NodeDefinition, values: &Values, language: &str) -> Vec<Step<'a>> {
    definition
        .fields
        .iter()
        .filter(|field| is_visible(field, values))
        .map(|field| Step {
            label: resolve(&field.label, language),
            help: field.description.as_ref().map(|text| resolve(text, language)),
            options: field
                .options
                .iter()
                .map(|option| (resolve(&option.label, language), option.disabled))
                .collect(),
            required: is_required(field, values),
            field,
        })
        .collect()
}

fn resolve(text: &LocalizedText, language: &str) -> String {
    text.resolve(language).to_owned()
}

/// Evaluate the node's danger gate against the answers, resolving its authored copy in the session language.
///
/// The prompt is node-authored content, so the language is a parameter here rather than a default: hard-coding
/// one side would show Chinese confirmation copy in an English session, which is the drift ADR-0069 forbids.
#[must_use]
pub fn danger_required(definition: &NodeDefinition, values: &Values, language: &str) -> Danger {
    let holds = match &definition.danger {
        DangerGate::None => false,
        DangerGate::ActionIn { action_field, dangerous } => values
            .get(action_field)
            .is_some_and(|value| dangerous.iter().any(|candidate| *candidate == text_of(value))),
        DangerGate::FieldFlag { field_id, inverted } => {
            let set = values.get(field_id).is_some_and(truthy);
            if *inverted { !set } else { set }
        }
        DangerGate::All(predicates) => predicates.iter().all(|predicate| predicate_holds(predicate, values)),
        DangerGate::Any(predicates) => predicates.iter().any(|predicate| predicate_holds(predicate, values)),
        // A plugin-computed gate is not answerable from the values at all. Reporting `Confirm` here would show
        // the node's copy for a run the plugin might judge harmless, and then let it proceed on the user's
        // shrug, so the gate's own export name is what the host must call first (`term` refuses this shape).
        DangerGate::PluginExport { export_name } => return Danger::FromPlugin { export_name: export_name.clone() },
    };

    if !holds {
        return Danger::NotRequired;
    }
    if let Some(export_name) = &definition.danger_prompt_export {
        return Danger::FromPlugin { export_name: export_name.clone() };
    }
    definition
        .danger_prompt
        .as_ref()
        .map(|prompt| Danger::Confirm {
            title: resolve(&prompt.title, language),
            body: resolve(&prompt.body, language),
            confirm_label: resolve(&prompt.confirm_label, language),
        })
        .unwrap_or(Danger::MissingPrompt)
}
