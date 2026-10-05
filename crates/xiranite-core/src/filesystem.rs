//! The `xiranite.fs.*` host capability service (ADR-0066, ADR-0068).
//!
//! ADR-0066 gives a plugin exactly one way to touch a machine: ask the host. This module is that
//! host side — it owns path authorization, the directory/move/delete primitives the file nodes need,
//! the bounded text read/write used by undo histories, and the widened surface the first real node
//! bundles proved necessary (`mkdtemp`, `copy`, `append`, `utimes`, positioned byte reads and writes,
//! the link family, `realpath`). `crates/xiranite-node-runtime` turns these methods into
//! `xiranite.fs.*` host functions and `crates/xiranite-quickjs-executor` into `fs.*` host operations;
//! nothing in a plugin or a bundle reaches the filesystem itself.
//!
//! ## Authorization is a grant list, not a heuristic
//!
//! [`FileCapability::new`] takes the roots an operation was granted. Every path a capability call
//! names must resolve inside one of them, and "resolve" means the nearest *existing* ancestor is
//! canonicalized (the leaf often does not exist yet, because `ensure_dir`/`write_text` are called on
//! new paths). A `..` that walks out of the grant is caught by that ancestor check rather than by
//! string matching.
//!
//! The byte/append/utimes/copy family goes one step further through [`FileCapability::resolve_open`] —
//! a final component is followed once more, so a link inside the grant whose target sits outside it is
//! refused rather than read through. The older document arms (`read_text`/`write_text`/`ensure_dir`/
//! `delete`/`move_path`) do not, which is a known asymmetry rather than a pattern to copy: those five
//! are the arms `xiranite-node-runtime`'s capability tests and `crates/nodes/dissolvef`'s parity suite
//! pin, so closing it needs a task that runs those gates.
//!
//! ## Cross-platform rule
//!
//! Windows is the release gate and macOS/Android-free hosts must keep building, so this module has no
//! `#[cfg]` branches for path handling: separators, drive letters and UNC prefixes are treated as *path
//! shapes* (see [`normalize_separators`] and [`is_case_insensitive_root`]) which are unit-testable on any
//! OS. Real filesystem access stays on `std::fs`, whose behaviour is already per-OS. The single exception
//! is [`make_symlink`], because `std::fs` has no portable `symlink` at all; it is one function, not a
//! pattern to extend.

use std::path::{Path, PathBuf};

use crate::support::TimestampMs;

/// The largest document `read_text` will hand back. Undo histories are text; a plugin that names a
/// 2 GiB file gets a refusal rather than a two-gigabyte block copied into wasm linear memory
/// (ADR-0068: bulk bytes never cross the plugin boundary).
pub const MAX_TEXT_BYTES: u64 = 4 * 1024 * 1024;

/// The largest buffer one [`FileCapability::read_bytes`] / [`FileCapability::write_bytes`] call moves.
///
/// The text ceiling above is for documents; this one is 8 MiB because a byte read is how a node reaches a
/// container header, an archive tail or an image, and those are routinely a few megabytes. It is host-side
/// backpressure, not permission to hold 8 MiB — the caller's own ceiling is the executor's live-byte budget.
/// A refusal here therefore says "read it in ranges", which `read_bytes`' `offset`/`length` do answer.
pub const MAX_BINARY_BYTES: u64 = 8 * 1024 * 1024;

/// How many times [`FileCapability::mkdtemp`] redraws a suffix before it gives up. Six base-36
/// characters is two billion names, so a collision means a racing sibling, not bad luck.
const MKDTEMP_ATTEMPTS: u32 = 32;

/// Why a capability call was refused, with the stable code the plugin's error envelope carries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FsCapabilityError {
    /// No path was given.
    EmptyPath,
    /// The path resolves outside every granted root, or contains a component the host will not
    /// traverse (a prefix-relative path with no grant at all).
    PermissionDenied,
    /// Nothing exists at the path. `stat` reports this as `exists: false` instead of an error;
    /// the write/delete family returns it because the TypeScript did.
    NotFound,
    /// The destination already exists where the operation must not overwrite.
    AlreadyExists,
    /// A grant ceiling (`MAX_TEXT_BYTES`) or a host I/O failure. The message carries the cause.
    Refused { code: &'static str, message: String },
}

impl FsCapabilityError {
    /// The wire code a plugin sees in its error envelope.
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::EmptyPath => "empty_path",
            Self::PermissionDenied => "permission_denied",
            Self::NotFound => "not_found",
            Self::AlreadyExists => "already_exists",
            Self::Refused { code, .. } => code,
        }
    }

    /// The message half of the envelope.
    #[must_use]
    pub fn message(&self) -> String {
        match self {
            Self::EmptyPath => "an empty path was refused".to_string(),
            Self::PermissionDenied => "the path is outside the authorized roots".to_string(),
            Self::NotFound => "no such path".to_string(),
            Self::AlreadyExists => "the destination already exists".to_string(),
            Self::Refused { message, .. } => message.clone(),
        }
    }

    /// A refusal the module could not express as one of the four protocol codes.
    pub fn host(code: &'static str, cause: impl std::fmt::Display) -> Self {
        Self::Refused { code, message: cause.to_string() }
    }
}

impl std::fmt::Display for FsCapabilityError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code(), self.message())
    }
}

impl std::error::Error for FsCapabilityError {}

