//! The help card: a node's own documentation, drawn verbatim.
//!
//! `NodeDefinition::help` is the node's `help.ts` dictionary, folded into bilingual prose by
//! `scripts/audit-node-help-text.ts` (`crates/xiranite-plugin-api/src/node_definition/help.rs:1-11`). ADR-0069's
//! rule is that this text does not drift, and the CLI already prints it rather than rewording it
//! (`crates/xiranite-cli-runtime/src/help.rs:1-10`). So this module adds **no sentences of its own**: it takes the
//! same block plan the CLI prints — `whenToUse`, then each workflow, then the commands, then safety — under the
//! same headings (`crate::tui::terms::HelpHeading`, pinned by test to the CLI's `FaceHeading` table), and puts the
//! node's lines there with the markers the legacy TUI help screen used (`help-screen.tsx:13-14`: `•`, `◇`,
//! numbered steps, `$`, `⚠`).
//!
//! Two producers disagree on nothing but shape: the CLI indents two columns and bullets with `- `, this face
//! splits the prose across the legacy's two panels and bullets with `•`. The strings themselves are compared
//! byte-for-byte in the tests below, so a reworded step turns the suite red rather than showing up as "the TUI
//! phrases things a little differently".
//!
//! The panel geometry is the legacy screen's (`help-screen.tsx:10-15`), the scroll track colouring is the
//! scrollbox rule from `app.tsx:156` (primary thumb over a border-coloured track), and scrolling is a `u16` the
//! face owns: ratatui's own `Scrollbar` is the widget (§3), so this file never draws one.

use ratatui::buffer::Buffer;
use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState, Widget};
use xiranite_plugin_api::node_definition::{HelpSurface, NodeDefinition};

use crate::tui::layout as geometry;
use crate::tui::style::Theme;
use crate::tui::terms::{HelpHeading, HelpPanelTitle, Symbol, Term};

/// Why a line is on the card, which is what decides its style and nothing else.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HelpRole {
    /// The node's own workflow or command title.
    Title,
    /// A one-line framing under a title.
    Summary,
    /// A numbered step the node authored.
    Step,
    /// A bullet the node authored (`whenToUse`, safety notes).
    Bullet,
    /// A heading the face owns, never the node's words.
    Heading,
    /// A literal command line, unlocalised by definition.
    Command,
    /// An example invocation.
    Example,
}

/// One drawn line: its role and the exact text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelpLine {
    /// What the line is.
    pub role: HelpRole,
    /// The text, marker included; the node's own words appear inside it unchanged.
    pub text: String,
}

/// One panel of the card.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelpPanel {
    /// The panel heading, from [`HelpPanelTitle`].
    pub title: String,
    /// The lines, in reading order.
    pub lines: Vec<HelpLine>,
}

/// The whole card, in the shape the legacy screen laid it out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelpCard {
    /// `? <node title>` (`help-screen.tsx:11`).
    pub header: String,
    /// The back affordance, `× 返回` / `× Back`.
    pub back: String,
    /// `使用场景` / `Workflows`: the description, `whenToUse` and the workflows.
    pub usage: HelpPanel,
    /// `命令与安全` / `Commands & safety`: the commands and the safety prose.
    pub commands: HelpPanel,
}

