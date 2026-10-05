//! In-memory doubles for the three seams, so a plan can be asserted without a disk.
//!
//! [`MemoryFileSystem`] is the direct port of `fakeRuntime`/`infoFor` in
//! `packages/nodes/classq/src/core.test.ts:84-109`, which is the fixture the four published vitest cases run on.
//! Those cases are this port's behavioural spec, so the double reproduces their rules exactly — including
//! `core.test.ts:91`'s "an unknown directory lists as empty" and `core.test.ts:101-108`'s lookup order (a known
//! directory first, then a known file, then any entry mentioned by a listing, then missing).
//!
//! The double deliberately does not mutate the tree when a transfer "succeeds": `core.test.ts:80` asserts the recorded
//! `(source, target, mode)` triples, not the after-state, and the after-state is what
//! [`crate::std_file_system`] plus `tests/file_system_cases.rs` prove against a real directory.

use std::cell::RefCell;

use crate::contract::{ClassqDirEntry, ClassqPathInfo, ClassqRunEvent, ClassqTransferMode};
use crate::path_text::join_path;
use crate::runtime::{
    ClassqCheckpointOutcome, ClassqEventSink, ClassqFileSystem, ClassqPhase, ClassqRunControl, ClassqRuntimeError,
};

/// One recorded `runtime.transfer` call (`core.test.ts:93`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordedTransfer {
    /// The source path.
    pub source: String,
    /// The target path.
    pub target: String,
    /// The mode the run asked for.
    pub mode: ClassqTransferMode,
}

/// A directory tree in memory, mirroring `core.test.ts:84-99`.
#[derive(Debug, Default)]
pub struct MemoryFileSystem {
    /// `options.dirs`: directory path → its entries, in listing order.
    directories: Vec<(String, Vec<ClassqDirEntry>)>,
    /// `options.existing`: paths that exist as plain files and are not part of any listing, which is how a
    /// pre-existing wait target is planted (`core.test.ts:54`).
    loose_files: Vec<String>,
    /// `options.transfers`.
    transfers: RefCell<Vec<RecordedTransfer>>,
    /// `runtime.ensureDir` calls, in order.
    created: RefCell<Vec<String>>,
    /// Directories whose listing fails, exercising the plan-abort path (`core.ts:117-119`).
    unreadable: Vec<String>,
    /// Sources whose transfer fails, exercising the per-item error path (`core.ts:112-114`).
    untransferable: Vec<String>,
    /// Targets whose `ensureDir` fails.
    unwritable: Vec<String>,
}

impl MemoryFileSystem {
    /// An empty tree.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a directory and its entries. `("already", true)` is a folder, `("pending.zip", false)` a file; paths are
    /// built with [`join_path`] exactly as `platform.ts:17` does.
    #[must_use]
    pub fn with_directory(mut self, path: &str, entries: &[(&str, bool)]) -> Self {
        let listing = entries
            .iter()
            .map(|(name, is_directory)| {
                if *is_directory {
                    ClassqDirEntry::directory(*name, join_path(path, name))
                } else {
                    ClassqDirEntry::file(*name, join_path(path, name))
                }
            })
            .collect();
        self.directories.push((path.to_owned(), listing));
        self
    }

    /// Adds a directory entry that is neither file nor directory (`core.ts:152` drops those), e.g. a symlink.
    #[must_use]
    pub fn with_other_entry(mut self, path: &str, name: &str) -> Self {
        if let Some(listing) = self.directories.iter_mut().find(|(directory, _)| directory == path) {
            listing.1.push(ClassqDirEntry::other(name, join_path(path, name)));
        }
        self
    }

    /// Plants a path that exists as a file but appears in no listing — `options.existing` (`core.test.ts:54`).
    #[must_use]
    pub fn with_existing_file(mut self, path: &str) -> Self {
        self.loose_files.push(path.to_owned());
        self
    }

    /// Makes listing `path` fail.
    #[must_use]
    pub fn with_unreadable_directory(mut self, path: &str) -> Self {
        self.unreadable.push(path.to_owned());
        self
    }

    /// Makes transferring `source` fail.
    #[must_use]
    pub fn with_untransferable_source(mut self, source: &str) -> Self {
        self.untransferable.push(source.to_owned());
        self
    }

    /// Makes `ensureDir(targetParent)` fail.
    #[must_use]
    pub fn with_unwritable_parent(mut self, parent: &str) -> Self {
        self.unwritable.push(parent.to_owned());
        self
    }

    /// The recorded transfers, in call order (`core.test.ts:80`'s assertion target).
    #[must_use]
    pub fn recorded_transfers(&self) -> Vec<RecordedTransfer> {
        self.transfers.borrow().clone()
    }

    /// The recorded `ensureDir` paths.
    #[must_use]
    pub fn recorded_directories(&self) -> Vec<String> {
        self.created.borrow().clone()
    }

    fn listing(&self, path: &str) -> Option<&[ClassqDirEntry]> {
        self.directories.iter().find(|(directory, _)| directory == path).map(|(_, entries)| entries.as_slice())
    }
}

impl ClassqFileSystem for MemoryFileSystem {
    fn path_info(&self, path: &str) -> ClassqPathInfo {
        // `infoFor` (`core.test.ts:101-109`) in its original order.
        if self.listing(path).is_some() {
            return ClassqPathInfo { path: path.to_owned(), exists: true, is_file: false, is_directory: true };
        }
        if self.loose_files.iter().any(|file| file == path) {
            return ClassqPathInfo { path: path.to_owned(), exists: true, is_file: true, is_directory: false };
        }
        for (_, entries) in &self.directories {
            if let Some(entry) = entries.iter().find(|entry| entry.path == path) {
                return ClassqPathInfo {
                    path: path.to_owned(),
                    exists: true,
                    is_file: entry.is_file,
                    is_directory: entry.is_directory,
                };
            }
        }
        ClassqPathInfo::missing(path)
    }