/// One directory entry, the `DissolvefDirEntry`/`NameuDirEntry` shape the nodes already publish.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirEntryInfo {
    /// The entry name, without any separator.
    pub name: String,
    /// `parent/name` as the node expects to display and to hand back to `move_path`.
    pub path: String,
    /// Whether the entry is a regular file.
    pub is_file: bool,
    /// Whether the entry is a directory.
    pub is_directory: bool,
    /// Whether the entry is a link, straight off the dirent — which is what `readdir(withFileTypes)`
    /// means to a node like `linku`, and free: the kind is already in the `file_type()` read above.
    pub is_symlink: bool,
}

/// What `stat` answers for one path.
#[derive(Debug, Clone, PartialEq)]
pub struct PathInfo {
    /// The path as the caller named it, so the plugin's plan rows keep their own spelling.
    pub path: String,
    /// Whether anything exists there.
    pub exists: bool,
    /// Regular file.
    pub is_file: bool,
    /// Directory.
    pub is_directory: bool,
    /// Symlink — the kind `lstat` exists to report. With [`PathInfo::is_file`] and
    /// [`PathInfo::is_directory`] this is the complete `kind` the nodes branch on; a link the caller
    /// asked to follow reports what its target is, so `is_symlink` is how `lstat` stays distinguishable.
    pub is_symlink: bool,
    /// Size in bytes; `0` when the path is absent or a directory.
    pub size_bytes: u64,
    /// Last access time, epoch milliseconds. `platform.ts` reports sub-millisecond floats; the
    /// boundary carries integers because the nodes only compare and restore them.
    pub atime_ms: TimestampMs,
    /// Last modification time, epoch milliseconds.
    pub mtime_ms: TimestampMs,
}

impl PathInfo {
    /// The `exists: false` answer a failed `lstat` produced in `platform.ts:7-13`; the nodes depend
    /// on the distinction between "missing" (skip it) and "refused" (fail the operation).
    fn missing(path: &str) -> Self {
        Self {
            path: path.to_string(),
            exists: false,
            is_file: false,
            is_directory: false,
            is_symlink: false,
            size_bytes: 0,
            atime_ms: 0,
            mtime_ms: 0,
        }
    }
}

/// The `xiranite.fs.copy` options, as the node asks for them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CopyOptions {
    /// Descend into directories. `false` refuses to copy a directory, which is `cp`'s own behaviour.
    pub recursive: bool,
    /// Overwrite an existing destination. `false` answers [`FsCapabilityError::AlreadyExists`].
    pub force: bool,
}

impl Default for CopyOptions {
    /// `cp`'s defaults, not `copyFile`'s: `copyFile` overwrites (`force: true`) and cannot recurse.
    fn default() -> Self {
        Self { recursive: false, force: true }
    }
}

/// The host side of `xiranite.fs.*` for one authorization grant.
#[derive(Debug, Clone)]
pub struct FileCapability {
    /// Granted roots, canonicalized at construction so later comparisons see real device paths.
    roots: Vec<PathBuf>,
}