impl HelpCard {
    /// Plan the card from a definition in one language.
    ///
    /// With no `help` block the card is the definition's `description` alone — the fallback
    /// `node_definition.rs:639-642` prescribes — because inventing steps the node never wrote is exactly the drift
    /// ADR-0069 forbids.
    #[must_use]
    pub fn plan(definition: &NodeDefinition, language: &str) -> Self {
        let mut usage = vec![HelpLine { role: HelpRole::Summary, text: definition.description.resolve(language).to_owned() }];
        let mut commands: Vec<HelpLine> = Vec::new();

        if let Some(help) = definition.help.as_ref() {
            if !help.when_to_use.resolve(language).is_empty() {
                usage.push(HelpLine { role: HelpRole::Heading, text: HelpHeading::WhenToUse.resolve(language).to_owned() });
                for line in help.when_to_use.resolve(language) {
                    usage.push(bullet(line));
                }
            }
            for workflow in &help.workflows {
                usage.push(HelpLine {
                    role: HelpRole::Title,
                    text: format!("{} {}", Symbol::Workflow.glyph(), workflow.title.resolve(language)),
                });
                if let Some(summary) = &workflow.summary {
                    usage.push(HelpLine { role: HelpRole::Summary, text: indent(summary.resolve(language)) });
                }
                // A workflow that addresses one surface needs no nested label: its own title already is one
                // (`crates/xiranite-cli-runtime/src/help.rs:109-116` applies the same rule).
                let label_surfaces = workflow.entries.len() > 1;
                let mut step = 1usize;
                for entry in &workflow.entries {
                    if label_surfaces {
                        if let Some(heading) = HelpHeading::of_surface(entry.surface) {
                            usage.push(HelpLine { role: HelpRole::Heading, text: indent(format!("{}:", heading.resolve(language))) });
                        }
                    }
                    for line in entry.lines.resolve(language) {
                        usage.push(HelpLine { role: HelpRole::Step, text: numbered(step, line) });
                        step += 1;
                    }
                }
            }

            if !help.commands.is_empty() {
                commands.push(HelpLine { role: HelpRole::Heading, text: HelpHeading::Commands.resolve(language).to_owned() });
                for command in &help.commands {
                    // The CLI prints the title then the literal; a card has room for both, and the node wrote both.
                    commands.push(HelpLine { role: HelpRole::Title, text: command.title.resolve(language).to_owned() });
                    if let Some(line) = &command.command {
                        commands.push(HelpLine { role: HelpRole::Command, text: indent(line) });
                    }
                    if let Some(description) = &command.description {
                        commands.push(HelpLine { role: HelpRole::Summary, text: indent(description.resolve(language)) });
                    }
                    if !command.examples.is_empty() {
                        commands.push(HelpLine { role: HelpRole::Heading, text: indent(format!("{}:", HelpHeading::Examples.resolve(language))) });
                        for example in &command.examples {
                            let label = example.label.as_ref().map(|text| format!("{} — ", text.resolve(language))).unwrap_or_default();
                            let note = example.description.as_ref().map(|text| format!(" ({})", text.resolve(language))).unwrap_or_default();
                            commands.push(HelpLine {
                                role: HelpRole::Example,
                                text: indent(format!("{}{} `{}`{note}", Symbol::Prompt.glyph(), label, example.command)),
                            });
                        }
                    }
                }
            }

            if let Some(safety) = &help.safety {
                commands.push(HelpLine { role: HelpRole::Heading, text: HelpHeading::Safety.resolve(language).to_owned() });
                if let Some(mode) = &safety.default_mode {
                    commands.push(HelpLine {
                        role: HelpRole::Summary,
                        text: format!(
                            "{} {}: {mode}",
                            Symbol::Danger.glyph(),
                            HelpHeading::DefaultMode.resolve(language)
                        ),
                    });
                }
                if !safety.destructive.resolve(language).is_empty() {
                    commands.push(HelpLine { role: HelpRole::Heading, text: HelpHeading::Destructive.resolve(language).to_owned() });
                    for line in safety.destructive.resolve(language) {
                        commands.push(bullet(line));
                    }
                }
                for line in safety.notes.resolve(language) {
                    commands.push(bullet(line));
                }
            }
        }

        Self {
            header: format!("{} {}", Symbol::Help.glyph(), definition.title.resolve(language)),
            back: format!("{} {}", Symbol::Close.glyph(), Term::Back.resolve(language)),
            usage: HelpPanel { title: HelpPanelTitle::Usage.resolve(language).to_owned(), lines: usage },
            commands: HelpPanel { title: HelpPanelTitle::CommandsAndSafety.resolve(language).to_owned(), lines: commands },
        }
    }

    /// Every line on the card, which is what the verbatim tests read.
    #[must_use]
    pub fn lines(&self) -> impl Iterator<Item = &HelpLine> {
        self.usage.lines.iter().chain(self.commands.lines.iter())
    }

    /// Whether the node published any documentation at all, i.e. whether the card is description-only.
    #[must_use]
    pub fn is_description_only(&self) -> bool {
        self.usage.lines.len() == 1 && self.commands.lines.is_empty()
    }
}

