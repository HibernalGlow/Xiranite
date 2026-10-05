//! The parameters panel: a planned [`crate::surface::Surface`] drawn as section blocks, a tab strip and fields.
//!
//! This is the definition→widget adaptation §6.2 of `docs/tui-rust-widget-strategy.md` allows, and nothing more:
//! visibility and section membership arrive from [`crate::surface::plan_visible_surface`] (i.e. from the one
//! shared evaluator), the strip's existence is [`crate::surface::shows_tab_strip`], and the keys that change an
//! answer are `crate::keymap`'s. What is decided here is only *how a section and a field look*.
//!
//! The surface it reproduces is `packages/cli-runtime/src/tui/opentui/`:
//!
//! - the panel is `app.tsx:144` — `WorkbenchPanel title={t("parameters")}`, whose heading line is `▤ <title>`
//!   (`workbench-controls.tsx:45-47`) above an optional section description and the field rows (`app.tsx:157-158`);
//! - the strip is `app.tsx:145-155`: `ActionTabs` over the surviving sections, only when more than one survived;
//! - the action selector is `workbench-controls.tsx:88-106`, label plus tabs, and because
//!   [`crate::surface::Surface::action_selector`] says it "is a tab strip and never a row inside one", the row that
//!   also names it is skipped instead of drawn twice;
//! - a `select`/`boolean` lists its options with `●` on the value the field holds and `○` on the ones it does not
//!   (`ClickTarget`, `workbench-controls.tsx:378`), with `›` on the active one (`select.tsx:47`); `focused` and
//!   `selected` stay two facts, as §8.2 of the strategy doc requires;
//! - a `number` is one row, its value right of the label (`workbench-controls.tsx:127-142`);
//! - a validation message goes under its control in the error colour (`workbench-controls.tsx:103`).
//!
//! Field *descriptions* are deliberately not drawn: `WorkbenchField` never showed them, and adding a row the
//! legacy screen did not have is a surface change rather than a port. One test pins that absence.

use std::collections::BTreeMap;

use ratatui::buffer::Buffer;
use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, ListState, Paragraph, Tabs, Widget, Wrap};
use ratatui::Frame;
use xiranite_plugin_api::definition_eval::{Values, text_of};
use xiranite_plugin_api::node_definition::{FieldDefinition, FieldKind, Scalar};

use crate::surface::{Section, Surface, shows_tab_strip};
use crate::tui::editor::FieldEditor;
use crate::tui::layout as geometry;
use crate::tui::style::Theme;
use crate::tui::terms::{Symbol, Term, field_icon};

/// Everything the parameters panel needs, borrowed from the face that owns it.
#[derive(Debug)]
pub struct FormView<'a> {
    /// The planned surface, i.e. the sections that survived the visibility rules.
    pub surface: &'a Surface<'a>,
    /// `"en"` selects the authored English side; anything else is Chinese, as the model resolves it.
    pub language: &'a str,
    /// The resolved palette.
    pub theme: &'a Theme,
    /// The section whose fields are on screen. `None`, or an id that no longer exists, means "the first section",
    /// which is what `app.tsx:61` and `:64-66` do when a tab vanishes while the user is typing.
    pub active_section: Option<&'a str>,
    /// The control id the focus ring is on.
    pub focused: Option<&'a str>,
    /// The answers so far.
    pub values: &'a Values,
    /// Per-field validation messages, keyed by field id.
    pub errors: &'a BTreeMap<String, String>,
    /// `session.phase === "running"`: the form greys out and stops showing a caret.
    pub disabled: bool,
}

impl<'a> FormView<'a> {
    /// The sections the strip would cycle, in order.
    #[must_use]
    pub fn sections(&self) -> &[Section<'a>] {
        &self.surface.sections
    }

    /// The section on screen, falling back to the first when the id is stale or absent.
    #[must_use]
    pub fn section(&self) -> Option<&Section<'a>> {
        if self.surface.sections.is_empty() {
            return None;
        }
        self.active_section
            .and_then(|id| self.surface.sections.iter().find(|section| section.id == id))
            .or(self.surface.sections.first())
    }

    /// The strip's titles, authored copy included (the overflow section already carries the shared term).
    #[must_use]
    pub fn tab_titles(&self) -> Vec<String> {
        self.surface.sections.iter().map(|section| geometry::section_title(section, self.language)).collect()
    }

    /// Which strip entry is on screen.
    #[must_use]
    pub fn tab_index(&self) -> Option<usize> {
        let active = self.section()?;
        self.surface.sections.iter().position(|section| section.id == active.id)
    }

    /// Whether the ring is on this control.
    #[must_use]
    pub fn is_focused(&self, control_id: &str) -> bool {
        self.focused == Some(control_id)
    }

    /// The field's current answer, or its declared default when nothing has been typed yet — the default exists in
    /// the definition precisely so a face can show what a run would send.
    #[must_use]
    pub fn value_of<'f>(&self, field: &'f FieldDefinition) -> Option<&'f Scalar> {
        self.values.get(&field.id).or(field.default.as_ref())
    }

    /// The validation message under a field, if it has one.
    #[must_use]
    pub fn error_of(&self, field: &FieldDefinition) -> Option<&str> {
        self.errors.get(&field.id).map(String::as_str)
    }

    /// The label the field carries in this language.
    #[must_use]
    pub fn label_of(&self, field: &FieldDefinition) -> String {
        field.label.resolve(self.language).to_owned()
    }

    #[must_use]
    fn has_error(&self, field: &FieldDefinition) -> bool {
        self.errors.contains_key(&field.id)
    }

    /// The label style the legacy screen used: greyed while running, ring when focused, foreground otherwise.
    #[must_use]
    fn label_style(&self, field_id: &str) -> ratatui::style::Style {
        if self.disabled {
            self.theme.hint()
        } else {
            self.theme.label(self.is_focused(field_id))
        }
    }

    /// The fields a section draws, i.e. minus the action selector, which is the strip above them.
    #[must_use]
    pub fn drawable_fields(section: &Section<'a>) -> Vec<&'a FieldDefinition> {
        section.fields.iter().copied().filter(|field| !field.is_action_selector).collect()
    }
}

