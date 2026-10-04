//! An in-memory `DissolvefHost` that behaves like `platform.ts` on a real machine.
//!
//! The ported `core.test.ts` cases assert that files moved and directories disappeared, so this is a small
//! filesystem rather than a recorder: it holds directories and file contents, applies moves and deletes, and
//! refuses the same operations `node:fs` refuses — a missing `readdir`, a non-empty `rmdir`, an `ENOENT`
//! delete. The refusal messages keep Node's spelling so a test can pin what ends up in a plan row's
//! `reason`.
//!
//! Two host behaviours are reproduced deliberately, because they are what the plugin depends on:
//!
//! - `stat` reports a refused path as `exists: false` (`platform.ts:70-78`), never as an error.
//! - `move_path` creates missing parents of the target (`platform.ts:91`), which is how `undo` rebuilds a
//!   directory chain it never recorded an explicit `ensureDir` for.

use std::collections::{BTreeMap, BTreeSet};

use xiranite_plugin_api::{CheckpointOutcome, PluginRunEvent};

use crate::document::{DissolvefDirEntry, DissolvefPathInfo};
use crate::host::{
    DissolvefCheckpointRequest, DissolvefHost, DissolvefHostError, DissolvefHostResult,
};
use crate::paths::{basename_of, dirname_of, is_same_or_inside, join_paths};

#[derive(Debug)]
pub(crate) struct InMemoryDissolvefHost {
    /// File contents by path.
    pub files: BTreeMap<String, String>,
    /// Every directory that exists, roots included.
    pub directories: BTreeSet<String>,
    pub moves: Vec<(String, String)>,
    pub deletes: Vec<(String, bool)>,
    pub events: Vec<PluginRunEvent>,
    pub checkpoints: Vec<DissolvefCheckpointRequest>,
    /// Paths whose capability call the host refuses, the way a locked or unreadable folder does.
    pub failing_paths: Vec<String>,
    /// Paths only the delete call refuses. A directory the plan has to list before it can be emptied needs
    /// this narrower injection, so a test can pin the `delete_dir` failure row without breaking the scan.
    pub failing_deletes: Vec<String>,
    /// What every checkpoint answers.
    pub checkpoint_outcome: CheckpointOutcome,
    /// How many checkpoint calls to answer before switching to `checkpoint_outcome`.
    pub continue_checkpoint_count: usize,
    /// The clock `xiranite.now` reports; a fixed value keeps journal ids reproducible.
    pub now_iso: String,
}

impl Default for InMemoryDissolvefHost {
    fn default() -> Self {
        Self {
            files: BTreeMap::new(),
            directories: BTreeSet::new(),
            moves: Vec::new(),
            deletes: Vec::new(),
            events: Vec::new(),
            checkpoints: Vec::new(),
            failing_paths: Vec::new(),
            failing_deletes: Vec::new(),
            checkpoint_outcome: CheckpointOutcome::Continue,
            continue_checkpoint_count: usize::MAX,
            now_iso: "2026-07-21T16:04:54.445Z".to_string(),
        }
    }
}

impl InMemoryDissolvefHost {
    /// The test-side `mkdir(path, {recursive: true})`.
    pub(crate) fn make_directory(&mut self, path: &str) {
        self.create_directories_along(path);
        self.directories.insert(path.to_string());
    }

    /// The test-side `writeFile(path, content)` plus its parent directory.
    pub(crate) fn make_file(&mut self, path: &str, content: &str) {
        self.create_directories_along(&dirname_of(path));
        self.files.insert(path.to_string(), content.to_string());
    }

    /// The test-side `existsSync`.
    #[must_use]
    pub(crate) fn exists(&self, path: &str) -> bool {
        self.files.contains_key(path) || self.directories.contains(path)
    }

    /// The test-side `readFile(path, "utf8")`.
    #[must_use]
    pub(crate) fn read(&self, path: &str) -> Option<String> {
        self.files.get(path).cloned()
    }

    fn create_directories_along(&mut self, path: &str) {
        let mut current = path.to_string();
        loop {
            if current.is_empty() || self.directories.contains(&current) {
                return;
            }
            self.directories.insert(current.clone());
            let parent = dirname_of(&current);
            if parent == current || parent == "." || parent.is_empty() {
                return;
            }
            current = parent;
        }
    }