    fn list_dir(&self, path: &str) -> Result<Vec<ClassqDirEntry>, ClassqRuntimeError> {
        if self.unreadable.iter().any(|blocked| blocked == path) {
            return Err(ClassqRuntimeError::new(format!("EACCES: permission denied, scandat '{path}'")));
        }
        // `core.test.ts:91`: an unknown directory lists as empty rather than failing.
        Ok(self.listing(path).map(<[ClassqDirEntry]>::to_vec).unwrap_or_default())
    }

    fn ensure_dir(&self, path: &str) -> Result<(), ClassqRuntimeError> {
        if self.unwritable.iter().any(|blocked| blocked == path) {
            return Err(ClassqRuntimeError::new(format!("EACCES: permission denied, mkdir '{path}'")));
        }
        self.created.borrow_mut().push(path.to_owned());
        Ok(())
    }

    fn transfer(&self, source: &str, target: &str, mode: ClassqTransferMode) -> Result<(), ClassqRuntimeError> {
        if self.untransferable.iter().any(|blocked| blocked == source) {
            return Err(ClassqRuntimeError::new(format!(
                "EBUSY: resource busy or locked, {} '{source}' -> '{target}'",
                if mode == ClassqTransferMode::Copy { "copy" } else { "rename" }
            )));
        }
        self.transfers.borrow_mut().push(RecordedTransfer {
            source: source.to_owned(),
            target: target.to_owned(),
            mode,
        });
        Ok(())
    }
}

/// A control whose answers come from a script, so cancellation is testable without a host.
#[derive(Debug)]
pub struct ScriptedClassqRunControl {
    /// Answers in order; the last one repeats once the script is spent.
    outcomes: Vec<ClassqCheckpointOutcome>,
    /// The calls made so far.
    calls: RefCell<Vec<(String, usize, usize)>>,
    index: RefCell<usize>,
}

impl ScriptedClassqRunControl {
    /// A control that always continues.
    #[must_use]
    pub fn continuing() -> Self {
        Self {
            outcomes: vec![ClassqCheckpointOutcome::Continue],
            calls: RefCell::new(Vec::new()),
            index: RefCell::new(0),
        }
    }

    /// A control that cancels on the `after`th call (0-based), which is how a paused-then-cancelled operation is
    /// rehearsed.
    #[must_use]
    pub fn cancelling_after(after: usize) -> Self {
        let mut outcomes = vec![ClassqCheckpointOutcome::Continue; after];
        outcomes.push(ClassqCheckpointOutcome::Cancelled);
        Self { outcomes, calls: RefCell::new(Vec::new()), index: RefCell::new(0) }
    }

    /// The recorded `(phase, processed, total)` triples.
    #[must_use]
    pub fn recorded_calls(&self) -> Vec<(String, usize, usize)> {
        self.calls.borrow().clone()
    }
}

impl ClassqRunControl for ScriptedClassqRunControl {
    fn checkpoint(
        &mut self,
        phase: ClassqPhase,
        processed_count: usize,
        total_count: usize,
    ) -> ClassqCheckpointOutcome {
        self.calls.borrow_mut().push((phase.as_str().to_owned(), processed_count, total_count));
        let mut index = self.index.borrow_mut();
        let outcome = self.outcomes.get(*index).copied().unwrap_or_else(|| {
            self.outcomes.last().copied().unwrap_or(ClassqCheckpointOutcome::Continue)
        });
        *index += 1;
        outcome
    }
}

/// A sink that keeps every event, for `plugin_entry`'s response document.
#[derive(Debug, Default)]
pub struct CollectingClassqEventSink {
    /// The events in order.
    pub events: Vec<ClassqRunEvent>,
}

impl ClassqEventSink for CollectingClassqEventSink {
    fn on_event(&mut self, event: ClassqRunEvent) {
        self.events.push(event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_double_answers_like_the_vitest_fixture() {
        let file_system = MemoryFileSystem::new()
            .with_directory("/root", &[("already", true), ("pending.zip", false)])
            .with_directory("/root/already", &[])
            .with_existing_file("/root/wait/pending.zip");

        assert!(file_system.path_info("/root").is_directory);
        assert!(file_system.path_info("/root/pending.zip").is_file);
        assert!(file_system.path_info("/root/wait/pending.zip").is_file);
        assert!(!file_system.path_info("/root/nope").exists);
        // `core.test.ts:91`: an unlisted directory reads as empty, and so does a file.
        assert!(file_system.list_dir("/root/nothing").expect("empty listing").is_empty());
    }

    #[test]
    fn injected_failures_are_the_ones_the_core_turns_into_reasons() {
        let file_system = MemoryFileSystem::new()
            .with_directory("/root", &[("pending.zip", false)])
            .with_unreadable_directory("/root")
            .with_untransferable_source("/root/pending.zip");
        assert!(file_system.list_dir("/root").is_err());
        assert!(
            file_system.transfer("/root/pending.zip", "/root/wait/pending.zip", ClassqTransferMode::Move).is_err()
        );
        // Negative control: a path nobody blocked still works.
        assert!(file_system.list_dir("/elsewhere").is_ok());
        assert_eq!(file_system.path_info("/root/wait/pending.zip"), ClassqPathInfo::missing("/root/wait/pending.zip"));
    }
}
