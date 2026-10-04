//! Planning: which folders qualify for which dissolution rule, and what each move would be.
//!
//! Port of `buildDissolvefPlan` and the four planners plus their helpers (`core.ts:191-427`,
//! `core.ts:607-754`). The planning pass is read-only: it calls `stat` and `list` and nothing else, which is
//! why `plan`, `preview` and `collect_archives` are the safe actions in `interaction.ts`.
//!
//! Two invariants from `core.ts` are load-bearing and easy to lose in a rewrite:
//!
//! - Directory order decides which rule claims a folder. Media and archive run deepest-first, nested runs
//!   shallowest-first, and `filter_blocked_groups` then drops a whole group whose source sits inside a
//!   directory an earlier mode already claimed (`core.ts:685-707`). `core.test.ts:68-86` pins exactly this.
//! - A `delete_dir` row is only ever emitted next to the rows that emptied the directory, so a directory with
//!   content nobody planned to move is refused by the host's non-recursive delete rather than removed.
//!
//! ADR-0066 adds one thing `core.ts` did not have: a checkpoint per directory visited and per entry
//! considered, so a scan of a large library is where pause and cancel can actually land.

use std::cmp::Ordering;

use crate::contract::{
    DISSOLVEF_NESTED_BLACKLIST, DISSOLVEF_SINGLE_ARCHIVE_BLACKLIST, DissolvefAction,
    DissolvefConflictMode, DissolvefMode, NormalizedDissolvefInput,
};
use crate::criteria::{
    filter_blocked_groups, is_dissolvef_archive, is_enabled_media, is_first_level, normalize_conflict,
    selected_dissolve_modes, skip_reason_for_path,
};
use crate::document::{
    DissolvefDirEntry, DissolvefOperation, DissolvefPlanItem, DissolvefPlanStatus, skipped_plan_item,
};
use crate::host::{
    DissolvefCheckpointRequest, DissolvefHost, DissolvefHostError, DissolvefHostResult, PHASE_SCANNING,
};
use crate::paths::{
    basename_of, dirname_of, is_same_or_inside, join_paths, path_depth, split_name, strip_extension,
};
use crate::similarity::{DissolvefSimilarityCheck, check_dissolvef_similarity, compare_names_locale_aware};

/// `buildDissolvefPlan` (`core.ts:191-212`).
pub fn build_dissolvef_plan(
    input: &NormalizedDissolvefInput,
    host: &mut dyn DissolvefHost,
) -> DissolvefHostResult<Vec<DissolvefPlanItem>> {
    if input.path.is_empty() {
        return Err(DissolvefHostError::Failure("Path is required.".to_string()));
    }
    let root = host.stat(&input.path)?;
    if !root.exists {
        return Err(DissolvefHostError::Failure(format!("Path does not exist: {}", input.path)));
    }
    if !root.is_directory {
        return Err(DissolvefHostError::Failure(format!(
            "Path is not a directory: {}",
            input.path
        )));
    }
    if input.direct || input.action == DissolvefAction::Direct {
        return plan_direct(&root.path, input, host);
    }

    let mut plan: Vec<DissolvefPlanItem> = Vec::new();
    let mut blocked_paths: Vec<String> = Vec::new();
    for mode in selected_dissolve_modes(input) {
        let raw = match mode {
            DissolvefMode::Media => plan_media(&root.path, input, host)?,
            DissolvefMode::Nested => plan_nested(&root.path, input, host)?,
            DissolvefMode::Archive => plan_archive(&root.path, input, host)?,
            // `direct` never comes out of `selected_dissolve_modes`; the branch above already handled it.
            DissolvefMode::Direct => Vec::new(),
        };
        let accepted = filter_blocked_groups(raw, &blocked_paths);
        blocked_paths.extend(
            accepted
                .iter()
                .filter(|item| {
                    item.operation == DissolvefOperation::DeleteDir
                        && item.status == DissolvefPlanStatus::Pending
                })
                .map(|item| item.source_path.clone()),
        );
        plan.extend(accepted);
    }
    Ok(plan)
}

