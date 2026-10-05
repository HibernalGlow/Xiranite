//! End-to-end checks for the recycle-bin host service, against the machine's **real** trash.
//!
//! Why it touches the real thing: the whole point of this service is that a node's delete becomes
//! undoable by the user in their own file manager. A fake root cannot show that — and a test that
//! asserted only `support()`'s booleans would still pass if the backend stopped moving bytes at all.
//!
//! Cost stated honestly: on macOS the item stays in `~/.Trash` afterwards, because the platform
//! compiles out any programmatic restore (see `trash_service`'s module doc). Every run adds one
//! uniquely named file there. On Windows and freedesktop platforms the item is restored and then
//! removed with the temp dir, so nothing is left behind.

use std::path::{Path, PathBuf};

use xiranite_core::trash_service::{self, TrashError};

fn unique_name(prefix: &str) -> String {
    format!("{prefix}-{}-trashprobe.txt", std::process::id())
}

fn write_trashable(dir: &Path, name: &str) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, b"probe payload - safe to trash").expect("write fixture");
    assert!(path.exists(), "the fixture must exist before the call under test");
    path
}

fn home_trash_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".Trash"))
}

#[test]
fn a_trashed_file_leaves_the_tree_and_lands_in_the_system_trash() {
    let dir = tempfile::tempdir().expect("temp dir");
    let name = unique_name("xiranite-live");
    let path = write_trashable(dir.path(), &name);

    trash_service::move_to_trash(&path).expect("the running platform has a trash backend");

    assert!(!path.exists(), "move_to_trash must remove the source");

    if let Some(trash_dir) = home_trash_dir().filter(|_| cfg!(target_os = "macos")) {
        let found = std::fs::read_dir(&trash_dir)
            .expect("read ~/.Trash")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy() == name);
        assert!(found, "{name} should be visible in {:?}", trash_dir);
    }

    if trash_service::support().can_inventory {
        let listed = trash_service::list().expect("the inventory half exists on this platform");
        let item = listed
            .iter()
            .find(|item| item.name() == Path::new(&name))
            .unwrap_or_else(|| panic!("{name} was trashed but list() did not report it"));
        assert_eq!(item.original_parent(), dir.path());

        let restored = trash_service::restore(item).expect("restore puts it back");
        assert_eq!(restored, path);
        assert!(path.exists(), "the bytes must be back at the original path");
    }
}

#[test]
fn a_path_that_is_not_there_is_reported_as_such_and_moves_nothing() {
    let dir = tempfile::tempdir().expect("temp dir");
    let missing = dir.path().join("never-written");

    let error = trash_service::move_to_trash(&missing).expect_err("nothing exists to move");

    assert!(matches!(error, TrashError::NotFound { .. }), "{error:?}");
    assert!(error.to_string().contains("never-written"), "{error}");
}

#[test]
fn the_inventory_half_is_refused_or_answers_itself_never_an_empty_maybe() {
    match trash_service::list() {
        Ok(items) => {
            assert!(trash_service::support().can_inventory, "a list came back on a platform that says it cannot list");
            for item in &items {
                assert!(!item.name().as_os_str().is_empty(), "an item with no name cannot be shown to a user");
            }
        }
        Err(TrashError::Unsupported { operation, backend }) => {
            assert_eq!(operation, "list");
            assert_eq!(backend, trash_service::support().backend);
            assert!(!trash_service::support().can_inventory, "{backend} refused but support() claims inventory");
        }
        Err(other) => panic!("unexpected failure: {other:?}"),
    }
}

#[test]
fn a_batch_that_includes_a_filesystem_root_moves_nothing() {
    let dir = tempfile::tempdir().expect("temp dir");
    let name = unique_name("xiranite-root");
    let path = write_trashable(dir.path(), &name);
    let root = PathBuf::from("/");

    let error = trash_service::move_all_to_trash([&path, &root])
        .expect_err("the root must be refused rather than removed");

    assert!(matches!(error, TrashError::TargetedRoot), "{error:?}");
    assert!(path.exists(), "a refused batch must leave every item in place");
}
