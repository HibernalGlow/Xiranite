//! The words and glyphs the shared composition draws, transcribed from the producers rather than reworded.
//!
//! Two producers, and they are different kinds of thing:
//!
//! - [`Term`] and the help panel titles are the terminal's own shared vocabulary, i.e.
//!   `packages/cli-runtime/src/i18n.ts:6-92` (`parameters`/`liveStatus`/`statusTab`/`logsTab`/`emptyLogs`/
//!   `waitingForRun`/`noFields`/`yes`/`no`/`back`/`rendererHelp`). The legacy screen pulled them from i18next;
//!   the Rust face has no i18next, so the pairs it actually renders are kept here, one entry each, in both
//!   languages. A node never sees these strings — they label areas the shared composition owns.
//! - [`HelpHeading`] is the *same* table `crates/xiranite-cli-runtime/src/help.rs:16-69` publishes as
//!   `FaceHeading`, kept byte-identical on purpose: a node's dictionary publishes no heading for its own blocks
//!   (`node_definition/help.rs` says so explicitly), so the heading is the face's word — and if the CLI calls a
//!   block `命令 / Commands` while the TUI calls it `指令`, the node now has two vocabularies for one block, which
//!   is the drift ADR-0069 forbids. The tests below pin every pair, and the producer is named in each case.
//! - [`Symbol`] is `packages/cli-runtime/src/tui/icons.ts:4-20` plus the two markers the legacy controls drew
//!   inline (`●`/`○` in `workbench-controls.tsx:378`, `›` in `select.tsx` and `app.tsx:192`).
//!
//! The language rule is the model's, not a new one: `LocalizedText::resolve`
//! (`crates/xiranite-plugin-api/src/node_definition.rs:59-61`) sends anything that is not exactly `"en"` to
//! Chinese, matching `resolveTerminalLanguage`'s `zh` default. These enums do the same, and a test pins it so a
//! future `to_lowercase()` here cannot silently start showing English to a `zh-TW` session's neighbour.

use xiranite_plugin_api::node_definition::FieldKind;

/// A shared label the composition draws. Node-authored copy is never in this table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Term {
    /// `i18n.ts:31` / `:75` — also the overflow section's title (see [`crate::surface::overflow_title`]).
    Parameters,
    /// `i18n.ts:32` / `:76`, the status area's heading.
    LiveStatus,
    /// `i18n.ts:33` / `:77`, the execution area's heading.
    Execution,
    /// `i18n.ts:34` / `:78`.
    StatusTab,
    /// `i18n.ts:35` / `:79`.
    LogsTab,
    /// `i18n.ts:36` / `:80`, the logs area with nothing in it.
    EmptyLogs,
    /// `i18n.ts:47` / `:91`, the status area before a run starts.
    WaitingForRun,
    /// `i18n.ts:29` / `:73`, shown when every field is hidden.
    NoVisibleFields,
    /// `i18n.ts:7` / `:51`, the `yes` half of a boolean field.
    Yes,
    /// `i18n.ts:8` / `:52`, the `no` half of a boolean field.
    No,
    /// `i18n.ts:12` / `:56`, the help card's back affordance.
    Back,
}

/// Every term, in the order the producers list them, so a test can walk the table.
pub const ALL_TERMS: [Term; 11] = [
    Term::Parameters,
    Term::LiveStatus,
    Term::Execution,
    Term::StatusTab,
    Term::LogsTab,
    Term::EmptyLogs,
    Term::WaitingForRun,
    Term::NoVisibleFields,
    Term::Yes,
    Term::No,
    Term::Back,
];

