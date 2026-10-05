//! `manifest.toml` against the code that has to agree with it.
//!
//! The manifest is what the Extism host enforces (`crates/xiranite-node-runtime/src/manifest.rs`
//! reads it), the import list in `src/extism_boundary.rs` is what the isolate actually links, and
//! `bun run audit-plugin-manifests.ts` is the repository's gate over the same document. Any two of
//! the three drifting produces a plugin that loads and then traps on its first host call, so this
//! file reads all three and compares them.
//!
//! The TOML reader here is deliberately purpose-built rather than a `toml` dependency: it understands
//! exactly the two forms this repository's manifests use (`key = "value"`, `key = 123` and a
//! `key = [\n "a",\n]` array), which keeps `soundw.wasm`'s dependency set at serde + serde_json like
//! every sibling plugin. `tests/definition_contract.rs` covers the JSON half with `serde_json`.
//!
//! ADR-0071's shape is what the assertions below enforce: capability names from the nine-word
//! vocabulary, the CLI path field served by a read-only preopen instead of a file capability.

#![cfg(not(target_arch = "wasm32"))]

use std::collections::BTreeMap;
use std::path::Path;

use xiranite_plugin_soundw::host_functions::{
    CANONICAL_HOST_FUNCTIONS, MEMORY_MAX_PAGES, RETIRED_FILE_HOST_FUNCTIONS, SOUNDW_HOST_FUNCTIONS,
    host_function_symbol,
};
use xiranite_plugin_soundw::plugin_entry::{SOUNDW_ENTRY_POINTS, SOUNDW_RUN_ENTRY_POINT, describe_soundw_plugin};
use xiranite_plugin_soundw::{PREOPEN_ALIAS, cli_locator};

/// One parsed manifest: every top-level and `[backend]` scalar, plus the two arrays this gate reads.
struct Manifest {
    values: BTreeMap<String, String>,
    lists: BTreeMap<String, Vec<String>>,
}

impl Manifest {
    fn text(&self, key: &str) -> Option<&str> {
        self.values.get(key).map(String::as_str)
    }

    fn number(&self, key: &str) -> Option<u64> {
        self.values.get(key).and_then(|value| value.parse().ok())
    }

    fn list(&self, key: &str) -> &[String] {
        self.lists.get(key).map(Vec::as_slice).unwrap_or_default()
    }
}

/// A minimal reader for the two manifest forms described above. Quoted values keep their inner
/// text; `#` starts a comment outside a string.
fn parse_manifest(text: &str) -> Manifest {
    let mut values = BTreeMap::new();
    let mut lists = BTreeMap::new();
    let mut table = String::new();
    let mut lines = text.lines().peekable();

    while let Some(line) = lines.next() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(name) = trimmed.strip_prefix('[').and_then(|rest| rest.strip_suffix(']')) {
            table = name.to_owned();
            continue;
        }
        let Some((key, raw_value)) = trimmed.split_once('=') else {
            panic!("manifest line `{trimmed}` is neither a table header nor a key = value pair");
        };
        let key = key.trim();
        let key = if table.is_empty() { key.to_owned() } else { format!("{table}.{key}") };
        let raw_value = strip_comment(raw_value.trim());

        if let Some(rest) = raw_value.strip_prefix('[') {
            if let Some(inner) = rest.strip_suffix(']') {
                // A one-line array: `allowed_paths = ["ro:…=/alias"]`, or the empty `[]`.
                lists.insert(key, split_array_entries(inner).into_iter().map(|entry| unquote(&entry)).collect());
                continue;
            }
            // A multi-line array: entries until the closing bracket.
            let mut entries = Vec::new();
            for entry in lines.by_ref() {
                let entry = strip_comment(entry).trim().to_owned();
                if entry.is_empty() {
                    continue;
                }
                if entry.starts_with(']') {
                    break;
                }
                entries.push(unquote(entry.trim_end_matches(',')));
            }
            lists.insert(key, entries);
            continue;
        }
        values.insert(key, unquote(raw_value));
    }
    Manifest { values, lists }
}

/// Splits an inline array body on commas that are outside quotes.
fn split_array_entries(inner: &str) -> Vec<String> {
    let mut entries = Vec::new();
    let mut current = String::new();
    let mut in_string = false;
    for character in inner.chars() {
        match character {
            '"' => {
                in_string = !in_string;
                current.push(character);
            }
            ',' if !in_string => {
                if !current.trim().is_empty() {
                    entries.push(current.trim().to_owned());
                }
                current.clear();
            }
            _ => current.push(character),
        }
    }
    if !current.trim().is_empty() {
        entries.push(current.trim().to_owned());
    }
    entries
}

