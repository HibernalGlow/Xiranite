//! Terminal execution: clap parses what the user typed, cliclack asks what they did not.
//!
//! Both halves read the same [`NodeDefinition`] and the same [`crate::plan`] output, so a flag and its prompt
//! cannot disagree about visibility or danger — the drift ADR-0069 exists to stop. The layer stays
//! node-agnostic: a node's `cli.rs` decides the command tree, the output format and the exit codes, and calls
//! into here.
//!
//! Written against the APIs as published, not from memory of an older major version: cliclack 0.5.6 offers
//! `input`/`password`/`select`/`multiselect`/`confirm` with `placeholder(&str)`, `default_input(&str)`,
//! `required(bool)`, `multiline()`, `validate(..)`, `initial_value(..)` and `interact(&mut self)`, and has no
//! numeric prompt at all — which is why a `number` field is a validated text input here, the same thing the
//! legacy Clack code does.

use std::collections::BTreeMap;
use std::io;

use clap::{Arg, ArgAction, Command};

use xiranite_plugin_api::node_definition::{FieldKind, NodeDefinition, Scalar};

use crate::help::render_help;
use crate::plan::{Danger, Step, Values, danger_required, prompt_plan};

/// Why the interaction could not complete.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalError(String);

impl TerminalError {
    fn io(error: io::Error) -> Self {
        Self(error.to_string())
    }
}

impl std::fmt::Display for TerminalError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for TerminalError {}

/// One question, detached from the definition so the answer loop can own its values map while asking.
struct Question {
    id: String,
    label: String,
    help: Option<String>,
    default_text: Option<String>,
    required: bool,
    kind: FieldKind,
    /// `(value, localized label)` for a `select` field; the value is what gets submitted.
    options: Vec<(String, String)>,
}

fn question(step: Step<'_>, language: &str) -> Question {
    Question {
        default_text: step.field.default.as_ref().map(Scalar::display_text),
        help: step.help,
        id: step.field.id.clone(),
        kind: step.field.kind,
        label: step.label,
        options: step
            .field
            .options
            .iter()
            .filter(|option| !option.disabled)
            .map(|option| (option.value.display_text(), option.label.resolve(language).to_owned()))
            .collect(),
        required: step.required,
    }
}

/// The clap command for a node's action: each declared field becomes a long flag.
///
/// Booleans are switches because that is how the legacy CLI spelled them (`--dry-run`, not `--dry-run=true`);
/// numbers parse as `f64` to match `Scalar::Number`; the rest take text, and repeated flags join with newlines,
/// which is the shape the legacy interaction feeds `path-list` and `multiline`. Option fields deliberately do
/// not become clap `PossibleValues`: the accepted token is the raw value while the label is localized, so
/// checking against `field.options` stays this layer's job.
///
/// Everything handed to clap is owned: the flag names come out of a definition that does not live as long as
/// the returned `Command`.
#[must_use]
pub fn command_for(definition: &NodeDefinition, program: &str, language: &str) -> Command {
    let mut command = Command::new(program.to_owned()).about(definition.description.resolve(language).to_owned());
    // The node's own documentation becomes clap's long-help epilogue, so `--help` prints the dictionary's
    // steps rather than a paraphrase of them; a node without a dictionary gets no epilogue at all.
    let long_help = render_help(definition, language);
    if !long_help.is_empty() {
        command = command.after_long_help(long_help);
    }
    for field in &definition.fields {
        let mut argument = Arg::new(field.id.clone()).long(field.id.clone())
            .help(field.label.resolve(language).to_owned());
        if let Some(description) = &field.description {
            argument = argument.long_help(description.resolve(language).to_owned());
        }
        command = match field.kind {
            FieldKind::Boolean => command.arg(argument.action(ArgAction::SetTrue)),
            FieldKind::Number => command.arg(argument.value_parser(clap::value_parser!(f64))),
            _ => command.arg(argument.action(ArgAction::Append)),
        };
    }
    command
}

