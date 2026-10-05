//! Queue planning: the batch plan TransQ shows before it touches anything.
//!
//! Port of `planTransqQueue` (`core.ts:70-111`) and `summarize` (`core.ts:196-217`).
//! Both are pure: they take the host's directory facts and decide what a live run
//! would copy, clean up and move. That split is what lets the UI keep its
//! preview-by-default behaviour (`core.ts:145`) without a single filesystem call.
//!
//! Deviation recorded once, applies to every sorted name list here and in
//! `transq_host::DirectoryListing::sorted_file_names`: JavaScript's default
//! `Array.sort()` compares UTF-16 code units, Rust compares bytes (code points).
//! The two orders agree for every BMP filename and differ only for astral-plane
//! characters, which manga-translator output names do not contain.

use std::collections::HashSet;

use crate::transq_contract::{TransqCopyOperation, TransqData, TransqDirectorySnapshot, TransqQueueItem, TransqQueueStatus};
use crate::transq_path::join_path;

/// `core.ts:86-87`, spelled once so the ported tests can assert the same strings.
pub const OUTPUT_ALREADY_EXISTS_ERROR: &str = "Output already exists: ";
pub const MAPPED_ORIGINALS_MISSING_ERROR: &str = "Mapped originals are missing: ";

/// `planTransqQueue` (`core.ts:70-111`).
pub fn plan_transq_queue(snapshot: &TransqDirectorySnapshot) -> TransqQueueItem {
    let original_files: HashSet<&str> = snapshot.original_files.iter().map(String::as_str).collect();
    let result_files: HashSet<&str> = snapshot.result_files.iter().map(String::as_str).collect();
    let mapped_files: Vec<String> = unique_preserving_first(&snapshot.mapped_files);

    // Files the translation map promises but the result folder does not have.
    let mut missing_files: Vec<String> = mapped_files
        .iter()
        .filter(|filename| !result_files.contains(filename.as_str()))
        .cloned()
        .collect();
    missing_files.sort();

    // Result files the map does not mention; only meaningful once a map exists
    // (`core.ts:75`), otherwise every unmapped workspace would look suspicious.
    let mut extra_files: Vec<String> = unique_preserving_first(&snapshot.result_files)
        .into_iter()
        .filter(|filename| !mapped_files.is_empty() && !mapped_files.contains(filename))
        .collect();
    extra_files.sort();

    let absent_originals: Vec<&String> =
        missing_files.iter().filter(|filename| !original_files.contains(filename.as_str())).collect();

    let copies: Vec<TransqCopyOperation> = missing_files
        .iter()
        .filter(|filename| original_files.contains(filename.as_str()))
        .map(|filename| TransqCopyOperation {
            source_path: join_path(&snapshot.original_images_path, filename),
            destination_path: join_path(&snapshot.result_path, filename),
            filename: filename.clone(),
        })
        .collect();

    let mut errors: Vec<String> = Vec::new();
    if snapshot.output_exists {
        errors.push(format!("{OUTPUT_ALREADY_EXISTS_ERROR}{}", snapshot.output_path));
    }
    if !absent_originals.is_empty() {
        let names: Vec<&str> = absent_originals.iter().map(|filename| filename.as_str()).collect();
        errors.push(format!("{MAPPED_ORIGINALS_MISSING_ERROR}{}", names.join(", ")));
    }

    // Status precedence is `conflict > missing > pending > ready` (`core.ts:89-95`);
    // an existing output folder outranks everything because a live run must not move
    // a result on top of it.
    let status = if snapshot.output_exists {
        TransqQueueStatus::Conflict
    } else if !absent_originals.is_empty() {
        TransqQueueStatus::Missing
    } else if !missing_files.is_empty() {
        TransqQueueStatus::Pending
    } else {
        TransqQueueStatus::Ready
    };

    TransqQueueItem {
        id: snapshot.original_images_path.clone(),
        original_images_path: snapshot.original_images_path.clone(),
        result_path: snapshot.result_path.clone(),
        output_path: snapshot.output_path.clone(),
        status,
        original_count: snapshot.original_files.len(),
        result_count: snapshot.result_files.len(),
        missing_files,
        extra_files,
        copies,
        cleanup_paths: snapshot.cleanup_paths.clone(),
        errors,
    }
}

/// The counters `runTransq` accumulates while organizing (`core.ts:155-157`,
/// `core.ts:158`), kept separate so the preview path can pass zeros (`core.ts:198-203`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TransqRunTally {
    pub copied_files: usize,
    pub deleted_originals: usize,
    pub deleted_work_items: usize,
    pub errors: Vec<String>,
}

