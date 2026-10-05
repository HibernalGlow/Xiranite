//! The ratatui half of this crate: the composition that turns a planned [`crate::surface::Surface`] into widgets.
//!
//! The split with the rest of the crate is the rule in `docs/tui-rust-widget-strategy.md` §6.7: the sibling
//! modules `surface`/`focus`/`keymap`/`theme` decide *what a section, a key and a colour mean* and compile
//! against the definition model alone. Everything under this module is what a face draws with that answer, and it
//! is the only place in the crate that names `ratatui`.
//!
//! Basic controls are bought, never built (§6.1): the single-line input is `tui-input`, the multiline editor is
//! `ratatui-textarea`, and lists, tabs, tables, paragraphs, blocks, gauges and scrollbars are ratatui's own
//! widgets. What lives here is the four things §6.2 allows — theme application ([`style`]), `Layout` splits
//! ([`layout`]), the definition→widget adaptation ([`form`], [`editor`], [`help`], [`render`]) and the
//! `TestBackend` scaffolding ([`snapshot`]).
//!
//! Nothing here knows a node id, and nothing here decides visibility: a face calls
//! [`crate::surface::plan_visible_surface`] and hands the result to [`render`].

pub mod editor;
pub mod form;
pub mod help;
pub mod layout;
pub mod render;
pub mod snapshot;
pub mod style;
pub mod terms;