/// Drops a trailing `# comment` that is not inside quotes.
fn strip_comment(value: &str) -> &str {
    let mut in_string = false;
    for (index, character) in value.char_indices() {
        match character {
            '"' => in_string = !in_string,
            '#' if !in_string => return &value[..index],
            _ => {}
        }
    }
    value
}

fn unquote(value: &str) -> String {
    let trimmed = value.trim();
    trimmed
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
        .unwrap_or(trimmed)
        .to_owned()
}

fn read_manifest() -> Manifest {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("manifest.toml");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{} must be readable: {error}", path.display()));
    parse_manifest(&text)
}

/// `audit-plugin-manifests.ts:90` — `VERSION_PATTERN`.
fn is_dotted_version(value: &str) -> bool {
    let parts: Vec<&str> = value.split('.').collect();
    (2..=3).contains(&parts.len())
        && parts.iter().all(|part| !part.is_empty() && part.chars().all(|character| character.is_ascii_digit()))
}

#[test]
fn the_manifest_declares_all_three_version_facts() {
    let manifest = read_manifest();
    // ADR-0068: plugin, Plugin-API and runtime versions are three separate facts.
    for key in ["version", "backend_api", "backend.runtime_version"] {
        let value = manifest.text(key).unwrap_or_else(|| panic!("manifest.toml is missing {key}"));
        assert!(is_dotted_version(value), "{key} = {value:?} is not a dotted numeric version");
    }
    // Negative control: the gate's own pattern refuses the range spellings a manifest must not use.
    assert!(!is_dotted_version("^1.0"));
    assert!(!is_dotted_version("1.0.0-beta"));
}

#[test]
fn identity_entry_and_limits_are_the_shipped_values() {
    let manifest = read_manifest();
    assert_eq!(manifest.text("id"), Some("soundw"), "id must equal the plugin directory name");
    assert_eq!(manifest.text("backend.entry"), Some("soundw.wasm"));
    assert_eq!(
        manifest.text("backend.entry_point"),
        Some(SOUNDW_RUN_ENTRY_POINT),
        "the manifest must name the zero-parameter export the operation manager calls"
    );
    assert_eq!(manifest.text("backend.runtime"), Some("extism"));
    assert_eq!(
        manifest.number("backend.memory_max_pages"),
        Some(u64::from(MEMORY_MAX_PAGES)),
        "src/host_functions.rs and manifest.toml must state one memory ceiling"
    );
    assert_eq!(manifest.text("version"), Some("0.1.0"), "index.ts:3 is the node's own release");
}

#[test]
fn host_functions_are_the_declared_three_in_order() {
    let manifest = read_manifest();
    let declared = manifest.list("backend.host_functions");
    assert!(!declared.is_empty(), "an empty host_functions list means nothing was registered");
    assert_eq!(
        declared.iter().map(String::as_str).collect::<Vec<_>>(),
        SOUNDW_HOST_FUNCTIONS.to_vec(),
        "one list, one producer (`src/host_functions.rs`)"
    );
    for name in declared {
        assert!(
            CANONICAL_HOST_FUNCTIONS.contains(&name.as_str()),
            "{name} is not in the ADR-0068 vocabulary as closed by ADR-0071"
        );
        assert!(host_function_symbol(name).is_some(), "{name} has no import symbol");
    }
    // The audit's own hard rule (`scripts/audit-plugin-manifests.ts:143-145`).
    assert!(declared.iter().any(|name| name == "xiranite.operation.checkpoint"));
}

#[test]
fn no_file_capability_survives_in_the_manifest() {
    // ADR-0071 retired thirteen names; a manifest asking for one is asking for the wrong mechanism.
    let manifest = read_manifest();
    for name in manifest.list("backend.host_functions") {
        assert!(
            !RETIRED_FILE_HOST_FUNCTIONS.contains(&name.as_str()),
            "{name} was retired by ADR-0071: declare allowed_paths and use std::fs"
        );
        assert!(!name.starts_with("xiranite.fs."), "{name} is a file capability");
    }
    // The prose half: a comment may *name* a retired capability to say it is retired, so only code
    // lines are measured.
    let raw = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("manifest.toml"))
        .expect("manifest.toml");
    let assignments: String = raw
        .lines()
        .filter(|line| !line.trim().starts_with('#'))
        .collect::<Vec<_>>()
        .join("\n");
    for retired in RETIRED_FILE_HOST_FUNCTIONS {
        assert!(!assignments.contains(retired), "manifest.toml still grants {retired}");
    }
    assert!(!assignments.contains("xiranite.fs."), "manifest.toml still names the retired namespace");
}