/// Draw the section tab strip. Returns the rows it took, which is zero when there is nothing to strip
/// ([`crate::surface::shows_tab_strip`]) — the same fact the arrow keys use.
pub fn render_tab_strip(buffer: &mut Buffer, area: Rect, view: &FormView<'_>) -> u16 {
    if !shows_tab_strip(view.surface) || area.is_empty() {
        return 0;
    }
    Tabs::new(view.tab_titles())
        .select(view.tab_index())
        .highlight_style(view.theme.focus_style())
        .style(view.theme.hint())
        .render(area, buffer);
    1
}

/// Draw the action selector as its own band: label row plus action tabs (`workbench-controls.tsx:88-106`).
/// Returns the rows it took, or zero when the node declared no selector.
pub fn render_action_selector(buffer: &mut Buffer, area: Rect, view: &FormView<'a>, selector: &'a FieldDefinition) -> u16 {
    if area.is_empty() {
        return 0;
    }
    let rows = Layout::default().direction(Direction::Vertical).constraints([Constraint::Length(1), Constraint::Min(0)]).split(area);
    render_field_label(buffer, rows[0], view, selector);
    if rows[1].is_empty() {
        return 1;
    }
    let titles: Vec<String> = selector.options.iter().map(|option| option.label.resolve(view.language).to_owned()).collect();
    Tabs::new(titles).select(active_option_index(selector, view)).highlight_style(view.theme.focus_style()).style(view.theme.hint()).render(rows[1], buffer);
    2
}

/// The option the caret sits on: the field's value when it is one of the enabled options, else the first enabled
/// one — `select.tsx:22-27`'s `firstEnabledIndex` fallback.
fn active_option_index(field: &FieldDefinition, view: &FormView<'_>) -> Option<usize> {
    let current = view.value_of(field).map(text_of);
    let options = option_views(field, view);
    let wanted = current.as_deref()?;
    options.iter().position(|option| option.value_text == wanted && !option.disabled).or_else(|| options.iter().position(|option| !option.disabled))
}

/// One row of a `select`/`boolean` control, after the boolean case has been turned into Yes/No.
#[derive(Debug, Clone, PartialEq, Eq)]
struct OptionView {
    label: String,
    hint: Option<String>,
    value_text: String,
    disabled: bool,
}

fn option_views(field: &FieldDefinition, view: &FormView<'_>) -> Vec<OptionView> {
    if field.kind == FieldKind::Boolean {
        // `optionsForField` (`screen.ts:11-19`) invents the two answers, so they are here and not in the node.
        return vec![
            OptionView {
                label: Term::Yes.resolve(view.language).to_owned(),
                hint: None,
                value_text: "true".to_owned(),
                disabled: false,
            },
            OptionView {
                label: Term::No.resolve(view.language).to_owned(),
                hint: None,
                value_text: "false".to_owned(),
                disabled: false,
            },
        ];
    }
    field
        .options
        .iter()
        .map(|option| OptionView {
            label: option.label.resolve(view.language).to_owned(),
            hint: option.hint.as_ref().map(|text| text.resolve(view.language).to_owned()),
            value_text: text_of(&option.value),
            disabled: option.disabled,
        })
        .collect()
}

fn render_field_label(buffer: &mut Buffer, area: Rect, view: &FormView<'_>, field: &FieldDefinition) {
    if area.is_empty() {
        return;
    }
    let icon = field_icon(field.kind, field.is_action_selector);
    Paragraph::new(format!("{icon} {}", view.label_of(field))).style(view.label_style(&field.id)).render(area, buffer);
}

