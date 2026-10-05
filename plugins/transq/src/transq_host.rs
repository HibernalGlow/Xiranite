//! The machine-facing seam of TransQ: the file operations the organizer needs, plus the two
//! operation control-plane calls.
//!
//! ADR-0071 retired the `xiranite.fs.*` host functions. The file methods below are now `std::fs`
//! calls against the WASI preopens the host grants from the manifest's `allowed_paths`
//! (`crate::transq_std_fs::StdFilesystem`), and `emit`/`checkpoint` stay host calls because they
//! carry product semantics — the operation's event stream and ADR-0066's cooperative yield — that no
//! WASI proposal covers.
//!
//! The trait stays anyway, for two reasons the ports kept hitting. First, the recorder in
//! `src/transq_test_host.rs` stands where `core.test.ts`'s literal fake runtime stood and asserts the
//! exact `copy … -> … -> move … -> remove …` order, which a `std::fs` call against a tempdir cannot
//! reproduce as a script. Second, the failure shape a filesystem refusal produces is domain data
//! (`TransqQueueItem.errors`), and naming the seam is what keeps that mapping honest.
//!
//! Two primitives that used to be "beyond ADR-0068's list" are simply what `std::fs` gives for free
//! now, which is the point ADR-0071 §2 measured:
//!
//! - one call returns a directory's own kind plus its entries (`symlink_metadata` + `read_dir`, which
//!   is what `lstat` + `readdir(withFileTypes)` + `access` were doing together in `platform.ts`);
//! - a copy between two authorized paths streams inside the sandbox, so image bytes never enter a
//!   JSON envelope at all.

use std::fmt;

use crate::transq_contract::TransqRunEvent;

/// `path.posix.win32` entry types TransQ distinguishes, from a single listing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DirectoryEntryKind {
    Directory,
    File,
    SymbolicLink,
    /// Anything the host could classify but TransQ ignores (sockets, fifos).
    Other,
}

impl DirectoryEntryKind {
    /// `Dirent.isDirectory()` (`platform.ts:49`, `platform.ts:112` filters the
    /// other way): a symlink is never followed here, matching `lstat`.
    pub fn is_directory(self) -> bool {
        matches!(self, DirectoryEntryKind::Directory)
    }

    /// `Dirent.isFile()` (`platform.ts:72`, `platform.ts:112`).
    pub fn is_file(self) -> bool {
        matches!(self, DirectoryEntryKind::File)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            DirectoryEntryKind::Directory => "directory",
            DirectoryEntryKind::File => "file",
            DirectoryEntryKind::SymbolicLink => "symlink",
            DirectoryEntryKind::Other => "other",
        }
    }

    pub fn parse(value: &str) -> DirectoryEntryKind {
        match value {
            "directory" => DirectoryEntryKind::Directory,
            "file" => DirectoryEntryKind::File,
            "symlink" => DirectoryEntryKind::SymbolicLink,
            _ => DirectoryEntryKind::Other,
        }
    }
}

/// Kind of one path, as reported for the listed directory itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathKind {
    Directory,
    File,
    SymbolicLink,
    /// Missing, or present but unreadable at the level the host stats. A broken
    /// symlink must also come back `Missing` so `access`-style checks agree with
    /// `platform.ts:128-135`.
    Missing,
}

impl PathKind {
    pub fn as_str(self) -> &'static str {
        match self {
            PathKind::Directory => "directory",
            PathKind::File => "file",
            PathKind::SymbolicLink => "symlink",
            PathKind::Missing => "missing",
        }
    }

    pub fn parse(value: &str) -> PathKind {
        match value {
            "directory" => PathKind::Directory,
            "file" => PathKind::File,
            "symlink" => PathKind::SymbolicLink,
            _ => PathKind::Missing,
        }
    }

    /// `exists()` via `fs.access` (`platform.ts:128-135`).
    pub fn exists(self) -> bool {
        self != PathKind::Missing
    }

    /// `existsDirectory()` via `fs.lstat(...).isDirectory()` (`platform.ts:137-143`).
    pub fn is_directory(self) -> bool {
        self == PathKind::Directory
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectoryEntry {
    pub name: String,
    pub kind: DirectoryEntryKind,
}

/// One `readdir(path, { withFileTypes: true })` plus the stat of `path` itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectoryListing {
    pub path: String,
    pub kind: PathKind,
    pub entries: Vec<DirectoryEntry>,
}

impl DirectoryListing {
    pub fn missing(path: &str) -> DirectoryListing {
        DirectoryListing { path: path.to_string(), kind: PathKind::Missing, entries: Vec::new() }
    }

    pub fn entry(&self, name: &str) -> Option<&DirectoryEntry> {
        self.entries.iter().find(|entry| entry.name == name)
    }

