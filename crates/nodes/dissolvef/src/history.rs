//! The undo journal: parse, dump, id shape, and where the file lives.
//!
//! Port of `parseDissolveHistory` / `dumpDissolveHistory` / `historyPath` and the two normalizers behind
//! them (`core.ts:251-264`, `core.ts:799-801`, `core.ts:818-870`). Two consumers have to be satisfied at
//! once, so the parser is deliberately tolerant:
//!
//! - files this node wrote itself: an array of records, camelCase, `operations` with `sourcePath`;
//! - journals left by the older Python tool (`core.test.ts:114-146`): a single record, not an array, with
//!   `src`/`dst` keys and a `null` `dst` on a `delete_dir`.
//!
//! Parsing is total: anything that is not a record is dropped, and undumpable JSON yields an empty history
//! rather than an error — which is exactly what `core.ts:253-259`'s `try`/`catch` did.

use serde_json::Value;

use crate::contract::{NormalizedDissolvefInput, DissolvefRunScope};
use crate::document::{
    DissolveUndoMode, DissolveUndoOperation, DissolveUndoRecord, DissolvefOperation,
};

/// `parseDissolveHistory` (`core.ts:251-260`).
#[must_use]
pub fn parse_dissolve_history(content: Option<&str>) -> Vec<DissolveUndoRecord> {
    let Some(content) = content else { return Vec::new() };
    if content.trim().is_empty() {
        return Vec::new();
    }
    let Ok(parsed) = serde_json::from_str::<Value>(content) else {
        return Vec::new();
    };
    // `Array.isArray(parsed) ? parsed : [parsed]` — a lone record is still a history of one.
    let candidates: Vec<&Value> = match &parsed {
        Value::Array(items) => items.iter().collect(),
        other => vec![other],
    };
    candidates.into_iter().filter_map(normalize_undo_record).collect()
}

/// `dumpDissolveHistory` (`core.ts:262-264`): two-space pretty JSON plus the trailing newline.
#[must_use]
pub fn dump_dissolve_history(records: &[DissolveUndoRecord]) -> String {
    let body = serde_json::to_string_pretty(records)
        .unwrap_or_else(|_| "[]".to_string());
    format!("{body}\n")
}

/// `historyPath` (`core.ts:799-801`).
///
/// `runtime.defaultHistoryPath()` was a `platform.ts:21-25` value derived from the Xiranite config
/// directory, so it now arrives as `runOptions.defaultHistoryPath`. When the host supplies neither, the
/// caller gets a structured failure instead of a silently empty path being written to the machine.
#[must_use]
pub fn resolve_history_path(
    input: &NormalizedDissolvefInput,
    scope: &DissolvefRunScope,
) -> Option<String> {
    if !input.history_path.is_empty() {
        return Some(input.history_path.clone());
    }
    if scope.default_history_path.is_empty() {
        None
    } else {
        Some(scope.default_history_path.clone())
    }
}

/// The id `recordUndoIfNeeded` builds (`core.ts:538`): `dissolve-<timestamp tag>-<unique suffix>`.
#[must_use]
pub fn dissolve_record_id(
    timestamp_iso: &str,
    scope: &DissolvefRunScope,
    path: &str,
    operations: &[DissolveUndoOperation],
) -> String {
    let suffix = scope
        .undo_record_id_suffix
        .clone()
        .unwrap_or_else(|| deterministic_suffix(scope, timestamp_iso, path, operations));
    format!("dissolve-{}-{suffix}", timestamp_tag(timestamp_iso))
}

/// `toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)` (`core.ts:538`).
#[must_use]
pub fn timestamp_tag(timestamp_iso: &str) -> String {
    timestamp_iso
        .chars()
        .filter(|character| !matches!(character, '-' | ':' | '.' | 'T' | 'Z'))
        .take(14)
        .collect()
}

