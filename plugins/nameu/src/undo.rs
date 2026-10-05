//! Undo-plan shape for a NameU batch.
//!
//! The TypeScript has no undo: an applied rename was final (`core.ts:114-130`).
//! A Rust host that keeps the applied plan can reverse it, so the plugin exposes
//! the reversal contract and leaves the writes to `std::fs::rename` on a granted
//! preopen (ADR-0071).

use serde::{Deserialize, Serialize};

use crate::contract::{NameuItemKind, NameuPlanItem, NameuPlanStatus};

/// One reversible step: move `current_path` back to `original_path`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NameuUndoPlanItem {
    pub current_path: String,
    pub original_path: String,
    pub current_name: String,
    pub original_name: String,
    pub artist_name: String,
    pub kind: NameuItemKind,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NameuUndoPlan {
    pub items: Vec<NameuUndoPlanItem>,
    pub undoable_count: usize,
    /// Rows that were never written (conflicts, errors, skips, unchanged, and
    /// ready rows from a dry run) and therefore must not be reversed.
    pub ignored_count: usize,
}

/// Only `renamed` rows are reversible, and they are reversed in the opposite
/// order of application: a folder rename and the archive renames below it can
/// otherwise target a directory that no longer exists.
pub fn build_nameu_undo_plan(applied_items: &[NameuPlanItem]) -> NameuUndoPlan {
    let mut items: Vec<NameuUndoPlanItem> = applied_items
        .iter()
        .filter(|item| item.status == NameuPlanStatus::Renamed)
        .map(|item| NameuUndoPlanItem {
            current_path: item.target_path.clone(),
            original_path: item.source_path.clone(),
            current_name: item.target_name.clone(),
            original_name: item.source_name.clone(),
            artist_name: item.artist_name.clone(),
            kind: item.kind,
        })
        .collect();
    let undoable_count = items.len();
    items.reverse();
    NameuUndoPlan {
        items,
        undoable_count,
        ignored_count: applied_items.len() - undoable_count,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(source: &str, target: &str, status: NameuPlanStatus, kind: NameuItemKind) -> NameuPlanItem {
        NameuPlanItem {
            source_path: source.to_string(),
            target_path: target.to_string(),
            source_name: source.rsplit('/').next().unwrap_or(source).to_string(),
            target_name: target.rsplit('/').next().unwrap_or(target).to_string(),
            artist_name: "Artist".to_string(),
            kind,
            status,
            reason: None,
        }
    }

    #[test]
    fn only_renamed_rows_are_reversible_and_reverse_in_order() {
        let applied = vec![
            item(
                "/library/Artist/Sub [cbr]",
                "/library/Artist/Sub",
                NameuPlanStatus::Renamed,
                NameuItemKind::Folder,
            ),
            item(
                "/library/Artist/Book [cbr].zip",
                "/library/Artist/BookArtist.zip",
                NameuPlanStatus::Renamed,
                NameuItemKind::Archive,
            ),
            item(
                "/library/Artist/Skip.zip",
                "/library/Artist/Skip.zip",
                NameuPlanStatus::Unchanged,
                NameuItemKind::Archive,
            ),
            item(
                "/library/Artist/Blocked.zip",
                "/library/Artist/Taken.zip",
                NameuPlanStatus::Conflict,
                NameuItemKind::Archive,
            ),
        ];
        let plan = build_nameu_undo_plan(&applied);
        assert_eq!(plan.undoable_count, 2);
        assert_eq!(plan.ignored_count, 2);
        assert_eq!(plan.items[0].original_path, "/library/Artist/Book [cbr].zip");
        assert_eq!(plan.items[0].current_path, "/library/Artist/BookArtist.zip");
        assert_eq!(plan.items[0].current_name, "BookArtist.zip");
        assert_eq!(plan.items[0].original_name, "Book [cbr].zip");
        assert_eq!(plan.items[1].original_path, "/library/Artist/Sub [cbr]");
        assert_eq!(plan.items[1].kind, NameuItemKind::Folder);
    }

    #[test]
    fn dry_run_plans_have_nothing_to_undo() {
        let planned = vec![item("/a/Book [cbr].zip", "/a/BookArtist.zip", NameuPlanStatus::Ready, NameuItemKind::Archive)];
        let plan = build_nameu_undo_plan(&planned);
        assert_eq!(plan.undoable_count, 0);
        assert_eq!(plan.ignored_count, 1);
        assert!(plan.items.is_empty());
    }

    #[test]
    fn undo_plan_serializes_with_the_node_dto_casing() {
        let plan = build_nameu_undo_plan(&[item(
            "/library/Artist/Book [cbr].zip",
            "/library/Artist/BookArtist.zip",
            NameuPlanStatus::Renamed,
            NameuItemKind::Archive,
        )]);
        let json = serde_json::to_string(&plan.items[0]).expect("undo item json");
        assert!(json.contains("\"currentPath\""));
        assert!(json.contains("\"originalPath\""));
        assert!(json.contains("\"artistName\":\"Artist\""));
    }
}
