//! The system trash as a host capability (ADR-0064, AGENTS.md's "recycle-bin must survive as an
//! `xiranite-core` host service").
//!
//! ## Why this module exists at all
//!
//! Deletion is the one node operation that cannot be undone by the node. `filesystem.rs`'s `delete`
//! removes bytes permanently, and until now the recycle-bin route existed only inside a retired NAPI
//! addon (`native/czkawka-node/src/windows_trash.rs`, `IFileOperation`) that nothing in the live host
//! links. So a node that wanted "move to Trash" had either to shell out to `Clear-RecycleBin` /
//! `osascript` / `xdg-*` from its own `platform.ts`, or to lose undo entirely. This module is the
//! answer the migration notes promised: one implementation, owned by the host, reached through the
//! registry's `os-native` grant instead of through argv.
//!
//! ## The ceiling is per platform and it is answered, not hidden
//!
//! `trash` (crates.io 5.2.9) gates its inventory half — `list` / `metadata` / `purge_all` /
//! `restore_all` — behind `cfg(any(windows, all(unix, not(target_os = "macos"), ...)))`
//! (`trash-5.2.9/src/lib.rs:346`), so on macOS those symbols do not exist at compile time: a probe
//! that called `trash::os_limited::list()` there failed with `E0433 cannot find os_limited in trash`,
//! while `delete()` worked and landed the file in the real Trash. Measured here too: macOS keeps no
//! readable record of an item's original location — `~/.Trash/.DS_Store` stores the trashed *names*
//! (UTF-16BE, found by byte scan) and nothing resembling the source path, and the item carries only
//! `com.apple.macl` / `com.apple.provenance` extended attributes. "Put Back" is Finder's own private
//! business.
//!
//! So [`support`] reports what this machine can actually do, and the inventory calls return
//! [`TrashError::Unsupported`] on macOS instead of an empty list. An empty list would read as "the
//! trash is empty" — the failure mode ADR-0073 warns about for a refused answer. The inventory there is
//! journal-backed instead: it covers the items *this product* moved, and [`TrashSupport::inventory_scope`]
//! is how a caller says so out loud.
//!
//! ## No silent fallback
//!
//! Nothing here ever permanent-deletes on the caller's behalf: `move_to_trash` failing means the bytes
//! are still where they were. `empty_bin` is the only destructive inventory call and it is a separate
//! entry point, so a caller that grants "move to Trash" does not get "wipe the user's Trash" with it.
//!
//! ## macOS deletes through `NSFileManager`, not Finder
//!
//! `trash`'s default on macOS is `DeleteMethod::Finder`, which shells out to `osascript` — it can pop
//! an Automation permission prompt for the app bundle, makes the removal sound, and does nothing at all
//! without a running Finder (`trash-5.2.9/src/macos/mod.rs:23`). `trashItemAtURL` needs no extra
//! permission and works from any process. Its documented cost is that Finder's "Put Back" may not
//! appear for those items (`macos/mod.rs:32`, upstream issues 4 and 14) — acceptable here because this
//! module already refuses programmatic restore on macOS, and the item stays drag-back-able.
//!
//! Measured here (macOS 27, arm64) instead of assumed: **no** entry under `~/.Trash` carries a
//! `com.apple.metadata:kMDItemTrashOrigLocation` attribute — not the items removed through Finder
//! (recognisable by their `com.apple.macl`), not ours (`com.apple.provenance` only), and
//! `mdls -name kMDItemTrashOrigLocation` answers `(null)`. So the "parse the original path out of the
//! trash item's metadata" design is dead on this OS. What *is* reachable: `osascript` driving Finder from
//! a bare non-`.app` process returned the trash listing with status 0 and no Automation prompt — names
//! only. Programmatic restore on macOS would therefore have to journal each path at delete time, which is
//! its own decision and not something to bolt onto this module.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// What the running platform's trash backend can do, read back from the backend rather than from a
/// match on the OS name.
/// How far an inventory answer reaches.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrashInventoryScope {
    /// The whole bin, as the operating system presents it.
    SystemBin,
    /// Only the items this product moved there, read back from its own journal.
    OwnJournal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrashSupport {
    /// Items can be moved to the system trash.
    pub can_trash: bool,
    /// `list` / `restore` / `purge` answer, at the scope named by [`Self::inventory_scope`].
    pub can_inventory: bool,
    /// How far that inventory reaches.
    ///
    /// macOS cannot see the user's whole bin: `trash` compiles the inventory API out there, and no trash
    /// item carries a readable record of where it came from. The journal turns *our own* deletions into a
    /// restorable list, and a face must not present the two scopes as the same answer.
    pub inventory_scope: TrashInventoryScope,
    /// A short, stable name for the backend in use — the string an operator reads in a log line.
    pub backend: &'static str,
}

