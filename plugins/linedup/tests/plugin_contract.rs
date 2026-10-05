//! The boundary this plugin promises, checked against the vocabulary the repository publishes.
//!
//! ADR-0068's whole point is that capability names, their import symbols and the checkpoint's ABI tags
//! have one source of truth — `crates/xiranite-plugin-api` — because the first five plugin ports
//! invented eight names for five capabilities and that is how an ABI forks. This crate cannot depend on
//! that crate (a plugin keeps its own workspace and its own lock, and the isolate must not grow a host
//! dependency), so the agreement is proven by reading the published table as text and diffing it
//! against what this crate compiles. If the Plugin API renames or renumbers anything, this test is what
//! says so before the wasm ships.

use std::path::Path;

use xiranite_plugin_linedup::node_metadata::{
    LINEDUP_DESCRIBE_ENTRY_POINT, LINEDUP_ENTRY_POINTS, LINEDUP_HOST_FUNCTIONS, LINEDUP_NORMALIZE_ENTRY_POINT,
    LINEDUP_PREVIEW_ENTRY_POINT, LINEDUP_RESULT_VIEW_ENTRY_POINT, LINEDUP_RUN_ENTRY_POINT, MEMORY_MAX_BYTES,
    MEMORY_MAX_PAGES, WASM_PAGE_BYTES, export_bindings, plugin_descriptor,
};
use xiranite_plugin_linedup::{CheckpointOutcome, NaturalSortKey};

/// The physical-line ceiling `AGENTS.md` puts on every maintained source file.
const MAX_SOURCE_LINES: usize = 1000;

fn api_crate(relative: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../crates/xiranite-plugin-api/src").join(relative)
}

fn read_api_source(relative: &str) -> String {
    let path = api_crate(relative);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{} must be readable; the Plugin API table is the single source: {error}", path.display()))
}

/// The `(logical name, import symbol)` pairs from `HOST_FUNCTION_SYMBOLS`.
fn published_symbols() -> Vec<(String, String)> {
    let text = read_api_source("host_function_names.rs");
    let start = text.find("pub const HOST_FUNCTION_SYMBOLS").expect("HOST_FUNCTION_SYMBOLS exists");
    text[start..]
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            let inner = trimmed.strip_prefix("(\"")?.strip_suffix("\"),")?;
            let (name, symbol) = inner.split_once("\", \"")?;
            Some((name.to_owned(), symbol.to_owned()))
        })
        .collect()
}

/// The `abi_code` arms of `impl AbiCode for CheckpointOutcome`.
fn published_checkpoint_codes() -> Vec<(String, u8)> {
    let text = read_api_source("checkpoint.rs");
    let block = text.find("impl AbiCode for CheckpointOutcome").expect("CheckpointOutcome has an AbiCode impl");
    let body = &text[block..];
    let end = body.find("fn try_from_abi_code").expect("the enum decodes too");
    body[..end]
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            let inner = trimmed.strip_prefix("Self::")?.strip_suffix(",")?;
            let (variant, code) = inner.split_once(" => ")?;
            Some((variant.to_owned(), code.trim().parse::<u8>().expect("an ABI tag is a small integer")))
        })
        .collect()
}

#[test]
fn the_declared_capabilities_are_exactly_the_published_vocabulary() {
    let published = published_symbols();
    assert_eq!(published.len(), 9, "ADR-0071 closed the vocabulary at nine names");
    assert!(!LINEDUP_HOST_FUNCTIONS.is_empty(), "a plugin that declares no capability cannot checkpoint");

    for name in LINEDUP_HOST_FUNCTIONS {
        assert!(
            published.iter().any(|(published, _)| published == name),
            "{name} is not a settled capability name"
        );
    }
}

