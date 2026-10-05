//! SoundW — microphone and recording-device switching through the SoundSwitch CLI, ported from
//! `packages/nodes/soundw` to a standalone Extism plugin crate (ADR-0063, ADR-0068, ADR-0071).
//!
//! ## What is pure here, what is not
//!
//! `artifacts/node-wasm-feasibility.json` classifies `soundw` as `wasm-with-host-io`, with
//! `node:child_process` at `platform.ts:1` and `node:fs/promises` at `platform.ts:3` as the two
//! evidence rows. ADR-0071 splits those two differently, and this crate follows the ADR rather than
//! the old `xiranite.fs.*` shape the earlier ports under `plugins/` still use:
//!
//! - **Pure Rust**: the action vocabulary and its argv table (`core.ts:12-18`), the pre-flight
//!   order, the stdout/stderr join and trim (`core.ts:22`), the timeout rewrite (`core.ts:24-27`),
//!   the profile-table parser (`core.ts:34-40`), the `muteState` rule (`core.ts:32`), the declared
//!   validation rules and `trimOrOmit` normalization (`interaction.ts:21,24`), the `preview` and
//!   `result_view` export bindings (`interaction.ts:25,27`) and the danger gate
//!   (`interaction.ts:26`). All of it runs against the [`SoundwRuntime`] seam.
//! - **WASI preopen**: the one `stat` the node performs, on the `soundSwitchPath` field, through
//!   `std::fs::metadata` in [`cli_locator`]. File IO is not a capability name (ADR-0071 decision 3),
//!   so no host function appears for it and `manifest.toml` grants the root read-only instead.
//! - **Host capability**: the CLI invocation itself, as one `xiranite.process.run` call against the
//!   registered command [`SOUNDW_REGISTERED_COMMAND`]. The guest cannot spawn — Extism's WASI
//!   answers `Unsupported` for `std::process::Command` (ADR-0071 §2) — and it cannot search PATH
//!   either, so `platform.ts:11-15`'s `which`/`where.exe` becomes the host's registration, not a
//!   second entry point.
//!
//! ## Port map
//!
//! | TypeScript | Rust |
//! | --- | --- |
//! | `core.ts:3-5` the input/data/result types | `soundw_model` |
//! | `core.ts:8-33` `runSoundw` | `soundw_core::run_soundw` |
//! | `core.ts:34-40` `parseProfiles` | `soundw_core::parse_profiles` |
//! | `core.ts:6` `SoundwRuntime` | `soundw_runtime::SoundwRuntime` |
//! | `platform.ts:7-16` `resolve` | `cli_locator::probe_cli_override` + `host_runtime` |
//! | `platform.ts:17-25` `run` | `host_runtime::HostSoundwRuntime::run` (`xiranite.process.run`) |
//! | `platform.ts:26-30` `decodeWindowsOutput` | the host, before `process.run` answers (see below) |
//! | `interaction.ts:20-24` fields, `validate`, `toInput` | `soundw_input` |
//! | `interaction.ts:9-12,25-27,31` labels, `preview`, `result`, `isDangerous` | `soundw_view` |
//! | `index.ts:3` `def` | `soundw_model::soundw_node_description` |
//! | `help.ts` | `definition.json` `help` block, quoted verbatim |
//!
//! ## Capability surface, and what is deliberately absent
//!
//! `manifest.toml` declares three names, and the manifest gate (`bun run audit:plugin-manifests`)
//! reads the same list this crate publishes in [`host_functions`]:
//!
//! | Import | Purpose |
//! | --- | --- |
//! | `xiranite.operation.checkpoint` | one yield before the invocation (ADR-0066) |
//! | `xiranite.operation.emit` | the two progress events `core.ts:20,31` produce (`reportsProgress: true`) |
//! | `xiranite.process.run` | the SoundSwitch CLI (ADR-0071 decision 5, an allowlist) |
//!
//! Not declared: `operation.update` (the node reports no phase beyond its events), `scheduler.*`
//! (one short command has nothing to admit against), `log` (its diagnostics are the run's
//! `output`/`errors`), `now` (`core.ts` never reads a clock), `path_token.resolve` (the node speaks
//! path text, which is what its own field has always been). `xiranite.fs.*` is not declared because
//! ADR-0071 retired the family; `host_functions::RETIRED_FILE_HOST_FUNCTIONS` and
//! `tests/manifest_contract.rs` keep that from coming back.
//!
//! ## Two things the host owns that the TypeScript used to do itself
//!
//! 1. **Console decoding.** `platform.ts:26-30` reads the CLI's bytes as `gb18030` on Windows and
//!    UTF-8 elsewhere. That is machine truth a `wasm32-wasip1` guest must not attempt (ADR-0071 §5),
//!    so `xiranite.process.run` answers with UTF-8 text and the host keeps the codepage rule.
//! 2. **Command registration.** Whether `SoundSwitch.CLI.exe` is reachable at all, and at which
//!    path, is the registration's answer. When the caller supplied a `soundSwitchPath` override the
//!    plugin checks it against its preopen first, which reproduces `core.ts:10-11`'s ordering —
//!    the CLI verdict is taken before the profile-name guard.
//!
//! ## Deviations from the TypeScript behaviour, on purpose
//!
//! 1. **An action spelling outside the eight is refused.** `core.ts:18` would have treated it as
//!    `status`; the published definition declares `oneOfDeclaredOptions`
//!    (`node-definitions/soundw.json:165-171`), and the refusal is a `failure` result document, not
//!    a trap. See `soundw_core`'s module note.
//! 2. **One checkpoint yield** exists between the pre-flight and the invocation. ADR-0066 requires
//!    it; the Bun host had a kill switch instead. A cancelled checkpoint answers the same failure
//!    shape as the other guards.
//! 3. **A blank `profileName` with no CLI registered** reports the profile-name sentence rather
//!    than the not-installed one. `core.ts:10-19` checked `which` before the name, and a guest has
//!    no `which` to check. The invariant the legacy test protects — `run` is never invoked with an
//!    empty `--name` (`core.test.ts:29-36`) — holds, and with a path override supplied the ordering
//!    is identical to the TypeScript. Pinned by `tests/parity_cases.rs`.

