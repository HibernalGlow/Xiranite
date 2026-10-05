//! File access as `std::fs` against the host's WASI preopens — ADR-0071.
//!
//! There is no `xiranite.fs.*` host function in this crate and there must not be one: ADR-0071
//! retired the whole family because the engine serves the same shape better. The host builds the
//! Extism plugin with `with_wasi(true)` and grants the operation's authorized roots as preopens
//! (`docs/adr/0071-…:126-135`), so the guest opens a file with the plain `std` call and containment
//! — including the `ro:` read-only half — is enforced by WASI's own errno mapping, which ADR-0071 §2
//! measured on this machine (`EACCES`/`ERR_NO_PERM` 63 on traversal, 58 on writing a `ro:` root).
//!
//! ## The one thing this module must not do
//!
//! Analyse host-shaped paths. ADR-0071 §5 measured that a `wasm32-wasip1` guest inherits POSIX path
//! semantics even when the host is Windows: `std::path::is_separator('\\')` is `false`, and
//! `"C:\\windows\\system32"` parses as **one** component. So paths cross as the exact text the caller
//! supplied and go straight into `std::fs`; no separator rewriting, no drive-letter or case-insensitive
//! comparison, no `Path::is_absolute()` branch. Host path truth belongs to `xiranite-core`
//! (`normalize_separators`, `is_case_insensitive_root`), and this file would be the place a bug hides
//! if it tried to reproduce it here.
//!
//! ## Why a trait at all, when the guest calls `std::fs` directly
//!
//! One seam, two implementors: [`NativeFiles`] is what `linedup.wasm` runs (and what a CLI/TUI face
//! embedding the core runs), and [`crate::memory_files::MemoryFiles`] is the deterministic double the
//! parity tests use. The alternative — tests writing into the repository's real directories — is what
//! `AGENTS.md` forbids for diagnostic scripts, and it would make `cargo test` order-dependent.

use std::fmt;

/// Why a file effect failed, carrying the caller's path so the message reads like the one
/// `cli.ts:410-411` prints (`读取源文件失败: {path}\n{message}`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileAccessFailure {
    /// The read did not produce text.
    Read {
        /// The path as the caller wrote it.
        path: String,
        /// The OS or decode reason.
        reason: String,
    },
    /// The write did not land.
    Write {
        /// The path as the caller wrote it.
        path: String,
        /// The OS reason.
        reason: String,
    },
}

impl FileAccessFailure {
    /// Stable machine code, the `PluginError.code` half of ADR-0068's error shape.
    #[must_use]
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Read { .. } => "file.read",
            Self::Write { .. } => "file.write",
        }
    }

    /// The path this failure happened at.
    #[must_use]
    pub fn path(&self) -> &str {
        match self {
            Self::Read { path, .. } | Self::Write { path, .. } => path,
        }
    }
}

impl fmt::Display for FileAccessFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Read { path, reason } => write!(formatter, "could not read {path}: {reason}"),
            Self::Write { path, reason } => write!(formatter, "could not write {path}: {reason}"),
        }
    }
}

impl std::error::Error for FileAccessFailure {}

/// The file effects linedup performs. Two, in and out, both text.
pub trait LinedupFileSystem {
    /// Reads a whole UTF-8 file, the way `cli.ts:408`/`cli.ts:455` read `source.txt` and `filter.txt`.
    ///
    /// A non-UTF-8 file is a failure rather than a lossy read: this node compares text, and
    /// `String::from_utf8_lossy` would silently turn a mis-decoded token into a different token
    /// that matches nothing. Node files are pasted lists and `.txt` exports; a caller with real
    /// encoding mixing should decode before the call.
    fn read_text(&self, path: &str) -> Result<String, FileAccessFailure>;

    /// Writes text, creating or truncating, the way `cli.ts:341`/`cli.ts:441` write `output.txt`.
    fn write_text(&self, path: &str, content: &str) -> Result<(), FileAccessFailure>;
}

/// The implementor the wasm guest uses: `std::fs`, resolved by WASI against the preopens the host
/// granted for this operation.
#[derive(Debug, Clone, Copy, Default)]
pub struct NativeFiles;

impl LinedupFileSystem for NativeFiles {
    fn read_text(&self, path: &str) -> Result<String, FileAccessFailure> {
        std::fs::read_to_string(path).map_err(|error| FileAccessFailure::Read {
            path: path.to_owned(),
            reason: error.to_string(),
        })
    }

    fn write_text(&self, path: &str, content: &str) -> Result<(), FileAccessFailure> {
        std::fs::write(path, content).map_err(|error| FileAccessFailure::Write {
            path: path.to_owned(),
            reason: error.to_string(),
        })
    }
}

/// The implementor for a run that must prove it never touches the disk: the operation surface
/// (`definition.json` has no path field) reaches this whenever a file slot is absent, and it reports a
/// refusal instead of opening something.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoFiles;

impl LinedupFileSystem for NoFiles {
    fn read_text(&self, path: &str) -> Result<String, FileAccessFailure> {
        Err(FileAccessFailure::Read {
            path: path.to_owned(),
            reason: "no filesystem: the operation surface passes text in the request".to_owned(),
        })
    }

    fn write_text(&self, path: &str, _content: &str) -> Result<(), FileAccessFailure> {
        Err(FileAccessFailure::Write {
            path: path.to_owned(),
            reason: "no filesystem: the operation surface publishes no output path".to_owned(),
        })
    }
}
