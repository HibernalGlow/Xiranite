//! The editor that belongs to the focused field, built on the two crates that own that capability.
//!
//! §3 of `docs/tui-rust-widget-strategy.md` puts text input and multiline editing on the "must be bought" side of
//! the line, and §6.1 rejects hand-drawn cursors, selections or kill-yanks here. So:
//!
//! - `text` fields use `tui_input::Input`;
//! - `multiline` and `path-list` fields use `ratatui_textarea::TextArea`, `tui-textarea`'s maintained branch, which
//!   ships a real `Widget` impl plus placeholder support.
//!
//! One measured wrinkle recorded here so nobody re-researches it (§6.5): **`tui-input` 0.15.5 publishes no ratatui
//! `Widget` impl at all.** Its `ratatui-crossterm` feature only pulls `ratatui/crossterm` so that
//! `tui_input::backend::crossterm` can turn *crossterm events* into `InputRequest`s — and this crate must not use
//! that path, because what a key means is `crate::keymap`'s job (§6.7). What `tui-input` gives the drawing side is
//! the state machine plus `visual_cursor()`/`visual_scroll(width)`, which is what ratatui's own integration
//! examples do: draw the value with a `Paragraph` scrolled by the input's own numbers, then ask the terminal for
//! that caret cell. The caret arithmetic and the scrolling are `tui-input`'s; only the one-line `Paragraph` is ours.
//!
//! The key mapping is the legacy text field's (`app.tsx:87` with `Zone::Editor`, then `text-input.tsx:64-84`), not
//! a new one: right/up advance the caret, left/down retreat, `EditBackspace` deletes before it, `EditDelete` after
//! it, and any other editor character inserts *at* the caret — the legacy field splices rather than appends, so a
//! caret in the middle of a path is not a broken paste target.

use ratatui::buffer::Buffer;
use ratatui::layout::{Position, Rect};
use ratatui::widgets::{Paragraph, Widget};
use ratatui_textarea::{CursorMove, TextArea, WrapMode};
use tui_input::{Input, InputRequest, InputResponse};
use xiranite_plugin_api::node_definition::{FieldDefinition, FieldKind, Scalar};

use crate::keymap::Action;
use crate::tui::layout;
use crate::tui::style::Theme;

/// What the editor did with a key, so a host knows whether it owes the plugin a new value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Applied {
    /// The text changed: push [`FieldEditor::text`] into the values map.
    Changed,
    /// Only the caret moved: the value is untouched.
    Moved,
    /// Nothing happened, either because the key is not an editor key or because there was nothing to delete.
    Ignored,
}

/// The editor state for one field.
#[derive(Debug, Clone)]
pub enum FieldEditor {
    /// A `text` field's single-line input.
    Single { field_id: String, input: Input },
    /// A `multiline` or `path-list` field's editor.
    Multi { field_id: String, text_area: TextArea<'static> },
}

/// Whether this kind is edited with a caret rather than cycled with the arrows.
///
/// Mirrors the legacy `editingText` test (`app.tsx:87`), which is exactly these three kinds.
#[must_use]
pub const fn is_editor_kind(kind: FieldKind) -> bool {
    matches!(kind, FieldKind::Text | FieldKind::Multiline | FieldKind::PathList)
}

fn response_to_applied(response: InputResponse) -> Applied {
    match response {
        Some(changed) if changed.value => Applied::Changed,
        Some(_) => Applied::Moved,
        None => Applied::Ignored,
    }
}

const fn applied_from_bool(changed: bool) -> Applied {
    if changed { Applied::Changed } else { Applied::Ignored }
}

impl FieldEditor {
    /// Open the editor a field needs, seeded with the current answer. `None` for kinds that have no caret.
    #[must_use]
    pub fn open(field: &FieldDefinition, value: Option<&Scalar>) -> Option<Self> {
        if !is_editor_kind(field.kind) {
            return None;
        }
        let text = value.map(Scalar::display_text).unwrap_or_default();
        Some(match field.kind {
            FieldKind::Text => Self::Single { field_id: field.id.clone(), input: Input::new(text) },
            FieldKind::Multiline | FieldKind::PathList => Self::Multi {
                field_id: field.id.clone(),
                text_area: fresh_text_area(&text),
            },
            _ => return None,
        })
    }

