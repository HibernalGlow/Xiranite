//! The file half of [`crate::plan::NameuRuntime`], served by `std::fs`.
//!
//! ADR-0071 retired the `xiranite.fs.*` host functions. The host now enables WASI on this plugin and
//! preopens the artist/library roots the manifest authorizes, so NameU's four machine touches
//! (`stat`/`readdir`/`rename`/`utimes` of `platform.ts`) are [`std::fs`] calls against the paths the
//! operation was given. Containment is the engine's job: a path outside a preopen answers `NotFound`
//! and a write into a `ro:` preopen answers `Unsupported`, so nothing here re-checks authorization.
//!
//! The error contract is unchanged from the host-function form: [`NameuRuntimeError::Failure`] carries
//! the OS text, which is what `core.ts:125-126`'s `catch` surfaced as an `error` row, and a failed
//! `path_info` is data (`NameuPathInfo::missing`) rather than an error, because `platform.ts:8-16`
//! swallowed a `stat` failure exactly that way.
//!
//! # Timestamps are the one open host dependency
//!
//! `set_times` is [`std::fs::File::set_times`], the only stable Rust shape for `utimes`. WASI
//! preview1 serves no `path_set_times`/`fd_set_times` syscall (ADR-0071 §2 measured the file family
//! that *is* served, and `set_times` is not in it), so inside a `wasm32-wasip1` guest this call is
//! expected to come back `Unsupported` until the host serves it. That reaches the plan as a failure
//! row; it is not silently dropped, so `keepTimestamp` stays honest about having failed.

use std::fs::{self, File, Metadata, OpenOptions};
use std::io::{self, ErrorKind};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::contract::{NameuDirEntry, NameuPathInfo};
use crate::path::join_paths;
use crate::plan::{NameuRuntimeError, NameuRuntimeResult};

/// [`std::fs`] behind the file methods of [`crate::plan::NameuRuntime`].
#[derive(Debug, Clone, Copy, Default)]
pub struct StdFilesystem;

impl StdFilesystem {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }

    /// `stat` (`platform.ts:8-16`). Absence and unreadability both answer `exists: false`, because
    /// that is what the TypeScript `catch` produced and the scan branches on it.
    pub fn path_info(&self, path: &str) -> NameuRuntimeResult<NameuPathInfo> {
        match fs::metadata(path) {
            Ok(meta) => Ok(NameuPathInfo {
                path: path.to_string(),
                exists: true,
                is_file: meta.is_file(),
                is_directory: meta.is_dir(),
                atime_ms: metadata_time_ms(&meta, Metadata::accessed),
                mtime_ms: metadata_time_ms(&meta, Metadata::modified),
            }),
            Err(error) if is_absent(&error) => Ok(NameuPathInfo::missing(path)),
            Err(error) => Err(failure("reading metadata of", path, &error)),
        }
    }

    /// `readdir(path, { withFileTypes: true })` mapped the way `platform.ts:18-26` mapped it: the
    /// entry path is `join(path, name)`, and a symlink is neither file nor directory.
    pub fn list_dir(&self, path: &str) -> NameuRuntimeResult<Vec<NameuDirEntry>> {
        let listed = fs::read_dir(path).map_err(|error| failure("listing", path, &error))?;
        let mut entries = Vec::new();
        for entry in listed {
            let entry = entry.map_err(|error| failure("listing", path, &error))?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let file_type = entry
                .file_type()
                .map_err(|error| failure("classifying an entry of", path, &error))?;
            entries.push(NameuDirEntry {
                name: name.clone(),
                path: join_paths(&[path, &name]),
                is_file: file_type.is_file(),
                is_directory: file_type.is_dir(),
            });
        }
        Ok(entries)
    }

    /// `rename` (`platform.ts:19`), the only write NameU plans against.
    pub fn rename(&self, from: &str, to: &str) -> NameuRuntimeResult<()> {
        fs::rename(from, to).map_err(|error| failure("renaming", &format!("{from} -> {to}"), &error))
    }

    /// `utimes(path, new Date(atimeMs), new Date(mtimeMs))` (`platform.ts:27-29`), applied to the
    /// target path because the move replaced the entry the times were read from (`core.ts:121-123`).
    ///
    /// `File::set_times` needs the descriptor open, and which access mode grants it is platform
    /// dependent (Windows wants generic write, POSIX is happy with a read handle), so the writable
    /// open is tried first and a read-only open is the fallback. Both failing is one failure message.
    pub fn set_times(&self, path: &str, atime_ms: f64, mtime_ms: f64) -> NameuRuntimeResult<()> {
        let handle = open_for_times(path)?;
        let times = fs::FileTimes::new()
            .set_accessed(system_time_from_ms(atime_ms))
            .set_modified(system_time_from_ms(mtime_ms));
        handle.set_times(times).map_err(|error| failure("setting times of", path, &error))
    }
}