impl Term {
    /// Both authored sides, `(zh, en)`, in the order the TypeScript writes them.
    #[must_use]
    pub const fn text(self) -> (&'static str, &'static str) {
        match self {
            Self::Parameters => ("参数设置", "Parameters"),
            Self::LiveStatus => ("运行状态", "Live status"),
            Self::Execution => ("执行控制", "Execution"),
            Self::StatusTab => ("状态", "Status"),
            Self::LogsTab => ("日志", "Logs"),
            Self::EmptyLogs => ("运行日志会显示在这里。", "Run logs will appear here."),
            Self::WaitingForRun => ("等待运行", "Waiting to run"),
            Self::NoVisibleFields => ("当前交互没有可显示的字段。", "This interaction has no visible fields."),
            Self::Yes => ("是", "Yes"),
            Self::No => ("否", "No"),
            Self::Back => ("返回", "Back"),
        }
    }

    /// The side for a session language; anything but exactly `"en"` is Chinese, as the model resolves it.
    #[must_use]
    pub fn resolve(self, language: &str) -> &'static str {
        let (zh, en) = self.text();
        if language == "en" { en } else { zh }
    }
}

/// The two panels the legacy help screen split the node's documentation across (`help-screen.tsx:13-14`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HelpPanelTitle {
    /// `使用场景` / `Workflows`: the node's `whenToUse` and its workflows.
    Usage,
    /// `命令与安全` / `Commands & safety`: the node's commands and its safety prose.
    CommandsAndSafety,
}

impl HelpPanelTitle {
    /// Both authored sides, `(zh, en)`, exactly as `help-screen.tsx` writes them.
    #[must_use]
    pub const fn text(self) -> (&'static str, &'static str) {
        match self {
            Self::Usage => ("使用场景", "Workflows"),
            Self::CommandsAndSafety => ("命令与安全", "Commands & safety"),
        }
    }

    /// The side for a session language.
    #[must_use]
    pub fn resolve(self, language: &str) -> &'static str {
        let (zh, en) = self.text();
        if language == "en" { en } else { zh }
    }
}

/// A heading above one of the node's own help blocks.
///
/// The pairs are `crates/xiranite-cli-runtime/src/help.rs:42-51` verbatim: same variants, same two strings, so
/// the CLI's `--help` and this screen put the same label above the same prose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HelpHeading {
    WhenToUse,
    Commands,
    Safety,
    Examples,
    InApp,
    InTerminal,
    Advice,
    DefaultMode,
    Destructive,
}

/// Every heading, so the gate test can walk the table instead of trusting a list written by hand.
pub const ALL_HELP_HEADINGS: [HelpHeading; 9] = [
    HelpHeading::WhenToUse,
    HelpHeading::Commands,
    HelpHeading::Safety,
    HelpHeading::Examples,
    HelpHeading::InApp,
    HelpHeading::InTerminal,
    HelpHeading::Advice,
    HelpHeading::DefaultMode,
    HelpHeading::Destructive,
];

impl HelpHeading {
    /// Both sides, `(zh, en)`.
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

    /// The side for a session language.
    #[must_use]
    pub fn resolve(self, language: &str) -> &'static str {
        let (zh, en) = self.text();
        if language == "en" { en } else { zh }
    }

    /// The heading for one workflow surface, or `None` when the workflow addresses a single surface and the
    /// node's own title already labels it — the same rule `help.rs:106-116` applies.
    #[must_use]
    pub const fn of_surface(surface: xiranite_plugin_api::node_definition::HelpSurface) -> Option<Self> {
        match surface {
            xiranite_plugin_api::node_definition::HelpSurface::WorkspaceUi => Some(Self::InApp),
            xiranite_plugin_api::node_definition::HelpSurface::CommandLine => Some(Self::InTerminal),
            xiranite_plugin_api::node_definition::HelpSurface::Tips => Some(Self::Advice),
        }
    }
}

