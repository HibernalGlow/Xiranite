//! The CLI's view of a node's definition: which questions to ask, in what order, in which language.
//!
//! The rules themselves — what makes a field visible, what makes it required, whether a run owes a danger
//! confirmation — are **not** here. They live in `xiranite_plugin_api::definition_eval`, because the Web form
//! and the TUI's section tabs have to answer them identically and a second implementation is the drift ADR-0069
//! exists to prevent. What this module adds is only the shape a terminal needs: [`Step`], which pairs a field
//! with its resolved label, help line, options and `required` flag.
//!
//! (This file used to hold the algebra. Moving it out is what lets `crates/xiranite-tui-runtime` evaluate
//! visibility without depending on a CLI crate.)

use xiranite_plugin_api::node_definition::{FieldDefinition, NodeDefinition};

// The algebra is re-exported rather than copied: `Values`, the predicate functions and `Danger` are the very
// items `xiranite-plugin-api` publishes, so no face can end up with a private variant of the rules.
pub use xiranite_plugin_api::definition_eval::{
    DangerDecision as Danger, Values, condition_holds, evaluate_danger, is_required, is_truthy, is_visible,
    predicate_holds, resolve_text, test_holds, text_of,
};

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
    /// Whether the node's rules demand an answer here; the danger confirmation is a separate decision, so the
    /// renderer never has to re-read the rule vocabulary.
    pub required: bool,
}

/// The visible fields, in declaration order, with their copy resolved.
#[must_use]
pub fn prompt_plan<'a>(definition: &'a NodeDefinition, values: &Values, language: &str) -> Vec<Step<'a>> {
    definition
        .fields
        .iter()
        .filter(|field| is_visible(field, values))
        .map(|field| Step {
            label: resolve_text(&field.label, language),
            help: field.description.as_ref().map(|text| resolve_text(text, language)),
            options: field
                .options
                .iter()
                .map(|option| (resolve_text(&option.label, language), option.disabled))
                .collect(),
            required: is_required(field, values),
            field,
        })
        .collect()
}

/// The node's danger gate for these answers, in the session language.
#[must_use]
pub fn danger_required(definition: &NodeDefinition, values: &Values, language: &str) -> Danger {
    evaluate_danger(definition, values, language)
}