#[test]
fn the_import_block_declares_exactly_the_declared_capabilities_with_the_flattened_symbol() {
    let shim = std::fs::read_to_string(plugin_path("src/extism_host.rs")).expect("src/extism_host.rs");
    let start = shim
        .find("#[link(wasm_import_module = \"extism:host/user\")]")
        .expect("the shim declares its capability imports in extism:host/user");
    let block = &shim[start..];
    let end = block.find('}').expect("the import block closes");
    let block = &block[..end];

    let published = published_symbols();
    for name in LINEDUP_HOST_FUNCTIONS {
        let symbol = published
            .iter()
            .find(|(published, _)| published == name)
            .map(|(_, symbol)| symbol.clone())
            .expect("a declared capability has a published symbol");
        assert_eq!(symbol, name.replace('.', "_"), "the flattening rule is the contract");
        assert!(
            block.contains(&format!("fn {symbol}(request: u64) -> u64")),
            "{name} must be imported as `{symbol}` with one block handle in and one value out"
        );
    }

    // Negative control: a capability the manifest does not declare must not be imported either, or the
    // host would refuse to link it (`compiled.rs:84-86` registers only what the manifest lists).
    for (name, symbol) in published {
        if LINEDUP_HOST_FUNCTIONS.contains(&name.as_str()) {
            continue;
        }
        assert!(!block.contains(&format!("fn {symbol}(")), "{name} is declared by no manifest but is imported anyway");
    }
    assert!(block.contains("xiranite_operation_checkpoint"), "the one capability this node uses");
    assert!(!block.contains("xiranite_fs_"), "ADR-0071 retired the file family; nothing may re-add it");
}

#[test]
fn the_checkpoint_tags_match_the_plugin_api_enum() {
    let published = published_checkpoint_codes();
    assert_eq!(published.len(), 3, "the outcome enum has three variants");
    assert_eq!(
        published.iter().map(|(variant, _)| variant.as_str()).collect::<Vec<&str>>(),
        vec!["Continue", "Paused", "Cancelled"],
        "and they are these three, in this order"
    );

    for (variant, code) in &published {
        let ours = match variant.as_str() {
            "Continue" => CheckpointOutcome::Continue,
            "Paused" => CheckpointOutcome::Paused,
            "Cancelled" => CheckpointOutcome::Cancelled,
            other => panic!("a new checkpoint variant appeared: {other}"),
        };
        assert_eq!(ours.abi_code(), *code, "{variant} must carry the Plugin API's tag");
    }

    // `0` is `RESERVED_UNASSIGNED_CODE` there (`abi_code.rs:13`), and the adapter answers `0` when the
    // operation is gone; this crate must read that as the hard stop, never as `Continue`. Every tag the
    // published enum does not define decodes the same safe way.
    for code in 1..=u8::MAX {
        let defined = published.iter().any(|(_, published_code)| *published_code == code);
        let decoded = CheckpointOutcome::from_abi_code(code);
        if defined {
            assert_eq!(decoded.abi_code(), code, "tag {code} is published, so it must round-trip");
        } else {
            assert_eq!(decoded, CheckpointOutcome::Cancelled, "undefined tag {code} must decode as the safe stop");
        }
    }
    assert_eq!(CheckpointOutcome::from_abi_code(0), CheckpointOutcome::Cancelled);
    assert!(!published.iter().any(|(_, code)| *code == 0), "no variant may take the reserved tag");
}

#[test]
fn every_published_entry_point_is_an_export_of_the_shim() {
    let shim = std::fs::read_to_string(plugin_path("src/extism_host.rs")).expect("src/extism_host.rs");
    assert_eq!(LINEDUP_ENTRY_POINTS.len(), 5, "run, normalizeInput, preview, result_view, describe");

    for name in LINEDUP_ENTRY_POINTS {
        assert!(
            shim.contains(&format!("pub extern \"C\" fn {name}() -> i32")),
            "{name} is published but not exported as a zero-parameter i32"
        );
        assert!(name.starts_with("linedup_"), "{name} must be node-prefixed: one isolate per bundle");
    }

    // Negative control: a name that is not published must not be in the list, and the run entry point is
    // the one the manifest names.
    assert!(LINEDUP_ENTRY_POINTS.contains(&LINEDUP_RUN_ENTRY_POINT));
    assert!(!LINEDUP_ENTRY_POINTS.contains(&"free"), "the reclaim helper is not a document entry point");
    let descriptor = plugin_descriptor();
    let declared: Vec<&str> = descriptor["entryPoints"]
        .as_array()
        .expect("entryPoints")
        .iter()
        .map(|value| value.as_str().expect("entry point name"))
        .collect();
    assert_eq!(declared, LINEDUP_ENTRY_POINTS.to_vec(), "the descriptor lists the same names, in order");
}