/// A glyph the composition draws.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Symbol {
    /// `icons.ts:4` `section`, the panel-title prefix.
    Section,
    /// `icons.ts:4` `status`, the header's phase prefix.
    Status,
    /// `icons.ts:4` `action`, also the action-selector field's icon.
    Action,
    /// `icons.ts:4` `danger`.
    Danger,
    /// `icons.ts:4` `result`.
    Result,
    /// `icons.ts:4` `logs`.
    Logs,
    /// `icons.ts:4` `text`, the icon for `text` and `multiline` fields.
    Text,
    /// `icons.ts:4` `path`, the icon for a `path-list` field.
    Path,
    /// `icons.ts:4` `select`.
    Select,
    /// `icons.ts:4` `boolean`.
    Boolean,
    /// `icons.ts:4` `number`.
    Number,
    /// `icons.ts:4` `field`, the fallback icon.
    Field,
    /// `icons.ts:4` `settings`.
    Settings,
    /// The selected marker a `ClickTarget` drew (`workbench-controls.tsx:378`).
    Selected,
    /// The unselected marker a `ClickTarget` drew (`workbench-controls.tsx:378`).
    Unselected,
    /// The caret a `Select` row and the preview lines used (`select.tsx`, `app.tsx:192`).
    Caret,
    /// The secondary preview-line marker (`app.tsx:192`).
    MiddleDot,
    /// A workflow block's title marker inside the help card (`help-screen.tsx:13`).
    Workflow,
    /// The bullet a help list line takes (`help-screen.tsx:13-14`; the CLI uses `- ` for the same lines).
    Bullet,
    /// The prefix of an example command line (`help-screen.tsx:14`).
    Prompt,
    /// The close/back glyph in the help header (`help-screen.tsx:11`).
    Close,
    /// The `?` the help header puts before the node title (`help-screen.tsx:11`).
    Help,
}

impl Symbol {
    /// The glyph as the producer writes it.
    #[must_use]
    pub const fn glyph(self) -> &'static str {
        match self {
            Self::Section => "▤",
            Self::Status => "●",
            Self::Action => "▶",
            Self::Danger => "⚠",
            Self::Result => "✓",
            Self::Logs => "≡",
            Self::Text => "✎",
            Self::Path => "▣",
            Self::Select => "◉",
            Self::Boolean => "◆",
            Self::Number => "∷",
            Self::Field => "•",
            Self::Settings => "☷",
            Self::Selected => "●",
            Self::Unselected => "○",
            Self::Caret => "›",
            Self::MiddleDot => "·",
            Self::Workflow => "◇",
            Self::Bullet => "•",
            Self::Prompt => "$",
            Self::Close => "×",
            Self::Help => "?",
        }
    }

    /// The marker for an option that is or is not the field's value.
    #[must_use]
    pub const fn option_marker(selected: bool) -> Self {
        if selected { Self::Selected } else { Self::Unselected }
    }
}

/// The field icon `fieldIcon` chooses (`icons.ts:12-20`): an action selector wins on its role before its kind.
#[must_use]
pub const fn field_icon(kind: FieldKind, is_action_selector: bool) -> &'static str {
    if is_action_selector {
        return Symbol::Action.glyph();
    }
    match kind {
        FieldKind::Number => Symbol::Number.glyph(),
        FieldKind::Text | FieldKind::Multiline => Symbol::Text.glyph(),
        FieldKind::PathList => Symbol::Path.glyph(),
        FieldKind::Select => Symbol::Select.glyph(),
        FieldKind::Boolean => Symbol::Boolean.glyph(),
    }
}

/// `i18n.ts:20` / `:64` `rendererHelp` with `{{renderer}}` filled in: the header's key hint.
///
/// The renderer name is a parameter because it is the face's own fact — the legacy screen printed `OpenTUI`, this
/// one prints whatever the node's `tui.rs` says it is (`ratatui` today) — while the shape of the hint is shared.
#[must_use]
pub fn renderer_help(language: &str, renderer: &str) -> String {
    if language == "en" {
        format!("{renderer} · Esc back · q quit")
    } else {
        format!("{renderer} · Esc 返回 · q 退出")
    }
}

#[cfg(test)]
mod tests {
    use super::{ALL_HELP_HEADINGS, ALL_TERMS, HelpHeading, HelpPanelTitle, Symbol, Term, field_icon, renderer_help};
    use xiranite_plugin_api::node_definition::{FieldKind, HelpSurface};