/// The answers a command line provided, typed per field kind.
#[must_use]
pub fn values_from_matches(definition: &NodeDefinition, matches: &clap::ArgMatches) -> Values {
    let mut values: Values = BTreeMap::new();
    for field in &definition.fields {
        let id = field.id.as_str();
        match field.kind {
            FieldKind::Boolean => {
                if matches.get_flag(id) {
                    values.insert(field.id.clone(), Scalar::Boolean(true));
                }
            }
            FieldKind::Number => {
                if let Some(number) = matches.get_one::<f64>(id) {
                    values.insert(field.id.clone(), Scalar::Number(*number));
                }
            }
            _ => {
                if let Some(text) = matches
                    .get_many::<String>(id)
                    .map(|texts| texts.cloned().collect::<Vec<String>>().join("\n"))
                {
                    values.insert(field.id.clone(), Scalar::Text(text));
                }
            }
        }
    }
    values
}

fn ask(question: &Question) -> Result<Scalar, TerminalError> {
    match question.kind {
        FieldKind::Boolean => {
            let mut prompt = cliclack::confirm(question.label.clone());
            if let Some(default) = &question.default_text {
                prompt = prompt.initial_value(default == "true");
            }
            Ok(Scalar::Boolean(prompt.interact().map_err(TerminalError::io)?))
        }
        FieldKind::Select if !question.options.is_empty() => {
            let mut prompt = cliclack::select(question.label.clone());
            for (value, label) in &question.options {
                prompt = prompt.item(value.clone(), label.clone(), "");
            }
            if let Some(default) = &question.default_text {
                prompt = prompt.initial_value(default.clone());
            }
            Ok(Scalar::Text(prompt.interact().map_err(TerminalError::io)?))
        }
        FieldKind::Number => {
            let mut prompt = cliclack::input(question.label.clone());
            if let Some(default) = &question.default_text {
                prompt = prompt.default_input(default);
            }
            prompt = prompt.validate(|value: &String| match value.trim().parse::<f64>() {
                Ok(number) if number.is_finite() => Ok(()),
                _ => Err("enter a number"),
            });
            let answer: String = prompt.interact().map_err(TerminalError::io)?;
            Ok(Scalar::Number(answer.trim().parse::<f64>().unwrap_or(0.0)))
        }
        kind => {
            let mut prompt = cliclack::input(question.label.clone());
            if matches!(kind, FieldKind::Multiline | FieldKind::PathList) {
                prompt = prompt.multiline();
            }
            if let Some(help) = &question.help {
                prompt = prompt.placeholder(help);
            }
            if let Some(default) = &question.default_text {
                prompt = prompt.default_input(default);
            }
            prompt = prompt.required(question.required);
            Ok(Scalar::Text(prompt.interact().map_err(TerminalError::io)?))
        }
    }
}

/// Ask for whatever the command line left open, then honour the node's danger gate.
///
/// The plan is computed once, up front, from the values the flags supplied. Re-evaluating visibility between
/// questions would let an early answer reveal or hide a later one mid-session, and the legacy guided mode did
/// not do that, so neither may the new faces.
pub fn collect_missing(definition: &NodeDefinition, mut values: Values, language: &str) -> Result<Values, TerminalError> {
    for question in prompt_plan(definition, &values, language).into_iter().map(|step| question(step, language)) {
        if values.contains_key(&question.id) {
            continue;
        }
        values.insert(question.id.clone(), ask(&question)?);
    }

    match danger_required(definition, &values, language) {
        Danger::NotRequired => Ok(values),
        Danger::Confirm { title, body, confirm_label } => {
            // The node authored three strings and all three are shown: the confirmation text is part of what
            // makes a destructive run recognisable, so it is not the CLI's to paraphrase.
            cliclack::note(title, body).map_err(TerminalError::io)?;
            if cliclack::confirm(confirm_label).interact().map_err(TerminalError::io)? {
                Ok(values)
            } else {
                Err(TerminalError("cancelled at the danger confirmation".to_owned()))
            }
        }
        Danger::FromPlugin { export_name } => Err(TerminalError(format!(
            "the danger gate is computed by the plugin export {export_name:?}; run it through the operation host, not the interactive prompt"
        ))),
        Danger::MissingPrompt => Err(TerminalError("the danger gate holds but the node published no prompt text".to_owned())),
    }
}