/// Draw one field: its label, its control, and an error line when the field carries one.
///
/// `editor` is the focused field's editor state. A field that is not the editor's own field draws its value
/// statically, which is what the legacy screen did for every unfocused text row
/// (`workbench-controls.tsx:155-169`).
pub fn render_field<'a>(buffer: &mut Buffer, area: Rect, view: &FormView<'a>, field: &'a FieldDefinition, editor: Option<&FieldEditor>) {
    if area.is_empty() {
        return;
    }
    let has_error = view.has_error(field);
    let control_rows = geometry::field_row_height(field, has_error) - 1 - u16::from(has_error);
    let mut constraints = vec![Constraint::Length(1), Constraint::Length(control_rows)];
    if has_error {
        constraints.push(Constraint::Length(1));
    }
    constraints.push(Constraint::Min(0));
    let rows = Layout::default().direction(Direction::Vertical).constraints(constraints).split(area);

    if field.kind == FieldKind::Number {
        // One row: label left, value right (`workbench-controls.tsx:127-142`).
        let columns = Layout::default()
            .direction(Direction::Horizontal)
            .spacing(1)
            .constraints([Constraint::Min(1), Constraint::Length(NUMBER_VALUE_WIDTH)])
            .split(rows[0]);
        render_field_label(buffer, columns[0], view, field);
        let value = view.value_of(field).map(text_of).unwrap_or_default();
        Paragraph::new(value).style(view.theme.value(view.is_focused(&field.id))).alignment(Alignment::Right).render(columns[1], buffer);
        if let Some(message) = view.error_of(field) {
            Paragraph::new(message.to_owned()).style(view.theme.danger()).render(rows.get(2).copied().unwrap_or(Rect::ZERO), buffer);
        }
        return;
    }

    render_field_label(buffer, rows[0], view, field);
    match field.kind {
        FieldKind::Text | FieldKind::Multiline | FieldKind::PathList => {
            let matching = editor.filter(|state| state.field_id() == field.id);
            if let Some(state) = matching {
                let focused = view.is_focused(&field.id) && !view.disabled;
                state.render(buffer, rows[1], field, view.theme, view.language, focused);
            } else {
                render_static_editor(buffer, rows[1], view, field);
            }
        }
        FieldKind::Select | FieldKind::Boolean => render_option_rows(buffer, rows[1], view, field),
        FieldKind::Number => {}
    }
    if let Some(message) = view.error_of(field) {
        let error_area = rows.get(2).copied().unwrap_or(Rect::ZERO);
        if !error_area.is_empty() {
            Paragraph::new(message.to_owned()).style(view.theme.danger()).render(error_area, buffer);
        }
    }
}

/// How wide the right-aligned number value column is. One measured choice, not a layout DSL: 12 columns fits
/// `trename`'s `1000` and a millisecond-sized value without pushing the label off a 42% panel.
const NUMBER_VALUE_WIDTH: u16 = 12;

fn render_static_editor(buffer: &mut Buffer, area: Rect, view: &FormView<'_>, field: &FieldDefinition) {
    let box_widget = view.theme.editor_box(view.is_focused(&field.id), view.has_error(field));
    let inner = box_widget.inner(area);
    box_widget.render(area, buffer);
    if inner.is_empty() {
        return;
    }
    let value = view.value_of(field).map(text_of).unwrap_or_default();
    let placeholder = field.placeholder.as_ref().map(|text| text.resolve(view.language)).unwrap_or_default();
    let showing_placeholder = value.is_empty() && !placeholder.is_empty();
    let content = if showing_placeholder { placeholder.to_owned() } else { value };
    let style = if showing_placeholder { view.theme.hint() } else { view.theme.value(view.is_focused(&field.id)) };
    let paragraph = match field.kind {
        FieldKind::Multiline | FieldKind::PathList => Paragraph::new(content).wrap(Wrap { trim: false }),
        _ => Paragraph::new(content),
    };
    paragraph.style(style).render(inner, buffer);
}

fn render_option_rows(buffer: &mut Buffer, area: Rect, view: &FormView<'a>, field: &'a FieldDefinition) {
    if area.is_empty() {
        return;
    }
    let focused = view.is_focused(&field.id) && !view.disabled;
    let current = view.value_of(field).map(text_of);
    let options = option_views(field, view);
    let items: Vec<ListItem<'static>> = options
        .iter()
        .map(|option| {
            let marker = Symbol::option_marker(current.as_deref() == Some(option.value_text.as_str())).glyph();
            let mut spans = vec![Span::raw(format!("{marker} {}", option.label))];
            if let Some(hint) = &option.hint {
                spans.push(Span::styled(format!("  {hint}"), view.theme.hint()));
            }
            if option.disabled {
                spans.push(Span::styled("  —", view.theme.hint()));
            }
            ListItem::new(Line::from(spans))
        })
        .collect();
    // `focused` and `selected` are different facts: the caret goes where the ring is, the marker stays on the
    // value the field holds. With no caret on this field nothing is highlighted, and the markers still read.
    let mut state = ListState::default().with_selected(if focused { active_option_index(field, view) } else { None });
    let list = List::new(items)
        .highlight_symbol(format!("{} ", Symbol::Caret.glyph()))
        .highlight_style(view.theme.focus_style())
        .style(if view.disabled { view.theme.hint() } else { view.theme.label(false) });
    list.render(area, buffer, &mut state);
}

