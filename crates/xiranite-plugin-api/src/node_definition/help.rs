//! The node's own usage documentation, as part of the published definition.
//!
//! This is `NodeHelp` from `packages/contract/src/index.ts` after `localizeNodeHelp` has folded the
//! `zh-CN` translation into the base fields: every string became a `{zh, en}` pair and every list a
//! `{zh: [], en: []}` pair. `scripts/audit-node-help-text.ts` derives the block from
//! `packages/nodes/<id>/src/help.ts` and fails when a definition stops quoting it, which is how ADR-0069's
//! "help text does not drift" holds once the Node/Bun workspace is gone: the terminal prints these lines
//! verbatim instead of re-authoring them in Rust.
//!
//! It lives apart from the rest of the definition because it is prose rather than behaviour — nothing in the
//! condition algebra reads it, and a face that only runs the node never touches it.

use super::LocalizedText;

/// The same prose in both languages, line by line: `whenToUse`, a workflow's steps, a safety note.
///
/// A list rather than one joined string because the faces lay the lines out differently — the CLI indents
/// them under a heading, the TUI puts them in a scrollable paragraph block — and joining here would force a
/// face to re-split text the node already authored as separate steps.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalizedList {
    /// Chinese lines, as authored.
    pub zh: Vec<String>,
    /// English lines, as authored.
    pub en: Vec<String>,
}

impl LocalizedList {
    /// Both language sides, in the order the node wrote them.
    #[must_use]
    pub fn new(zh: Vec<String>, en: Vec<String>) -> Self {
        Self { zh, en }
    }

    /// The lines for one language; anything but `"en"` selects Chinese, as [`LocalizedText::resolve`] does.
    #[must_use]
    pub fn resolve(&self, language: &str) -> &[String] {
        if language == "en" { &self.en } else { &self.zh }
    }

    /// True when neither side has a line, which a definition should not carry: the face would draw an empty
    /// heading.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.zh.is_empty() && self.en.is_empty()
    }

    /// True when one side has lines and the other has none — half a paragraph is as much a localization bug
    /// as half a label.
    #[must_use]
    pub fn has_missing_side(&self) -> bool {
        self.zh.is_empty() != self.en.is_empty()
    }

    /// True when neither side carries a blank line.
    ///
    /// The two sides are *not* required to have the same length. Each language is printed as the node authored
    /// it — measured on `classf`, whose Chinese command list is not the English list — and forcing one shape
    /// onto both would delete node-authored prose, which is the one thing this block exists to prevent. An
    /// entirely empty side is allowed too: `localizeNodeHelp` falls back to the base text when a translation
    /// omits a key, so the published pair then holds that base text twice rather than nothing.
    #[must_use]
    pub fn resolves_complete(&self) -> bool {
        self.zh.iter().chain(self.en.iter()).all(|line| !line.trim().is_empty())
    }
}

/// Which surface a help workflow's steps address — the `ui`/`cli`/`tips` keys of `NodeHelpWorkflow`
/// (`packages/contract/src/index.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HelpSurface {
    /// `ui`: how the node is used from the app surface.
    WorkspaceUi,
    /// `cli`: how the node is used from a terminal.
    CommandLine,
    /// `tips`: advice that applies to either.
    Tips,
}

impl HelpSurface {
    /// Every surface, in the order the TypeScript interface lists them.
    pub const ALL: [Self; 3] = [Self::WorkspaceUi, Self::CommandLine, Self::Tips];

    /// The `help.ts` key this came from, so a reader can trace a line back to its authoring site.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::WorkspaceUi => "ui",
            Self::CommandLine => "cli",
            Self::Tips => "tips",
        }
    }
}

/// One surface's lines inside a help workflow.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelpWorkflowEntry {
    /// Which face this entry is for.
    pub surface: HelpSurface,
    /// The steps, verbatim.
    pub lines: LocalizedList,
}

/// A way the node is used — `NodeHelpWorkflow` (`packages/contract/src/index.ts`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelpWorkflow {
    /// Heading, e.g. "Workspace UI" / "工作区 UI".
    pub title: LocalizedText,
    /// One-line framing under the heading.
    pub summary: Option<LocalizedText>,
    /// The steps per surface; a workflow may address both the app and the terminal.
    pub entries: Vec<HelpWorkflowEntry>,
}