impl FileCapability {
    /// Builds the service over the granted roots. Roots that cannot be canonicalized (they do not
    /// exist yet) are kept as normalized absolutes, which still refuses `..` escapes.
    #[must_use]
    pub fn new<'a>(granted: impl IntoIterator<Item = &'a Path>) -> Self {
        let roots = granted
            .into_iter()
            .map(|root| {
                root.canonicalize().unwrap_or_else(|_| {
                    PathBuf::from(normalize_separators(&root.to_string_lossy()))
                })
            })
            .collect();
        Self { roots }
    }

    /// A service that grants nothing: every call is a `PermissionDenied`. Used when the host has no
    /// file grant for an operation, instead of pretending the capability is absent.
    #[must_use]
    pub fn denied() -> Self {
        Self { roots: Vec::new() }
    }

    /// The granted roots, for the host's own audit line.
    #[must_use]
    pub fn roots(&self) -> &[PathBuf] {
        &self.roots
    }

    /// Resolves one requested path into a canonical path the grant covers.
    ///
    /// The leaf usually does not exist (`ensure_dir`, `write_text`), so only the nearest existing
    /// ancestor is canonicalized and the remaining components are re-appended. The **last** component
    /// is kept as the caller wrote it even when it does exist: it may be a symbolic link, and
    /// canonicalizing it would authorize its target instead of the link the caller named. `stat`'s
    /// `lstat` semantics, `read_link`, and `symlink`'s own "already exists" check all depend on that;
    /// ancestors are still canonicalized, so a directory link that points out of the grant stays a
    /// refusal, and the follow arms (`resolve_open`) canonicalize the whole path and re-check.
    pub fn resolve(&self, raw: &str) -> Result<PathBuf, FsCapabilityError> {
        if raw.trim().is_empty() {
            return Err(FsCapabilityError::EmptyPath);
        }
        let requested = PathBuf::from(normalize_separators(raw).as_str());
        let absolute = absolute_path(&requested);
        let parent = absolute.parent().unwrap_or(&absolute);
        let (existing_ancestor, tail) = split_existing_prefix(parent);
        let canonical_ancestor = existing_ancestor
            .canonicalize()
            .map_err(|_| FsCapabilityError::PermissionDenied)?;
        let mut candidate = tail
            .iter()
            .fold(canonical_ancestor, |mut path, name| {
                path.push(name);
                path
            });
        if let Some(leaf) = absolute.file_name() {
            candidate.push(leaf);
        }
        if self.roots.iter().any(|root| path_within(&candidate, root)) {
            Ok(candidate)
        } else {
            Err(FsCapabilityError::PermissionDenied)
        }
    }

    /// `xiranite.fs.stat`. A failed metadata read answers `exists: false`; a refusal is an error.
    ///
    /// This is `lstat` semantics (`symlink_metadata`), because that is the reading `platform.ts:7-13`
    /// used and the one that cannot be spoofed by a link pointing outside the grant. A caller that
    /// wants Node's `stat` — follow the link and report the target — asks [`Self::stat_at`] with
    /// `follow_symlinks: true`.
    pub fn stat(&self, raw: &str) -> Result<PathInfo, FsCapabilityError> {
        self.stat_at(raw, false)
    }

    /// `xiranite.fs.stat` with the follow decision the node's own member makes.
    ///
    /// Following is only ever asked for a path the grant already covers, and the *read* is the only
    /// thing that changes: `stat`-ing a link to `/etc/shadow` inside a granted directory reports the
    /// target's size and times, which is exactly what `synct`/`timeu` need to copy times onto a file
    /// and what `stat` on Node means. Nothing here widens the grant.
    pub fn stat_at(&self, raw: &str, follow_symlinks: bool) -> Result<PathInfo, FsCapabilityError> {
        let path = self.resolve(raw)?;
        let metadata = match read_metadata(&path, follow_symlinks) {
            // `exists: false` covers both readings of "nothing there": the link is gone, and the link
            // is present but its target is not (the follow arm's ENOENT). The `lstat` arm still
            // reports a dangling link as existing, because that is the answer `linku` plans on.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(PathInfo::missing(raw));
            }
            Ok(metadata) => metadata,
            Err(error) => return Err(FsCapabilityError::host("stat_failed", error)),
        };
        let times = file_times(&metadata);
        let is_symlink = metadata.file_type().is_symlink();
        Ok(PathInfo {
            path: raw.to_string(),
            exists: true,
            is_file: metadata.is_file(),
            is_directory: metadata.is_dir(),
            // A followed read reports the target's kind, so it is no longer a link as far as the
            // caller is concerned; reporting `true` here would make `lstat` and `stat` answers
            // indistinguishable for the one case the caller asked to distinguish.
            is_symlink: is_symlink && !follow_symlinks,
            size_bytes: if metadata.is_dir() { 0 } else { metadata.len() },
            atime_ms: times.0,
            mtime_ms: times.1,
        })
    }

    /// `xiranite.fs.list` — one level, entry kinds included, because the nodes plan on that.
    pub fn list(&self, raw: &str) -> Result<Vec<DirEntryInfo>, FsCapabilityError> {
        let path = self.resolve(raw)?;
        let read = std::fs::read_dir(&path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                FsCapabilityError::NotFound
            } else {
                FsCapabilityError::host("list_failed", error)
            }
        })?;
        // Entry paths keep the caller's own spelling, the way `readdir(path)` + `join(path, name)` did
        // in `platform.ts:38-47`. Publishing the canonical path instead would show `/private/var/…` on
        // macOS and hand the plugin a prefix it was never granted.
        let parent = normalize_separators(raw);
        let mut entries = Vec::new();
        for entry in read {
            let entry = entry.map_err(|error| FsCapabilityError::host("list_failed", error))?;
            let file_type = entry
                .file_type()
                .map_err(|error| FsCapabilityError::host("list_failed", error))?;
            entries.push(DirEntryInfo {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: join_paths(&[&parent, &entry.file_name().to_string_lossy()]),
                is_file: file_type.is_file(),
                is_directory: file_type.is_dir(),
                is_symlink: file_type.is_symlink(),
            });
        }
        entries.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(entries)
    }

    /// `xiranite.fs.ensure_dir`.
    pub fn ensure_dir(&self, raw: &str) -> Result<(), FsCapabilityError> {
        let path = self.resolve(raw)?;
        std::fs::create_dir_all(&path).map_err(|error| FsCapabilityError::host("ensure_dir_failed", error))
    }

    /// `xiranite.fs.move` — the rename, with the `platform.ts:19-24` fallback: when a plain rename
    /// cannot do it (a cross-device move, or a directory onto a different volume) copy recursively
    /// and then remove the source. The host performs the whole move; only two paths cross the
    /// boundary, which is ADR-0066's rule.
    pub fn move_path(&self, source: &str, destination: &str) -> Result<(), FsCapabilityError> {
        let from = self.resolve(source)?;
        let to = self.resolve(destination)?;
        // A folder moved into its own subtree makes `rename` fail with `EINVAL` by spec, which drops
        // the call into the fallback below — and that fallback then walks into the destination it
        // just created inside the source, nesting a copy of the source level after level (~150 deep
        // before the path length limit answers `ENAMETOOLONG`). The cycle is refused by shape.
        if from != to && path_within(&to, &from) {
            return Err(FsCapabilityError::host(
                "move_into_self",
                format!("{source} cannot be moved inside itself"),
            ));
        }
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| FsCapabilityError::host("ensure_dir_failed", error))?;
        }
        match std::fs::rename(&from, &to) {
            Ok(()) => Ok(()),
            Err(rename_error) => copy_then_remove(&from, &to)
                .map_err(|error| FsCapabilityError::host("move_failed", format!("{rename_error}; {error}"))),
        }
    }

    /// `xiranite.fs.delete`. Non-recursive deletes refuse a non-empty directory, which is what makes
    /// a dissolved folder's leftover check meaningful to the node.
    pub fn delete(&self, raw: &str, recursive: bool) -> Result<(), FsCapabilityError> {
        let path = self.resolve(raw)?;
        let metadata =
            std::fs::symlink_metadata(&path).map_err(|error| FsCapabilityError::host("stat_failed", error))?;
        let result = if metadata.is_dir() && !metadata.file_type().is_symlink() {
            if recursive {
                std::fs::remove_dir_all(&path)
            } else {
                std::fs::remove_dir(&path)
            }
        } else {
            std::fs::remove_file(&path)
        };
        result.map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                FsCapabilityError::NotFound
            } else {
                FsCapabilityError::host("delete_failed", error)
            }
        })
    }

    /// `xiranite.fs.read` for a bounded text document. `Ok(None)` means "no file", which the nodes
    /// read as an empty history (`platform.ts:80-86` returns `null`).
    pub fn read_text(&self, raw: &str) -> Result<Option<String>, FsCapabilityError> {
        let path = self.resolve(raw)?;
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(FsCapabilityError::host("read_failed", error)),
        };
        if metadata.len() > MAX_TEXT_BYTES {
            return Err(FsCapabilityError::Refused {
                code: "text_too_large",
                message: format!(
                    "{} bytes exceeds the {MAX_TEXT_BYTES} byte text ceiling; use a handle-based read",
                    metadata.len()
                ),
            });
        }
        let bytes = std::fs::read(&path).map_err(|error| FsCapabilityError::host("read_failed", error))?;
        String::from_utf8(bytes).map(Some).map_err(|error| FsCapabilityError::host("not_utf8", error))
    }

    /// `xiranite.fs.write` for a bounded text document, creating the parent directory the way
    /// `platform.ts:88-91` did.
    pub fn write_text(&self, raw: &str, contents: &str) -> Result<(), FsCapabilityError> {
        if contents.len() as u64 > MAX_TEXT_BYTES {
            return Err(FsCapabilityError::Refused {
                code: "text_too_large",
                message: format!(
                    "{} bytes exceeds the {MAX_TEXT_BYTES} byte text ceiling; a plugin does not stream writes through one call",
                    contents.len()
                ),
            });
        }
        let path = self.resolve(raw)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| FsCapabilityError::host("ensure_dir_failed", error))?;
        }
        std::fs::write(&path, contents.as_bytes()).map_err(|error| FsCapabilityError::host("write_failed", error))
    }

    /// `xiranite.fs.append` — append a bounded text document, creating the file and the parent.
    ///
    /// This exists so a journal writer does not read the whole history back to add one line
    /// (`appendFile` is how the platform halves wrote their undo logs). The ceiling is the append's
    /// *own* size, not the file's: a log that has grown past `MAX_TEXT_BYTES` is still appendable, one
    /// line at a time.
    pub fn append_text(&self, raw: &str, contents: &str) -> Result<(), FsCapabilityError> {
        if contents.len() as u64 > MAX_TEXT_BYTES {
            return Err(FsCapabilityError::Refused {
                code: "text_too_large",
                message: format!(
                    "appending {} bytes exceeds the {MAX_TEXT_BYTES} byte text ceiling",
                    contents.len()
                ),
            });
        }
        let path = self.resolve_open(raw)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| FsCapabilityError::host("ensure_dir_failed", error))?;
        }
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .create(true)
            .open(&path)
            .map_err(|error| FsCapabilityError::host("append_failed", error))?;
        file.write_all(contents.as_bytes())
            .map_err(|error| FsCapabilityError::host("append_failed", error))
    }

    /// `xiranite.fs.read_bytes` for one bounded buffer, `Ok(None)` for "no file".
    ///
    /// `offset`/`length` are the positioned arms: a node that wants a container header does not have to
    /// name the whole file, and a file bigger than [`MAX_BINARY_BYTES`] is readable in ranges. An
    /// offset past the end answers an empty buffer, the same end-of-stream signal
    /// [`crate::file_stream::FileReadStream::read_chunk`] uses.
    pub fn read_bytes(
        &self,
        raw: &str,
        offset: Option<u64>,
        length: Option<u64>,
    ) -> Result<Option<Vec<u8>>, FsCapabilityError> {
        let wanted_bytes = length.unwrap_or(MAX_BINARY_BYTES);
        if wanted_bytes > MAX_BINARY_BYTES {
            return Err(FsCapabilityError::Refused {
                code: "range_too_large",
                message: format!(
                    "{wanted_bytes} bytes exceeds the {MAX_BINARY_BYTES} byte single-buffer ceiling; \
                     ask for the file in ranges with offset/length"
                ),
            });
        }
        let path = self.resolve_open(raw)?;
        let metadata = match std::fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(FsCapabilityError::host("read_failed", error)),
        };
        if metadata.is_dir() {
            return Err(FsCapabilityError::Refused {
                code: "is_directory",
                message: format!("{raw} is a directory; a byte read names one file"),
            });
        }
        // Only the whole-file arm is ceiling-checked against the file's size: a ranged read of a file
        // that is itself enormous is exactly what the range is for.
        let start = offset.unwrap_or(0);
        if start == 0 && metadata.len() > MAX_BINARY_BYTES {
            return Err(FsCapabilityError::Refused {
                code: "bytes_too_large",
                message: format!(
                    "{} bytes exceeds the {MAX_BINARY_BYTES} byte single-buffer ceiling; use \
                     offset/length or the handle-based reader",
                    metadata.len()
                ),
            });
        }
        if start >= metadata.len() {
            return Ok(Some(Vec::new()));
        }
        use std::io::{Read, Seek, SeekFrom};
        let mut file =
            std::fs::File::open(&path).map_err(|error| FsCapabilityError::host("read_failed", error))?;
        file.seek(SeekFrom::Start(start))
            .map_err(|error| FsCapabilityError::host("read_failed", error))?;
        let wanted = wanted_bytes.min(metadata.len() - start);
        let mut buffer = vec![0u8; usize::try_from(wanted).unwrap_or(MAX_BINARY_BYTES as usize)];
        let mut filled = 0usize;
        while filled < buffer.len() {
            let read = file
                .read(&mut buffer[filled..])
                .map_err(|error| FsCapabilityError::host("read_failed", error))?;
            if read == 0 {
                break;
            }
            filled += read;
        }
        buffer.truncate(filled);
        Ok(Some(buffer))
    }

    /// `xiranite.fs.write_bytes` — one bounded buffer, creating the parent directory.
    ///
    /// `append: false` truncates (Node's `writeFile`), `append: true` extends (Node's `appendFile` with
    /// a Buffer). Bytes cross here and nowhere else; a caller that wants them as text inside a JSON
    /// document is the failure mode ADR-0071 retired.
    pub fn write_bytes(&self, raw: &str, bytes: &[u8], append: bool) -> Result<(), FsCapabilityError> {
        if bytes.len() as u64 > MAX_BINARY_BYTES {
            return Err(FsCapabilityError::Refused {
                code: "bytes_too_large",
                message: format!(
                    "{} bytes exceeds the {MAX_BINARY_BYTES} byte single-buffer ceiling; a caller \
                     does not stream a write through one call",
                    bytes.len()
                ),
            });
        }
        let path = self.resolve_open(raw)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| FsCapabilityError::host("ensure_dir_failed", error))?;
        }
        use std::io::Write;
        // `truncate` and `append` together is an error std refuses at open time, so exactly one of them
        // is asked for — which is also what the two Node members mean.
        std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(!append)
            .append(append)
            .open(&path)
            .and_then(|mut file| file.write_all(bytes))
            .map_err(|error| FsCapabilityError::host("write_failed", error))
    }

    /// `xiranite.fs.copy` — one file, or a whole tree with [`CopyOptions::recursive`].
    ///
    /// The host performs the copy; only two paths cross the boundary (ADR-0066). Times come along
    /// because every consumer of this op in the node set is a backup or a staging copy whose journal
    /// compares them.
    pub fn copy(
        &self,
        source: &str,
        destination: &str,
        options: CopyOptions,
    ) -> Result<(), FsCapabilityError> {
        let from = self.resolve_open(source)?;
        let to = self.resolve(destination)?;
        if from == to {
            return Err(FsCapabilityError::host(
                "copy_onto_self",
                format!("{source} cannot be copied onto itself"),
            ));
        }
        // The same cycle `move_path` refuses by shape: a tree copied into its own subtree nests a copy
        // of itself level after level until the path-length limit answers instead.
        if path_within(&to, &from) {
            return Err(FsCapabilityError::host(
                "copy_into_self",
                format!("{source} cannot be copied inside itself"),
            ));
        }
        let metadata = std::fs::symlink_metadata(&from)
            .map_err(|error| FsCapabilityError::host("copy_failed", error))?;
        if metadata.is_dir() && !metadata.file_type().is_symlink() && !options.recursive {
            return Err(FsCapabilityError::Refused {
                code: "is_directory",
                message: format!("{source} is a directory; copy needs recursive"),
            });
        }
        if !options.force && std::fs::symlink_metadata(&to).is_ok() {
            return Err(FsCapabilityError::AlreadyExists);
        }
        copy_tree(&from, &to, options).map_err(|error| FsCapabilityError::host("copy_failed", error))
    }

    /// `xiranite.fs.link` — a hard link, the `linku` primitive.
    ///
    /// Both ends are authorized, so a link is not a second door to a path the operation was never
    /// given: the destination is inside the grant and so is the source it names.
    pub fn link(&self, source: &str, destination: &str) -> Result<(), FsCapabilityError> {
        let from = self.resolve_open(source)?;
        let to = self.resolve(destination)?;
        if std::fs::symlink_metadata(&to).is_ok() {
            return Err(FsCapabilityError::AlreadyExists);
        }
        std::fs::hard_link(&from, &to).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                FsCapabilityError::AlreadyExists
            } else {
                FsCapabilityError::host("link_failed", error)
            }
        })
    }

    /// `xiranite.fs.symlink` — a symbolic link at `link_path` whose stored text is `target`.
    ///
    /// `target` is authorized before anything is created. A link that names a path outside every
    /// granted root would let the operation follow it out with the very next read, so the grant is
    /// checked on the target's own text as well as on the link path.
    ///
    /// `directory` is Node's `type: "dir"` decision. Windows needs to know it up front
    /// (`symlink_dir` versus `symlink_file`) while POSIX does not, which is why the flag is part of the
    /// signature rather than derived from a probe: a link to a path that does not exist yet has no kind
    /// to read. See [`make_symlink`], the module's one platform-API call.
    pub fn symlink(
        &self,
        target: &str,
        link_path: &str,
        directory: bool,
    ) -> Result<(), FsCapabilityError> {
        // Authorize both halves. `resolve` accepts a not-yet-existing leaf, which is exactly what a
        // symlink to a future path looks like, so the target is checked as a path, not as a file.
        let authorized_target = self.resolve(target)?;
        let link = self.resolve(link_path)?;
        if std::fs::symlink_metadata(&link).is_ok() {
            return Err(FsCapabilityError::AlreadyExists);
        }
        if let Some(parent) = link.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| FsCapabilityError::host("ensure_dir_failed", error))?;
        }
        // The link stores the caller's own spelling, not the canonical path: a relative link stays
        // relative, and `platform.ts` handed the target text straight to the syscall. Rewriting it to
        // `authorized_target` would silently change what a moved tree links to.
        let _ = authorized_target;
        make_symlink(target, &link, directory).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                FsCapabilityError::AlreadyExists
            } else {
                FsCapabilityError::host("symlink_failed", error)
            }
        })
    }

    /// `xiranite.fs.readlink` — the stored target text, verbatim (may be relative, as Node reports it).
    ///
    /// Reading a link that points outside the grant is information, not a write, so the answer is
    /// returned as it is stored; the *follow* arms (`stat_at`, `read_bytes`, `resolve_open`) are where
    /// the grant bites again.
    pub fn read_link(&self, raw: &str) -> Result<String, FsCapabilityError> {
        let path = self.resolve(raw)?;
        let target =
            std::fs::read_link(&path).map_err(|error| FsCapabilityError::host("readlink_failed", error))?;
        Ok(normalize_separators(&target.to_string_lossy()))
    }

    /// `xiranite.fs.realpath` — the canonical path, still required to sit inside a granted root.
    ///
    /// A link that escapes the grant must not be handed back as a usable path: the node would pass it
    /// to the next call and read `PermissionDenied` as "missing file", which is a worse answer than
    /// refusing here. Node's `realpath` has no such rule, and that difference is the point of the
    /// grant.
    pub fn real_path(&self, raw: &str) -> Result<String, FsCapabilityError> {
        let path = self.resolve(raw)?;
        let canonical =
            std::fs::canonicalize(&path).map_err(|error| FsCapabilityError::host("realpath_failed", error))?;
        if self.roots.iter().any(|root| path_within(&canonical, root)) {
            Ok(canonical.to_string_lossy().into_owned())
        } else {
            Err(FsCapabilityError::PermissionDenied)
        }
    }

    /// `xiranite.fs.mkdtemp` — create `<prefix><6 chars>` and answer the new path.
    ///
    /// The prefix goes through the same authorization as every other path, so a temp directory can only
    /// be made inside a granted root; that is what makes the `mkdtemp(join(tmpdir, name))` pattern the
    /// platform halves use safe rather than an escape hatch. Like Node's, the prefix's parent must
    /// already exist.
    pub fn mkdtemp(&self, prefix: &str) -> Result<String, FsCapabilityError> {
        let base = self.resolve(prefix)?;
        for _ in 0..MKDTEMP_ATTEMPTS {
            let candidate = format!("{}{}", base.to_string_lossy(), temp_suffix());
            let path = std::path::PathBuf::from(&candidate);
            match std::fs::create_dir(&path) {
                Ok(()) => return Ok(candidate),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    return Err(FsCapabilityError::NotFound);
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(FsCapabilityError::host("mkdtemp_failed", error)),
            }
        }
        Err(FsCapabilityError::host(
            "mkdtemp_failed",
            format!("{MKDTEMP_ATTEMPTS} suffix draws all collided at {prefix}"),
        ))
    }

    /// `xiranite.fs.utimes` — restore access and modification times, epoch milliseconds.
    ///
    /// Times are unsigned because that is what [`PathInfo`] answers; a node that plans to write a time
    /// it never read is a plan bug this boundary cannot see.
    pub fn set_times(
        &self,
        raw: &str,
        atime_ms: TimestampMs,
        mtime_ms: TimestampMs,
    ) -> Result<(), FsCapabilityError> {
        let path = self.resolve_open(raw)?;
        let times = std::fs::FileTimes::new()
            .set_accessed(system_time(atime_ms))
            .set_modified(system_time(mtime_ms));
        write_open_then_read_open(&path)
            .map_err(|error| FsCapabilityError::host("utimes_failed", error))?
            .set_times(times)
            .map_err(|error| FsCapabilityError::host("utimes_failed", error))
    }

    /// [`Self::resolve`] plus the symlink check that plain resolution cannot make.
    ///
    /// `resolve` canonicalizes the nearest existing *ancestor*, because the leaf usually does not exist
    /// yet. That leaves the final component unfollowed, so a link inside the grant whose target sits
    /// outside it would read, write or append through this door without ever passing the check. A path
    /// that exists is therefore canonicalized once more and required to land inside a root; a path that
    /// does not exist yet has no target to escape through.
    fn resolve_open(&self, raw: &str) -> Result<PathBuf, FsCapabilityError> {
        let path = self.resolve(raw)?;
        match std::fs::canonicalize(&path) {
            Ok(canonical) => {
                if self.roots.iter().any(|root| path_within(&canonical, root)) {
                    Ok(canonical)
                } else {
                    Err(FsCapabilityError::PermissionDenied)
                }
            }
            Err(_) => Ok(path),
        }
    }
}

