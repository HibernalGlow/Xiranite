//! The palette the generated theme table publishes, applied as ratatui styles.
//!
//! `crate::theme` is generated from `packages/cli-runtime/src/tui/theme.tsx` and carries eight sRGB colours
//! *with their alpha byte*. This module is the place that byte stops mattering, and it says so out loud: ratatui
//! has no translucent foreground, so a colour becomes `Color::Rgb(r, g, b)` and the alpha is dropped. That is a
//! face-visible decision (ADR-0069 records the same one about the generated table), and it is the reason the
//! conversion lives here rather than inside the generated file — that file must stay byte-comparable to its
//! producer, and a dropped alpha is not a byte it can carry.
//!
//! Which colour goes where is the legacy screen's mapping, not a new taste:
//!
//! | Role | Legacy use |
//! | --- | --- |
//! | `primary` | panel title text, scroll thumb, the caret in a `Select` row (`app.tsx:140`, `:156`, `select.tsx`) |
//! | `foreground` | a field label that is not focused (`workbench-controls.tsx:92`) |
//! | `muted_foreground` | inactive tab labels, hints, disabled rows, secondary preview lines (`app.tsx:192`, `:204`) |
//! | `border` | every panel and input border (`workbench-controls.tsx:34`) |
//! | `focus_ring` | the focused control's label and border, the active tab (`action-tabs.tsx:67`) |
//! | `success` / `warning` / `error` | result line, running phase, hazard text (`app.tsx:239`, `:415`, `:204`) |

use ratatui::style::{Color, Modifier, Style};
use ratatui::widgets::{Block, BorderType, Borders, Padding};

use crate::theme::{Palette, palette, resolve_theme_name};

/// The eight roles as ratatui can draw them, i.e. without the alpha byte.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Theme {
    /// The theme actually used, i.e. the resolved name (`nord` for anything unknown).
    name: &'static str,
    colors: Palette,
}

/// A run phase, narrowed to what the header colours; mirrors `phaseColor` (`app.tsx:414-418`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    /// Nothing running and no result yet.
    Idle,
    /// An operation is in flight.
    Running,
    /// A result or an error is on screen.
    Result,
}

/// The colour of one alpha-bearing token. The alpha is dropped here, deliberately and in one place: ratatui's
/// `Color` has no alpha, so the `cursor` theme's translucent muted text becomes opaque `#e4e4e4` on screen.
#[must_use]
pub const fn color_of(rgba: (u8, u8, u8, u8)) -> Color {
    let (red, green, blue, _alpha) = rgba;
    Color::Rgb { r: red, g: green, b: blue }
}

/// The colour a face falls back to when the *generated* table lists a theme it has no palette for.
///
/// That cannot happen while the `audit:tui-theme-table` gate is green, and it is not worth panicking over: a flat
/// grey screen is recoverable, a crashed terminal is not. `flat_palette_is_never_used_in_practice` below is the
/// test that keeps this branch honest.
const UNPALETTE: (u8, u8, u8) = (128, 128, 128);

const fn flat_color() -> Palette {
    Palette {
        primary: (UNPALETTE.0, UNPALETTE.1, UNPALETTE.2, 255),
        foreground: (UNPALETTE.0, UNPALETTE.1, UNPALETTE.2, 255),
        muted_foreground: (UNPALETTE.0, UNPALETTE.1, UNPALETTE.2, 255),
        border: (UNPALETTE.0, UNPALETTE.1, UNPALETTE.2, 255),
        focus_ring: (UNPALETTE.0, UNPALETTE.1, UNPALETTE.2, 255),
        success: (UNPALETTE.0, UNPALETTE.1, UNPALETTE.2, 255),
        warning: (UNPALETTE.0, UNPALETTE.1, UNPALETTE.2, 255),
        error: (UNPALETTE.0, UNPALETTE.1, UNPALETTE.2, 255),
    }
}

impl Theme {
    /// Resolve a requested theme name exactly like `resolveTerminalTheme` does: absent, blank or unknown → `nord`.
    #[must_use]
    pub fn resolve(requested: Option<&str>) -> Self {
        let name = resolve_theme_name(requested);
        let colors = palette(name)
            .or_else(|| palette(crate::theme::fallback_theme()))
            .unwrap_or_else(flat_color);
        Self { name, colors }
    }

