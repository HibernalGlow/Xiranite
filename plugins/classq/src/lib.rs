//! ClassQ keyword-folder wait routing, ported from `packages/nodes/classq` to a standalone Extism WASM plugin.
//!
//! ClassQ answers one question: *which folders have already been reviewed?* A folder whose name contains a keyword
//! (`already`) marks its parent as processed, so everything sitting beside it belongs in a `wait` folder. `plan`
//! reports that transfer list, `classify` performs it. The node is a query surface over a directory tree, which is
//! why the tests in `tests/` are organised around ordering, filters, empty results and result-set size rather than
//! around file-writing cleverness.
//!
//! ## What is pure here, and what touches the machine
//!
//! ADR-0071 moved file IO out of the capability vocabulary: the host turns WASI on for this module and grants the
//! roots the manifest authorizes, so reading a listing and moving a folder are `std::fs` calls, not host functions.
//!
//! - **Pure Rust**: normalization and defaulting, the two separator rules, path text, the keyword walk, the conflict
//!   rule, the eight counters, the result messages, the validation rules, the danger gate, `preview` and
//!   `result_view`.
//! - **Machine work**: `metadata`/`read_dir`/`create_dir_all`/`rename`/`copy` in [`std_file_system`], plus the two
//!   host calls in [`wasm_plugin`] — `xiranite.operation.checkpoint` and `xiranite.operation.emit`, which are the
//!   only capabilities this plugin declares.
//!
//! ## Port map
//!
//! | TypeScript | Rust |
//! | --- | --- |
//! | `core.ts:9-19` `ClassqInput`, `:21-64` records | [`contract`] |
//! | `core.ts:79-91` `normalizeClassqInput`, `:237-251` text helpers | [`input_normalization`], [`text_splits`], [`path_text`] |
//! | `core.ts:93-120` `runClassq` | [`run::run_classq`] |
//! | `core.ts:122-158` `buildClassqPlan`, `:160-169` `findKeywordFolders`, `:171-235` rows and counters | [`plan`] |
//! | `core.ts:66-75` `ClassqRuntime`, `platform.ts:5-33` | [`runtime`] (seam), [`std_file_system`] (the node's IO), [`in_memory_runtime`] (the vitest double) |
//! | `interaction.ts:5-31` schema, validator, danger gate, preview, result | [`interaction_rules`] |
//! | `cli.ts:48`'s counter lines | [`run::classq_preflight`], [`interaction_rules::classq_result_view`] |
//! | `index.ts:4-12` `def` | [`plugin_entry::classq_node_description`] |
//! | `help.ts:1-74` | `definition.json` `help`, quoted not reworded; `tests/definition_contract.rs` checks the quote |
//!
//! ## The entry point
//!
//! [`wasm_plugin`] exports `classq_run` as a **zero-parameter** function returning `i32`, because the official Extism
//! Rust host calls exports with no arguments and `crates/xiranite-extism-adapter/src/compiled.rs:129` only accepts
//! `(0,1)->i32`; `0` means "the document on the output is the answer" and a non-zero return carries an `error_set`
//! message (ADR-0068's measured convention, restated in AGENTS.md). The other four exports named by
//! [`plugin_entry::CLASSQ_ENTRY_POINTS`] follow the same convention. `manifest.toml`'s `backend.entry_point` is the
//! same string, and `tests/manifest_contract.rs` fails if the two drift.
//!
//! ## Where the boundary bends, and why
//!
//! Paths cross as text, not as `PathToken`s, because the preserved request contract (`nodeRunRequestSchema.input`) and
//! `ClassqPlanItem`'s own fields are path text the React card and the old CLI already speak. Containment is therefore
//! not the plugin's job: the host binds each authorized root as a preopen from `allowed_paths`, and ADR-0071 §2
//! measured that a write into a `ro:` preopen, a `..` escape, and an ungranted path are refused by the engine with
//! errno 58/63/44. A path the host did not grant reaches [`runtime::ClassqFileSystem::path_info`] as
//! `exists: false`, which is the same `root_not_directory` row the TypeScript produced for a mistyped root.
//!
//! ## Memory budget (`manifest.toml` `memory_max_pages = 256` = 16 MiB)
//!
//! One run holds three linear structures: the keyword-folder list, the sibling listings, and the item rows
//! (`ClassqPlanItem` is nine strings plus three small enums). A row with three 120-byte paths costs roughly 700 bytes
//! of `String` plus 200 of `Vec` overhead, so 256 pages carries about 18 000 rows — several thousand reviewed folders
//! with their siblings. The keyword walk is iterative ([`plan`]'s frame stack) so depth spends this heap rather than
//! the wasm stack, and a listing is never buffered beyond one directory. `tests/plan_cases.rs` asserts a 200-row
//! result set arrives whole, because a `slice(0, 80)` in a display layer (`cli.ts:48`) is the one truncation this
//! node has ever had and it must not leak into the contract.
//!
//! ## Deviations from the TypeScript behaviour, on purpose
//!
//! 1. `xiranite.operation.checkpoint` yields are new: ADR-0066's pause/cancel needs them and the in-process runner
//!    could be awaited instead. A cancellation mid-apply keeps the rows that already transferred
//!    ([`run`]'s module docs); a cancellation before the walk answers the plain `failure` document.
//! 2. The keyword walk is iterative with a visited-directory set where `core.ts:160-169` recursed without one. Same
//!    pre-order output, no stack trap, no symlink-cycle burn.
//! 3. `plugin_entry`'s response keeps `nodeRunResponseSchema`'s `{ result, events }` pair (`packages/shared/src/index.ts:148-151`)
//!    while the same events stream through `xiranite.operation.emit`, because `crates/xiranite-plugin-api/src/invocation.rs:5-9`
//!    forbids a host that only learns progress from the reply, not because the reply needs both.
//! 4. `interaction.ts:22`'s dashboard closure cannot be expressed by the published definition language (no join and
//!    no conditional in `ValueSource`), which is why `definition.json` carries no `dashboard` block. The content
//!    survives as [`interaction_rules::classq_dashboard`] instead of being re-invented per face.