/// Opens a path for writing, falling back to a read-only handle.
///
/// Setting times needs a handle, and the handle a platform grants for a *directory* is usually
/// read-only (Linux answers `EISDIR` for write, Windows needs backup semantics std does not expose), so
/// the write-open is tried first and the read-open is the fallback rather than a guess about what the
/// caller named. A filesystem that refuses both answers with its own cause, which is the honest
/// failure a caller can show an operator.
fn write_open_then_read_open(path: &Path) -> std::io::Result<std::fs::File> {
    std::fs::OpenOptions::new().write(true).open(path).or_else(|write_error| {
        std::fs::File::open(path).map_err(|read_error| {
            std::io::Error::other(format!("{write_error}; {read_error}"))
        })
    })
}

/// Creates a symbolic link. This is the module's one platform-API call, kept in one function instead of
/// spread through the arms.
///
/// `std::fs` has no portable `symlink`: POSIX exposes `std::os::unix::fs::symlink`, Windows splits the
/// same syscall by what the link names (`symlink_file` / `symlink_dir`) and answers `ERROR_INVALID_CDE`
/// style failures when the flag is wrong. Everything else in this file stays `#[cfg]`-free by rule
/// (see the header); a link target's kind is data the caller supplies, so it crosses as a parameter and
/// the platform arms only decide what to do with it. A junction — a Windows reparse point — is not
/// offered here at all, because `std` cannot create one on any platform and `fs.symlink` says so.
#[cfg(unix)]
fn make_symlink(target: &str, link: &Path, _directory: bool) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(windows)]
fn make_symlink(target: &str, link: &Path, directory: bool) -> std::io::Result<()> {
    if directory {
        std::os::windows::fs::symlink_dir(target, link)
    } else {
        std::os::windows::fs::symlink_file(target, link)
    }
}