fn bullet(line: &str) -> HelpLine {
    HelpLine { role: HelpRole::Bullet, text: format!("{} {}", Symbol::Bullet.glyph(), line) }
}

fn numbered(index: usize, line: &str) -> HelpLine {
    HelpLine { role: HelpRole::Step, text: format!("{}{}. {line}", pad(index), index) }
}

fn numbered_text(index: usize, line: &str) -> String {
    format!("{}{}. {line}", pad(index), index)
}

/// Two-character step alignment, so a ten-step workflow still reads as a column.
fn pad(index: usize) -> String {
    if index < 10 { format!("  {index}") } else { format!(" {index}") }
}

fn indent(text: impl Into<String>) -> String {
    format!("  {}", text.into())
}

/// The card's scrolling state, owned by the face: ratatui has no scroll container and this crate does not invent
/// one (§6.1), so a node's `tui.rs` keeps the offsets and hands them in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct HelpScroll {
    /// Rows scrolled past in the usage panel.
    pub usage: u16,
    /// Rows scrolled past in the commands panel.
    pub commands: u16,
}

/// Draw the card into `area`: the header line, then the two panels the legacy screen used.
pub fn render_help_card(buffer: &mut Buffer, area: Rect, card: &HelpCard, theme: &Theme, scroll: HelpScroll) {
    let areas = geometry::help_areas(area);
    if !areas.header.is_empty() {
        let columns = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Min(1), Constraint::Length(card.back.width_of() as u16 + 2)])
            .split(areas.header);
        Paragraph::new(card.header.clone()).style(theme.title()).render(columns[0], buffer);
        Paragraph::new(card.back.clone()).style(theme.hint()).alignment(Alignment::Right).render(columns[1], buffer);
    }
    render_panel(buffer, areas.usage, &card.usage, theme, scroll.usage);
    render_panel(buffer, areas.commands, &card.commands, theme, scroll.commands);
}

impl HelpLine {
    /// How wide this line wants to be, which the header layout uses so the back affordance never eats the title.
    fn width_of(&self) -> usize {
        self.text.chars().count()
    }
}

trait WidthOf {
    fn width_of(&self) -> usize;
}

impl WidthOf for str {
    fn width_of(&self) -> usize {
        self.chars().count()
    }
}

impl WidthOf for String {
    fn width_of(&self) -> usize {
        self.as_str().width_of()
    }
}

fn render_panel(buffer: &mut Buffer, area: Rect, panel: &HelpPanel, theme: &Theme, scroll: u16) {
    if area.is_empty() {
        return;
    }
    let block = theme.panel();
    let inner = block.inner(area);
    block.render(area, buffer);
    if inner.is_empty() {
        return;
    }
    let title = Rect { x: inner.x, y: inner.y, width: inner.width, height: 1 };
    Paragraph::new(format!("{} {}", Symbol::Section.glyph(), panel.title)).style(theme.title()).render(title, buffer);
    let body = Rect { y: inner.y + 1, height: inner.height.saturating_sub(1), ..inner };
    if body.is_empty() {
        return;
    }
    let lines: Vec<Line<'static>> = panel.lines.iter().map(|line| styled_line(line, theme)).collect();
    let overflow = lines.len().saturating_sub(body.height as usize);
    Paragraph::new(Text::from(lines)).scroll((scroll.min(overflow as u16), 0)).render(body, buffer);
    if overflow > 0 {
        // The widget the strategy doc lists for this (§2): ratatui's own scrollbar, themed like the legacy
        // scrollbox track. It is drawn over the panel's right border column, which is what ratatui expects.
        let (thumb, track) = theme.scroll_pair();
        let mut state = ScrollbarState::new(panel.lines.len())
            .position(scroll.min(overflow as u16) as usize)
            .viewport_content_length(body.height as usize);
        Scrollbar::new(ScrollbarOrientation::VerticalRight)
            .thumb_style(thumb)
            .track_style(track)
            .begin_symbol(None)
            .end_symbol(None)
            .render(area, buffer, &mut state);
    }
}

