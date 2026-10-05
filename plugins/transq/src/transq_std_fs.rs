//! The file half of [`crate::transq_host::TransqHost`], served by `std::fs`.
//!
//! ADR-0071 retired the `xiranite.fs.*` host functions: the host enables WASI on this plugin and
//! preopens the roots the manifest authorizes, so the organizer's machine touches
//! (`lstat`/`readdir`/`readFile`/`copyFile`/`rename`/`rm` of `platform.ts`) are ordinary
//! [`std::fs`] calls against the paths the operation was given. Containment is the engine's job —
//! a path outside a preopen comes back `NotFound`, and a write into a `ro:` preopen comes back
//! `Unsupported` — so nothing here re-implements an authorization check the sandbox already does.
//!
//! Positional access is available for free (`File::seek` + `read_exact`), which is why no bulk byte
//! buffer crosses a JSON envelope any more; TransQ still only reads the small UTF-8
//! `translation_map.json`, because that document *is* its work.
//!
//! This type implements the file methods as inherent methods rather than the whole trait, because
//! `emit` and `checkpoint` stay host calls (product semantics, ADR-0071 decision 4). The Extism shim
//! in [`crate::plugin`] composes the two halves. Staying target-independent also means the behaviour
//! below is tested against a real filesystem instead of only inside an isolate.

use std::fs;
use std::io::{self, ErrorKind};
use std::path::{Path, PathBuf};

use crate::transq_host::{DirectoryEntry, DirectoryEntryKind, DirectoryListing, HostCallError, PathKind};
use crate::transq_path::directory_name;

/// [`std::fs`] behind the file methods of [`crate::transq_host::TransqHost`].
#[derive(Debug, Clone, Copy, Default)]
pub struct StdFilesystem;

impl StdFilesystem {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }

    /// `readdir(path, { withFileTypes: true })` plus the `lstat`/`access` of `path` itself
    /// (`platform.ts:25-51`, `platform.ts:109-143`) in one call.
    ///
    /// A path with no metadata at all reports [`PathKind::Missing`] with no entries, because
    /// `platform.ts:29-35` turned a failed `lstat` into "not a directory" rather than a thrown
    /// error. A directory that *is* there but cannot be listed is an error, which every caller
    /// already short-circuits on.
    pub fn list_directory(&self, path: &str, include_entries: bool) -> Result<DirectoryListing, HostCallError> {
        let target = Path::new(path);
        let kind = path_kind(target);
        // `includeEntries == false` is the existence-only case (`platform.ts:64`, `platform.ts:80`),
        // and a missing path has nothing to enumerate, so both stop here.
        if kind == PathKind::Missing || !include_entries {
            return Ok(DirectoryListing { path: path.to_string(), kind, entries: Vec::new() });
        }

        let listed = fs::read_dir(target).map_err(|error| io_failure("listing directory", path, &error))?;
        let mut entries = Vec::new();
        for entry in listed {
            let entry = entry.map_err(|error| io_failure("listing directory", path, &error))?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let file_type = entry
                .file_type()
                .map_err(|error| io_failure("classifying entry", &name, &error))?;
            entries.push(DirectoryEntry { name, kind: DirectoryEntryKind::from_file_type(&file_type) });
        }
        Ok(DirectoryListing { path: path.to_string(), kind, entries })
    }

    /// `readFile(path, "utf8")` (`platform.ts:118-126`). Only small UTF-8 documents reach the
    /// caller; media bytes never do, which was already true when this went through a host function.
    pub fn read_text_file(&self, path: &str) -> Result<String, HostCallError> {
        fs::read_to_string(path).map_err(|error| io_failure("reading", path, &error))
    }

    /// `mkdir(dirname(destination), {recursive:true})` then `copyFile` (`platform.ts:88-91`).
    pub fn copy_file(&self, source_path: &str, destination_path: &str) -> Result<(), HostCallError> {
        ensure_parent(destination_path)?;
        fs::copy(source_path, destination_path)
            .map_err(|error| io_failure("copying", &format!("{source_path} -> {destination_path}"), &error))?;
        Ok(())
    }

    /// `rename` with the `EXDEV` copy-and-remove fallback (`platform.ts:93-103`).
    pub fn move_directory(&self, source_path: &str, destination_path: &str) -> Result<(), HostCallError> {
        ensure_parent(destination_path)?;
        let pair = format!("{source_path} -> {destination_path}");
        match fs::rename(source_path, destination_path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::CrossesDevices => {
                copy_tree(source_path, destination_path)
                    .map_err(|inner| io_failure("copying across devices", &pair, &inner))?;
                remove_tree(source_path).map_err(|inner| io_failure("removing after a cross-device copy", source_path, &inner))
            }
            Err(error) => Err(io_failure("renaming", &pair, &error)),
        }
    }

    /// `rm(path, { recursive: true, force: true })` (`platform.ts:105-107`). `force` makes an absent
    /// path a success, which is what a live run needs when the work folder is already gone.
    pub fn remove_path(&self, path: &str) -> Result<(), HostCallError> {
        remove_tree(path).map_err(|error| io_failure("removing", path, &error))
    }
}

