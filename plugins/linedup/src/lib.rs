//! `linedup` — remove source lines that contain any filter token, ported to Rust as a standalone
//! Extism WASM plugin.
//!
//! Provenance is `packages/nodes/linedup/src/{index.ts,core.ts,interaction.ts,cli.ts,help.ts}` plus
//! `core.test.ts` and `cli.test.ts`, which are the behavioural spec: every case in `core.test.ts` is
//! reproduced in `tests/parity_cases.rs` and in the unit tests of the module that owns it, and the CLI
//! file flows (`cli.ts:417-451`, `cli.ts:307-357`) are reproduced here rather than left in a face, as
//! ADR-0069 requires.
//!
//! ## What this node is
//!
//! A **subtraction over two lists of text lines**. `definition.json:9-11`: "从源文本中移除包含任意过滤
//! token 的行" / "Remove source lines that contain any token from a filter list". One published action
//! (`filter`), four fields (`sourceText`, `filterText`, `caseSensitive`, `sort`), no danger gate
//! (`definition.json:157-159` mirrors `interaction.ts`'s `isDangerous: () => false`).
//!
//! The name is the one thing to distrust: `dedupe` is a keyword (`index.ts:11`) and `core.ts:72-93`
//! really does find duplicate *lines*, but there is no file hashing, no size comparison and no
//! duplicate-file grouping anywhere in this node. The node that finds duplicate files is `kavvka`, over
//! `native/czkawka-core`; nothing here calls it, and `grep`ing this node for a native binding finds
//! none (`artifacts/node-wasm-feasibility.json`: `nativeBindings: []`).
//!
//! ## The host-IO split
//!
//! The audit scores this node `wasm-with-host-io`, and its single evidence line is
//! `node:child_process` at `platform.ts:1` — the clipboard fallback of the *guided CLI* flow
//! (`cli.ts:247-259`), which is a face effect and stays in the CLI binary that ADR-0069 gives every
//! node. Everything else the node touches is ordinary files, and ADR-0071 moved those out of the
//! capability vocabulary: the host enables Extism's WASI, grants the operation's roots as preopens from
//! the manifest, and the guest calls `std::fs`. So:
//!
//! | TypeScript | Rust | Reaches the machine how |
//! | --- | --- | --- |
//! | `core.ts:15-116` | [`filter_core`], [`line_text`], [`natural_order`] | not at all |
//! | `interaction.ts` `runLinedupInteraction` | [`run::run_linedup`] | not at all |
//! | `cli.ts:408`/`cli.ts:455` `readFile` | [`file_access::NativeFiles::read_text`] | `std::fs::read_to_string` on a preopen |
//! | `cli.ts:341`/`cli.ts:441` `writeFile` | [`file_access::NativeFiles::write_text`] | `std::fs::write` on a preopen |
//! | pause/resume/cancel (host-side today) | [`run_control::LinedupRunControl::checkpoint`] | `xiranite.operation.checkpoint` |
//! | `platform.ts:8-33` clipboard | **not ported** | stays a CLI-face effect |
//!
//! No part of Linedup needs a host service. The `xiranite.*` capability surface it uses is one name, and
//! `manifest.toml` declares exactly that.
//!
//! ## Memory
//!
//! `memory_max_pages = 256` (16 MiB) in `manifest.toml`, the Extism-side half of ADR-0066's ceilings
//! (`wasmtime::ResourceLimiter`). A run holds the deduplicated source, the deduplicated tokens, the kept
//! lines, the removed lines, the removal details, the duplicate tally and the natural-sort keys: about
//! six copies of the source text plus per-key vectors. At 40 bytes per line that is roughly 13 MiB for a
//! 40 000-line paste, which is the ceiling's real limit and is why the batched pass in
//! [`filter_core::filter_lines_batched`] exists: a larger paste should checkpoint and be refused, not
//! trap.
//!
//! ## Deviations from the TypeScript, on purpose
//!
//! 1. **Collation.** [`natural_order`] reproduces `localeCompare(…, { numeric: true, sensitivity:
//!    "base" })` as case-folded, accent-folded, ASCII-numeric ordering with a stable tie. Documented
//!    there; the ordering-sensitive assertions in `core.test.ts` and `cli.test.ts` all pass unchanged.
//! 2. **Three endings have no TypeScript counterpart** — a refused file effect, a cancelled checkpoint
//!    and a request that is not JSON. All three come back as `success: false` result documents, never as
//!    a trap (ADR-0068's error rule).
//! 3. **Two request slots the `LinedupInput` interface does not have** — `unescapeLiteralNewlines` and
//!    `requireFilterTokens` — carry the CLI's own behaviour into the shared core instead of leaving it
//!    duplicated in a face. Both default to off, so the operation surface behaves exactly as
//!    `interaction.ts` did.
//! 4. **Trimming is ECMAScript's, not Rust's** ([`line_text`]): U+FEFF is trimmed, U+0085 is not.

pub mod contract;
pub mod file_access;
pub mod filter_core;
pub mod line_text;
pub mod memory_files;
pub mod natural_order;
pub mod node_metadata;
pub mod plugin_entry;
pub mod run;
pub mod run_control;

pub use contract::{
    LINEDUP_ACTION, LinedupData, LinedupInput, LinedupResult, LinedupResultView, TerminalLanguage,
    blank_source_message, empty_filter_message, result_view_of,
};
pub use file_access::{FileAccessFailure, LinedupFileSystem, NativeFiles, NoFiles};
pub use filter_core::{
    DiffRow, DiffStatus, DuplicateLine, DuplicateLines, FilterOutcome, ReadStats, RemovalDetail, analyze_read_lines,
    create_diff_rows, explain_removals, filter_lines, filter_lines_batched, find_duplicate_lines,
};
pub use line_text::{js_trim, normalize_line, split_lines, unique_non_empty_lines, unescape_literal_newlines};
pub use memory_files::MemoryFiles;
pub use natural_order::{NaturalSortKey, compare_natural, natural_sort};
pub use node_metadata::{
    LINEDUP_DESCRIBE_ENTRY_POINT, LINEDUP_ENTRY_POINTS, LINEDUP_HOST_FUNCTIONS, LINEDUP_NORMALIZE_ENTRY_POINT,
    LINEDUP_PREVIEW_ENTRY_POINT, LINEDUP_RESULT_VIEW_ENTRY_POINT, LINEDUP_RUN_ENTRY_POINT, MEMORY_MAX_BYTES,
    MEMORY_MAX_PAGES, PLUGIN_API_VERSION, PLUGIN_ID, PLUGIN_VERSION, node_description, plugin_descriptor,
};
pub use plugin_entry::{
    describe_linedup_plugin, linedup_input_value_of, linedup_operation_id_of, linedup_result_of_run_response,
    normalize_linedup_request_text, preview_linedup_request_text, result_view_linedup_request_text,
    run_linedup_request, run_linedup_request_text,
};
pub use run::run_linedup;
pub use run_control::{
    CHECKPOINT_LINE_BATCH, CancelAfterCheckpoints, CheckpointOutcome, ContinueThroughRunControl, LinedupRunControl,
};

// The Extism shim is feature- *and* target-gated: its imports resolve only inside an isolate, and the
// block offsets it hands the host are meaningless on a 64-bit host. `cargo test --features wasm`
// therefore still runs the pure core plus `plugin_entry`, and only
// `cargo build --features wasm --target wasm32-wasip1` compiles the shim.
#[cfg(all(feature = "wasm", target_arch = "wasm32"))]
pub mod extism_host;
