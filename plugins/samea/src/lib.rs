//! `samea` — extract artist metadata from archive names and organize matching archives, ported from
//! `packages/nodes/samea` to a standalone Extism WASM plugin.
//!
//! Provenance is the node's own TypeScript, which is the behavioural spec:
//! `core.ts` (254 lines), `interaction.ts` (the terminal's semantics), `help.ts` and `index.ts` (the two
//! self-authored documents), `platform.ts` (the machine surface) and `core.test.ts` (the cases reproduced
//! in `tests/core_cases.rs`). `cli.ts` and `Tui.tsx` are not ported: ADR-0063 deletes the Bun CLI runtime
//! they belong to, and their replacements are `crates/xiranite-cli-runtime`/`xiranite-tui-runtime` reading
//! this node's published `definition.json` (ADR-0069).
//!
//! ## What the node does
//!
//! Scan the archive roots the caller names, read `[Circle (Artist)]`-style metadata out of every
//! `.zip`/`.rar`/`.7z` name, count each artist across the run, drop the ones under `minOccurrences` or on a
//! blacklist, and move the rest into a per-artist folder — under `[00画师分类]` when `centralize` is set.
//! `plan` and any dry run answer with that plan and touch nothing; `classify` with `dryRun: false` applies
//! it (`node-definitions/samea.json:363-384`).
//!
//! ## The file-IO split, after ADR-0071
//!
//! `platform.ts:1` is the only Node dependency in the whole package and it is the feasibility audit's
//! evidence line. Those four effects (`stat`, `readdir`, `mkdir`, `rename`) are now `std::fs` calls against
//! the WASI preopens the host grants from this plugin's `allowed_paths` — no `xiranite.fs.*` host function
//! exists any more, and this crate does not need one. What stays host-side is product semantics only:
//! `xiranite.operation.checkpoint` (ADR-0066 pause/cancel) and `xiranite.operation.emit` (the progress
//! events `core.ts:99` pushed through `onEvent`).
//!
//! | TypeScript | Rust |
//! | --- | --- |
//! | `core.ts:80` `normalizeSameaInput` | `input::normalize_samea_input` |
//! | `core.ts:99` `runSamea` | `run::run_samea` |
//! | `core.ts:128` `buildSameaPlan` | `plan::build_samea_plan` |
//! | `core.ts:171` `collectArchives` | `plan::collect_archives` (frame stack, see `plan` docs) |
//! | `core.ts:200` `buildGroups` | `plan::build_groups` |
//! | `core.ts:212` `extractArtist` | `artist::extract_artist` |
//! | `core.ts:226` `summarize` | `plan::summarize` |
//! | `core.ts:249-253` text/number helpers | `js_value`, `input::{clean, parse_list, clamp_int}` |
//! | `platform.ts:5` `createNodeSameaRuntime` | `fs_runtime::NativeSameaFileSystem` |
//! | `platform.ts:14` `join`/`dirname`/`basename` | `path_tools` (WASI view, ADR-0071 §5) |
//! | `interaction.ts:43-48` bindings/validate/preview/danger/result | `definition` |
//! | `index.ts:4` `def`, `help.ts:3` `help` | `node_metadata` |
//!
//! ## Capability surface and why it is two names
//!
//! `SAMEA_HOST_FUNCTIONS` in [`plugin_entry`] is the whole import list: `xiranite.operation.checkpoint` and
//! `xiranite.operation.emit`. SameA reads no clock, spawns no command, resolves no path token (its paths
//! arrive as the request's own `paths`/`listText` fields, which is what `allowed_paths` authorizes), and
//! takes no scheduler lease — `plugins/timeu/src/lib.rs` records why a lease cannot be held across one
//! boundary call today. `tests/manifest_contract.rs` fails if `manifest.toml` and that list drift.
//!
//! ## Memory budget (`memory_max_pages = 256` = 16 MiB)
//!
//! One run holds three linear structures: the collected entries, the groups, and the plan items — each entry
//! carries four path strings. A 260-byte path costs roughly 1.2 kB across those three (plus the request
//! document and the `std::fs` read buffers), so 10 000 archives land near 12 MiB. That is the same ceiling
//! `plugins/timeu/manifest.toml` ships with, and the same honest note applies: beyond it the isolate traps on
//! the `wasmtime::ResourceLimiter` (ADR-0071 §3) rather than failing gracefully, so a library larger than
//! that needs the host to raise the ceiling per call, not this crate to shrink its copies.
//!
//! ## Entry convention
//!
//! Zero parameters, `i32` exit code, `0` meaning "the output block is the answer" — the convention the
//! engine enforces (`crates/nodes/dissolvef/src/host.rs:578-589`, ADR-0068) and the adapter can drive
//! (`crates/xiranite-extism-adapter/src/compiled.rs:27-35`). Every failure that has a shape — a bad request,
//! a refused preopen, a cancelled checkpoint — is answered as a `nodeRunResponseSchema` document, never as a
//! trap.
//!
//! ## Deliberate differences from the TypeScript
//!
//! 1. Cooperative checkpoints, at each directory listing and each move (ADR-0066). A `Cancelled` answer
//!    stops the run and reports the partial plan.
//! 2. The scan uses a heap frame stack instead of native recursion, so a symlink cycle cannot trap the guest.
//! 3. `regexBlacklist` is evaluated by the Rust `regex` crate; an ECMAScript-only pattern compiles to
//!    nothing and never matches, which is the same outcome `core.ts:248`'s `catch` gave an invalid pattern.
//! 4. Group tie-break order is a case-folded comparison rather than ICU `localeCompare` (`core.ts:209`), and
//!    `fs_runtime` sorts directory listings so a run reproduces itself. Neither changes any verdict.
//! 5. An un-spreadable `paths` value (which threw outside `core.ts`'s `try`) is answered as a failed result
//!    document, per ADR-0068's "capability failures are data".

