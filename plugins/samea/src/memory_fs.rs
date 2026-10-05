//! The deterministic double for [`crate::fs_surface::SameaFileSystem`].
//!
//! It mirrors the fixture the node's own tests use (`core.test.ts:75-87` `fakeRuntime`): a directory map,
//! entries whose paths exist because some listing reports them, recorded moves, and nothing else. The
//! parity cases in `tests/core_cases.rs` run against this type, which is what lets the whole plan and
//! apply loop be tested without a disk (ADR-0068: the domain core must not depend on a runtime).
//!
//! Three deliberate additions over `fakeRuntime`, none of which changes an existing expectation:
//! * [`MemoryFileSystem::with_failing_path`] injects the rejection `platform.ts:13`'s `rename` would throw,
//!   so `core.ts:116-117`'s per-item `catch` is reachable in a test;
//! * a recorded move also **applies** to the tree, so a later listing sees the file under its target.
//!   `fakeRuntime` only appended to `moves`, and every TypeScript case reads `moves` after its last
//!   listing (`core.test.ts:31`, `core.test.ts:63`);
//! * `ensure_dir` and `move_path` take `&mut self` through the trait, which is how the recording happens
//!   without a `RefCell` in the domain path.

use std::collections::BTreeMap;

use crate::contract::{SameaDirEntry, SameaPathInfo};
use crate::fs_surface::{SameaFileSystem, SameaIoError};
use crate::path_tools::{normalize_path, path_basename, path_dirname, path_join};

/// A filesystem tree built from listings, plus the effects that were applied to it.
#[derive(Debug, Default)]
pub struct MemoryFileSystem {
    listings: BTreeMap<String, Vec<SameaDirEntry>>,
    /// Paths whose effect fails, mapped to the message the host would have produced.
    failing: BTreeMap<String, String>,
    moves: Vec<(String, String)>,
    ensured: Vec<String>,
}

impl MemoryFileSystem {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers a directory and the entries it contains, in the order given. Entry paths are
    /// `join(directory, name)`, exactly as `platform.ts:11` builds them.
    #[must_use]
    pub fn with_directory(self, directory: &str, entries: &[(&str, bool)]) -> Self {
        let listing = entries
            .iter()
            .map(|(name, is_directory)| SameaDirEntry {
                name: (*name).to_string(),
                path: path_join(&[directory, name]),
                is_file: !*is_directory,
                is_directory: *is_directory,
            })
            .collect();
        self.with_listing(directory, listing)
    }

    /// Registers a directory with ready-made entries, for the cases that need an entry carrying its own
    /// absolute path (`core.test.ts:38`, the archive already inside `[Artist]`).
    #[must_use]
    pub fn with_listing(mut self, directory: &str, entries: Vec<SameaDirEntry>) -> Self {
        self.listings.insert(directory.to_string(), entries);
        self
    }

    /// Any effect naming `path` fails with `message`, mirroring a rejected `node:fs` promise.
    #[must_use]
    pub fn with_failing_path(mut self, path: &str, message: &str) -> Self {
        self.failing.insert(normalize_path(path), message.to_string());
        self
    }

    /// `moves` in `core.test.ts:27`: the recorded `(source, target)` pairs in call order.
    #[must_use]
    pub fn recorded_moves(&self) -> &[(String, String)] {
        &self.moves
    }

    /// Every `ensureDir` argument, in call order (`core.ts:113`).
    #[must_use]
    pub fn recorded_ensure_dirs(&self) -> &[String] {
        &self.ensured
    }

    fn find_entry(&self, path: &str) -> Option<&SameaDirEntry> {
        self.listings.values().flatten().find(|entry| entry.path == path)
    }

    fn failure(&self, path: &str) -> Option<SameaIoError> {
        let message = self.failing.get(&normalize_path(path))?;
        Some(SameaIoError::new(path, message.clone()))
    }
}

impl SameaFileSystem for MemoryFileSystem {
    fn path_info(&mut self, path: &str) -> SameaPathInfo {
        if self.listings.contains_key(path) {
            return SameaPathInfo {
                path: path.to_string(),
                exists: true,
                is_file: false,
                is_directory: true,
            };
        }
        if let Some(entry) = self.find_entry(path) {
            return SameaPathInfo {
                path: path.to_string(),
                exists: true,
                is_file: entry.is_file,
                is_directory: entry.is_directory,
            };
        }
        SameaPathInfo { path: path.to_string(), exists: false, is_file: false, is_directory: false }
    }