/// `collectSingleArchivePaths` (`core.ts:214-218`) reuses the archive planner, but it does *not* go through
/// `buildDissolvefPlan`: it stats the requested path, plans over whatever the host resolved, and lets the
/// caller read the pending move rows. A path that is not there therefore fails on the first `list_dir`
/// rather than with `Path does not exist:`, which is what `core.ts` did.
pub(crate) fn plan_archive_for_collection(
    input: &NormalizedDissolvefInput,
    host: &mut dyn DissolvefHost,
) -> DissolvefHostResult<Vec<DissolvefPlanItem>> {
    let root = host.stat(&input.path)?;
    plan_archive(&root.path, input, host)
}

/// `planNested` (`core.ts:266-320`): a folder whose only content is one child folder gets that child's
/// deepest contents lifted into itself, and the child chain deleted.
fn plan_nested(
    root_path: &str,
    input: &NormalizedDissolvefInput,
    host: &mut dyn DissolvefHost,
) -> DissolvefHostResult<Vec<DissolvefPlanItem>> {
    let mut plan: Vec<DissolvefPlanItem> = Vec::new();
    let mut dirs = collect_directory_paths(root_path, host)?;
    // Shallowest first (`core.ts:268`), so an outer folder claims its chain before an inner one is asked.
    dirs.sort_by_key(|path| path_depth(path));
    let mut covered: Vec<String> = Vec::new();

    for candidate in &dirs {
        let dir = candidate.as_str();
        if covered.iter().any(|path| is_same_or_inside(dir, path)) {
            continue;
        }
        if input.protect_first_level && is_first_level(root_path, dir) {
            continue;
        }
        let blacklist: &[&str] = if input.skip_blacklist { &[] } else { DISSOLVEF_NESTED_BLACKLIST };
        if let Some(reason) = skip_reason_for_path(dir, &input.exclude, blacklist) {
            plan.push(skipped_plan_item(DissolvefMode::Nested, dir, &reason, None));
            continue;
        }

        let entries = sorted_entries(dir, host)?;
        let child_dirs: Vec<&DissolvefDirEntry> =
            entries.iter().filter(|entry| entry.is_directory).collect();
        let files: Vec<&DissolvefDirEntry> = entries.iter().filter(|entry| entry.is_file).collect();
        if child_dirs.len() != 1 || !files.is_empty() {
            continue;
        }

        let first_child = child_dirs[0];
        let similarity = dissolve_similarity_gate(input, dir, &first_child.name);
        if !similarity.passed {
            plan.push(skipped_plan_item(
                DissolvefMode::Nested,
                &first_child.path,
                "similarity_below_threshold",
                Some(similarity.similarity),
            ));
            continue;
        }

        let deepest = deepest_single_subfolder(&first_child.path, host)?;
        for item in sorted_entries(&deepest, host)? {
            let target_path = next_available_path(&join_paths(&[dir, item.name.as_str()]), host)?;
            plan.push(DissolvefPlanItem {
                similarity: Some(similarity.similarity.into()),
                ..move_row(DissolvefMode::Nested, &item.path, &target_path, item.is_directory)
            });
        }
        plan.push(DissolvefPlanItem {
            recursive_delete: Some(true),
            similarity: Some(similarity.similarity.into()),
            ..delete_dir_row(DissolvefMode::Nested, &first_child.path)
        });
        covered.push(first_child.path.clone());
    }

    Ok(plan)
}