/// The ceiling of the platform this binary runs on.
///
/// The three arms below are the platforms `trash` itself builds for — checked by compiling this module
/// for `x86_64-pc-windows-msvc`, `x86_64-unknown-linux-gnu` and `aarch64-apple-darwin` from a scratch
/// crate. `x86_64-linux-android` is not a fourth case to handle here: `trash` 5.2.9 fails to build on it
/// (`E0433 cannot find module or crate platform`, because its own cfg set excludes ios/android yet
/// provides no module for them), so a stub arm would be code no build can ever reach.
#[must_use]
pub const fn support() -> TrashSupport {
    #[cfg(windows)]
    {
        TrashSupport {
            can_trash: true,
            can_inventory: true,
            inventory_scope: TrashInventoryScope::SystemBin,
            backend: "windows-shell",
        }
    }
    #[cfg(target_os = "macos")]
    {
        TrashSupport {
            can_trash: true,
            can_inventory: true,
            inventory_scope: TrashInventoryScope::OwnJournal,
            backend: "ns-file-manager",
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        TrashSupport {
            can_trash: true,
            can_inventory: true,
            inventory_scope: TrashInventoryScope::SystemBin,
            backend: "freedesktop",
        }
    }
}

/// Why a trash call did not happen. Data, not a panic (ADR-0068's surviving half).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrashError {
    /// This platform has no backend for that half of the API. Names which half, so a face can say why
    /// its "restore" row is greyed out instead of inventing a reason.
    Unsupported { operation: &'static str, backend: &'static str },
    /// The target does not exist, or the process cannot reach it. Nothing was moved.
    NotFound { target: String },
    /// A caller tried to trash a filesystem root. Refused before any item moved.
    TargetedRoot,
    /// Restore was blocked because the original parent already holds that name again.
    RestoreCollision { blocking: PathBuf },
    /// Everything else the backend reported, verbatim.
    Failed { message: String },
}

impl std::fmt::Display for TrashError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unsupported { operation, backend } => {
                write!(f, "the {backend:?} trash backend cannot {operation} items")
            }
            Self::NotFound { target } => write!(f, "cannot reach {target:?} to move it to the trash"),
            Self::TargetedRoot => write!(f, "refusing to trash a filesystem root"),
            Self::RestoreCollision { blocking } => {
                write!(f, "cannot restore: {:?} already occupies the original path", blocking)
            }
            Self::Failed { message } => f.write_str(message),
        }
    }
}

impl std::error::Error for TrashError {}

/// One item sitting in the trash, as the backend identified it.
#[derive(Debug, Clone)]
pub struct TrashedItem {
    name: OsString,
    original_parent: PathBuf,
    /// The backend's identifier — and on macOS the **absolute path the item was moved from**, because
    /// that is the only record of it. The bin entry's own name may be a uniqued variant of it.
    id: OsString,
    deleted_unix_secs: i64,
    size_bytes: Option<u64>,
    // macOS has no inventory API to carry a backend handle for, so the field exists to keep one shape.
    #[allow(dead_code)]
    inner: TrashItemInner,
}

impl TrashedItem {
    /// The name the item had when it was trashed.
    #[must_use]
    pub fn name(&self) -> &Path {
        Path::new(&self.name)
    }

    /// Where it came from.
    #[must_use]
    pub fn original_parent(&self) -> &Path {
        &self.original_parent
    }

    /// The backend's own identifier, opaque but stable enough to echo in a log.
    #[must_use]
    pub fn id(&self) -> std::borrow::Cow<'_, str> {
        self.id.to_string_lossy()
    }

    /// Seconds since the UNIX epoch at deletion. `None` when the backend reported no usable stamp.
    #[must_use]
    pub fn deleted_unix_secs(&self) -> Option<i64> {
        (self.deleted_unix_secs >= 0).then_some(self.deleted_unix_secs)
    }

    /// Size in bytes when the backend can state it without walking the item.
    #[must_use]
    pub fn size_bytes(&self) -> Option<u64> {
        self.size_bytes
    }
}

