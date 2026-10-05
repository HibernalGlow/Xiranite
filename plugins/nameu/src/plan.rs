//! Plan generation and the batch apply loop, ported from
//! `packages/nodes/nameu/src/core.ts:98-223`.

use std::collections::HashSet;

use crate::contract::{
    NameuAction, NameuCheckpointRequest, NameuCheckpointStatus, NameuData, NameuDirEntry,
    NameuInput, NameuItemKind, NameuMode, NameuNameRules, NameuPathInfo, NameuPlanItem,
    NameuPlanStatus, NameuResult, NameuRunEvent, NormalizedNameuInput, normalize_nameu_input,
};
use crate::name_rules::{is_archive, is_excluded_path, normalize_archive_name, normalize_folder_name};
use crate::text::lower_key;

/// The host boundary. Every filesystem effect and every yield crosses it; since ADR-0071 the file
/// methods are served by `std::fs` on the preopens the host granted
/// (`crate::std_fs_runtime::StdFilesystem`), and only `emit`/`checkpoint` are host calls. The trait
/// stays because the batch plan and the apply loop are tested against a recorder, not a disk.
pub trait NameuRuntime {
    fn path_info(&mut self, path: &str) -> NameuRuntimeResult<NameuPathInfo>;
    fn list_dir(&mut self, path: &str) -> NameuRuntimeResult<Vec<NameuDirEntry>>;
    fn rename(&mut self, from: &str, to: &str) -> NameuRuntimeResult<()>;
    fn set_times(&mut self, path: &str, atime_ms: f64, mtime_ms: f64) -> NameuRuntimeResult<()>;
    fn join(&self, parts: &[&str]) -> String;
    fn dirname(&self, path: &str) -> String;
    fn basename(&self, path: &str) -> String;
    fn emit(&mut self, event: &NameuRunEvent) -> NameuRuntimeResult<()>;
    /// `xiranite.operation.checkpoint()`: the host blocks here while the owning operation
    /// is paused and answers `Cancelled` to stop the batch (ADR-0066).
    fn checkpoint(
        &mut self,
        request: &NameuCheckpointRequest,
    ) -> NameuRuntimeResult<NameuCheckpointStatus>;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NameuRuntimeError {
    /// A host call failed; the string is the message the TypeScript would have
    /// surfaced through `errorMessage(error)` (core.ts:354).
    Failure(String),
    /// A checkpoint reported cancellation, which is a hard stop.
    Cancelled,
}

pub type NameuRuntimeResult<T> = Result<T, NameuRuntimeError>;

pub fn run_nameu(input: &NameuInput, runtime: &mut dyn NameuRuntime) -> NameuResult {
    let normalized = normalize_nameu_input(input);
    if normalized.paths.is_empty() {
        return failure_result("At least one artist folder or library root is required.", &normalized);
    }

    let plan = match emit_scanning_and_build(&normalized, runtime) {
        Ok(plan) => plan,
        Err(NameuRuntimeError::Cancelled) => {
            return cancelled_result(&normalized, Vec::new(), 0, "while scanning");
        }
        Err(NameuRuntimeError::Failure(message)) => return failure_result(&message, &normalized),
    };

    // Dry-run is the default and `scan`/`plan` never mutate: the write path below
    // is only reachable with `action == rename` and `dryRun == false` (core.ts:109).
    if normalized.action != NameuAction::Rename || normalized.dry_run {
        return success_result(
            &format!("NameU planned {} item(s).", plan.len()),
            NameuData::summarize(&normalized, plan),
        );
    }

    if let Err(error) = runtime.emit(&NameuRunEvent::progress(65.0, "Renaming planned items.")) {
        return aborted(&error, &normalized);
    }

    let mut applied: Vec<NameuPlanItem> = Vec::with_capacity(plan.len());
    let mut renamed_count = 0_usize;
    for (index, item) in plan.into_iter().enumerate() {
        let request = NameuCheckpointRequest {
            phase: "renaming".to_string(),
            processed_item_count: index as u64,
        };
        match runtime.checkpoint(&request) {
            Ok(NameuCheckpointStatus::Continue) => {}
            Ok(NameuCheckpointStatus::Cancelled) => {
                applied.push(item);
                return cancelled_result(&normalized, applied, renamed_count, "while renaming");
            }
            Err(error) => return aborted(&error, &normalized),
        }

        if item.status != NameuPlanStatus::Ready {
            applied.push(item);
            continue;
        }

        match apply_plan_item(&item, &normalized, runtime) {
            Ok(()) => {
                renamed_count += 1;
                applied.push(NameuPlanItem {
                    status: NameuPlanStatus::Renamed,
                    reason: None,
                    ..item
                });
            }
            Err(NameuRuntimeError::Cancelled) => {
                applied.push(item);
                return cancelled_result(&normalized, applied, renamed_count, "while renaming");
            }
            Err(NameuRuntimeError::Failure(message)) => {
                applied.push(NameuPlanItem {
                    status: NameuPlanStatus::Error,
                    reason: Some(message),
                    ..item
                });
            }
        }
    }

    success_result(
        &format!("NameU renamed {renamed_count} item(s)."),
        NameuData::summarize(&normalized, applied),
    )
}

/// Emits the scanning progress event and then builds the plan, keeping the
/// TypeScript event-before-plan ordering (core.ts:106-108).
fn emit_scanning_and_build(
    normalized: &NormalizedNameuInput,
    runtime: &mut dyn NameuRuntime,
) -> NameuRuntimeResult<Vec<NameuPlanItem>> {
    runtime.emit(&NameuRunEvent::progress(15.0, "Scanning NameU folders."))?;
    build_nameu_plan(normalized, runtime)
}

fn apply_plan_item(
    item: &NameuPlanItem,
    normalized: &NormalizedNameuInput,
    runtime: &mut dyn NameuRuntime,
) -> NameuRuntimeResult<()> {
    // Timestamps are read before the rename because the move replaces the entry
    // the host would otherwise report on (core.ts:121-123).
    let info = runtime.path_info(&item.source_path)?;
    runtime.rename(&item.source_path, &item.target_path)?;
    if normalized.keep_timestamp {
        runtime.set_times(&item.target_path, info.atime_ms, info.mtime_ms)?;
    }
    Ok(())
}

/// `buildNameuPlan` (core.ts:136-161).
pub fn build_nameu_plan(
    input: &NormalizedNameuInput,
    runtime: &mut dyn NameuRuntime,
) -> NameuRuntimeResult<Vec<NameuPlanItem>> {
    let mut items: Vec<NameuPlanItem> = Vec::new();
    for (index, root) in input.paths.iter().enumerate() {
        let request = NameuCheckpointRequest {
            phase: "scanning".to_string(),
            processed_item_count: index as u64,
        };
        match runtime.checkpoint(&request)? {
            NameuCheckpointStatus::Cancelled => return Err(NameuRuntimeError::Cancelled),
            NameuCheckpointStatus::Continue => {}
        }

        let info = runtime.path_info(root)?;
        if !info.exists || !info.is_directory {
            items.push(skipped_item(
                root.clone(),
                runtime.basename(root),
                runtime.dirname(root),
                "path_not_directory",
            ));
            continue;
        }

        if input.mode == NameuMode::Single {
            let root_name = runtime.basename(root);
            items.extend(collect_artist_folder(root, &root_name, input, runtime)?);
            continue;
        }

        let children = runtime.list_dir(root)?;
        let artist_folders: Vec<&NameuDirEntry> = children
            .iter()
            .filter(|entry| entry.is_directory && !is_excluded_path(&entry.path, &input.exclude_keywords))
            .collect();
        if artist_folders.is_empty() {
            // A root that holds no artist subfolder is treated as one artist
            // folder itself (core.ts:152-154).
            let root_name = runtime.basename(root);
            items.extend(collect_artist_folder(root, &root_name, input, runtime)?);
            continue;
        }
        for folder in artist_folders {
            items.extend(collect_artist_folder(&folder.path, &folder.name, input, runtime)?);
        }
    }
    Ok(items)
}

/// `collectArtistFolder` (core.ts:163-200): breadth-first over the artist tree
/// with one per-directory `reserved` name set, which is what makes two files in
/// the same folder collide but files in different folders not.
pub(crate) fn collect_artist_folder(
    artist_path: &str,
    artist_name: &str,
    input: &NormalizedNameuInput,
    runtime: &mut dyn NameuRuntime,
) -> NameuRuntimeResult<Vec<NameuPlanItem>> {
    if is_excluded_path(artist_path, &input.exclude_keywords) {
        return Ok(vec![skipped_item(
            artist_path.to_string(),
            runtime.basename(artist_path),
            runtime.dirname(artist_path),
            "excluded_path",
        )]);
    }

    let name_rules = NameuNameRules::from(input);
    let mut items: Vec<NameuPlanItem> = Vec::new();
    let mut queue: Vec<String> = vec![artist_path.to_string()];
    let mut cursor = 0_usize;
    while cursor < queue.len() {
        let directory = queue[cursor].clone();
        cursor += 1;
        let entries = runtime.list_dir(&directory)?;
        let mut reserved: HashSet<String> = entries.iter().map(|entry| lower_key(&entry.name)).collect();

        for entry in &entries {
            if entry.is_directory {
                if input.normalize_folders && !is_excluded_path(&entry.path, &input.exclude_keywords) {
                    let folder_target = normalize_folder_name(&entry.name);
                    if folder_target != entry.name {
                        items.push(plan_target(
                            entry,
                            &folder_target,
                            artist_name,
                            NameuItemKind::Folder,
                            &reserved,
                            runtime,
                        )?);
                        // The target is only reserved when the folder actually
                        // changes (core.ts:186-187).
                        reserved.insert(lower_key(&folder_target));
                    }
                }
                if input.recursive && !is_excluded_path(&entry.path, &input.exclude_keywords) {
                    queue.push(entry.path.clone());
                }
                continue;
            }
            if !entry.is_file || !is_archive(&entry.name, &input.archive_extensions) {
                continue;
            }
            let target_name = normalize_archive_name(&entry.name, artist_name, &name_rules);
            items.push(plan_target(entry, &target_name, artist_name, NameuItemKind::Archive, &reserved, runtime)?);
            reserved.insert(lower_key(&target_name));
        }
    }
    Ok(items)
}

/// `planTarget` (core.ts:202-223).
fn plan_target(
    entry: &NameuDirEntry,
    target_name: &str,
    artist_name: &str,
    kind: NameuItemKind,
    reserved: &HashSet<String>,
    runtime: &mut dyn NameuRuntime,
) -> NameuRuntimeResult<NameuPlanItem> {
    if target_name == entry.name {
        // `unchanged` keeps the source path as the target, not the re-joined one
        // (core.ts:213).
        return Ok(NameuPlanItem {
            source_path: entry.path.clone(),
            target_path: entry.path.clone(),
            source_name: entry.name.clone(),
            target_name: entry.name.clone(),
            artist_name: artist_name.to_string(),
            kind,
            status: NameuPlanStatus::Unchanged,
            reason: None,
        });
    }

    let directory = runtime.dirname(&entry.path);
    let target_path = runtime.join(&[&directory, target_name]);
    if reserved.contains(&lower_key(target_name)) {
        return Ok(conflict_item(entry, target_path, target_name, artist_name, kind, "target_name_exists"));
    }
    if runtime.path_info(&target_path)?.exists {
        return Ok(conflict_item(entry, target_path, target_name, artist_name, kind, "target_path_exists"));
    }
    Ok(NameuPlanItem {
        source_path: entry.path.clone(),
        target_path,
        source_name: entry.name.clone(),
        target_name: target_name.to_string(),
        artist_name: artist_name.to_string(),
        kind,
        status: NameuPlanStatus::Ready,
        reason: None,
    })
}

fn conflict_item(
    entry: &NameuDirEntry,
    target_path: String,
    target_name: &str,
    artist_name: &str,
    kind: NameuItemKind,
    reason: &str,
) -> NameuPlanItem {
    NameuPlanItem {
        source_path: entry.path.clone(),
        target_path,
        source_name: entry.name.clone(),
        target_name: target_name.to_string(),
        artist_name: artist_name.to_string(),
        kind,
        status: NameuPlanStatus::Conflict,
        reason: Some(reason.to_string()),
    }
}

/// `skipped` (core.ts:334-336). The `artistName` field of a skipped row carries
/// the parent directory, not the artist; preserved for contract parity.
fn skipped_item(path: String, name: String, directory: String, reason: &str) -> NameuPlanItem {
    NameuPlanItem {
        source_path: path.clone(),
        target_path: path,
        source_name: name.clone(),
        target_name: name,
        artist_name: directory,
        kind: NameuItemKind::Folder,
        status: NameuPlanStatus::Skipped,
        reason: Some(reason.to_string()),
    }
}

/// `success` (core.ts:322-324): the flag is `errorCount === 0`, so a plan full of
/// conflicts still reports success while any error does not.
fn success_result(message: &str, data: NameuData) -> NameuResult {
    NameuResult {
        success: data.error_count == 0,
        message: message.to_string(),
        data: Some(data),
    }
}

/// `failure` (core.ts:326-332): one synthetic error item with empty paths.
fn failure_result(message: &str, input: &NormalizedNameuInput) -> NameuResult {
    let items = vec![NameuPlanItem {
        source_path: String::new(),
        target_path: String::new(),
        source_name: String::new(),
        target_name: String::new(),
        artist_name: String::new(),
        kind: NameuItemKind::Archive,
        status: NameuPlanStatus::Error,
        reason: Some(message.to_string()),
    }];
    NameuResult {
        success: false,
        message: message.to_string(),
        data: Some(NameuData::summarize(input, items)),
    }
}

fn aborted(error: &NameuRuntimeError, input: &NormalizedNameuInput) -> NameuResult {
    match error {
        NameuRuntimeError::Failure(message) => failure_result(message, input),
        NameuRuntimeError::Cancelled => cancelled_result(input, Vec::new(), 0, "while renaming"),
    }
}

/// Cancellation has no TypeScript counterpart: the old host aborted the whole
/// call. The applied prefix is reported so the host can build an undo plan.
fn cancelled_result(
    input: &NormalizedNameuInput,
    applied: Vec<NameuPlanItem>,
    renamed_count: usize,
    stage: &str,
) -> NameuResult {
    NameuResult {
        success: false,
        message: format!("NameU cancelled {stage} after {renamed_count} renamed item(s)."),
        data: Some(NameuData::summarize(input, applied)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::in_memory_runtime::InMemoryNameuRuntime;

    fn plan_input(action: NameuAction, paths: &[&str], mode: NameuMode) -> NameuInput {
        NameuInput {
            action: Some(action),
            paths: Some(paths.iter().map(|path| (*path).to_string()).collect()),
            mode: Some(mode),
            ..Default::default()
        }
    }

    /// `core.test.ts:6-14`: the artist name is appended and the noise tags go away.
    #[test]
    fn normalize_archive_name_ports_the_typescript_case() {
        let rules = NameuNameRules {
            add_artist_name: true,
            exclude_keywords: Vec::new(),
            forbidden_artist_keywords: Vec::new(),
        };
        assert_eq!(
            normalize_archive_name("PIXIV FANBOX {3000@PX} [cbr] 作品.zip", "Artist", &rules),
            "FANBOX 作品Artist.zip"
        );
    }

    /// `core.test.ts:16-34`.
    #[test]
    fn builds_a_multi_folder_rename_plan() {
        let mut runtime = InMemoryNameuRuntime::new(&[
            ("/library", &[("Artist", "/library/Artist", false)][..]),
            (
                "/library/Artist",
                &[("Book [cbr].zip", "/library/Artist/Book [cbr].zip", true)][..],
            ),
        ]);

        let result = run_nameu(&plan_input(NameuAction::Plan, &["/library"], NameuMode::Multi), &mut runtime);

        assert!(result.success);
        assert_eq!(result.message, "NameU planned 1 item(s).");
        let data = result.data.expect("plan data");
        assert_eq!(data.ready_count, 1);
        assert_eq!(data.items.len(), 1);
        assert_eq!(data.items[0].source_name, "Book [cbr].zip");
        assert_eq!(data.items[0].target_name, "BookArtist.zip");
        assert_eq!(data.items[0].artist_name, "Artist");
        assert_eq!(data.items[0].status, NameuPlanStatus::Ready);
        assert_eq!(data.items[0].kind, NameuItemKind::Archive);
        assert!(runtime.renames.is_empty(), "planning must not mutate");
        assert_eq!(runtime.events.len(), 1);
        assert_eq!(runtime.events[0].message, "Scanning NameU folders.");
        assert_eq!(runtime.events[0].progress, Some(15.0));
    }

    /// `core.test.ts:36-50`: two files in one folder that normalize to the same
    /// name conflict, and nothing is renamed.
    #[test]
    fn reports_target_conflicts_without_renaming() {
        let mut runtime = InMemoryNameuRuntime::new(&[(
            "/library/Artist",
            &[
                ("Book [cbr].zip", "/library/Artist/Book [cbr].zip", true),
                ("BookArtist.zip", "/library/Artist/BookArtist.zip", true),
            ][..],
        )]);

        let result = run_nameu(&plan_input(NameuAction::Plan, &["/library/Artist"], NameuMode::Single), &mut runtime);

        let data = result.data.expect("plan data");
        assert_eq!(data.conflict_count, 1);
        // The already-correct name is `unchanged`, so the plan has two rows.
        assert_eq!(data.unchanged_count, 1);
        let conflict = data.items.iter().find(|item| item.status == NameuPlanStatus::Conflict).expect("conflict");
        assert_eq!(conflict.reason.as_deref(), Some("target_name_exists"));
        assert_eq!(data.errors, vec!["/library/Artist/Book [cbr].zip: target_name_exists"]);
        assert!(runtime.renames.is_empty());
    }

    /// `core.test.ts:52-69`.
    #[test]
    fn renames_ready_entries_and_preserves_timestamps() {
        let mut runtime = InMemoryNameuRuntime::new(&[(
            "/library/Artist",
            &[("Book [cbr].zip", "/library/Artist/Book [cbr].zip", true)][..],
        )]);

        let result = run_nameu(
            &NameuInput {
                action: Some(NameuAction::Rename),
                paths: Some(vec!["/library/Artist".to_string()]),
                mode: Some(NameuMode::Single),
                dry_run: Some(false),
                ..Default::default()
            },
            &mut runtime,
        );

        assert!(result.success);
        assert_eq!(result.message, "NameU renamed 1 item(s).");
        let data = result.data.expect("plan data");
        assert_eq!(data.renamed_count, 1);
        assert_eq!(data.items[0].status, NameuPlanStatus::Renamed);
        assert_eq!(
            runtime.renames,
            vec![(
                "/library/Artist/Book [cbr].zip".to_string(),
                "/library/Artist/BookArtist.zip".to_string()
            )]
        );
        assert_eq!(
            runtime.set_times,
            vec![("/library/Artist/BookArtist.zip".to_string(), 1000.0, 2000.0)]
        );
        assert_eq!(runtime.events[1].message, "Renaming planned items.");
        assert_eq!(runtime.events[1].progress, Some(65.0));
        assert_eq!(
            runtime
                .checkpoints
                .iter()
                .map(|request| request.phase.as_str())
                .collect::<Vec<_>>(),
            vec!["scanning", "renaming"]
        );
    }

    #[test]
    fn rename_without_turning_dry_run_off_stays_a_plan() {
        let mut runtime = InMemoryNameuRuntime::new(&[(
            "/library/Artist",
            &[("Book [cbr].zip", "/library/Artist/Book [cbr].zip", true)][..],
        )]);

        let result = run_nameu(&plan_input(NameuAction::Rename, &["/library/Artist"], NameuMode::Single), &mut runtime);

        assert!(result.success);
        assert_eq!(result.message, "NameU planned 1 item(s).");
        assert!(runtime.renames.is_empty());
        assert!(runtime.set_times.is_empty());
        assert_eq!(result.data.expect("plan data").ready_count, 1);
    }

    #[test]
    fn keep_timestamp_disabled_skips_set_times() {
        let mut runtime = InMemoryNameuRuntime::new(&[(
            "/library/Artist",
            &[("Book [cbr].zip", "/library/Artist/Book [cbr].zip", true)][..],
        )]);
        let result = run_nameu(
            &NameuInput {
                action: Some(NameuAction::Rename),
                paths: Some(vec!["/library/Artist".to_string()]),
                mode: Some(NameuMode::Single),
                dry_run: Some(false),
                keep_timestamp: Some(false),
                ..Default::default()
            },
            &mut runtime,
        );
        assert_eq!(result.data.expect("plan data").renamed_count, 1);
        assert!(runtime.set_times.is_empty());
    }

    #[test]
    fn at_least_one_path_is_required() {
        let mut runtime = InMemoryNameuRuntime::default();
        let result = run_nameu(&NameuInput::default(), &mut runtime);
        assert!(!result.success);
        assert_eq!(result.message, "At least one artist folder or library root is required.");
        let data = result.data.expect("failure payload");
        assert_eq!(data.error_count, 1);
        assert_eq!(data.scanned_count, 1);
        assert_eq!(data.items[0].status, NameuPlanStatus::Error);
        assert_eq!(data.items[0].kind, NameuItemKind::Archive);
        assert_eq!(data.items[0].source_path, "");
        assert!(runtime.events.is_empty());
    }

    #[test]
    fn missing_or_file_root_is_skipped_with_parent_as_artist_name() {
        let mut runtime = InMemoryNameuRuntime::default();
        let result = run_nameu(&plan_input(NameuAction::Plan, &["/library/Ghost"], NameuMode::Single), &mut runtime);
        let data = result.data.expect("plan data");
        assert_eq!(data.skipped_count, 1);
        assert_eq!(data.items[0].reason.as_deref(), Some("path_not_directory"));
        // `skipped()` stores `dirname(root)` in `artistName` (core.ts:334-336).
        assert_eq!(data.items[0].artist_name, "/library");
        assert_eq!(data.items[0].source_name, "Ghost");
        assert_eq!(data.items[0].kind, NameuItemKind::Folder);
    }

    #[test]
    fn multi_root_without_artist_folders_scans_the_root_as_the_artist() {
        let mut runtime = InMemoryNameuRuntime::new(&[(
            "/library/Artist",
            &[("Book [cbr].zip", "/library/Artist/Book [cbr].zip", true)][..],
        )]);
        let result = run_nameu(&plan_input(NameuAction::Plan, &["/library/Artist"], NameuMode::Multi), &mut runtime);
        let data = result.data.expect("plan data");
        assert_eq!(data.ready_count, 1);
        assert_eq!(data.items[0].artist_name, "Artist");
    }

    #[test]
    fn excluded_paths_are_skipped_or_filtered() {
        let mut runtime = InMemoryNameuRuntime::new(&[
            (
                "/library",
                &[("[00待分类]", "/library/[00待分类]", false), ("Artist", "/library/Artist", false)][..],
            ),
            (
                "/library/Artist",
                &[("Book [cbr].zip", "/library/Artist/Book [cbr].zip", true)][..],
            ),
        ]);
        let result = run_nameu(&plan_input(NameuAction::Plan, &["/library"], NameuMode::Multi), &mut runtime);
        let data = result.data.expect("plan data");
        // The excluded artist folder never enters the scan; only the kept one does.
        assert_eq!(data.items.len(), 1);
        assert_eq!(data.items[0].artist_name, "Artist");

        let mut excluded_root = InMemoryNameuRuntime::new(&[("/library/[00待分类]", &[][..])]);
        let result = run_nameu(
            &plan_input(NameuAction::Plan, &["/library/[00待分类]"], NameuMode::Single),
            &mut excluded_root,
        );
        let data = result.data.expect("plan data");
        assert_eq!(data.items[0].status, NameuPlanStatus::Skipped);
        assert_eq!(data.items[0].reason.as_deref(), Some("excluded_path"));
    }

    #[test]
    fn folder_rename_plans_and_recurses_into_the_original_path() {
        let mut runtime = InMemoryNameuRuntime::new(&[
            (
                "/library/Artist",
                &[("Sub [cbr]", "/library/Artist/Sub [cbr]", false)][..],
            ),
            (
                "/library/Artist/Sub [cbr]",
                &[("Book.zip", "/library/Artist/Sub [cbr]/Book.zip", true)][..],
            ),
        ]);
        let result = run_nameu(&plan_input(NameuAction::Plan, &["/library/Artist"], NameuMode::Single), &mut runtime);
        let data = result.data.expect("plan data");
        assert_eq!(data.items.len(), 2);
        assert_eq!(data.items[0].kind, NameuItemKind::Folder);
        assert_eq!(data.items[0].source_name, "Sub [cbr]");
        assert_eq!(data.items[0].target_name, "Sub");
        assert_eq!(data.items[0].target_path, "/library/Artist/Sub");
        // Recursion walks the pre-rename path, as `queue.push(entry.path)` does
        // (core.ts:189), so the archive row still points at the old directory.
        assert_eq!(data.items[1].source_path, "/library/Artist/Sub [cbr]/Book.zip");
        assert_eq!(data.items[1].artist_name, "Artist");
    }

    #[test]
    fn target_already_on_disk_conflicts_after_the_reserved_check() {
        // `/library/Artist/BookArtist.zip` exists as a directory key the parent
        // listing does not show, which is how `target_path_exists` (core.ts:218-221)
        // is reached without a same-directory name collision.
        let mut runtime = InMemoryNameuRuntime::new(&[
            (
                "/library/Artist",
                &[("Book [cbr].zip", "/library/Artist/Book [cbr].zip", true)][..],
            ),
            ("/library/Artist/BookArtist.zip", &[][..]),
        ]);
        let result = run_nameu(&plan_input(NameuAction::Plan, &["/library/Artist"], NameuMode::Single), &mut runtime);
        let data = result.data.expect("plan data");
        assert_eq!(data.conflict_count, 1);
        assert_eq!(data.items[0].reason.as_deref(), Some("target_path_exists"));
        assert_eq!(data.items[0].target_path, "/library/Artist/BookArtist.zip");
    }

    #[test]
    fn unchanged_rows_keep_the_source_path_as_target() {
        let mut runtime = InMemoryNameuRuntime::new(&[(
            "/library/Artist",
            &[("BookArtist.zip", "/library/Artist/BookArtist.zip", true)][..],
        )]);
        let result = run_nameu(&plan_input(NameuAction::Plan, &["/library/Artist"], NameuMode::Single), &mut runtime);
        let data = result.data.expect("plan data");
        assert_eq!(data.unchanged_count, 1);
        assert_eq!(data.items[0].status, NameuPlanStatus::Unchanged);
        assert_eq!(data.items[0].target_path, data.items[0].source_path);
        assert_eq!(data.items[0].reason, None);
    }

    #[test]
    fn scan_action_reports_the_same_plan_with_its_own_action() {
        let mut runtime = InMemoryNameuRuntime::new(&[(
            "/library/Artist",
            &[("Book [cbr].zip", "/library/Artist/Book [cbr].zip", true)][..],
        )]);
        let result = run_nameu(&plan_input(NameuAction::Scan, &["/library/Artist"], NameuMode::Single), &mut runtime);
        let data = result.data.expect("plan data");
        assert_eq!(data.action, NameuAction::Scan);
        assert_eq!(data.ready_count, 1);
        assert!(runtime.renames.is_empty());
    }

    #[test]
    fn rename_failure_becomes_an_error_row_and_an_unsuccessful_result() {
        let mut runtime = InMemoryNameuRuntime::new(&[(
            "/library/Artist",
            &[("Book [cbr].zip", "/library/Artist/Book [cbr].zip", true)][..],
        )]);
        runtime.failing_paths = vec!["/library/Artist/Book [cbr].zip".to_string()];

        let result = run_nameu(
            &NameuInput {
                action: Some(NameuAction::Rename),
                paths: Some(vec!["/library/Artist".to_string()]),
                mode: Some(NameuMode::Single),
                dry_run: Some(false),
                ..Default::default()
            },
            &mut runtime,
        );

        assert!(!result.success);
        assert_eq!(result.message, "NameU renamed 0 item(s).");
        let data = result.data.expect("plan data");
        assert_eq!(data.error_count, 1);
        assert_eq!(data.items[0].status, NameuPlanStatus::Error);
        assert_eq!(data.items[0].reason.as_deref(), Some("host refusal: /library/Artist/Book [cbr].zip"));
        assert!(runtime.renames.is_empty());
    }

    #[test]
    fn list_dir_failure_surfaces_as_a_top_level_failure() {
        let mut runtime = InMemoryNameuRuntime::new(&[("/library", &[][..])]);
        runtime.failing_paths = vec!["/library".to_string()];
        let result = run_nameu(&plan_input(NameuAction::Plan, &["/library"], NameuMode::Multi), &mut runtime);
        assert!(!result.success);
        assert_eq!(result.message, "host refusal: /library");
        assert_eq!(result.data.expect("plan data").error_count, 1);
    }

    #[test]
    fn cancelled_checkpoint_stops_the_batch_before_any_write() {
        let mut runtime = InMemoryNameuRuntime::new(&[(
            "/library/Artist",
            &[
                ("A [cbr].zip", "/library/Artist/A [cbr].zip", true),
                ("B [cbr].zip", "/library/Artist/B [cbr].zip", true),
            ][..],
        )]);
        runtime.cancel_during_phase = Some("renaming".to_string());

        let result = run_nameu(
            &NameuInput {
                action: Some(NameuAction::Rename),
                paths: Some(vec!["/library/Artist".to_string()]),
                mode: Some(NameuMode::Single),
                dry_run: Some(false),
                ..Default::default()
            },
            &mut runtime,
        );

        assert!(!result.success);
        assert_eq!(result.message, "NameU cancelled while renaming after 0 renamed item(s).");
        assert!(runtime.renames.is_empty());
        assert_eq!(
            runtime
                .checkpoints
                .iter()
                .map(|request| request.phase.as_str())
                .collect::<Vec<_>>(),
            vec!["scanning", "renaming"]
        );
    }

    #[test]
    fn cancelled_checkpoint_during_scanning_skips_the_plan() {
        let mut runtime = InMemoryNameuRuntime::new(&[("/library/Artist", &[][..])]);
        runtime.checkpoint_status = NameuCheckpointStatus::Cancelled;
        let result = run_nameu(&plan_input(NameuAction::Plan, &["/library/Artist"], NameuMode::Single), &mut runtime);
        assert!(!result.success);
        assert_eq!(result.message, "NameU cancelled while scanning after 0 renamed item(s).");
        assert_eq!(result.data.expect("plan data").scanned_count, 0);
    }

    #[test]
    fn checkpoint_happens_once_per_written_item_and_once_per_root() {
        let mut runtime = InMemoryNameuRuntime::new(&[
            ("/library/Artist", &[("A [cbr].zip", "/library/Artist/A [cbr].zip", true)][..]),
            ("/other/Artist", &[("B [cbr].zip", "/other/Artist/B [cbr].zip", true)][..]),
        ]);
        run_nameu(
            &plan_input(NameuAction::Plan, &["/library/Artist", "/other/Artist"], NameuMode::Single),
            &mut runtime,
        );
        assert_eq!(runtime.checkpoints.len(), 2, "one checkpoint per scanned root");
        assert!(runtime.checkpoints.iter().all(|request| request.phase == "scanning"));
    }
}