/// `summarize` (`core.ts:196-217`).
pub fn summarize_transq_items(items: &[TransqQueueItem], tally: &TransqRunTally) -> TransqData {
    let mut errors: Vec<String> = Vec::new();
    for error in tally.errors.iter().chain(items.iter().flat_map(|item| item.errors.iter())) {
        if !errors.contains(error) {
            errors.push(error.clone());
        }
    }

    TransqData {
        items: items.to_vec(),
        pending_count: count_status(items, TransqQueueStatus::Pending),
        ready_count: count_status(items, TransqQueueStatus::Ready),
        output_count: count_status(items, TransqQueueStatus::Output),
        // `missing` shares the conflict lane because both need the user's attention
        // before a live run (`core.ts:211`).
        conflict_count: count_status(items, TransqQueueStatus::Conflict)
            + count_status(items, TransqQueueStatus::Missing),
        copied_files: tally.copied_files,
        deleted_originals: tally.deleted_originals,
        deleted_work_items: tally.deleted_work_items,
        errors,
    }
}

fn count_status(items: &[TransqQueueItem], status: TransqQueueStatus) -> usize {
    items.iter().filter(|item| item.status == status).count()
}

/// `[...new Set(values)]`: the first position of a duplicate is the one kept, which
/// is what a JS `Set` iteration order does for the arrays `platform.ts` produced.
fn unique_preserving_first(values: &[String]) -> Vec<String> {
    let mut seen: HashSet<&str> = HashSet::new();
    values
        .iter()
        .filter(|value| seen.insert(value.as_str()))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const ORIGINAL_IMAGES: &str = "D:/translation/chapter/original_images";
    const RESULT: &str = "D:/translation/chapter/original_images/manga_translator_work/result";

    /// The `core.test.ts:5-14` fixture.
    fn fixture_snapshot() -> TransqDirectorySnapshot {
        TransqDirectorySnapshot {
            original_images_path: ORIGINAL_IMAGES.to_string(),
            result_path: RESULT.to_string(),
            output_path: "D:/translation/chapter/result".to_string(),
            output_exists: false,
            original_files: vec!["001.png".to_string(), "002.png".to_string()],
            result_files: vec!["001.png".to_string()],
            mapped_files: vec!["001.png".to_string(), "002.png".to_string()],
            cleanup_paths: vec![format!("{ORIGINAL_IMAGES}/manga_translator_work/inpainted")],
        }
    }

    #[test]
    fn plans_copies_for_translation_map_files_missing_from_result() {
        let item = plan_transq_queue(&fixture_snapshot());

        assert_eq!(item.status, TransqQueueStatus::Pending);
        assert_eq!(item.missing_files, vec!["002.png".to_string()]);
        assert_eq!(
            item.copies,
            vec![TransqCopyOperation {
                filename: "002.png".to_string(),
                source_path: format!("{ORIGINAL_IMAGES}/002.png"),
                destination_path: format!("{RESULT}/002.png"),
            }]
        );
        assert_eq!(item.id, ORIGINAL_IMAGES);
        assert_eq!(item.cleanup_paths, vec![format!("{ORIGINAL_IMAGES}/manga_translator_work/inpainted")]);
        assert!(item.errors.is_empty());
    }

    #[test]
    fn keeps_an_existing_output_folder_as_a_conflict() {
        let mut snapshot = fixture_snapshot();
        snapshot.output_exists = true;
        let item = plan_transq_queue(&snapshot);

        assert_eq!(item.status, TransqQueueStatus::Conflict);
        assert_eq!(item.errors[0], format!("{}D:/translation/chapter/result", OUTPUT_ALREADY_EXISTS_ERROR));
    }

    #[test]
    fn a_conflict_outranks_missing_originals() {
        let mut snapshot = fixture_snapshot();
        snapshot.output_exists = true;
        snapshot.original_files = Vec::new();
        let item = plan_transq_queue(&snapshot);

        assert_eq!(item.status, TransqQueueStatus::Conflict);
        assert_eq!(item.errors.len(), 2);
        assert_eq!(item.errors[1], "Mapped originals are missing: 002.png");
    }

    #[test]
    fn a_mapped_file_with_no_original_anywhere_is_a_missing_queue() {
        let mut snapshot = fixture_snapshot();
        snapshot.original_files = vec!["001.png".to_string()];
        snapshot.mapped_files.push("003.png".to_string());
        let item = plan_transq_queue(&snapshot);

        assert_eq!(item.status, TransqQueueStatus::Missing);
        assert_eq!(item.missing_files, vec!["002.png".to_string(), "003.png".to_string()]);
        assert_eq!(item.errors, vec!["Mapped originals are missing: 002.png, 003.png".to_string()]);
        assert!(item.copies.is_empty(), "002.png has no original to copy");
    }

    #[test]
    fn a_complete_result_is_ready() {
        let mut snapshot = fixture_snapshot();
        snapshot.result_files.push("002.png".to_string());
        let item = plan_transq_queue(&snapshot);

        assert_eq!(item.status, TransqQueueStatus::Ready);
        assert!(item.missing_files.is_empty());
        assert_eq!(item.original_count, 2);
        assert_eq!(item.result_count, 2);
    }

    #[test]
    fn extra_result_files_are_only_reported_when_a_map_exists() {
        let mut snapshot = fixture_snapshot();
        snapshot.result_files.push("stray.png".to_string());
        let with_map = plan_transq_queue(&snapshot);
        assert_eq!(with_map.extra_files, vec!["stray.png".to_string()]);

        snapshot.mapped_files = Vec::new();
        snapshot.result_files = vec!["001.png".to_string()];
        let without_map = plan_transq_queue(&snapshot);
        assert!(without_map.extra_files.is_empty());
        assert_eq!(without_map.status, TransqQueueStatus::Ready);
    }

    #[test]
    fn name_lists_are_sorted_and_deduplicated() {
        let snapshot = TransqDirectorySnapshot {
            original_images_path: "D:\\c\\original_images".to_string(),
            result_path: "D:\\c\\original_images\\manga_translator_work\\result".to_string(),
            output_path: "D:\\c\\result".to_string(),
            output_exists: false,
            original_files: vec!["010.png".to_string(), "002.png".to_string()],
            result_files: Vec::new(),
            mapped_files: vec!["010.png".to_string(), "002.png".to_string(), "010.png".to_string()],
            cleanup_paths: Vec::new(),
        };
        let item = plan_transq_queue(&snapshot);

        assert_eq!(item.missing_files, vec!["002.png".to_string(), "010.png".to_string()]);
        assert_eq!(item.original_count, 2);
        assert_eq!(item.copies[0].source_path, "D:\\c\\original_images\\002.png");
    }

    #[test]
    fn counters_split_missing_into_the_conflict_lane() {
        let items = vec![
            item_with_status(TransqQueueStatus::Pending),
            item_with_status(TransqQueueStatus::Ready),
            item_with_status(TransqQueueStatus::Output),
            item_with_status(TransqQueueStatus::Conflict),
            item_with_status(TransqQueueStatus::Missing),
        ];
        let data = summarize_transq_items(&items, &TransqRunTally::default());

        assert_eq!((data.pending_count, data.ready_count, data.output_count, data.conflict_count), (1, 1, 1, 2));
        assert_eq!(
            data.errors,
            vec![
                "lane: pending".to_string(),
                "lane: ready".to_string(),
                "lane: output".to_string(),
                "lane: conflict".to_string(),
                "lane: missing".to_string(),
            ]
        );
    }

    #[test]
    fn error_lists_are_deduplicated_with_tally_errors_first() {
        let mut tally = TransqRunTally::default();
        tally.errors.push("shared failure".to_string());
        tally.errors.push("shared failure".to_string());
        let items = vec![item_with_status(TransqQueueStatus::Pending)];
        let data = summarize_transq_items(&items, &tally);

        assert_eq!(data.errors, vec!["shared failure".to_string(), "lane: pending".to_string()]);
    }

    #[test]
    fn empty_data_matches_the_status_action_payload() {
        let data = TransqData::empty();
        assert!(data.items.is_empty() && data.errors.is_empty());
        assert_eq!(
            (data.pending_count, data.ready_count, data.output_count, data.conflict_count, data.copied_files, data.deleted_originals, data.deleted_work_items),
            (0, 0, 0, 0, 0, 0, 0)
        );
    }

    fn item_with_status(status: TransqQueueStatus) -> TransqQueueItem {
        TransqQueueItem {
            id: "D:/c/original_images".to_string(),
            original_images_path: "D:/c/original_images".to_string(),
            result_path: "D:/c/original_images/manga_translator_work/result".to_string(),
            output_path: "D:/c/result".to_string(),
            status,
            original_count: 0,
            result_count: 0,
            missing_files: Vec::new(),
            extra_files: Vec::new(),
            copies: Vec::new(),
            cleanup_paths: Vec::new(),
            errors: vec![format!("lane: {}", status.as_str())],
        }
    }
}
