//! `manifest.json` against the code that has to match it.
//!
//! The manifest is what the Extism host enforces, and the import list in
//! `src/plugin.rs` is what the isolate actually links. Either side drifting produces
//! a plugin that loads and then traps on its first host call, so both sides are read
//! here instead of being trusted to agree.

use serde::Deserialize;
use xiranite_plugin_snf::host_surface::{
    ADR_0066_DOCUMENTED_HOST_FUNCTIONS, HOST_FUNCTION_NAMESPACE, PLUGIN_ENTRY_POINTS, PLUGIN_HOST_FUNCTIONS,
};
use xiranite_plugin_snf::manifest_limits::{MEMORY_MAX_BYTES, MEMORY_MAX_PAGES, WASM_PAGE_BYTES};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginManifest {
    id: String,
    wasm: String,
    memory_max_pages: u32,
    allowed_paths: Vec<String>,
    allowed_hosts: Vec<String>,
    host_functions: Vec<String>,
}

fn read_manifest() -> PluginManifest {
    let document = include_str!("../manifest.json");
    serde_json::from_str(document)
        .unwrap_or_else(|error| panic!("manifest.json must parse as the manifest contract: {error}"))
}

#[test]
fn identity_and_limits_are_the_shipped_values() {
    let manifest = read_manifest();
    assert_eq!(manifest.id, "snf");
    assert_eq!(manifest.wasm, "snf.wasm");
    assert_eq!(manifest.memory_max_pages, MEMORY_MAX_PAGES);
    assert_eq!(
        u64::from(manifest.memory_max_pages) * u64::from(WASM_PAGE_BYTES),
        MEMORY_MAX_BYTES,
        "the ceiling in bytes has to be the ceiling in pages"
    );
}

#[test]
fn an_empty_path_list_means_per_invocation_authorization() {
    let manifest = read_manifest();
    assert!(
        manifest.allowed_paths.is_empty(),
        "SNF takes its library and artist roots from the operation input, so the \
         manifest grants no standing paths; the host authorizes exactly the paths in \
         the request document"
    );
    assert!(manifest.allowed_hosts.is_empty(), "SNF performs no network access");
}

#[test]
fn manifest_functions_are_exactly_the_declared_ones() {
    let manifest = read_manifest();
    assert_eq!(
        manifest.host_functions.join("|"),
        PLUGIN_HOST_FUNCTIONS.join("|"),
        "one list, one producer"
    );
    for name in &manifest.host_functions {
        assert!(
            name.starts_with(&format!("{HOST_FUNCTION_NAMESPACE}.")),
            "{name} left the xiranite namespace"
        );
    }
}

#[test]
fn the_extension_set_is_named_instead_of_assumed() {
    let manifest = read_manifest();
    let extensions: Vec<&str> = manifest
        .host_functions
        .iter()
        .map(String::as_str)
        .filter(|name| !ADR_0066_DOCUMENTED_HOST_FUNCTIONS.contains(name))
        .collect();
    assert_eq!(
        extensions,
        vec!["xiranite.fs.stat", "xiranite.fs.list", "xiranite.fs.set_times"],
        "ADR-0068 lists open/read/write/move/delete plus the operation and scheduler \
         functions; directory enumeration, stat and utimes are the gap SNF needs filled. A \
         fourth extension is an ADR change first."
    );
}

#[test]
fn every_declared_entry_point_is_documented_in_the_descriptor() {
    let descriptor = xiranite_plugin_snf::node_metadata::plugin_descriptor();
    let declared: Vec<&str> = descriptor["entryPoints"]
        .as_array()
        .expect("entryPoints is an array")
        .iter()
        .map(|value| value.as_str().expect("entry point name"))
        .collect();
    assert_eq!(declared, PLUGIN_ENTRY_POINTS.to_vec());
    let functions: Vec<&str> = descriptor["hostFunctions"]
        .as_array()
        .expect("hostFunctions is an array")
        .iter()
        .map(|value| value.as_str().expect("host function name"))
        .collect();
    assert_eq!(functions, PLUGIN_HOST_FUNCTIONS.to_vec());
    assert_eq!(descriptor["memoryMaxPages"], serde_json::json!(MEMORY_MAX_PAGES));
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn the_manifest_sits_in_the_plugin_directory_it_names() {
    let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    assert!(directory.join("Cargo.toml").exists(), "{directory:?}");
    assert!(directory.join("manifest.json").exists());
    let manifest = read_manifest();
    assert!(
        !manifest.wasm.contains('/') && manifest.wasm.ends_with(".wasm"),
        "the wasm module is resolved beside the manifest"
    );
}