#![warn(missing_docs)]

pub mod cli_locator;
pub mod host_functions;
pub mod js_text;
pub mod plugin_entry;
pub mod soundw_core;
pub mod soundw_input;
pub mod soundw_model;
pub mod soundw_runtime;
pub mod soundw_view;

pub use cli_locator::{DEFAULT_CLI_FILE_NAME, PREOPEN_ALIAS, SoundwCliProbe, preopen_path_exists, probe_cli_override};
pub use host_functions::{
    CANONICAL_HOST_FUNCTIONS, HOST_FUNCTION_NAMESPACE, HOST_FUNCTION_OPERATION_CHECKPOINT,
    HOST_FUNCTION_OPERATION_EMIT, HOST_FUNCTION_PROCESS_RUN, MAX_OUTPUT_BYTES, MEMORY_MAX_PAGES,
    PROCESS_TIMEOUT_MS, RETIRED_FILE_HOST_FUNCTIONS, SOUNDW_HOST_FUNCTIONS, SOUNDW_REGISTERED_COMMAND,
    SoundwProcessRunRequest, SoundwProcessRunResponse, host_function_symbol,
};
pub use js_text::{
    js_join_streams, js_split_lines, js_trim, js_trim_option, matches_timeout_pattern,
    split_on_box_drawing, trimmed_or_none,
};
pub use plugin_entry::{
    ForwardingSoundwEventSink, SOUNDW_DESCRIBE_ENTRY_POINT, SOUNDW_ENTRY_POINTS,
    SOUNDW_NORMALIZE_ENTRY_POINT, SOUNDW_PREVIEW_ENTRY_POINT, SOUNDW_PREVIEW_EXPORT,
    SOUNDW_RESULT_VIEW_ENTRY_POINT, SOUNDW_RESULT_VIEW_EXPORT, SOUNDW_RUN_ENTRY_POINT,
    describe_soundw_plugin, normalize_soundw_request_text, preview_request_text,
    result_view_request_text, run_soundw_request, run_soundw_request_text, soundw_input_from_value,
    soundw_input_value_of, soundw_operation_id_of,
};
pub use soundw_core::{
    BACKGROUND_APP_MESSAGE, COMMAND_FAILED_MESSAGE, COMPLETED_MESSAGE, NOT_INSTALLED_MESSAGE,
    NO_PROFILES_MESSAGE, PROFILE_NAME_REQUIRED_MESSAGE, PROFILES_PREFIX, PROFILE_TABLE_BORDER,
    PROFILE_TABLE_HEADER, failure_message, parse_profiles, profiles_display, run_soundw,
    running_message,
};
pub use soundw_input::{
    DEFAULT_ACTION, NormalizedSoundwInput, SOUND_SWITCH_PATH_FIELD_ID, SoundwFieldViolation,
    SoundwInputRejection, declared_action_texts, normalize_soundw_input, normalize_soundw_values,
    parse_action_text, validate_profile_name, validate_soundw_input,
};
pub use soundw_model::{
    SoundwAction, SoundwData, SoundwInput, SoundwNodeDescription, SoundwRunEvent, SoundwRunResult,
    soundw_node_description,
};
pub use soundw_runtime::{
    CollectingSoundwEventSink, NoCliSoundwRuntime, NoopSoundwEventSink, SoundwBinaryResolution,
    SoundwCheckpoint, SoundwEventSink, SoundwProcessOutput, SoundwRuntime,
};
pub use soundw_view::{
    LABEL_DESCRIPTION, LABEL_NAME, LABEL_PATH, LABEL_PROFILE_NAME, RESULT_VIEW_MAX_LINES,
    SoundwDangerGate, SoundwResultView, action_label, is_dangerous, preview, result_view,
    soundw_action_label,
};

// The wasm trio is feature- AND target-gated: the boundary hands out `u64` block offsets and
// imports `extism:host/env` plus `extism:host/user`, neither of which links on a 64-bit host.
// `cargo test --features wasm` still runs the pure core plus `plugin_entry`, and only
// `cargo build --features wasm --target wasm32-wasip1` compiles the shim.
#[cfg(all(feature = "wasm", target_arch = "wasm32"))]
pub mod extism_boundary;
#[cfg(all(feature = "wasm", target_arch = "wasm32"))]
pub mod host_runtime;
#[cfg(all(feature = "wasm", target_arch = "wasm32"))]
pub mod plugin;
