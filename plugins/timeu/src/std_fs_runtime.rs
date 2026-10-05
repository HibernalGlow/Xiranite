//! The file half of [`crate::timeu_runtime::TimeuRuntime`], served by `std::fs`.
//!
//! ADR-0071 retired the `xiranite.fs.*` host functions. The host enables WASI on this plugin and
//! preopens the roots the manifest authorizes, so TimeU's five filesystem touches (`stat`/`readdir`/
//! `readFile`/`writeFile`/`mkdir`/`utimes` of `platform.ts`) are [`std::fs`] calls against the paths
//! the operation was given. Containment is the engine's job: a path outside a preopen answers
//! `NotFound`, and a write into a `ro:` preopen answers `Unsupported`. What stays a host call is
//! `xiranite.now` (a deterministic clock is product semantics) and `xiranite.operation.checkpoint`.
//!
//! The error contract is unchanged: a failed `stat` and a failed `readFile` are *data*
//! ([`TimeuPathInfo::missing`], `None`) because `platform.ts:36-38` and `platform.ts:51-57` swallowed
//! exactly those errors, while listing, writing and stamping propagate
//! [`TimeuHostError`](crate::timeu_runtime::TimeuHostError) whose message is the OS text the old
//! `error.message` was (`core.ts:136`, `core.ts:141`).
//!
//! # Two host obligations this module cannot meet alone
//!
//! 1. **`resolve(path)`.** `platform.ts:27` stored `path.resolve(input)` in `TimeuPathInfo.path`, and
//!    the record document keeps that text. A `wasm32-wasip1` guest has neither the host's working
//!    directory nor host-shaped path semantics (ADR-0071 §5 measured that `\` is not a separator and
//!    `E:\\Users\\a` is one component there), so this module echoes the caller's path text instead of
//!    guessing. The host that opened the preopen is the only party that can hand TimeU an already
//!    resolved path, and it must.
//! 2. **`utimes`.** [`std::fs::File::set_times`] is the only stable Rust shape, and WASI preview1
//!    serves no `path_set_times`/`fd_set_times` syscall (ADR-0071 §2 measured the family that *is*
//!    served; `set_times` is not in it). In a guest this is expected to answer `Unsupported` until the
//!    host serves it — which arrives as a failure row, never as a silently skipped stamp, because
//!    restoring timestamps is the whole point of the node.

use std::fs::{self, File, Metadata, OpenOptions};
use std::io::{self, ErrorKind};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::path_shape::path_join;
use crate::timeu_model::{TimeuDirectoryEntry, TimeuPathInfo};
use crate::timeu_runtime::{TimeuHostError, TimeuRuntime};

/// [`std::fs`] behind the file methods of [`TimeuRuntime`], also usable as a whole runtime on a host
/// target so the pure core can be driven against a real directory.
///
/// The trait methods delegate to the inherent ones with an explicit `Self::` path: method-call syntax
/// would already resolve to the inherent impl, and spelling it out keeps the delegation obvious.
#[derive(Debug, Clone, Copy, Default)]
pub struct StdFilesystem;

