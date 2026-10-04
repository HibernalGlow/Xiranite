//! The `xiranite.fs.*` host capability service: grant enforcement, the move fallback, the text
//! ceiling, and the path helpers that must behave the same on Windows and macOS.

use std::path::{Path, PathBuf};

use xiranite_core::filesystem::{
    FileCapability, FsCapabilityError, MAX_TEXT_BYTES, is_case_insensitive_root, join_paths,
    normalize_separators, path_within,
};

fn capability(grant: &Path) -> FileCapability {
    FileCapability::new([grant])
}

fn write_file(path: &Path, contents: &str) {
    std::fs::write(path, contents).expect("fixture write");
}

/// Creates `root/<name>` as a directory and returns its path.
fn create_dir(root: &Path, name: &str) -> PathBuf {
    let path = root.join(name);
    std::fs::create_dir_all(&path).expect("fixture dir");
    path
}

#[test]
fn separators_are_collapsed_so_a_windows_spelling_resolves_on_either_os() {
    assert_eq!(normalize_separators(r"D:\Library\Artist"), "D:/Library/Artist");
    assert_eq!(normalize_separators("/already/flat"), "/already/flat");
}

#[test]
fn join_paths_drops_redundant_separators() {
    assert_eq!(join_paths(&["/library/", "/Artist/", "01.zip"]), "/library/Artist/01.zip");
    assert_eq!(join_paths(&["", "/a", "b"]), "a/b", "an empty first part does not invent a root");
    assert_eq!(join_paths(&["/", "a"]), "/a", "the root itself keeps exactly one separator");
    assert_eq!(join_paths(&[r"C:\Library", "01.zip"]), "C:/Library/01.zip");
}

#[test]
fn drive_and_unc_prefixes_are_the_case_insensitive_shapes() {
    assert!(is_case_insensitive_root(&PathBuf::from(r"C:\Library")));
    assert!(is_case_insensitive_root(&PathBuf::from("//server/share")));
    assert!(!is_case_insensitive_root(&PathBuf::from("/Users/glow/Library")));
}

#[test]
fn containment_is_component_wise_not_substring() {
    let root = PathBuf::from("/library/Artist");
    assert!(path_within(&PathBuf::from("/library/Artist/01.zip"), &root));
    assert!(path_within(&root, &root), "the root itself is inside its own grant");
    assert!(
        !path_within(&PathBuf::from("/library/ArtistArchive/01.zip"), &root),
        "a sibling whose name merely starts with the grant must not pass"
    );
    assert!(!path_within(&PathBuf::from("/library"), &root));
}

#[test]
fn a_case_insensitive_grant_matches_a_differently_cased_candidate() {
    let root = PathBuf::from("D:/Library/Artist");
    assert!(path_within(&PathBuf::from("D:/library/artist/01.zip"), &root));
}

#[test]
fn an_empty_grant_list_refuses_every_path() {
    let denied = FileCapability::denied();
    let error = denied.stat("/anything").expect_err("denied() grants nothing");
    assert_eq!(error.code(), "permission_denied");
}

#[test]
fn empty_paths_are_refused_before_any_filesystem_call() {
    let temp = tempfile::tempdir().expect("tempdir");
    let error = capability(temp.path()).stat("   ").expect_err("blank path");
    assert_eq!(error.code(), "empty_path", "a blank path is not a missing file");
}

#[test]
fn a_path_outside_the_grant_is_refused_including_by_dot_dot() {
    let temp = tempfile::tempdir().expect("tempdir");
    let grant = create_dir(temp.path(), "granted");
    let _outside = write_outside(temp.path());
    let service = capability(&grant);

    let escape = format!("{}/../outside/secret.txt", grant.display());
    let error = service.stat(&escape).expect_err("`..` must not widen the grant");
    assert_eq!(error.code(), "permission_denied");

    let absolute_outside = temp.path().join("outside").join("secret.txt");
    let error = service
        .stat(&absolute_outside.to_string_lossy())
        .expect_err("a sibling tree is not granted");
    assert_eq!(error.code(), "permission_denied");
}

fn write_outside(root: &Path) -> PathBuf {
    let outside = create_dir(root, "outside");
    write_file(&outside.join("secret.txt"), "not granted");
    outside.join("secret.txt")
}

#[test]
fn a_missing_path_reports_exists_false_rather_than_an_error() {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = capability(temp.path());
    let info = service
        .stat(&temp.path().join("nope").to_string_lossy())
        .expect("a missing file inside the grant is data, not a refusal");
    assert!(!info.exists);
    assert!(!info.is_file);
    assert!(!info.is_directory);
}

#[test]
fn stat_carries_size_and_times_for_a_real_file() {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = capability(temp.path());
    let file = temp.path().join("one.txt");
    write_file(&file, "12345");

    let info = service.stat(&file.to_string_lossy()).expect("stat");
    assert!(info.exists && info.is_file && !info.is_directory);
    assert_eq!(info.size_bytes, 5);
    assert!(info.mtime_ms > 0, "a file written now has a modification time");
}

