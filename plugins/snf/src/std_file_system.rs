//! The machine seam of the ported core, served by `std::fs`.
//!
//! `packages/nodes/snf/src/core.ts` is written against [`SnfFileSystem`], whose `platform.ts`
//! implementation was `node:fs/promises`. ADR-0071 retired the `xiranite.fs.*` host functions that
//! used to stand behind that trait, so this module is the real implementation: the host enables WASI
//! on the plugin and preopens the artist/library roots the manifest authorizes, and the four
//! operations below are [`std::fs`] calls against them — including positional access, which is free
//! now that the bytes are the guest's own.
//!
//! It is deliberately **not** behind `feature = "wasm"`: `std::fs` compiles on a host target too, so
//! the behaviour the isolate will exhibit is the behaviour pinned by the tests at the bottom of this
//! file, against directories that really exist. Only the control plane (`checkpoint`, `emit`,
//! `scheduler.acquire`) stays wasm-gated in `crate::plugin`.
//!
//! The trait's error contract is preserved exactly, because `core.ts` branches on it:
//! a path that is not there reads as `exists: false` (`platform.ts:7-13` swallowed the `stat`
//! failure), while a refusal the operation has to report stays an [`SnfFileAccessError`] with the
//! code and message the plan row and the `errors` list show (`core.ts:109`, `core.ts:113-115`).

use std::fs::{self, File, Metadata, OpenOptions};
use std::io::{self, ErrorKind};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::contract::{SnfDirEntry, SnfPathInfo};
use crate::file_system::{SnfFileAccessError, SnfFileSystem};
use crate::path_tools::join_folder_path;

/// [`std::fs`] behind [`SnfFileSystem`], the plugin's whole route to the machine.
#[derive(Debug, Clone, Copy, Default)]
pub struct StdFileSystem;

impl StdFileSystem {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl SnfFileSystem for StdFileSystem {
    /// `platform.ts:7-13`'s `stat`. A failure that means "not there" becomes `exists: false`;
    /// anything else is a refusal the run has to surface.
    fn path_info(&self, path: &str) -> Result<SnfPathInfo, SnfFileAccessError> {
        match fs::metadata(path) {
            Ok(meta) => Ok(SnfPathInfo {
                path: path.to_string(),
                exists: true,
                is_directory: meta.is_dir(),
                atime_ms: whole_ms(system_time_ms(&meta.accessed())),
                mtime_ms: whole_ms(system_time_ms(&meta.modified())),
            }),
            Err(error) if is_absent(&error) => Ok(SnfPathInfo {
                path: path.to_string(),
                exists: false,
                is_directory: false,
                atime_ms: 0,
                mtime_ms: 0,
            }),
            Err(error) => Err(access_error("reading metadata of", path, &error)),
        }
    }

    /// `platform.ts:15-18`'s `readdir(path, { withFileTypes: true })`, mapped with the node's own
    /// [`join_folder_path`] so a Windows-shaped parent keeps its separator. Nothing about the
    /// listing shape changed: a directory that cannot be listed is an error, as it was.
    fn list_directory(&self, path: &str) -> Result<Vec<SnfDirEntry>, SnfFileAccessError> {
        let listed = fs::read_dir(path).map_err(|error| access_error("listing", path, &error))?;
        let mut entries = Vec::new();
        for entry in listed {
            let entry = entry.map_err(|error| access_error("listing", path, &error))?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let file_type = entry
                .file_type()
                .map_err(|error| access_error("classifying an entry of", path, &error))?;
            entries.push(SnfDirEntry {
                is_directory: file_type.is_dir(),
                path: join_folder_path(path, &name),
                name,
            });
        }
        Ok(entries)
    }

    /// `platform.ts:19`'s `rename`. ADR-0066's "the host journals the move" was the pre-ADR-0071
    /// shape; the rename is now the guest's own syscall, and the file-operation history the product
    /// layer keeps is written by the host that owns the operation, not by this call.
    fn rename_folder(&self, source_path: &str, target_path: &str) -> Result<(), SnfFileAccessError> {
        fs::rename(source_path, target_path)
            .map_err(|error| access_error("renaming", &format!("{source_path} -> {target_path}"), &error))
    }

