//! Turning a node's published help block into the lines a terminal prints.
//!
//! The content is the node's own (`definition.help`, derived from its `help.ts` by `audit:node-help-text`), and
//! nothing here rewrites it: this module only chooses an indentation and a bullet. That is what ADR-0069's
//! "help text does not drift" requires once the TypeScript workspace is gone — a node's `cli.rs` must not have
//! to author prose in Rust, and a face that paraphrased the node's steps would be a second source of truth.
//!
//! Only the section *headings* are the face's vocabulary, because a node's dictionary publishes none for them.
//! They are kept in one table here so the CLI and the TUI label the same block the same way, the same reason
//! the TUI's theme table is generated rather than retyped.

use xiranite_plugin_api::node_definition::{HelpSurface, NodeDefinition};

/// The headings a face puts above the node's prose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaceHeading {
    /// `help.whenToUse`.
    WhenToUse,
    /// The commands group, above one entry per `help.commands[]`.
    Commands,
    /// `help.safety`.
    Safety,
    /// The examples of one command.
    Examples,
    /// The steps of a workflow addressed to the app surface.
    InApp,
    /// The steps of a workflow addressed to the terminal.
    InTerminal,
    /// The steps of a workflow that apply to either.
    Advice,
    /// What the node does by default, above `safety.defaultMode`.
    DefaultMode,
    /// `safety.destructive`.
    Destructive,
}

impl FaceHeading {
    /// Both languages, because the node authored both and the session may be in either.
    #[must_use]
    pub const fn text(self) -> (&'static str, &'static str) {
        match self {
            Self::WhenToUse => ("何时使用", "When to use"),
            Self::Commands => ("命令", "Commands"),
            Self::Safety => ("安全", "Safety"),
            Self::Examples => ("示例", "Examples"),
            Self::InApp => ("应用内步骤", "In the app"),
            Self::InTerminal => ("终端步骤", "In the terminal"),
            Self::Advice => ("提示", "Tips"),
            Self::DefaultMode => ("默认模式", "Default mode"),
            Self::Destructive => ("破坏性操作", "Destructive"),
        }
    }

    /// The heading in the session language.
    #[must_use]
    pub fn resolve(self, language: &str) -> &'static str {
        let (zh, en) = self.text();
        if language == "en" { en } else { zh }
    }

    /// The workflow surface key's heading, or `None` for a surface the face does not label.
    #[must_use]
    pub fn of_surface(surface: HelpSurface) -> Option<Self> {
        match surface {
            HelpSurface::WorkspaceUi => Some(Self::InApp),
            HelpSurface::CommandLine => Some(Self::InTerminal),
            HelpSurface::Tips => Some(Self::Advice),
        }
    }
}

/// One rendered block: a heading and the node's lines under it, already indented.
///
/// The face decides how to place the blocks (clap's `long_help`, a TUI paragraph, a plain print), so lines
/// carry their own indentation and nothing here knows about a terminal width.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelpBlock {
    /// The block's title — the node's own workflow or command title, or a [`FaceHeading`].
    pub heading: String,
    /// The lines to print under it, in order.
    pub lines: Vec<String>,
}

/// The node's usage documentation, rendered for one language.
///
/// Empty when the node publishes no dictionary yet: a face then prints the definition's `description` and
/// stops, rather than inventing steps the node never wrote.
#[must_use]
pub fn help_blocks(definition: &NodeDefinition, language: &str) -> Vec<HelpBlock> {
    let Some(help) = definition.help.as_ref() else { return Vec::new() };
    let mut blocks = Vec::new();

    if !help.when_to_use.is_empty() {
        blocks.push(HelpBlock {
            heading: FaceHeading::WhenToUse.resolve(language).to_owned(),
            lines: indented(help.when_to_use.resolve(language)),
        });
    }

    for workflow in &help.workflows {
        let mut lines = Vec::new();
        if let Some(summary) = &workflow.summary {
            lines.push(format!("  {}", summary.resolve(language)));
        }
        for entry in &workflow.entries {
            let heading = FaceHeading::of_surface(entry.surface).map(|heading| heading.resolve(language));
            let steps = indented(entry.lines.resolve(language));
            match heading {
                // A single-surface workflow reads better without a nested label, and the node's own title is
                // already the block heading.
                Some(label) if workflow.entries.len() > 1 => {
                    lines.push(format!("  {label}:"));
                    lines.extend(steps.into_iter().map(|line| format!("  {line}")));
                }
                _ => lines.extend(steps),
            }
        }
        blocks.push(HelpBlock { heading: workflow.title.resolve(language).to_owned(), lines });
    }

    if !help.commands.is_empty() {
        let mut lines = Vec::new();
        for command in &help.commands {
            lines.push(format!("  {}", command.title.resolve(language)));
            if let Some(text) = &command.command {
                lines.push(format!("    {text}"));
            }
            if let Some(description) = &command.description {
                lines.push(format!("    {}", description.resolve(language)));
            }
            if !command.examples.is_empty() {
                lines.push(format!("    {}:", FaceHeading::Examples.resolve(language)));
                for example in &command.examples {
                    let label = example.label.as_ref().map(|text| format!("{} — ", text.resolve(language))).unwrap_or_default();
                    let note = example.description.as_ref().map(|text| format!(" ({})", text.resolve(language))).unwrap_or_default();
                    lines.push(format!("      {label}`{}`{note}", example.command));
                }
            }
        }
        blocks.push(HelpBlock { heading: FaceHeading::Commands.resolve(language).to_owned(), lines });
    }

    if let Some(safety) = &help.safety {
        let mut lines = Vec::new();
        if let Some(mode) = &safety.default_mode {
            lines.push(format!("  {}: {mode}", FaceHeading::DefaultMode.resolve(language)));
        }
        if !safety.destructive.is_empty() {
            lines.push(format!("  {}:", FaceHeading::Destructive.resolve(language)));
            lines.extend(indented(safety.destructive.resolve(language)).into_iter().map(|line| format!("  {line}")));
        }
        if !safety.notes.is_empty() {
            lines.extend(indented(safety.notes.resolve(language)));
        }
        blocks.push(HelpBlock { heading: FaceHeading::Safety.resolve(language).to_owned(), lines });
    }

    blocks
}

/// Every block as the text a terminal prints below the usage line.
#[must_use]
pub fn render_help(definition: &NodeDefinition, language: &str) -> String {
    let mut text = String::new();
    for block in help_blocks(definition, language) {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(block.heading.as_str());
        text.push('\n');
        for line in &block.lines {
            text.push_str(line);
            text.push('\n');
        }
    }
    text.trim_end().to_owned()
}

/// The node's lines as bullets, two columns in.
fn indented(lines: &[String]) -> Vec<String> {
    lines.iter().map(|line| format!("  - {line}")).collect()
}
