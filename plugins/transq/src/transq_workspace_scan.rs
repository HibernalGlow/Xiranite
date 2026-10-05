//! Workspace discovery: the TransQ rules that decide which folders are queues.
//!
//! Ported from `platform.ts`, but split the way the AST audit's
//! `wasm-with-host-io` class requires: `platform.ts` mixed `node:fs` calls with
//! TransQ's own naming rules, and a plugin may not do the former. So every
//! `lstat`/`readdir`/`readFile` became one [`crate::transq_host::TransqHost`] call,
//! while the folder-name match, the `manga_translator_work/result` requirement, the
//! `translation_map.json` key list, the cleanup set and the final output placement
//! stay pure Rust here.

use std::collections::HashSet;

use crate::json_document::parse_json;
use crate::transq_contract::TransqDirectorySnapshot;
use crate::transq_host::{DirectoryEntryKind, DirectoryListing, TransqHost};
use crate::transq_path::{base_name, directory_name, join_path};

/// `platform.ts:37` — the queue marker, compared case-insensitively.
pub const ORIGINAL_IMAGES_DIRECTORY_NAME: &str = "original_images";
/// `platform.ts:54`.
pub const MANGA_TRANSLATOR_WORK_DIRECTORY_NAME: &str = "manga_translator_work";
/// `platform.ts:55` and `platform.ts:75`: both the work result folder and the
/// final folder a finished queue is moved into.
pub const RESULT_DIRECTORY_NAME: &str = "result";
/// `platform.ts:59` and `platform.ts:60`.
pub const TRANSLATION_MAP_FILE_NAME: &str = "translation_map.json";
/// `platform.ts:63`.
pub const INPAINTED_DIRECTORY_NAME: &str = "inpainted";
/// `platform.ts:72` — translator JSON artifacts are cleaned up after a live run.
pub const WORK_ARTIFACT_JSON_SUFFIX: &str = ".json";

/// Stack-safety bound for the recursive scan. The TypeScript original recursed
/// without one because Bun grows its JS stack; inside a bounded WASM sandbox the
/// same unbounded recursion is a trap, so a deeper tree reports no queue.
pub const MAX_SCAN_DEPTH: usize = 48;

/// `scanRoots` (`platform.ts:16-23`). Roots arrive already trimmed by
/// [`crate::transq_path::parse_transq_paths`]; the host resolves and authorizes each
/// path, so this function never re-canonicalizes.
pub fn scan_translation_workspaces(
    host: &mut dyn TransqHost,
    roots: &[String],
) -> Vec<TransqDirectorySnapshot> {
    let mut snapshots = Vec::new();
    let mut visited: HashSet<String> = HashSet::new();
    for root in roots {
        find_queues(host, root, &mut snapshots, &mut visited, 0);
    }
    snapshots
}

/// `findQueues` (`platform.ts:25-51`).
fn find_queues(
    host: &mut dyn TransqHost,
    path: &str,
    snapshots: &mut Vec<TransqDirectorySnapshot>,
    visited: &mut HashSet<String>,
    depth: usize,
) {
    if depth > MAX_SCAN_DEPTH || !visited.insert(path.to_string()) {
        return;
    }

    // A failed `lstat` or a non-directory short-circuits the walk, exactly like the
    // `try { lstat } catch { return }` guard in `platform.ts:29-35`.
    let Ok(listing) = host.list_directory(path, true) else { return };
    if !listing.kind.is_directory() {
        return;
    }

    if base_name(path).to_lowercase() == ORIGINAL_IMAGES_DIRECTORY_NAME {
        if let Some(snapshot) = inspect_original_images(host, path, &listing) {
            snapshots.push(snapshot);
        }
    }

    for entry in &listing.entries {
        if entry.kind.is_directory() {
            find_queues(host, &join_path(path, &entry.name), snapshots, visited, depth + 1);
        }
    }
}