    /// `platform.ts:20-22`'s `utimes`, on the *target* path after the rename, which is what
    /// `keepTimestamp` (`core.ts:106`) depends on.
    ///
    /// See the module note in `crate::plugin`: WASI preview1 serves no change-time syscall, so in a
    /// guest this is expected to answer `Unsupported` until the host serves it. That surfaces as a
    /// refusal row with code `unsupported`, never as a silently skipped stamp.
    fn set_folder_timestamps(&self, path: &str, atime_ms: u64, mtime_ms: u64) -> Result<(), SnfFileAccessError> {
        let handle = open_for_times(path).map_err(|error| access_error("opening for utimes", path, &error))?;
        let times = fs::FileTimes::new()
            .set_accessed(system_time_from_ms(atime_ms))
            .set_modified(system_time_from_ms(mtime_ms));
        handle
            .set_times(times)
            .map_err(|error| access_error("setting times of", path, &error))
    }
}

/// A refusal with the code the operation switches on and the message the plan row shows.
///
/// The codes are the ones the host used to return, so `SnfPlanItem.reason` and the card's `errors`
/// list keep the same vocabulary: `not_found`, `permission_denied`, `unsupported`, `io_error`.
fn access_error(operation: &str, path: &str, error: &io::Error) -> SnfFileAccessError {
    SnfFileAccessError::new(error_code(error), format!("{operation} {path} failed: {error}"))
}

fn error_code(error: &io::Error) -> &'static str {
    match error.kind() {
        ErrorKind::NotFound => "not_found",
        ErrorKind::PermissionDenied => "permission_denied",
        ErrorKind::Unsupported => "unsupported",
        _ => "io_error",
    }
}

/// Whether a `stat` failure means "not there", which is data (`platform.ts:14`). `InvalidInput`
/// covers a path the guest cannot address at all, e.g. one outside every preopen.
fn is_absent(error: &io::Error) -> bool {
    matches!(error.kind(), ErrorKind::NotFound | ErrorKind::InvalidInput)
}

/// `File::set_times` needs an open descriptor, and which access mode grants it is platform
/// dependent (Windows wants generic write, POSIX is content with a read handle), so the writable
/// open is tried first with a read-only fallback.
fn open_for_times(path: &str) -> io::Result<File> {
    let write_error = match OpenOptions::new().write(true).open(path) {
        Ok(handle) => return Ok(handle),
        Err(error) => error,
    };
    File::open(path).map_err(|read_error| io::Error::other(format!("{write_error}; {read_error}")))
}

/// Milliseconds since the epoch; `0.0` when the platform does not expose the field, which is the
/// value `platform.ts:9` defaulted a failed `stat` to as well.
fn system_time_ms(maybe_time: &Result<SystemTime, io::Error>) -> f64 {
    let Ok(time) = maybe_time else { return 0.0 };
    match time.duration_since(UNIX_EPOCH) {
        Ok(since_epoch) => since_epoch.as_secs_f64() * 1000.0,
        // `SnfPathInfo` keeps an unsigned clock because `new Date(atimeMs)` cannot take a negative
        // one from a folder that predates the epoch; such a path is reported as the epoch.
        Err(_) => 0.0,
    }
}

/// `contract.rs:153-155`: the plan stores whole milliseconds, so the sub-millisecond part a modern
/// filesystem reports is rounded exactly where the host used to round it.
fn whole_ms(milliseconds: f64) -> u64 {
    if milliseconds.is_finite() && milliseconds > 0.0 { milliseconds.round() as u64 } else { 0 }
}