/// A refusal in the shape `platform.ts`'s `error.message` had: the operation plus the OS text.
///
/// This is what lands in `TransqQueueItem.errors`, so the wording stays human-readable rather than
/// becoming a bare code (`core.ts:178-181`).
fn io_failure(operation: &str, path: &str, error: &io::Error) -> HostCallError {
    HostCallError::new(format!("{operation} {path} failed: {error}"))
}

/// `lstat`-shaped classification of one path, with the `platform.ts` quirk preserved: a symlink is
/// never followed for the directory check, but a *broken* symlink counts as missing because
/// `fs.access` resolved its target (`platform.ts:128-143`).
fn path_kind(path: &Path) -> PathKind {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return PathKind::Missing;
    };
    if meta.file_type().is_symlink() {
        return if fs::metadata(path).is_ok() { PathKind::SymbolicLink } else { PathKind::Missing };
    }
    if meta.is_dir() {
        return PathKind::Directory;
    }
    if meta.is_file() {
        return PathKind::File;
    }
    PathKind::Missing
}

/// `mkdir(dirname(path), { recursive: true })` before a write that assumes the parent exists.
fn ensure_parent(path: &str) -> Result<(), HostCallError> {
    let parent = directory_name(path);
    if parent.is_empty() || parent == "." {
        return Ok(());
    }
    fs::create_dir_all(&parent).map_err(|error| io_failure("creating directory", &parent, &error))
}

/// The `EXDEV` fallback's recursive copy: `fs::copy` is files-only, so the tree walk lives here.
/// Mirrors `cp(..., { recursive: true, errorOnExist: true, force: false })`.
fn copy_tree(source: &str, destination: &str) -> io::Result<()> {
    let source_path = Path::new(source);
    let meta = fs::symlink_metadata(source_path)?;
    if meta.is_file() {
        fs::copy(source_path, destination)?;
        return Ok(());
    }
    if meta.file_type().is_symlink() {
        return Err(io::Error::new(
            ErrorKind::Unsupported,
            format!("copying the symlink {source} across devices is not supported"),
        ));
    }
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source_path)? {
        let entry = entry?;
        let child_destination = PathBuf::from(destination).join(entry.file_name());
        if child_destination.symlink_metadata().is_ok() {
            return Err(io::Error::new(
                ErrorKind::AlreadyExists,
                format!("{} already exists", child_destination.display()),
            ));
        }
        let child_source = entry.path().display().to_string();
        match entry.file_type()? {
            file_type if file_type.is_dir() => copy_tree(&child_source, &child_destination.display().to_string())?,
            file_type if file_type.is_file() => {
                fs::copy(entry.path(), child_destination)?;
            }
            _ => {
                return Err(io::Error::new(
                    ErrorKind::Unsupported,
                    format!("cannot copy {}", entry.path().display()),
                ));
            }
        }
    }
    Ok(())
}

