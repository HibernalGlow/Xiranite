//! Input normalization — `normalizeSnfInput` at `core.ts:72-83`.
//!
//! This is the only place a node's raw JSON becomes a work order, and its quirks
//! are product behaviour: a single `path` and a comma- or newline-separated
//! `listText` are both accepted, they are merged with `paths` in that order, the
//! result is de-duplicated by first occurrence, and an empty `priorityKeywords`
//! array falls back to the defaults instead of meaning "no keywords".

use crate::contract::{DEFAULT_PRIORITY_KEYWORDS, NormalizedSnfInput, SnfAction, SnfInput, SnfMode};
use crate::javascript_text::{split_list_into_trimmed_items, trim_javascript_whitespace};

/// `normalizeSnfInput(input)`.
#[must_use]
pub fn normalize_snf_input(input: &SnfInput) -> NormalizedSnfInput {
    let mut candidate_values: Vec<String> = Vec::new();
    if let Some(path) = input.path.as_deref() {
        candidate_values.push(path.to_string());
    }
    candidate_values.extend(input.paths.iter().flatten().cloned());
    candidate_values.extend(
        input
            .list_text
            .as_deref()
            .map(split_list_into_trimmed_items)
            .unwrap_or_default(),
    );

    // `uniqueClean` at core.ts:219-221: trim, drop empties, keep first occurrence.
    let mut paths: Vec<String> = Vec::new();
    for value in candidate_values {
        let cleaned = trim_javascript_whitespace(&value);
        if cleaned.is_empty() || paths.iter().any(|existing| existing == cleaned) {
            continue;
        }
        paths.push(cleaned.to_string());
    }

    let priority_keywords = match input.priority_keywords.as_deref() {
        Some(keywords) if !keywords.is_empty() => keywords.to_vec(),
        _ => DEFAULT_PRIORITY_KEYWORDS.iter().map(|keyword| (*keyword).to_string()).collect(),
    };

    NormalizedSnfInput {
        action: input.action,
        path: trim_javascript_whitespace(input.path.as_deref().unwrap_or_default()).to_string(),
        paths,
        list_text: input.list_text.clone().unwrap_or_default(),
        mode: input.mode,
        keep_timestamp: input.keep_timestamp.unwrap_or(true),
        dry_run: input.dry_run.unwrap_or(true),
        priority_keywords,
    }
}

/// The default `action` and `mode` a bare `{}` input gets, kept as functions so a
/// test can assert them without naming the enum variants twice.
pub const DEFAULT_ACTION: SnfAction = SnfAction::Plan;
pub const DEFAULT_MODE: SnfMode = SnfMode::Library;

#[cfg(test)]
mod tests {
    use super::*;

    fn normalized(raw: &str) -> NormalizedSnfInput {
        normalize_snf_input(&serde_json::from_str(raw).expect("input json"))
    }

    #[test]
    fn defaults_match_the_typescript() {
        let result = normalized("{}");
        assert_eq!(result.action, DEFAULT_ACTION);
        assert_eq!(result.mode, DEFAULT_MODE);
        assert!(result.keep_timestamp);
        assert!(result.dry_run);
        assert_eq!(result.path, "");
        assert_eq!(result.list_text, "");
        assert!(result.paths.is_empty());
        assert_eq!(
            result.priority_keywords,
            vec!["同人志", "商业", "单行", "CG", "画集"].iter().map(|k| k.to_string()).collect::<Vec<_>>()
        );
    }

    #[test]
    fn path_paths_and_list_text_merge_in_order_and_deduplicate() {
        let result = normalized(
            r#"{"path":"  D:/a  ","paths":["D:/b","D:/a"," D:/c ",""],"listText":"D:/d,D:/b\nD:/e\n\nD:/f"}"#,
        );
        assert_eq!(
            result.paths,
            vec!["D:/a", "D:/b", "D:/c", "D:/d", "D:/e", "D:/f"]
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        );
        assert_eq!(result.path, "D:/a");
    }

    #[test]
    fn an_empty_keyword_array_falls_back_but_a_blank_keyword_stays() {
        assert_eq!(normalized(r#"{"priorityKeywords":[]}"#).priority_keywords.len(), 5);
        assert_eq!(
            normalized(r#"{"priorityKeywords":[""]}"#).priority_keywords,
            vec![String::new()]
        );
        assert_eq!(
            normalized(r#"{"priorityKeywords":["CG","同人志"]}"#).priority_keywords,
            vec!["CG".to_string(), "同人志".to_string()]
        );
    }

    #[test]
    fn flags_are_honoured_when_present() {
        let result = normalized(r#"{"action":"rename","mode":"artist","keepTimestamp":false,"dryRun":false}"#);
        assert_eq!(result.action, SnfAction::Rename);
        assert_eq!(result.mode, SnfMode::Artist);
        assert!(!result.keep_timestamp);
        assert!(!result.dry_run);
    }
}
