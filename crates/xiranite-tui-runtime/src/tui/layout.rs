//! The `Layout` splits the legacy screen measured, expressed as geometry rather than as flexbox.
//!
//! Every number here is a transcription, and the file:line is on each one so a review can check it against
//! `packages/cli-runtime/src/tui/opentui/`:
//!
//! - the workbench is `app.tsx:132-244`: one column of padding left and right, a header of height 4, then a
//!   growing row whose left panel is 42% wide, then a bottom row of height 8 whose left panel is 38% wide;
//! - the help card is `help-screen.tsx:10-15`: the same column padding, a header of height 3, then a growing row
//!   whose left panel is 45% wide;
//! - a field's height is `workbench-controls.tsx:88-223`'s `minHeight`s: text is a label plus a 3-row box,
//!   `multiline`/`path-list` a label plus `field.lines` (5 and 6 when the node did not say), number is one row,
//!   and a `select`/`boolean` is a label plus one row per option — `optionsForField` (`screen.ts:11-19`) always
//!   gives a boolean two, so a boolean never collapses to a label alone;
//! - the gap between rows is 1 because the legacy rows used `marginTop={1}` and `gap={1}` (`app.tsx:143`, `:198`).
//!
//! No function here draws anything; it answers "which rectangle", which is what lets `form`/`help` stay about
//! content and a node's `tui.rs` stay about composition.

use ratatui::layout::{Constraint, Direction, Layout, Margin, Rect};
use xiranite_plugin_api::node_definition::{FieldDefinition, FieldKind};

use crate::surface::{Section, Surface};

/// The three areas a workbench frame owns.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorkbenchAreas {
    /// The node title, description and phase line (`app.tsx:133-142`).
    pub header: Rect,
    /// The parameters panel: tab strip, section description and field rows (`app.tsx:144-160`).
    pub form: Rect,
    /// Everything to the right of the form, which only a node's `tui.rs` knows how to fill.
    pub side: Rect,
}

/// The help card's areas (`help-screen.tsx:10-15`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HelpAreas {
    /// `? <node title>` plus the back affordance.
    pub header: Rect,
    /// The `whenToUse` and workflow panel.
    pub usage: Rect,
    /// The commands and safety panel.
    pub commands: Rect,
}

/// The bottom row's areas: execution affordances and the status/logs panel (`app.tsx:198-244`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BottomAreas {
    /// The execution/confirmation panel, 38% wide.
    pub execution: Rect,
    /// The status/logs panel.
    pub results: Rect,
}

/// The box a single-line text field draws into (`workbench-controls.tsx:159`, `height={3}`).
pub const TEXT_BOX_HEIGHT: u16 = 3;
/// The `multiline` box height when the node did not declare `lines` (`workbench-controls.tsx:179`).
pub const DEFAULT_MULTILINE_LINES: u16 = 5;
/// The `path-list` box height when the node did not declare `lines` (`workbench-controls.tsx:179`).
pub const DEFAULT_PATH_LIST_LINES: u16 = 6;
/// A box needs its two borders plus one content row, or a border overdraws itself.
pub const MIN_EDITOR_HEIGHT: u16 = 3;

/// The workbench split for a whole frame area.
#[must_use]
pub fn workbench_areas(area: Rect) -> WorkbenchAreas {
    let column = area.inner(Margin::new(1, 0));
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .spacing(1)
        .constraints([Constraint::Length(4), Constraint::Min(1), Constraint::Length(8)])
        .split(column);
    let main = Layout::default()
        .direction(Direction::Horizontal)
        .spacing(1)
        .constraints([Constraint::Percentage(42), Constraint::Min(1)])
        .split(rows[1]);
    WorkbenchAreas { header: rows[0], form: main[0], side: main[1] }
}

/// The bottom row split, for a node that draws its own execution and results panels.
#[must_use]
pub fn bottom_areas(area: Rect) -> BottomAreas {
    let row = Layout::default()
        .direction(Direction::Horizontal)
        .spacing(1)
        .constraints([Constraint::Percentage(38), Constraint::Min(1)])
        .split(area);
    BottomAreas { execution: row[0], results: row[1] }
}

