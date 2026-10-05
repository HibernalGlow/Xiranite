//! The node's published identity and the boundary facts a host cross-checks.
//!
//! Two documents live here and neither is invented:
//!
//! * the registry `def`, which is `packages/nodes/linedup/src/index.ts:4-12` field for field — `id`,
//!   `name`, `version`, `category`, `description`, `icon`, `keywords`. The React card and the module
//!   registry read it, so `keywords` keeps `dedupe` even though the dedupe happens inside
//!   [`crate::filter_core`] rather than as an action of its own.
//! * the plugin descriptor, which is the machine-readable answer to "what will this isolate import and
//!   export", derived from the same constants the manifest and the shim use. There is one producer of
//!   each list and `tests/manifest_contract.rs` diffs it against `manifest.toml`.
//!
//! The `help` block is **not** duplicated here: `definition.json` carries it verbatim from
//! `node-definitions/linedup.json`, and ADR-0069 makes that file the one vocabulary the CLI, the TUI
//! and the GUI read. Re-emitting it from Rust would create the drift the same ADR forbids.

use serde_json::{Value, json};

/// The node id, which is also the `manifest.toml` `id`, the plugin directory name and the key in
/// `docs/xiranite-target-node-manifest.json`.
pub const PLUGIN_ID: &str = "linedup";
/// ADR-0068's `pluginVersion`: this node's own release, which is `index.ts:7` `version`.
pub const PLUGIN_VERSION: &str = "0.1.0";
/// ADR-0068's `pluginApiVersion`, spelled `backend_api`: the Plugin API this shim was written against.
/// `crates/xiranite-plugin-api` publishes 1.0.0, and a manifest carries `major.minor`.
pub const PLUGIN_API_VERSION: &str = "1.0";
/// ADR-0068's `runtimeVersion`, spelled `backend.runtime_version`: the Extism build this port was
/// measured on. ADR-0071 §2 ran its probes through `extism` 1.30.0 on this machine, and
/// `crates/nodes/dissolvef/manifest.toml:10` records the same value.
pub const EXTISM_RUNTIME_VERSION: &str = "1.30.0";

/// One wasm page, the unit `memory_max_pages` counts.
pub const WASM_PAGE_BYTES: u64 = 64 * 1024;
/// `manifest.toml` `[backend] memory_max_pages`, the Extism-side half of ADR-0066's memory ceiling
/// (`wasmtime::ResourceLimiter`).
pub const MEMORY_MAX_PAGES: u32 = 256;
/// The same ceiling in bytes, so a plugin-side guard and the manifest cannot drift by a page.
pub const MEMORY_MAX_BYTES: u64 = MEMORY_MAX_PAGES as u64 * WASM_PAGE_BYTES;

/// `manifest.toml` `[backend] entry`: the module the host installs.
pub const WASM_FILE_NAME: &str = "linedup.wasm";

/// The manifest's `[backend] entry_point`: the zero-parameter `() -> i32` export the Extism Rust host
/// calls (ADR-0068 "Settled shape").
pub const LINEDUP_RUN_ENTRY_POINT: &str = "linedup_run";
/// The defaulting rule of `LinedupInput::from_json`, with no filesystem and no checkpoint.
pub const LINEDUP_NORMALIZE_ENTRY_POINT: &str = "linedup_normalize_input";
/// `definition.json`'s `previewExport: "preview"` (`interaction.ts`'s `preview` callback).
pub const LINEDUP_PREVIEW_ENTRY_POINT: &str = "linedup_preview";
/// `definition.json`'s `resultExport: "result_view"` (`interaction.ts`'s `result` callback).
pub const LINEDUP_RESULT_VIEW_ENTRY_POINT: &str = "linedup_result_view";
/// The identity, entry-point and capability document.
pub const LINEDUP_DESCRIBE_ENTRY_POINT: &str = "linedup_describe";

/// Every document entry point the module exports, in the order the descriptor publishes them.
pub const LINEDUP_ENTRY_POINTS: [&str; 5] = [
    LINEDUP_RUN_ENTRY_POINT,
    LINEDUP_NORMALIZE_ENTRY_POINT,
    LINEDUP_PREVIEW_ENTRY_POINT,
    LINEDUP_RESULT_VIEW_ENTRY_POINT,
    LINEDUP_DESCRIBE_ENTRY_POINT,
];

/// The capabilities this plugin imports, and the manifest declares. Exactly one, and
/// `tests/manifest_contract.rs` refuses a drift in either direction.
pub const LINEDUP_HOST_FUNCTIONS: [&str; 1] = ["xiranite.operation.checkpoint"];

/// The definition's logical export names mapped to the wasm exports that serve them.
///
/// `node_definition.rs:632-635` describes `previewExport`/`resultExport` as "plugin export" names, and
/// a face that reads `definition.json` literally would ask for `preview`. Every Xiranite wasm export is
/// node-prefixed because one bundle of exports serves several nodes in a pooled host
/// (`crates/nodes/dissolvef/src/host.rs:590` exports `dissolvef_run`, not `run`), so this table is the
/// resolution step and it is published instead of being assumed by each face.
#[must_use]
pub fn export_bindings() -> Value {
    json!({
        "preview": LINEDUP_PREVIEW_ENTRY_POINT,
        "result_view": LINEDUP_RESULT_VIEW_ENTRY_POINT,
        "run": LINEDUP_RUN_ENTRY_POINT,
    })
}

/// `index.ts:4-12` `def`, as the registry document `HeadlessNodePackage` expects.
#[must_use]
pub fn node_description() -> Value {
    json!({
        "id": PLUGIN_ID,
        "name": "Linedup",
        "version": PLUGIN_VERSION,
        "category": "text",
        "description": "Filter source lines by removing any line containing a filter token.",
        "icon": "Filter",
        "keywords": ["line", "filter", "dedupe", "text"]
    })
}

/// What this plugin is, calls and exports — the document a host compares against `manifest.toml`.
#[must_use]
pub fn plugin_descriptor() -> Value {
    json!({
        "id": PLUGIN_ID,
        "pluginVersion": PLUGIN_VERSION,
        "pluginApiVersion": PLUGIN_API_VERSION,
        "runtimeVersion": EXTISM_RUNTIME_VERSION,
        "runtime": "extism",
        "entry": WASM_FILE_NAME,
        "entryPoint": LINEDUP_RUN_ENTRY_POINT,
        "entryPoints": LINEDUP_ENTRY_POINTS.to_vec(),
        "hostFunctions": LINEDUP_HOST_FUNCTIONS.to_vec(),
        "exportBindings": export_bindings(),
        "memoryMaxPages": MEMORY_MAX_PAGES,
        "memoryMaxBytes": MEMORY_MAX_BYTES,
        "allowedPaths": Vec::<String>::new(),
        "reportsProgress": false,
        "publishesOutputPath": false,
        "actions": ["filter"],
        "portedFrom": "@xiranite/node-linedup",
        "portedThrough": "packages/nodes/linedup/src/{index.ts,core.ts,interaction.ts,cli.ts}",
    })
}
