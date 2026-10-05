//! The planner: `buildClassqPlan`, `findKeywordFolders` and the counter record, from
//! `packages/nodes/classq/src/core.ts:122-235`.
//!
//! Order is part of the contract, not an accident. `core.test.ts:38-42` asserts the exact
//! `(stage, sourceName, targetRelative)` triple sequence, and the CLI prints the item list as it stands
//! (`cli.ts:48`), so this module never sorts, never dedupes rows and never truncates. The two dedupes it does perform
//! are the TypeScript's own: `processedParents` (`core.ts:138-143`, per root) and the three sibling filters
//! (`core.ts:149-152`).
//!
//! One structural change, forced by the sandbox rather than by taste: `findKeywordFolders` walks with an explicit
//! heap frame stack instead of the TypeScript's call-stack recursion, emitting matches in the same pre-order
//! positions. A `wasm32-wasip1` guest traps on a deep native stack, and a trap is not a `failure` result, so the
//! walk now costs heap pages under the manifest's `memory_max_pages` ceiling (ADR-0066's memory budget) while the
//! emitted order stays byte-for-byte the one `core.ts:160-169` produced. `plugins/timeu/src/lib.rs` records the same
//! deviation for the same reason.

use crate::contract::{
    ClassqData, ClassqDirEntry, ClassqExistingPolicy, ClassqItemKind, ClassqPlanItem, ClassqPlanStatus, ClassqStage,
};
use crate::input_normalization::NormalizedClassqInput;
use crate::path_text::{
    join_path, name_contains_keyword, normalize_path_key, path_basename, path_dirname, path_relative,
};
use crate::runtime::{ClassqFileSystem, ClassqRuntimeError};

/// One frame of the keyword walk: a directory whose entries are still being visited.
struct ScanFrame {
    entries: Vec<ClassqDirEntry>,
    next: usize,
}

/// `findKeywordFolders` (`core.ts:160-169`): every directory at or below `root` whose name contains the keyword,
/// in pre-order, where "contains" is case-folded (`core.ts:165`).
///
/// Non-directories are not descended into, and a listing is never re-visited: the visited set is the cycle guard the
/// TypeScript did not need but a bounded-memory guest does.
pub fn find_keyword_folders(
    root: &str,
    keyword_lower: &str,
    file_system: &dyn ClassqFileSystem,
) -> Result<Vec<ClassqDirEntry>, ClassqRuntimeError> {
    let mut found: Vec<ClassqDirEntry> = Vec::new();
    let mut visited: Vec<String> = vec![normalize_path_key(root)];
    let root_listing = file_system.list_dir(root)?;
    let mut stack: Vec<ScanFrame> = vec![ScanFrame { entries: root_listing, next: 0 }];

    while let Some(frame) = stack.last_mut() {
        if frame.next >= frame.entries.len() {
            stack.pop();
            continue;
        }
        let entry = frame.entries[frame.next].clone();
        frame.next += 1;
        if !entry.is_directory {
            continue;
        }
        if name_contains_keyword(&entry.name, keyword_lower) {
            found.push(entry.clone());
        }
        let key = normalize_path_key(&entry.path);
        if visited.iter().any(|seen| seen == &key) {
            continue;
        }
        visited.push(key);
        stack.push(ScanFrame { entries: file_system.list_dir(&entry.path)?, next: 0 });
    }
    Ok(found)
}

/// `buildClassqPlan` (`core.ts:122-158`), returning the finished `ClassqData` record.
pub fn build_classq_plan(
    input: &NormalizedClassqInput,
    file_system: &dyn ClassqFileSystem,
) -> Result<ClassqData, ClassqRuntimeError> {
    let keyword_lower = input.keyword.to_lowercase();
    let mut items: Vec<ClassqPlanItem> = Vec::new();

    for root in &input.paths {
        let info = file_system.path_info(root);
        if !info.exists || !info.is_directory {
            items.push(unusable_root_item(root, "root_not_directory"));
            continue;
        }

        let keyword_folders = find_keyword_folders(root, &keyword_lower, file_system)?;
        if keyword_folders.is_empty() {
            items.push(unusable_root_item(root, "keyword_folder_missing"));
            continue;
        }

        // `core.ts:138`: the parent dedupe is scoped to one root, so a second root re-plans its own parents.
        let mut processed_parents: Vec<String> = Vec::new();
        for keyword_folder in &keyword_folders {
            let parent = path_dirname(&keyword_folder.path);
            let parent_key = normalize_path_key(&parent);
            if processed_parents.iter().any(|seen| seen == &parent_key) {
                continue;
            }
            processed_parents.push(parent_key);
            items.push(keyword_item(root, &parent, keyword_folder, &input.wait_keyword));

            let wait_dir = join_path(&parent, &input.wait_keyword);
            for sibling in file_system.list_dir(&parent)? {
                if normalize_path_key(&sibling.path) == normalize_path_key(&keyword_folder.path) {
                    continue;
                }
                if normalize_path_key(&sibling.path) == normalize_path_key(&wait_dir) {
                    continue;
                }
                if sibling.is_directory && name_contains_keyword(&sibling.name, &keyword_lower) {
                    continue;
                }
                if !sibling.is_file && !sibling.is_directory {
                    continue;
                }
                items.push(plan_wait_transfer(
                    root,
                    &keyword_folder.path,
                    &sibling,
                    &wait_dir,
                    input.existing_policy,
                    file_system,
                ));
            }
        }
    }
    Ok(build_classq_data(input, &items))
}