    fn list_dir(&mut self, path: &str) -> Result<Vec<SameaDirEntry>, SameaIoError> {
        // `core.ts:174`'s `await runtime.listDir(directory)` is the one scan effect that can reject
        // (`platform.ts:11`), and `core.test.ts:82` shows an unknown directory listing as empty instead.
        if let Some(error) = self.failure(path) {
            return Err(error);
        }
        Ok(self.listings.get(path).cloned().unwrap_or_default())
    }

    fn ensure_dir(&mut self, path: &str) -> Result<(), SameaIoError> {
        if let Some(error) = self.failure(path) {
            return Err(error);
        }
        self.ensured.push(path.to_string());
        Ok(())
    }

    fn move_path(&mut self, source: &str, target: &str) -> Result<(), SameaIoError> {
        if let Some(error) = self.failure(source).or_else(|| self.failure(target)) {
            return Err(error);
        }
        self.apply_move(source, target);
        Ok(())
    }
}

impl MemoryFileSystem {
    /// Removes the source entry, re-points a moved directory's own listing, and inserts the target entry.
    fn apply_move(&mut self, source: &str, target: &str) {
        self.moves.push((source.to_string(), target.to_string()));

        let mut moved_is_directory = false;
        for listing in self.listings.values_mut() {
            if let Some(index) = listing.iter().position(|entry| entry.path == source) {
                moved_is_directory = listing[index].is_directory;
                listing.remove(index);
                break;
            }
        }

        if let Some(listing) = self.listings.remove(source) {
            let renamed: Vec<SameaDirEntry> = listing
                .into_iter()
                .map(|entry| SameaDirEntry {
                    path: entry.path.strip_prefix(source).map_or_else(
                        || entry.path.clone(),
                        |rest| format!("{target}{rest}"),
                    ),
                    ..entry
                })
                .collect();
            self.listings.insert(target.to_string(), renamed);
        }

        let parent = path_dirname(target);
        let listing = self.listings.entry(parent).or_default();
        if !listing.iter().any(|entry| entry.path == target) {
            listing.push(SameaDirEntry {
                name: path_basename(target),
                path: target.to_string(),
                is_file: !moved_is_directory,
                is_directory: moved_is_directory,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_registered_listing_answers_path_info() {
        let mut tree = MemoryFileSystem::new().with_directory("/archive", &[("[Artist] one.zip", false)]);
        let directory = tree.path_info("/archive");
        assert!(directory.exists && directory.is_directory);
        let entry = tree.path_info("/archive/[Artist] one.zip");
        assert!(entry.exists && entry.is_file);
        // Negative control: an unregistered path reports as missing, not as an error.
        let missing = tree.path_info("/elsewhere");
        assert!(!missing.exists && !missing.is_directory);
    }

    #[test]
    fn a_failing_path_turns_the_effect_into_the_thrown_message() {
        let mut tree = MemoryFileSystem::new()
            .with_directory("/archive", &[("a.zip", false)])
            .with_failing_path("/archive/[Artist]", "EACCES: permission denied");
        assert_eq!(
            tree.ensure_dir("/archive/[Artist]").err().map(|error| error.message),
            Some("EACCES: permission denied".to_string())
        );
        assert!(tree.ensure_dir("/archive/other").is_ok());
        assert_eq!(tree.recorded_ensure_dirs(), &["/archive/other".to_string()]);
    }

    #[test]
    fn a_move_records_itself_and_relocates_the_entry() {
        let mut tree = MemoryFileSystem::new().with_directory("/archive", &[("a.zip", false)]);
        tree.move_path("/archive/a.zip", "/archive/[Artist]/a.zip").expect("movable");
        assert_eq!(
            tree.recorded_moves(),
            &[("/archive/a.zip".to_string(), "/archive/[Artist]/a.zip".to_string())]
        );
        assert!(!tree.path_info("/archive/a.zip").exists, "the source is gone");
        assert!(tree.path_info("/archive/[Artist]/a.zip").is_file, "the target exists");
        // Negative control: the listing the plan would re-read no longer reports the source.
        assert!(tree.list_dir("/archive").expect("listing").is_empty());
    }

    #[test]
    fn moving_a_directory_carries_its_children() {
        let mut tree = MemoryFileSystem::new()
            .with_directory("/archive", &[("[Artist]", true)])
            .with_directory("/archive/[Artist]", &[("inside.zip", false)]);
        tree.move_path("/archive/[Artist]", "/archive/[00画师分类]/[Artist]")
            .expect("movable");
        assert!(tree.path_info("/archive/[00画师分类]/[Artist]").is_directory);
        assert!(tree.path_info("/archive/[00画师分类]/[Artist]/inside.zip").is_file);
        assert!(!tree.path_info("/archive/[Artist]/inside.zip").exists);
    }
}