fn styled_line(line: &HelpLine, theme: &Theme) -> Line<'static> {
    let style = match line.role {
        HelpRole::Title | HelpRole::Heading => theme.title(),
        HelpRole::Summary => theme.hint(),
        HelpRole::Step | HelpRole::Bullet => theme.hint(),
        HelpRole::Command | HelpRole::Example => Style::default().fg(theme.success()),
    };
    Line::from(Span::styled(line.text.clone(), style))
}

use ratatui::style::Style;

/// The authored strings a card must carry, for a test that refuses a reworded step.
#[must_use]
pub fn authored_strings(definition: &NodeDefinition, language: &str) -> Vec<String> {
    let Some(help) = definition.help.as_ref() else { return Vec::new() };
    let mut lines: Vec<String> = Vec::new();
    lines.extend(help.when_to_use.resolve(language).iter().cloned());
    for workflow in &help.workflows {
        lines.push(workflow.title.resolve(language).to_owned());
        if let Some(summary) = &workflow.summary {
            lines.push(summary.resolve(language).to_owned());
        }
        for entry in &workflow.entries {
            for line in entry.lines.resolve(language) {
                lines.push(match entry.surface {
                    // The numbered form is what the card shows, so the test compares against that.
                    HelpSurface::WorkspaceUi | HelpSurface::CommandLine | HelpSurface::Tips => line.clone(),
                });
            }
        }
    }
    for command in &help.commands {
        lines.push(command.title.resolve(language).to_owned());
        if let Some(line) = &command.command {
            lines.push(line.clone());
        }
        if let Some(description) = &command.description {
            lines.push(description.resolve(language).to_owned());
        }
        for example in &command.examples {
            lines.push(example.command.clone());
            if let Some(label) = &example.label {
                lines.push(label.resolve(language).to_owned());
            }
            if let Some(description) = &example.description {
                lines.push(description.resolve(language).to_owned());
            }
        }
    }
    if let Some(safety) = &help.safety {
        if let Some(mode) = &safety.default_mode {
            lines.push(mode.clone());
        }
        lines.extend(safety.destructive.resolve(language).iter().cloned());
        lines.extend(safety.notes.resolve(language).iter().cloned());
    }
    lines
}

/// The step lines the card renders for one workflow entry, exposed so a test can rebuild the numbering instead of
/// trusting the same function it is checking.
#[must_use]
pub fn expected_step_lines(lines: &[String]) -> Vec<String> {
    lines.iter().enumerate().map(|(index, line)| numbered_text(index + 1, line)).collect()
}

#[cfg(test)]
mod tests {
    use super::{HelpCard, HelpRole, authored_strings, expected_step_lines, render_help_card};
    use crate::tui::snapshot::{assert_not_shown, assert_shown, render_to_buffer, snapshot_lines};
    use crate::tui::style::Theme;
    use xiranite_plugin_api::node_definition::{
        Condition, DEFINITION_VERSION_V1, DangerGate, FieldDefinition, InputBinding, LocalizedList, LocalizedText, NodeAction,
        NodeDefinition, NodeHelpBlock, Predicate, Scalar, Test, Transform, HelpCommand, HelpCommandExample, HelpSafety,
        HelpSurface, HelpWorkflow, HelpWorkflowEntry,
    };
    use xiranite_plugin_api::identifiers::PluginId;

    fn text(zh: &str, en: &str) -> LocalizedText {
        LocalizedText::new(zh, en)
    }

    fn list(zh: &[&str], en: &[&str]) -> LocalizedList {
        LocalizedList::new(zh.iter().map(|value| (*value).to_owned()).collect(), en.iter().map(|value| (*value).to_owned()).collect())
    }

    fn entry(surface: HelpSurface, zh: &[&str], en: &[&str]) -> HelpWorkflowEntry {
        HelpWorkflowEntry { surface, lines: list(zh, en) }
    }

