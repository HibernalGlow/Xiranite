//! The crate's own shape, checked the way `AGENTS.md` and ADR-0071 describe it.
//!
//! Three rules a plugin crate can drift on without any test noticing, so they are measured here:
//! the repository's 1000-physical-line ceiling (`bun run check:source-size` covers TypeScript, this
//! covers Rust); ADR-0071's split of machine access, where `std::fs` is *allowed* but only inside the
//! one module that reads a granted preopen, while `std::process::Command` and `std::net` are banned
//! outright (the former answers `Unsupported` in Extism's WASI, the latter has no grant in this
//! manifest); and the standalone-workspace rule that keeps `plugins/soundw` off the root `Cargo.lock`.

#![cfg(not(target_arch = "wasm32"))]

use std::path::{Path, PathBuf};

/// `AGENTS.md`: the ceiling for a maintained source file.
const MAX_SOURCE_LINES: usize = 1000;
/// The module ADR-0071 puts `std::fs` in: the WASI preopen probe, nothing else.
const FILESYSTEM_MODULE: &str = "cli_locator.rs";

fn crate_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf()
}

fn files_in(directory: &str) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(crate_root().join(directory))
        .unwrap_or_else(|error| panic!("{directory} must exist and be readable: {error}"))
    {
        let path = entry.expect("readable entry").path();
        if path.extension().is_some_and(|extension| extension == "rs") {
            files.push(path);
        }
    }
    files.sort();
    assert!(!files.is_empty(), "{directory} contained no source files");
    files
}

/// The code lines of a file: doc comments are where ADR-0071's forbidden names get *named in order
/// to be rejected*, so they must not trip a scanner.
fn code_lines(text: &str) -> String {
    let mut code = String::new();
    let mut in_block_comment = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("/*") {
            in_block_comment = true;
        }
        if in_block_comment {
            if trimmed.contains("*/") {
                in_block_comment = false;
            }
            continue;
        }
        if trimmed.starts_with("//") {
            continue;
        }
        code.push_str(line);
        code.push('\n');
    }
    code
}

#[test]
fn every_source_file_stays_under_the_ceiling() {
    let mut over: Vec<String> = Vec::new();
    for path in files_in("src").into_iter().chain(files_in("tests")) {
        let text = std::fs::read_to_string(&path).expect("readable source file");
        let lines = text.lines().count();
        if lines > MAX_SOURCE_LINES {
            over.push(format!("{}: {lines} lines", path.display()));
        }
    }
    assert!(over.is_empty(), "files over the {MAX_SOURCE_LINES}-line ceiling: {over:?}");
}

#[test]
fn filesystem_access_lives_only_in_the_preopen_module() {
    // ADR-0071 decision 2/3: the guest reads and writes through granted preopens with `std::fs`, and
    // that is the only machine surface `std` gives it. Everything else that reaches the machine is a
    // declared capability in `manifest.toml`.
    for path in files_in("src") {
        let name = path.file_name().and_then(|value| value.to_str()).unwrap_or_default();
        let code = code_lines(&std::fs::read_to_string(&path).expect("readable"));
        if name == FILESYSTEM_MODULE {
            assert!(code.contains("std::fs"), "{name} is supposed to be the preopen probe");
            continue;
        }
        assert!(!code.contains("std::fs"), "{name} touches the filesystem outside the preopen module");
    }
}

#[test]
fn no_process_spawn_no_network_and_no_environment_read_in_the_guest() {
    let forbidden = ["std::process::Command", "std::net", "std::env"];
    for path in files_in("src") {
        let text = std::fs::read_to_string(&path).expect("readable");
        // Test modules may use a scratch temp directory; the compiled plugin may not.
        let shipped = text.split("#[cfg(test)]").next().unwrap_or_default();
        let code = code_lines(shipped);
        for needle in forbidden {
            assert!(
                !code.contains(needle),
                "{} uses {needle}: ADR-0071 §2 measured that the guest cannot spawn, and this \
                 manifest declares no network or environment access",
                path.display()
            );
        }
    }
}

#[test]
fn the_crate_is_a_standalone_workspace_building_a_cdylib() {
    let manifest = std::fs::read_to_string(crate_root().join("Cargo.toml")).expect("Cargo.toml");
    assert!(manifest.contains("[workspace]"), "plugins/soundw must own its workspace and lock file");
    assert!(manifest.contains("cdylib"), "an Extism plugin is a cdylib");
    assert!(crate_root().join("Cargo.lock").exists(), "the standalone workspace has its own lock");
    assert!(crate_root().join("manifest.toml").exists());
    assert!(crate_root().join("definition.json").exists(), "ADR-0069: every plugin publishes its definition");
    // The wasm trio exists and is feature- plus target-gated, so `cargo test` never needs a host.
    for name in ["extism_boundary.rs", "host_runtime.rs", "plugin.rs"] {
        assert!(crate_root().join("src").join(name).exists(), "{name} is missing");
    }
    let lib = std::fs::read_to_string(crate_root().join("src/lib.rs")).expect("lib.rs");
    assert_eq!(
        lib.matches("all(feature = \"wasm\", target_arch = \"wasm32\")").count(),
        3,
        "each wasm module is gated once"
    );
    // Negative control: the retired target from before ADR-0071 must not come back.
    assert!(!lib.contains("wasm32-unknown-unknown"), "ADR-0071 decision 8 moved the build target");
}

#[test]
fn the_plugin_never_declares_a_capability_outside_the_nine() {
    use xiranite_plugin_soundw::host_functions::{CANONICAL_HOST_FUNCTIONS, SOUNDW_HOST_FUNCTIONS};
    assert_eq!(CANONICAL_HOST_FUNCTIONS.len(), 9, "ADR-0071 closed the vocabulary at nine names");
    assert!(!SOUNDW_HOST_FUNCTIONS.is_empty());
    for name in SOUNDW_HOST_FUNCTIONS {
        assert!(CANONICAL_HOST_FUNCTIONS.contains(&name), "{name} is not a settled capability");
    }
    // Negative control: a tenth invented name is refused by the same assertion.
    assert!(!CANONICAL_HOST_FUNCTIONS.contains(&"xiranite.soundswitch.run"));
}