/// `planMedia` (`core.ts:322-361`): a folder holding exactly one enabled media file and nothing else lifts it
/// to its parent.
fn plan_media(
    root_path: &str,
    input: &NormalizedDissolvefInput,
    host: &mut dyn DissolvefHost,
) -> DissolvefHostResult<Vec<DissolvefPlanItem>> {
    let mut plan: Vec<DissolvefPlanItem> = Vec::new();
    let mut dirs = collect_directory_paths(root_path, host)?;
    // Deepest first (`core.ts:324`), so an inner folder is emptied before its parent is judged.
    dirs.sort_by_key(|path| std::cmp::Reverse(path_depth(path)));

    for candidate in &dirs {
        let dir = candidate.as_str();
        if input.protect_first_level && is_first_level(root_path, dir) {
            continue;
        }
        if let Some(reason) = skip_reason_for_path(dir, &input.exclude, &[]) {
            plan.push(skipped_plan_item(DissolvefMode::Media, dir, &reason, None));
            continue;
        }

        let entries = sorted_entries(dir, host)?;
        let files: Vec<&DissolvefDirEntry> = entries.iter().filter(|entry| entry.is_file).collect();
        let child_dirs: Vec<&DissolvefDirEntry> =
            entries.iter().filter(|entry| entry.is_directory).collect();
        let media_files: Vec<&DissolvefDirEntry> = files
            .into_iter()
            .filter(|entry| is_enabled_media(&entry.name, &input.media_types))
            .collect();
        if media_files.len() != 1 || files_count(&entries) != 1 || !child_dirs.is_empty() {
            continue;
        }

        let media_file = media_files[0];
        let parent = dirname_of(dir);
        let target_path =
            next_available_path(&join_paths(&[parent.as_str(), media_file.name.as_str()]), host)?;
        plan.push(move_row(DissolvefMode::Media, &media_file.path, &target_path, false));
        plan.push(delete_dir_row(DissolvefMode::Media, dir));
    }

    Ok(plan)
}

/// `planArchive` (`core.ts:363-410`): a folder holding exactly one archive lifts it out when the archive
/// looks like the folder it was named after.
fn plan_archive(
    root_path: &str,
    input: &NormalizedDissolvefInput,
    host: &mut dyn DissolvefHost,
) -> DissolvefHostResult<Vec<DissolvefPlanItem>> {
    let mut plan: Vec<DissolvefPlanItem> = Vec::new();
    let mut dirs = collect_directory_paths(root_path, host)?;
    dirs.sort_by_key(|path| std::cmp::Reverse(path_depth(path)));

    for candidate in &dirs {
        let dir = candidate.as_str();
        if input.protect_first_level && is_first_level(root_path, dir) {
            continue;
        }
        let blacklist: &[&str] =
            if input.skip_blacklist { &[] } else { DISSOLVEF_SINGLE_ARCHIVE_BLACKLIST };
        if let Some(reason) = skip_reason_for_path(dir, &input.exclude, blacklist) {
            plan.push(skipped_plan_item(DissolvefMode::Archive, dir, &reason, None));
            continue;
        }

        let entries = sorted_entries(dir, host)?;
        let files: Vec<&DissolvefDirEntry> = entries.iter().filter(|entry| entry.is_file).collect();
        let child_dirs: Vec<&DissolvefDirEntry> =
            entries.iter().filter(|entry| entry.is_directory).collect();
        let archive_files: Vec<&DissolvefDirEntry> =
            files.into_iter().filter(|entry| is_dissolvef_archive(&entry.name)).collect();
        if archive_files.len() != 1 || files_count(&entries) != 1 || !child_dirs.is_empty() {
            continue;
        }

        let archive = archive_files[0];
        let similarity = dissolve_similarity_gate(input, dir, &strip_extension(&archive.name));
        if !similarity.passed {
            plan.push(skipped_plan_item(
                DissolvefMode::Archive,
                &archive.path,
                "similarity_below_threshold",
                Some(similarity.similarity),
            ));
            continue;
        }

        let parent = dirname_of(dir);
        let target_path =
            next_available_path(&join_paths(&[parent.as_str(), archive.name.as_str()]), host)?;
        plan.push(DissolvefPlanItem {
            similarity: Some(similarity.similarity.into()),
            ..move_row(DissolvefMode::Archive, &archive.path, &target_path, false)
        });
        plan.push(DissolvefPlanItem {
            similarity: Some(similarity.similarity.into()),
            ..delete_dir_row(DissolvefMode::Archive, dir)
        });
    }

    Ok(plan)
}

