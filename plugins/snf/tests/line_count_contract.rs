#![cfg(not(target_arch = "wasm32"))]
//! The repository's 1000-physical-line source ceiling, applied to this crate.
//!
//! `AGENTS.md` puts the limit on every maintained source file and `bun
//! run check:source-size` measures the TypeScript side; this is the same rule for
//! the plugin crate so a future contributor cannot quietly grow `src/plugin.rs` past
//! the gate the rest of the repository is held to.

// `std::fs` here is a test concern only: nothing in `tests/` is compiled into
// `snf.wasm`, and `no_source_file_reaches_the_filesystem_directly` is the guard that
// keeps `src/` free of it (ADR-0063 principle 8, ADR-0066).

/// The ceiling `AGENTS.md` states for a new file.
const MAX_SOURCE_LINES: usize = 1000;

fn source_files() -> Vec<std::path::PathBuf> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut files = vec![root.join("Cargo.toml"), root.join("manifest.json")];
    for directory in ["src", "tests"] {
        let read = std::fs::read_dir(root.join(directory))
            .unwrap_or_else(|error| panic!("{directory} must exist and be readable: {error}"));
        for entry in read {
            let path = entry.expect("readable directory entry").path();
            if path.extension().is_some_and(|extension| extension == "rs") {
                files.push(path);
            }
        }
    }
    files.sort();
    files
}

#[test]
fn every_source_file_stays_under_the_ceiling() {
    let mut over_limit: Vec<String> = Vec::new();
    for file in source_files() {
        let text = std::fs::read_to_string(&file).expect("readable source file");
        let lines = text.lines().count();
        if lines > MAX_SOURCE_LINES {
            over_limit.push(format!("{}:{lines}", file.display()));
        }
    }
    assert!(over_limit.is_empty(), "files over the {MAX_SOURCE_LINES}-line ceiling: {over_limit:?}");
}

/// ADR-0063 principle 8 and ADR-0066: the only way a plugin reaches the machine is a
/// host function. `tests/` may use `std::fs` because it never enters the isolate.
#[test]
fn no_source_file_reaches_the_filesystem_directly() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let forbidden = ["std::fs", "std::net", "std::env", "File::", "Command::new"];
    for entry in std::fs::read_dir(root).expect("src exists") {
        let path = entry.expect("entry").path();
        if path.extension().is_some_and(|extension| extension != "rs") {
            continue;
        }
        let text = std::fs::read_to_string(&path).expect("readable");
        // Doc comments quote the forbidden names on purpose (`no std::fs` in
        // src/plugin.rs), so only code lines are measured.
        let code: String = text
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");
        for needle in forbidden {
            assert!(
                !code.contains(needle),
                "{} uses {needle}: filesystem access belongs in a host function",
                path.display()
            );
        }
    }
}

#[test]
fn the_crate_root_and_the_boundary_layer_are_both_present() {
    let names: Vec<String> = source_files()
        .iter()
        .map(|path| path.file_name().and_then(|name| name.to_str()).unwrap_or_default().to_string())
        .collect();
    for required in ["lib.rs", "plugin.rs", "contract.rs", "run.rs", "plan.rs", "manifest.json"] {
        assert!(names.iter().any(|name| name == required), "{required} is missing");
    }
}
