//! A delete-time journal for the system trash, which is what makes restore possible on macOS.
//!
//! ## Why the journal exists instead of reading the OS
//!
//! Windows and freedesktop Linux keep a per-item record of where an item came from, so
//! [`crate::trash_service`] can enumerate the whole bin and put anything back. macOS does not expose that
//! mapping to us: measured on macOS 27 (arm64), no entry under `~/.Trash` carries
//! `com.apple.metadata:kMDItemTrashOrigLocation` — not the items removed through Finder, and not the ones
//! removed through `NSFileManager` — and `mdls -name kMDItemTrashOrigLocation` answers `(null)`. Driving
//! Finder with `osascript` does work from a bare process and yields names, but never a previous location.
//!
//! So the only machine that can answer "where did this come from" is the one that moved it. This journal
//! records each path at delete time, which makes the inventory *honest and partial*: it lists what
//! Xiranite itself trashed, and never claims to be the user's whole Trash. Callers disclose it that way.
//!
//! ## Two rules this file refuses to break
//!
//! - **Record before removing.** [`TrashJournal::record`] runs while the item is still in place, so a
//!   journal that cannot be written stops the operation before anything is destroyed. An entry whose
//!   removal then fails is rewritten away, never left to rot as a phantom restore target.
//! - **A malformed line is an error, not an empty bin.** Skipping unreadable lines would answer "nothing
//!   was ever trashed" about a file that clearly says otherwise.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// File name under the app data root.
pub const JOURNAL_FILE_NAME: &str = "trash-journal.jsonl";

/// Where an item a journal entry describes ended up.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EntryState {
    /// Still sitting in the trash.
    Trashed,
    /// Moved back to its original path by [`crate::trash_service::restore`].
    Restored,
    /// Deleted for good, from inside the trash.
    Purged,
}

/// One recorded move, as written to the journal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JournalEntry {
    /// Where the item lived before it was trashed. Absolute, as given by the caller.
    pub original_path: PathBuf,
    /// The name it has inside the trash, which is not always the same (`file.txt` can become
    /// `file 14.22.05.txt`). Resolved by diffing the trash directory around the removal.
    pub trash_name: String,
    /// Seconds since the Unix epoch, taken when the entry was written.
    pub deleted_unix_secs: u64,
    pub state: EntryState,
}

/// The append-only-by-convention JSONL journal at `<root>/trash-journal.jsonl`.
#[derive(Debug, Clone)]
pub struct TrashJournal {
    path: PathBuf,
}

impl TrashJournal {
    /// The journal belonging to an app data root.
    #[must_use]
    pub fn at(root: &Path) -> Self {
        Self { path: root.join(JOURNAL_FILE_NAME) }
    }

    /// Where entries live, exposed so a face can tell an operator which file it just deleted.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Prove the journal can be written **before** anything is destroyed.
    ///
    /// A delete that cannot be recorded is a delete that cannot be listed, restored, or rolled back, so
    /// the caller asks this while every subject is still in place. Opening in append mode is the same
    /// operation [`Self::record`] will perform later; creating the file here is deliberate, because a
    /// first-ever run has to establish that the directory is writable too.
    pub fn ensure_writable(&self) -> io::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        OpenOptions::new().create(true).append(true).open(&self.path)?;
        Ok(())
    }

    /// Record a move that is about to happen. Returns the entry so the caller keeps one truth.
    pub fn record(&self, original_path: &Path, trash_name: &str) -> io::Result<JournalEntry> {
        let entry = JournalEntry {
            original_path: original_path.to_path_buf(),
            trash_name: trash_name.to_string(),
            deleted_unix_secs: now_unix_secs(),
            state: EntryState::Trashed,
        };
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = OpenOptions::new().create(true).append(true).open(&self.path)?;
        writeln!(file, "{}", serde_json::to_string(&entry).map_err(io::Error::other)?)?;
        Ok(entry)
    }

    /// Every entry, in the order written. An absent journal is an empty list; a line that cannot be read
    /// back is an error, because the alternative is reporting "nothing was ever trashed".
    pub fn entries(&self) -> io::Result<Vec<JournalEntry>> {
        let text = match fs::read_to_string(&self.path) {
            Ok(text) => text,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error),
        };
        let mut entries = Vec::new();
        for (index, line) in text.lines().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            let entry: JournalEntry = serde_json::from_str(line).map_err(|error| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("trash journal line {} is unreadable: {error}", index + 1),
                )
            })?;
            entries.push(entry);
        }
        Ok(entries)
    }

    /// Entries that are still waiting to be restored or purged.
    pub fn trashed(&self) -> io::Result<Vec<JournalEntry>> {
        Ok(self.entries()?.into_iter().filter(|entry| entry.state == EntryState::Trashed).collect())
    }

    /// Move one entry to a new state, rewriting the file atomically so a crash cannot halve the journal.
    pub fn set_state(&self, trash_name: &str, state: EntryState) -> io::Result<usize> {
        let mut entries = self.entries()?;
        let mut changed = 0;
        for entry in &mut entries {
            if entry.trash_name == trash_name {
                entry.state = state;
                changed += 1;
            }
        }
        if changed == 0 {
            return Ok(0);
        }
        let mut text = String::new();
        for entry in &entries {
            text.push_str(&serde_json::to_string(entry).map_err(io::Error::other)?);
            text.push('\n');
        }
        let temporary = self.path.with_extension("jsonl.tmp");
        fs::write(&temporary, text)?;
        fs::rename(&temporary, &self.path)?;
        Ok(changed)
    }
}

