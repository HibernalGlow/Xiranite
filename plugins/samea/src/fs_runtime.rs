//! The `std::fs` implementation of [`SameaFileSystem`] — the half that ADR-0071 moved out of the host.
//!
//! `platform.ts:1-3` used `node:fs/promises` and `node:path`; in the plugin these are plain `std::fs`
//! calls against the WASI preopens the host grants from this node's `manifest.toml` `allowed_paths`
//! (ADR-0071 decision 2). There is no `xiranite.fs.*` call here and there must not be one: that family
//! was retired, and containment is the engine's job — writing into a `ro:` preopen comes back as
//! `ErrorKind::Unsupported` and a path that escapes the granted roots as `PermissionDenied`, both of
//! which land in [`SameaIoError`] and then in one plan item's `reason` (`core.ts:117`).
//!
//! ## Deviations, both visible in the data
//!
//! * **Listings are sorted by name.** `readdir` has no defined order, so neither did
//!   `platform.ts:11`; sorting makes a run reproducible, which matters because `data.items` is the order
//!   the UI table and the apply loop follow.
//! * **A read failure reports the OS message.** `platform.ts:8-10` swallowed `stat` errors into
//!   `exists: false` (reproduced exactly), while a `readdir`/`rename` rejection reached `errorMessage`
//!   (`core.ts:254`). Rust's `io::Error` `Display` is the OS text on every platform, so the shape of what
//!   the item says is unchanged even though the wording differs from `ENOENT: no such file or directory`.

use std::fs;
use std::path::Path;

use crate::contract::{SameaDirEntry, SameaPathInfo};
use crate::fs_surface::{SameaFileSystem, SameaIoError};
use crate::path_tools::{path_dirname, path_join};

/// SameA's machine surface, backed by the guest filesystem view.
#[derive(Debug, Default, Clone, Copy)]
pub struct NativeSameaFileSystem;

impl NativeSameaFileSystem {
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

impl SameaFileSystem for NativeSameaFileSystem {
    fn path_info(&mut self, path: &str) -> SameaPathInfo {
        // `platform.ts:7-10`: any error — missing, unreadable, refused by a preopen — reads as
        // `exists: false`, never as a failure.
        match fs::metadata(path) {
            Ok(info) => SameaPathInfo {
                path: path.to_string(),
                exists: true,
                is_file: info.is_file(),
                is_directory: info.is_dir(),
            },
            Err(_) => SameaPathInfo {
                path: path.to_string(),
                exists: false,
                is_file: false,
                is_directory: false,
            },
        }
    }

    fn list_dir(&mut self, path: &str) -> Result<Vec<SameaDirEntry>, SameaIoError> {
        let reader = fs::read_dir(path).map_err(|error| io_error(path, &error))?;
        let mut entries: Vec<SameaDirEntry> = Vec::new();
        for item in reader {
            let item = match item {
                Ok(item) => item,
                Err(error) => return Err(io_error(path, &error)),
            };
            let name = item.file_name().to_string_lossy().into_owned();
            let file_type = item.file_type();
            entries.push(SameaDirEntry {
                // `platform.ts:11` builds the entry path with `join(path, entry.name)`.
                path: path_join(&[path, &name]),
                is_file: file_type.as_ref().is_ok_and(std::fs::FileType::is_file),
                is_directory: file_type.as_ref().is_ok_and(std::fs::FileType::is_dir),
                name,
            });
        }
        entries.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(entries)
    }

    fn ensure_dir(&mut self, path: &str) -> Result<(), SameaIoError> {
        // `platform.ts:12` used `mkdir(path, { recursive: true })`, which succeeds when the directory
        // already exists; `create_dir_all` has the same rule.
        fs::create_dir_all(path).map_err(|error| io_error(path, &error))
    }

    fn move_path(&mut self, source: &str, target: &str) -> Result<(), SameaIoError> {
        // `platform.ts:13`: create the target's parent, then rename. `rename` moves within a preopen and
        // fails across one, which is exactly the containment the manifest's `allowed_paths` promises.
        let parent = path_dirname(target);
        if !parent.is_empty() && parent != "." {
            fs::create_dir_all(&parent).map_err(|error| io_error(&parent, &error))?;
        }
        fs::rename(Path::new(source), Path::new(target))
            .map_err(|error| io_error(&format!("{source} -> {target}"), &error))
    }
}

fn io_error(path: &str, error: &std::io::Error) -> SameaIoError {
    SameaIoError::new(path, format!("{error} ({})", error.kind()))
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;

    /// A real-disk control for the preopen-facing implementation: SameA's effects through `std::fs`, in a
    /// throwaway directory under the platform temp dir, removed before the test reports.
    struct TempRoot {
        root: std::path::PathBuf,
    }

    impl TempRoot {
        fn new(label: &str) -> Self {
            let unique = format!("xiranite-samea-{label}-{}", std::process::id());
            let root = std::env::temp_dir().join(unique);
            let _ = fs::remove_dir_all(&root);
            fs::create_dir_all(&root).expect("the temp root is creatable");
            Self { root }
        }

        fn path(&self, name: &str) -> String {
            self.root.join(name).to_string_lossy().into_owned()
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn a_moved_archive_is_gone_from_its_source_directory() {
        let root = TempRoot::new("move");
        let mut file_system = NativeSameaFileSystem::new();
        let archive = root.path("[Artist] one.zip");
        fs::write(&archive, b"zip").expect("fixture written");
        let target = root.path("[Artist]/[Artist] one.zip");

        file_system.move_path(&archive, &target).expect("the move runs");

        assert!(!file_system.path_info(&archive).exists, "the source is no longer there");
        let moved = file_system.path_info(&target);
        assert!(moved.exists && moved.is_file, "{moved:?}");
        // Negative control: the directory the move created is a directory, not a file.
        let folder = file_system.path_info(&root.path("[Artist]"));
        assert!(folder.exists && folder.is_directory && !folder.is_file);
    }

    #[test]
    fn a_missing_directory_is_an_error_not_an_empty_listing() {
        let root = TempRoot::new("missing");
        let mut file_system = NativeSameaFileSystem::new();
        assert!(!file_system.path_info(&root.path("nope")).exists);
        assert!(file_system.list_dir(&root.path("nope")).is_err(), "readdir on a missing path rejects");
    }
}
