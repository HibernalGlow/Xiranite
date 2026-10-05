//! Artist-folder discovery and the renumbering plan.
//!
//! Mirrors `collectArtistFolders` (`core.ts:118-132`) and `planArtistFolder`
//! (`core.ts:134-171`). Two behaviours are easy to lose in a port and both are
//! asserted in `packages/nodes/snf/src/core.test.ts`, so they are called out here:
//! keyword priority only applies once a sequence is *not* continuous, and the
//! conflict set is case-insensitive over the directory entries that exist *before*
//! any rename, extended by each newly planned target.

use std::collections::HashSet;

use crate::contract::{
    NormalizedSnfInput, PLAN_REASON_NO_NUMBERED_FOLDERS, PLAN_REASON_TARGET_NAME_EXISTS, SnfDirEntry,
    SnfPlanItem, SnfPlanStatus, SnfMode,
};
use crate::file_system::{SnfFileAccessError, SnfFileSystem};
use crate::folder_sequence::{
    NumberedFolderName, is_continuous_sequence, parse_numbered_folder_name, priority_keyword_rank,
};
use crate::javascript_text::lower_case_like_javascript;
use crate::path_tools::{folder_name, join_folder_path, parent_directory};

/// `collectArtistFolders`. A library root with no subfolders is treated as one
/// artist folder (`core.ts:129`), and a path that is missing or not a directory is
/// skipped silently.
pub fn collect_artist_folders(
    input: &NormalizedSnfInput,
    file_system: &dyn SnfFileSystem,
) -> Result<Vec<String>, SnfFileAccessError> {
    let mut folders: Vec<String> = Vec::new();
    for path in &input.paths {
        let info = file_system.path_info(path)?;
        if !info.exists || !info.is_directory {
            continue;
        }
        if input.mode == SnfMode::Artist {
            push_unique(&mut folders, path.clone());
            continue;
        }
        let children = file_system.list_directory(path)?;
        let artist_children: Vec<SnfDirEntry> = children.into_iter().filter(|entry| entry.is_directory).collect();
        if artist_children.is_empty() {
            push_unique(&mut folders, path.clone());
        } else {
            for entry in artist_children {
                push_unique(&mut folders, entry.path);
            }
        }
    }
    Ok(folders)
}

/// `[...new Set(folders)]` (`core.ts:131`): first occurrence wins.
fn push_unique(values: &mut Vec<String>, value: String) {
    if !values.iter().any(|existing| *existing == value) {
        values.push(value);
    }
}