impl StdFilesystem {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }

    /// `stat` (`platform.ts:23-39`). Absence answers [`TimeuPathInfo::missing`], which is what the
    /// TypeScript `catch` produced and what `collect_timeu_targets` skips on.
    pub fn path_info(&self, path: &str) -> Result<TimeuPathInfo, TimeuHostError> {
        match fs::metadata(path) {
            Ok(meta) => Ok(TimeuPathInfo {
                path: path.to_string(),
                exists: true,
                is_file: meta.is_file(),
                is_directory: meta.is_dir(),
                atime_ms: system_time_ms(&meta.accessed()),
                mtime_ms: system_time_ms(&meta.modified()),
                ctime_ms: ctime_ms(&meta),
                birthtime_ms: system_time_ms(&meta.created()),
            }),
            Err(error) if is_absent(&error) => Ok(TimeuPathInfo::missing(path)),
            Err(error) => Err(failure("reading metadata of", path, &error)),
        }
    }

    /// One directory level, `readdir(path, { withFileTypes: true })` (`platform.ts:41-49`). The core
    /// does the recursion, so this stays one level deep.
    pub fn list_directory(&self, path: &str) -> Result<Vec<TimeuDirectoryEntry>, TimeuHostError> {
        let listed = fs::read_dir(path).map_err(|error| failure("listing", path, &error))?;
        let mut entries = Vec::new();
        for entry in listed {
            let entry = entry.map_err(|error| failure("listing", path, &error))?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let file_type = entry
                .file_type()
                .map_err(|error| failure("classifying an entry of", path, &error))?;
            entries.push(TimeuDirectoryEntry {
                is_file: file_type.is_file(),
                is_directory: file_type.is_dir(),
                path: path_join(&[path, &name]),
                name,
            });
        }
        Ok(entries)
    }

    /// `readFile(path, "utf8")` with the `platform.ts:51-57` behaviour: a missing or unreadable
    /// record document reads as `None`, which `loadTimestampRecords` calls "no stored records yet".
    pub fn read_text(&self, path: &str) -> Option<String> {
        fs::read_to_string(path).ok()
    }

    /// `writeFile(path, content, "utf8")`. Deliberately does not create parents: `core.ts:120` calls
    /// `ensureDir(dirname(recordPath))` as its own step, and collapsing the two would hide which path
    /// the operation actually wrote to.
    pub fn write_text(&self, path: &str, content: &str) -> Result<(), TimeuHostError> {
        fs::write(path, content).map_err(|error| failure("writing", path, &error))
    }

    /// `mkdir(path, { recursive: true })` (`platform.ts:15`).
    pub fn ensure_directory(&self, path: &str) -> Result<(), TimeuHostError> {
        fs::create_dir_all(path).map_err(|error| failure("creating directory", path, &error))
    }

    /// `utimes(path, new Date(atimeMs), new Date(mtimeMs))` (`platform.ts:15`). See the module docs
    /// for the WASI preview1 gap.
    ///
    /// `File::set_times` needs an open descriptor and which access mode grants it is platform
    /// dependent (Windows wants generic write, POSIX is content with a read handle), so the writable
    /// open is tried first with a read-only fallback.
    pub fn set_times(&self, path: &str, atime_ms: f64, mtime_ms: f64) -> Result<(), TimeuHostError> {
        let handle = open_for_times(path).map_err(|error| failure("opening for utimes", path, &error))?;
        let times = fs::FileTimes::new()
            .set_accessed(system_time_from_ms(atime_ms))
            .set_modified(system_time_from_ms(mtime_ms));
        handle.set_times(times).map_err(|error| failure("setting times of", path, &error))
    }
}

impl TimeuRuntime for StdFilesystem {
    fn path_info(&self, path: &str) -> Result<TimeuPathInfo, TimeuHostError> {
        Self::path_info(self, path)
    }

    fn list_directory(&self, path: &str) -> Result<Vec<TimeuDirectoryEntry>, TimeuHostError> {
        Self::list_directory(self, path)
    }

    fn read_text(&self, path: &str) -> Option<String> {
        Self::read_text(self, path)
    }

    fn write_text(&self, path: &str, content: &str) -> Result<(), TimeuHostError> {
        Self::write_text(self, path, content)
    }

    fn ensure_directory(&self, path: &str) -> Result<(), TimeuHostError> {
        Self::ensure_directory(self, path)
    }

    fn set_times(&self, path: &str, atime_ms: f64, mtime_ms: f64) -> Result<(), TimeuHostError> {
        Self::set_times(self, path, atime_ms, mtime_ms)
    }

    /// `xiranite.now` is a host capability, and a plugin must not read a wall clock itself
    /// (ADR-0071 decision 4). Outside a host there is no authoritative clock to ask, so the
    /// filesystem-only runtime refuses rather than inventing a time.
    fn now_epoch_ms(&self) -> Result<f64, TimeuHostError> {
        Err(TimeuHostError::new(
            "std::fs runtime has no clock: ask the host through xiranite.now".to_string(),
        ))
    }
}

/// The message `platform.ts`'s `error.message` would have carried into the plan row.
fn failure(operation: &str, path: &str, error: &io::Error) -> TimeuHostError {
    TimeuHostError::new(format!("{operation} {path} failed: {error}"))
}

/// Whether a `stat` failure means "not there", which is data (`platform.ts:36-38`). `InvalidInput`
/// covers a path the guest cannot address at all, e.g. one outside every preopen.
fn is_absent(error: &io::Error) -> bool {
    matches!(error.kind(), ErrorKind::NotFound | ErrorKind::InvalidInput)
}