/// `inspectOriginalImages` (`platform.ts:53-86`).
///
/// The TypeScript version spent three host round trips on the work folder
/// (`lstat(result)`, `exists(inpainted)`, `readdir(work)`); one listing answers all
/// three, so an unreadable work folder now reports "no queue" instead of "queue with
/// no result folder". Same outcome for every workspace manga-translator produces.
fn inspect_original_images(
    host: &mut dyn TransqHost,
    original_images_path: &str,
    original_images_listing: &DirectoryListing,
) -> Option<TransqDirectorySnapshot> {
    let work_path = join_path(original_images_path, MANGA_TRANSLATOR_WORK_DIRECTORY_NAME);
    let work_listing = host.list_directory(&work_path, true).ok()?;
    let has_result_folder = work_listing
        .entry(RESULT_DIRECTORY_NAME)
        .is_some_and(|listed| listed.kind == DirectoryEntryKind::Directory);
    if !has_result_folder {
        return None;
    }

    let result_path = join_path(&work_path, RESULT_DIRECTORY_NAME);
    let original_files = original_images_listing.sorted_file_names();
    let result_files = host
        .list_directory(&result_path, true)
        .map(|listing| listing.sorted_file_names())
        .unwrap_or_default()
        .into_iter()
        .filter(|name| name != TRANSLATION_MAP_FILE_NAME)
        .collect();
    let mapped_files = read_mapped_files(host, &join_path(&result_path, TRANSLATION_MAP_FILE_NAME));
    let cleanup_paths = collect_work_cleanup_paths(&work_listing, &work_path);
    let output_path = join_path(&directory_name(original_images_path), RESULT_DIRECTORY_NAME);
    let output_exists = host
        .list_directory(&output_path, false)
        .is_ok_and(|listing| listing.kind.exists());

    Some(TransqDirectorySnapshot {
        original_images_path: original_images_path.to_string(),
        result_path,
        output_path,
        output_exists,
        original_files,
        result_files,
        mapped_files,
        cleanup_paths,
    })
}

/// `platform.ts:61-73`: the inpainted folder first, then the loose JSON artifacts in
/// readdir order, because that is the order a live run removes them in.
fn collect_work_cleanup_paths(work_listing: &DirectoryListing, work_path: &str) -> Vec<String> {
    let mut cleanup_paths = Vec::new();
    if work_listing.entry(INPAINTED_DIRECTORY_NAME).is_some() {
        cleanup_paths.push(join_path(work_path, INPAINTED_DIRECTORY_NAME));
    }
    for listed in &work_listing.entries {
        if listed.kind.is_file() && listed.name.to_lowercase().ends_with(WORK_ARTIFACT_JSON_SUFFIX) {
            cleanup_paths.push(join_path(work_path, &listed.name));
        }
    }
    cleanup_paths
}