/// A refusal whose text is what `errorMessage(error)` (`core.ts:354`) handed the plan row.
fn failure(operation: &str, path: &str, error: &io::Error) -> NameuRuntimeError {
    NameuRuntimeError::Failure(format!("{operation} {path} failed: {error}"))
}

/// Whether a `stat` failure means "not there", which is data, not an error (`platform.ts:14-16`).
/// `InvalidInput` covers a path the guest cannot address at all, e.g. one outside any preopen.
fn is_absent(error: &io::Error) -> bool {
    matches!(error.kind(), ErrorKind::NotFound | ErrorKind::InvalidInput)
}

fn open_for_times(path: &str) -> NameuRuntimeResult<File> {
    let write_error = match OpenOptions::new().write(true).open(path) {
        Ok(handle) => return Ok(handle),
        Err(error) => error,
    };
    File::open(path).map_err(|read_error| NameuRuntimeError::Failure(format!(
        "opening {path} for utimes failed: {write_error}; {read_error}"
    )))
}

/// `atimeMs`/`mtimeMs` as JavaScript would report them: milliseconds since the epoch, negative for a
/// pre-1970 timestamp, and `0.0` when the platform does not expose the field at all.
fn metadata_time_ms(meta: &Metadata, field: fn(&Metadata) -> io::Result<SystemTime>) -> f64 {
    field(meta).as_ref().map_or(0.0, system_time_ms)
}

/// The one time-of-day conversion the port needs, kept separate so the millisecond contract is
/// testable without a filesystem.
fn system_time_ms(time: &SystemTime) -> f64 {
    match time.duration_since(UNIX_EPOCH) {
        Ok(since_epoch) => since_epoch.as_secs_f64() * 1000.0,
        Err(inverted) => -inverted.duration().as_secs_f64() * 1000.0,
    }
}

