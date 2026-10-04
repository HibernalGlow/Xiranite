//! The node's own usage documentation, printed the way the terminal prints it today.
//!
//! The content is the node's (`definition.help`, derived from its `help.ts` by `audit:node-help-text`) and the
//! layout is copied from `packages/cli-runtime/src/help.ts`'s `formatTerminalNodeHelp` — the `•` bullet, the
//! `◇` workflow marker, the per-surface `UI:`/`CLI:`/`Tip:` prefixes, `$ ` before an example command, six-space
//! indented descriptions, and one blank line between sections. A user who reads `xiranite help <node>` after the
//! TypeScript runtime is gone should not be able to tell which side produced the page; that is ADR-0069's "help
//! text does not drift" applied to the shape as well as the words.
//!
//! Two lines come from the definition rather than the dictionary, on purpose. The tagline is
//! [`NodeDefinition::description`], which is a quote of the dictionary's `short`/`description` and therefore one
//! line where the legacy page printed two. And `参数`/`Fields` is rendered from `fields[]`: it is complete for
//! every node, while `help.fields` was authored by only a few (measured: 4 of 41 dictionaries).

use xiranite_plugin_api::node_definition::{FieldDefinition, FieldKind, HelpSurface, NodeDefinition, Rule};

/// The headings and prefixes this face puts around the node's prose.
///
/// These are the legacy strings verbatim, because they are the only part of the page the node does not author.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaceHeading {
    /// `help.whenToUse`.
    WhenToUse,
    /// The commands group, above one entry per `help.commands[]`.
    Commands,
    /// `fields[]`, rendered from the definition because the node's dictionary rarely repeats it.
    Fields,
    /// `help.safety`, printed as `安全模式: <mode>`.
    SafetyMode,
    /// The prefix of a workflow step the app surface uses.
    UiPrefix,
    /// The prefix of a workflow step the terminal uses.
    CliPrefix,
    /// The prefix of advice that applies to either surface.
    TipPrefix,
    /// The marker in front of a command example.
    ExamplePrefix,
    /// The marker in front of a destructive warning.
    DestructivePrefix,
    /// The `必填` / `required` tag inside a field's metadata.
    Required,
    /// The `默认` / `default` label of a field's default value.
    Default,
}

impl FaceHeading {
    /// The string in the session language; anything but `"en"` is Chinese, as the model's own resolution is.
    #[must_use]
    pub fn resolve(self, language: &str) -> &'static str {
        let (zh, en) = match self {
            Self::WhenToUse => ("适用场景", "When to use"),
            Self::Commands => ("命令", "Commands"),
            Self::Fields => ("参数", "Fields"),
            Self::SafetyMode => ("安全模式", "Safety mode"),
            Self::UiPrefix => ("UI:", "UI:"),
            Self::CliPrefix => ("CLI:", "CLI:"),
            Self::TipPrefix => ("Tip:", "Tip:"),
            Self::ExamplePrefix => ("$ ", "$ "),
            Self::DestructivePrefix => ("! ", "! "),
            Self::Required => ("必填", "required"),
            Self::Default => ("默认", "default"),
        };
        if language == "en" { en } else { zh }
    }

    /// The prefix a workflow surface prints in front of each of its steps.
    #[must_use]
    pub const fn of_surface(surface: HelpSurface) -> Self {
        match surface {
            HelpSurface::WorkspaceUi => Self::UiPrefix,
            HelpSurface::CommandLine => Self::CliPrefix,
            HelpSurface::Tips => Self::TipPrefix,
        }
    }
}

