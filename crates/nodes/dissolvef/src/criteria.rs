//! The rules that decide whether a folder qualifies, and what a collision means.
//!
//! Pure functions over paths and names ported from `core.ts:652-754` — no host call, no filesystem. Keeping
//! them apart from `plan.rs` matters for the faces too: the CLI and the TUI can explain a skip ("this folder
//! is on the blacklist") with the same function the planner used, instead of re-deriving it.
//!
//! `normalizeConflict` (`core.ts:652-655`) is the one rule `core.ts` applied in two places: `auto` means
//! "skip for files, overwrite for directories", and the direct planner needs the resolved form to decide
//! whether a directory collision merges or refuses.

use crate::contract::{
    DISSOLVEF_ARCHIVE_EXTENSIONS, DISSOLVEF_IMAGE_EXTENSIONS, DISSOLVEF_VIDEO_EXTENSIONS,
    DissolvefAction, DissolvefConflictMode, DissolvefMediaType, DissolvefMode,
    NormalizedDissolvefInput,
};
use crate::document::{DissolvefOperation, DissolvefPlanItem, DissolvefPlanStatus};
use crate::paths::{dirname_of, is_same_or_inside};

/// `normalizeConflict` (`core.ts:652-655`).
#[must_use]
pub fn normalize_conflict(
    conflict: DissolvefConflictMode,
    is_directory: bool,
) -> DissolvefConflictMode {
    if conflict == DissolvefConflictMode::Auto {
        return if is_directory { DissolvefConflictMode::Overwrite } else { DissolvefConflictMode::Skip };
    }
    conflict
}

/// `skipReasonForPath` (`core.ts:669-674`). Both lists are substring matches against the lowercased **path**,
/// not the name, which is what makes `#compare` and `同人志` catch a folder anywhere in the tree.
#[must_use]
pub fn skip_reason_for_path(path: &str, exclude: &[String], blacklist: &[&str]) -> Option<String> {
    let lower = path.to_lowercase();
    if exclude
        .iter()
        .any(|keyword| !keyword.is_empty() && lower.contains(&keyword.to_lowercase()))
    {
        return Some("excluded".to_string());
    }
    if blacklist
        .iter()
        .any(|keyword| !keyword.is_empty() && lower.contains(&keyword.to_lowercase()))
    {
        return Some("blacklisted".to_string());
    }
    None
}

/// `selectedDissolveModes` (`core.ts:676-683`).
#[must_use]
pub fn selected_dissolve_modes(input: &NormalizedDissolvefInput) -> Vec<DissolvefMode> {
    match input.action {
        DissolvefAction::Media => return vec![DissolvefMode::Media],
        DissolvefAction::Nested => return vec![DissolvefMode::Nested],
        DissolvefAction::Archive => return vec![DissolvefMode::Archive],
        _ => {}
    }
    let mut modes = Vec::new();
    if input.media {
        modes.push(DissolvefMode::Media);
    }
    if input.nested {
        modes.push(DissolvefMode::Nested);
    }
    if input.archive {
        modes.push(DissolvefMode::Archive);
    }
    modes
}

/// `filterBlockedGroups` (`core.ts:685-707`).
///
/// A group is one planned operation set — everything up to and including a `delete_dir`, or up to a skipped
/// row. If any row of a group sits inside (or contains) a path an earlier mode already claimed for deletion,
/// the whole group is dropped, which is what stops the bundled modes from dissolving the same folder twice.
#[must_use]
pub fn filter_blocked_groups(
    plan: Vec<DissolvefPlanItem>,
    blocked_paths: &[String],
) -> Vec<DissolvefPlanItem> {
    if blocked_paths.is_empty() {
        return plan;
    }
    let mut result: Vec<DissolvefPlanItem> = Vec::new();
    let mut group: Vec<DissolvefPlanItem> = Vec::new();
    for item in plan {
        let closes_group =
            item.status == DissolvefPlanStatus::Skipped || item.operation == DissolvefOperation::DeleteDir;
        group.push(item);
        if closes_group {
            flush_group(&mut group, blocked_paths, &mut result);
        }
    }
    flush_group(&mut group, blocked_paths, &mut result);
    result
}

fn flush_group(
    group: &mut Vec<DissolvefPlanItem>,
    blocked_paths: &[String],
    result: &mut Vec<DissolvefPlanItem>,
) {
    if group.is_empty() {
        return;
    }
    let blocked = group.iter().any(|item| {
        blocked_paths.iter().any(|path| {
            is_same_or_inside(&item.source_path, path)
                || (item.operation == DissolvefOperation::DeleteDir
                    && is_same_or_inside(path, &item.source_path))
        })
    });
    if blocked {
        group.clear();
    } else {
        result.append(group);
    }
}