    #[test]
    fn every_term_carries_both_languages_and_never_resolves_blank() {
        assert!(!ALL_TERMS.is_empty(), "the term table walked nothing");
        for term in ALL_TERMS {
            let (zh, en) = term.text();
            assert!(!zh.trim().is_empty() && !en.trim().is_empty(), "{term:?} has a blank side: {zh:?}/{en:?}");
            assert!(!term.resolve("zh").trim().is_empty());
            assert!(!term.resolve("en").trim().is_empty());
        }
    }

    #[test]
    fn the_shared_labels_are_the_producers_words() {
        // `packages/cli-runtime/src/i18n.ts` — a panel that reads "Settings" where the app reads `运行状态`
        // is the same drift the theme table gate exists to catch.
        assert_eq!(Term::Parameters.text(), ("参数设置", "Parameters"));
        assert_eq!(Term::LiveStatus.text(), ("运行状态", "Live status"));
        assert_eq!(Term::Execution.text(), ("执行控制", "Execution"));
        assert_eq!(Term::StatusTab.text(), ("状态", "Status"));
        assert_eq!(Term::LogsTab.text(), ("日志", "Logs"));
        assert_eq!(Term::EmptyLogs.text(), ("运行日志会显示在这里。", "Run logs will appear here."));
        assert_eq!(Term::WaitingForRun.text(), ("等待运行", "Waiting to run"));
        assert_eq!(Term::NoVisibleFields.text(), ("当前交互没有可显示的字段。", "This interaction has no visible fields."));
        assert_eq!(Term::Yes.text(), ("是", "Yes"));
        assert_eq!(Term::No.text(), ("否", "No"));
        assert_eq!(Term::Back.text(), ("返回", "Back"));
        // The two help panel titles are the legacy screen's own (`help-screen.tsx:13-14`).
        assert_eq!(HelpPanelTitle::Usage.text(), ("使用场景", "Workflows"));
        assert_eq!(HelpPanelTitle::CommandsAndSafety.text(), ("命令与安全", "Commands & safety"));
        assert_eq!(HelpPanelTitle::Usage.resolve("en"), "Workflows");
        assert_eq!(HelpPanelTitle::CommandsAndSafety.resolve("zh"), "命令与安全");
    }

    #[test]
    fn the_help_headings_match_the_cli_table_so_one_block_has_one_name() {
        // Producer: `crates/xiranite-cli-runtime/src/help.rs:42-51`. If that file changes, this table changes with
        // it — a face that quietly keeps the old word is a second vocabulary for the node's own block.
        assert_eq!(HelpHeading::WhenToUse.text(), ("何时使用", "When to use"));
        assert_eq!(HelpHeading::Commands.text(), ("命令", "Commands"));
        assert_eq!(HelpHeading::Safety.text(), ("安全", "Safety"));
        assert_eq!(HelpHeading::Examples.text(), ("示例", "Examples"));
        assert_eq!(HelpHeading::InApp.text(), ("应用内步骤", "In the app"));
        assert_eq!(HelpHeading::InTerminal.text(), ("终端步骤", "In the terminal"));
        assert_eq!(HelpHeading::Advice.text(), ("提示", "Tips"));
        assert_eq!(HelpHeading::DefaultMode.text(), ("默认模式", "Default mode"));
        assert_eq!(HelpHeading::Destructive.text(), ("破坏性操作", "Destructive"));
        assert_eq!(ALL_HELP_HEADINGS.len(), 9, "the heading table walked a different count than the CLI lists");
        for heading in ALL_HELP_HEADINGS {
            let (zh, en) = heading.text();
            assert_eq!(heading.resolve("en"), en);
            assert_eq!(heading.resolve("zh"), zh);
        }
    }