/// Move one path to the system trash. On failure the path is untouched — there is no permanent-delete
/// fallback hidden in here.
pub fn move_to_trash(path: &Path) -> Result<(), TrashError> {
    let owned = path.to_path_buf();
    move_all_to_trash(std::slice::from_ref(&owned))
}

/// Move several paths to the system trash in one backend call.
///
/// A refusal means the whole batch stayed put: `trash` guarantees that for `TargetedRoot` across a
/// single `delete_all`, and the per-platform backends do not remove items they rejected.
pub fn move_all_to_trash<I, T>(paths: I) -> Result<(), TrashError>
where
    I: IntoIterator<Item = T>,
    T: AsRef<Path>,
{
    let paths: Vec<PathBuf> = paths.into_iter().map(|path| path.as_ref().to_path_buf()).collect();
    // Checked here, not left to the backend, because the backends disagree: macOS answers a missing
    // file through `trashItemAtURL` with `Error::Unknown { description: "… doesn't exist." }`, while
    // the Windows and freedesktop routes produce `CouldNotAccess`. One question, one answer.
    if let Some(missing) = paths.iter().find(|path| !path.exists()) {
        return Err(TrashError::NotFound { target: missing.to_string_lossy().into_owned() });
    }
    // `mut` belongs only to the arm that mutates the context, or the Windows gate's
    // `clippy --all-targets -- -D warnings` fails on an unused `mut`.
    #[cfg(target_os = "macos")]
    let mut context = trash::TrashContext::new();
    #[cfg(not(target_os = "macos"))]
    let context = trash::TrashContext::new();
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos as _};
        context.set_delete_method(DeleteMethod::NsFileManager);
    }
    #[cfg(not(target_os = "macos"))]
    {
        context.delete_all(paths).map_err(|error| describe(error, "move items to the trash"))
    }
    #[cfg(target_os = "macos")]
    {
        move_each_with_journal(&context, &paths)
    }
}

/// One macOS trash batch at a time, for the whole process.
///
/// The bin entry a moved file lands under is discovered by diffing the directory around the call, so the
/// window between "before" and "after" has to belong to this batch alone: two concurrent moves produce
/// two new entries and no honest way to say which is whose. Measured — with three tests trashing at
/// once, the attribution failed on all of them. Same reasoning as [`crate::clipboard`]'s gate, and the
/// same limit: it serialises this process, not Finder, so a move by another application can still make
/// the diff ambiguous. That case is reported as "moved but not tracked", never guessed at.
#[cfg(target_os = "macos")]
static TRASH_MOVE_GATE: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// macOS: move one item at a time, recording each move, and undo the recorded ones on refusal.
///
/// The [`move_all_to_trash`] contract says a refusal leaves the whole batch where it was. `trash` gets
/// that by checking every path inside one `delete_all`; on macOS the inventory API is compiled out, so
/// the guarantee has to be built here — and the journal is what makes it possible, because a recorded
/// move names the exact entry to put back. Without the journal there is nothing to restore a refusal
/// from, which is why this arm records before it continues.
#[cfg(target_os = "macos")]
fn move_each_with_journal(context: &trash::TrashContext, paths: &[PathBuf]) -> Result<(), TrashError> {
    let _gate = TRASH_MOVE_GATE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let journal = journal();
    // Proven before anything is destroyed: a deletion that cannot be recorded cannot be listed,
    // restored, or rolled back, and an item silently stuck in the bin is worse than a refused call.
    journal.ensure_writable().map_err(|error| failed("open the trash journal", &error))?;
    let bin = trash_bin()?;
    let mut done: Vec<(PathBuf, String)> = Vec::new();

    for path in paths {
        let before = bin_names(&bin)?;
        if let Err(error) = context
            .delete_all(std::slice::from_ref(path))
            .map_err(|error| describe(error, "move items to the trash"))
        {
            let stranded = roll_back(&journal, &bin, &done);
            if stranded.is_empty() {
                return Err(error);
            }
            let names: Vec<String> = stranded.iter().map(|path| path.display().to_string()).collect();
            return Err(TrashError::Failed {
                message: format!(
                    "{error}; the earlier items were put back except {}: they are still in the trash",
                    names.join(", ")
                ),
            });
        }
        let after = bin_names(&bin)?;
        let Some(trash_name) = only_new_name(&before, &after) else {
            // The item is in the bin and this call cannot say which entry is it. Saying so beats
            // guessing: the caller learns the delete happened but is untracked, instead of getting a
            // journal entry that points at somebody else's file.
            return Err(TrashError::Failed {
                message: format!(
                    "moved {} to the trash but cannot tell which bin entry it is; it is not tracked for restore",
                    path.display()
                ),
            });
        };
        let trash_name = trash_name.to_string_lossy().into_owned();
        journal.record(path, &trash_name).map_err(|error| failed("record a trash move", &error))?;
        done.push((path.clone(), trash_name));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn failed(action: &str, error: &std::io::Error) -> TrashError {
    TrashError::Failed { message: format!("could not {action}: {error}") }
}

/// The directory the user's trash lives in.
#[cfg(target_os = "macos")]
fn trash_bin() -> Result<PathBuf, TrashError> {
    dirs::home_dir()
        .map(|home| home.join(".Trash"))
        .ok_or_else(|| TrashError::Failed {
            message: "this process has no home directory, so there is no trash to reach".to_string(),
        })
}

#[cfg(target_os = "macos")]
fn journal() -> crate::trash_journal::TrashJournal {
    crate::trash_journal::TrashJournal::at(&crate::config_paths::PathContext::from_environment().data_dir())
}

#[cfg(target_os = "macos")]
fn bin_names(bin: &Path) -> Result<Vec<OsString>, TrashError> {
    let entries = match std::fs::read_dir(bin) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(failed("read the trash directory", &error)),
    };
    let mut names = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| failed("read the trash directory", &error))?;
        names.push(entry.file_name());
    }
    Ok(names)
}