    fn refuse_if_requested(&self, path: &str) -> DissolvefHostResult<()> {
        if self.failing_paths.iter().any(|failing| failing == path) {
            return Err(DissolvefHostError::Failure(format!(
                "EPERM: operation not permitted, {path}"
            )));
        }
        Ok(())
    }

    fn direct_children(&self, path: &str) -> Vec<DissolvefDirEntry> {
        let mut children = Vec::new();
        for directory in &self.directories {
            if directory != path && dirname_of(directory) == path {
                children.push(DissolvefDirEntry {
                    name: basename_of(directory),
                    path: directory.clone(),
                    is_file: false,
                    is_directory: true,
                });
            }
        }
        for file in self.files.keys() {
            if dirname_of(file) == path {
                children.push(DissolvefDirEntry {
                    name: basename_of(file),
                    path: file.clone(),
                    is_file: true,
                    is_directory: false,
                });
            }
        }
        children
    }

    fn descendant_paths(&self, root: &str) -> Vec<String> {
        let mut found: Vec<String> = self
            .directories
            .iter()
            .chain(self.files.keys())
            .filter(|candidate| candidate.as_str() != root && is_same_or_inside(candidate, root))
            .cloned()
            .collect();
        found.sort();
        found
    }
}

impl DissolvefHost for InMemoryDissolvefHost {
    fn stat(&mut self, path: &str) -> DissolvefHostResult<DissolvefPathInfo> {
        // `platform.ts:70-78`: a refusal is indistinguishable from "not there".
        if self.failing_paths.iter().any(|failing| failing == path) {
            return Ok(DissolvefPathInfo::missing(path));
        }
        Ok(DissolvefPathInfo {
            path: path.to_string(),
            exists: self.exists(path),
            is_file: self.files.contains_key(path),
            is_directory: self.directories.contains(path),
        })
    }

    fn list_dir(&mut self, path: &str) -> DissolvefHostResult<Vec<DissolvefDirEntry>> {
        self.refuse_if_requested(path)?;
        if !self.directories.contains(path) {
            return Err(DissolvefHostError::Failure(format!(
                "ENOENT: no such file or directory, scandir '{path}'"
            )));
        }
        // The plugin re-joins names onto the directory it listed, so these entries carry the fake's own join.
        Ok(self.direct_children(path))
    }

    fn ensure_dir(&mut self, path: &str) -> DissolvefHostResult<()> {
        self.refuse_if_requested(path)?;
        self.create_directories_along(path);
        self.directories.insert(path.to_string());
        Ok(())
    }

    fn move_path(&mut self, source: &str, target: &str) -> DissolvefHostResult<()> {
        self.refuse_if_requested(source)?;
        if !self.exists(source) {
            return Err(DissolvefHostError::Failure(format!(
                "ENOENT: no such file or directory, rename '{source}' -> '{target}'"
            )));
        }
        if self.exists(target) {
            if self.directories.contains(target) && !self.direct_children(target).is_empty() {
                // `rename` onto a non-empty directory fails; `platform.ts:93-97` would then have taken the
                // copy path, and `cp(..., errorOnExist: true)` fails the same way.
                return Err(DissolvefHostError::Failure(format!(
                    "ENOTEMPTY: directory not empty, rename '{source}' -> '{target}'"
                )));
            }
            self.files.remove(target);
        }
        self.create_directories_along(&dirname_of(target));
        if let Some(content) = self.files.remove(source) {
            self.files.insert(target.to_string(), content);
        } else {
            let descendants = self.descendant_paths(source);
            self.directories.remove(source);
            for old in descendants {
                let rest = old[source.len()..].trim_start_matches(['/', '\\']);
                let new = join_paths(&[target, rest]);
                match self.files.remove(&old) {
                    Some(content) => {
                        self.files.insert(new, content);
                    }
                    None => {
                        self.directories.remove(&old);
                        self.directories.insert(new);
                    }
                }
            }
            self.directories.insert(target.to_string());
        }
        self.moves.push((source.to_string(), target.to_string()));
        Ok(())
    }