    /// The theme in use.
    #[must_use]
    pub const fn name(&self) -> &'static str {
        self.name
    }

    /// The raw palette, alpha byte included, for a face that draws somewhere alpha survives.
    #[must_use]
    pub const fn palette(&self) -> &Palette {
        &self.colors
    }

    #[must_use]
    pub fn primary(&self) -> Color {
        color_of(self.colors.primary)
    }

    #[must_use]
    pub fn foreground(&self) -> Color {
        color_of(self.colors.foreground)
    }

    #[must_use]
    pub fn muted(&self) -> Color {
        color_of(self.colors.muted_foreground)
    }

    #[must_use]
    pub fn border(&self) -> Color {
        color_of(self.colors.border)
    }

    #[must_use]
    pub fn focus_ring(&self) -> Color {
        color_of(self.colors.focus_ring)
    }

    #[must_use]
    pub fn success(&self) -> Color {
        color_of(self.colors.success)
    }

    #[must_use]
    pub fn warning(&self) -> Color {
        color_of(self.colors.warning)
    }

    #[must_use]
    pub fn error(&self) -> Color {
        color_of(self.colors.error)
    }

    /// A field or control label: the ring when the focus is on it, plain foreground otherwise
    /// (`workbench-controls.tsx:92`).
    #[must_use]
    pub fn label(&self, focused: bool) -> Style {
        if focused { self.focus_style() } else { Style::default().fg(self.foreground()) }
    }

    /// The focused control's style: ring colour plus bold, which is how the legacy tabs and click targets made
    /// the active one read as active (`action-tabs.tsx:84`).
    #[must_use]
    pub fn focus_style(&self) -> Style {
        Style::default().fg(self.focus_ring()).add_modifier(Modifier::BOLD)
    }

    /// Secondary copy: hints, option notes, inactive tab labels, placeholder text.
    #[must_use]
    pub fn hint(&self) -> Style {
        Style::default().fg(self.muted())
    }

    /// A panel or node title line.
    #[must_use]
    pub fn title(&self) -> Style {
        Style::default().fg(self.primary()).add_modifier(Modifier::BOLD)
    }

    /// The value a field holds.
    #[must_use]
    pub fn value(&self, focused: bool) -> Style {
        if focused { self.focus_style() } else { Style::default().fg(self.foreground()) }
    }

    /// A validation message or a hazard line.
    #[must_use]
    pub fn danger(&self) -> Style {
        Style::default().fg(self.error())
    }

    /// The result line's colour, success or error by the outcome the node reported.
    #[must_use]
    pub fn outcome(&self, succeeded: bool) -> Style {
        Style::default().fg(if succeeded { self.success() } else { self.error() })
    }

    /// The header's phase colour: warning while running, success once there is a result, muted otherwise.
    #[must_use]
    pub fn phase(&self, phase: Phase) -> Style {
        let color = match phase {
            Phase::Running => self.warning(),
            Phase::Result => self.success(),
            Phase::Idle => self.muted(),
        };
        Style::default().fg(color).add_modifier(Modifier::BOLD)
    }

    /// The rounded panel every legacy area sat in (`workbench-controls.tsx:31-42`): the theme's border colour,
    /// one column of padding per side, and the title drawn as the first *inner* line rather than as a border
    /// title — that is where the legacy panel put its heading, its description and its rows.
    #[must_use]
    pub fn panel(&self) -> Block<'static> {
        Block::new()
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(self.border()))
            .padding(Padding::symmetric(1, 0))
    }

    /// The box an editor draws inside: rounded like the panel, coloured by focus and error state
    /// (`workbench-controls.tsx:158`, `text-input.tsx:71-76`).
    #[must_use]
    pub fn editor_box(&self, focused: bool, has_error: bool) -> Block<'static> {
        let color = if has_error { self.error() } else if focused { self.focus_ring() } else { self.border() };
        Block::new()
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(color))
            .padding(Padding::symmetric(1, 0))
    }

    /// The scroll track: a primary thumb over a border-coloured track, the pairing `app.tsx:156`/`:186` gave
    /// every scrollbox.
    #[must_use]
    pub fn scroll_pair(&self) -> (Style, Style) {
        (Style::default().fg(self.primary()), Style::default().fg(self.border()))
    }
}

#[cfg(test)]
mod tests {
    use super::{Phase, Theme, UNPALETTE, color_of, flat_color};
    use crate::theme::{palette, theme_names};
    use ratatui::style::{Color, Modifier};