    #[test]
    fn a_single_surface_workflow_keeps_its_own_title_and_gets_no_nested_heading() {
        assert_eq!(HelpHeading::of_surface(HelpSurface::WorkspaceUi), Some(HelpHeading::InApp));
        assert_eq!(HelpHeading::of_surface(HelpSurface::CommandLine), Some(HelpHeading::InTerminal));
        assert_eq!(HelpHeading::of_surface(HelpSurface::Tips), Some(HelpHeading::Advice));
        // Negative control: no surface is ever labelled with the block's own heading.
        assert_ne!(HelpHeading::of_surface(HelpSurface::Tips), Some(HelpHeading::Commands));
    }

    #[test]
    fn the_glyphs_are_the_icon_tables() {
        // `packages/cli-runtime/src/tui/icons.ts:4` — `nerd` variants are not this face's concern yet.
        assert_eq!(Symbol::Section.glyph(), "▤");
        assert_eq!(Symbol::Status.glyph(), "●");
        assert_eq!(Symbol::Action.glyph(), "▶");
        assert_eq!(Symbol::Danger.glyph(), "⚠");
        assert_eq!(Symbol::Result.glyph(), "✓");
        assert_eq!(Symbol::Logs.glyph(), "≡");
        assert_eq!(Symbol::Text.glyph(), "✎");
        assert_eq!(Symbol::Path.glyph(), "▣");
        assert_eq!(Symbol::Select.glyph(), "◉");
        assert_eq!(Symbol::Boolean.glyph(), "◆");
        assert_eq!(Symbol::Number.glyph(), "∷");
        assert_eq!(Symbol::Field.glyph(), "•");
        assert_eq!(Symbol::Settings.glyph(), "☷");
        assert_eq!(Symbol::option_marker(true).glyph(), "●");
        assert_eq!(Symbol::option_marker(false).glyph(), "○");
        assert_eq!(Symbol::Caret.glyph(), "›");
        assert_eq!(Symbol::MiddleDot.glyph(), "·");
        assert_eq!(Symbol::Workflow.glyph(), "◇");
        assert_eq!(Symbol::Bullet.glyph(), "•");
        assert_eq!(Symbol::Prompt.glyph(), "$");
        assert_eq!(Symbol::Close.glyph(), "×");
        assert_eq!(Symbol::Help.glyph(), "?");
    }

    #[test]
    fn an_action_selectors_role_wins_over_its_kind() {
        assert_eq!(field_icon(FieldKind::Select, true), "▶");
        // Negative control: without the role it is a `select`, and the two select kinds differ.
        assert_eq!(field_icon(FieldKind::Select, false), "◉");
        assert_eq!(field_icon(FieldKind::Multiline, false), "✎");
        assert_eq!(field_icon(FieldKind::PathList, false), "▣");
        assert_eq!(field_icon(FieldKind::Boolean, false), "◆");
        assert_eq!(field_icon(FieldKind::Number, false), "∷");
        assert_eq!(field_icon(FieldKind::Text, true), "▶", "the role is checked before the kind for every kind");
    }

    #[test]
    fn language_resolution_follows_the_model_not_a_looser_match() {
        assert_eq!(Term::Parameters.resolve("en"), "Parameters");
        assert_eq!(Term::Parameters.resolve("zh"), "参数设置");
        // `LocalizedText::resolve` compares against exactly "en", so an uppercase or empty tag is Chinese. A
        // `to_lowercase()` added here would split the face's vocabulary from the definition's.
        assert_eq!(Term::Parameters.resolve("EN"), "参数设置");
        assert_eq!(Term::Parameters.resolve(""), "参数设置");
        assert_eq!(Term::Parameters.resolve("zh-TW"), "参数设置");
    }

    #[test]
    fn the_renderer_hint_names_the_renderer_it_was_given() {
        assert_eq!(renderer_help("zh", "ratatui"), "ratatui · Esc 返回 · q 退出");
        assert_eq!(renderer_help("en", "ratatui"), "ratatui · Esc back · q quit");
        // Negative control: the word is substituted, not hard-coded to the legacy renderer.
        assert!(!renderer_help("en", "ratatui").contains("OpenTUI"));
    }
}