/// Any other target: links are not offered, rather than half-implemented behind an untested binding.
#[cfg(not(any(unix, windows)))]
fn make_symlink(_target: &str, _link: &Path, _directory: bool) -> std::io::Result<()> {
    Err(std::io::Error::other("symbolic links are not implemented for this target"))
}

/// Reads metadata with or without following the final symlink component.
fn read_metadata(path: &Path, follow_symlinks: bool) -> std::io::Result<std::fs::Metadata> {
    if follow_symlinks {
        std::fs::metadata(path)
    } else {
        std::fs::symlink_metadata(path)
    }
}

/// An epoch-milliseconds value back into a `SystemTime`, floored at the epoch.
///
/// A pre-1970 timestamp cannot be named as unsigned milliseconds at all, and the nodes only ever
/// restore times they read from [`file_times`], which produced the same floor going in.
fn system_time(epoch_ms: TimestampMs) -> std::time::SystemTime {
    std::time::UNIX_EPOCH + std::time::Duration::from_millis(epoch_ms)
}

/// The six-character suffix `mkdtemp` appends, from a process counter and the wall clock.
///
/// Uniqueness, not secrecy: a collision is retried by the caller and the value only ever names a
/// directory nobody is trying to guess.
fn temp_suffix() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let tick = COUNTER.fetch_add(1, Ordering::Relaxed);
    let clock = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default();
    let mixed = tick.wrapping_mul(0x9e37_79b9_7f4a_7c15) ^ clock.rotate_left(23);
    let mut digits = String::with_capacity(6);
    let mut value = mixed;
    for _ in 0..6 {
        digits.push_str(&crate::to_base36(value % 36));
        value /= 36;
    }
    digits
}

