//! The `xiranite.fs.*` host capability service (ADR-0066, ADR-0068).
//!
//! ADR-0066 gives a plugin exactly one way to touch a machine: ask the host. This module is that
//! host side — it owns path authorization, the directory/move/delete primitives the file nodes need,
//! and the bounded text read/write used by undo histories. `crates/xiranite-node-runtime` turns these
//! methods into `xiranite.fs.*` host functions; nothing in a plugin reaches the filesystem itself.
//!
//! ## Authorization is a grant list, not a heuristic
//!
//! [`FileCapability::new`] takes the roots an operation was granted. Every path a capability call
//! names must resolve inside one of them, and "resolve" means the nearest *existing* ancestor is
//! canonicalized (the leaf often does not exist yet, because `ensure_dir`/`write_text` are called on
//! new paths). A `..` that walks out of the grant is caught by that ancestor check rather than by
//! string matching.
//!
//! ## Cross-platform rule
//!
//! Windows is the release gate and macOS/Android-free hosts must keep building, so this module has
//! no `#[cfg]` branches: separators, drive letters and UNC prefixes are handled as *path shapes*
//! (see [`normalize_separators`] and [`is_case_insensitive_root`]) which are unit-testable on any
//! OS. Real filesystem access stays on `std::fs`, whose behaviour is already per-OS.

use std::path::{Path, PathBuf};

use crate::support::TimestampMs;

/// The largest document `read_text` will hand back. Undo histories are text; a plugin that names a
/// 2 GiB file gets a refusal rather than a two-gigabyte block copied into wasm linear memory
/// (ADR-0068: bulk bytes never cross the plugin boundary).
pub const MAX_TEXT_BYTES: u64 = 4 * 1024 * 1024;

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
            size_bytes: 0,
            atime_ms: 0,
            mtime_ms: 0,
        }
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
    /// ancestor is canonicalized and the remaining components are re-appended.
    pub fn resolve(&self, raw: &str) -> Result<PathBuf, FsCapabilityError> {
        if raw.trim().is_empty() {
            return Err(FsCapabilityError::EmptyPath);
        }
        let requested = PathBuf::from(normalize_separators(raw).as_str());
        let absolute = absolute_path(&requested);
        let (existing_ancestor, tail) = split_existing_prefix(&absolute);
        let canonical_ancestor = existing_ancestor
            .canonicalize()
            .map_err(|_| FsCapabilityError::PermissionDenied)?;
        let candidate = tail
            .iter()
            .fold(canonical_ancestor, |mut path, name| {
                path.push(name);
                path
            });
        if self.roots.iter().any(|root| path_within(&candidate, root)) {
            Ok(candidate)
        } else {
            Err(FsCapabilityError::PermissionDenied)
        }
    }

    /// `xiranite.fs.stat`. A failed metadata read answers `exists: false`; a refusal is an error.
    pub fn stat(&self, raw: &str) -> Result<PathInfo, FsCapabilityError> {
        let path = self.resolve(raw)?;
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(PathInfo::missing(raw));
            }
            Err(error) => return Err(FsCapabilityError::host("stat_failed", error)),
        };
        let times = file_times(&metadata);
        Ok(PathInfo {
            path: raw.to_string(),
            exists: true,
            is_file: metadata.is_file(),
            is_directory: metadata.is_dir(),
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
        if std::fs::symlink_metadata(&existing).is_ok() {
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