/// The help card split for a whole frame area.
#[must_use]
pub fn help_areas(area: Rect) -> HelpAreas {
    let column = area.inner(Margin::new(1, 0));
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .spacing(1)
        .constraints([Constraint::Length(3), Constraint::Min(1)])
        .split(column);
    let panels = Layout::default()
        .direction(Direction::Horizontal)
        .spacing(1)
        .constraints([Constraint::Percentage(45), Constraint::Min(1)])
        .split(rows[1]);
    HelpAreas { header: rows[0], usage: panels[0], commands: panels[1] }
}

/// The editor box height a field asks for, borders included, floored so a border never overdraws content.
#[must_use]
pub fn editor_height(field: &FieldDefinition) -> u16 {
    let declared = match field.kind {
        FieldKind::PathList => DEFAULT_PATH_LIST_LINES,
        FieldKind::Multiline => DEFAULT_MULTILINE_LINES,
        _ => TEXT_BOX_HEIGHT,
    };
    let requested = match field.lines {
        Some(lines) => u16::try_from(lines).unwrap_or(u16::MAX),
        None => declared,
    };
    requested.max(MIN_EDITOR_HEIGHT)
}

/// The rows a field needs: its label, its control, and an error line when the field carries one.
#[must_use]
pub fn field_row_height(field: &FieldDefinition, has_error: bool) -> u16 {
    let control = match field.kind {
        FieldKind::Text => TEXT_BOX_HEIGHT,
        FieldKind::Multiline | FieldKind::PathList => editor_height(field),
        // A number is one row, its value right-aligned against the label (`workbench-controls.tsx:127-142`).
        FieldKind::Number => 1,
        // A `select` lists its options; a `boolean` is always the two `optionsForField` invents.
        FieldKind::Select => field.options.len().max(1) as u16,
        FieldKind::Boolean => 2,
    };
    1 + control + u16::from(has_error)
}

/// One rectangle per field, in declaration order, sized by [`field_row_height`], spare rows left as a gap.
///
/// A row that no longer fits comes back empty (`Rect::is_empty`) and stays inside `area`, which is how the panel
/// clips where the legacy scrollbox did rather than drawing half a border.
#[must_use]
pub fn field_rows(area: Rect, fields: &[&FieldDefinition], has_error: impl Fn(&str) -> bool) -> Vec<Rect> {
    let mut constraints = Vec::with_capacity(fields.len() + 1);
    for field in fields {
        constraints.push(Constraint::Length(field_row_height(field, has_error(field.id.as_str()))));
    }
    constraints.push(Constraint::Min(0));
    let rows = Layout::default().direction(Direction::Vertical).constraints(constraints).split(area);
    rows.iter().take(fields.len()).copied().collect()
}

/// The band the section tab strip takes: one row when there is a strip to show.
#[must_use]
pub fn tab_strip_height(surface: &Surface<'_>) -> u16 {
    u16::from(crate::surface::shows_tab_strip(surface))
}

/// The band the action selector takes: its label plus the strip, or nothing when the node has no selector.
#[must_use]
pub fn action_selector_height(surface: &Surface<'_>) -> u16 {
    u16::from(surface.action_selector.is_some()) * 2
}

/// The heading a section contributes to the strip, straight from the node's authored copy.
#[must_use]
pub fn section_title(section: &Section<'_>, language: &str) -> String {
    section.title.resolve(language).to_owned()
}

/// Split a panel's inner area into the strip band (tabs plus selector) and the field band.
#[must_use]
pub fn form_inner(area: Rect, surface: &Surface<'_>) -> (Rect, Rect) {
    let strip = tab_strip_height(surface) + action_selector_height(surface);
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(strip), Constraint::Min(0)])
        .split(area);
    (rows[0], rows[1])
}