/// `keywordItem` (`core.ts:171-185`): the row that says "this parent is what the rule fired on".
fn keyword_item(
    root_path: &str,
    parent_path: &str,
    keyword_folder: &ClassqDirEntry,
    wait_keyword: &str,
) -> ClassqPlanItem {
    let wait_dir = join_path(parent_path, wait_keyword);
    ClassqPlanItem {
        root_path: root_path.to_owned(),
        parent_path: parent_path.to_owned(),
        keyword_path: keyword_folder.path.clone(),
        source_path: keyword_folder.path.clone(),
        target_path: wait_dir.clone(),
        source_name: keyword_folder.name.clone(),
        target_relative: path_relative(root_path, &wait_dir),
        kind: ClassqItemKind::Folder,
        stage: ClassqStage::Keyword,
        status: ClassqPlanStatus::Found,
        reason: None,
    }
}

/// `planWaitTransfer` (`core.ts:187-203`): a sibling plus its wait-folder target, marked `conflict` when the target
/// already exists.
///
/// The policy only changes the `reason` text — `skip` never removes the row (`core.ts:201`), which is why
/// `definition.json` labels it 「跳过」 while `help.safety.notes` says existing targets are "reported as conflicts and
/// skipped". `tests/plan_cases.rs` pins the difference to the reason string alone.
fn plan_wait_transfer(
    root_path: &str,
    keyword_path: &str,
    source: &ClassqDirEntry,
    wait_dir: &str,
    policy: ClassqExistingPolicy,
    file_system: &dyn ClassqFileSystem,
) -> ClassqPlanItem {
    let target_path = join_path(wait_dir, &source.name);
    let reason = if file_system.path_info(&target_path).exists {
        Some(match policy {
            ClassqExistingPolicy::Skip => "target_exists_skip",
            ClassqExistingPolicy::Merge => "target_exists",
        })
    } else {
        None
    };
    ClassqPlanItem {
        root_path: root_path.to_owned(),
        parent_path: path_dirname(&source.path),
        keyword_path: keyword_path.to_owned(),
        source_path: source.path.clone(),
        target_relative: path_relative(root_path, &target_path),
        target_path,
        source_name: source.name.clone(),
        kind: if source.is_directory { ClassqItemKind::Folder } else { ClassqItemKind::File },
        stage: ClassqStage::Wait,
        status: if reason.is_some() { ClassqPlanStatus::Conflict } else { ClassqPlanStatus::Ready },
        reason: reason.map(str::to_owned),
    }
}

/// `errorItem` (`core.ts:233-235`): the row a root that cannot be walked produces.
pub(crate) fn unusable_root_item(root: &str, reason: &str) -> ClassqPlanItem {
    let name = path_basename(root);
    ClassqPlanItem {
        root_path: root.to_owned(),
        parent_path: root.to_owned(),
        keyword_path: root.to_owned(),
        source_path: root.to_owned(),
        target_path: root.to_owned(),
        source_name: name.clone(),
        target_relative: name,
        kind: ClassqItemKind::Folder,
        stage: ClassqStage::Wait,
        status: ClassqPlanStatus::Error,
        reason: Some(reason.to_owned()),
    }
}

