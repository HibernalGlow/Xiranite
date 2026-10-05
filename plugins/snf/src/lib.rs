//! `snf` — numbered folder sequence repair, ported to Rust as a standalone Extism
//! WASM plugin.
//!
//! Provenance is `packages/nodes/snf/src/{index.ts,core.ts,platform.ts}` plus its
//! two vitest files, which are the behavioural spec: `core.test.ts` cases are
//! reproduced in `tests/core_cases.rs` and in the unit tests of each module, and the
//! CLI/TUI adapters (`cli.ts`, `help.ts` rendering, `interaction.ts`, `Tui.tsx`) are
//! deliberately not ported because ADR-0063 deletes the Bun CLI runtime they belong
//! to. Their static documents — the node `def` and the `help` block — do ship, as
//! data, in `crate::node_metadata`.
//!
//! ## What the node does
//!
//! Given library roots or artist folders, it finds the numbered subfolders
//! (`1. CG`, `9. 同人志`), checks whether the sequence is continuous, and when it is
//! not, re-labels them from 1 in an order driven by `priorityKeywords`
//! (`contract::DEFAULT_PRIORITY_KEYWORDS`). `action: "rename"` with `dryRun: false`
//! applies the plan; `keepTimestamp` restores the source's access and modification
//! times onto the target afterwards.
//!
//! ## The host-IO split
//!
//! The AST feasibility audit classifies this node as `wasm-with-host-io`
//! (`artifacts/node-wasm-feasibility.json`, evidence line: `platform.ts:1` imports
//! `node:fs/promises`): `platform.ts` is the only file that touches the machine. That surface is exactly four effects, and they are
//! the only thing in this crate that reaches the machine — always as a host function,
//! never as `std::fs` (ADR-0063 principle 8, ADR-0066):
//!
//! | TypeScript runtime member | Trait method | Host function |
//! | --- | --- | --- |
//! | `pathInfo` (`platform.ts:7-14`) | `SnfFileSystem::path_info` | `xiranite.file.info` |
//! | `listDir` (`platform.ts:15-18`) | `SnfFileSystem::list_directory` | `xiranite.file.list` |
//! | `rename` (`platform.ts:19`) | `SnfFileSystem::rename_folder` | `xiranite.file.move` |
//! | `setTimes` (`platform.ts:20-22`) | `SnfFileSystem::set_folder_timestamps` | `xiranite.file.set-times` |
//! | `join`, `dirname`, `basename` (`platform.ts:23-25`) | pure, `crate::path_tools` | none |
//! | `onEvent` (`core.ts:85`) | `SnfEventSink::on_event` | `xiranite.emit` |
//! | pause/resume/cancel (host-side today) | `SnfRunControl::checkpoint` | `xiranite.checkpoint` |
//! | resource scheduler (`core.ts` has none) | `SnfRunControl::acquire_disk_admission` | `xiranite.scheduler.acquire` |
//!
//! `crate::memory_file_system` is the deterministic double for the core, so every
//! plan and rename rule in this crate is testable without a host at all, and
//! `crate::std_file_system` is the real one — `std::fs` on the WASI preopens the host
//! grants, tested against directories that actually exist (ADR-0071).
//!
//! ## Deliberate differences from TypeScript
//!
//! - `xiranite.checkpoint` is called at each artist-folder and each rename boundary,
//!   and a `Cancelled` answer stops the run and publishes the partial plan. The
//!   TypeScript core has no such branch because its host cancelled by dropping the
//!   worker; ADR-0066 makes the plugin responsible. See `crate::run`.
//! - A JSON document that cannot be deserialized at all fails the *call* rather than
//!   returning a failure result, mirroring `normalizeSnfInput` sitting outside
//!   `core.ts`'s `try` block (`core.ts:86` versus `core.ts:87`).
//! - `String(value ?? "")` coercion is reproduced for scalars (`javascript_text`) and
//!   unknown `action`/`mode` labels collapse to `plan`/`library` instead of being
//!   echoed back into `data.action`/`data.mode`.
//! - `\d` stays ASCII-only and the greedy separator run keeps ECMAScript's
//!   backtracking, so `３. CG` is not a numbered folder and `3..` is
//!   (`folder_sequence::parse_numbered_folder_name`).

pub mod contract;
pub mod file_system;
pub mod folder_sequence;
pub mod host_surface;
pub mod input_normalization;
pub mod javascript_text;
pub mod manifest_limits;
pub mod memory_file_system;
pub mod node_metadata;
pub mod path_tools;
pub mod plan;
pub mod run;
pub mod std_file_system;

#[cfg(feature = "wasm")]
pub mod plugin;

pub use contract::{
    DEFAULT_PRIORITY_KEYWORDS, NodeRunEvent, NodeRunEventKind, NormalizedSnfInput, SnfAction, SnfData,
    SnfDirEntry, SnfInput, SnfMode, SnfPathInfo, SnfPlanItem, SnfPlanStatus, SnfRunResult,
};
pub use file_system::{
    ContinueThroughRunControl, NoopEventSink, SnfEventSink, SnfFileAccessError, SnfFileSystem, SnfRunControl,
};
pub use folder_sequence::{NumberedFolderName, is_continuous_sequence, parse_numbered_folder_name};
pub use host_surface::CheckpointOutcome;
pub use input_normalization::normalize_snf_input;
pub use plan::{collect_artist_folders, plan_artist_folder};
pub use run::run_snf;

// The domain core, without any boundary layer, is what `core.ts` exported: `run_snf`
// plus the host-facing traits in `crate::file_system`. The JSON entry points in
// `crate::plugin` are a thin adapter over them, exactly as `index.ts` was a thin
// adapter over `core.ts`.