/// `planDirect` (`core.ts:412-427`): everything in the folder moves up one level, then the folder goes.
fn plan_direct(
    root_path: &str,
    input: &NormalizedDissolvefInput,
    host: &mut dyn DissolvefHost,
) -> DissolvefHostResult<Vec<DissolvefPlanItem>> {
    let mut plan: Vec<DissolvefPlanItem> = Vec::new();
    let parent = dirname_of(root_path);
    let entries = sorted_entries(root_path, host)?;
    for (index, entry) in entries.iter().enumerate() {
        checkpoint(host, PHASE_SCANNING, index, entries.len())?;
        append_direct_move(&mut plan, entry, &parent, input, host)?;
    }
    plan.push(delete_dir_row(DissolvefMode::Direct, root_path));
    Ok(plan)
}

/// `appendDirectMove` (`core.ts:429-479`). A directory collision under `overwrite` — which is what `auto`
/// means for directories — is merged: the children are planned into the existing target, then the emptied
/// source directory is deleted.
fn append_direct_move(
    plan: &mut Vec<DissolvefPlanItem>,
    entry: &DissolvefDirEntry,
    target_dir: &str,
    input: &NormalizedDissolvefInput,
    host: &mut dyn DissolvefHost,
) -> DissolvefHostResult<()> {
    let target_path = join_paths(&[target_dir, entry.name.as_str()]);
    if entry.is_directory {
        let target_info = host.stat(&target_path)?;
        let conflict = normalize_conflict(input.dir_conflict, true);
        if target_info.exists
            && target_info.is_directory
            && conflict == DissolvefConflictMode::Overwrite
        {
            for child in sorted_entries(&entry.path, host)? {
                append_direct_move(plan, &child, &target_path, input, host)?;
            }
            plan.push(delete_dir_row(DissolvefMode::Direct, &entry.path));
            return Ok(());
        }
    }

    let conflict = if entry.is_directory { input.dir_conflict } else { input.file_conflict };
    let resolved = resolve_conflict_target(&target_path, entry.is_directory, conflict, host)?;
    if !resolved.proceed {
        plan.push(DissolvefPlanItem {
            reason: resolved.reason,
            ..DissolvefPlanItem::new(
                DissolvefMode::Direct,
                DissolvefOperation::Move,
                &entry.path,
                &target_path,
                entry.is_directory,
                DissolvefPlanStatus::Skipped,
            )
        });
        return Ok(());
    }

    plan.push(DissolvefPlanItem {
        delete_target: resolved.delete_target,
        ..move_row(DissolvefMode::Direct, &entry.path, &resolved.target_path, entry.is_directory)
    });
    Ok(())
}

/// `collectDirectoryPaths` (`core.ts:607-613`), including the root itself.
///
/// One checkpoint per directory visited: a scan is the longest read-only stretch a run has, and ADR-0066
/// makes a batch plugin pausable only where it actually yields. The total is unknown here, so it is reported
/// as zero and the host keeps the counters for its log line only.
fn collect_directory_paths(path: &str, host: &mut dyn DissolvefHost) -> DissolvefHostResult<Vec<String>> {
    let mut visited = 0usize;
    let mut result = Vec::new();
    collect_directories(path, host, &mut visited, &mut result)?;
    Ok(result)
}

fn collect_directories(
    path: &str,
    host: &mut dyn DissolvefHost,
    visited: &mut usize,
    result: &mut Vec<String>,
) -> DissolvefHostResult<()> {
    checkpoint(host, PHASE_SCANNING, *visited, 0)?;
    *visited += 1;
    result.push(path.to_string());
    for entry in host.list_dir(path)? {
        if entry.is_directory {
            collect_directories(&entry.path, host, visited, result)?;
        }
    }
    Ok(())
}