/// `data` (`core.ts:205-223`): the eight counters and the `errors` strings, all derived from the item list.
pub fn build_classq_data(input: &NormalizedClassqInput, items: &[ClassqPlanItem]) -> ClassqData {
    let errors = items
        .iter()
        .filter(|item| {
            item.reason.is_some()
                && (item.status == ClassqPlanStatus::Error || item.status == ClassqPlanStatus::Conflict)
        })
        .map(|item| format!("{}: {}", item.source_path, item.reason.clone().unwrap_or_default()))
        .collect::<Vec<String>>();

    ClassqData {
        action: input.action,
        keyword: input.keyword.clone(),
        wait_keyword: input.wait_keyword.clone(),
        transfer_mode: input.transfer_mode,
        items: items.to_vec(),
        root_count: input.paths.len(),
        keyword_count: count_where(items, |item| {
            item.stage == ClassqStage::Keyword && item.status == ClassqPlanStatus::Found
        }),
        ready_count: count_where(items, |item| item.status == ClassqPlanStatus::Ready),
        wait_count: count_where(items, |item| item.stage == ClassqStage::Wait),
        moved_count: count_where(items, |item| item.status == ClassqPlanStatus::Moved),
        copied_count: count_where(items, |item| item.status == ClassqPlanStatus::Copied),
        conflict_count: count_where(items, |item| item.status == ClassqPlanStatus::Conflict),
        error_count: count_where(items, |item| item.status == ClassqPlanStatus::Error),
        errors,
    }
}

/// One counter, spelled once so `error_count` cannot quietly diverge from `items`.
fn count_where(items: &[ClassqPlanItem], predicate: impl Fn(&ClassqPlanItem) -> bool) -> usize {
    items.iter().filter(|item| predicate(item)).count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::in_memory_runtime::MemoryFileSystem;
    use crate::input_normalization::{ClassqInput, normalize_classq_input};

    fn input(json: &str) -> NormalizedClassqInput {
        let parsed: ClassqInput = serde_json::from_str(json).expect("input json");
        normalize_classq_input(&parsed)
    }

    #[test]
    fn the_walk_emits_in_the_typescripts_pre_order() {
        // `core.test.ts:6-18`: one match two levels down.
        let file_system = MemoryFileSystem::new()
            .with_directory("/root", &[("series", true)])
            .with_directory("/root/series", &[("already", true)])
            .with_directory("/root/series/already", &[]);
        let found = find_keyword_folders("/root", "already", &file_system).expect("walk");
        assert_eq!(found.iter().map(|entry| entry.path.as_str()).collect::<Vec<_>>(), vec!["/root/series/already"]);

        // The pre-order claim: A is emitted while its parent is being scanned, A1 before B is reached at all.
        let nested = MemoryFileSystem::new()
            .with_directory("/root", &[("a-already", true), ("b-already", true)])
            .with_directory("/root/a-already", &[("deep-already", true)])
            .with_directory("/root/a-already/deep-already", &[])
            .with_directory("/root/b-already", &[]);
        let found = find_keyword_folders("/root", "already", &nested).expect("walk");
        assert_eq!(
            found.iter().map(|entry| entry.path.as_str()).collect::<Vec<_>>(),
            vec!["/root/a-already", "/root/a-already/deep-already", "/root/b-already"],
            "a stack machine that emitted siblings first would give /root/a-already, /root/b-already, …"
        );
    }

    #[test]
    fn counters_are_the_item_list_and_nothing_else() {
        let normalized = input(r#"{"action":"plan","paths":["/root"]}"#);
        let file_system = MemoryFileSystem::new()
            .with_directory("/root", &[("already", true), ("pending.zip", false), ("link", false)])
            .with_directory("/root/already", &[]);
        let data = build_classq_plan(&normalized, &file_system).expect("plan");
        assert_eq!(data.root_count, 1);
        assert_eq!(data.keyword_count, 1);
        assert_eq!(data.ready_count, 2);
        assert_eq!(data.wait_count, 2);
        assert_eq!(data.error_count, 0);
        assert!(data.errors.is_empty());
        // Negative control: `skipped` is reachable by no branch, so a plan never counts one.
        assert!(!data.items.iter().any(|item| item.status == ClassqPlanStatus::Skipped));
    }

    #[test]
    fn an_unusable_root_is_one_error_row_not_an_aborted_run() {
        let normalized = input(r#"{"paths":["/missing"]}"#);
        let data = build_classq_plan(&normalized, &MemoryFileSystem::new()).expect("plan");
        assert_eq!(data.items.len(), 1);
        assert_eq!(data.items[0].status, ClassqPlanStatus::Error);
        assert_eq!(data.items[0].reason.as_deref(), Some("root_not_directory"));
        assert_eq!(data.errors, vec!["/missing: root_not_directory"]);
        // Negative control: the same fixture with a real directory does not report a root problem.
        let with_root = MemoryFileSystem::new().with_directory("/root", &[("already", true)]);
        let other = build_classq_plan(&input(r#"{"paths":["/root"]}"#), &with_root).expect("plan");
        assert_eq!(other.error_count, 0, "{other:?}");
    }
}