/// The inverse of [`metadata_time_ms`], for the `utimes` pair. A non-finite or absurd value degrades
/// to the epoch instead of panicking, because the timestamp came from a filesystem.
fn system_time_from_ms(milliseconds: f64) -> SystemTime {
    let seconds = if milliseconds.is_finite() { milliseconds / 1000.0 } else { 0.0 };
    let offset = Duration::from_secs_f64(seconds.abs());
    if seconds < 0.0 {
        UNIX_EPOCH.checked_sub(offset).unwrap_or(UNIX_EPOCH)
    } else {
        UNIX_EPOCH.checked_add(offset).unwrap_or(UNIX_EPOCH)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    /// The tree NameU actually plans over: a library root and one artist folder holding two archives.
    fn fixture(root: &Path) -> std::path::PathBuf {
        let artist = root.join("Artist");
        fs::create_dir_all(&artist).expect("fixture dirs");
        fs::write(artist.join("Book [cbr].zip"), b"archive").expect("fixture write");
        fs::write(artist.join("BookArtist.zip"), b"archive").expect("fixture write");
        artist
    }

    #[test]
    fn path_info_reports_the_flags_and_the_millisecond_times() {
        let root = tempfile::tempdir().expect("tempdir");
        let artist = fixture(root.path());
        let archive = artist.join("Book [cbr].zip");

        let info = StdFilesystem::new().path_info(&archive.display().to_string()).expect("stat");

        assert!(info.exists && info.is_file, "an archive reads as a file: {info:?}");
        assert!(!info.is_directory);
        assert!(info.mtime_ms > 0.0, "mtime is milliseconds since the epoch: {}", info.mtime_ms);
    }

    #[test]
    fn an_absent_path_is_exists_false_and_not_an_error() {
        let root = tempfile::tempdir().expect("tempdir");
        let absent = root.path().join("Ghost");

        let info = StdFilesystem::new()
            .path_info(&absent.display().to_string())
            .expect("a missing path is data, because platform.ts swallowed the stat failure");

        assert!(!info.exists);
        assert_eq!(info.path, absent.display().to_string());
        assert_eq!(info.atime_ms, 0.0);
        assert_eq!(info.mtime_ms, 0.0);
    }

    #[test]
    fn list_dir_joins_the_entry_paths_the_way_platform_ts_did() {
        let root = tempfile::tempdir().expect("tempdir");
        let artist = fixture(root.path());
        let artist_path = artist.display().to_string();

        let entries = StdFilesystem::new().list_dir(&artist_path).expect("listing");
        let mut names: Vec<String> = entries.iter().map(|entry| entry.name.clone()).collect();
        names.sort();

        assert_eq!(names, vec!["Book [cbr].zip".to_string(), "BookArtist.zip".to_string()]);
        for entry in &entries {
            assert!(entry.path.starts_with(&artist_path), "{} left the artist folder", entry.path);
            assert!(entry.is_file && !entry.is_directory, "{entry:?}");
        }
    }

    #[test]
    fn rename_moves_the_entry_inside_the_preopen() {
        let root = tempfile::tempdir().expect("tempdir");
        let artist = fixture(root.path());
        let from = artist.join("Book [cbr].zip");
        let to = artist.join("BookArtistTwo.zip");

        StdFilesystem::new()
            .rename(&from.display().to_string(), &to.display().to_string())
            .expect("rename");

        assert!(!from.exists(), "the source is gone");
        assert!(to.is_file(), "the target landed next to it");
    }

    #[test]
    fn a_failed_rename_keeps_the_os_text_as_the_error_row_message() {
        let root = tempfile::tempdir().expect("tempdir");
        let absent = root.path().join("gone.zip");

        let error = StdFilesystem::new()
            .rename(&absent.display().to_string(), &root.path().join("target.zip").display().to_string())
            .expect_err("renaming an absent path must fail");

        let NameuRuntimeError::Failure(message) = error else {
            panic!("a filesystem failure is not a cancellation: {error:?}");
        };
        assert!(message.contains("renaming"), "{message}");
        assert!(message.contains("failed"), "{message}");
    }

    #[test]
    fn set_times_writes_the_modification_time_back_through_std_fs() {
        let root = tempfile::tempdir().expect("tempdir");
        let file = root.path().join("BookArtist.zip");
        fs::write(&file, b"archive").expect("fixture write");
        let path = file.display().to_string();
        let filesystem = StdFilesystem::new();
        // Second precision on purpose: a few filesystems truncate a sub-second utimes.
        let stamped_ms = 1_000_000_000_000.0;

        filesystem.set_times(&path, stamped_ms, stamped_ms).expect("std::fs::File::set_times");

        let info = filesystem.path_info(&path).expect("stat after utimes");
        assert_eq!(info.mtime_ms, stamped_ms, "keepTimestamp survives the rename round trip");
    }

    #[test]
    fn millisecond_times_round_trip_in_both_directions() {
        for milliseconds in [1_767_225_600_123.0, 1_000_000_000_000.0, -250.5] {
            let converted = system_time_ms(&system_time_from_ms(milliseconds));
            assert!(
                (converted - milliseconds).abs() < 0.5,
                "{milliseconds} ms became {converted} ms, more than a filesystem's rounding away"
            );
        }
        assert_eq!(system_time_from_ms(f64::NAN), UNIX_EPOCH, "an absurd stamp degrades to the epoch");
    }
}
