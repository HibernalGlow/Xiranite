//! Shared CLI layer for the node faces (ADR-0069).
//!
//! A node's own `crates/nodes/<id>/src/cli.rs` is the composition — which subcommands it exposes, what it
//! prints, how it errors — and this crate is the library underneath it: the reader for the node's published
//! [`NodeDefinition`], the evaluator that turns that definition into the questions to ask and the danger
//! confirmation to honour, and the terminal driver that renders them with clap and cliclack. Business logic
//! stays in the node's wasm; nothing here knows a specific node.
//!
//! Why the semantics live here instead of in each node's `cli.rs`: `interaction.ts` used to carry them as
//! closures that every face re-implemented. The definition made them data, and data needs one evaluator —
//! otherwise the CLI, the TUI and the Web UI drift apart on when a field is visible or a run is dangerous.
//!
//! `--no-default-features` builds only the pure layer ([`wire`], [`plan`] and [`help`]), which is what the tests
//! exercise; the `tty` feature adds the terminal execution, which needs a real terminal to be useful.

pub mod help;
pub mod plan;
pub mod wire;

#[cfg(feature = "tty")]
pub mod term;

pub use help::{FaceHeading, HelpBlock, help_blocks, render_help};
pub use plan::{Danger, Step, Values, condition_holds, danger_required, is_visible, predicate_holds, prompt_plan, test_holds};
pub use wire::{DefinitionReadError, parse_definition};

/// Read a definition from disk and validate it, for hosts that resolve paths themselves.
pub fn load_definition_file(path: &std::path::Path) -> Result<xiranite_plugin_api::node_definition::NodeDefinition, DefinitionReadError> {
    let text = std::fs::read_to_string(path)
        .map_err(|error| DefinitionReadError::InvalidJson(format!("{path:?}: {error}")))?;
    wire::parse_definition(&text)
}
