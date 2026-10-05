//! The filesystem the node really runs on: `std::fs` against the granted roots.
//!
//! This is ADR-0071's whole point. `packages/nodes/classq/src/platform.ts:1-28` opened the same four operations
//! through `node:fs/promises` in a Bun process; a `wasm32-wasip1` guest opens them through `std::fs` and the engine
//! maps each call onto the preopens the host built from this plugin's `allowed_paths`. No `xiranite.fs.*` capability
//! is declared, imported, or stubbed anywhere in this crate, and the write half (`create_dir_all`, `rename`, the copy
//! walk) is exactly the `ensureDir`/`transfer` pair `platform.ts:19-28` implemented.
//!
//! The same type serves both worlds: the CLI and the TUI faces run it natively, and the wasm guest runs the identical
//! code inside the isolate. Only the path *view* differs, and that is the host's business (ADR-0071 §5).
//!
//! Deviations from `platform.ts`, each forced by the sandbox or by the boundary's `String` paths:
//!
//! 1. A file name that is not valid UTF-8 fails the listing instead of arriving as a WTF-16 surrogate string. Every
//!    type crossing the plugin border is a WIT `string` (ADR-0068), so an undecodable name is reported rather than
//!    silently renamed.
//! 2. `transfer(Copy)` refuses an existing target the way `cp({ errorOnExist: true, force: false })` does
//!    (`platform.ts:24`) and walks directories itself, because `std::fs::copy` is file-only.
//! 3. The copy walk is depth-bounded by [`MAX_COPY_DEPTH`]. Node's recursive copy had no bound and would follow a
//!     symlink cycle forever; here a cycle is a refused item with a `reason` instead of an exhausted wasm stack.

use std::fs;
use std::path::Path;

use crate::contract::{ClassqDirEntry, ClassqPathInfo, ClassqTransferMode};
use crate::runtime::{ClassqFileSystem, ClassqRuntimeError};

/// How deep a recursive copy may go. Directory listings in the plan walk are the host's depth concern (the keyword
/// scan is bounded separately in `plan.rs`); this bounds the one walk that writes.
pub const MAX_COPY_DEPTH: usize = 32;

/// `createNodeClassqRuntime` (`platform.ts:5`), over `std::fs`.
#[derive(Debug, Clone, Copy, Default)]
pub struct StdClassqFileSystem;