/// `rm -rf`: a directory loses its whole tree, anything else loses one entry, and absence is fine.
fn remove_tree(path: &str) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
        Ok(meta) if meta.is_dir() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
    }
}

impl DirectoryEntryKind {
    /// [`std::fs::FileType`] to the four kinds the scan distinguishes. `DirEntry::file_type()` is
    /// `lstat` based, so a symlink stays a symlink and is never descended into.
    #[must_use]
    pub fn from_file_type(file_type: &fs::FileType) -> Self {
        if file_type.is_symlink() {
            DirectoryEntryKind::SymbolicLink
        } else if file_type.is_dir() {
            DirectoryEntryKind::Directory
        } else if file_type.is_file() {
            DirectoryEntryKind::File
        } else {
            DirectoryEntryKind::Other
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transq_path::join_path;
    use crate::transq_workspace_scan::{
        MANGA_TRANSLATOR_WORK_DIRECTORY_NAME, ORIGINAL_IMAGES_DIRECTORY_NAME, RESULT_DIRECTORY_NAME,
        TRANSLATION_MAP_FILE_NAME,
    };

    fn write(path: &Path, contents: &str) {
        fs::write(path, contents).expect("fixture write");
    }

    /// A queue tree exactly as manga-translator leaves it: the marker folder, the work folder with
    /// its result subfolder, the map file, and one loose JSON artifact to clean up.
    fn fixture_queue(root: &Path) -> PathBuf {
        let original_images = root.join("chapter-1").join(ORIGINAL_IMAGES_DIRECTORY_NAME);
        let work = original_images.join(MANGA_TRANSLATOR_WORK_DIRECTORY_NAME);
        let result = work.join(RESULT_DIRECTORY_NAME);
        fs::create_dir_all(&result).expect("fixture dirs");
        write(&original_images.join("001.png"), "original one");
        write(&original_images.join("002.png"), "original two");
        write(&result.join("001.png"), "translated one");
        write(&result.join(TRANSLATION_MAP_FILE_NAME), r#"{"002.png":"out/002.png"}"#);
        write(&work.join("stats.json"), "{}");
        original_images
    }

    #[test]
    fn listing_reports_the_directory_kind_and_its_entries() {
        let root = tempfile::tempdir().expect("tempdir");
        let original_images = fixture_queue(root.path());

        let listing = StdFilesystem::new()
            .list_directory(&original_images.display().to_string(), true)
            .expect("listing");

        assert_eq!(listing.kind, PathKind::Directory);
        assert_eq!(listing.sorted_file_names(), vec!["001.png".to_string(), "002.png".to_string()]);
        assert!(
            listing
                .entry(MANGA_TRANSLATOR_WORK_DIRECTORY_NAME)
                .is_some_and(|entry| entry.kind.is_directory()),
            "the work folder is a directory entry"
        );
    }

    #[test]
    fn an_absent_path_is_missing_rather_than_an_error() {
        let root = tempfile::tempdir().expect("tempdir");
        let absent = root.path().join("no-such-queue");

        let listing = StdFilesystem::new()
            .list_directory(&absent.display().to_string(), true)
            .expect("a missing path is data, not a refusal");

        assert_eq!(listing.kind, PathKind::Missing);
        assert!(listing.entries.is_empty());
    }

    #[test]
    fn a_file_is_not_a_directory() {
        let root = tempfile::tempdir().expect("tempdir");
        let file = root.path().join("001.png");
        write(&file, "pixels");

        let listing = StdFilesystem::new()
            .list_directory(&file.display().to_string(), false)
            .expect("stat");

        assert_eq!(listing.kind, PathKind::File);
        assert!(listing.entries.is_empty(), "includeEntries=false must not enumerate");
    }

    #[test]
    fn the_translation_map_reads_as_utf8_text() {
        let root = tempfile::tempdir().expect("tempdir");
        let original_images = fixture_queue(root.path());
        let result_path = join_path(
            &join_path(&original_images.display().to_string(), MANGA_TRANSLATOR_WORK_DIRECTORY_NAME),
            RESULT_DIRECTORY_NAME,
        );

        let text = StdFilesystem::new()
            .read_text_file(&join_path(&result_path, TRANSLATION_MAP_FILE_NAME))
            .expect("map reads");

        assert!(text.contains("002.png"), "{text}");
    }

    #[test]
    fn copy_creates_the_parent_and_streams_the_bytes_itself() {
        let root = tempfile::tempdir().expect("tempdir");
        let source = root.path().join("in").join("002.png");
        fs::create_dir_all(source.parent().expect("parent")).expect("dirs");
        write(&source, "original two");
        let destination = root.path().join("out").join("nested").join("002.png");

        StdFilesystem::new()
            .copy_file(&source.display().to_string(), &destination.display().to_string())
            .expect("copy");

        assert_eq!(fs::read_to_string(&destination).expect("read back"), "original two");
    }

    #[test]
    fn move_renames_and_creates_the_missing_parent() {
        let root = tempfile::tempdir().expect("tempdir");
        let source = root.path().join("work").join(RESULT_DIRECTORY_NAME);
        fs::create_dir_all(&source).expect("dirs");
        write(&source.join("001.png"), "translated one");
        let destination = root.path().join("chapter-1").join(RESULT_DIRECTORY_NAME);

        StdFilesystem::new()
            .move_directory(&source.display().to_string(), &destination.display().to_string())
            .expect("move");

        assert!(!source.exists(), "the work folder moved out of the way");
        assert!(destination.join("001.png").is_file(), "the queue landed in the project folder");
    }

    #[test]
    fn remove_is_recursive_and_forgiving_of_an_absent_path() {
        let root = tempfile::tempdir().expect("tempdir");
        let work = root.path().join("manga_translator_work");
        fs::create_dir_all(work.join("result")).expect("dirs");
        write(&work.join("stats.json"), "{}");

        let filesystem = StdFilesystem::new();
        filesystem.remove_path(&work.display().to_string()).expect("recursive remove");
        assert!(!work.exists());
        filesystem
            .remove_path(&root.path().join("already-gone").display().to_string())
            .expect("force remove of an absent path is success");
    }

    #[test]
    fn a_refused_operation_carries_the_os_message_not_a_bare_code() {
        let root = tempfile::tempdir().expect("tempdir");
        let absent = root.path().join("nope").join("translation_map.json");

        let error = StdFilesystem::new()
            .read_text_file(&absent.display().to_string())
            .expect_err("reading an absent map fails");

        assert!(error.message.contains("reading"), "{error}");
        assert!(error.message.contains("failed"), "{error}");
    }

    #[cfg(unix)]
    #[test]
    fn a_broken_symlink_is_missing_and_a_live_one_stays_a_symlink() {
        let root = tempfile::tempdir().expect("tempdir");
        std::os::unix::fs::symlink(root.path().join("gone"), root.path().join("broken")).expect("symlink");
        std::os::unix::fs::symlink(root.path().join("real"), root.path().join("live")).expect("symlink");
        write(&root.path().join("real"), "target");

        let filesystem = StdFilesystem::new();
        let broken = filesystem
            .list_directory(&root.path().join("broken").display().to_string(), false)
            .expect("broken");
        assert_eq!(broken.kind, PathKind::Missing);
        let live = filesystem
            .list_directory(&root.path().join("live").display().to_string(), false)
            .expect("live");
        assert_eq!(live.kind, PathKind::SymbolicLink);
    }
}
