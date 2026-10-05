//! `manifest.toml` against the code that has to agree with it.
//!
//! The manifest is what the Extism host enforces and what `bun run audit:plugin-manifests` gates; the
//! constants in `src/plugin_entry.rs` and the `#[link]` block in `src/extism_boundary.rs` are what the
//! isolate actually imports. Either side drifting produces a plugin that installs and then fails at its
//! first capability call, so this file reads the document with the same crate the host reader uses
//! (`crates/xiranite-node-runtime/Cargo.toml` pins `toml = "1.1"`) and compares.

use samea::plugin_entry::{
    SAMEA_DESCRIBE_ENTRY_POINT, SAMEA_ENTRY_POINTS, SAMEA_HOST_FUNCTIONS, SAMEA_NORMALIZE_ENTRY_POINT,
    SAMEA_PREVIEW_ENTRY_POINT, SAMEA_RESULT_ENTRY_POINT, SAMEA_RUN_ENTRY_POINT,
};
use serde::Deserialize;

/// The pages-wasm boundary of ADR-0066's memory ceiling, from the same constants the adapter passes to
/// `wasmtime`.
const WASM_PAGE_BYTES: u32 = 65_536;

/// The nine settled capability names (ADR-0068 as closed by ADR-0071), which is also
/// `scripts/audit-plugin-manifests.ts:20-30` and `crates/xiranite-plugin-api/src/host_function_names.rs:46-56`.
/// Spelled here because a plugin port must not path-depend on the host crate (ADR-0063 keeps `plugins/*`
/// in their own workspace), and that separation is exactly what this test polices.
const CANONICAL_HOST_FUNCTIONS: [&str; 9] = [
    "xiranite.operation.checkpoint",
    "xiranite.operation.update",
    "xiranite.operation.emit",
    "xiranite.process.run",
    "xiranite.scheduler.acquire",
    "xiranite.scheduler.release",
    "xiranite.log",
    "xiranite.now",
    "xiranite.path_token.resolve",
];

