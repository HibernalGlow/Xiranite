//! The handle-based byte stream behind `xiranite.fs.open` / `.read` / `.close` (ADR-0070).
//!
//! [`crate::filesystem`] answers the bounded *document* pair; this module is what a plugin uses when
//! the file is not a document — a ZIP central directory sitting at the tail of a multi-gigabyte
//! archive, a container header, a hash input too big to name. The rule the two modules share is
//! ADR-0068's: bulk bytes are read by the host and cross one caller-sized chunk at a time, so no
//! single call can ask for "the rest of the file".
//!
//! ## Why a handle rather than `(path, offset)` per read
//!
//! A handle is the authorization decision made once. [`FileReadStream::open`] resolves the path
//! through the same grant as every other `xiranite.fs.*` call and then keeps *that* file open, so a
//! chunk read cannot smuggle in a path the operation was never granted, and cannot race the path out
//! from under a grant between two reads of one file.
//!
//! ## Lifetime
//!
//! `crates/xiranite-node-runtime` builds one [`FileReadStream`] per operation, so a plugin that forgets
//! `xiranite.fs.close` leaks an open descriptor for that run only and the drop reclaims it — the
//! failure is visible in that operation, not in the whole host process.
//!
//! ## Cross-platform rule
//!
//! Same as `filesystem.rs`: no `#[cfg]` branches. Positioned reads go through `Seek` + `Read` on the
//! held [`std::fs::File`] under the table lock rather than the `read_at` extensions that are each
//! unix-only and windows-only, because a plugin cannot observe the difference — it only ever sees bytes.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::sync::Mutex;

use xiranite_plugin_api::{FileAccessMode, FileHandleToken};

use crate::filesystem::{FileCapability, FsCapabilityError};

/// The largest chunk one `xiranite.fs.read` will answer.
///
/// The caller picks the size (ADR-0068: caller-sized buffers), and this is the ceiling it picks under.
/// 1 MiB is deliberately below the smallest plugin instance in this repository — `plugins/transq` runs
/// with `memoryMaxPages: 64`, i.e. 4 MiB of linear memory — so one chunk plus its JSON envelope cannot
/// by itself crowd out the plugin's own working set.
pub const MAX_CHUNK_BYTES: u32 = 1024 * 1024;

/// One file this operation opened, with the size the host saw at open time.
struct OpenFile {
    /// Held open so the handle cannot be re-pointed at another path.
    file: std::fs::File,
    /// Size at open. Reads past it answer empty, which is how the plugin sees end of stream.
    size_bytes: u64,
    /// The path as the caller named it, for host-side error text. Never a canonical path: the plugin
    /// was granted the spelling it sent, and `/private/var/…` would not be its prefix.
    display_path: String,
}

/// The host table behind `xiranite.fs.open`/`.read`/`.close` for one operation's grant.
#[derive(Default)]
struct HandleTable {
    /// Monotonic ids. A handle is only ever looked up, never parsed, so the counter only has to avoid
    /// colliding with a live entry.
    next: u64,
    files: HashMap<u64, OpenFile>,
}

/// The handle-based file stream service: the `xiranite.fs.*` calls that move bytes rather than
/// documents.
pub struct FileReadStream {
    /// The grant, shared with the document service so one authorization list governs both.
    files: FileCapability,
    open: Mutex<HandleTable>,
}

impl FileReadStream {
    /// Builds the stream service over the same grant as the caller's [`FileCapability`].
    #[must_use]
    pub fn new(files: FileCapability) -> Self {
        Self { files, open: Mutex::new(HandleTable::default()) }
    }

    /// A service that grants nothing: every open is a `PermissionDenied`.
    #[must_use]
    pub fn denied() -> Self {
        Self::new(FileCapability::denied())
    }