#[test]
fn the_definition_export_bindings_resolve_to_real_wasm_exports() {
    let definition: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(plugin_path("definition.json")).expect("definition.json"),
    )
    .expect("json");
    let bindings = export_bindings();

    for (logical, actual) in [("previewExport", "preview"), ("resultExport", "result_view")] {
        let name = definition[logical].as_str().expect(logical);
        let resolved = bindings[name].as_str().unwrap_or_else(|| panic!("definition.json says {name}, the descriptor does not resolve it"));
        assert!(LINEDUP_ENTRY_POINTS.contains(&resolved), "{resolved} is not a published entry point");
    }

    assert_eq!(definition["previewExport"], serde_json::json!("preview"));
    assert_eq!(definition["resultExport"], serde_json::json!("result_view"));
    assert_eq!(LINEDUP_PREVIEW_ENTRY_POINT, "linedup_preview");
    assert_eq!(LINEDUP_RESULT_VIEW_ENTRY_POINT, "linedup_result_view");
    assert_eq!(LINEDUP_NORMALIZE_ENTRY_POINT, "linedup_normalize_input");
    assert_eq!(LINEDUP_DESCRIBE_ENTRY_POINT, "linedup_describe");
}

#[test]
fn the_memory_ceiling_is_expressed_in_both_units() {
    assert_eq!(MEMORY_MAX_BYTES, u64::from(MEMORY_MAX_PAGES) * WASM_PAGE_BYTES, "pages and bytes must agree");
    let descriptor = plugin_descriptor();
    assert_eq!(descriptor["memoryMaxPages"], serde_json::json!(MEMORY_MAX_PAGES));
    assert_eq!(descriptor["memoryMaxBytes"], serde_json::json!(MEMORY_MAX_BYTES));
    assert_eq!(descriptor["allowedPaths"], serde_json::json!([]), "the descriptor and the manifest grant nothing standing");
}

#[test]
fn no_source_file_passes_the_repository_line_ceiling() {
    let mut offenders: Vec<String> = Vec::new();
    for directory in ["src", "tests"] {
        for entry in std::fs::read_dir(plugin_path(directory)).unwrap_or_else(|error| panic!("{directory} must exist: {error}")) {
            let path = entry.expect("entry").path();
            if path.extension().is_some_and(|extension| extension != "rs") {
                continue;
            }
            let text = std::fs::read_to_string(&path).expect("readable");
            let lines = text.lines().count();
            if lines > MAX_SOURCE_LINES {
                offenders.push(format!("{}:{lines}", path.display()));
            }
        }
    }
    assert!(offenders.is_empty(), "over the {MAX_SOURCE_LINES}-line ceiling: {offenders:?}");
}

#[test]
fn the_crate_keeps_the_module_split_the_port_map_claims() {
    for relative in [
        "Cargo.toml",
        "manifest.toml",
        "definition.json",
        "src/lib.rs",
        "src/plugin_entry.rs",
        "src/extism_host.rs",
        "src/file_access.rs",
        "src/filter_core.rs",
        "src/run.rs",
    ] {
        assert!(plugin_path(relative).exists(), "{relative} is missing from the port map in lib.rs");
    }

    // The collation must stay a total order for anything the node can produce, or `sort_by` on a partial
    // comparison silently reorders. Asserted here rather than only in `natural_order`'s own tests because
    // the parity tables depend on it.
    for pair in [("a", "b"), ("b", "a"), ("item2", "item10"), ("café", "cafe"), ("", "a")] {
        let left = NaturalSortKey::new(pair.0);
        let right = NaturalSortKey::new(pair.1);
        assert_eq!(left.cmp(&right), right.cmp(&left).reverse(), "{pair:?} is not antisymmetric");
    }
}

fn plugin_path(relative: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(relative)
}