/// The recursive half of `xiranite.fs.copy`: descend when the source is a directory, recreate links
/// rather than follow them, and honour [`CopyOptions::force`] at the leaves.
fn copy_tree(from: &Path, to: &Path, options: CopyOptions) -> std::io::Result<()> {
    let metadata = std::fs::symlink_metadata(from)?;
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        std::fs::create_dir_all(to)?;
        for entry in std::fs::read_dir(from)? {
            let entry = entry?;
            copy_tree(&entry.path(), &to.join(entry.file_name()), options)?;
        }
        copy_times(to, &metadata);
        return Ok(());
    }
    if metadata.file_type().is_symlink() {
        if std::fs::symlink_metadata(to).is_ok() {
            if !options.force {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::AlreadyExists,
                    "destination exists",
                ));
            }
            std::fs::remove_file(to)?;
        }
        let target = std::fs::read_link(from)?;
        // The kind is read from what the link points at, because a copied tree's links are the same
        // links; on POSIX the flag is ignored, and on Windows it is the difference between a working
        // directory link and a broken file one.
        let directory = std::fs::metadata(from).is_ok_and(|resolved| resolved.is_dir());
        return make_symlink(&target.to_string_lossy(), to, directory);
    }
    if std::fs::symlink_metadata(to).is_ok() && !options.force {
        return Err(std::io::Error::new(std::io::ErrorKind::AlreadyExists, "destination exists"));
    }
    std::fs::copy(from, to)?;
    // `std::fs::copy` carries the modification time across; the access time is the half a node's own
    // restore plan still needs.
    copy_times(to, &metadata);
    Ok(())
}