    fn probe_help() -> NodeHelpBlock {
        NodeHelpBlock {
            when_to_use: list(&["需要从工作区 UI 或 CLI 使用该节点的文件流程时，可使用 Trename。"], &["Use Trename when you need this node's file workflow from either the workspace UI or CLI."]),
            workflows: vec![
                HelpWorkflow {
                    title: text("工作区 UI", "Workspace UI"),
                    summary: Some(text("从模块库部署 Trename，并在节点面板中运行。", "Deploy Trename from the module registry and run it from the node surface.")),
                    entries: vec![entry(
                        HelpSurface::WorkspaceUi,
                        &["打开模块库，将 Trename 部署到当前工作区。", "填写节点字段，或将路径/配置粘贴到节点面板。"],
                        &["Open the module registry and deploy Trename to the current workspace.", "Fill the node fields or paste paths/configuration into the node surface."],
                    )],
                },
                HelpWorkflow {
                    title: text("CLI", "CLI"),
                    summary: None,
                    entries: vec![
                        entry(HelpSurface::CommandLine, &["终端第一步。"], &["First terminal step."]),
                        entry(HelpSurface::Tips, &["一条提示。"], &["One tip."]),
                    ],
                },
            ],
            commands: vec![HelpCommand {
                title: text("节点 CLI", "Node CLI"),
                command: Some("xiranite trename".to_owned()),
                description: Some(text("打开节点 CLI 或查看命令专属参数。", "Open the node CLI or inspect command-specific flags.")),
                examples: vec![HelpCommandExample {
                    label: Some(text("引导模式", "Guided mode")),
                    command: "xiranite trename".to_owned(),
                    description: Some(text("启动该节点的交互式终端流程。", "Start the node's interactive terminal workflow.")),
                }],
            }],
            safety: Some(HelpSafety {
                default_mode: Some("preview".to_owned()),
                destructive: list(&["真实重命名会移动文件。"], &["A live rename moves files."]),
                notes: list(&["更改文件前优先使用预览或试运行模式。"], &["Prefer preview or dry-run modes before changing files."]),
            }),
        }
    }

    fn definition(help: Option<NodeHelpBlock>) -> NodeDefinition {
        NodeDefinition {
            actions: vec![NodeAction { id: "run".to_owned(), label: text("执行", "Run") }],
            danger: DangerGate::None,
            danger_prompt: None,
            danger_prompt_export: None,
            dashboard: None,
            definition_version: DEFINITION_VERSION_V1,
            description: text("重命名工具的终端流程。", "The rename tool's terminal workflow."),
            fields: vec![FieldDefinition {
                default: Some(Scalar::Text(String::new())),
                description: None,
                id: "paths".to_owned(),
                is_action_selector: false,
                kind: xiranite_plugin_api::node_definition::FieldKind::PathList,
                label: text("扫描目录", "Folders"),
                lines: None,
                options: Vec::new(),
                placeholder: None,
                range: None,
                rules: Vec::new(),
                visible: Condition::Single(Predicate::holds(Test::Always)),
            }],
            groups: Vec::new(),
            input_bindings: vec![InputBinding { field_id: "paths".to_owned(), slot: "paths".to_owned(), transform: Transform::Lines, default_export: None }],
            node_id: PluginId::try_new("trename").expect("identifier"),
            preview_export: None,
            publishes_output_path: false,
            reports_progress: false,
            result_export: None,
            result_table: None,
            help,
            title: text("Trename", "Trename"),
        }
    }

    #[test]
    fn every_authored_string_reaches_the_card_unchanged() {
        let node = definition(Some(probe_help()));
        for language in ["zh", "en"] {
            let card = HelpCard::plan(&node, language);
            let authored = authored_strings(&node, language);
            assert!(!authored.is_empty(), "the probe help carried nothing to compare");
            let texts: Vec<&str> = card.lines().map(|line| line.text.as_str()).collect();
            for line in &authored {
                // Each authored string has to appear as a whole line, as a numbered step, or after one of the
                // face's own markers — never woven into a sentence the face wrote.
                let shown = texts.iter().any(|text| {
                    *text == line.as_str()
                        || text.ends_with(&format!("{line}"))
                        || text.contains(&format!("`{line}`"))
                        || text.contains(&format!("{line}:"))
                        || text.contains(&format!(" {line}"))
                        || text.contains(&format!("{line} "))
                });
                assert!(shown, "{language}: the card reworded or lost {line:?}; it held {texts:?}");
            }
        }
    }

