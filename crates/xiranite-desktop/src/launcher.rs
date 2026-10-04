//! Assembles the node runtime from environment, in one place for every face that hosts a backend.
//!
//! This used to live in `main.rs`, where the only consumer was the Tauri window. It belongs in the
//! library because the *channel* is the interesting part of the desktop host, not the window: a
//! headless dev host needs exactly the same plugin staging, and a second copy of the environment
//! vocabulary is how `XIRANITE_ALLOWED_DIRS` ends up meaning two things.
//!
//! Configuration stays environment-only because the desktop host has no settings UI for it yet:
//!
//! - `XIRANITE_PLUGIN_DIR` — the staged plugin root (`<id>/manifest.json` + `<id>.wasm`), default
//!   `artifacts/plugins` relative to the working directory, which is what `bun run build:node-wasm`
//!   writes.
//! - `XIRANITE_ALLOWED_DIRS` — the roots an operation may reach through `xiranite.fs.*`, as a path
//!   list in this platform's `PATH` convention: `:` on macOS/Linux, `;` with optional quoting on
//!   Windows (see [`split_grants`] for why one spelling cannot serve both).
//! - `XIRANITE_DATA_DIR` — where per-node artifacts such as undo histories live.

use std::path::PathBuf;
use std::sync::Arc;

use xiranite_api::OperationLauncher;
use xiranite_core::SystemClock;
use xiranite_node_runtime::{NodeRegistry, NodeRuntime};

/// The staged runtime plus what was read from the environment, so a host can log the same facts it
/// acted on rather than re-deriving them from a `dyn` object.
pub struct StagedRuntime {
    /// The launcher itself — hand this to [`crate::BackendStart`].
    pub launcher: Arc<dyn OperationLauncher>,
    /// The staged node ids, for the host's audit line.
    pub node_ids: Vec<String>,
    /// The granted filesystem roots.
    pub grants: Vec<PathBuf>,
    /// The host data directory the runtime writes per-node artifacts under.
    pub data_dir: PathBuf,
}

/// Builds a [`NodeRuntime`] from the process environment.
///
/// The error is a finished message rather than a typed failure: both callers print it and exit, and
/// a missing plugin directory is not something a caller can recover from differently. It carries the
/// build command because "no usable plugins" otherwise sends the reader to the wrong crate.
///
/// An empty staging directory is an error here too, even though `NodeRegistry::load` accepts it: a
/// host that starts, serves `/health` and can run nothing is the failure mode that looks like a bug
/// in the runtime.
pub fn stage_from_environment() -> Result<StagedRuntime, String> {
    let plugin_dir = std::env::var_os("XIRANITE_PLUGIN_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("artifacts").join("plugins"));
    let registry = NodeRegistry::load(&plugin_dir)
        .map_err(|error| format!("no usable plugins are staged under {}: {error}", plugin_dir.display()))?;

    let node_ids: Vec<String> = registry.ids().map(str::to_owned).collect();
    if node_ids.is_empty() {
        return Err(format!(
            "{} exists but stages no node; build one with `bun run build:node-wasm <id>`",
            plugin_dir.display()
        ));
    }

    let grants = std::env::var_os("XIRANITE_ALLOWED_DIRS")
        .map(|value| split_grants(&value))
        .unwrap_or_default();
    let data_dir = std::env::var_os("XIRANITE_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            plugin_dir
                .parent()
                .map_or_else(|| PathBuf::from("host-data"), |root| root.join("host-data"))
        });

    Ok(StagedRuntime {
        launcher: Arc::new(NodeRuntime::new(
            Arc::new(registry),
            Arc::new(SystemClock),
            grants.clone(),
            data_dir.clone(),
        )),
        node_ids,
        grants,
        data_dir,
    })
}

/// The audit line both hosts print, spelled once.
#[must_use]
pub fn staging_summary(staged: &StagedRuntime) -> String {
    format!(
        "nodes [{}] granting {} root(s), data dir {}",
        staged.node_ids.join(", "),
        staged.grants.len(),
        staged.data_dir.display()
    )
}

/// Splits `XIRANITE_ALLOWED_DIRS` with the platform's own path-list convention.
///
/// This used to split on `:` *and* `;` so that "one command line works on both machines". That is a
/// bug, not a convenience: a Windows list is `C:\Library;D:\Downloads`, and splitting it on `:` yields
/// `C`, `\Library`, `D`, `\Downloads` — four near-relative roots, none of which is the directory the
/// developer granted, so `xiranite.fs.*` either refuses everything or reaches somewhere unintended.
/// `std::env::split_paths` is the parser that already knows the difference (`;` with unquoting on
/// Windows, `:` on Unix), so the vocabulary is "whatever your `PATH` means here", spelled once.
#[must_use]
fn split_grants(value: &std::ffi::OsStr) -> Vec<PathBuf> {
    std::env::split_paths(value)
        // An empty or blank segment (a trailing separator, or `XIRANITE_ALLOWED_DIRS=` set to the empty
        // string) must not become a grant of the working directory.
        .filter(|path| !path.to_string_lossy().trim().is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grants(text: &str) -> Vec<PathBuf> {
        split_grants(std::ffi::OsStr::new(text))
    }

    /// The platform's own separator must split, on the platform that uses it. The drive-letter half is
    /// the [`split_grants`] bug this test now pins. It can only *execute* on Windows, so the Unix branch
    /// asserts the mirror image (`;` stays a literal path character) rather than pretending to cover the
    /// Windows case; the Windows branch is what CI there will run.
    #[test]
    fn the_grant_list_follows_the_platform_path_convention() {
        if cfg!(target_os = "windows") {
            assert_eq!(
                grants(r"C:\Library;D:\Downloads"),
                vec![PathBuf::from(r"C:\Library"), PathBuf::from(r"D:\Downloads")]
            );
            // Falsification for the old rule: a single-component grant must never contain a bare drive
            // letter, which is exactly what splitting on `:` produced.
            assert!(!grants(r"C:\Library").iter().any(|path| path.as_os_str() == "C"),);
        } else {
            assert_eq!(grants("/tmp/a:/tmp/b"), vec![PathBuf::from("/tmp/a"), PathBuf::from("/tmp/b")]);
            assert_eq!(grants("/tmp/a;b"), vec![PathBuf::from("/tmp/a;b")]);
        }
    }

    /// Empty and whitespace-only segments are dropped on every platform: a trailing separator or an
    /// `XIRANITE_ALLOWED_DIRS=` set to the empty string must grant nothing, not the working directory.
    #[test]
    fn empty_segments_never_become_a_grant() {
        let (trailing, first) = if cfg!(target_os = "windows") { (r"C:\Library;", r"C:\Library") } else { ("/tmp/a:", "/tmp/a") };
        assert_eq!(grants(trailing), vec![PathBuf::from(first)]);
        assert_eq!(grants(""), Vec::<PathBuf>::new());
        assert_eq!(grants("   "), Vec::<PathBuf>::new());
    }
}