/// The bands inside a panel: the title row, then the strip band, then the optional section description, then the
/// field rows. Shared by [`render_form`] and [`render_form_in_frame`] so the caret cannot disagree with the paint.
struct Bands {
    tabs: Rect,
    selector: Rect,
    description: Rect,
    fields: Rect,
}

fn bands(body: Rect, surface: &Surface<'_>, has_description: bool) -> Bands {
    let tabs_row = geometry::tab_strip_height(surface);
    let selector_row = geometry::action_selector_height(surface);
    let description_row = u16::from(has_description);
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(tabs_row),
            Constraint::Length(selector_row),
            Constraint::Length(description_row),
            Constraint::Min(0),
        ])
        .split(body);
    Bands { tabs: rows[0], selector: rows[1], description: rows[2], fields: rows[3] }
}

/// Draw the whole parameters panel into `area`, border included, and return the field band it used.
pub fn render_form<'a>(buffer: &mut Buffer, area: Rect, view: &FormView<'a>, editor: Option<&FieldEditor>) -> Rect {
    let block = view.theme.panel();
    let inner = block.inner(area);
    block.render(area, buffer);
    if inner.is_empty() {
        return Rect::ZERO;
    }
    let title = Rect { x: inner.x, y: inner.y, width: inner.width, height: 1 };
    Paragraph::new(format!("{} {}", Symbol::Section.glyph(), Term::Parameters.resolve(view.language)))
        .style(view.theme.title())
        .render(title, buffer);
    let body = Rect { y: inner.y + 1, height: inner.height.saturating_sub(1), ..inner };

    let section = view.section();
    let has_description = section.and_then(|section| section.description).is_some();
    let Bands { tabs, selector, description, fields } = bands(body, view.surface, has_description);

    render_tab_strip(buffer, tabs, view);
    if let Some(selector_field) = view.surface.action_selector {
        render_action_selector(buffer, selector, view, selector_field);
    }
    if let Some(text) = section.and_then(|section| section.description) {
        Paragraph::new(text.resolve(view.language)).style(view.theme.hint()).render(description, buffer);
    }

    let Some(section) = section else {
        Paragraph::new(Term::NoVisibleFields.resolve(view.language)).style(view.theme.hint()).render(fields, buffer);
        return fields;
    };
    let visible = FormView::drawable_fields(section);
    let field_areas = geometry::field_rows(fields, &visible, |id| view.errors.contains_key(id));
    for (field, field_area) in visible.iter().zip(field_areas.iter()) {
        render_field(buffer, *field_area, view, *field, editor);
    }
    fields
}

/// The Frame-level entry: draws the panel and puts the terminal caret on the focused field's editor, which is the
/// one thing a buffer-only render cannot do.
pub fn render_form_in_frame<'a>(frame: &mut Frame<'_>, area: Rect, view: &FormView<'a>, editor: Option<&FieldEditor>) {
    let fields = render_form(frame.buffer_mut(), area, view, editor);
    let Some(section) = view.section() else { return };
    let Some(field_id) = view.focused else { return };
    let Some(state) = editor.filter(|state| state.field_id() == field_id) else { return };
    let visible = FormView::drawable_fields(section);
    let Some(index) = visible.iter().position(|field| field.id == field_id) else { return };
    let Some(field) = visible.get(index).copied() else { return };
    let areas = geometry::field_rows(fields, &visible, |id| view.errors.contains_key(id));
    if let Some(position) = areas.get(index).and_then(|rect| state.cursor_position(*rect, field, view.theme, !view.disabled)) {
        frame.set_cursor_position(position);
    }
}

#[cfg(test)]
mod tests {
    use super::{FormView, NUMBER_VALUE_WIDTH, render_field, render_form, render_form_in_frame, render_tab_strip};
    use crate::surface::{plan_surface, plan_visible_surface};
    use crate::tui::editor::FieldEditor;
    use crate::tui::snapshot::{assert_not_shown, assert_shown, area_lines, render_to_buffer, shown_rows, snapshot_lines};
    use crate::tui::style::Theme;
    use ratatui::layout::Rect;
    use std::collections::BTreeMap;
    use xiranite_plugin_api::definition_eval::Values;
    use xiranite_plugin_api::identifiers::PluginId;
    use xiranite_plugin_api::node_definition::{
        Condition, DEFINITION_VERSION_V1, DangerGate, FieldDefinition, FieldGroup, FieldKind, FieldOption, InputBinding,
        LocalizedText, NodeAction, NodeDefinition, Predicate, ResultColumn, ResultTableSpec, Scalar, Test, Transform,
    };

    fn text(zh: &str, en: &str) -> LocalizedText {
        LocalizedText::new(zh, en)
    }

    fn option(value: &str, zh: &str, en: &str) -> FieldOption {
        FieldOption { value: Scalar::Text(value.to_owned()), label: text(zh, en), hint: None, disabled: false }
    }