    /// The field this editor was opened for; [`FieldEditor::render`] refuses to paint a different field.
    #[must_use]
    pub fn field_id(&self) -> &str {
        match self {
            Self::Single { field_id, .. } | Self::Multi { field_id, .. } => field_id,
        }
    }

    /// The text as the values map should hold it.
    #[must_use]
    pub fn text(&self) -> String {
        match self {
            Self::Single { input, .. } => input.value().to_owned(),
            Self::Multi { text_area, .. } => text_area.lines().join("\n"),
        }
    }

    /// Whether nothing is typed yet, which is when a placeholder stands in.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        match self {
            Self::Single { input, .. } => input.value().is_empty(),
            Self::Multi { text_area, .. } => text_area.is_empty(),
        }
    }

    /// Apply one key meaning from `crate::keymap`. Anything that is not an editor meaning is reported `Ignored`
    /// rather than guessed at, because escape, enter and quit belong to the screen.
    pub fn apply(&mut self, action: &Action) -> Applied {
        match (self, action) {
            (Self::Single { input, .. }, Action::Edit { delta }) => {
                let request = if *delta >= 0 { InputRequest::GoToNextChar } else { InputRequest::GoToPrevChar };
                match response_to_applied(input.handle(request)) {
                    // tui-input answers `None` at the end of the line, which is still "the caret was asked for".
                    Applied::Ignored => Applied::Moved,
                    applied => applied,
                }
            }
            (Self::Single { input, .. }, Action::EditInsert(character)) => {
                response_to_applied(input.handle(InputRequest::InsertChar(*character)))
            }
            (Self::Single { input, .. }, Action::EditBackspace) => {
                response_to_applied(input.handle(InputRequest::DeletePrevChar))
            }
            (Self::Single { input, .. }, Action::EditDelete) => {
                response_to_applied(input.handle(InputRequest::DeleteNextChar))
            }
            (Self::Multi { text_area, .. }, Action::Edit { delta }) => {
                text_area.move_cursor(if *delta >= 0 { CursorMove::Forward } else { CursorMove::Back });
                Applied::Moved
            }
            (Self::Multi { text_area, .. }, Action::EditInsert(character)) => {
                text_area.insert_char(*character);
                Applied::Changed
            }
            (Self::Multi { text_area, .. }, Action::EditBackspace) => applied_from_bool(text_area.delete_char()),
            (Self::Multi { text_area, .. }, Action::EditDelete) => applied_from_bool(text_area.delete_next_char()),
            _ => Applied::Ignored,
        }
    }

    /// Adopt a value the face changed underneath the editor (a reset, or a node rewriting a field).
    ///
    /// The guard is the legacy one: `multiline-editor.tsx:31` and `:52` only call `setText` when the text differs,
    /// so typing never fights an echo of the user's own keystroke. Returns whether the buffer was replaced, which
    /// also means the caret went back to the start — the same consequence the legacy `setText` had.
    pub fn sync(&mut self, text: &str) -> bool {
        if self.text() == text {
            return false;
        }
        match self {
            Self::Single { input, .. } => *input = Input::new(text.to_owned()),
            Self::Multi { text_area, .. } => *text_area = fresh_text_area(text),
        }
        true
    }

    /// Draw the box and its content. A mismatched field is a caller bug, and drawing nothing is the safe answer:
    /// painting field A's text into field B's row is how a path edit lands in the wrong slot.
    pub fn render(&self, buffer: &mut Buffer, area: Rect, field: &FieldDefinition, theme: &Theme, language: &str, focused: bool) {
        if area.is_empty() || self.field_id() != field.id {
            return;
        }
        let placeholder = field.placeholder.as_ref().map(|text| text.resolve(language).to_owned()).unwrap_or_default();
        let box_widget = theme.editor_box(focused, false);
        match self {
            Self::Single { input, .. } => {
                let inner = box_widget.inner(area);
                box_widget.render(area, buffer);
                if inner.is_empty() {
                    return;
                }
                let showing_placeholder = input.value().is_empty() && !placeholder.is_empty();
                let text = if showing_placeholder { placeholder } else { input.value().to_owned() };
                let scroll = input.visual_scroll(inner.width as usize);
                let style = if showing_placeholder { theme.hint() } else { theme.value(focused) };
                Paragraph::new(text).scroll((0, scroll as u16)).style(style).render(inner, buffer);
            }
            Self::Multi { text_area, .. } => {
                let mut editor = text_area.clone();
                editor.set_block(box_widget);
                editor.set_style(theme.value(focused));
                editor.set_placeholder_style(theme.hint());
                if !placeholder.is_empty() {
                    editor.set_placeholder_text(placeholder);
                }
                editor.render(area, buffer);
            }
        }
    }

    /// The cell the terminal caret should sit on, or `None` when there is nothing to point at.
    #[must_use]
    pub fn cursor_position(&self, area: Rect, field: &FieldDefinition, theme: &Theme, focused: bool) -> Option<Position> {
        if !focused || area.is_empty() || self.field_id() != field.id {
            return None;
        }
        let inner = theme.editor_box(focused, false).inner(area);
        if inner.is_empty() {
            return None;
        }
        match self {
            Self::Single { input, .. } => {
                let column = input.visual_cursor().saturating_sub(input.visual_scroll(inner.width as usize));
                let x = inner.x.saturating_add(column as u16).min(inner.right().saturating_sub(1));
                Some(Position { x, y: inner.y })
            }
            Self::Multi { text_area, .. } => {
                let cursor = text_area.screen_cursor();
                let x = inner.x.saturating_add(cursor.col as u16);
                let y = inner.y.saturating_add(cursor.row as u16);
                if x < inner.right() && y < inner.bottom() { Some(Position { x, y }) } else { None }
            }
        }
    }

    /// The rows this editor takes inside a panel, so layout and drawing cannot disagree.
    #[must_use]
    pub fn height_for(field: &FieldDefinition) -> u16 {
        1 + layout::editor_height(field)
    }
}