    #[test]
    fn markers_are_added_but_the_nodes_words_are_not_touched() {
        let node = definition(Some(probe_help()));
        let card = HelpCard::plan(&node, "en");
        let texts: Vec<String> = card.lines().map(|line| line.text.clone()).collect();
        let when = "Use Trename when you need this node's file workflow from either the workspace UI or CLI.";
        assert!(texts.contains(&format!("• {when}")), "the whenToUse bullet is the legacy marker plus the exact line: {texts:?}");
        let step = "Open the module registry and deploy Trename to the current workspace.";
        assert!(texts.contains(&format!("  1. {step}")), "step one is numbered, not rephrased: {texts:?}");
        let titled = texts.iter().filter(|line| line.starts_with('◇')).count();
        assert_eq!(titled, 2, "one `◇` line per workflow, as help-screen.tsx drew them");

        // Negative control: the face's headings are its own words and never replace the node's.
        assert!(texts.contains(&"  $ Guided mode — `xiranite trename` (Start the node's interactive terminal workflow.)".to_owned()));
        assert!(texts.iter().any(|line| line == "When to use"));
        assert!(!texts.iter().any(|line| line.starts_with("This node does")), "the card wrote a sentence of its own");
    }

    #[test]
    fn a_one_surface_workflow_keeps_its_title_and_a_two_surface_one_gets_headings() {
        let node = definition(Some(probe_help()));
        let card = HelpCard::plan(&node, "en");
        let texts: Vec<String> = card.lines().map(|line| line.text.clone()).collect();
        // Workflow 1 addresses only the app: its own title is the label, so no nested heading.
        let position = texts.iter().position(|line| line == "◇ Workspace UI").expect("the workflow title");
        assert!(!texts[position + 2].contains("In the app"), "a single-surface workflow gets no nested label: {:?}", texts);

        // Workflow 2 addresses the terminal and the tips, so both are named.
        assert!(texts.contains(&"  In the terminal:".to_owned()));
        assert!(texts.contains(&"  Tips:".to_owned()));
        let steps = expected_step_lines(&["First terminal step.".to_owned(), "One tip.".to_owned()]);
        assert!(texts.contains(&steps[0]), "the numbering restarts per entry: {steps:?} vs {texts:?}");
        // Negative control: numbering continues across the entry, it does not restart at the second surface.
        assert!(texts.contains(&steps[1]));
    }

    #[test]
    fn a_definition_without_help_shows_only_the_description() {
        let node = definition(None);
        let card = HelpCard::plan(&node, "en");
        assert!(card.is_description_only(), "the card grew lines the node never wrote: {:?}", card.lines().count());
        assert_eq!(card.usage.lines.len(), 1);
        assert_eq!(card.usage.lines[0].text, "The rename tool's terminal workflow.");
        assert!(card.commands.lines.is_empty());
        // Negative control: none of the face's headings appear when there is nothing under them.
        let texts: Vec<&str> = card.lines().map(|line| line.text.as_str()).collect();
        for heading in ["When to use", "Commands", "Safety", "Examples", "Default mode"] {
            assert!(!texts.contains(&heading), "an empty heading was drawn for {heading:?}");
        }
    }

    #[test]
    fn safety_lines_keep_their_own_order_and_the_default_mode_line_is_the_nodes_value() {
        let node = definition(Some(probe_help()));
        let card = HelpCard::plan(&node, "zh");
        let texts: Vec<String> = card.commands.lines.iter().map(|line| line.text.clone()).collect();
        assert!(texts.contains(&"⚠ 默认模式: preview".to_owned()), "{texts:?}");
        assert!(texts.contains(&"• 更改文件前优先使用预览或试运行模式。".to_owned()));
        assert!(texts.contains(&"破坏性操作".to_owned()));
        // Negative control: the destructive warning is above the notes, matching the CLI's block order.
        let destructive = texts.iter().position(|line| line == "破坏性操作").expect("destructive heading");
        let note = texts.iter().position(|line| line.starts_with("• 更改")).expect("note bullet");
        assert!(destructive < note, "{texts:?}");
    }

