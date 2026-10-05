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
//! trash is empty" — the failure mode ADR-0073 warns about for a refused answer.
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

use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// What the running platform's trash backend can do, read back from the backend rather than from a
/// match on the OS name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrashSupport {
    /// Items can be moved to the system trash.
    pub can_trash: bool,
    /// The trash can be enumerated (`list` / `metadata`) and its contents restored or purged.
    ///
    /// False on macOS: the inventory API is compiled out upstream, and there is no public record of an
    /// item's original path.
    pub can_inventory: bool,
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
        TrashSupport { can_trash: true, can_inventory: true, backend: "windows-shell" }
    }
    #[cfg(target_os = "macos")]
    {
        TrashSupport { can_trash: true, can_inventory: false, backend: "ns-file-manager" }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        TrashSupport { can_trash: true, can_inventory: true, backend: "freedesktop" }
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
    context.delete_all(paths).map_err(|error| describe(error, "move items to the trash"))
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
        Err(unsupported("list"))
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
        let _ = target;
        Err(unsupported("restore"))
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
        let _ = items;
        Err(unsupported("purge"))
    }
}

/// Empty the user's trash: enumerate everything, then purge it.
///
/// The most destructive call in this crate, kept apart from [`move_to_trash`] on purpose so that the
/// grant which enables "move to Trash" does not also enable "wipe the Trash".
pub fn empty_bin() -> Result<usize, TrashError> {
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
            assert!(!support.can_inventory, "macOS compiles the inventory API out upstream");
        }
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