/// `readMappedFiles` (`platform.ts:118-126`): an unreadable or malformed map is not
/// an error, it just means nothing is known to be missing.
fn read_mapped_files(host: &mut dyn TransqHost, path: &str) -> Vec<String> {
    let Ok(content) = host.read_text_file(path) else { return Vec::new() };
    match parse_json(&content) {
        Ok(document) => document.sorted_unique_object_keys(),
        Err(_) => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transq_host::{DirectoryEntry, PathKind};
    use crate::transq_test_host::VirtualTransqHost;

    const CHAPTER: &str = "D:/translation/chapter";
    const ORIGINAL_IMAGES: &str = "D:/translation/chapter/original_images";
    const WORK: &str = "D:/translation/chapter/original_images/manga_translator_work";
    const RESULT: &str = "D:/translation/chapter/original_images/manga_translator_work/result";

    fn entry(name: &str, kind: DirectoryEntryKind) -> DirectoryEntry {
        DirectoryEntry { name: name.to_string(), kind }
    }

    fn file_entries(names: &[&str]) -> Vec<DirectoryEntry> {
        names.iter().map(|name| entry(name, DirectoryEntryKind::File)).collect()
    }

    fn directory_listing(path: &str, entries: Vec<DirectoryEntry>) -> DirectoryListing {
        DirectoryListing { path: path.to_string(), kind: PathKind::Directory, entries }
    }

    /// The tree behind `core.test.ts`'s fixture snapshot.
    fn populated_chapter_host() -> VirtualTransqHost {
        let mut host = VirtualTransqHost::new();
        host.add_listing(directory_listing(
            CHAPTER,
            vec![entry("original_images", DirectoryEntryKind::Directory)],
        ));
        host.add_listing(directory_listing(
            ORIGINAL_IMAGES,
            vec![
                entry("001.png", DirectoryEntryKind::File),
                entry("002.png", DirectoryEntryKind::File),
                entry("manga_translator_work", DirectoryEntryKind::Directory),
            ],
        ));
        host.add_listing(directory_listing(
            WORK,
            vec![
                entry("result", DirectoryEntryKind::Directory),
                entry("inpainted", DirectoryEntryKind::Directory),
                entry("config.yaml", DirectoryEntryKind::File),
                entry("mask_list.json", DirectoryEntryKind::File),
            ],
        ));
        host.add_listing(directory_listing(
            RESULT,
            file_entries(&["001.png", "translation_map.json"]),
        ));
        host.add_translation_map(
            RESULT,
            r#"{"001.png":"./original_images/001.png","002.png":"./original_images/002.png"}"#,
        );
        host
    }

    fn scan(host: &mut VirtualTransqHost) -> Vec<TransqDirectorySnapshot> {
        scan_translation_workspaces(host, &[CHAPTER.to_string()])
    }

    #[test]
    fn derives_the_full_snapshot_from_directory_facts() {
        let mut host = populated_chapter_host();
        let snapshots = scan(&mut host);

        assert_eq!(snapshots.len(), 1);
        let snapshot = &snapshots[0];
        assert_eq!(snapshot.original_images_path, ORIGINAL_IMAGES);
        assert_eq!(snapshot.result_path, RESULT);
        assert_eq!(snapshot.output_path, "D:/translation/chapter/result");
        assert!(!snapshot.output_exists);
        assert_eq!(snapshot.original_files, vec!["001.png".to_string(), "002.png".to_string()]);
        assert_eq!(snapshot.result_files, vec!["001.png".to_string()]);
        assert_eq!(snapshot.mapped_files, vec!["001.png".to_string(), "002.png".to_string()]);
        assert_eq!(
            snapshot.cleanup_paths,
            vec![format!("{WORK}/inpainted"), format!("{WORK}/mask_list.json")]
        );
    }

    #[test]
    fn an_original_images_folder_without_a_result_queue_is_not_a_queue() {
        let mut host = VirtualTransqHost::new();
        host.add_listing(directory_listing(
            "D:/plain/original_images",
            file_entries(&["001.png"]),
        ));

        assert!(scan_translation_workspaces(&mut host, &["D:/plain".to_string()]).is_empty());
    }

    #[test]
    fn a_result_folder_that_is_only_a_link_is_not_a_queue() {
        let mut host = VirtualTransqHost::new();
        host.add_listing(directory_listing(
            "D:/odd/original_images",
            vec![entry("manga_translator_work", DirectoryEntryKind::Directory)],
        ));
        host.add_listing(directory_listing(
            "D:/odd/original_images/manga_translator_work",
            vec![entry("result", DirectoryEntryKind::SymbolicLink)],
        ));

        assert!(scan_translation_workspaces(&mut host, &["D:/odd".to_string()]).is_empty());
    }

    #[test]
    fn a_missing_translation_map_leaves_the_map_list_empty() {
        let mut host = populated_chapter_host();
        host.remove_translation_map(RESULT);
        let snapshots = scan(&mut host);
        assert!(snapshots[0].mapped_files.is_empty());
    }

    #[test]
    fn a_malformed_translation_map_is_ignored_not_fatal() {
        let mut host = populated_chapter_host();
        host.add_translation_map(RESULT, "{ not json");
        let snapshots = scan(&mut host);
        assert!(snapshots[0].mapped_files.is_empty());
    }

    #[test]
    fn a_translation_map_that_is_a_json_array_yields_no_keys() {
        let mut host = populated_chapter_host();
        host.add_translation_map(RESULT, r#"["001.png","002.png"]"#);
        let snapshots = scan(&mut host);
        assert!(snapshots[0].mapped_files.is_empty());
    }

    #[test]
    fn the_queue_marker_is_case_insensitive() {
        let mut host = VirtualTransqHost::new();
        host.add_listing(directory_listing(
            "D:/case",
            vec![entry("Original_Images", DirectoryEntryKind::Directory)],
        ));
        host.add_listing(directory_listing(
            "D:/case/Original_Images",
            vec![entry("manga_translator_work", DirectoryEntryKind::Directory)],
        ));
        host.add_listing(directory_listing(
            "D:/case/Original_Images/manga_translator_work",
            vec![entry("result", DirectoryEntryKind::Directory)],
        ));
        host.add_listing(directory_listing(
            "D:/case/Original_Images/manga_translator_work/result",
            file_entries(&["001.png"]),
        ));

        let snapshots = scan_translation_workspaces(&mut host, &["D:/case".to_string()]);
        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0].original_images_path, "D:/case/Original_Images");
        assert_eq!(snapshots[0].result_files, vec!["001.png".to_string()]);
    }

    #[test]
    fn an_existing_output_folder_is_reported_on_the_snapshot() {
        let mut host = populated_chapter_host();
        host.add_listing(directory_listing("D:/translation/chapter/result", Vec::new()));
        let snapshots = scan(&mut host);
        assert!(snapshots[0].output_exists);
    }

    #[test]
    fn repeated_and_overlapping_roots_are_visited_once() {
        let mut host = populated_chapter_host();
        let roots = vec![CHAPTER.to_string(), CHAPTER.to_string(), "D:/translation".to_string()];
        let snapshots = scan_translation_workspaces(&mut host, &roots);

        assert_eq!(snapshots.len(), 1, "the visited set must stop a re-scan of the same path");
        assert_eq!(host.listed_paths().iter().filter(|path| *path == CHAPTER).count(), 1);
    }

    #[test]
    fn only_the_output_existence_check_skips_entry_lists() {
        let mut host = populated_chapter_host();
        scan(&mut host);
        assert_eq!(host.stat_only_lookups(), 1, "one stat for the final output folder");
        assert!(host.listed_paths().contains(&"D:/translation/chapter/result".to_string()));
    }

    #[test]
    fn scanning_stops_at_the_documented_depth_bound() {
        let mut host = VirtualTransqHost::new();
        let mut path = "D:/deep".to_string();
        host.add_listing(directory_listing(&path, vec![entry("level", DirectoryEntryKind::Directory)]));
        for _ in 0..MAX_SCAN_DEPTH + 4 {
            path = format!("{path}/level");
            host.add_listing(directory_listing(&path, vec![entry("level", DirectoryEntryKind::Directory)]));
        }
        let queue_path = format!("{path}/original_images");
        host.add_listing(directory_listing(&path, vec![entry("original_images", DirectoryEntryKind::Directory)]));
        host.add_listing(directory_listing(
            &queue_path,
            vec![entry("manga_translator_work", DirectoryEntryKind::Directory)],
        ));

        let snapshots = scan_translation_workspaces(&mut host, &["D:/deep".to_string()]);
        assert!(snapshots.is_empty(), "queues below MAX_SCAN_DEPTH are not discovered");
    }

    #[test]
    fn unreadable_directories_end_that_branch_instead_of_the_scan() {
        let mut host = populated_chapter_host();
        host.fail_next_listing(ORIGINAL_IMAGES, "EACCES: permission denied");
        let snapshots = scan(&mut host);

        assert!(snapshots.is_empty());
        assert!(host.failures_are_drained());
    }
}