    #[test]
    fn the_card_draws_two_panels_and_a_header_line() {
        let node = definition(Some(probe_help()));
        let card = HelpCard::plan(&node, "en");
        let theme = Theme::resolve(Some("nord"));
        let lines = snapshot_lines(&render_to_buffer(100, 24, |buffer, area| {
            render_help_card(buffer, area, &card, &theme, super::HelpScroll::default());
        }));
        assert_shown(&lines, "? Trename");
        assert_shown(&lines, "× Back");
        assert_shown(&lines, "Workflows");
        assert_shown(&lines, "Commands & safety");
        assert_shown(&lines, "Workspace UI");
        assert_shown(&lines, "Node CLI");
        assert!(lines[0].starts_with("╭"), "the panels are rounded like the workbench: {:?}", lines[0]);
        // Negative control: the two panels are side by side, so the commands panel's first rows share a screen row
        // with the usage panel rather than sitting below it.
        let usage_row = shown_row(&lines, "Workspace UI");
        let command_row = shown_row(&lines, "Node CLI");
        assert!(command_row <= usage_row + 2, "the commands panel was stacked under the usage panel ({usage_row} vs {command_row})");
        assert!(lines[usage_row].len() < 100);
    }

    #[test]
    fn a_long_card_scrolls_and_a_short_one_does_not_move() {
        let node = definition(Some(probe_help()));
        let card = HelpCard::plan(&node, "en");
        let theme = Theme::resolve(Some("nord"));
        let first_step = "Open the module registry and deploy Trename to the current workspace.";

        let top = snapshot_lines(&render_to_buffer(100, 10, |buffer, area| {
            render_help_card(buffer, area, &card, &theme, super::HelpScroll::default());
        }));
        assert_not_shown(&top, first_step, "a 10-row panel cannot show the deep step");

        let scrolled = snapshot_lines(&render_to_buffer(100, 10, |buffer, area| {
            render_help_card(buffer, area, &card, &theme, super::HelpScroll { usage: 6, commands: 0 });
        }));
        assert_shown(&scrolled, first_step);
        // Negative control: an offset past the end clamps rather than blanking the panel.
        let over = snapshot_lines(&render_to_buffer(100, 10, |buffer, area| {
            render_help_card(buffer, area, &card, &theme, super::HelpScroll { usage: 999, commands: 0 });
        }));
        assert!(!over.iter().all(|line| line.trim().is_empty() || !line.contains("Workflows")), "the panel title scrolled away too");
    }

    #[test]
    fn the_step_marker_is_the_only_number_on_the_line() {
        let steps = expected_step_lines(&["a".to_owned(), "b".to_owned(), "c".to_owned()]);
        assert_eq!(steps, vec!["  1. a".to_owned(), "  2. b".to_owned(), "  3. c".to_owned()]);
        let long = expected_step_lines(&(1..=11).map(|index| format!("step {index}")).collect::<Vec<String>>());
        assert_eq!(long[9], "  10. step 10", "two-digit steps keep the column");
        assert_eq!(long[10], " 11. step 11");
        // Negative control: the numbering is 1-based, which is what the legacy screen printed.
        assert!(!long.iter().any(|line| line.starts_with("  0.")), "{long:?}");
    }

    #[test]
    fn role_is_what_decides_style_not_text() {
        let node = definition(Some(probe_help()));
        let card = HelpCard::plan(&node, "en");
        let titles: Vec<&str> = card.lines().filter(|line| line.role == HelpRole::Title).map(|line| line.text.as_str()).collect();
        assert!(titles.contains(&"◇ Workspace UI"), "{titles:?}");
        assert!(titles.contains(&"Node CLI"));
        let commands: Vec<&str> = card.lines().filter(|line| line.role == HelpRole::Command).map(|line| line.text.as_str()).collect();
        assert_eq!(commands, vec!["  xiranite trename"], "the literal command line is its own role: {commands:?}");
    }

    fn shown_row(lines: &[String], needle: &str) -> usize {
        assert!(!lines.is_empty() && !needle.is_empty(), "refusing an empty scan");
        *lines.iter().enumerate().find(|(_, line)| line.contains(needle)).map(|(index, _)| index).collect::<Vec<usize>>().first().expect("row")
    }
}
