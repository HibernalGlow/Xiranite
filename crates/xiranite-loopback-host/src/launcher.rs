//! Assembles the node runtime from environment, in one place for every face that hosts a backend.
//!
//! This lived in the desktop crate's `main.rs`, where the only consumer was the Tauri window. It is
//! here because the *channel* is the interesting part of the host, not the window: a headless dev
//! host needs exactly the same node staging, and a second copy of the environment vocabulary is how
//! `XIRANITE_ALLOWED_DIRS` ends up meaning two things.
//!
//! What is linked in is a build-time fact now, not a directory read at start-up: ADR-0073 retired the
//! wasm plugin staging and ADR-0074 §1/§4 put a node's one implementation behind
//! [`xiranite_node_registry::BuiltInNode`] — a native crate, or a TypeScript bundle the embedded QuickJS
//! executor loads. So `XIRANITE_PLUGIN_DIR` is gone rather than defaulting to something: a host that
//! quietly fell back to a plugin directory would be a second runtime with a second set of answers.
//!
//! Configuration stays environment-only because the desktop host has no settings UI for it yet:
//!
//! - `XIRANITE_ALLOWED_DIRS` — the roots an operation may reach through the node's filesystem surface,
//!   as a path list in this platform's `PATH` convention: `:` on macOS/Linux, `;` with optional quoting
//!   on Windows (see [`split_grants`] for why one spelling cannot serve both).

use std::path::PathBuf;
use std::sync::Arc;

use xiranite_api::OperationLauncher;
use xiranite_builtin_host::BuiltInNodeLauncher;
use xiranite_core::SystemClock;

/// The runtime plus what was read from the environment, so a host can log the same facts it acted on
/// rather than re-deriving them from a `dyn` object.
pub struct StagedRuntime {
    /// The launcher itself — hand this to [`crate::BackendStart`].
    pub launcher: Arc<dyn OperationLauncher>,
    /// The node ids this host can run, for the audit line and the faces' pickers.
    pub node_ids: Vec<String>,
    /// The granted filesystem roots.
    pub grants: Vec<PathBuf>,
}

/// Builds the built-in launcher from the process environment.
///
/// The error is a finished message rather than a typed failure: both callers print it and exit. It is
/// only reachable when nothing is linked in, which is a build mistake — the launcher refuses to serve a
/// host that would answer every operation with "unknown node" (`xiranite_builtin_host`).
pub fn stage_from_environment() -> Result<StagedRuntime, String> {
    let grants = std::env::var_os("XIRANITE_ALLOWED_DIRS")
        .map(|value| split_grants(&value))
        .unwrap_or_default();
    let launcher = BuiltInNodeLauncher::new(Arc::new(SystemClock), grants.clone())?;
    let node_ids = launcher.node_ids().into_iter().map(str::to_owned).collect();
    Ok(StagedRuntime { launcher: Arc::new(launcher), node_ids, grants })
}

/// The audit line both hosts print, spelled once.
#[must_use]
pub fn staging_summary(staged: &StagedRuntime) -> String {
    format!(
        "nodes [{}] granting {} root(s)",
        staged.node_ids.join(", "),
        staged.grants.len()
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