/// Best-effort time carry-over for a freshly copied path.
///
/// Failures are ignored on purpose: a copy that landed its bytes but not its atime on a `noatime` volume is
/// still a successful copy, and refusing it would be a worse answer than the TypeScript gave (it never set
/// times at all).
fn copy_times(to: &Path, source: &std::fs::Metadata) {
    let times = std::fs::FileTimes::new()
        .set_accessed(source.accessed().unwrap_or(std::time::SystemTime::UNIX_EPOCH))
        .set_modified(source.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH));
    if let Ok(handle) = write_open_then_read_open(to) {
        let _ = handle.set_times(times);
    }
}

/// `atime`/`mtime` as epoch milliseconds; a platform without access times yields `0` rather than an
/// error, because the nodes only restore times they read.
fn file_times(metadata: &std::fs::Metadata) -> (TimestampMs, TimestampMs) {
    let read = |time: Option<std::time::SystemTime>| {
        time.and_then(|instant| instant.duration_since(std::time::UNIX_EPOCH).ok())
            .and_then(|elapsed| u64::try_from(elapsed.as_millis()).ok())
            .unwrap_or(0)
    };
    let mtime = metadata.modified().ok();
    // A platform with no access time falls back to mtime, the same value `platform.ts` would have
    // produced by reading the same stat struct twice.
    let atime = metadata.accessed().ok().or(mtime);
    (read(atime), read(mtime))
}