fn open_for_times(path: &str) -> io::Result<File> {
    let write_error = match OpenOptions::new().write(true).open(path) {
        Ok(handle) => return Ok(handle),
        Err(error) => error,
    };
    File::open(path).map_err(|read_error| io::Error::other(format!("{write_error}; {read_error}")))
}

/// Milliseconds since the epoch, as JavaScript reports `atimeMs`: negative for a pre-1970 stamp, and
/// `0.0` when the platform does not expose the field, which is the value the old host defaulted to.
fn system_time_ms(maybe_time: &Result<SystemTime, io::Error>) -> f64 {
    let Ok(time) = maybe_time else { return 0.0 };
    match time.duration_since(UNIX_EPOCH) {
        Ok(since_epoch) => since_epoch.as_secs_f64() * 1000.0,
        Err(inverted) => -inverted.duration().as_secs_f64() * 1000.0,
    }
}

/// The inverse of [`system_time_ms`]. A non-finite or absurd value degrades to the epoch instead of
/// panicking, because the number came out of a record document.
fn system_time_from_ms(milliseconds: f64) -> SystemTime {
    let seconds = if milliseconds.is_finite() { milliseconds / 1000.0 } else { 0.0 };
    let offset = Duration::from_secs_f64(seconds.abs());
    if seconds < 0.0 {
        UNIX_EPOCH.checked_sub(offset).unwrap_or(UNIX_EPOCH)
    } else {
        UNIX_EPOCH.checked_add(offset).unwrap_or(UNIX_EPOCH)
    }
}

/// `st_ctim` in milliseconds. `std::fs::Metadata` has no portable change time, and the record
/// document stores one, so each platform's own `stat` shape is read where it exists.
#[cfg(unix)]
fn ctime_ms(meta: &Metadata) -> f64 {
    use std::os::unix::fs::MetadataExt;
    epoch_ms_from_seconds(meta.ctime() as f64, meta.ctime_nsec())
}

/// WASI preview1 exposes `st_ctim` through the same `stat` layout, so the guest reads the field the
/// host's filesystem actually reported rather than losing it at the boundary.
#[cfg(target_os = "wasi")]
fn ctime_ms(meta: &Metadata) -> f64 {
    use std::os::wasi::fs::MetadataExt;
    epoch_ms_from_seconds(meta.ctime() as f64, meta.ctime_nsec())
}

/// Windows has no inode change time and Node's libuv reports `stats.ctimeMs` as the creation time, so
/// the record keeps the same number the TypeScript core wrote.
#[cfg(windows)]
fn ctime_ms(meta: &Metadata) -> f64 {
    system_time_ms(&meta.created())
}

#[cfg(not(any(unix, target_os = "wasi", windows)))]
fn ctime_ms(_meta: &Metadata) -> f64 {
    0.0
}