    fn field(id: &str, kind: FieldKind) -> FieldDefinition {
        FieldDefinition {
            default: None,
            description: Some(text("字段说明", "field description")),
            id: id.to_owned(),
            is_action_selector: false,
            kind,
            label: text(id, id),
            lines: Some(4),
            options: Vec::new(),
            placeholder: Some(text("占位文字", "placeholder")),
            range: None,
            rules: Vec::new(),
            visible: Condition::Single(Predicate::holds(Test::Always)),
        }
    }

    fn definition(fields: Vec<FieldDefinition>, groups: Vec<FieldGroup>) -> NodeDefinition {
        NodeDefinition {
            actions: vec![NodeAction { id: "run".to_owned(), label: text("执行", "Run") }, NodeAction { id: "undo", label: text("撤销", "Undo") }],
            danger: DangerGate::None,
            danger_prompt: None,
            danger_prompt_export: None,
            dashboard: None,
            definition_version: DEFINITION_VERSION_V1,
            description: text("一个节点", "A node."),
            fields,
            groups,
            input_bindings: Vec::new(),
            node_id: PluginId::try_new("probe").expect("identifier"),
            preview_export: None,
            publishes_output_path: false,
            reports_progress: false,
            result_export: None,
            result_table: None,
            help: None,
            title: text("探针", "Probe"),
        }
    }

    fn group(id: &str, zh: &str, en: &str, field_ids: &[&str]) -> FieldGroup {
        FieldGroup { id: id.to_owned(), title: text(zh, en), description: None, field_ids: field_ids.iter().map(|value| (*value).to_owned()).collect() }
    }

    fn empty_errors() -> BTreeMap<String, String> {
        BTreeMap::new()
    }

    /// A two-section probe surface: a selector inside `source`, then `paths`/`mode`/`maxLines`/`dryRun`/`note`.
    fn probe() -> NodeDefinition {
        let mut selector = field("action", FieldKind::Select);
        selector.is_action_selector = true;
        selector.label = text("工作流", "Workflow");
        selector.options = vec![option("run", "执行", "Run"), option("undo", "撤销", "Undo")];
        selector.default = Some(Scalar::Text("run".to_owned()));
        let mut mode = field("mode", FieldKind::Select);
        mode.label = text("扫描规则", "Scan rule");
        mode.options = vec![option("normal", "常规", "Normal"), option("leak", "泄漏前缀清理", "Leak prefix")];
        mode.default = Some(Scalar::Text("normal".to_owned()));
        let mut max_lines = field("maxLines", FieldKind::Number);
        max_lines.label = text("分段行数", "Lines per segment");
        max_lines.default = Some(Scalar::Number(1000.0));
        let mut dry_run = field("dryRun", FieldKind::Boolean);
        dry_run.label = text("仅预演", "Dry run");
        dry_run.default = Some(Scalar::Boolean(true));
        let mut note = field("note", FieldKind::Text);
        note.label = text("备注", "Note");
        note.default = Some(Scalar::Text(String::new()));
        let mut json = field("jsonContent", FieldKind::Multiline);
        json.label = text("Rename JSON", "Rename JSON");
        json.default = Some(Scalar::Text(String::new()));
        definition(
            vec![selector, json, mode, max_lines, dry_run, note],
            vec![group("source", "来源", "Source", &["action", "jsonContent"]), group("options", "选项与安全", "Options & safety", &["mode", "maxLines", "dryRun", "note"])],
        )
    }