/// Collapses `\` into `/`. Windows paths reach the host as text from a plugin that cannot know the
/// OS, and a `\`-only spelling on a POSIX grant would name a single flat file name.
#[must_use]
pub fn normalize_separators(path: &str) -> String {
    path.replace('\\', "/")
}

/// Whether a root should be compared case-insensitively. Decided by the path's own *shape* — a drive
/// prefix or a UNC prefix — rather than by `Component::Prefix`, so the same rule is testable on
/// macOS and matches how Windows resolves the same string.
#[must_use]
pub fn is_case_insensitive_root(root: &Path) -> bool {
    let text = normalize_separators(&root.to_string_lossy());
    let bytes = text.as_bytes();
    let drive_prefixed = bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    drive_prefixed || text.starts_with("//")
}

/// `a` is `b` or lives under `b`, compared component by component.
#[must_use]
pub fn path_within(candidate: &Path, root: &Path) -> bool {
    let insensitive = is_case_insensitive_root(root);
    let mut candidate_parts = candidate.components();
    let mut root_parts = root.components();
    loop {
        match (candidate_parts.next(), root_parts.next()) {
            (Some(left), Some(right)) => {
                let same = left == right
                    || (insensitive
                        && left.as_os_str().to_string_lossy().eq_ignore_ascii_case(&right.as_os_str().to_string_lossy()));
                if !same {
                    return false;
                }
            }
            // Root exhausted: the candidate is inside it (or equal).
            (Some(_), None) => return true,
            // Candidate exhausted first: equal only when the root has no parts left.
            (None, Some(_)) => return false,
            (None, None) => return true,
        }
    }
}

/// Joins parts the way `platform.ts:44-49`'s `path.join` did: the first part is kept verbatim minus
/// its trailing separator (it is the parent, and it may be `/`, a drive path or a UNC path), later
/// parts contribute their trimmed text.
///
/// An empty first part does not invent a root — callers pass the parent they were given.
#[must_use]
pub fn join_paths(parts: &[&str]) -> String {
    let mut joined = String::new();
    for (index, part) in parts.iter().enumerate() {
        let part = normalize_separators(part);
        let piece = if index == 0 { part.trim_end_matches('/') } else { part.trim_matches('/') };
        if piece.is_empty() {
            // `/` trimmed to nothing is still a root; keep exactly one separator for it.
            if index == 0 && part.starts_with('/') {
                joined.push('/');
            }
            continue;
        }
        if !joined.is_empty() && !joined.ends_with('/') {
            joined.push('/');
        }
        joined.push_str(piece);
    }
    joined
}

/// Makes a path absolute without touching the filesystem; `std::env::current_dir` is the same call
/// the TypeScript `resolve()` used.
fn absolute_path(path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().map_or_else(|_| path.to_path_buf(), |cwd| cwd.join(path))
    }
}

/// Splits into the longest existing prefix and the remaining path names.
///
/// The tail is owned `OsString`s rather than [`std::path::Component`] borrows: the names are
/// re-derived from parents that no longer exist, so there is nothing to borrow from.
fn split_existing_prefix(path: &Path) -> (PathBuf, Vec<std::ffi::OsString>) {
    let mut existing = path.to_path_buf();
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    loop {
        if existing.is_dir() {
            tail.reverse();
            return (existing, tail);
        }
        let name = existing.file_name().map(|name| name.to_os_string());
        let parent = existing.parent().map(|parent| parent.to_path_buf());
        match (name, parent) {
            (Some(name), Some(parent)) => {
                existing = parent;
                tail.push(name);
            }
            _ => {
                tail.reverse();
                return (existing, tail);
            }
        }
    }
}

/// The `platform.ts:19-24` fallback: recursive copy that refuses to overwrite, then remove source.
fn copy_then_remove(from: &Path, to: &Path) -> std::io::Result<()> {
    let metadata = std::fs::symlink_metadata(from)?;
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        std::fs::create_dir_all(to)?;
        for entry in std::fs::read_dir(from)? {
            let entry = entry?;
            copy_then_remove(&entry.path(), &to.join(entry.file_name()))?;
        }
        std::fs::remove_dir_all(from)
    } else {
        if std::fs::symlink_metadata(to).is_ok() {
            return Err(std::io::Error::new(std::io::ErrorKind::AlreadyExists, "destination exists"));
        }
        std::fs::copy(from, to)?;
        std::fs::remove_file(from)
    }
}
