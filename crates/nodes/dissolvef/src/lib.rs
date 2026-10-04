//! DissolveF node core — the node's single WASM business implementation (ADR-0069).
//!
//! Ported from `packages/nodes/dissolvef/src/core.ts`. This crate is compiled twice from one source: as
//! `dissolvef.wasm` (the `cdylib`, reached by every face through the `dissolvef_run` export in
//! [`host::extism`]) and as an `rlib` the native tests run against an in-memory host. The CLI, the TUI and
//! the GUI are different compositions of the same behaviour, so nothing in here may name a terminal, a
//! window, a filesystem path on the machine, or an Extism mechanism — the machine is [`host::DissolvefHost`],
//! and the boundary is JSON documents over the capability names in `crates/xiranite-plugin-api`.
//!
//! Layering (ADR-0068), one direction only:
//!
//! ```text
//! dissolvef_run ─▶ run ─▶ plan ─▶ similarity / paths / history
//!                     └▶ execute ─▶ contract
//!                host (trait everywhere, Extism mechanisms behind wasm32 only)
//! ```
//!
//! Module map: [`contract`] is the node's vocabulary and the response document, [`paths`] the
//! separator-neutral path text helpers, [`similarity`] the name-similarity gate, [`plan`] the four
//! dissolution planners, [`execute`] the write loop and the undo journal, [`history`] the journal's parse,
//! dump and id rules, [`host`] the capability seam plus the wasm shim, [`run`] the nine-action dispatch
//! the entry point calls, and [`builtin`] the ADR-0073 registration plus the bridge from the shared host
//! seam to [`host::DissolvefHost`].

pub mod builtin;
pub mod contract;
pub mod criteria;
pub mod document;
pub mod history;
pub mod host;
pub mod paths;
pub mod plan;
pub mod run;
pub mod similarity;

mod execute;

#[cfg(test)]
mod in_memory_host;
#[cfg(test)]
mod node_tests;

pub use contract::{
    DissolvefAction, DissolvefConflictMode, DissolvefInput, DissolvefMediaType, DissolvefMode,
    DissolvefRunOptions, DissolvefRunRequest, DissolvefRunScope, NormalizedDissolvefInput,
    normalize_dissolvef_input,
};
pub use criteria::{
    filter_blocked_groups, has_extension, is_dissolvef_archive, is_dissolvef_image,
    is_dissolvef_video, is_enabled_media, is_first_level, normalize_conflict, selected_dissolve_modes,
    skip_reason_for_path,
};
pub use document::{
    CANCELLED_STAT_KEY, DissolveUndoMode, DissolveUndoOperation, DissolveUndoRecord, DissolvefData,
    DissolvefDirEntry, DissolvefItemKind, DissolvefOperation, DissolvefPathInfo, DissolvefPlanItem,
    DissolvefPlanStatus, DissolvefResult,
};
pub use host::DissolvefHost;
pub use plan::build_dissolvef_plan;
pub use run::run_dissolvef;
pub use similarity::{calculate_dissolvef_similarity, check_dissolvef_similarity};
