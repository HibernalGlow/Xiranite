//! TimeU file-timestamp backup/restore, ported from `packages/nodes/timeu` to a
//! standalone crate intended for Extism (ADR-0063, ADR-0066).
//!
//! ## What is pure here, what is not
//!
//! `artifacts/node-wasm-feasibility.json` classifies `timeu` as
//! `wasm-with-host-io`, with `node:fs/promises` at `platform.ts:1` as the only
//! infrastructure evidence. The split follows that verdict:
//!
//! - Pure Rust: input normalization and defaulting, path/list parsing, target
//!   ordering, restore/backup plan generation, record-file merge, the
//!   `JSON.stringify`-shaped record document, summary counters, result messages,
//!   and the UTC formatting of `backedUpAt`.
//! - Host work: `stat`, directory listing, record-file read/write, `utimes`, and
//!   the wall clock. A plugin never touches the filesystem or a clock directly
//!   (ADR-0063 principle 8), so those arrive through the [`TimeuRuntime`] trait,
//!   implemented natively by tests and by `host_runtime` under feature `wasm`.
//!
//! ## Port map
//!
//! | TypeScript | Rust |
//! | --- | --- |
//! | `core.ts:80` `normalizeTimeuInput` | `timeu_input::normalize_timeu_input` |
//! | `core.ts:145` `collectTimeuTargets` | `timeu_core::collect_timeu_targets` |
//! | `core.ts:168` `currentTimestampRecords` | `timeu_core::current_timestamp_records` |
//! | `core.ts:186`/`core.ts:190` plans | `timeu_core::build_backup_plan`, `timeu_core::build_restore_plan` |
//! | `core.ts:199`/`core.ts:208`/`core.ts:212` record file | `timeu_core::load_timestamp_records`, `timeu_core::dump_timestamp_records`, `timeu_core::merge_timestamp_records` |
//! | `core.ts:93` `runTimeu` | `timeu_core::run_timeu` |
//! | `platform.ts:5` `createNodeTimeuRuntime` | `host_runtime::HostTimeuRuntime` (feature `wasm`) |
//! | `index.ts:4` `def` | `timeu_core::timeu_node_description` |
//!
//! ## Host surface this plugin actually calls
//!
//! ADR-0071 retired the `xiranite.fs.*` family. What this plugin imports is now three capability
//! names — `xiranite.operation.checkpoint`, `xiranite.operation.emit`, `xiranite.now` — as
//! `module = "extism:host/user"` fields `extism_boundary` tabulates, and one thing it does itself:
//!
//! | Need | Where it is served now |
//! | --- | --- |
//! | `stat`, directory listing, record-file read/write, `mkdir -p`, `utimes` | `std::fs` in [`std_fs_runtime`], against the WASI preopens the host opens from the manifest's `allowed_paths` (ADR-0071 §2 measured `fs::metadata`/`read_dir`/`create_dir_all`/`read_to_string`/`write` all working, positional access included) |
//! | `xiranite.operation.checkpoint` | `extism_boundary::checkpoint`, once per work item (ADR-0066) |
//! | `xiranite.operation.emit` | `extism_boundary::emit` |
//! | `xiranite.now` | `extism_boundary::now_import` — the one thing the WASI sandbox genuinely cannot answer, because the plugin must not read a wall clock |
//!
//! `utimes` is the exception inside the file family: WASI preview1 serves no change-time syscall, so
//! `std::fs::File::set_times` is the only shape available and it is expected to report `Unsupported`
//! in a guest until the host serves it. That is recorded in [`std_fs_runtime`] rather than hidden.
//!
//! Not called, and deliberately not stubbed: `xiranite.scheduler.acquire` has no release counterpart
//! in ADR-0066, so a plugin cannot hold an admission permit for the duration of a call. Until that
//! lease contract is settled, timestamp batches run unprioritized and the host keeps admission at the
//! operation level.
//!
//! ## Where ADR-0066's "tokens, not bytes" rule bends
//!
//! Paths cross as text, not as `PathToken`s, because the preserved request contract
//! (`nodeRunRequestSchema.input`, and the record file's own `path` fields) is path
//! text that the React card and the old record files already speak. `manifest.toml`
//! therefore names the grant per operation (`allowed_paths = ["{operation:listText}"]`)
//! instead of a literal directory: the host opens one WASI preopen per authorized root, at
//! that root's own real path, which is the text the request already carries. Enforcement is
//! still two layers — the manifest plus the sandbox that refuses anything outside it — but the
//! second layer is now wasmtime's preopen table rather than a check inside a host function.
//!
//! The record document is the one payload whose bytes must reach the plugin, because
//! parsing it *is* the node's work. It is bounded metadata, not media, but the host
//! still has to cap it — a `timeu-timestamps.json` beyond the memory budget above
//! would trap rather than fail gracefully. If that cap is ever hit in practice, the
//! right shape is a host-side record store (`xiranite.timeu.records.load`/`.save`)
//! that keeps records as rows and hands the plugin a token, not a second copy of
//! this document.
//!
//! ## Memory budget (`manifest.json` `memoryMaxPages: 256` = 16 MiB)
//!
//! TimeU holds three linear structures for one run: the target list, the stored
//! record document parsed into `serde_json::Value`, and the plan. Measured against
//! the record shape `dump_timestamp_records` emits, a 260-byte path record costs
//! roughly 700 bytes once parsed (record struct plus `Value` map for unmapped
//! properties plus plan item) and about 400 bytes as target strings. That budgets
//! ~12 MiB for 10 000 deep-path files with headroom for the request and response
//! blocks, so 256 pages covers a realistic folder sweep. Beyond ~12 000 files the
//! host must either raise `memoryMaxPages` (Extism allows a per-call override) or
//! take over the record document as a host-side record service; a plugin growing
//! past its limit is an `OOM` trap, not a graceful error, so the limit is
//! documented rather than hidden.
//!
//! ## Deviations from the TypeScript behaviour, on purpose
//!
//! 1. Ordering uses [`compare_paths_naturally`] instead of ICU
//!    `localeCompare(..., { numeric: true, sensitivity: "base" })` (core.ts:165,
//!    core.ts:215): case-folded and numeric-aware, but no accent folding and a
//!    raw-text tie-break so the order is total and deterministic. Order only
//!    affects display and record-file key order; restore matching uses
//!    [`normalize_path_key`], which is a byte-faithful port.
//! 2. Error strings differ (`ENOENT: ...` becomes the host's own message, and
//!    `JSON.parse` text becomes serde_json's). They reach logs and the UI as
//!    display text only; result shape is unchanged.
//! 3. `collect_timeu_targets` descends iteratively with a visited-directory set,
//!    where the TypeScript recursed without one; a symlink cycle made the
//!    TypeScript core recurse until the stack died, and would burn WASM fuel here.
//! 4. Checkpoints (ADR-0066) are new yields with no TypeScript counterpart; a
//!    cancelled checkpoint surfaces as the `failure` result the TypeScript catch
//!    at `core.ts:140` produced for any thrown error.

