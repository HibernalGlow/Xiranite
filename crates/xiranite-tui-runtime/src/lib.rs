//! Shared TUI layer for the node faces (ADR-0069).
//!
//! A node's own `crates/nodes/<id>/src/tui.rs` composes its screen — which panels it has, what the tabs mean,
//! what it draws — and this crate supplies the parts every screen must agree on: the focus ring's arithmetic
//! ([`focus`]), the meaning of a key press ([`keymap`]) the workbench sections ([`surface`]), and the theme vocabulary ([`theme`], generated from the producer and gated against it). Visibility and danger are never computed here: they come from `xiranite_plugin_api::definition_eval`, the one evaluator every face shares. Both are taken from the legacy OpenTUI screen that
//! ships today, because a TUI port that "feels slightly different" about tab order or `q` is a regression
//! nobody can point at in a screenshot.
//!
//! The crate deliberately depends on nothing, not even ratatui: a widget version belongs to the face that
//! draws, and keeping semantics here means the rules can be tested without a terminal. The visibility and
//! danger rules of a node's definition are the other half of "shared semantics" and live with the definition
//! model itself, so a face never re-implements them.

#[path = "focus.rs"]
pub mod focus;

#[path = "keymap.rs"]
pub mod keymap;

#[path = "theme.rs"]
pub mod theme;

#[path = "surface.rs"]
pub mod surface;

pub use focus::{Direction, move_focus};
pub use keymap::{Action, KeyCode, KeyEvent, KeyState, Screen, Zone, action_for, focus_direction};
pub use surface::{Surface, plan_visible_surface, shows_tab_strip};
pub use theme::{Palette, fallback_theme, palette, resolve_theme_name, theme_names};