    #[test]
    fn the_alpha_byte_is_dropped_but_the_colour_is_not_changed() {
        // `cursor` is the one translucent entry the generated table publishes; the rgb triple has to survive the
        // drop exactly, or the theme chosen for its translucency silently recolours the screen.
        let cursor = palette("cursor").expect("cursor theme");
        assert!(cursor.muted_foreground.3 < 255, "the producer's translucent entry is what this test needs");
        assert_eq!(color_of(cursor.muted_foreground), Color::Rgb { r: 228, g: 228, b: 228 });
        assert_eq!(Theme::resolve(Some("cursor")).muted(), Color::Rgb { r: 228, g: 228, b: 228 });
        // Negative control: dropping alpha is not the same as dropping the colour.
        assert_ne!(Theme::resolve(Some("cursor")).muted(), Color::Reset);
    }

    #[test]
    fn an_unknown_theme_paints_nord_and_never_the_palette_called_default() {
        let theme = Theme::resolve(Some("torak"));
        let nord = palette("nord").expect("nord theme");
        assert_eq!(theme.name(), "nord");
        assert_eq!(theme.primary(), color_of(nord.primary));
        // The palette literally named `default` is a different scheme; reading the first row of the table as "the
        // default one" would recolour every screen and no screenshot review would catch it.
        let default = palette("default").expect("default theme");
        assert_ne!(theme.primary(), color_of(default.primary));
        assert_eq!(Theme::resolve(None).name(), "nord");
        assert_eq!(Theme::resolve(Some("  ")).name(), "nord");
        assert_eq!(Theme::resolve(Some(" Dracula ")).name(), "dracula");
    }

    #[test]
    fn every_listed_theme_resolves_to_its_own_palette() {
        let names = theme_names();
        assert!(!names.is_empty(), "the theme table walked nothing");
        for &name in names {
            let theme = Theme::resolve(Some(name));
            let listed = palette(name).expect("listed theme has a palette");
            assert_eq!(theme.palette(), &listed, "{name} resolved elsewhere");
            // Negative control: the flat fallback is only for a broken table, so no listed theme may land on it.
            assert_eq!(theme.primary(), color_of(listed.primary));
            assert_ne!(theme.primary().to_rgb(), Some(UNPALETTE), "{name} drew the fallback grey");
        }
        assert_eq!(flat_color().primary, (128, 128, 128, 255));
    }

    #[test]
    fn focus_and_error_states_reach_the_border_and_the_label() {
        let theme = Theme::resolve(Some("nord"));
        assert_eq!(theme.label(true).fg, Some(theme.focus_ring()));
        assert_eq!(theme.label(false).fg, Some(theme.foreground()));
        assert!(theme.label(true).add_modifier.contains(Modifier::BOLD));
        assert_eq!(theme.editor_box(true, false).border_style.fg, Some(theme.focus_ring()));
        assert_eq!(theme.editor_box(false, true).border_style.fg, Some(theme.error()));
        assert_eq!(theme.editor_box(false, false).border_style.fg, Some(theme.border()));
        // Negative control: an unfocused, error-free box must not borrow the ring colour, or every field on the
        // screen looks focused.
        assert_ne!(theme.editor_box(false, false).border_style.fg, Some(theme.focus_ring()));
        assert_ne!(theme.hint().fg, theme.label(false).fg);
    }

    #[test]
    fn the_phase_colours_track_the_legacy_phase_mapping() {
        let theme = Theme::resolve(Some("nord"));
        assert_eq!(theme.phase(Phase::Running).fg, Some(theme.warning()));
        assert_eq!(theme.phase(Phase::Result).fg, Some(theme.success()));
        assert_eq!(theme.phase(Phase::Idle).fg, Some(theme.muted()));
        assert_eq!(theme.outcome(true).fg, Some(theme.success()));
        assert_eq!(theme.outcome(false).fg, Some(theme.error()));
    }

    #[test]
    fn a_panel_eats_its_border_and_its_padding_off_the_content_area() {
        use ratatui::layout::Rect;
        let theme = Theme::resolve(Some("nord"));
        let inner = theme.panel().inner(Rect::new(0, 0, 40, 10));
        // Two border columns per side: one border, one padding.
        assert_eq!(inner.width, 36);
        assert_eq!(inner.height, 8);
        // Negative controls: a border-only block would give 38, and an area-only block 40.
        assert_ne!(inner.width, 38);
        assert_ne!(inner.width, 40);
        assert!(inner.area() > 0);
    }

    #[test]
    fn the_scroll_pair_uses_primary_over_border() {
        let theme = Theme::resolve(Some("nord"));
        let (thumb, track) = theme.scroll_pair();
        assert_eq!(thumb.fg, Some(theme.primary()));
        assert_eq!(track.fg, Some(theme.border()));
        // A thumb the colour of its track is an invisible thumb.
        assert_ne!(thumb.fg, track.fg);
    }
}