mod js_value;
mod path_shape;
mod timeu_clock;
mod timeu_core;
mod timeu_input;
mod timeu_model;
mod timeu_runtime;

pub use js_value::{js_number_text, js_string_of_value, js_truthy};
pub use path_shape::{
    compare_paths_naturally, normalize_path_key, path_basename, path_dirname, path_join,
};
pub use timeu_clock::{TimeuClockError, iso8601_from_epoch_ms, js_math_round};
pub use timeu_core::{
    TIMEU_DEFAULT_RECORD_FILE_NAME, TIMEU_NO_PATHS_MESSAGE, TimeuCoreError, build_backup_plan,
    build_restore_plan, build_timeu_data, collect_timeu_targets, current_timestamp_records,
    default_record_path, dump_timestamp_records, failure_timeu_result, load_timestamp_records,
    mark_plan_success, merge_timestamp_records, run_timeu, run_timeu_into_result,
    run_timeu_normalized, success_timeu_result, timeu_node_description,
};
pub use timeu_input::{
    NormalizedTimeuInput, TimeuInput, clean, normalize_timeu_input, normalize_timeu_input_json,
    parse_list, unique_clean,
};
pub use timeu_model::{
    TIMEU_TIMESTAMP_RECORD_KEYS, TimeuAction, TimeuData, TimeuDirectoryEntry,
    TimeuNodeDescription, TimeuPathInfo, TimeuPlanItem, TimeuPlanOperation, TimeuPlanStatus,
    TimeuRunEvent, TimeuRunEventKind, TimeuRunResult, TimeuTimestampRecord, js_number_to_json_value,
};
pub use timeu_runtime::{
    CollectingTimeuEventSink, NoopTimeuEventSink, TimeuCheckpointOutcome, TimeuEventSink,
    TimeuHostError, TimeuRuntime,
};

/// The boundary JSON documents: pure, so they are unit-tested without a host.
pub mod plugin_entry;
pub use plugin_entry::{
    TIMEU_DESCRIBE_ENTRY_POINT, TIMEU_HOST_FUNCTIONS, TIMEU_NORMALIZE_ENTRY_POINT,
    TIMEU_RUN_ENTRY_POINT, ForwardingTimeuEventSink, describe_timeu_plugin, run_timeu_request,
    run_timeu_request_text, timeu_input_value_of, timeu_result_of_run_response,
};

// ADR-0071: the file half of the runtime seam is `std::fs`, which compiles and is tested on every
// target, because a preopen is a filesystem the sandbox can already see. It is deliberately not
// behind `feature = "wasm"`.
pub mod std_fs_runtime;
pub use std_fs_runtime::StdFilesystem;

// The wasm pair is feature- AND target-gated: the boundary hands out `u32` block
// offsets and imports `extism:host/user` functions, neither of which links or
// behaves on a 64-bit host. `cargo test --features wasm` therefore still runs the
// pure core, `plugin_entry` and `std_fs_runtime`, and only
// `cargo build --features wasm --target wasm32-wasip1` compiles the shim.
#[cfg(all(feature = "wasm", target_arch = "wasm32"))]
pub mod extism_boundary;
#[cfg(all(feature = "wasm", target_arch = "wasm32"))]
pub mod host_runtime;
#[cfg(all(feature = "wasm", target_arch = "wasm32"))]
pub mod plugin;

#[cfg(test)]
mod test_runtime;
#[cfg(test)]
mod tests;