/// The node's help page, one line per entry, in the legacy order.
///
/// A node that publishes no dictionary still gets the tagline and the `参数` section, because both come from the
/// definition; nothing here invents prose the node did not write.
#[must_use]
pub fn format_node_help(definition: &NodeDefinition, language: &str) -> Vec<String> {
    let mut lines = vec![definition.description.resolve(language).to_owned()];

    if let Some(help) = definition.help.as_ref() {
        let steps = help.when_to_use.resolve(language);
        if !steps.is_empty() {
            lines.push(String::new());
            lines.push(FaceHeading::WhenToUse.resolve(language).to_owned());
            lines.extend(steps.iter().map(|item| format!("  • {item}")));
        }

        for workflow in &help.workflows {
            lines.push(String::new());
            lines.push(format!("◇ {}", workflow.title.resolve(language)));
            lines.push(workflow.summary.as_ref().map(|text| text.resolve(language).to_owned()).unwrap_or_default());
            for entry in &workflow.entries {
                let prefix = FaceHeading::of_surface(entry.surface).resolve(language);
                lines.extend(entry.lines.resolve(language).iter().map(|step| format!("  {prefix} {step}")));
            }
        }

        if !help.commands.is_empty() {
            lines.push(String::new());
            lines.push(FaceHeading::Commands.resolve(language).to_owned());
            for command in &help.commands {
                let shown = command.command.as_deref().unwrap_or_else(|| command.title.resolve(language));
                lines.push(format!("  {shown}"));
                let note = command.description.as_ref().map(|text| text.resolve(language)).unwrap_or_default();
                lines.push(format!("      {note}"));
                for example in &command.examples {
                    lines.push(format!("      {}{}", FaceHeading::ExamplePrefix.resolve(language), example.command));
                }
            }
        }

        lines.extend(format_field_lines(&definition.fields, language));

        if let Some(safety) = &help.safety {
            lines.push(String::new());
            lines.push(format!("{}: {}", FaceHeading::SafetyMode.resolve(language), safety.default_mode.as_deref().unwrap_or("-")));
            let warning = FaceHeading::DestructivePrefix.resolve(language);
            lines.extend(safety.destructive.resolve(language).iter().map(|item| format!("  {warning}{item}")));
            lines.extend(safety.notes.resolve(language).iter().map(|note| format!("  • {note}")));
        }
    } else {
        lines.extend(format_field_lines(&definition.fields, language));
    }

    collapse_blank_runs(lines)
}

/// The whole page as the text a terminal prints below the usage line.
#[must_use]
pub fn render_help(definition: &NodeDefinition, language: &str) -> String {
    format_node_help(definition, language).join("\n")
}

/// `参数`/`Fields`, straight from the definition: the label the node authored, plus kind, whether an answer is
/// mandatory, and the default the faces start from.
fn format_field_lines(fields: &[FieldDefinition], language: &str) -> Vec<String> {
    if fields.is_empty() {
        return Vec::new();
    }
    let mut lines = vec![String::new(), FaceHeading::Fields.resolve(language).to_owned()];
    for field in fields {
        let mut metadata: Vec<String> = vec![wire_name(field.kind).to_owned()];
        if field.rules.iter().any(|guarded| matches!(guarded.rule, Rule::Required | Rule::NonBlank)) {
            metadata.push(FaceHeading::Required.resolve(language).to_owned());
        }
        if let Some(default) = &field.default {
            metadata.push(format!("{}={}", FaceHeading::Default.resolve(language), default.display_text()));
        }
        lines.push(format!("  {}  [{}]", field.label.resolve(language), metadata.join(", ")));
        let note = field.description.as_ref().map(|text| text.resolve(language)).unwrap_or_default();
        lines.push(format!("      {note}"));
    }
    lines
}

/// The field kind's wire spelling, which is what the legacy `help.fields` printed as a field's `type`.
fn wire_name(kind: FieldKind) -> &'static str {
    match kind {
        FieldKind::Text => "text",
        FieldKind::Multiline => "multiline",
        FieldKind::PathList => "path-list",
        FieldKind::Number => "number",
        FieldKind::Select => "select",
        FieldKind::Boolean => "boolean",
    }
}

/// The legacy page keeps one blank line between sections, never two, and never one at the end.
fn collapse_blank_runs(lines: Vec<String>) -> Vec<String> {
    let mut kept: Vec<String> = Vec::with_capacity(lines.len());
    for line in lines {
        if line.is_empty() && kept.last().is_some_and(|previous: &String| previous.is_empty()) {
            continue;
        }
        kept.push(line);
    }
    while kept.last().is_some_and(|line| line.is_empty()) {
        kept.pop();
    }
    kept
}