pub mod artist;
pub mod contract;
pub mod definition;
pub mod fs_runtime;
pub mod fs_surface;
pub mod input;
pub mod js_value;
pub mod memory_fs;
pub mod node_metadata;
pub mod path_tools;
pub mod plan;
pub mod plugin_entry;
pub mod run;

pub use contract::{
    DEFAULT_ARCHIVE_EXTENSIONS, DEFAULT_ARTIST_BLACKLIST, DEFAULT_PATH_BLACKLIST,
    MAX_OCCURRENCES, MIN_OCCURRENCES, NO_ARCHIVE_ROOTS_MESSAGE, NO_PLAN_MESSAGE, SameaAction,
    SameaArtistGroup, SameaData, SameaDirEntry, SameaGroupStatus, SameaPathInfo, SameaPlanItem,
    SameaPlanStatus, SameaRunEvent, SameaRunResult,
};
pub use definition::{
    ACTION_OPTIONS, PATHS_MINIMUM_LINES, SameaLanguage, danger_prompt, is_dangerous, line_count,
    preview_lines, result_view, result_view_lines, transform_as_boolean, transform_as_integer,
    transform_lines, transform_trim, validate_action, validate_input, validate_min_occurrences,
    validate_paths_text,
};
pub use fs_runtime::NativeSameaFileSystem;
pub use fs_surface::{
    CancelAfterRunControl, CheckpointOutcome, CollectingEventSink, ContinueThroughRunControl,
    NoopEventSink, SameaEventSink, SameaFileSystem, SameaIoError, SameaRunControl,
};
pub use input::{NormalizedSameaInput, SameaInputError, clamp_int, clean, normalize_samea_input, parse_list, unique_clean};
pub use memory_fs::MemoryFileSystem;
pub use path_tools::{normalize_path, path_basename, path_dirname, path_join};
pub use plan::{CENTRALIZE_FOLDER, CollectedEntry, PHASE_ORGANIZING, PHASE_SCANNING, SameaPlanError, build_samea_plan, summarize};
pub use run::{failure, organized_message, planned_message, run_samea, run_samea_normalized, success};

pub use plugin_entry::{
    SAMEA_DESCRIBE_ENTRY_POINT, SAMEA_ENTRY_POINTS, SAMEA_HOST_FUNCTIONS, SAMEA_NORMALIZE_ENTRY_POINT,
    SAMEA_PREVIEW_ENTRY_POINT, SAMEA_RESULT_ENTRY_POINT, SAMEA_RUN_ENTRY_POINT,
    ForwardingSameaEventSink, danger_samea_request_text, describe_samea_plugin,
    normalize_samea_request_text, preview_samea_request_text, result_view_request_text,
    run_samea_request, run_samea_request_text, samea_input_value_of, samea_language_of,
    samea_result_of_run_response,
};

// The Extism trio is target-gated: the boundary hands out block offsets, imports `extism:host/env` and
// `extism:host/user` symbols, and calls `std::fs` through WASI — none of that links or behaves on a 64-bit
// host, and a native `cargo test` must keep running the same domain core against
// [`memory_fs::MemoryFileSystem`]. `crates/nodes/dissolvef/src/host.rs:364` gates the same way.
#[cfg(target_arch = "wasm32")]
pub mod extism_boundary;
#[cfg(target_arch = "wasm32")]
pub mod plugin;