/// A runnable example line — `NodeHelpExample`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelpCommandExample {
    /// What the example demonstrates ("Guided mode").
    pub label: Option<LocalizedText>,
    /// The literal command line, not localized: the shell accepts one spelling.
    pub command: String,
    /// What running it does.
    pub description: Option<LocalizedText>,
}

/// A command the node offers — `NodeHelpCommand`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelpCommand {
    /// Heading, e.g. "Node CLI".
    pub title: LocalizedText,
    /// The command itself; absent when the entry only collects examples.
    pub command: Option<String>,
    /// What the command is for.
    pub description: Option<LocalizedText>,
    /// Concrete invocations, in the order the node lists them.
    pub examples: Vec<HelpCommandExample>,
}

/// What the node does to the user's data by default — `NodeHelpSafety`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelpSafety {
    /// `preview`, `dry-run`, `guided`, `live`: the mode the node starts in.
    pub default_mode: Option<String>,
    /// What can be destroyed, so a face can put the warning above the run button.
    pub destructive: LocalizedList,
    /// Caveats the node wants the user to read first.
    pub notes: LocalizedList,
}

/// The node's own usage documentation, carried into the definition so a terminal can print `--help` without
/// the TypeScript workspace.
///
/// This is the `NodeHelp` of `packages/contract/src/index.ts` after `localizeNodeHelp` has folded the
/// `zh-CN` translation into the base fields, and every string is a `{zh, en}` pair: the English side comes
/// from the base fields and the Chinese side from `translations["zh-CN"]`.
/// `scripts/audit-node-help-text.ts` derives the block from the dictionary and fails if a definition's copy
/// stops being a quote of it, which is what lets the faces render help verbatim instead of rewording it
/// (ADR-0069: "help text does not drift").
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeHelpBlock {
    /// When the node is the right tool.
    pub when_to_use: LocalizedList,
    /// The workflows, in the order the node lists them.
    pub workflows: Vec<HelpWorkflow>,
    /// The commands, in the order the node lists them.
    pub commands: Vec<HelpCommand>,
    /// The safety prose, when the node authored any.
    pub safety: Option<HelpSafety>,
}

impl NodeHelpBlock {
    /// Owners inside the help block whose authored copy is incomplete, in reading order.
    ///
    /// A list's mistake is "half a paragraph" rather than "an empty string", so it is reported here instead
    /// of through [`crate::node_definition::LocalizedText::has_blank_side`]. An empty list is not a mistake:
    /// a node with nothing destructive to warn about publishes `{zh: [], en: []}`, and the face draws no
    /// heading for it.
    #[must_use]
    pub fn localization_problems(&self) -> Vec<String> {
        let mut problems = Vec::new();
        if !self.when_to_use.resolves_complete() {
            problems.push("help.whenToUse".to_owned());
        }
        for (index, workflow) in self.workflows.iter().enumerate() {
            if workflow.title.has_blank_side() {
                problems.push(format!("help.workflows[{index}].title"));
            }
            if workflow.summary.as_ref().is_some_and(LocalizedText::has_blank_side) {
                problems.push(format!("help.workflows[{index}].summary"));
            }
            for entry in &workflow.entries {
                if !entry.lines.resolves_complete() {
                    problems.push(format!("help.workflows[{index}].{}", entry.surface.as_str()));
                }
            }
        }
        for (index, command) in self.commands.iter().enumerate() {
            if command.title.has_blank_side() {
                problems.push(format!("help.commands[{index}].title"));
            }
            if command.description.as_ref().is_some_and(LocalizedText::has_blank_side) {
                problems.push(format!("help.commands[{index}].description"));
            }
            for (example_index, example) in command.examples.iter().enumerate() {
                if example.label.as_ref().is_some_and(LocalizedText::has_blank_side) {
                    problems.push(format!("help.commands[{index}].examples[{example_index}].label"));
                }
            }
        }
        if let Some(safety) = &self.safety {
            if !safety.destructive.resolves_complete() {
                problems.push("help.safety.destructive".to_owned());
            }
            if !safety.notes.resolves_complete() {
                problems.push("help.safety.notes".to_owned());
            }
        }
        problems
    }
}