    /// Sorted `Dirent.isFile()` names, i.e. `listFiles` (`platform.ts:109-116`).
    pub fn sorted_file_names(&self) -> Vec<String> {
        let mut names: Vec<String> = self
            .entries
            .iter()
            .filter(|entry| entry.kind.is_file())
            .map(|entry| entry.name.clone())
            .collect();
        names.sort();
        names
    }
}

/// A filesystem failure, reported with the OS text rather than a bare code.
///
/// Its `Display` text is what lands in `TransqQueueItem.errors`, exactly where the
/// TypeScript node put `error.message` (`core.ts:178-181`), so the reason stays
/// human-readable. Since ADR-0071 this comes from `std::io::Error` in the guest, not
/// from a host reply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostCallError {
    pub message: String,
}

impl HostCallError {
    pub fn new(message: impl Into<String>) -> HostCallError {
        HostCallError { message: message.into() }
    }
}

impl fmt::Display for HostCallError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for HostCallError {}

/// ADR-0066: the checkpoint host function reports whether the plugin may continue.
/// Any value the plugin does not recognize is treated as `Cancelled` — stopping is
/// the fail-safe side of a destructive organizer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckpointDecision {
    Continue,
    Cancelled,
}

/// The machine-facing half of TransQ.
///
/// Methods are synchronous: the TypeScript `async` here only ever awaited one filesystem call or one
/// host call, and the cooperative pause point is `checkpoint`, not the scheduler.
pub trait TransqHost {
    /// `readdir` + `lstat`/`access` in one pass. `include_entries == false`
    /// is the existence-only case (`platform.ts:80`, `platform.ts:64`).
    fn list_directory(&mut self, path: &str, include_entries: bool) -> Result<DirectoryListing, HostCallError>;

    /// Reads a small UTF-8 file: `translation_map.json` (`platform.ts:118-126`).
    /// Media bytes never cross the boundary; the host streams those itself.
    fn read_text_file(&mut self, path: &str) -> Result<String, HostCallError>;

    /// `mkdir(parent, {recursive:true})` + `copyFile` (`platform.ts:88-91`).
    fn copy_file(&mut self, source_path: &str, destination_path: &str) -> Result<(), HostCallError>;

    /// `rename` with the `EXDEV` copy-and-remove fallback (`platform.ts:93-103`).
    fn move_directory(&mut self, source_path: &str, destination_path: &str) -> Result<(), HostCallError>;

    /// `rm(path, {recursive:true, force:true})` (`platform.ts:105-107`).
    fn remove_path(&mut self, path: &str) -> Result<(), HostCallError>;

    /// `xiranite.operation.emit`: the `onEvent` sink of `runTransq` (`core.ts:116`).
    fn emit_event(&mut self, event: &TransqRunEvent);

    /// `xiranite.operation.checkpoint`: one yield per processed queue item (ADR-0066).
    fn checkpoint(&mut self) -> CheckpointDecision;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sorted_file_names_follow_the_readdir_rule() {
        let listing = DirectoryListing {
            path: "D:/c/original_images".to_string(),
            kind: PathKind::Directory,
            entries: vec![
                DirectoryEntry { name: "manga_translator_work".to_string(), kind: DirectoryEntryKind::Directory },
                DirectoryEntry { name: "002.png".to_string(), kind: DirectoryEntryKind::File },
                DirectoryEntry { name: "010.png".to_string(), kind: DirectoryEntryKind::File },
                DirectoryEntry { name: "001.png".to_string(), kind: DirectoryEntryKind::File },
                DirectoryEntry { name: "link.png".to_string(), kind: DirectoryEntryKind::SymbolicLink },
            ],
        };

        assert_eq!(listing.sorted_file_names(), vec!["001.png".to_string(), "002.png".to_string(), "010.png".to_string()]);
        assert!(listing.entry("manga_translator_work").is_some_and(|entry| entry.kind.is_directory()));
    }

    #[test]
    fn kind_helpers_match_lstat_and_access() {
        assert!(PathKind::Directory.is_directory() && PathKind::Directory.exists());
        assert!(!PathKind::SymbolicLink.is_directory(), "lstat must not follow a link");
        assert!(PathKind::SymbolicLink.exists(), "access sees a live link");
        assert!(!PathKind::Missing.exists());
    }

    #[test]
    fn wire_names_round_trip() {
        for kind in [DirectoryEntryKind::Directory, DirectoryEntryKind::File, DirectoryEntryKind::SymbolicLink, DirectoryEntryKind::Other] {
            assert_eq!(DirectoryEntryKind::parse(kind.as_str()), kind);
        }
        for kind in [PathKind::Directory, PathKind::File, PathKind::SymbolicLink, PathKind::Missing] {
            assert_eq!(PathKind::parse(kind.as_str()), kind);
        }
    }
}