/// The 8 characters `crypto.randomUUID().slice(0, 8)` used to be (`platform.ts:20`).
///
/// A sandboxed plugin has no randomness source and the pinned capability set has no id minting call, so the
/// suffix is a hash of everything that distinguishes this journal entry — the operation id, the host clock,
/// the dissolved path and the operation list. The host can also hand one over through
/// `runOptions.undoRecordIdSuffix` to keep the old UUID shape; either way the suffix is stable, which makes
/// the journal reproducible in tests.
fn deterministic_suffix(
    scope: &DissolvefRunScope,
    timestamp_iso: &str,
    path: &str,
    operations: &[DissolveUndoOperation],
) -> String {
    let mut digest_input = String::new();
    digest_input.push_str(&scope.operation_id);
    digest_input.push('\u{1}');
    digest_input.push_str(timestamp_iso);
    digest_input.push('\u{1}');
    digest_input.push_str(path);
    for operation in operations {
        digest_input.push('\u{1}');
        digest_input.push_str(operation.kind.as_str());
        digest_input.push('\u{2}');
        digest_input.push_str(&operation.source_path);
        if let Some(target) = &operation.target_path {
            digest_input.push('\u{2}');
            digest_input.push_str(target);
        }
    }
    // Eight characters, the width `crypto.randomUUID().slice(0, 8)` had.
    format!("{:016x}", fnv1a_64(digest_input.as_bytes()))[..8].to_string()
}

/// FNV-1a, 64-bit: a small, dependency-free, deterministic digest, which is all an id suffix needs.
fn fnv1a_64(bytes: &[u8]) -> u64 {
    const OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;
    let mut hash = OFFSET_BASIS;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(PRIME);
    }
    hash
}

/// `normalizeUndoRecord` (`core.ts:818-837`).
fn normalize_undo_record(value: &Value) -> Option<DissolveUndoRecord> {
    let record = value.as_object()?;
    let id = record.get("id")?.as_str()?.to_string();
    let timestamp = record.get("timestamp")?.as_str()?.to_string();
    let raw_operations = record.get("operations")?.as_array()?;
    let operations: Vec<DissolveUndoOperation> =
        raw_operations.iter().map(normalize_undo_operation).collect::<Option<Vec<_>>>()?;

    let mode = record
        .get("mode")
        .and_then(Value::as_str)
        .map(DissolveUndoMode::parse)
        .unwrap_or(DissolveUndoMode::Mixed);
    let path = record.get("path").and_then(Value::as_str).unwrap_or_default().to_string();
    let count = record
        .get("count")
        .and_then(Value::as_f64)
        .map(|value| value as i64)
        .unwrap_or(operations.len() as i64);
    Some(DissolveUndoRecord {
        id,
        timestamp,
        mode,
        path,
        count,
        operations,
        undone: record.get("undone").and_then(Value::as_bool),
    })
}

/// `normalizeUndoOperation` (`core.ts:839-866`), including the Python journal's `src`/`dst` spelling.
fn normalize_undo_operation(value: &Value) -> Option<DissolveUndoOperation> {
    let operation = value.as_object()?;
    let kind = match operation.get("type").and_then(Value::as_str) {
        Some("move") => DissolvefOperation::Move,
        Some("delete_dir") => DissolvefOperation::DeleteDir,
        _ => return None,
    };
    let source_path = non_empty_str(operation.get("sourcePath"))
        .or_else(|| non_empty_str(operation.get("src")))
        .unwrap_or_default();
    if source_path.is_empty() {
        return None;
    }
    let target_path = non_empty_str(operation.get("targetPath"))
        .or_else(|| non_empty_str(operation.get("dst")));
    if kind == DissolvefOperation::Move && target_path.is_none() {
        return None;
    }
    Some(DissolveUndoOperation { kind, source_path, target_path })
}