/// The inverse of [`whole_ms`], for the `utimes` pair.
fn system_time_from_ms(milliseconds: u64) -> SystemTime {
    UNIX_EPOCH
        .checked_add(Duration::from_millis(milliseconds))
        .unwrap_or(UNIX_EPOCH)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_system::{NoopEventSink, SnfRunControl, ContinueThroughRunControl};
    use crate::host_surface::CheckpointOutcome;

    /// An artist folder holding two numbered category folders, the shape `scan` walks.
    fn fixture_artist(root: &std::path::Path) -> std::path::PathBuf {
        let artist = root.join("Artist");
        fs::create_dir_all(artist.join("3. CG")).expect("fixture dirs");
        fs::create_dir_all(artist.join("1. Commercial")).expect("fixture dirs");
        artist
    }

    #[test]
    fn a_real_directory_lists_with_joined_child_paths() {
        let root = tempfile::tempdir().expect("tempdir");
        let artist = fixture_artist(root.path());

        let entries = StdFileSystem::new()
            .list_directory(&artist.display().to_string())
            .expect("std::fs::read_dir on a granted path");

        let mut names: Vec<String> = entries.iter().map(|entry| entry.name.clone()).collect();
        names.sort();
        assert_eq!(names, vec!["1. Commercial".to_string(), "3. CG".to_string()]);
        for entry in &entries {
            assert!(entry.is_directory, "{entry:?} is a category folder");
            assert!(entry.path.starts_with(&artist), "{} escaped the artist folder", entry.path);
        }
    }

    #[test]
    fn stat_of_a_folder_reports_the_flags_and_whole_milliseconds() {
        let root = tempfile::tempdir().expect("tempdir");
        let artist = fixture_artist(root.path());

        let info = StdFileSystem::new()
            .path_info(&artist.display().to_string())
            .expect("std::fs::metadata on a granted path");

        assert!(info.exists && info.is_directory, "{info:?}");
        assert!(info.mtime_ms > 0, "mtime is whole epoch milliseconds: {}", info.mtime_ms);
        assert_eq!(info.mtime_ms % 1, 0, "the u64 field cannot carry a fraction");
    }

    #[test]
    fn an_absent_folder_is_exists_false_because_platform_ts_swallowed_the_stat() {
        let root = tempfile::tempdir().expect("tempdir");
        let absent = root.path().join("Ghost");

        let info = StdFileSystem::new()
            .path_info(&absent.display().to_string())
            .expect("a missing folder is data, not a refusal");

        assert!(!info.exists && !info.is_directory);
        assert_eq!((info.atime_ms, info.mtime_ms), (0, 0));
    }

    #[test]
    fn a_rename_moves_the_folder_and_a_failed_rename_keeps_a_code() {
        let root = tempfile::tempdir().expect("tempdir");
        let artist = fixture_artist(root.path());
        let source = artist.join("3. CG");
        let target = artist.join("2. CG");
        let filesystem = StdFileSystem::new();

        filesystem
            .rename_folder(&source.display().to_string(), &target.display().to_string())
            .expect("std::fs::rename on granted paths");
        assert!(target.is_dir() && !source.exists(), "the renumbered folder took its place");

        let error = filesystem
            .rename_folder(&source.display().to_string(), &target.display().to_string())
            .expect_err("renaming a folder that is gone must fail");
        assert_eq!(error.code, SnfFileAccessError::NOT_FOUND_CODE, "{error}");
        assert!(error.to_string().contains("renaming"), "{error}");
    }

    #[test]
    fn keep_timestamp_reads_the_times_back_and_writes_them_to_the_target() {
        let root = tempfile::tempdir().expect("tempdir");
        let folder = root.path().join("1. CG");
        fs::create_dir_all(&folder).expect("fixture dir");
        let path = folder.display().to_string();
        let filesystem = StdFileSystem::new();
        // Whole seconds on purpose: a few filesystems truncate a sub-second utimes on a directory.
        let stamped = 1_000_000_000_000_u64;

        filesystem.set_folder_timestamps(&path, stamped, stamped).expect("std::fs::File::set_times");

        let info = filesystem.path_info(&path).expect("stat after utimes");
        assert_eq!(info.mtime_ms, stamped, "keepTimestamp kept the modification time");
    }

    #[test]
    fn the_listing_of_a_file_is_a_refusal_not_an_empty_folder() {
        let root = tempfile::tempdir().expect("tempdir");
        let file = root.path().join("notes.txt");
        fs::write(&file, b"not a folder").expect("fixture write");

        let error = StdFileSystem::new()
            .list_directory(&file.display().to_string())
            .expect_err("reading a file as a directory must fail");

        assert!(!error.is_not_found(), "the path is there, so `scan` must not skip it silently");
        assert!(error.to_string().contains("listing"), "{error}");
    }

    #[test]
    fn the_default_run_control_still_continues_without_a_host() {
        // The control plane is untouched by ADR-0071, so the non-plugin callers keep working.
        assert_eq!(ContinueThroughRunControl.checkpoint(), CheckpointOutcome::Continue);
        let _ = NoopEventSink;
    }
}