/// `isDissolvefArchive` (`core.ts:220-222`).
#[must_use]
pub fn is_dissolvef_archive(path: &str) -> bool {
    has_extension(path, DISSOLVEF_ARCHIVE_EXTENSIONS)
}

/// `isDissolvefVideo` (`core.ts:224-226`).
#[must_use]
pub fn is_dissolvef_video(path: &str) -> bool {
    has_extension(path, DISSOLVEF_VIDEO_EXTENSIONS)
}

/// `isDissolvefImage` (`core.ts:228-230`).
#[must_use]
pub fn is_dissolvef_image(path: &str) -> bool {
    has_extension(path, DISSOLVEF_IMAGE_EXTENSIONS)
}

/// `hasExtension` (`core.ts:728-731`): a lowercased suffix test, so `ALBUM.CBR` matches.
#[must_use]
pub fn has_extension(path: &str, extensions: &[&str]) -> bool {
    let lower = path.to_lowercase();
    extensions.iter().any(|extension| lower.ends_with(extension))
}

/// `isEnabledMedia` (`core.ts:722-726`).
#[must_use]
pub fn is_enabled_media(name: &str, media_types: &[DissolvefMediaType]) -> bool {
    (media_types.contains(&DissolvefMediaType::Video) && is_dissolvef_video(name))
        || (media_types.contains(&DissolvefMediaType::Archive) && is_dissolvef_archive(name))
        || (media_types.contains(&DissolvefMediaType::Image) && is_dissolvef_image(name))
}