/// A fresh multiline editor for a value, with the two settings the legacy editor also made.
fn fresh_text_area(text: &str) -> TextArea<'static> {
    let mut text_area = TextArea::from(text.lines().map(str::to_owned).collect::<Vec<String>>());
    // `multiline-editor.tsx:60` asked for word wrapping, and the cursor row must not be highlighted: the legacy
    // textarea drew no current-line band, and ratatui-textarea's default would add one.
    text_area.set_wrap_mode(WrapMode::Word);
    text_area.set_cursor_line_style(ratatui::style::Style::default());
    text_area
}

#[cfg(test)]
mod tests {
    use super::{Applied, FieldEditor, is_editor_kind};
    use crate::keymap::Action;
    use crate::tui::snapshot::{assert_not_shown, assert_shown, render_to_buffer, snapshot_lines};
    use crate::tui::style::Theme;
    use ratatui::layout::Rect;
    use xiranite_plugin_api::node_definition::{Condition, FieldDefinition, FieldKind, LocalizedText, Predicate, Scalar, Test};

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
            lines: Some(4),
            options: Vec::new(),
            placeholder: Some(text("占位文字", "placeholder")),
            range: None,
            rules: Vec::new(),
            visible: Condition::Single(Predicate::holds(Test::Always)),
        }
    }

    #[test]
    fn only_the_three_carrying_kinds_get_an_editor() {
        for kind in [FieldKind::Text, FieldKind::Multiline, FieldKind::PathList] {
            assert!(is_editor_kind(kind), "{kind:?} is edited with a caret");
            assert!(FieldEditor::open(&field("f", kind), None).is_some(), "{kind:?} opened no editor");
        }
        // Negative control: the cycled kinds have no caret, so a stale editor can never claim one.
        for kind in [FieldKind::Number, FieldKind::Select, FieldKind::Boolean] {
            assert!(!is_editor_kind(kind), "{kind:?} must not be an editor");
            assert!(FieldEditor::open(&field("f", kind), None).is_none());
        }
    }

    #[test]
    fn an_editor_seeds_itself_from_the_current_answer() {
        let single = FieldEditor::open(&field("basePath", FieldKind::Text), Some(&Scalar::Text("/tmp/a".to_owned()))).expect("opens");
        assert_eq!(single.text(), "/tmp/a");
        assert_eq!(single.field_id(), "basePath");
        assert!(!single.is_empty(), "a seeded value is not empty");

        // A `path-list` arrives as one text value and keeps its lines.
        let list = FieldEditor::open(&field("paths", FieldKind::PathList), Some(&Scalar::Text("/a\n/b".to_owned()))).expect("opens");
        assert_eq!(list.text(), "/a\n/b");
        // Negative control: an absent answer opens blank rather than inheriting the field's label.
        assert_eq!(FieldEditor::open(&field("paths", FieldKind::PathList), None).expect("opens").text(), "");
    }

    #[test]
    fn caret_keys_move_without_changing_the_value() {
        for kind in [FieldKind::Text, FieldKind::Multiline] {
            let mut editor = FieldEditor::open(&field("f", kind), Some(&Scalar::Text("abc".to_owned()))).expect("opens");
            assert_eq!(editor.apply(&Action::Edit { delta: 1 }), Applied::Moved, "{kind:?}: forward is a caret move");
            assert_eq!(editor.text(), "abc", "{kind:?}: a caret move must not edit the value");
            assert_eq!(editor.apply(&Action::Edit { delta: -1 }), Applied::Moved);
            assert_eq!(editor.text(), "abc");
            assert_eq!(editor.apply(&Action::Quit), Applied::Ignored, "{kind:?}: quit is the screen's, not the editor's");
            assert_eq!(editor.apply(&Action::Escape), Applied::Ignored);
            assert_eq!(editor.apply(&Action::Activate), Applied::Ignored);
        }
    }

    #[test]
    fn typing_inserts_at_the_caret_and_deleting_splits_by_direction() {
        // The legacy field splices at its cursor (`text-input.tsx:82`), so this is parity, not preference.
        let mut editor = FieldEditor::open(&field("f", FieldKind::Text), Some(&Scalar::Text("ac".to_owned()))).expect("opens");
        assert_eq!(editor.apply(&Action::Edit { delta: -1 }), Applied::Moved);
        assert_eq!(editor.apply(&Action::EditInsert('b')), Applied::Changed);
        assert_eq!(editor.text(), "bac", "inserting at column 1 puts b before the c, not at the end");

        assert_eq!(editor.apply(&Action::EditBackspace), Applied::Changed);
        assert_eq!(editor.text(), "ac", "backspace deleted the b it sat after");
        assert_eq!(editor.apply(&Action::EditDelete), Applied::Changed);
        assert_eq!(editor.text(), "a", "delete removes after the caret");
        // Negative control: with nothing left on the left there is no value change to report.
        assert_eq!(editor.apply(&Action::EditBackspace), Applied::Ignored);
        assert_eq!(editor.text(), "", "tui-input's backspace at the caret removed the last character");
        assert_eq!(editor.apply(&Action::EditBackspace), Applied::Ignored, "and again deletes nothing");
        assert_eq!(editor.text(), "");

        let mut multi = FieldEditor::open(&field("f", FieldKind::Multiline), Some(&Scalar::Text("x".to_owned()))).expect("opens");
        assert_eq!(multi.apply(&Action::Edit { delta: 1 }), Applied::Moved, "the caret starts at column 0");
        assert_eq!(multi.apply(&Action::EditInsert('y')), Applied::Changed);
        assert_eq!(multi.text(), "xy");
        assert_eq!(multi.apply(&Action::EditBackspace), Applied::Changed);
        assert_eq!(multi.text(), "x");
        assert_eq!(multi.apply(&Action::EditDelete), Applied::Ignored, "nothing after the caret");
    }

    #[test]
    fn a_value_the_face_replaced_is_adopted_only_when_it_differs() {
        let mut editor = FieldEditor::open(&field("f", FieldKind::Text), Some(&Scalar::Text("one".to_owned()))).expect("opens");
        assert!(!editor.sync("one"), "echoing the user's own text must not reset the caret");
        assert!(editor.sync("two"), "a different value is adopted");
        assert_eq!(editor.text(), "two");
        // Negative control: after adoption the caret is at the new end, so backspace hits the new text.
        assert_eq!(editor.apply(&Action::EditBackspace), Applied::Changed);
        assert_eq!(editor.text(), "tw");

        let mut multi = FieldEditor::open(&field("f", FieldKind::Multiline), None).expect("opens");
        assert!(!multi.sync(""));
        assert!(multi.sync("/a\n/b"));
        assert_eq!(multi.text(), "/a\n/b");
    }

    #[test]
    fn the_editor_draws_its_box_and_never_another_fields_text() {
        let theme = Theme::resolve(Some("nord"));
        let target = field("jsonContent", FieldKind::Multiline);
        let editor = FieldEditor::open(&target, Some(&Scalar::Text("{...}".to_owned()))).expect("opens");
        let lines = snapshot_lines(&render_to_buffer(20, 6, |buffer, area| {
            editor.render(buffer, area, &target, &theme, "en", true);
        }));
        assert_shown(&lines, "{...}");
        assert!(lines[0].starts_with('╭'), "the box is rounded like the legacy input, got {:?}", lines[0]);

        // Negative control: handing the same editor to a different field draws nothing, because a value in the
        // wrong row is worse than an empty row.
        let other = field("batchId", FieldKind::Multiline);
        let mismatched = render_to_buffer(20, 6, |buffer, area| {
            editor.render(buffer, area, &other, &theme, "en", true);
        });
        assert_not_shown(&snapshot_lines(&mismatched), "{...}");
        assert_not_shown(&snapshot_lines(&mismatched), "╭");
    }

    #[test]
    fn a_placeholder_only_stands_in_while_the_field_is_empty() {
        let theme = Theme::resolve(Some("nord"));
        let target = field("basePath", FieldKind::Text);
        let empty = FieldEditor::open(&target, None).expect("opens");
        let lines = snapshot_lines(&render_to_buffer(24, 5, |buffer, area| {
            empty.render(buffer, area, &target, &theme, "en", false);
        }));
        assert_shown(&lines, "placeholder");

        let filled = FieldEditor::open(&target, Some(&Scalar::Text("/tmp".to_owned()))).expect("opens");
        let lines = snapshot_lines(&render_to_buffer(24, 5, |buffer, area| {
            filled.render(buffer, area, &target, &theme, "en", false);
        }));
        assert_shown(&lines, "/tmp");
        assert_not_shown(&lines, "placeholder");

        // The multiline editor takes the same rule from its own widget, not from a hand-written branch.
        let multiline = field("jsonContent", FieldKind::Multiline);
        let empty_multi = FieldEditor::open(&multiline, None).expect("opens");
        let lines = snapshot_lines(&render_to_buffer(24, 6, |buffer, area| {
            empty_multi.render(buffer, area, &multiline, &theme, "en", true);
        }));
        assert_shown(&lines, "placeholder");
    }

    #[test]
    fn the_caret_is_only_offered_for_the_focused_field() {
        let theme = Theme::resolve(Some("nord"));
        let target = field("basePath", FieldKind::Text);
        let editor = FieldEditor::open(&target, Some(&Scalar::Text("abc".to_owned()))).expect("opens");
        let area = Rect::new(0, 0, 24, 4);
        let position = editor.cursor_position(area, &target, &theme, true).expect("a focused editor has a caret");
        assert_eq!(position.y, 1, "row 0 is the border");
        assert!(position.x >= 2, "the caret is inside the border and the padding: {position:?}");
        assert!(position.x < area.right(), "the caret stays in the box");
        assert_eq!(editor.cursor_position(area, &target, &theme, false), None, "an unfocused field shows no caret");
        assert_eq!(editor.cursor_position(area, &field("other", FieldKind::Text), &theme, true), None);
        assert_eq!(editor.cursor_position(Rect::ZERO, &target, &theme, true), None, "no area, no caret");

        let multiline = field("jsonContent", FieldKind::Multiline);
        let multi = FieldEditor::open(&multiline, Some(&Scalar::Text("line".to_owned()))).expect("opens");
        let position = multi.cursor_position(Rect::new(0, 0, 24, 6), &multiline, &theme, true).expect("caret");
        assert_eq!(position.y, 1);
    }

    #[test]
    fn the_editor_height_matches_the_layout_band() {
        let target = field("paths", FieldKind::PathList);
        assert_eq!(FieldEditor::height_for(&target), super::layout::field_row_height(&target, false));
        // Negative control: an error row is the face's, not the editor's.
        assert_eq!(FieldEditor::height_for(&target), super::layout::field_row_height(&target, true) - 1);
        let text_field = field("basePath", FieldKind::Text);
        assert_eq!(FieldEditor::height_for(&text_field), super::layout::field_row_height(&text_field, false));
    }
}