#[test]
fn list_sorts_by_name_and_publishes_kinds_and_joined_paths() {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = capability(temp.path());
    let folder = create_dir(temp.path(), "b-folder");
    write_file(&temp.path().join("a-file.txt"), "x");

    let entries = service.list(&temp.path().to_string_lossy()).expect("list");
    let names: Vec<String> = entries.iter().map(|entry| entry.name.clone()).collect();
    assert_eq!(names, vec!["a-file.txt".to_string(), "b-folder".to_string()]);
    assert!(entries[0].is_file && !entries[1].is_file);
    assert!(entries[1].is_directory);
    assert_eq!(entries[0].path, join_paths(&[&temp.path().to_string_lossy(), "a-file.txt"]));
    assert_eq!(folder.file_name(), Some(std::ffi::OsStr::new("b-folder")));
}

#[test]
fn text_roundtrip_creates_the_parent_the_way_platform_ts_did() {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = capability(temp.path());
    let history = temp.path().join("artifacts").join("undo").join("dissolvef.undo.json");

    assert_eq!(service.read_text(&history.to_string_lossy()).expect("missing reads as None"), None);
    service.write_text(&history.to_string_lossy(), "{\"records\":[]}").expect("write");
    assert_eq!(
        service.read_text(&history.to_string_lossy()).expect("read"),
        Some("{\"records\":[]}".to_string())
    );
}

#[test]
fn oversized_documents_are_refused_instead_of_copied_into_the_plugin() {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = capability(temp.path());
    let path = temp.path().join("huge.txt");
    let oversized = "x".repeat(MAX_TEXT_BYTES as usize + 1);

    let error = service.write_text(&path.to_string_lossy(), &oversized).expect_err("ceiling");
    assert_eq!(error.code(), "text_too_large");
    assert!(!path.exists(), "a refused write must not leave a partial file");
}

#[test]
fn move_relocates_a_nested_folder_and_removes_the_source() {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = capability(temp.path());
    let source = create_dir(temp.path(), "series");
    create_dir(&source, "inner");
    write_file(&source.join("inner").join("page.txt"), "content");
    let target = temp.path().join("library").join("Artist");

    service
        .move_path(&source.to_string_lossy(), &target.to_string_lossy())
        .expect("move");
    assert!(!source.exists(), "the source is gone after a move");
    assert_eq!(
        service
            .read_text(&target.join("inner").join("page.txt").to_string_lossy())
            .expect("read moved file"),
        Some("content".to_string())
    );
    assert!(
        target.parent().is_some_and(|parent| parent.exists()),
        "the destination parent is created by the host, not the plugin"
    );
}

#[test]
fn move_refuses_a_destination_inside_the_source_folder() {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = capability(temp.path());
    let source = create_dir(temp.path(), "series");
    write_file(&source.join("page.txt"), "content");
    let target = source.join("inner");

    // `rename` of a folder into its own subtree is an EINVAL by spec, and the cross-device fallback
    // copies `from` while walking into the destination it just made inside `from`. The shape has to
    // be refused before any copy, or the source grows a nested chain of its own copies.
    let error = service
        .move_path(&source.to_string_lossy(), &target.to_string_lossy())
        .expect_err("a folder cannot be moved into itself");
    assert_eq!(error.code(), "move_into_self", "the refusal must name the shape, not the OS error");
    assert!(source.join("page.txt").exists(), "a refused move keeps the data");
    assert!(!target.exists(), "a refused move must not create anything inside the source");
}

#[test]
fn delete_refuses_a_non_empty_directory_unless_asked_recursively() {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = capability(temp.path());
    let folder = create_dir(temp.path(), "leftover");
    write_file(&folder.join("file.txt"), "x");

    let error = service.delete(&folder.to_string_lossy(), false).expect_err("non-empty");
    assert_eq!(error.code(), "delete_failed", "the OS refusal is surfaced, not swallowed");
    assert!(folder.exists(), "a refused delete keeps the data");

    service.delete(&folder.to_string_lossy(), true).expect("recursive delete");
    assert!(!folder.exists());
}

#[test]
fn ensure_dir_makes_the_whole_chain() {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = capability(temp.path());
    let deep = temp.path().join("a").join("b").join("c");

    service.ensure_dir(&deep.to_string_lossy()).expect("ensure_dir");
    let info = service.stat(&deep.to_string_lossy()).expect("stat");
    assert!(info.is_directory);
}

#[test]
fn a_new_leaf_inside_the_grant_resolves_even_though_it_does_not_exist() {
    let temp = tempfile::tempdir().expect("tempdir");
    // `resolve` canonicalizes the existing ancestor, which is what makes the grant check survive a
    // symlinked temp root (`/var` → `/private/var` on macOS) and a `..` escape alike.
    let root = temp.path().canonicalize().expect("canonical temp root");
    let service = capability(&root);
    let planned = root.join("no-parent").join("file.txt");
    let resolved = service.resolve(&planned.to_string_lossy()).expect("resolution");
    assert_eq!(resolved, planned, "the missing tail is re-appended to the canonical ancestor");
}

#[test]
fn error_codes_are_the_strings_the_plugin_envelope_carries() {
    assert_eq!(FsCapabilityError::EmptyPath.code(), "empty_path");
    assert_eq!(FsCapabilityError::NotFound.code(), "not_found");
    assert_eq!(FsCapabilityError::AlreadyExists.code(), "already_exists");
    assert_eq!(FsCapabilityError::PermissionDenied.code(), "permission_denied");
    let host = FsCapabilityError::host("list_failed", "permission denied (os error 13)");
    assert_eq!(host.code(), "list_failed");
    assert!(host.message().contains("os error 13"), "the underlying cause stays readable");
}