/// `deepestSingleSubfolder` (`core.ts:615-624`): the end of a chain of single-child, fileless directories.
fn deepest_single_subfolder(path: &str, host: &mut dyn DissolvefHost) -> DissolvefHostResult<String> {
    let mut current = path.to_string();
    let mut depth = 0usize;
    loop {
        let entries = sorted_entries(&current, host)?;
        let directories: Vec<&DissolvefDirEntry> =
            entries.iter().filter(|entry| entry.is_directory).collect();
        if directories.len() != 1 || files_count(&entries) != 0 {
            return Ok(current);
        }
        depth += 1;
        checkpoint(host, PHASE_SCANNING, depth, 0)?;
        current = directories[0].path.clone();
    }
}

/// `sortedEntries` (`core.ts:626-631`): files before directories, then names.
fn sorted_entries(
    path: &str,
    host: &mut dyn DissolvefHost,
) -> DissolvefHostResult<Vec<DissolvefDirEntry>> {
    let mut entries = host.list_dir(path)?;
    entries.sort_by(compare_entry_names);
    Ok(entries)
}

fn compare_entry_names(left: &DissolvefDirEntry, right: &DissolvefDirEntry) -> Ordering {
    if left.is_file != right.is_file {
        // `core.ts:628`: files first.
        return if left.is_file { Ordering::Less } else { Ordering::Greater };
    }
    compare_names_locale_aware(&left.name, &right.name)
}

fn files_count(entries: &[DissolvefDirEntry]) -> usize {
    entries.iter().filter(|entry| entry.is_file).count()
}

/// `resolveConflictTarget` (`core.ts:633-650`), returned as the four fields `core.ts` put in its object.
pub(crate) struct ConflictResolution {
    pub proceed: bool,
    pub target_path: String,
    pub delete_target: Option<bool>,
    pub reason: Option<String>,
}

fn resolve_conflict_target(
    target_path: &str,
    is_directory: bool,
    conflict: DissolvefConflictMode,
    host: &mut dyn DissolvefHost,
) -> DissolvefHostResult<ConflictResolution> {
    let info = host.stat(target_path)?;
    if !info.exists {
        return Ok(proceeding(target_path, None));
    }
    let mode = normalize_conflict(conflict, is_directory);
    if mode == DissolvefConflictMode::Skip {
        return Ok(refused(target_path, "target_exists"));
    }
    if mode == DissolvefConflictMode::Rename {
        return Ok(proceeding(&next_available_path(target_path, host)?, None));
    }
    if is_directory {
        if !info.is_directory {
            return Ok(refused(target_path, "target_file_exists"));
        }
        return Ok(proceeding(target_path, None));
    }
    if !info.is_file {
        return Ok(refused(target_path, "target_directory_exists"));
    }
    Ok(proceeding(target_path, Some(true)))
}

fn proceeding(target_path: &str, delete_target: Option<bool>) -> ConflictResolution {
    ConflictResolution {
        proceed: true,
        target_path: target_path.to_string(),
        delete_target,
        reason: None,
    }
}

fn refused(target_path: &str, reason: &str) -> ConflictResolution {
    ConflictResolution {
        proceed: false,
        target_path: target_path.to_string(),
        delete_target: None,
        reason: Some(reason.to_string()),
    }
}

/// `nextAvailablePath` (`core.ts:657-667`): `name.ext`, then `name_1.ext` … up to `name_9999.ext`.
fn next_available_path(target_path: &str, host: &mut dyn DissolvefHost) -> DissolvefHostResult<String> {
    if !host.stat(target_path)?.exists {
        return Ok(target_path.to_string());
    }
    let dir = dirname_of(target_path);
    let name = basename_of(target_path);
    let (stem, suffix) = split_name(&name);
    for counter in 1..10000usize {
        let candidate_name = format!("{stem}_{counter}{suffix}");
        let candidate = join_paths(&[dir.as_str(), candidate_name.as_str()]);
        if !host.stat(&candidate)?.exists {
            return Ok(candidate);
        }
    }
    Err(DissolvefHostError::Failure(format!(
        "Unable to find available target for {target_path}"
    )))
}