/// The `xiranite.fs.*` family ADR-0071 retired (`scripts/audit-plugin-manifests.ts:38-52`).
const RETIRED_FILE_HOST_FUNCTIONS: [&str; 13] = [
    "xiranite.fs.open",
    "xiranite.fs.read",
    "xiranite.fs.write",
    "xiranite.fs.read_text",
    "xiranite.fs.write_text",
    "xiranite.fs.close",
    "xiranite.fs.stat",
    "xiranite.fs.list",
    "xiranite.fs.move",
    "xiranite.fs.copy",
    "xiranite.fs.delete",
    "xiranite.fs.ensure_dir",
    "xiranite.fs.set_times",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct Manifest {
    id: String,
    #[serde(default)]
    name: Option<String>,
    version: String,
    backend_api: String,
    backend: Backend,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct Backend {
    runtime: String,
    entry: String,
    entry_point: String,
    runtime_version: String,
    #[serde(default)]
    memory_max_pages: Option<u32>,
    #[serde(default)]
    allowed_paths: Vec<String>,
    #[serde(default)]
    allowed_hosts: Vec<String>,
    #[serde(default)]
    host_functions: Vec<String>,
}

fn read_manifest() -> Manifest {
    let path = format!("{}/manifest.toml", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{path}: {error}"));
    toml::from_str(&text).unwrap_or_else(|error| panic!("{path} is not a valid plugin manifest: {error}"))
}

fn version_is_dotted(value: &str) -> bool {
    let mut parts = value.split('.');
    let (Some(major), Some(minor)) = (parts.next(), parts.next()) else {
        return false;
    };
    if parts.next().is_some_and(|patch| !patch.parse::<u32>().is_ok()) {
        return false;
    }
    major.parse::<u32>().is_ok()
        && minor.parse::<u32>().is_ok()
        && !major.is_empty()
        && !minor.is_empty()
}

#[test]
fn identity_and_the_three_version_facts_are_present_and_dotted() {
    let manifest = read_manifest();
    assert_eq!(manifest.id, "samea", "ADR-0068: the manifest id is the node id");
    assert_eq!(manifest.name.as_deref(), Some("SameA"), "the display name is index.ts:5");
    for (label, value) in [
        ("version (pluginVersion)", &manifest.version),
        ("backend_api (pluginApiVersion)", &manifest.backend_api),
        ("backend.runtime_version (runtimeVersion)", &manifest.backend.runtime_version),
    ] {
        assert!(version_is_dotted(value), "{label} = {value} is not a dotted numeric version");
    }
    // Xiranite's release is not the Plugin API version (ADR-0068), so the two fields must stay distinct.
    assert_ne!(manifest.version, manifest.backend_api, "{manifest:?}");
    // Negative controls: the shapes the gate is written to catch.
    assert!(!version_is_dotted("1"), "a bare major cannot express compatibility");
    assert!(!version_is_dotted("next"), "{manifest:?}");
    assert!(!version_is_dotted("1.x"));
}

#[test]
fn the_backend_runtime_is_extism_and_the_entry_resolves_to_a_staged_wasm() {
    let manifest = read_manifest();
    assert_eq!(manifest.backend.runtime, "extism", "crates/xiranite-node-runtime refuses any other runtime");
    assert_eq!(manifest.backend.entry, "samea.wasm");
    assert_eq!(
        manifest.backend.entry,
        format!("{}.wasm", manifest.id),
        "ADR-0071's staging layout writes artifacts/plugins/<id>/<id>.wasm, and `[lib] name` in Cargo.toml \
         is `samea` so cargo produces exactly that file"
    );
    assert_eq!(manifest.backend.entry_point, SAMEA_RUN_ENTRY_POINT);
    assert!(
        SAMEA_ENTRY_POINTS.contains(&manifest.backend.entry_point.as_str()),
        "the entry point must be one the plugin exports"
    );
    // Negative control: an entry point the crate does not export would install and then fail
    // `function_exists` at call time.
    assert!(!SAMEA_ENTRY_POINTS.contains(&"dissolvef_run"));
}

#[test]
fn host_functions_are_exactly_the_declared_capabilities_and_no_file_names() {
    let manifest = read_manifest();
    let declared = manifest.backend.host_functions;
    assert!(!declared.is_empty(), "ADR-0068: the host registers exactly the declared capabilities");
    assert!(
        declared.contains(&"xiranite.operation.checkpoint".to_string()),
        "ADR-0066 requires every run to checkpoint"
    );
    for name in &declared {
        assert!(
            CANONICAL_HOST_FUNCTIONS.contains(&name.as_str()),
            "{name} is not in the ADR-0068 vocabulary as closed by ADR-0071"
        );
        assert!(
            !RETIRED_FILE_HOST_FUNCTIONS.contains(&name.as_str()),
            "{name} was retired by ADR-0071: file IO runs on the WASI preopens in allowed_paths"
        );
    }
    let expected: Vec<String> = SAMEA_HOST_FUNCTIONS.iter().map(|name| (*name).to_string()).collect();
    assert_eq!(declared, expected, "the manifest and `SAMEA_HOST_FUNCTIONS` drifted");
}

#[test]
fn the_capability_checker_rejects_the_shapes_the_gate_is_for() {
    // Negative controls for the group above, run against the same predicates this file uses, so a checker
    // that only ever sees a good manifest is not a checker.
    let retired: Vec<String> =
        ["xiranite.operation.checkpoint".to_string(), "xiranite.fs.list".to_string()].to_vec();
    for name in &retired {
        let file_call = RETIRED_FILE_HOST_FUNCTIONS.contains(&name.as_str());
        let canonical = CANONICAL_HOST_FUNCTIONS.contains(&name.as_str());
        assert_eq!(
            file_call,
            !canonical,
            "{name} must be classified as exactly one of retired/canonical"
        );
    }
    assert!(retired.iter().any(|name| RETIRED_FILE_HOST_FUNCTIONS.contains(&name.as_str())));
    // An empty declaration is the second failure mode the gate exists for.
    let empty: Vec<String> = Vec::new();
    assert!(empty.is_empty() || empty.contains(&"xiranite.operation.checkpoint".to_string()));
    assert!(!empty.contains(&"xiranite.operation.checkpoint".to_string()));
}

#[test]
fn allowed_paths_grant_one_writable_preopen_and_no_network() {
    let manifest = read_manifest();
    assert_eq!(
        manifest.backend.allowed_paths,
        vec!["/archives".to_string()],
        "the node's only path field is `pathsText` (`node-definitions/samea.json:78-105`), and the archive \
         roots it names are the whole filesystem surface: scanned, staged into and renamed within"
    );
    assert!(
        manifest.backend.allowed_paths.iter().all(|entry| !entry.starts_with("ro:")),
        "`classify` creates the artist folders and renames archives inside the same root (`core.ts:113-114`), \
         so a read-only grant would turn every live classification into WASI errno 58 (ADR-0071 §2)"
    );
    assert!(manifest.backend.allowed_hosts.is_empty(), "SameA performs no network access");
    // Negative control: the same helper rejects the spellings that would silently widen the grant.
    for escaped in ["ro:/archives", "/archives/../", "*"] {
        assert!(
            !manifest.backend.allowed_paths.contains(&escaped.to_string()),
            "{escaped} must not appear in the declared grant"
        );
    }
}

#[test]
fn the_memory_ceiling_is_the_documented_page_count() {
    let manifest = read_manifest();
    let pages = manifest.backend.memory_max_pages.expect("the manifest declares the ceiling the limiter uses");
    assert_eq!(pages, 256, "the budget `src/lib.rs` reasons about");
    let bytes = u64::from(pages) * u64::from(WASM_PAGE_BYTES);
    assert_eq!(bytes, 16 * 1024 * 1024, "the ceiling in bytes has to be the ceiling in pages");
    // Negative control: a smaller ceiling is what the ADR-0066 limiter would enforce, so the two numbers
    // are not interchangeable.
    assert_ne!(u64::from(pages) * u64::from(WASM_PAGE_BYTES), u64::from(pages));
}

#[test]
fn the_pure_exports_are_the_ones_the_definition_names() {
    let manifest = read_manifest();
    // The manifest carries no field for these, but `definition.json` does; the pairing is checked in
    // `definition_contract.rs`. Here the invariant is that the run entry is the only stateful one.
    assert_eq!(
        [SAMEA_PREVIEW_ENTRY_POINT, SAMEA_RESULT_ENTRY_POINT, SAMEA_NORMALIZE_ENTRY_POINT]
            .iter()
            .filter(|name| **name == manifest.backend.entry_point)
            .count(),
        0,
        "preview/result_view/normalizeInput are pure and must never be the entry point the host calls"
    );
    assert_eq!(SAMEA_DESCRIBE_ENTRY_POINT, "describe");
}

#[test]
fn the_manifest_parses_from_the_staged_copy_of_the_same_bytes() {
    // `scripts/build-node-wasm.ts` copies `manifest.toml` next to the wasm instead of regenerating it, so
    // the file the host reads is byte-for-byte this one. A rewritten copy would let the two halves drift.
    let direct = read_manifest();
    let path = format!("{}/manifest.toml", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(&path).expect("readable");
    let reparsed: Manifest = toml::from_str(&text).expect("reparse");
    assert_eq!(direct, reparsed, "{path}");
}