/// The single name that appeared between two listings, or `None` when the answer is not unique.
#[cfg(target_os = "macos")]
fn only_new_name(before: &[OsString], after: &[OsString]) -> Option<OsString> {
    let mut fresh = after.iter().filter(|name| !before.iter().any(|seen| seen == *name));
    let only = fresh.next()?;
    if fresh.next().is_some() { None } else { Some(only.clone()) }
}

/// Put back everything this batch already moved, newest first, returning what could not be restored.
///
/// Each entry carries the name the journal recorded, which is not necessarily the original file name:
/// macOS uniques a colliding entry (`report.txt` becomes `report 14.22.05.txt`), and renaming by the
/// original basename would look for a file that is not there and strand the one that is.
#[cfg(target_os = "macos")]
fn roll_back(
    journal: &crate::trash_journal::TrashJournal,
    bin: &Path,
    done: &[(PathBuf, String)],
) -> Vec<PathBuf> {
    use crate::trash_journal::EntryState;
    let mut stranded = Vec::new();
    for (original, trash_name) in done.iter().rev() {
        let source = bin.join(trash_name);
        if let Some(parent) = original.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        match std::fs::rename(&source, original) {
            Ok(()) => {
                let _ = journal.set_state(trash_name, EntryState::Restored);
            }
            Err(_) => stranded.push(original.clone()),
        }
    }
    stranded
}

/// Whether `candidate` really sits inside the bin, so no journaled name can point elsewhere.
#[cfg(target_os = "macos")]
fn inside_bin(bin: &Path, candidate: &Path) -> bool {
    match (std::fs::canonicalize(bin), candidate.canonicalize()) {
        (Ok(bin), Ok(candidate)) => candidate.starts_with(&bin),
        _ => false,
    }
}

/// Every item currently in the trash the host can see.
pub fn list() -> Result<Vec<TrashedItem>, TrashError> {
    #[cfg(not(target_os = "macos"))]
    {
        let items = trash::os_limited::list().map_err(|error| describe(error, "list the trash"))?;
        let mut out = Vec::with_capacity(items.len());
        for item in items {
            let metadata = trash::os_limited::metadata(&item).ok();
            out.push(TrashedItem {
                name: item.name.clone(),
                original_parent: item.original_parent.clone(),
                id: item.id.clone(),
                deleted_unix_secs: item.time_deleted,
                size_bytes: metadata.map(|meta| match meta.size {
                    trash::TrashItemSize::Bytes(bytes) => bytes,
                    trash::TrashItemSize::Entries(entries) => entries as u64,
                }),
                inner: TrashItemInner(item),
            });
        }
        Ok(out)
    }
    #[cfg(target_os = "macos")]
    {
        // Scope: what this product moved, read back from its own journal. The user's other trash items
        // are invisible here and `support()` says so through `inventory_scope`; an empty list from this
        // call means "we have not trashed anything that is still in the bin", never "the bin is empty".
        let bin = trash_bin()?;
        let present = bin_names(&bin)?;
        let journal = journal();
        let mut out = Vec::new();
        for entry in journal.trashed().map_err(|error| failed("read the trash journal", &error))? {
            let trash_name = OsString::from(&entry.trash_name);
            if !present.contains(&trash_name) {
                continue;
            }
            let size_bytes = std::fs::symlink_metadata(bin.join(&trash_name))
                .ok()
                .and_then(|meta| (!meta.is_dir()).then_some(meta.len()));
            out.push(TrashedItem {
                name: trash_name,
                original_parent: entry
                    .original_path
                    .parent()
                    .map(|parent| parent.to_path_buf())
                    .unwrap_or_else(|| bin.clone()),
                id: entry.original_path.into_os_string(),
                deleted_unix_secs: i64::try_from(entry.deleted_unix_secs).unwrap_or(i64::MAX),
                size_bytes,
                inner: TrashItemInner(()),
            });
        }
        Ok(out)
    }
}