/// `planArtistFolder`, including its two `runtime.join`/`dirname`/`basename` uses
/// which are pure here (`crate::path_tools`).
pub fn plan_artist_folder(
    artist_path: &str,
    input: &NormalizedSnfInput,
    file_system: &dyn SnfFileSystem,
) -> Result<Vec<SnfPlanItem>, SnfFileAccessError> {
    let entries: Vec<SnfDirEntry> = file_system
        .list_directory(artist_path)?
        .into_iter()
        .filter(|entry| entry.is_directory)
        .collect();

    let numbered: Vec<NumberedFolder> = entries
        .iter()
        .filter_map(|entry| {
            parse_numbered_folder_name(&entry.name).map(|parsed| NumberedFolder {
                entry: entry.clone(),
                parsed,
            })
        })
        .collect();

    if numbered.is_empty() {
        let name = folder_name(artist_path);
        return Ok(vec![SnfPlanItem {
            artist_path: artist_path.to_string(),
            source_path: artist_path.to_string(),
            target_path: artist_path.to_string(),
            source_name: name.clone(),
            target_name: name,
            sequence: None,
            status: SnfPlanStatus::Skipped,
            reason: Some(PLAN_REASON_NO_NUMBERED_FOLDERS.to_string()),
        }]);
    }

    let mut sorted_by_number = numbered.clone();
    sorted_by_number.sort_by_key(|folder| folder.parsed.sequence_number);
    let numbers: Vec<u64> = sorted_by_number
        .iter()
        .map(|folder| folder.parsed.sequence_number)
        .collect();

    if is_continuous_sequence(&numbers) {
        return Ok(sorted_by_number
            .into_iter()
            .map(|folder| SnfPlanItem {
                artist_path: artist_path.to_string(),
                source_path: folder.entry.path.clone(),
                target_path: folder.entry.path,
                source_name: folder.entry.name.clone(),
                target_name: folder.entry.name,
                sequence: Some(folder.parsed.sequence_number),
                status: SnfPlanStatus::Unchanged,
                reason: None,
            })
            .collect());
    }

    let mut planned_order = numbered;
    planned_order.sort_by(|left, right| {
        priority_keyword_rank(
            &left.parsed.folder_label,
            &input.priority_keywords,
        )
        .cmp(&priority_keyword_rank(
            &right.parsed.folder_label,
            &input.priority_keywords,
        ))
        .then(
            left.parsed
                .sequence_number
                .cmp(&right.parsed.sequence_number),
        )
    });

    // The taken-name set is seeded with every directory in the artist folder and
    // grows with each planned target, so a plan never contains two folders with the
    // same case-insensitive name.
    let mut taken_names: HashSet<String> = entries
        .iter()
        .map(|entry| lower_case_like_javascript(&entry.name))
        .collect();

    let mut items = Vec::with_capacity(planned_order.len());
    for (index, folder) in planned_order.into_iter().enumerate() {
        let target_name = format!("{}. {}", index + 1, folder.parsed.folder_label);
        let target_path = join_folder_path(&parent_directory(&folder.entry.path), &target_name);
        let sequence = u64::try_from(index + 1).unwrap_or(u64::MAX);
        let lower_cased_target = lower_case_like_javascript(&target_name);
        let (status, reason, target_path) = if target_name == folder.entry.name {
            (SnfPlanStatus::Unchanged, None, folder.entry.path.clone())
        } else if taken_names.contains(&lower_cased_target) {
            (SnfPlanStatus::Conflict, Some(PLAN_REASON_TARGET_NAME_EXISTS.to_string()), target_path)
        } else {
            taken_names.insert(lower_cased_target);
            (SnfPlanStatus::Ready, None, target_path)
        };
        items.push(SnfPlanItem {
            artist_path: artist_path.to_string(),
            source_path: folder.entry.path,
            target_path,
            source_name: folder.entry.name,
            target_name,
            sequence: Some(sequence),
            status,
            reason,
        });
    }
    Ok(items)
}

#[derive(Debug, Clone)]
struct NumberedFolder {
    entry: SnfDirEntry,
    parsed: NumberedFolderName,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::input_normalization::normalize_snf_input;
    use crate::memory_file_system::MemoryFileSystem;

    fn normalized(raw: &str) -> NormalizedSnfInput {
        normalize_snf_input(&serde_json::from_str(raw).expect("input json"))
    }