#[cfg(test)]
mod tests {
    use super::{
        DEFAULT_MULTILINE_LINES, DEFAULT_PATH_LIST_LINES, MIN_EDITOR_HEIGHT, action_selector_height, bottom_areas,
        editor_height, field_row_height, field_rows, form_inner, help_areas, section_title, tab_strip_height,
        workbench_areas,
    };
    use crate::surface::{OVERFLOW_SECTION_ID, plan_surface, plan_visible_surface};
    use crate::tui::terms::Term;
    use ratatui::layout::Rect;
    use xiranite_plugin_api::definition_eval::Values;
    use xiranite_plugin_api::identifiers::PluginId;
    use xiranite_plugin_api::node_definition::{
        Condition, DEFINITION_VERSION_V1, DangerGate, FieldDefinition, FieldGroup, FieldKind, FieldOption, InputBinding,
        LocalizedText, NodeAction, NodeDefinition, Predicate, Scalar, Test, Transform,
    };

    fn text(zh: &str, en: &str) -> LocalizedText {
        LocalizedText::new(zh, en)
    }

    fn field(id: &str, kind: FieldKind) -> FieldDefinition {
        FieldDefinition {
            default: Some(Scalar::Text(String::new())),
            description: None,
            id: id.to_owned(),
            is_action_selector: false,
            kind,
            label: text(id, id),
            lines: None,
            options: Vec::new(),
            placeholder: None,
            range: None,
            rules: Vec::new(),
            visible: Condition::Single(Predicate::holds(Test::Always)),
        }
    }

    fn option(value: &str, zh: &str, en: &str) -> FieldOption {
        FieldOption { value: Scalar::Text(value.to_owned()), label: text(zh, en), hint: None, disabled: false }
    }

    fn selector_field() -> FieldDefinition {
        let mut selector = field("action", FieldKind::Select);
        selector.is_action_selector = true;
        selector.options = vec![option("run", "执行", "Run"), option("undo", "撤销", "Undo")];
        selector
    }

    fn group(id: &str, zh: &str, en: &str, field_ids: &[&str]) -> FieldGroup {
        FieldGroup {
            id: id.to_owned(),
            title: text(zh, en),
            description: None,
            field_ids: field_ids.iter().map(|value| (*value).to_owned()).collect(),
        }
    }