pub mod contract;
pub mod in_memory_runtime;
pub mod input_normalization;
pub mod interaction_rules;
pub mod path_text;
pub mod plan;
pub mod plugin_entry;
pub mod run;
pub mod runtime;
pub mod std_file_system;
pub mod text_splits;

/// The Extism border: `extism:host/env` blocks, the two capability imports and the zero-parameter exports. Compiled
/// only for a wasm32 target, so `cargo test` on the host runs the same pure core and the same `plugin_entry` with no
/// imports to satisfy (ADR-0071's `wasm32-wasip1` artifact is what carries this module).
#[cfg(target_arch = "wasm32")]
pub mod wasm_plugin;

pub use contract::{
    ClassqAction, ClassqData, ClassqDirEntry, ClassqExistingPolicy, ClassqItemKind, ClassqPathInfo, ClassqPlanItem,
    ClassqPlanStatus, ClassqResultView, ClassqRunEvent, ClassqRunEventKind, ClassqRunResult, ClassqStage,
    ClassqTransferMode,
};
pub use input_normalization::{
    ClassqDryRun, ClassqInput, ClassqPathList, NormalizedClassqInput, clean, normalize_classq_input, parse_list,
    split_delimited, unique_clean,
};
pub use interaction_rules::{
    ClassqDangerPrompt, ClassqFieldValues, ClassqLanguage, ClassqRuleViolation, classq_danger_prompt,
    classq_input_from_field_values, classq_preview, classq_result_view, default_classq_field_values,
    is_dangerous, validate_classq_input, validate_declared_rules,
};
pub use path_text::{
    inferred_path_separator, join_path, name_contains_keyword, normalize_path_key, path_basename, path_dirname,
    path_relative,
};
pub use plan::{build_classq_data, build_classq_plan, find_keyword_folders};
pub use plugin_entry::{
    CLASSQ_DESCRIBE_ENTRY_POINT, CLASSQ_ENTRY_POINTS, CLASSQ_HOST_FUNCTIONS, CLASSQ_NORMALIZE_ENTRY_POINT,
    CLASSQ_PREVIEW_ENTRY_POINT, CLASSQ_RESULT_VIEW_ENTRY_POINT, CLASSQ_RUN_ENTRY_POINT, ForwardingClassqEventSink,
    classq_input_value_of, classq_node_description, classq_result_of_run_response, describe_classq_plugin,
    normalize_classq_request_text, preview_classq_request_text, result_view_request_text, run_classq_request,
    run_classq_request_text,
};
pub use run::{
    CLASSQ_APPLYING_MESSAGE, CLASSQ_CANCELLED_MESSAGE, CLASSQ_CANCELLED_REASON, CLASSQ_NO_ROOTS_MESSAGE,
    CLASSQ_SCANNING_MESSAGE, ClassqPreflight, failure_classq_result, run_classq, synthetic_failure_item,
};
pub use runtime::{
    AlwaysContinueClassqRunControl, ClassqCheckpointOutcome, ClassqEventSink, ClassqFileSystem, ClassqPhase,
    ClassqRunControl, ClassqRuntimeError, NoopClassqEventSink,
};
pub use std_file_system::{MAX_COPY_DEPTH, StdClassqFileSystem};
