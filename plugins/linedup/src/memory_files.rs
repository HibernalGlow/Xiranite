//! A deterministic in-memory [`crate::file_access::LinedupFileSystem`] for tests and for faces that
//! want to preview a run without touching disk.
//!
//! It is a public module, not `#[cfg(test)]`, for the reason ADR-0069 gives: the CLI and the TUI read
//! the same business implementation, and both need to run the file flows against a buffer while the
//! user is still choosing an output path. It is never compiled into a code path that ignores the
//! grant: [`crate::extism_host`] hands the isolate [`crate::file_access::NativeFiles`] and nothing
//! else.

use std::collections::BTreeMap;
use std::sync::{Mutex, PoisonError};

use crate::file_access::{FileAccessFailure, LinedupFileSystem};

/// An in-memory file table with scripted failures.
#[derive(Default)]
pub struct MemoryFiles {
    files: Mutex<BTreeMap<String, String>>,
    read_failures: Mutex<BTreeMap<String, String>>,
    write_failures: Mutex<BTreeMap<String, String>>,
}

impl MemoryFiles {
    /// An empty table.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// A table with `path` pre-populated, chained.
    #[must_use]
    pub fn with_file(self, path: &str, content: &str) -> Self {
        self.files.lock().unwrap_or_else(PoisonError::into_inner).insert(path.to_owned(), content.to_owned());
        self
    }

    /// A table where reading `path` fails with `reason`, chained.
    #[must_use]
    pub fn with_read_failure(self, path: &str, reason: &str) -> Self {
        self.read_failures.lock().unwrap_or_else(PoisonError::into_inner).insert(path.to_owned(), reason.to_owned());
        self
    }

    /// A table where writing `path` fails with `reason`, chained.
    #[must_use]
    pub fn with_write_failure(self, path: &str, reason: &str) -> Self {
        self.write_failures.lock().unwrap_or_else(PoisonError::into_inner).insert(path.to_owned(), reason.to_owned());
        self
    }

    /// What a run wrote, for the assertions that must not read the repository's disk.
    #[must_use]
    pub fn contents_of(&self, path: &str) -> Option<String> {
        self.files.lock().unwrap_or_else(PoisonError::into_inner).get(path).cloned()
    }

    /// Every path currently held, in key order.
    #[must_use]
    pub fn paths(&self) -> Vec<String> {
        self.files.lock().unwrap_or_else(PoisonError::into_inner).keys().cloned().collect()
    }
}

impl LinedupFileSystem for MemoryFiles {
    fn read_text(&self, path: &str) -> Result<String, FileAccessFailure> {
        if let Some(reason) = self.read_failures.lock().unwrap_or_else(PoisonError::into_inner).get(path) {
            return Err(FileAccessFailure::Read { path: path.to_owned(), reason: reason.clone() });
        }
        self.files
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(path)
            .cloned()
            .ok_or_else(|| FileAccessFailure::Read {
                path: path.to_owned(),
                reason: "entity not found".to_owned(),
            })
    }

    fn write_text(&self, path: &str, content: &str) -> Result<(), FileAccessFailure> {
        if let Some(reason) = self.write_failures.lock().unwrap_or_else(PoisonError::into_inner).get(path) {
            return Err(FileAccessFailure::Write { path: path.to_owned(), reason: reason.clone() });
        }
        self.files.lock().unwrap_or_else(PoisonError::into_inner).insert(path.to_owned(), content.to_owned());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_path_reads_as_not_found_and_never_creates_it() {
        let files = MemoryFiles::new().with_file("/data/source.txt", "alpha\n");
        assert_eq!(
            files.read_text("/data/filter.txt"),
            Err(FileAccessFailure::Read {
                path: "/data/filter.txt".to_owned(),
                reason: "entity not found".to_owned()
            })
        );
        assert_eq!(files.paths(), vec!["/data/source.txt".to_owned()]);
    }

    #[test]
    fn scripted_failures_behave_like_a_denied_preopen() {
        let files = MemoryFiles::new()
            .with_read_failure("/ro/in.txt", "operation not supported")
            .with_write_failure("/ro/out.txt", "read-only file system");
        assert_eq!(files.read_text("/ro/in.txt").expect_err("read").code(), "file.read");
        assert_eq!(files.write_text("/ro/out.txt", "x").expect_err("write").code(), "file.write");
        assert_eq!(files.write_text("/data/out.txt", "x"), Ok(()), "an unscripted path still writes");
    }
}
