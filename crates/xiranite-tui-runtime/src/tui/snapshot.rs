//! `TestBackend` scaffolding for the shared composition.
//!
//! §6.2 of `docs/tui-rust-widget-strategy.md` allows exactly this much widget work in the runtime: snapshot
//! helpers that let a node's `docs/<node>-tui-visual-review.md` claim and §6.6 check agree. Nothing here decides
//! what a screen looks like; it turns a draw call into text an assertion can read.
//!
//! Two paths, because they answer different questions:
//!
//! - [`render_to_buffer`] renders into a [`Buffer`] the test owns, with no terminal involved, so a widget's
//!   geometry can be checked inside a larger frame;
//! - [`render_frame`] goes through `Terminal<TestBackend>`, which is the only way to catch what a real frame does
//!   on the way (cursor placement, clipping at the frame edge).
//!
//! Text extraction mirrors ratatui's own `TestBackend` debug view: a multi-width grapheme (CJK labels, the
//! `▤`/`◉` glyphs) resets the cells it covers, so those resets are skipped rather than emitted as spaces.
//! `CellWidth` comes from `ratatui::buffer` — the width question in §3.1 of the strategy doc is answered by the
//! crate already in the graph, so `unicode-width` is not added here.

use ratatui::backend::TestBackend;
use ratatui::buffer::{Buffer, CellWidth};
use ratatui::layout::Rect;
use ratatui::{Frame, Terminal};

/// Render straight into a buffer of `width × height`, with the full area handed to `draw`.
#[must_use]
pub fn render_to_buffer(width: u16, height: u16, draw: impl FnOnce(&mut Buffer, Rect)) -> Buffer {
    let area = Rect::new(0, 0, width, height);
    let mut buffer = Buffer::empty(area);
    draw(&mut buffer, area);
    buffer
}

/// One row of a buffer as text, `x_start..x_end`, with covered wide-char cells skipped.
fn row_text(buffer: &Buffer, y: u16, x_start: u16, x_end: u16) -> String {
    let mut text = String::new();
    let mut skip: u16 = 0;
    for x in x_start..x_end {
        let cell = buffer.cell((x, y));
        let symbol = cell.map_or(" ", Cell::symbol);
        if skip == 0 {
            text.push_str(symbol);
        }
        skip = skip.max(cell.map_or(1, CellWidth::cell_width)).saturating_sub(1);
    }
    text.trim_end().to_owned()
}

/// Every row of a whole buffer.
#[must_use]
pub fn snapshot_lines(buffer: &Buffer) -> Vec<String> {
    area_lines(buffer, buffer.area)
}

/// Every row of one area, clipped to what the buffer actually holds.
#[must_use]
pub fn area_lines(buffer: &Buffer, area: Rect) -> Vec<String> {
    let clipped = area.intersection(buffer.area);
    (clipped.top()..clipped.bottom())
        .map(|y| row_text(buffer, y, clipped.left(), clipped.right()))
        .collect()
}

/// Draw one frame through `Terminal<TestBackend>` and return the screen as rows of text.
#[must_use]
#[track_caller]
pub fn render_frame(width: u16, height: u16, draw: impl FnOnce(&mut Frame)) -> Vec<String> {
    let mut terminal = Terminal::new(TestBackend::new(width, height));
    let mut lines: Vec<String> = Vec::new();
    // The buffer is read inside the callback because `Terminal::draw` swaps it out on completion; this is the
    // frame exactly as a backend would have received it.
    terminal
        .draw(|frame| {
            draw(frame);
            lines = snapshot_lines(frame.buffer_mut());
        })
        .expect("TestBackend cannot fail to draw");
    lines
}

/// The rows that mention `needle`, refusing an empty haystack so a scan never "passes" on nothing.
#[must_use]
pub fn shown_rows(lines: &[String], needle: &str) -> Vec<usize> {
    assert!(!lines.is_empty(), "scanning an empty snapshot: nothing was drawn to check");
    assert!(!needle.is_empty(), "refusing a needle that matches every row");
    lines.iter().enumerate().filter(|(_, line)| line.contains(needle)).map(|(index, _)| index).collect()
}