impl StdClassqFileSystem {
    /// The runtime the node uses.
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl ClassqFileSystem for StdClassqFileSystem {
    fn path_info(&self, path: &str) -> ClassqPathInfo {
        // `platform.ts:7-14`: `stat` throwing is `exists: false`, never an error. A path outside every preopen
        // arrives here as `ENONET`/`ENOENT` (ADR-0071 §2 measured errno 44 for an ungranted path), which is exactly
        // the "not there" answer the planner turns into a `root_not_directory` row.
        match fs::metadata(path) {
            Ok(info) => ClassqPathInfo {
                path: path.to_owned(),
                exists: true,
                is_file: info.is_file(),
                is_directory: info.is_dir(),
            },
            Err(_) => ClassqPathInfo::missing(path),
        }
    }

    fn list_dir(&self, path: &str) -> Result<Vec<ClassqDirEntry>, ClassqRuntimeError> {
        let read = fs::read_dir(path)
            .map_err(|error| ClassqRuntimeError::new(format!("{error} (while listing {path})")))?;
        let mut entries: Vec<ClassqDirEntry> = Vec::new();
        for item in read {
            let item = item.map_err(ClassqRuntimeError::from)?;
            let name = entry_name(&item)?;
            let file_type = item.file_type().map_err(ClassqRuntimeError::from)?;
            // `platform.ts:17` built the child path as `join(path, entry.name)`, so the listing keeps the spelling
            // the caller used rather than whatever `DirEntry::path()` chose to render.
            let child_path = crate::path_text::join_path(path, &name);
            entries.push(ClassqDirEntry {
                name,
                path: child_path,
                is_file: file_type.is_file(),
                is_directory: file_type.is_dir(),
            });
        }
        // `readdir` returns directory order and `core.ts:147-154` plans in it, so no sorting happens here; the
        // parity tables pin the same property by asserting item order over a fixture listing.
        Ok(entries)
    }

    fn ensure_dir(&self, path: &str) -> Result<(), ClassqRuntimeError> {
        fs::create_dir_all(path).map_err(ClassqRuntimeError::from)
    }

    fn transfer(&self, source: &str, target: &str, mode: ClassqTransferMode) -> Result<(), ClassqRuntimeError> {
        match mode {
            // `platform.ts:27` `rename`.
            ClassqTransferMode::Move => fs::rename(source, target).map_err(ClassqRuntimeError::from),
            // `platform.ts:23-25` `cp({ recursive, errorOnExist: true, force: false })`.
            ClassqTransferMode::Copy => {
                if Path::new(target).exists() {
                    return Err(ClassqRuntimeError::new(format!("EEXIST: file already exists, '{target}'")));
                }
                copy_recursively(Path::new(source), Path::new(target), 0)
            }
        }
    }
}

/// `entry.name` (`platform.ts:17`), as the boundary's `String`.
fn entry_name(entry: &fs::DirEntry) -> Result<String, ClassqRuntimeError> {
    let name = entry.file_name();
    match name.to_str() {
        Some(text) => Ok(text.to_owned()),
        None => Err(ClassqRuntimeError::new(format!(
            "{} has a file name that is not valid UTF-8",
            entry.path().display()
        ))),
    }
}

/// The recursive half of `cp({ recursive: true })`, bounded by [`MAX_COPY_DEPTH`].
fn copy_recursively(source: &Path, target: &Path, depth: usize) -> Result<(), ClassqRuntimeError> {
    if depth > MAX_COPY_DEPTH {
        return Err(ClassqRuntimeError::new(format!(
            "copy of '{}' is deeper than {MAX_COPY_DEPTH} levels (symlink cycle?)",
            source.display()
        )));
    }
    // `cp` dereferences by default, so a symlink is copied as the thing it points at.
    let info = fs::metadata(source).map_err(ClassqRuntimeError::from)?;
    if info.is_dir() {
        fs::create_dir_all(target).map_err(ClassqRuntimeError::from)?;
        for item in fs::read_dir(source).map_err(ClassqRuntimeError::from)? {
            let item = item.map_err(ClassqRuntimeError::from)?;
            let name = item.file_name();
            let child_target = target.join(&name);
            copy_recursively(&item.path(), &child_target, depth + 1)?;
        }
        return Ok(());
    }
    fs::copy(source, target).map_err(ClassqRuntimeError::from)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A unique scratch directory per test, so parallel `cargo test` threads never share a tree.
    fn scratch(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("xiranite-classq-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("scratch dir");
        root
    }

    #[test]
    fn path_info_answers_like_stat() {
        let root = scratch("stat");
        fs::write(root.join("a.txt"), b"x").expect("write");
        fs::create_dir_all(root.join("already")).expect("mkdir");

        assert!(StdClassqFileSystem.path_info(root.join("already").to_str().expect("utf-8")).is_directory);
        assert!(StdClassqFileSystem.path_info(root.join("a.txt").to_str().expect("utf-8")).is_file);
        // Negative control: a missing path is `exists: false`, which is what makes a bad root a plan row.
        assert!(!StdClassqFileSystem.path_info(root.join("nope").to_str().expect("utf-8")).exists);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn list_dir_reports_name_path_and_flags() {
        let root = scratch("listing");
        fs::create_dir_all(root.join("already")).expect("mkdir");
        fs::write(root.join("pending.zip"), b"x").expect("write");
        let entries = StdClassqFileSystem
            .list_dir(root.to_str().expect("utf-8"))
            .expect("listing")
            .into_iter()
            .map(|entry| (entry.name, entry.is_file, entry.is_directory))
            .collect::<Vec<_>>();
        assert_eq!(entries.len(), 2);
        assert!(entries.iter().any(|(name, is_file, dir)| name == "already" && !is_file && *dir));
        assert!(entries.iter().any(|(name, is_file, dir)| name == "pending.zip" && *is_file && !dir));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn copy_refuses_an_existing_target_and_walks_directories() {
        let root = scratch("copy");
        fs::create_dir_all(root.join("src/inner")).expect("mkdir");
        fs::write(root.join("src/inner/n.txt"), b"hello").expect("write");
        let source = root.join("src");
        let target = root.join("wait/src");
        StdClassqFileSystem
            .transfer(source.to_str().expect("utf-8"), target.to_str().expect("utf-8"), ClassqTransferMode::Copy)
            .expect("copy");
        assert_eq!(fs::read(root.join("wait/src/inner/n.txt")).expect("read"), b"hello");
        let again = StdClassqFileSystem.transfer(
            source.to_str().expect("utf-8"),
            target.to_str().expect("utf-8"),
            ClassqTransferMode::Copy,
        );
        assert!(again.is_err(), "cp({{ errorOnExist: true }}) threw, so a second copy must too: {again:?}");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn move_leaves_nothing_behind() {
        let root = scratch("move");
        fs::create_dir_all(root.join("wait")).expect("mkdir");
        fs::write(root.join("pending.zip"), b"x").expect("write");
        StdClassqFileSystem
            .transfer(
                root.join("pending.zip").to_str().expect("utf-8"),
                root.join("wait/pending.zip").to_str().expect("utf-8"),
                ClassqTransferMode::Move,
            )
            .expect("move");
        assert!(!root.join("pending.zip").exists());
        assert!(root.join("wait/pending.zip").exists());
        let _ = fs::remove_dir_all(root);
    }
}