/// Put an item back where it came from, returning the path it was restored to.
pub fn restore(item: &TrashedItem) -> Result<PathBuf, TrashError> {
    let target = item.original_parent.join(item.name());
    #[cfg(not(target_os = "macos"))]
    {
        trash::os_limited::restore_all([item.inner.0.clone()])
            .map_err(|error| describe(error, "restore an item"))?;
        Ok(target)
    }
    #[cfg(target_os = "macos")]
    {
        // macOS has no restore API to call, so this renames the bin entry back to the path the journal
        // recorded when it was moved. `id` carries that absolute path here, because the name inside the
        // bin can be a uniqued variant of it (`report 14.22.05.txt`) and joining that onto the original
        // parent would restore the wrong file name.
        let _ = target;
        let bin = trash_bin()?;
        let source = bin.join(&item.name);
        if !inside_bin(&bin, &source) {
            return Err(TrashError::Failed {
                message: format!("refusing to restore {}, which is not inside the trash", source.display()),
            });
        }
        if !source.exists() {
            return Err(TrashError::NotFound { target: source.to_string_lossy().into_owned() });
        }
        let landing = PathBuf::from(&item.id);
        if landing.exists() {
            return Err(TrashError::RestoreCollision { blocking: landing });
        }
        if let Some(parent) = landing.parent() {
            std::fs::create_dir_all(parent).map_err(|error| failed("recreate the original directory", &error))?;
        }
        std::fs::rename(&source, &landing).map_err(|error| failed("restore an item", &error))?;
        journal().set_state(&item.name.to_string_lossy(), crate::trash_journal::EntryState::Restored)
            .map_err(|error| failed("update the trash journal", &error))?;
        Ok(landing)
    }
}

/// Permanently remove listed trash items. Irreversible — the caller's grant, not this module's guess.
pub fn purge(items: &[TrashedItem]) -> Result<usize, TrashError> {
    #[cfg(not(target_os = "macos"))]
    {
        let count = items.len();
        if count == 0 {
            return Ok(0);
        }
        trash::os_limited::purge_all(items.iter().map(|item| &item.inner.0))
            .map_err(|error| describe(error, "purge trash items"))?;
        Ok(count)
    }
    #[cfg(target_os = "macos")]
    {
        // Purging by journaled name, never by a path a caller invented: `inside_bin` is checked per item
        // before anything is removed, so a name like `../../Documents/x` fails instead of deleting.
        let bin = trash_bin()?;
        let journal = journal();
        let mut removed = 0;
        for item in items {
            let source = bin.join(&item.name);
            if !inside_bin(&bin, &source) {
                return Err(TrashError::Failed {
                    message: format!("refusing to purge {}, which is not inside the trash", source.display()),
                });
            }
            let outcome = if source.is_dir() {
                std::fs::remove_dir_all(&source)
            } else {
                std::fs::remove_file(&source)
            };
            match outcome {
                Ok(()) => removed += 1,
                // Already gone is not a failure to report, and not a removal to count.
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(failed("purge a trash item", &error)),
            }
            journal.set_state(&item.name.to_string_lossy(), crate::trash_journal::EntryState::Purged)
                .map_err(|error| failed("update the trash journal", &error))?;
        }
        Ok(removed)
    }
}

/// Empty the user's trash: enumerate everything, then purge it.
///
/// The most destructive call in this crate, kept apart from [`move_to_trash`] on purpose so that the
/// grant which enables "move to Trash" does not also enable "wipe the Trash".
pub fn empty_bin() -> Result<usize, TrashError> {
    if cfg!(target_os = "macos") {
        // Refused on purpose even though `list` and `purge` now work: on macOS `list` sees only the
        // journal, so emptying "everything" from that list would destroy less than it claims and leave
        // the rest of the user's bin in place. The whole-bin verb needs the whole-bin view.
        return Err(unsupported("empty the whole bin"));
    }
    let items = list()?;
    purge(&items)
}