    fn delete_path(&mut self, path: &str, recursive: bool) -> DissolvefHostResult<()> {
        self.refuse_if_requested(path)?;
        if self.failing_deletes.iter().any(|failing| failing == path) {
            return Err(DissolvefHostError::Failure(format!(
                "EPERM: operation not permitted, rmdir '{path}'"
            )));
        }
        if !self.exists(path) {
            // `rm(force: false)` and `rmdir` both report the missing path, and `core.ts:505-507` records that
            // as the row's `reason`.
            return Err(DissolvefHostError::Failure(format!(
                "ENOENT: no such file or directory, lstat '{path}'"
            )));
        }
        if !recursive && self.directories.contains(path) {
            let children = self.direct_children(path);
            if !children.is_empty() {
                return Err(DissolvefHostError::Failure(format!(
                    "ENOTEMPTY: directory not empty, rmdir '{path}'"
                )));
            }
        }
        for old in self.descendant_paths(path) {
            self.files.remove(&old);
            self.directories.remove(&old);
        }
        self.files.remove(path);
        self.directories.remove(path);
        self.deletes.push((path.to_string(), recursive));
        Ok(())
    }

    fn read_text(&mut self, path: &str) -> DissolvefHostResult<Option<String>> {
        // `platform.ts:110-116`: anything that cannot be read is `null`.
        Ok(self.files.get(path).cloned())
    }

    fn write_text(&mut self, path: &str, content: &str) -> DissolvefHostResult<()> {
        self.refuse_if_requested(path)?;
        self.create_directories_along(&dirname_of(path));
        self.files.insert(path.to_string(), content.to_string());
        Ok(())
    }

    fn now(&mut self) -> DissolvefHostResult<String> {
        Ok(self.now_iso.clone())
    }

    fn emit(&mut self, event: &PluginRunEvent) -> DissolvefHostResult<()> {
        self.events.push(event.clone());
        Ok(())
    }

    fn checkpoint(&mut self, request: &DissolvefCheckpointRequest) -> DissolvefHostResult<CheckpointOutcome> {
        let answered = self.checkpoints.len();
        self.checkpoints.push(request.clone());
        if answered >= self.continue_checkpoint_count {
            return Ok(self.checkpoint_outcome);
        }
        Ok(CheckpointOutcome::Continue)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The host semantics the report asks the real host to match, pinned on the fake so the port is not
    /// asserting against a double that quietly differs.
    #[test]
    fn a_non_recursive_delete_refuses_a_directory_with_content() {
        let mut host = InMemoryDissolvefHost::default();
        host.make_file("/root/album/page.png", "x");
        let error = host
            .delete_path("/root/album", false)
            .expect_err("rmdir of a non-empty directory must fail");
        assert!(matches!(error, DissolvefHostError::Failure(_)), "{error:?}");
        assert!(error.message().contains("ENOTEMPTY"), "{}", error.message());
        assert!(host.exists("/root/album/page.png"));

        host.delete_path("/root/album/page.png", false).expect("a file deletes");
        host.delete_path("/root/album", false).expect("the emptied directory deletes");
        assert!(!host.exists("/root/album"));
    }

    #[test]
    fn a_recursive_delete_takes_the_whole_subtree() {
        let mut host = InMemoryDissolvefHost::default();
        host.make_file("/root/a/b/c/file.txt", "x");
        host.delete_path("/root/a", true).expect("recursive delete");
        assert!(!host.exists("/root/a/b/c/file.txt"));
        assert!(host.exists("/root"));
    }

    #[test]
    fn a_move_creates_missing_parents_and_rekeys_a_directory() {
        let mut host = InMemoryDissolvefHost::default();
        host.make_file("/root/a/b/c/file.txt", "hello");
        host.move_path("/root/a/b/c/file.txt", "/root/out/deep/file.txt")
            .expect("move into missing directories");
        assert_eq!(host.read("/root/out/deep/file.txt").as_deref(), Some("hello"));
        assert!(!host.exists("/root/a/b/c/file.txt"));

        host.make_file("/root/chain/inner/one.txt", "1");
        host.move_path("/root/chain", "/root/moved").expect("move a directory");
        assert_eq!(host.read("/root/moved/inner/one.txt").as_deref(), Some("1"));
        assert!(!host.exists("/root/chain/inner"));
    }

    #[test]
    fn list_dir_reports_names_and_kinds_of_direct_children_only() {
        let mut host = InMemoryDissolvefHost::default();
        host.make_file("/root/album/a.zip", "z");
        host.make_file("/root/album/deep/b.txt", "b");
        host.make_directory("/root/other");
        let entries = host.list_dir("/root/album").expect("listing");
        let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(names, vec!["deep", "a.zip"], "files sort first in the plugin, not here");
        assert!(entries.iter().any(|entry| entry.is_directory && entry.name == "deep"));
    }
}