/// A JSON value read as a non-empty string, mirroring `core.ts`'s `typeof x === "string"` guards plus the
/// `!targetPath` falsy check at `core.ts:862`.
fn non_empty_str(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).filter(|text| !text.is_empty()).map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::{DissolvefInput, normalize_dissolvef_input};

    const LEGACY_JOURNAL: &str = r#"{
      "id": "dissolve-legacy",
      "timestamp": "2026-07-21T16:04:54.445129",
      "mode": "nested",
      "path": "/tmp/root",
      "count": 2,
      "operations": [
        { "type": "move", "src": "/tmp/root/outer/inner/test.txt", "dst": "/tmp/root/outer/test.txt", "timestamp": "2026-07-21T16:02:57.405605" },
        { "type": "delete_dir", "src": "/tmp/root/outer/inner", "dst": null, "timestamp": "2026-07-21T16:02:57.408122" }
      ]
    }"#;

    #[test]
    fn empty_and_broken_content_parse_as_an_empty_history() {
        assert_eq!(parse_dissolve_history(None), Vec::<DissolveUndoRecord>::new());
        assert!(parse_dissolve_history(Some("")).is_empty());
        assert!(parse_dissolve_history(Some("   \n ")).is_empty());
        assert!(parse_dissolve_history(Some("{ not json")).is_empty());
        assert!(parse_dissolve_history(Some("null")).is_empty());
        assert!(parse_dissolve_history(Some("[]")).is_empty());
        assert!(parse_dissolve_history(Some("\"a string\"")).is_empty());
    }

    #[test]
    fn a_lone_legacy_record_is_accepted_and_its_src_dst_renamed() {
        // The assertions `core.test.ts:134-139` makes.
        let parsed = parse_dissolve_history(Some(LEGACY_JOURNAL));
        assert_eq!(parsed.len(), 1);
        let record = &parsed[0];
        assert_eq!(record.id, "dissolve-legacy");
        assert_eq!(record.timestamp, "2026-07-21T16:04:54.445129");
        assert_eq!(record.mode, DissolveUndoMode::Nested);
        assert_eq!(record.path, "/tmp/root");
        assert_eq!(record.count, 2);
        assert_eq!(record.undone, None);
        assert_eq!(
            record.operations,
            vec![
                DissolveUndoOperation {
                    kind: DissolvefOperation::Move,
                    source_path: "/tmp/root/outer/inner/test.txt".to_string(),
                    target_path: Some("/tmp/root/outer/test.txt".to_string()),
                },
                DissolveUndoOperation {
                    kind: DissolvefOperation::DeleteDir,
                    source_path: "/tmp/root/outer/inner".to_string(),
                    target_path: None,
                },
            ]
        );
    }

    #[test]
    fn an_array_of_records_keeps_its_order_and_drops_unusable_entries() {
        let content = format!("[{}, {}, \"junk\", {}]", LEGACY_JOURNAL, "{}", LEGACY_JOURNAL.replace("dissolve-legacy", "dissolve-second"));
        let parsed = parse_dissolve_history(Some(&content));
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].id, "dissolve-legacy");
        assert_eq!(parsed[1].id, "dissolve-second");
    }

    #[test]
    fn a_record_is_dropped_when_any_operation_is_unusable() {
        // `core.ts:826`: `operations.length !== record.operations.length` rejects the whole record.
        for broken in [
            r#"[{"id":"a","timestamp":"t","operations":[{"type":"move","src":"/s"}]}]"#,
            r#"[{"id":"a","timestamp":"t","operations":[{"type":"move","src":"/s","dst":""}]}]"#,
            r#"[{"id":"a","timestamp":"t","operations":[{"type":"copy","src":"/s","dst":"/d"}]}]"#,
            r#"[{"id":"a","timestamp":"t","operations":[{"type":"delete_dir"}]}]"#,
            r#"[{"id":"a","timestamp":"t","operations":"nope"}]"#,
            r#"[{"timestamp":"t","operations":[]}]"#,
            r#"[{"id":"a","operations":[]}]"#,
        ] {
            assert!(parse_dissolve_history(Some(broken)).is_empty(), "{broken}");
        }
    }

    #[test]
    fn defaults_fill_mode_path_and_count_the_way_core_ts_does() {
        let parsed = parse_dissolve_history(
            Some(r#"{"id":"a","timestamp":"t","operations":[{"type":"delete_dir","sourcePath":"/s"}],"mode":"bogus","path":7,"count":"12"}"#),
        );
        let record = &parsed[0];
        assert_eq!(record.mode, DissolveUndoMode::Mixed);
        assert_eq!(record.path, "");
        // `count` is only kept when it is a number; otherwise the operation count stands in.
        assert_eq!(record.count, 1);
        assert_eq!(record.operations[0].target_path, None);
    }

    #[test]
    fn an_undone_flag_survives_a_dump_and_a_reparse() {
        let parsed = parse_dissolve_history(Some(LEGACY_JOURNAL));
        let mut record = parsed[0].clone();
        record.undone = Some(false);
        let dumped = dump_dissolve_history(&[record.clone()]);
        assert!(dumped.ends_with("\n"));
        assert!(dumped.contains("\"undone\": false"), "{dumped}");
        let reread = parse_dissolve_history(Some(&dumped));
        assert_eq!(reread, vec![record.clone()]);

        record.undone = Some(true);
        let dumped = dump_dissolve_history(&[record.clone()]);
        assert_eq!(parse_dissolve_history(Some(&dumped)), vec![record]);
    }

    #[test]
    fn a_dumped_journal_is_the_pretty_two_space_shape() {
        let parsed = parse_dissolve_history(Some(LEGACY_JOURNAL));
        let dumped = dump_dissolve_history(&parsed);
        assert_eq!(
            dumped,
            r#"[
  {
    "id": "dissolve-legacy",
    "timestamp": "2026-07-21T16:04:54.445129",
    "mode": "nested",
    "path": "/tmp/root",
    "count": 2,
    "operations": [
      {
        "type": "move",
        "sourcePath": "/tmp/root/outer/inner/test.txt",
        "targetPath": "/tmp/root/outer/test.txt"
      },
      {
        "type": "delete_dir",
        "sourcePath": "/tmp/root/outer/inner"
      }
    ]
  }
]
"#
        );
        // `core.ts:263` writes exactly `JSON.stringify(records, null, 2)` plus a newline.
        assert_eq!(dumped, dump_dissolve_history(&parse_dissolve_history(Some(&dumped))));
    }

    #[test]
    fn an_empty_history_dumps_as_an_empty_array_line() {
        assert_eq!(dump_dissolve_history(&[]), "[]\n");
    }

    #[test]
    fn record_ids_carry_the_stripped_timestamp_and_a_stable_suffix() {
        let scope = DissolvefRunScope::default();
        let operations = vec![DissolveUndoOperation {
            kind: DissolvefOperation::Move,
            source_path: "/a/b/c.txt".to_string(),
            target_path: Some("/a/c.txt".to_string()),
        }];
        let id = dissolve_record_id("2026-07-21T16:04:54.445Z", &scope, "/a", &operations);
        assert!(id.starts_with("dissolve-20260721160454-"), "{id}");
        assert_eq!(id.len(), "dissolve-".len() + 14 + 1 + 8);
        // The host may keep the UUID shape instead.
        let with_suffix = DissolvefRunScope {
            operation_id: String::new(),
            default_history_path: String::new(),
            undo_record_id_suffix: Some("deadbeef".to_string()),
        };
        assert_eq!(
            dissolve_record_id("2026-07-21T16:04:54.445Z", &with_suffix, "/a", &operations),
            "dissolve-20260721160454-deadbeef"
        );
        // Different content or a different operation id gives a different suffix, so ids cannot collide.
        let scoped = DissolvefRunScope {
            operation_id: "op-2".to_string(),
            ..DissolvefRunScope::default()
        };
        assert_ne!(
            dissolve_record_id("2026-07-21T16:04:54.445Z", &scoped, "/a", &operations),
            id
        );
        let other_path = vec![DissolveUndoOperation {
            kind: DissolvefOperation::DeleteDir,
            source_path: "/a/b".to_string(),
            target_path: None,
        }];
        assert_ne!(
            dissolve_record_id("2026-07-21T16:04:54.445Z", &scope, "/a", &other_path),
            id
        );
    }

    #[test]
    fn timestamp_tag_keeps_only_the_first_fourteen_digits() {
        assert_eq!(timestamp_tag("2026-07-21T16:04:54.445Z"), "20260721160454");
        assert_eq!(timestamp_tag("2026-07-21T16:04:54.445129"), "20260721160454");
        assert_eq!(timestamp_tag("short"), "short");
        assert_eq!(timestamp_tag(""), "");
    }

    #[test]
    fn history_path_prefers_the_input_and_then_the_host_default() {
        let scope = DissolvefRunScope {
            operation_id: String::new(),
            default_history_path: "/config/artifacts/undo/dissolvef.undo.json".to_string(),
            undo_record_id_suffix: None,
        };
        let mut input = normalize_dissolvef_input(&DissolvefInput::default());
        assert_eq!(
            resolve_history_path(&input, &scope).as_deref(),
            Some("/config/artifacts/undo/dissolvef.undo.json")
        );
        input.history_path = "/mine.json".to_string();
        assert_eq!(resolve_history_path(&input, &scope).as_deref(), Some("/mine.json"));
        let without_default = DissolvefRunScope::default();
        input.history_path = String::new();
        assert_eq!(resolve_history_path(&input, &without_default), None);
    }
}