/// The wrapped backend handle, present only where an inventory API exists to need it.
#[cfg(not(target_os = "macos"))]
#[derive(Debug, Clone)]
struct TrashItemInner(trash::TrashItem);

#[cfg(target_os = "macos")]
#[derive(Debug, Clone, Copy)]
struct TrashItemInner(());

fn unsupported(operation: &'static str) -> TrashError {
    TrashError::Unsupported { operation, backend: support().backend }
}

/// Maps the backend's error into [`TrashError`], keeping its text for the log.
fn describe(error: trash::Error, action: &'static str) -> TrashError {
    match error {
        trash::Error::CouldNotAccess { target } => TrashError::NotFound { target },
        trash::Error::TargetedRoot => TrashError::TargetedRoot,
        trash::Error::RestoreCollision { path, .. } => TrashError::RestoreCollision { blocking: path },
        other => TrashError::Failed { message: format!("could not {action}: {other}") },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_running_platform_has_a_stated_backend() {
        let support = support();
        assert!(support.can_trash, "the release gate plus macOS and freedesktop all have a backend");
        assert!(!support.backend.is_empty());
        if cfg!(target_os = "macos") {
            assert_eq!(
                support.inventory_scope,
                TrashInventoryScope::OwnJournal,
                "macOS has no system inventory, so its list answer must be labelled as journal-scoped"
            );
            assert!(support.can_inventory, "the journal makes our own deletions listable and restorable");
        } else {
            assert_eq!(support.inventory_scope, TrashInventoryScope::SystemBin);
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_new_bin_entry_is_only_attributable_when_exactly_one_appeared() {
        let name = |value: &str| OsString::from(value);
        let before = vec![name("older.txt")];
        assert_eq!(
            only_new_name(&before, &[name("older.txt"), name("report.txt")]),
            Some(name("report.txt"))
        );
        assert_eq!(only_new_name(&before, &before), None, "nothing appeared");
        assert_eq!(
            only_new_name(&before, &[name("a.txt"), name("b.txt"), name("older.txt")]),
            None,
            "two appeared, so neither can be claimed"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_purged_name_must_stay_inside_the_bin() {
        let bin = tempfile::tempdir().unwrap();
        let kept = bin.path().join("report.txt");
        std::fs::write(&kept, b"x").unwrap();
        assert!(inside_bin(bin.path(), &kept), "an entry that is in the bin");
        let escape = bin.path().join("..").join("outside.txt");
        std::fs::write(&escape, b"x").unwrap();
        assert!(!inside_bin(bin.path(), &escape), "a name that walks out of the bin is refused");
        assert!(!inside_bin(bin.path(), &bin.path().join("never-existed.txt")));
    }

    #[test]
    fn an_unsupported_half_names_the_operation_and_the_backend() {
        let error = unsupported("list");
        assert!(matches!(error, TrashError::Unsupported { operation: "list", .. }));
        assert!(error.to_string().contains("list"), "{error}");
        assert!(error.to_string().contains(support().backend), "{error}");
    }

    #[test]
    fn the_backend_errors_that_a_caller_has_to_act_on_are_not_flattened() {
        assert_eq!(
            describe(trash::Error::CouldNotAccess { target: "/nope".into() }, "move items to the trash"),
            TrashError::NotFound { target: "/nope".into() }
        );
        assert_eq!(describe(trash::Error::TargetedRoot, "move items to the trash"), TrashError::TargetedRoot);
        let collision = describe(
            trash::Error::RestoreCollision {
                path: "/tmp/keep.txt".into(),
                remaining_items: Vec::new(),
            },
            "move items to the trash",
        );
        assert!(matches!(collision, TrashError::RestoreCollision { .. }), "{collision:?}");
    }

    #[test]
    fn an_unrecognized_backend_error_keeps_its_text() {
        let error = describe(trash::Error::Unknown { description: "disk busy".into() }, "list the trash");
        match error {
            TrashError::Failed { message } => {
                assert!(message.contains("list the trash"), "{message}");
                assert!(message.contains("disk busy"), "{message}");
            }
            other => panic!("expected Failed, got {other:?}"),
        }
    }
}