/// `isFirstLevel` (`core.ts:737-739`): a direct child of the root, and not the root itself.
#[must_use]
pub fn is_first_level(root: &str, candidate: &str) -> bool {
    candidate != root && dirname_of(candidate) == root
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::{
        DISSOLVEF_NESTED_BLACKLIST, DISSOLVEF_SINGLE_ARCHIVE_BLACKLIST, DissolvefInput,
        normalize_dissolvef_input,
    };
    use crate::document::skipped_plan_item;

    fn item(
        mode: DissolvefMode,
        operation: DissolvefOperation,
        source: &str,
        status: DissolvefPlanStatus,
    ) -> DissolvefPlanItem {
        DissolvefPlanItem::new(mode, operation, source, "", true, status)
    }

    #[test]
    fn extension_tables_match_core_ts() {
        assert!(is_dissolvef_archive("album.zip"));
        assert!(is_dissolvef_archive("ALBUM.CBR"));
        assert!(is_dissolvef_archive("a/b/c.7z"));
        assert!(!is_dissolvef_archive("album.rar5"));
        assert!(!is_dissolvef_archive("noextension"));
        assert!(is_dissolvef_video("clip.MKV"));
        assert!(is_dissolvef_video("clip.rmvb"));
        assert!(!is_dissolvef_video("clip.mp3"));
        assert!(is_dissolvef_image("page.JPEG"));
        assert!(is_dissolvef_image("page.tiff"));
        assert!(!is_dissolvef_image("page.svg"));
        assert!(!has_extension("x.zip", DISSOLVEF_VIDEO_EXTENSIONS));
    }


    fn media_gating_follows_the_enabled_types() {
        let all =
            vec![DissolvefMediaType::Video, DissolvefMediaType::Archive, DissolvefMediaType::Image];
        assert!(is_enabled_media("a.mp4", &all));
        assert!(is_enabled_media("a.zip", &all));
        assert!(is_enabled_media("a.png", &all));
        assert!(!is_enabled_media("a.txt", &all));
        let only_images = vec![DissolvefMediaType::Image];
        assert!(is_enabled_media("a.png", &only_images));
        assert!(!is_enabled_media("a.mp4", &only_images));
        assert!(!is_enabled_media("a.png", &[]));
    }


    fn auto_conflict_means_skip_for_files_and_overwrite_for_directories() {
        assert_eq!(
            normalize_conflict(DissolvefConflictMode::Auto, true),
            DissolvefConflictMode::Overwrite
        );
        assert_eq!(
            normalize_conflict(DissolvefConflictMode::Auto, false),
            DissolvefConflictMode::Skip
        );
        for explicit in [
            DissolvefConflictMode::Skip,
            DissolvefConflictMode::Overwrite,
            DissolvefConflictMode::Rename,
        ] {
            assert_eq!(normalize_conflict(explicit, true), explicit);
            assert_eq!(normalize_conflict(explicit, false), explicit);
        }
    }


    fn blacklist_and_exclude_are_case_insensitive_substrings_of_the_whole_path() {
        let excluded = vec!["bonus".to_string(), "".to_string()];
        assert_eq!(
            skip_reason_for_path("/lib/Bonus Pack/album", &excluded, &[]).as_deref(),
            Some("excluded")
        );
        // An empty keyword never matches (`core.ts:671`'s `keyword &&`).
        assert_eq!(skip_reason_for_path("/lib/album", &["".to_string()], &[]), None);
        assert_eq!(
            skip_reason_for_path("/lib/画集/album", &[], DISSOLVEF_NESTED_BLACKLIST).as_deref(),
            Some("blacklisted")
        );
        assert_eq!(
            skip_reason_for_path("/lib/#COMPARE/album", &[], DISSOLVEF_SINGLE_ARCHIVE_BLACKLIST).as_deref(),
            Some("blacklisted")
        );
        assert_eq!(
            skip_reason_for_path("/lib/pixiv/album", &[], DISSOLVEF_SINGLE_ARCHIVE_BLACKLIST),
            None,
            "pixiv is only on the nested blacklist"
        );
        assert_eq!(skip_reason_for_path("/lib/album", &[], DISSOLVEF_NESTED_BLACKLIST), None);
        // Exclude wins over blacklist, as the earlier `if` in `core.ts:671-672`.
        assert_eq!(
            skip_reason_for_path("/lib/画集", &["画集".to_string()], DISSOLVEF_NESTED_BLACKLIST).as_deref(),
            Some("excluded")
        );
    }


    fn first_level_is_a_direct_child_of_the_root() {
        assert!(is_first_level("/root", "/root/album"));
        assert!(is_first_level("D:\\root", "D:\\root\\album"));
        assert!(!is_first_level("/root", "/root"));
        assert!(!is_first_level("/root", "/root/album/inner"));
        assert!(!is_first_level("/root", "/other/album"));
    }


    fn mode_order_is_media_then_nested_then_archive_as_core_ts_writes_it() {
        let input = normalize_dissolvef_input(&DissolvefInput::default());
        assert_eq!(
            selected_dissolve_modes(&input),
            vec![DissolvefMode::Media, DissolvefMode::Nested, DissolvefMode::Archive]
        );
        let nested_only = normalize_dissolvef_input(&DissolvefInput {
            action: Some("nested".to_string()),
            ..DissolvefInput::default()
        });
        assert_eq!(selected_dissolve_modes(&nested_only), vec![DissolvefMode::Nested]);
        let flags = normalize_dissolvef_input(&DissolvefInput {
            media: Some(false),
            archive: Some(true),
            nested: Some(true),
            ..DissolvefInput::default()
        });
        assert_eq!(
            selected_dissolve_modes(&flags),
            vec![DissolvefMode::Nested, DissolvefMode::Archive]
        );
        let nothing = normalize_dissolvef_input(&DissolvefInput {
            media: Some(false),
            archive: Some(false),
            nested: Some(false),
            ..DissolvefInput::default()
        });
        assert!(selected_dissolve_modes(&nothing).is_empty());
    }


    fn blocked_groups_drop_the_whole_group_not_a_single_row() {
        let blocked = vec!["/root/album".to_string()];
        let plan = vec![
            item(
                DissolvefMode::Media,
                DissolvefOperation::Move,
                "/root/album/a.mp4",
                DissolvefPlanStatus::Pending,
            ),
            item(
                DissolvefMode::Media,
                DissolvefOperation::DeleteDir,
                "/root/album",
                DissolvefPlanStatus::Pending,
            ),
            item(
                DissolvefMode::Nested,
                DissolvefOperation::Move,
                "/root/other/x.png",
                DissolvefPlanStatus::Pending,
            ),
            item(
                DissolvefMode::Nested,
                DissolvefOperation::DeleteDir,
                "/root/other",
                DissolvefPlanStatus::Pending,
            ),
        ];
        let kept = filter_blocked_groups(plan.clone(), &blocked);
        assert_eq!(kept.len(), 2);
        assert_eq!(kept[0].source_path, "/root/other/x.png");
        assert_eq!(kept[1].source_path, "/root/other");

        // No blocked paths means the plan passes through untouched.
        assert_eq!(filter_blocked_groups(plan, &[]).len(), 4);

        // A row that *contains* a blocked directory also blocks its group, which is the second half of
        // `core.ts:692-696`.
        let enclosing = vec![
            item(
                DissolvefMode::Archive,
                DissolvefOperation::Move,
                "/root/x.zip",
                DissolvefPlanStatus::Pending,
            ),
            item(
                DissolvefMode::Archive,
                DissolvefOperation::DeleteDir,
                "/root",
                DissolvefPlanStatus::Pending,
            ),
        ];
        assert!(filter_blocked_groups(enclosing, &["/root/album".to_string()]).is_empty());

        // A skipped row closes a group on its own.
        let with_skip = vec![
            skipped_plan_item(DissolvefMode::Nested, "/root/album", "blacklisted", None),
            item(
                DissolvefMode::Nested,
                DissolvefOperation::Move,
                "/root/other/x",
                DissolvefPlanStatus::Pending,
            ),
        ];
        assert_eq!(filter_blocked_groups(with_skip, &blocked).len(), 1);
    }

}