fn epoch_ms_from_seconds(seconds: f64, nanos: i64) -> f64 {
    seconds * 1000.0 + (nanos as f64) / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stamp_of(root: &std::path::Path, name: &str) -> std::path::PathBuf {
        let file = root.join(name);
        fs::write(&file, b"payload").expect("fixture write");
        file
    }

    #[test]
    fn path_info_reads_every_timestamp_the_record_document_stores() {
        let root = tempfile::tempdir().expect("tempdir");
        let file = stamp_of(root.path(), "a.txt");

        let info = StdFilesystem::new().path_info(&file.display().to_string()).expect("stat");

        assert!(info.exists && info.is_file && !info.is_directory, "{info:?}");
        assert!(info.mtime_ms > 0.0, "mtime in epoch ms: {}", info.mtime_ms);
        assert!(info.atime_ms > 0.0, "atime in epoch ms: {}", info.atime_ms);
        assert_eq!(info.path, file.display().to_string(), "the caller's path text is kept");
    }

    #[test]
    fn a_missing_path_is_the_zeroed_stat_the_typescript_catch_produced() {
        let root = tempfile::tempdir().expect("tempdir");
        let absent = root.path().join("gone.txt");

        let info = StdFilesystem::new()
            .path_info(&absent.display().to_string())
            .expect("absence is data, not a refusal");

        assert_eq!(info, TimeuPathInfo::missing(&absent.display().to_string()));
    }

    #[test]
    fn a_directory_lists_one_level_with_joined_paths() {
        let root = tempfile::tempdir().expect("tempdir");
        let dir = root.path().join("shots");
        fs::create_dir_all(dir.join("nested")).expect("fixture dirs");
        stamp_of(&dir, "001.png");

        let entries = StdFilesystem::new().list_directory(&dir.display().to_string()).expect("listing");
        let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();

        assert_eq!(names, vec!["001.png", "nested"]);
        let file = entries.iter().find(|entry| entry.name == "001.png").expect("entry");
        assert!(file.is_file && !file.is_directory, "{file:?}");
        assert_eq!(file.path, path_join(&[&dir.display().to_string(), "001.png"]));
        let nested = entries.iter().find(|entry| entry.name == "nested").expect("entry");
        assert!(nested.is_directory && !nested.is_file, "{nested:?}");
        assert!(!nested.path.contains("001.png"), "one level only, the core recurses");
    }

    #[test]
    fn the_record_document_round_trips_as_utf8_text() {
        let root = tempfile::tempdir().expect("tempdir");
        let record = root.path().join("timeu-timestamps.json");
        let path = record.display().to_string();
        let filesystem = StdFilesystem::new();

        assert_eq!(filesystem.read_text(&path), None, "no record file yet is not a failure");
        filesystem.write_text(&path, "{\"records\":[]}").expect("write");
        assert_eq!(filesystem.read_text(&path).as_deref(), Some("{\"records\":[]}"));
    }

    #[test]
    fn write_text_does_not_create_the_parent_directory() {
        let root = tempfile::tempdir().expect("tempdir");
        let nested = root.path().join("deep").join("timeu-timestamps.json");

        let error = StdFilesystem::new()
            .write_text(&nested.display().to_string(), "{}")
            .expect_err("core.ts:120 makes ensureDir its own step, so this must not silently pass");

        assert!(error.message.contains("writing"), "{error}");
        assert!(!nested.parent().expect("parent").exists());
    }

    #[test]
    fn ensure_directory_is_recursive() {
        let root = tempfile::tempdir().expect("tempdir");
        let nested = root.path().join("a").join("b").join("c");

        StdFilesystem::new().ensure_directory(&nested.display().to_string()).expect("mkdir -p");

        assert!(nested.is_dir());
        StdFilesystem::new()
            .ensure_directory(&nested.display().to_string())
            .expect("an existing directory is success");
    }

    #[test]
    fn set_times_writes_both_timestamps_back_through_std_fs() {
        let root = tempfile::tempdir().expect("tempdir");
        let file = stamp_of(root.path(), "a.txt");
        let path = file.display().to_string();
        let filesystem = StdFilesystem::new();
        // Second precision on purpose: a few filesystems truncate a sub-second utimes.
        let stamped = 1_000_000_000_000.0;

        filesystem.set_times(&path, stamped, stamped).expect("std::fs::File::set_times");

        let info = filesystem.path_info(&path).expect("stat after utimes");
        assert_eq!(info.atime_ms, stamped, "restore wrote the stored atime back");
        assert_eq!(info.mtime_ms, stamped, "restore wrote the stored mtime back");
    }

    #[test]
    fn a_refused_write_keeps_the_os_message_the_failure_row_used() {
        let root = tempfile::tempdir().expect("tempdir");
        let directory = root.path().to_string_lossy().into_owned();

        let error = StdFilesystem::new()
            .write_text(&directory, "not a file")
            .expect_err("writing over a directory must fail");

        assert!(error.message.contains("writing"), "{error}");
        assert!(error.message.contains("failed"), "{error}");
    }

    #[test]
    fn the_filesystem_only_runtime_has_no_clock_of_its_own() {
        let filesystem = StdFilesystem::new();
        let error = TimeuRuntime::now_epoch_ms(&filesystem).expect_err("a plugin never reads a wall clock");
        assert!(error.message.contains("xiranite.now"), "{error}");
    }

    #[test]
    fn millisecond_times_round_trip_in_both_directions() {
        for milliseconds in [1_767_225_600_123.0, 1_000_000_000_000.0] {
            let converted = system_time_ms(&Ok(system_time_from_ms(milliseconds)));
            assert!(
                (converted - milliseconds).abs() < 0.5,
                "{milliseconds} ms became {converted} ms, further apart than a filesystem rounds"
            );
        }
        assert_eq!(system_time_ms(&Err(io::Error::other("unsupported"))), 0.0);
        assert_eq!(system_time_from_ms(f64::NAN), UNIX_EPOCH, "an absurd stamp degrades to the epoch");
    }
}