fn now_unix_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_secs()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn journal_in(root: &Path) -> TrashJournal {
        TrashJournal::at(root)
    }

    #[test]
    fn writability_is_provable_before_anything_is_recorded() {
        let temp = tempfile::tempdir().unwrap();
        let journal = journal_in(temp.path());
        assert!(!journal.path().exists(), "the pre-flight must not write an entry");
        journal.ensure_writable().unwrap();
        assert!(journal.path().is_file(), "the pre-flight creates the file it will append to");
        assert_eq!(journal.entries().unwrap().len(), 0);

        let mut blocker = tempfile::NamedTempFile::new().expect("a regular file to use as a parent");
        // A root that cannot hold the file has to fail here, not after the item is already in the trash.
        // The fixture is a regular file used as a parent directory, because that is the one shape that is
        // unwritable on all three targets: a POSIX path like `/dev/…` is merely *writable* on Windows
        // (measured — it resolves under the current drive and the journal got created), and a mode-bit
        // `chmod` is advisory there.
        blocker.write_all(b"not a directory").expect("the blocker is writable");
        let unwritable = TrashJournal::at(blocker.path());
        assert!(unwritable.ensure_writable().is_err(), "a journal that cannot be opened must say so");
    }

    #[test]
    fn a_missing_journal_is_empty_not_an_error() {
        let root = std::env::temp_dir().join("xiranite-journal-missing");
        let _ = fs::remove_dir_all(&root);
        assert_eq!(journal_in(&root).entries().unwrap(), Vec::new());
        assert_eq!(journal_in(&root).trashed().unwrap().len(), 0);
    }

    #[test]
    fn records_then_reads_back_with_the_state_and_clock() {
        let temp = tempfile::tempdir().unwrap();
        let journal = journal_in(temp.path());
        let written = journal.record(Path::new("/tmp/subject/a.txt"), "a.txt").unwrap();
        assert_eq!(written.state, EntryState::Trashed);
        assert!(written.deleted_unix_secs > 1_700_000_000, "clock came from the system: {:?}", written.deleted_unix_secs);

        let read = journal.entries().unwrap();
        assert_eq!(read, vec![written]);
        assert!(journal.path().is_file());
    }

    #[test]
    fn setting_a_state_rewrites_every_line_and_keeps_the_others() {
        let temp = tempfile::tempdir().unwrap();
        let journal = journal_in(temp.path());
        journal.record(Path::new("/tmp/one.txt"), "one.txt").unwrap();
        journal.record(Path::new("/tmp/two.txt"), "two.txt").unwrap();

        assert_eq!(journal.set_state("one.txt", EntryState::Restored).unwrap(), 1);
        let entries = journal.entries().unwrap();
        assert_eq!(entries[0].state, EntryState::Restored);
        assert_eq!(entries[1].state, EntryState::Trashed, "the untouched entry must stay put");
        assert_eq!(journal.trashed().unwrap().len(), 1);
        assert!(!journal.path().with_extension("jsonl.tmp").exists(), "the rewrite must not leave debris");
    }

    #[test]
    fn an_unknown_trash_name_changes_nothing() {
        let temp = tempfile::tempdir().unwrap();
        let journal = journal_in(temp.path());
        journal.record(Path::new("/tmp/one.txt"), "one.txt").unwrap();
        assert_eq!(journal.set_state("never-recorded.txt", EntryState::Purged).unwrap(), 0);
        assert_eq!(journal.entries().unwrap()[0].state, EntryState::Trashed);
    }

    #[test]
    fn a_torn_line_fails_loudly_instead_of_reading_as_an_empty_bin() {
        let temp = tempfile::tempdir().unwrap();
        let journal = journal_in(temp.path());
        journal.record(Path::new("/tmp/one.txt"), "one.txt").unwrap();
        fs::OpenOptions::new().append(true).open(journal.path()).unwrap().write_all(b"{not json\n").unwrap();

        let error = journal.entries().unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        assert!(error.to_string().contains("line 2"), "the operator needs the line number: {error}");
    }
}