    /// `xiranite.fs.open` — authorize the path once and return the handle plus the size a plugin needs
    /// to plan its chunks with.
    pub fn open(
        &self,
        raw: &str,
        mode: FileAccessMode,
    ) -> Result<(FileHandleToken, u64), FsCapabilityError> {
        let FileAccessMode::Read = mode else {
            // ADR-0068 puts a streamed write behind the host's file-operation journal so the run stays
            // undoable. There is no journal in this core yet, so the honest answer is a refusal with
            // the code the plugin can report, not a silently unjournalable file handle.
            return Err(FsCapabilityError::Refused {
                code: "not_implemented",
                message: "streamed writes go through the file-operation journal, which this host \
                          does not have yet; xiranite.fs.write_text writes a bounded document"
                    .to_string(),
            });
        };
        let path = self.files.resolve(raw)?;
        let metadata = std::fs::metadata(&path)
            .map_err(|error| FsCapabilityError::host("open_failed", error))?;
        if metadata.is_dir() {
            return Err(FsCapabilityError::Refused {
                code: "is_directory",
                message: format!("{raw} is a directory; a handle streams one file's bytes"),
            });
        }
        let file =
            std::fs::File::open(&path).map_err(|error| FsCapabilityError::host("open_failed", error))?;
        let size_bytes = metadata.len();
        let mut table = self.open.lock().expect("file handle table");
        // `next` is a `u64` counter that starts at 1, so the reserved `0` token value is never minted.
        let id = loop {
            table.next += 1;
            if !table.files.contains_key(&table.next) {
                break table.next;
            }
        };
        table.files.insert(
            id,
            OpenFile { file, size_bytes, display_path: raw.to_string() },
        );
        let handle = FileHandleToken::try_from_u64(id)
            .ok_or_else(|| FsCapabilityError::host("open_failed", "handle ids exhausted"))?;
        Ok((handle, size_bytes))
    }

    /// `xiranite.fs.read` — up to `max_bytes` starting at `offset`.
    ///
    /// An empty answer means "nothing left at that offset", which includes an offset past the end, so a
    /// read loop terminates on it without the plugin having to track a length it cannot trust.
    pub fn read_chunk(
        &self,
        handle: FileHandleToken,
        offset: u64,
        max_bytes: u32,
    ) -> Result<Vec<u8>, FsCapabilityError> {
        if max_bytes == 0 {
            return Err(FsCapabilityError::Refused {
                code: "empty_chunk",
                message: "a zero-length read is a plugin bug; end of stream is an empty answer, \
                          not a request for nothing"
                    .to_string(),
            });
        }
        if max_bytes > MAX_CHUNK_BYTES {
            return Err(FsCapabilityError::Refused {
                code: "chunk_too_large",
                message: format!(
                    "{max_bytes} bytes exceeds the {MAX_CHUNK_BYTES} byte chunk ceiling"
                ),
            });
        }
        let mut table = self.open.lock().expect("file handle table");
        let entry = table
            .files
            .get_mut(&handle.get())
            .ok_or(FsCapabilityError::NotFound)?;
        if offset >= entry.size_bytes {
            return Ok(Vec::new());
        }
        let wanted = usize::try_from(min_chunk(max_bytes, entry.size_bytes - offset))
            .unwrap_or(MAX_CHUNK_BYTES as usize);
        let mut buffer = vec![0u8; wanted];
        entry
            .file
            .seek(SeekFrom::Start(offset))
            .map_err(|error| FsCapabilityError::host("read_failed", error))?;
        let mut filled = 0usize;
        while filled < wanted {
            let read = entry
                .file
                .read(&mut buffer[filled..])
                .map_err(|error| FsCapabilityError::host("read_failed", error))?;
            if read == 0 {
                break;
            }
            filled += read;
        }
        buffer.truncate(filled);
        Ok(buffer)
    }

    /// `xiranite.fs.close` — drop the descriptor. Closing twice is `NotFound`, which is the plugin's
    /// cue that it lost track of a handle.
    pub fn close(&self, handle: FileHandleToken) -> Result<(), FsCapabilityError> {
        let mut table = self.open.lock().expect("file handle table");
        table
            .files
            .remove(&handle.get())
            .map(|_| ())
            .ok_or(FsCapabilityError::NotFound)
    }

    /// The path one live handle was opened for, for the host's own audit line.
    pub fn opened_path(&self, handle: FileHandleToken) -> Option<String> {
        let table = self.open.lock().expect("file handle table");
        table.files.get(&handle.get()).map(OpenFile::display_path)
    }
}

impl OpenFile {
    fn display_path(&self) -> String {
        self.display_path.clone()
    }
}

/// The smaller of two byte counts, as `u64` so the caller does not widen back and forth.
fn min_chunk(max_bytes: u32, remaining: u64) -> u64 {
    u64::from(max_bytes).min(remaining)
}