#[track_caller]
fn require_shown(lines: &[String], needle: &str) -> Vec<usize> {
    let rows = shown_rows(lines, needle);
    assert!(!rows.is_empty(), "expected {needle:?}, and the snapshot held:\n{}", lines.join("\n"));
    rows
}

/// Assert `needle` appears somewhere.
#[track_caller]
pub fn assert_shown(lines: &[String], needle: &str) {
    require_shown(lines, needle);
}

/// Assert `needle` appears nowhere — the negative control half of the same snapshot.
#[track_caller]
pub fn assert_not_shown(lines: &[String], needle: &str) {
    assert!(!lines.is_empty(), "scanning an empty snapshot: nothing was drawn to check");
    let rows = lines.iter().filter(|line| line.contains(needle)).count();
    assert_eq!(rows, 0, "{needle:?} was drawn but should not have been:\n{}", lines.join("\n"));
}

/// Assert `before` is on an earlier row than `after`, which is how a snapshot proves the tab strip sits above
/// the field rows rather than merely that both exist.
#[track_caller]
pub fn assert_shown_above(lines: &[String], before: &str, after: &str) {
    let before_row = *require_shown(lines, before).first().expect("checked above");
    let after_row = *require_shown(lines, after).first().expect("checked above");
    assert!(before_row < after_row, "expected {before:?} (row {before_row}) above {after:?} (row {after_row}):\n{}", lines.join("\n"));
}

#[cfg(test)]
mod tests {
    use super::{area_lines, render_frame, render_to_buffer, shown_rows, snapshot_lines};
    use ratatui::layout::Rect;
    use ratatui::style::Style;
    use ratatui::widgets::{Block, BorderType, Borders, Paragraph, Widget};

    #[test]
    fn a_wide_label_survives_the_round_trip_without_interior_spaces() {
        // `来源` is two graphemes of width 2 each; the covered cells are resets, and a naive join would give
        // "来 源" — which would make every CJK assertion below silently wrong.
        let buffer = render_to_buffer(6, 1, |buffer, area| {
            Paragraph::new("来源").render(area, buffer);
        });
        let lines = snapshot_lines(&buffer);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0], "来源");
        assert_eq!(shown_rows(&lines, "来源"), vec![0]);
    }

    #[test]
    fn an_area_scan_stays_inside_the_area_it_was_given() {
        let buffer = render_to_buffer(20, 3, |buffer, area| {
            Paragraph::new("left-half right-half").render(area, buffer);
        });
        let left = area_lines(&buffer, Rect::new(0, 0, 9, 3));
        assert_eq!(left.len(), 3, "the scan refused rows it should have kept");
        assert!(left[0].contains("left"));
        // Negative control: the right-hand word is outside the scanned area, so a full-buffer scan finds it and
        // the clipped one does not.
        assert!(!left[0].contains("right"));
        assert!(snapshot_lines(&buffer)[0].contains("right"));
    }

    #[test]
    fn a_frame_path_reports_what_the_backend_got() {
        let lines = render_frame(12, 3, |frame| {
            frame.render_widget(
                Block::new().borders(Borders::ALL).border_type(BorderType::Rounded).title("hi"),
                frame.area(),
            );
        });
        assert_eq!(lines.len(), 3);
        assert!(lines[0].starts_with('╭'), "expected a rounded top border, got {:?}", lines[0]);
        assert!(lines[0].contains("hi"));
        // Negative control: an empty frame draws nothing, and the helper must not pretend otherwise.
        let blank = render_frame(12, 3, |_frame| {});
        assert_eq!(blank, vec![String::new(); 3], "an undrawn frame must snapshot as blank rows");
    }

    #[test]
    #[should_panic(expected = "scanning an empty snapshot")]
    fn a_scan_refuses_an_empty_snapshot() {
        shown_rows(&[], "anything");
    }

    #[test]
    #[should_panic(expected = "refusing a needle")]
    fn a_scan_refuses_a_needle_that_matches_everything() {
        shown_rows(&vec![String::from("row")], "");
    }

    #[test]
    fn style_and_geometry_do_not_leak_into_the_text_view() {
        let buffer = render_to_buffer(4, 1, |buffer, area| {
            Paragraph::new("ab").style(Style::new()).render(area, buffer);
        });
        assert_eq!(snapshot_lines(&buffer), vec!["ab".to_owned()]);
    }
}
