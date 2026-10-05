//! Deterministic in-memory [`SnfFileSystem`] used by the tests and by the host's
//! plugin tests.
//!
//! It is a port of `fakeRuntime` and `infoFor` in
//! `packages/nodes/snf/src/core.test.ts:64-87`, including the two details the
//! vitest cases rely on: a path that is a listed directory *or* a listed entry is
//! `exists: true` with `atimeMs` 1000 and `mtimeMs` 2000, and everything else is
//! `exists: false`. `renames` and `setTimes` record their calls so a test can assert
//! the rename list itself, which is what the vitest case at `core.test.ts:59-60`
//! checks.

use std::cell::RefCell;
use std::collections::HashMap;

use crate::contract::{SnfDirEntry, SnfPathInfo};
use crate::file_system::{SnfFileAccessError, SnfFileSystem};

/// `atimeMs` the vitest fake answers with.
pub const FAKE_ATIME_MS: u64 = 1000;
/// `mtimeMs` the vitest fake answers with.
pub const FAKE_MTIME_MS: u64 = 2000;

#[derive(Debug, Default)]
pub struct MemoryFileSystem {
    directories: HashMap<String, Vec<SnfDirEntry>>,
    renames: RefCell<Vec<(String, String)>>,
    timestamp_calls: RefCell<Vec<(String, u64, u64)>>,
    /// Paths whose rename must fail, and the message the host reports, so the
    /// `status: "error"` branch of `core.ts:108-110` is reachable in a test.
    rename_failures: HashMap<String, String>,
    /// Paths that `list_directory` must refuse, mirroring a throwing `readdir`.
    listing_failures: HashMap<String, String>,
}

impl MemoryFileSystem {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers one directory and its entries. An entry that is a directory and
    /// whose `path` is also registered keeps its own listing.
    #[must_use]
    pub fn with_directory(mut self, path: &str, entries: &[(&str, bool)]) -> Self {
        self.directories.insert(
            path.to_string(),
            entries
                .iter()
                .map(|(name, is_directory)| SnfDirEntry {
                    name: (*name).to_string(),
                    path: join_for_fixture(path, *name, *is_directory),
                    is_directory: *is_directory,
                })
                .collect(),
        );
        self
    }

    /// Registers a rename failure for `source_path`.
    #[must_use]
    pub fn with_failing_rename(mut self, source_path: &str, message: &str) -> Self {
        self.rename_failures
            .insert(source_path.to_string(), message.to_string());
        self
    }

    /// Registers a directory-listing failure.
    #[must_use]
    pub fn with_failing_listing(mut self, path: &str, message: &str) -> Self {
        self.listing_failures
            .insert(path.to_string(), message.to_string());
        self
    }

    #[must_use]
    pub fn recorded_renames(&self) -> Vec<(String, String)> {
        self.renames.borrow().clone()
    }

    #[must_use]
    pub fn recorded_timestamp_calls(&self) -> Vec<(String, u64, u64)> {
        self.timestamp_calls.borrow().clone()
    }

    fn find_entry(&self, path: &str) -> Option<&SnfDirEntry> {
        self.directories
            .values()
            .flatten()
            .find(|entry| entry.path == path)
    }
}

/// The fixture joins with `/` so a test can write the same paths it wrote in
/// `core.test.ts`, and uses `\` only when the parent already looks like a Windows
/// path.
fn join_for_fixture(parent: &str, name: &str, _is_directory: bool) -> String {
    if parent.is_empty() {
        return name.to_string();
    }
    if parent.ends_with('/') || parent.ends_with('\\') {
        return format!("{parent}{name}");
    }
    let separator = if parent.contains('\\') { '\\' } else { '/' };
    format!("{parent}{separator}{name}")
}

impl SnfFileSystem for MemoryFileSystem {
    fn path_info(&self, path: &str) -> Result<SnfPathInfo, SnfFileAccessError> {
        // `infoFor` at core.test.ts:80-87: a listed directory first, then any
        // listed entry, then "does not exist" rather than an error.
        if self.directories.contains_key(path) {
            return Ok(SnfPathInfo {
                path: path.to_string(),
                exists: true,
                is_directory: true,
                atime_ms: FAKE_ATIME_MS,
                mtime_ms: FAKE_MTIME_MS,
            });
        }
        if let Some(entry) = self.find_entry(path) {
            return Ok(SnfPathInfo {
                path: path.to_string(),
                exists: true,
                is_directory: entry.is_directory,
                atime_ms: FAKE_ATIME_MS,
                mtime_ms: FAKE_MTIME_MS,
            });
        }
        Ok(SnfPathInfo {
            path: path.to_string(),
            exists: false,
            is_directory: false,
            atime_ms: 0,
            mtime_ms: 0,
        })
    }

    fn list_directory(&self, path: &str) -> Result<Vec<SnfDirEntry>, SnfFileAccessError> {
        if let Some(message) = self.listing_failures.get(path) {
            return Err(SnfFileAccessError::new("io_error", message.clone()));
        }
        Ok(self.directories.get(path).cloned().unwrap_or_default())
    }

    fn rename_folder(&self, source_path: &str, target_path: &str) -> Result<(), SnfFileAccessError> {
        if let Some(message) = self.rename_failures.get(source_path) {
            return Err(SnfFileAccessError::new("io_error", message.clone()));
        }
        self.renames
            .borrow_mut()
            .push((source_path.to_string(), target_path.to_string()));
        Ok(())
    }

    fn set_folder_timestamps(
        &self,
        path: &str,
        atime_ms: u64,
        mtime_ms: u64,
    ) -> Result<(), SnfFileAccessError> {
        self.timestamp_calls
            .borrow_mut()
            .push((path.to_string(), atime_ms, mtime_ms));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answers_like_the_vitest_double() {
        let file_system = MemoryFileSystem::new().with_directory("/library/Artist", &[("3. CG", true)]);
        let listed = file_system.path_info("/library/Artist").expect("info");
        assert!(listed.exists && listed.is_directory);
        assert_eq!(listed.atime_ms, FAKE_ATIME_MS);
        let entry = file_system.path_info("/library/Artist/3. CG").expect("info");
        assert!(entry.exists && entry.is_directory);
        let missing = file_system.path_info("/library/Nope").expect("info");
        assert!(!missing.exists, "a missing path is `exists: false`, never an error");
        assert_eq!(missing.mtime_ms, 0);
    }

    #[test]
    fn a_file_entry_is_not_a_directory() {
        let file_system = MemoryFileSystem::new().with_directory("/library/Artist", &[("cover.jpg", false)]);
        let info = file_system.path_info("/library/Artist/cover.jpg").expect("info");
        assert!(info.exists);
        assert!(!info.is_directory);
        assert_eq!(file_system.list_directory("/empty").expect("list").len(), 0);
    }
}