/// `enableSimilarity: false` short-circuits the gate to `1`, exactly as `core.ts:286` and `core.ts:382`.
fn dissolve_similarity_gate(
    input: &NormalizedDissolvefInput,
    dir: &str,
    counterpart_name: &str,
) -> DissolvefSimilarityCheck {
    if input.enable_similarity {
        check_dissolvef_similarity(basename_of(dir).as_str(), counterpart_name, input.similarity_threshold)
    } else {
        DissolvefSimilarityCheck { passed: true, similarity: 1.0 }
    }
}

fn move_row(
    mode: DissolvefMode,
    source_path: &str,
    target_path: &str,
    is_directory: bool,
) -> DissolvefPlanItem {
    DissolvefPlanItem::new(
        mode,
        DissolvefOperation::Move,
        source_path,
        target_path,
        is_directory,
        DissolvefPlanStatus::Pending,
    )
}

fn delete_dir_row(mode: DissolvefMode, source_path: &str) -> DissolvefPlanItem {
    DissolvefPlanItem::new(
        mode,
        DissolvefOperation::DeleteDir,
        source_path,
        "",
        true,
        DissolvefPlanStatus::Pending,
    )
}

/// One ADR-0066 yield. `Cancelled` stops the run; `Paused` is a host that reported a pause without holding
/// the call, and `CheckpointOutcome::is_hard_stop` says that is not a stop.
pub(crate) fn checkpoint(
    host: &mut dyn DissolvefHost,
    phase: &'static str,
    processed_item_count: usize,
    total_item_count: usize,
) -> DissolvefHostResult<()> {
    let outcome = host.checkpoint(&DissolvefCheckpointRequest {
        phase,
        processed_item_count,
        total_item_count,
    })?;
    if outcome.is_hard_stop() {
        return Err(DissolvefHostError::Cancelled);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::DissolvefItemKind;

    #[test]
    fn entry_sorting_puts_files_first_and_compares_names_case_insensitively() {
        let entries = vec![
            DissolvefDirEntry {
                name: "b-dir".to_string(),
                path: "/x/b-dir".to_string(),
                is_file: false,
                is_directory: true,
            },
            DissolvefDirEntry {
                name: "B.txt".to_string(),
                path: "/x/B.txt".to_string(),
                is_file: true,
                is_directory: false,
            },
            DissolvefDirEntry {
                name: "a.txt".to_string(),
                path: "/x/a.txt".to_string(),
                is_file: true,
                is_directory: false,
            },
        ];
        let mut sorted = entries;
        sorted.sort_by(compare_entry_names);
        assert_eq!(
            sorted.iter().map(|entry| entry.name.as_str()).collect::<Vec<_>>(),
            vec!["a.txt", "B.txt", "b-dir"]
        );
    }

    #[test]
    fn rows_carry_the_optional_fields_core_ts_sets() {
        let nested_delete = DissolvefPlanItem {
            recursive_delete: Some(true),
            similarity: Some(1.0.into()),
            ..delete_dir_row(DissolvefMode::Nested, "/root/album")
        };
        assert_eq!(
            serde_json::to_string(&nested_delete).unwrap(),
            r#"{"mode":"nested","operation":"delete_dir","sourcePath":"/root/album","targetPath":"","itemKind":"directory","status":"pending","similarity":1,"recursiveDelete":true}"#
        );
        let skipped = skipped_plan_item(DissolvefMode::Archive, "/root/album", "blacklisted", Some(0.4));
        assert_eq!(skipped.target_path, "");
        assert_eq!(skipped.item_kind, DissolvefItemKind::Directory);
        assert_eq!(
            serde_json::to_string(&skipped).unwrap(),
            r#"{"mode":"archive","operation":"move","sourcePath":"/root/album","targetPath":"","itemKind":"directory","status":"skipped","reason":"blacklisted","similarity":0.4}"#
        );
    }
}