    fn definition(fields: Vec<FieldDefinition>, groups: Vec<FieldGroup>) -> NodeDefinition {
        NodeDefinition {
            actions: vec![NodeAction { id: "run".to_owned(), label: text("执行", "Run") }],
            danger: DangerGate::None,
            danger_prompt: None,
            danger_prompt_export: None,
            dashboard: None,
            definition_version: DEFINITION_VERSION_V1,
            description: text("一个节点", "A node."),
            fields,
            groups,
            input_bindings: vec![InputBinding {
                field_id: "a".to_owned(),
                slot: "a".to_owned(),
                transform: Transform::Identity,
                default_export: None,
            }],
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

    #[test]
    fn the_workbench_split_is_the_legacy_proportions() {
        let areas = workbench_areas(Rect::new(0, 0, 120, 40));
        assert_eq!(areas.header.height, 4, "app.tsx:133 gives the header height 4");
        assert_eq!(areas.form.height, areas.side.height);
        assert_eq!(areas.form.y, areas.header.y + areas.header.height + 1, "one marginTop row between them");
        // 120 columns minus the two of padding, minus the one-column gap, split 42/58.
        assert_eq!(areas.form.width + 1 + areas.side.width, 118);
        assert!(areas.form.width < areas.side.width, "the parameters panel is the narrow half (app.tsx:144)");
        let ratio = f64::from(areas.form.width) / f64::from(areas.form.width + areas.side.width + 1);
        assert!((ratio - 0.42).abs() < 0.02, "form panel share was {ratio:.3}, expected about 0.42");
        // The three rows tile the padded column exactly, with two gaps of one row.
        assert_eq!(areas.header.height + areas.form.height + 2, 40);
        assert_eq!(areas.side.height + 8 + 2, 40 - areas.header.height - 1);
    }

    #[test]
    fn the_bottom_and_help_splits_keep_their_own_ratios() {
        let bottom = bottom_areas(Rect::new(0, 0, 100, 8));
        assert_eq!(bottom.execution.height, 8);
        assert_eq!(bottom.execution.width + 1 + bottom.results.width, 100);
        assert!((i32::from(bottom.execution.width) - 38).abs() <= 1, "38% of the row (app.tsx:199)");

        let help = help_areas(Rect::new(0, 0, 120, 30));
        assert_eq!(help.header.height, 3, "help-screen.tsx:11 gives the header height 3");
        assert_eq!(help.usage.height, help.commands.height);
        assert!(help.usage.width < help.commands.width, "the usage panel is the 45% half (help-screen.tsx:13)");
    }

    #[test]
    fn a_frame_too_small_to_show_anything_still_tiles_and_never_escapes() {
        // Negative control against a panic and against a torn screen: `Rect::new` saturates, and no split may hand
        // back a rectangle outside the frame it was given.
        for (width, height) in [(0, 0), (1, 1), (5, 5), (9, 7)] {
            let frame = Rect::new(0, 0, width, height);
            let areas = workbench_areas(frame);
            let (usage, commands) = form_inner(frame, &plan_surface(&definition(vec![selector_field()], Vec::new()), |_| true));
            let help = help_areas(frame);
            let bottom = bottom_areas(frame);
            let probe: TextAreasProbe = (areas.form, usage, commands);
            assert_eq!(probe.0.width, areas.form.width, "form_inner must not invent width");
            for rect in [areas.header, areas.form, areas.side, help.header, help.usage, help.commands, bottom.execution, bottom.results, usage, commands] {
                assert!(rect.left() >= frame.left() && rect.right() <= frame.right(), "{width}x{height}: {rect:?} left the frame");
                assert!(rect.top() >= frame.top() && rect.bottom() <= frame.bottom(), "{width}x{height}: {rect:?} left the frame");
            }
        }
    }

    #[test]
    fn field_heights_are_the_legacy_minheights() {
        let mut path_list = field("paths", FieldKind::PathList);
        assert_eq!(field_row_height(&path_list, false), 1 + DEFAULT_PATH_LIST_LINES);
        path_list.lines = Some(4);
        assert_eq!(field_row_height(&path_list, false), 5, "the node said four rows, so label plus four");

        let mut json = field("jsonContent", FieldKind::Multiline);
        assert_eq!(field_row_height(&json, false), 1 + DEFAULT_MULTILINE_LINES);
        json.lines = Some(1);
        assert_eq!(editor_height(&json), MIN_EDITOR_HEIGHT, "a declared height below the borders is floored");
        assert_eq!(field_row_height(&json, false), 1 + MIN_EDITOR_HEIGHT);

        assert_eq!(field_row_height(&field("basePath", FieldKind::Text), false), 4, "label plus a 3-row box");
        assert_eq!(field_row_height(&field("maxLines", FieldKind::Number), false), 1);
        let mut mode = field("mode", FieldKind::Select);
        mode.options = vec![option("normal", "常规", "Normal"), option("leak", "泄漏前缀清理", "Leak prefix")];
        assert_eq!(field_row_height(&mode, false), 3, "label plus two options");
        assert_eq!(field_row_height(&mode, true), 4, "an error line is its own row (workbench-controls.tsx:103)");
        // Negative control: a select with no options still takes a row rather than collapsing to nothing, and a
        // boolean is never shorter than its two answers.
        assert_eq!(field_row_height(&field("empty", FieldKind::Select), false), 2);
        assert_eq!(field_row_height(&field("dryRun", FieldKind::Boolean), false), 3);
    }

    #[test]
    fn rows_come_back_in_definition_order_and_clip_instead_of_hanging_off_the_panel() {
        let fields = [field("a", FieldKind::Text), field("b", FieldKind::Number), field("c", FieldKind::Text)];
        let refs: Vec<&FieldDefinition> = fields.iter().collect();
        let area = Rect::new(0, 0, 40, 20);
        let rows = field_rows(area, &refs, |_| false);
        assert_eq!(rows.len(), 3, "one row per field, none for the spare");
        assert_eq!(rows[0].height, 4);
        assert_eq!(rows[1].height, 1);
        assert_eq!(rows[0].y, 0);
        assert_eq!(rows[1].y, 4);
        assert_eq!(rows[2].y, 5);
        assert!(rows[2].bottom() <= area.bottom());

        // The same fields in a 6-row panel: what no longer fits stays inside the panel and never goes negative.
        let clipped = field_rows(Rect::new(0, 0, 40, 6), &refs, |_| false);
        assert_eq!(clipped.len(), 3);
        for row in &clipped {
            assert!(row.bottom() <= 6, "row {row:?} was drawn past the panel");
        }
        assert!(clipped.iter().any(|row| row.height < field_row_height(refs[0], false)), "something had to give");

        // Negative control: the error hook is consulted per field id, not globally.
        let with_errors = field_rows(area, &refs, |id| id == "b");
        assert_eq!(with_errors[1].y, 5, "field b grew an error row");
        assert_eq!(with_errors[2].y, 6);
        assert!(field_rows(area, &[], |_| false).is_empty(), "no fields, no rows");
    }

    #[test]
    fn the_strip_bands_only_take_room_when_there_is_something_to_strip() {
        let one_section = definition(
            vec![selector_field(), field("a", FieldKind::Text)],
            vec![group("one", "一", "One", &["a"])],
        );
        let surface = plan_surface(&one_section, |_| true);
        assert_eq!(action_selector_height(&surface), 2);
        assert_eq!(tab_strip_height(&surface), 0, "one section is not a strip (surface.rs shows_tab_strip)");
        let (strip, fields_area) = form_inner(Rect::new(0, 0, 40, 12), &surface);
        assert_eq!(strip.height, 2);
        assert_eq!(fields_area.height, 10);
        assert_eq!(fields_area.y, 2);

        let two_sections = definition(
            vec![selector_field(), field("a", FieldKind::Text), field("b", FieldKind::Text)],
            vec![group("one", "一", "One", &["a"]), group("two", "二", "Two", &["b"])],
        );
        let surface = plan_surface(&two_sections, |_| true);
        assert_eq!(tab_strip_height(&surface), 1);
        let (strip, fields_area) = form_inner(Rect::new(0, 0, 40, 12), &surface);
        assert_eq!(strip.height, 3, "one row of tabs plus the selector's two");
        assert_eq!(fields_area.height, 9);

        // Negative control: without a selector the band disappears entirely.
        let plain = definition(vec![field("a", FieldKind::Text)], Vec::new());
        let surface = plan_surface(&plain, |_| true);
        assert_eq!(action_selector_height(&surface), 0);
        assert_eq!(form_inner(Rect::new(0, 0, 40, 12), &surface).0.height, 0);
    }

    #[test]
    fn the_overflow_section_is_labelled_with_the_shared_term_not_its_id() {
        let node = definition(vec![field("a", FieldKind::Text)], Vec::new());
        let surface = plan_surface(&node, |_| true);
        let overflow = surface.sections.first().expect("an overflow section exists");
        assert_eq!(overflow.id, OVERFLOW_SECTION_ID);
        assert_eq!(section_title(overflow, "en"), Term::Parameters.resolve("en"));
        assert_eq!(section_title(overflow, "zh"), Term::Parameters.resolve("zh"));
        // Negative control: the internal id never reaches the screen.
        assert_ne!(section_title(overflow, "en"), OVERFLOW_SECTION_ID);

        let named = definition(vec![field("a", FieldKind::Text)], vec![group("source", "来源", "Source", &["a"])]);
        let surface = plan_visible_surface(&named, &Values::new());
        let section = surface.sections.first().expect("the source section");
        assert_eq!(section_title(section, "zh"), "来源");
        assert_eq!(section_title(section, "en"), "Source");
    }

    #[test]
    fn the_workbench_and_help_splits_disagree_on_purpose() {
        let areas = workbench_areas(Rect::new(0, 0, 120, 40));
        let help = help_areas(Rect::new(0, 0, 120, 40));
        assert_eq!(areas.header.height, 4);
        assert_eq!(help.header.height, 3);
        assert_ne!(areas.form.width, help.usage.width, "the two screens have different panel ratios");
    }
}