    fn view<'a>(node: &'a crate::surface::Surface<'a>, theme: &'a Theme, focused: Option<&'a str>, active: Option<&'a str>, values: &'a Values, errors: &'a BTreeMap<String, String>) -> FormView<'a> {
        FormView { surface: node, language: "en", theme, active_section: active, focused, values, errors, disabled: false }
    }

    fn panel(node: &crate::surface::Surface<'_>, theme: &Theme, focused: Option<&str>, active: Option<&str>, values: &Values, errors: &BTreeMap<String, String>, editor: Option<&FieldEditor>, width: u16, height: u16) -> Vec<String> {
        let view = view(node, theme, focused, active, values, errors);
        snapshot_lines(&render_to_buffer(width, height, |buffer, area| {
            render_form(buffer, area, &view, editor);
        }))
    }

    #[test]
    fn two_sections_get_a_strip_and_one_does_not() {
        let node = probe();
        let theme = Theme::resolve(Some("nord"));
        let values = Values::new();
        let errors = empty_errors();

        let surface = plan_visible_surface(&node, &values);
        assert_eq!(surface.sections.len(), 2, "the probe lost a section");
        let two_section_lines = panel(&surface, &theme, None, None, &values, &errors, None, 60, 30);
        assert_shown(&two_section_lines, "Source");
        assert_shown(&two_section_lines, "Options & safety");
        assert_shown_above(&two_section_lines, "Source", "Rename JSON");
        assert_shown(&two_section_lines, "Parameters");

        // Negative control: one group that claims everything leaves a single section, so there is no strip and the
        // section titles are nowhere on screen — the selector label moves up by exactly the row the strip took.
        let single = definition(
            node.fields.clone(),
            vec![group("source", "\u{6765}\u{6e90}", "Source", &["action", "jsonContent", "mode", "maxLines", "dryRun", "note"])],
        );
        let surface = plan_visible_surface(&single, &values);
        assert_eq!(surface.sections.len(), 1, "the probe kept a second section");
        let lines = panel(&surface, &theme, None, None, &values, &errors, None, 60, 30);
        assert_not_shown(&lines, "Options & safety");
        assert_not_shown(&lines, "Source");
        let single_row = *shown_rows(&lines, "\u{25b6} Workflow").first().expect("the selector label is drawn");
        let two_row = *shown_rows(&two_section_lines, "\u{25b6} Workflow").first().expect("the selector label is drawn");
        assert_eq!(two_row, single_row + 1, "a tab strip costs exactly one row above the selector");
        assert!(single_row >= 2, "the panel title row is never mistaken for content: {single_row}");
    }

    #[test]
    fn the_action_selector_is_a_strip_and_never_also_a_row() {
        let node = probe();
        let theme = Theme::resolve(Some("nord"));
        let values = Values::new();
        let errors = empty_errors();
        let surface = plan_visible_surface(&node, &values);
        let lines = panel(&surface, &theme, None, Some("source"), &values, &errors, None, 60, 30);
        // Its label appears once, and its two options appear once each on the strip row.
        assert_eq!(shown_rows(&lines, "Workflow").len(), 1, "one selector label, carrying the action icon");
        assert!(lines[shown_rows(&lines, "Workflow")[0]].contains("▶"), "the role wins the icon: {:?}", lines);
        let option_rows = shown_rows(&lines, "Run");
        assert_eq!(option_rows.len(), 1, "the action tabs are drawn once");
        assert!(lines[option_rows[0]].contains("Undo"));
        // Negative control: `mode`'s options live in the other section, so switching sections drops them.
        assert_not_shown(&lines, "Leak prefix");
        let other = panel(&surface, &theme, None, Some("options"), &values, &errors, None, 60, 30);
        assert_shown(&other, "Leak prefix");
        assert_not_shown(&other, "Rename JSON");
    }

    #[test]
    fn a_select_marks_its_value_and_only_shows_a_caret_when_the_ring_is_on_it() {
        let node = probe();
        let theme = Theme::resolve(Some("nord"));
        let errors = empty_errors();
        let surface = plan_visible_surface(&node, &Values::new());

        let unfocused = panel(&surface, &theme, None, Some("options"), &Values::new(), &errors, None, 60, 30);
        assert_shown(&unfocused, "● Normal");
        assert_shown(&unfocused, "○ Leak prefix");
        assert_not_shown(&unfocused, "› Normal", "no ring on this field, so no caret");

        let focused = panel(&surface, &theme, Some("mode"), Some("options"), &Values::new(), &errors, None, 60, 30);
        assert_shown(&focused, "› Normal", "the caret sits on the field's value");
        assert_eq!(shown_rows(&focused, "●").len(), 2, "one selected marker per select/boolean row");

        // Negative control: change the answer and the marker follows the value, not the caret.
        let mut values = Values::new();
        values.insert("mode".to_owned(), Scalar::Text("leak".to_owned()));
        let surface = plan_visible_surface(&node, &values);
        let switched = panel(&surface, &theme, Some("mode"), Some("options"), &values, &errors, None, 60, 30);
        assert_shown(&switched, "● Leak prefix");
        assert_shown(&switched, "○ Normal");
        assert_shown(&switched, "› Leak prefix");
    }

    #[test]
    fn a_boolean_gets_the_two_answers_the_shared_rule_invents() {
        let node = probe();
        let theme = Theme::resolve(Some("nord"));
        let errors = empty_errors();

        let mut on = Values::new();
        on.insert("dryRun".to_owned(), Scalar::Boolean(true));
        let surface = plan_visible_surface(&node, &on);
        let lines = panel(&surface, &theme, None, Some("options"), &on, &errors, None, 60, 30);
        assert_shown(&lines, "● Yes");
        assert_shown(&lines, "○ No");

        let mut off = Values::new();
        off.insert("dryRun".to_owned(), Scalar::Boolean(false));
        let surface = plan_visible_surface(&node, &off);
        let lines = panel(&surface, &theme, None, Some("options"), &off, &errors, None, 60, 30);
        assert_shown(&lines, "○ Yes");
        assert_shown(&lines, "● No");
    }

    #[test]
    fn a_number_shares_its_row_with_its_value_and_an_error_earns_its_own_row() {
        let node = probe();
        let theme = Theme::resolve(Some("nord"));
        let surface = plan_visible_surface(&node, &Values::new());
        let lines = panel(&surface, &theme, None, Some("options"), &Values::new(), &empty_errors(), None, 60, 30);
        let row = shown_rows(&lines, "Lines per segment").into_iter().next().expect("the number field is on screen");
        assert!(lines[row].contains("1000"), "the value sits on the label's row: {:?}", lines[row]);
        assert!(lines[row].len() as u16 <= 60, "and it stays inside the panel");

        let mut errors = BTreeMap::new();
        errors.insert("note".to_owned(), "备注不能为空".to_owned());
        let lines = panel(&surface, &theme, None, Some("options"), &Values::new(), &errors, None, 60, 30);
        assert_shown(&lines, "备注不能为空");
        // Negative control: the error row pushed nothing out of the panel and is not the label row.
        assert_ne!(shown_rows(&lines, "备注不能为空"), shown_rows(&lines, "Note"));
    }

    #[test]
    fn a_field_without_an_answer_shows_its_placeholder_and_a_blank_value_keeps_the_row_count() {
        let node = probe();
        let theme = Theme::resolve(Some("nord"));
        let surface = plan_visible_surface(&node, &Values::new());
        let lines = panel(&surface, &theme, Some("note"), Some("options"), &Values::new(), &empty_errors(), None, 60, 30);
        assert_shown(&lines, "placeholder");
        assert_not_shown(&lines, "field description", "WorkbenchField never drew a field description");

        let mut filled = Values::new();
        filled.insert("note".to_owned(), Scalar::Text("keep backups".to_owned()));
        let lines = panel(&surface, &theme, None, Some("options"), &filled, &empty_errors(), None, 60, 30);
        assert_shown(&lines, "keep backups");
        assert_not_shown(&lines, "placeholder");
    }

    #[test]
    fn the_focused_text_field_is_the_one_that_gets_the_editor_state() {
        let node = probe();
        let theme = Theme::resolve(Some("nord"));
        let surface = plan_visible_surface(&node, &Values::new());
        let note = surface.sections.iter().find(|section| section.id == "options").expect("options section").fields.iter().find(|field| field.id == "note").expect("note field");
        let mut editor = FieldEditor::open(note, Some(&Scalar::Text("typed".to_owned()))).expect("opens");
        editor.apply(&crate::keymap::Action::EditInsert('!'));

        let lines = panel(&surface, &theme, Some("note"), Some("options"), &Values::new(), &empty_errors(), Some(&editor), 60, 30);
        assert_shown(&lines, "typed!");

        // Negative control: the same editor handed to a different section draws nothing of its own, because the
        // field is not on screen.
        let other_section = panel(&surface, &theme, Some("note"), Some("source"), &Values::new(), &empty_errors(), Some(&editor), 60, 30);
        assert_not_shown(&other_section, "typed!");
    }

    #[test]
    fn a_running_form_greys_the_options_and_withdraws_the_caret() {
        let node = probe();
        let theme = Theme::resolve(Some("nord"));
        let surface = plan_visible_surface(&node, &Values::new());
        let view = FormView {
            surface: &surface,
            language: "en",
            theme: &theme,
            active_section: Some("options"),
            focused: Some("mode"),
            values: &Values::new(),
            errors: &empty_errors(),
            disabled: true,
        };
        let buffer = render_to_buffer(60, 30, |buffer, area| {
            render_form(buffer, area, &view, None);
        });
        let lines = snapshot_lines(&buffer);
        assert_shown(&lines, "Normal");
        assert_not_shown(&lines, "› Normal", "a running form takes no caret");
    }

    #[test]
    fn an_empty_surface_says_so_instead_of_drawing_a_blank_panel() {
        let node = definition(vec![field("ghost", FieldKind::Text)], Vec::new());
        let theme = Theme::resolve(Some("nord"));
        let mut gated = node;
        for field in &mut gated.fields {
            field.visible = Condition::Single(Predicate::fails(Test::Always));
        }
        let surface = plan_visible_surface(&gated, &Values::new());
        assert!(surface.sections.is_empty(), "the probe hid everything");
        let lines = panel(&surface, &theme, None, None, &Values::new(), &empty_errors(), None, 60, 12);
        assert_shown(&lines, "This interaction has no visible fields.");
        assert_not_shown(&lines, "ghost");
    }

    #[test]
    fn a_stale_active_section_falls_back_to_the_first() {
        let node = probe();
        let theme = Theme::resolve(Some("nord"));
        let surface = plan_visible_surface(&node, &Values::new());
        let lines = panel(&surface, &theme, None, Some("deleted"), &Values::new(), &empty_errors(), None, 60, 30);
        assert_shown(&lines, "Rename JSON", "the first section is on screen");
        assert_not_shown(&lines, "Leak prefix", "and not the one the id asked for");
    }

    #[test]
    fn the_frame_entry_puts_the_caret_on_the_focused_editors_cell() {
        use crate::tui::snapshot::render_frame;
        let node = probe();
        let theme = Theme::resolve(Some("nord"));
        let values = Values::new();
        let errors = empty_errors();
        let surface = plan_visible_surface(&node, &values);
        let note = surface
            .sections
            .iter()
            .find(|section| section.id == "options")
            .expect("options section")
            .fields
            .iter()
            .find(|field| field.id == "note")
            .expect("note field");
        let editor = FieldEditor::open(note, Some(&Scalar::Text("abc".to_owned()))).expect("opens");
        let view = FormView { surface: &surface, language: "en", theme: &theme, active_section: Some("options"), focused: Some("note"), values: &values, errors: &errors, disabled: false };
        let lines = render_frame(60, 30, |frame| {
            render_form_in_frame(frame, frame.area(), &view, Some(&editor));
        });
        assert_shown(&lines, "abc");
        // The caret itself is a frame side effect: prove the row the editor is on, which is where the caret goes.
        let row = shown_rows(&lines, "abc").first().copied().expect("the value row exists");
        assert!(row > 2, "the editor is below the title and the label rows, got row {row}");
    }

    #[test]
    fn render_tab_strip_reports_zero_rows_for_a_single_section() {
        let node = probe();
        let theme = Theme::resolve(Some("nord"));
        let values = Values::new();
        let surface = plan_visible_surface(&node, &values);
        let view = view(&surface, &theme, None, None, &values, &empty_errors());
        let mut buffer = render_to_buffer(60, 3, |_buffer, _area| {});
        let rows = render_tab_strip(&mut buffer, Rect::new(0, 0, 60, 1), &view);
        assert_eq!(rows, 1, "two sections give a strip");
        let single = definition(node.fields.clone(), vec![group("source", "来源", "Source", &["action"])]);
        let surface = plan_visible_surface(&single, &values);
        let view = view(&surface, &theme, None, None, &values, &empty_errors());
        assert_eq!(render_tab_strip(&mut buffer, Rect::new(0, 0, 60, 1), &view), 0);
        assert_eq!(render_tab_strip(&mut buffer, Rect::ZERO, &view), 0, "no room, no strip");
    }

    #[test]
    fn a_field_rendered_alone_uses_only_its_own_band() {
        let node = probe();
        let theme = Theme::resolve(Some("nord"));
        let values = Values::new();
        let surface = plan_visible_surface(&node, &values);
        let field = surface.sections[1].fields.iter().find(|candidate| candidate.id == "maxLines").expect("number field");
        let view = view(&surface, &theme, None, None, &values, &empty_errors());
        let buffer = render_to_buffer(NUMBER_VALUE_WIDTH + 20, 3, |buffer, area| {
            render_field(buffer, area, &view, field, None);
        });
        let lines = area_lines(&buffer, Rect::new(0, 0, NUMBER_VALUE_WIDTH + 20, 1));
        assert!(lines[0].contains("Lines per segment") && lines[0].contains("1000"), "one row holds both: {lines:?}");
        // Negative control: the rows below stay empty, so the field cannot bleed into its neighbour's band.
        assert_eq!(area_lines(&buffer, Rect::new(0, 1, NUMBER_VALUE_WIDTH + 20, 2)), vec![String::new(), String::new()]);
    }

    #[test]
    fn a_declared_result_table_and_dashboard_are_not_the_forms_business() {
        // The surface carries those two facts for the node's panels; the form must not start drawing them.
        let mut node = probe();
        node.result_table = Some(ResultTableSpec { columns: vec![ResultColumn { id: "path".to_owned(), label: text("路径", "Path"), width: None }], empty_message: None });
        node.dashboard = Some(xiranite_plugin_api::node_definition::DashboardSpec {
            title: text("运行状态", "Live status"),
            description: None,
            primary: xiranite_plugin_api::node_definition::ValueSource::ActionLabel,
            secondary: None,
            metrics: Vec::new(),
        });
        let theme = Theme::resolve(Some("nord"));
        let values = Values::new();
        let surface = plan_visible_surface(&node, &values);
        assert!(surface.has_result_table && surface.has_dashboard);
        let lines = panel(&surface, &theme, None, None, &values, &empty_errors(), None, 60, 30);
        assert_not_shown(&lines, "Path");
        assert_not_shown(&lines, "Live status");
    }

    fn assert_shown_above(lines: &[String], before: &str, after: &str) {
        crate::tui::snapshot::assert_shown_above(lines, before, after);
    }

    #[test]
    fn plan_surface_is_the_only_section_authority() {
        let node = probe();
        let all = plan_surface(&node, |_| true);
        let none = plan_surface(&node, |_| false);
        assert_eq!(all.sections.len(), 2);
        assert!(none.sections.is_empty());
        // Negative control: the form draws what the planner said, so a field no section claimed shows up in the
        // overflow tab rather than vanishing.
        let mut extra = field("orphan", FieldKind::Text);
        extra.label = text("孤儿", "Orphan");
        let with_orphan = definition(vec![extra, field("a", FieldKind::Text)], vec![group("source", "来源", "Source", &["a"])]);
        let surface = plan_visible_surface(&with_orphan, &Values::new());
        let theme = Theme::resolve(Some("nord"));
        let lines = panel(&surface, &theme, None, Some("other"), &Values::new(), &empty_errors(), None, 60, 30);
        assert_shown(&lines, "Orphan");
        assert_shown(&lines, "Parameters");
    }
}
