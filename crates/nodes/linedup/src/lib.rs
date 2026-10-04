//! `linedup` — remove source lines that contain any filter token, as a native built-in node.
//!
//! Provenance is `packages/nodes/linedup/src/{index.ts,core.ts,interaction.ts,cli.ts,help.ts}` plus
//! `core.test.ts` and `cli.test.ts`, which are the behavioural spec: every case in `core.test.ts` is
//! reproduced in the `parity_cases` module and in the unit tests of the module that owns it, and the CLI
//! file flows (`cli.ts:417-451`, `cli.ts:307-357`) are reproduced here rather than left in a face, as
//! ADR-0069 requires.
//!
//! ## What this node is
//!
//! A **subtraction over two lists of text lines**. `plugins/linedup/definition.json:9-11`: "从源文本中
//! 移除包含任意过滤 token 的行" / "Remove source lines that contain any token from a filter list". One
//! published action (`filter`, [`contract::LINEDUP_ACTION`]), four fields (`sourceText`, `filterText`,
//! `caseSensitive`, `sort`), no danger gate (`definition.json:157-159` mirrors `interaction.ts`'s
//! `isDangerous: () => false`).
//!
//! The name is the one thing to distrust: `dedupe` is a keyword (`index.ts:11`) and `core.ts:72-93`
//! really does find duplicate *lines*, but there is no file hashing, no size comparison and no
//! duplicate-file grouping anywhere in this node. The node that finds duplicate files is `kavvka`, over
//! `native/czkawka-core`; nothing here calls it.
//!
//! ## Shape after ADR-0073
//!
//! One rlib, self-registered through `inventory` in [`builtin`]. The nine modules this crate has are the
//! business logic; the ~1,000 lines the wasm port carried around it are gone:
//!
//! | TypeScript | Rust | Reaches the machine how |
//! | --- | --- | --- |
//! | `core.ts:15-116` | [`filter_core`], [`line_text`], [`natural_order`] | not at all |
//! | `interaction.ts` `runLinedupInteraction` | [`run::run_linedup`] | not at all |
//! | `cli.ts:408`/`cli.ts:455` `readFile` | `NodeHost::read_text`, called from [`run`] | the host, per operation |
//! | `cli.ts:341`/`cli.ts:441` `writeFile` | `NodeHost::write_text`, called from [`run`] | the host, per operation |
//! | pause/resume/cancel (host-side today) | `NodeHost::checkpoint`, called from [`filter_core`] | in process |
//! | `platform.ts:8-33` clipboard | **not ported** | stays a CLI-face effect |
//!
//! `file_access.rs`, `memory_files.rs`, `run_control.rs`, `node_metadata.rs`, `plugin_entry.rs` and
//! `extism_host.rs` were deliberately not carried over; where one of them held behaviour a real run needs
//! — the file effects, the batch bound, the blank-request rule — that behaviour now lives either in the
//! module that uses it (`filter_core::CHECKPOINT_LINE_BATCH`) or in the seam call it became
//! (`builtin::LinedupNode::run`). Module-level docs name the exact source lines for each move.
//!
//! ## Memory
//!
//! The ceiling is `builtin::DESCRIPTOR`'s `max_live_bytes`, derived from the retired manifest's
//! `memory_max_pages = 256` (`plugins/linedup/manifest.toml:26`, i.e. 16 MiB). A run holds the
//! deduplicated source, the deduplicated tokens, the kept lines, the removed lines, the removal details
//! and the natural-sort keys: about six copies of the source text plus per-key vectors. At 40 bytes per
//! line that is roughly 13 MiB for a 40 000-line paste, which is the ceiling's real limit and is why the
//! batched pass in [`filter_core::filter_lines_batched`] exists: a larger paste should checkpoint and be
//! refused, not grow.
//!
//! ## Deviations from the TypeScript, on purpose
//!
//! 1. **Collation.** [`natural_order`] reproduces `localeCompare(…, { numeric: true, sensitivity:
//!    "base" })` as case-folded, accent-folded, ASCII-numeric ordering with a stable tie. Documented
//!    there; the ordering-sensitive assertions in `core.test.ts` and `cli.test.ts` all pass unchanged.
//! 2. **A request that is not JSON is a `NodeRunError`, not a result document.** The wasm entry answered
//!    with `success: false` because a guest could not otherwise report the failure without trapping; the
//!    seam has a typed arm for "no document was produced". A blank request still yields the blank-source
//!    document (`builtin::LinedupNode::run`).
//! 3. **Three endings have no TypeScript counterpart** — a refused file effect, a cancelled run and an
//!    unservable checkpoint. All three come back as `success: false` result documents, and a cancel never
//!    borrows a machine failure's wording (see `filter_core::yield_at_boundary`).
//! 4. **Two request slots the `LinedupInput` interface does not have** — `unescapeLiteralNewlines` and
//!    `requireFilterTokens` — carry the CLI's own behaviour into the shared core instead of leaving it
//!    duplicated in a face. Both default to off, so the operation surface behaves exactly as
//!    `interaction.ts` did.
//! 5. **Trimming is ECMAScript's, not Rust's** ([`line_text`]): U+FEFF is trimmed, U+0085 is not.

pub mod builtin;
pub mod contract;
pub mod filter_core;
pub mod line_text;
pub mod natural_order;
pub mod run;

#[cfg(test)]
mod parity_cases;
#[cfg(test)]
mod test_host;

pub use builtin::LinedupNode;
pub use contract::{
    LINEDUP_ACTION, LinedupData, LinedupInput, LinedupResult, LinedupResultView, TerminalLanguage,
    blank_source_message, empty_filter_message, result_view_of,
};
pub use filter_core::{
    BatchedFilterPass, CHECKPOINT_LINE_BATCH, DiffRow, DiffStatus, DuplicateLine, DuplicateLines, FilterOutcome,
    ReadStats, RemovalDetail, analyze_read_lines, create_diff_rows, explain_removals, filter_lines,
    filter_lines_batched, find_duplicate_lines,
};
pub use line_text::{js_trim, normalize_line, split_lines, unescape_literal_newlines, unique_non_empty_lines};
pub use natural_order::{NaturalSortKey, compare_natural, natural_sort};
pub use run::run_linedup;
