//! TransQ: the translation result queue organizer, ported from
//! `packages/nodes/transq` (`core.ts` + `platform.ts`) into Rust so it can run as
//! an Extism WASM plugin (ADR-0063 principle 5, ADR-0066).
//!
//! Port boundary, as fixed by the AST feasibility audit's
//! `wasm-with-host-io` class:
//!
//! - Everything that decides *what* TransQ does is pure Rust here: path text
//!   handling ([`transq_path`]), JSON text handling ([`json_document`],
//!   [`json_text`]), workspace discovery rules ([`transq_workspace_scan`]),
//!   queue planning ([`transq_queue_planner`]) and the organize loop
//!   ([`transq_runner`]). None of it touches a filesystem, a socket, a clock or
//!   a process.
//! - Every machine touch goes through the [`transq_host::TransqHost`] trait. Its file half is
//!   [`std::fs`] against the WASI preopens the host grants ([`transq_std_fs`], ADR-0071), and its
//!   `emit`/`checkpoint` half stays two `xiranite.operation.*` host calls
//!   ([`plugin`]). ADR-0063 principle 8's "a plugin never opens a file" was the pre-ADR-0071 rule;
//!   what holds now is that a plugin only opens files the sandbox already preopens.
//!
//! The wire contract keeps the TypeScript field names because the React product
//! layer and the HTTP/Operation protocol are preserved unchanged (ADR-0063
//! principles 1 and 3): see [`transq_contract`] for the vocabulary and its
//! serialization, and `plugins/transq/manifest.toml` for the plugin identity.
//!
//! Deliberate, audited deviations from the TypeScript original are recorded next
//! to the code that deviates: filename sort order ([`transq_queue_planner`]),
//! `String.trim` whitespace set and path composition ([`transq_path`]), one
//! listing per directory instead of `lstat` + `readdir` pairs
//! ([`transq_workspace_scan`]), and the per-item cooperative yield
//! ([`transq_runner`], ADR-0066).

pub mod json_document;
pub mod json_text;
pub mod transq_contract;
pub mod transq_host;
pub mod transq_path;
pub mod transq_queue_planner;
pub mod transq_runner;
pub mod transq_std_fs;
pub mod transq_workspace_scan;

#[cfg(feature = "wasm")]
pub mod plugin;

#[cfg(test)]
mod transq_test_host;

pub use transq_contract::{
    NODE_DEFINITION, TransqAction, TransqCopyOperation, TransqData, TransqDirectorySnapshot,
    TransqInput, TransqNodeDefinition, TransqQueueItem, TransqQueueStatus, TransqRunEvent,
    TransqRunEventKind, TransqRunResult,
};
pub use transq_host::{
    CheckpointDecision, DirectoryEntry, DirectoryEntryKind, DirectoryListing, HostCallError,
    PathKind, TransqHost,
};
pub use transq_queue_planner::{TransqRunTally, plan_transq_queue, summarize_transq_items};
pub use transq_runner::run_transq;
pub use transq_std_fs::StdFilesystem;
pub use transq_workspace_scan::scan_translation_workspaces;