    #[test]
    fn a_library_root_with_directories_yields_each_of_them() {
        let file_system = MemoryFileSystem::new()
            .with_directory("/library", &[("Artist", true), ("Other", true), ("notes.txt", false)])
            .with_directory("/library/Artist", &[("1. CG", true)])
            .with_directory("/library/Other", &[("2. CG", true)]);
        let input = normalized(r#"{"paths":["/library"],"mode":"library"}"#);
        assert_eq!(
            collect_artist_folders(&input, &file_system).expect("folders"),
            vec!["/library/Artist".to_string(), "/library/Other".to_string()]
        );
    }

    #[test]
    fn a_root_without_subdirectories_is_its_own_artist_folder() {
        let file_system = MemoryFileSystem::new().with_directory("/library", &[("notes.txt", false)]);
        let input = normalized(r#"{"paths":["/library"]}"#);
        assert_eq!(
            collect_artist_folders(&input, &file_system).expect("folders"),
            vec!["/library".to_string()]
        );
    }

    #[test]
    fn artist_mode_uses_the_given_paths_and_skips_missing_ones() {
        let file_system = MemoryFileSystem::new().with_directory("/library/Artist", &[("1. CG", true)]);
        let input = normalized(r#"{"paths":["/library/Artist","/library/Ghost"],"mode":"artist"}"#);
        assert_eq!(
            collect_artist_folders(&input, &file_system).expect("folders"),
            vec!["/library/Artist".to_string()]
        );
    }

    #[test]
    fn overlapping_paths_are_collected_once() {
        let file_system = MemoryFileSystem::new().with_directory("/library", &[("Artist", true)]);
        let input = normalized(r#"{"paths":["/library"],"listText":"/library,/library"}"#);
        assert_eq!(collect_artist_folders(&input, &file_system).expect("folders").len(), 1);
    }

    #[test]
    fn a_folder_without_numbered_children_is_one_skipped_item() {
        let file_system = MemoryFileSystem::new().with_directory("/library/Artist", &[("Sketches", true)]);
        let items = plan_artist_folder(
            "/library/Artist",
            &normalized(r#"{"mode":"artist"}"#),
            &file_system,
        )
        .expect("plan");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].status, SnfPlanStatus::Skipped);
        assert_eq!(items[0].reason.as_deref(), Some("no_numbered_folders"));
        assert_eq!(items[0].source_name, "Artist");
        assert_eq!(items[0].target_name, "Artist");
        assert_eq!(items[0].source_path, "/library/Artist");
    }

    #[test]
    fn a_continuous_sequence_is_left_alone_even_when_the_labels_would_reorder() {
        let file_system = MemoryFileSystem::new()
            .with_directory("/library/Artist", &[("1. 同人志", true), ("2. CG", true)]);
        let items = plan_artist_folder("/library/Artist", &normalized("{}"), &file_system).expect("plan");
        assert_eq!(items.len(), 2);
        assert!(items.iter().all(|item| item.status == SnfPlanStatus::Unchanged));
        assert_eq!(items[0].sequence, Some(1));
    }

    #[test]
    fn a_gap_is_reprioritised_and_renumbered_from_one() {
        let file_system = MemoryFileSystem::new()
            .with_directory("/library/Artist", &[("3. CG", true), ("9. 同人志", true)]);
        let items = plan_artist_folder("/library/Artist", &normalized("{}"), &file_system).expect("plan");
        assert_eq!(
            items
                .iter()
                .map(|item| (item.sequence, item.target_name.as_str(), item.status))
                .collect::<Vec<_>>(),
            vec![
                (Some(1), "1. 同人志", SnfPlanStatus::Ready),
                (Some(2), "2. CG", SnfPlanStatus::Ready),
            ]
        );
        assert_eq!(items[0].target_path, "/library/Artist/1. 同人志");
    }

    #[test]
    fn a_target_name_that_already_exists_is_a_conflict_not_a_rename() {
        let file_system = MemoryFileSystem::new().with_directory(
            "/library/Artist",
            &[("3. CG", true), ("2. CG", true), ("9. 同人志", true)],
        );
        let items = plan_artist_folder("/library/Artist", &normalized("{}"), &file_system).expect("plan");
        let conflict = items
            .iter()
            .find(|item| item.status == SnfPlanStatus::Conflict)
            .expect("a conflict");
        assert_eq!(conflict.reason.as_deref(), Some("target_name_exists"));
    }

    #[test]
    fn conflict_detection_ignores_case() {
        let file_system =
            MemoryFileSystem::new().with_directory("/library/Artist", &[("3. CG", true), ("1. cg", true)]);
        let items = plan_artist_folder("/library/Artist", &normalized("{}"), &file_system).expect("plan");
        assert_eq!(
            items.iter().filter(|item| item.status == SnfPlanStatus::Conflict).count(),
            1,
            "`1. cg` already occupies the first target slot"
        );
    }

    #[test]
    fn a_target_equal_to_its_own_name_is_unchanged() {
        let file_system = MemoryFileSystem::new().with_directory(
            "/library/Artist",
            &[("1. 同人志", true), ("3. CG", true), ("2. CG", true)],
        );
        let items = plan_artist_folder("/library/Artist", &normalized("{}"), &file_system).expect("plan");
        assert!(
            items
                .iter()
                .any(|item| item.status == SnfPlanStatus::Unchanged && item.sequence == Some(1)),
            "{items:?}"
        );
    }

    #[test]
    fn a_refused_listing_surfaces_as_an_error_for_the_caller() {
        let file_system = MemoryFileSystem::new().with_failing_listing("/library/Artist", "EACCES: permission denied");
        let error = plan_artist_folder("/library/Artist", &normalized("{}"), &file_system)
            .expect_err("listing must fail");
        assert_eq!(error.to_string(), "EACCES: permission denied");
    }
}