#[test]
fn the_imports_in_the_boundary_match_the_declared_three() {
    // The third side of the triangle: what `soundw.wasm` actually links.
    let boundary = include_str!("../src/extism_boundary.rs");
    let mut linked: Vec<&str> = boundary
        .lines()
        .filter_map(|line| line.trim().strip_prefix("#[link_name = ").and_then(|rest| rest.strip_suffix(']')))
        .map(|value| value.trim_matches('"'))
        .collect();
    linked.sort_unstable();
    let mut expected: Vec<&str> = SOUNDW_HOST_FUNCTIONS
        .iter()
        .filter_map(|name| host_function_symbol(name))
        .collect();
    expected.sort_unstable();
    assert_eq!(linked, expected, "an import that is not declared, or a declaration that is not linked");
    assert_eq!(linked.len(), SOUNDW_HOST_FUNCTIONS.len());
}

#[test]
fn the_cli_path_field_is_a_read_only_preopen_not_a_capability() {
    let manifest = read_manifest();
    let granted = manifest.list("backend.allowed_paths");
    assert!(!granted.is_empty(), "soundSwitchPath is a real path field, so the node needs a root");
    for entry in granted {
        assert!(
            entry.starts_with("ro:"),
            "{entry} grants write access, and SoundW only ever stats the CLI (platform.ts:7-9)"
        );
        let body = entry.trim_start_matches("ro:");
        let Some((host_root, guest_alias)) = body.split_once('=') else {
            panic!("{entry} is not `ro:<host path>=<guest alias>`");
        };
        assert!(!host_root.is_empty() && !guest_alias.is_empty());
        assert!(
            guest_alias.starts_with('/'),
            "a WASI preopen alias is an absolute guest path, got {guest_alias}"
        );
    }
    // The alias the guest code actually uses has to be the one the manifest grants.
    assert!(granted.iter().any(|entry| entry.ends_with(&format!("={PREOPEN_ALIAS}"))));
    assert_eq!(cli_locator::PREOPEN_ALIAS, "/soundswitch");
    assert_eq!(
        manifest.list("backend.allowed_hosts"),
        Vec::<String>::new(),
        "the node performs no network access"
    );
}

#[test]
fn the_descriptor_agrees_with_the_manifest_and_the_exports() {
    let manifest = read_manifest();
    let descriptor = describe_soundw_plugin();
    let declared: Vec<&str> = descriptor["hostFunctions"]
        .as_array()
        .expect("hostFunctions is an array")
        .iter()
        .map(|value| value.as_str().expect("a capability name"))
        .collect();
    assert_eq!(declared, SOUNDW_HOST_FUNCTIONS.to_vec());
    assert_eq!(declared, manifest.list("backend.host_functions").iter().map(String::as_str).collect::<Vec<_>>());

    let exports: Vec<&str> = descriptor["entryPoints"]
        .as_array()
        .expect("entryPoints is an array")
        .iter()
        .map(|value| value.as_str().expect("an entry point name"))
        .collect();
    assert_eq!(exports, SOUNDW_ENTRY_POINTS.to_vec());
    assert_eq!(exports.len(), SOUNDW_ENTRY_POINTS.len(), "no export went undocumented");
    assert_eq!(descriptor["registeredCommands"], serde_json::json!(["soundswitch-cli"]));
}

#[test]
fn every_export_name_is_plugin_scoped_and_unique() {
    let mut seen: Vec<&str> = Vec::new();
    for name in SOUNDW_ENTRY_POINTS {
        assert!(name.starts_with("soundw_"), "{name} is not plugin-scoped and would collide in the isolate pool");
        assert!(!seen.contains(&name), "duplicate entry point {name}");
        seen.push(name);
    }
    // Negative control: the bare `run` the earlier ports exported is exactly what is not allowed.
    assert!(!seen.contains(&"run"));
}
