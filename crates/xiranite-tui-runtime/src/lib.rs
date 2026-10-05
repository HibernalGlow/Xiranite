//! Shared TUI layer for the node faces (ADR-0069).
//!
//! A node's own `crates/nodes/<id>/src/tui.rs` composes its screen — which panels it has, what the tabs mean,
//! what it draws — and this crate supplies the parts every screen must agree on: the focus ring's arithmetic
//! ([`focus`]), the meaning of a key press ([`keymap`]) the workbench sections ([`surface`]), and the theme
//! vocabulary ([`theme`], generated from the producer and gated against it). Visibility and danger are never
//! computed here: they come from `xiranite_plugin_api::definition_eval`, the one evaluator every face shares.
//! Both are taken from the legacy OpenTUI screen that ships today, because a TUI port that "feels slightly
//! different" about tab order or `q` is a regression nobody can point at in a screenshot.
//!
//! The second half is [`tui`]: the ratatui composition that turns a planned [`surface::Surface`] into widgets —
//! section blocks with their fields, the tab strip, the focused field's editor and the help card. The split is
//! deliberate and is the one `docs/tui-rust-widget-strategy.md` §6.7 fixes: the four modules above decide *what a
//! key and a section mean* and compile against nothing but the definition model, while `tui/` is the only place
//! that names a widget. Basic controls are never hand-drawn there — inputs, the multiline editor, lists, tabs,
//! tables, gauges and scrollbars come from ratatui and the two editor crates, and this crate writes only theme,
//! layout, key mapping, definition→widget adaptation and `TestBackend` scaffolding on top.
//!
//! Nothing in this crate may know a node id, and nothing may re-implement the condition algebra.

#[path = "focus.rs"]
pub mod focus;

#[path = "keymap.rs"]
pub mod keymap;

#[path = "theme.rs"]
pub mod theme;

#[path = "surface.rs"]
pub mod surface;

#[path = "tui/mod.rs"]
pub mod tui;

pub use focus::{Direction, move_focus};
pub use keymap::{Action, KeyCode, KeyEvent, KeyState, Screen, Zone, action_for, focus_direction};
pub use surface::{Surface, plan_visible_surface, shows_tab_strip};
pub use theme::{Palette, fallback_theme, palette, resolve_theme_name, theme_names};
pub use tui::editor::FieldEditor;
pub use tui::form::{FormView, render_form, render_form_in_frame};
pub use tui::layout::{HelpAreas, WorkbenchAreas, field_rows, help_areas, workbench_areas};
pub use tui::render::{HeaderLines, ScreenMode, draw_screen};
pub use tui::snapshot::{render_frame, render_to_buffer, snapshot_lines};
pub use tui::style::Theme;
pub use tui::terms::{HelpHeading, Symbol, Term};
