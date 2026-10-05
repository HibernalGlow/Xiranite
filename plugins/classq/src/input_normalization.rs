//! The input edge: what the caller sent, and what the node actually runs with.
//!
//! [`ClassqInput`] is the JSON document `ClassqInput` at `packages/nodes/classq/src/core.ts:9-19` — the payload the
//! React card, the operation request (`nodeRunRequestSchema.input`) and the old pipe mode (`cli.ts:45`) produced.
//! [`normalize_classq_input`] is `normalizeClassqInput` (`core.ts:79-91`) line for line, including its defaulting
//! order and its three-way root merge, because those defaults are the difference between "previews my typo" and
//! "moves the folder".
//!
//! Two reading rules are kept apart on purpose, since the TypeScript keeps them apart too:
//!
//! - [`parse_list`] is `core.ts:237-239` and splits `listText` on newline or comma **only**.
//! - [`split_delimited`] is the definition language's `Transform::Delimited` for the `paths` *field*
//!   (`node-definitions/classq.json` `inputBindings[1]`), which is `interaction.ts:31`'s `[\r\n,;]+` — commas,
//!   semicolons **and** newlines. A `;` therefore separates two roots when it arrives as field text and is part of a
//!   path when it arrives as `listText`. Both are covered by `tests/normalization_cases.rs`.

use serde::{Deserialize, Serialize};

use crate::contract::{ClassqAction, ClassqExistingPolicy, ClassqTransferMode};

/// The request payload (`core.ts:9-19`). Every field is optional because `normalizeClassqInput` fills each one.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ClassqInput {
    /// `action`.
    pub action: Option<ClassqAction>,
    /// `path`: the single-root legacy field, still merged into the root list (`core.ts:83`).
    pub path: Option<String>,
    /// `paths`: the bound slot, which is a list (`core.ts:11`) or the raw `path-list` field text.
    pub paths: Option<ClassqPathList>,
    /// `listText`: a free-form block of roots kept for the in-process runner (`core.ts:13`, `:83`).
    pub list_text: Option<String>,
    /// `keyword`.
    pub keyword: Option<String>,
    /// `waitKeyword`.
    pub wait_keyword: Option<String>,
    /// `transferMode`.
    pub transfer_mode: Option<ClassqTransferMode>,
    /// `existingPolicy`.
    pub existing_policy: Option<ClassqExistingPolicy>,
    /// `dryRun`.
    pub dry_run: Option<ClassqDryRun>,
}

impl ClassqInput {
    /// A plan run over one root, the shape most tests and the CLI pipe mode need.
    #[must_use]
    pub fn plan(root: &str) -> Self {
        Self {
            action: Some(ClassqAction::Plan),
            paths: Some(ClassqPathList::Values(vec![root.to_owned()])),
            ..Self::default()
        }
    }
}

/// `paths` as it may arrive: an already-bound list, or the text of the `path-list` field.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ClassqPathList {
    /// The bound slot (`core.ts:11`).
    Values(Vec<String>),
    /// The field value a face holds before binding (`node-definitions/classq.json` field `paths`, `kind`
    /// `path-list`), split with `Transform::Delimited`.
    Text(String),
}

impl ClassqPathList {
    /// The root strings this field contributes, before `unique_clean` dedupes them (`core.ts:83`).
    #[must_use]
    pub fn slots(&self) -> Vec<String> {
        match self {
            Self::Values(values) => values.clone(),
            Self::Text(text) => split_delimited(text),
        }
    }
}

/// `dryRun` as it may arrive: a flag, or the text of a `boolean` field run through `Transform::AsBoolean`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ClassqDryRun {
    /// A real boolean.
    Flag(bool),
    /// Field text such as `"false"`.
    Text(String),
}

impl ClassqDryRun {
    /// Resolve the flag. Anything unrecognized stays `None`, and `None` means the safe default `true`
    /// (`core.ts:89`), matching `definition.json`'s `dryRun` default and `help.safety.defaultMode` `"dry-run"`: a
    /// value this port cannot read never turns a preview into a live transfer.
    #[must_use]
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Self::Flag(value) => Some(*value),
            Self::Text(text) => match text.trim().to_ascii_lowercase().as_str() {
                "false" | "0" | "off" | "no" => Some(false),
                "true" | "1" | "on" | "yes" => Some(true),
                _ => None,
            },
        }
    }
}

/// Everything defaulted, exactly the `Required<ClassqInput>` the core works on (`core.ts:79`'s return type).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedClassqInput {
    /// `action`, defaulting to `plan` (`core.ts:81`).
    pub action: ClassqAction,
    /// `path`, trimmed but not merged — the raw single root (`core.ts:82`).
    pub path: String,
    /// The deduplicated root list the scan actually walks (`core.ts:83`).
    pub paths: Vec<String>,
    /// `listText`, kept verbatim so a history row can re-render the field (`core.ts:84`).
    pub list_text: String,
    /// `keyword`, never blank (`core.ts:85`).
    pub keyword: String,
    /// `waitKeyword`, never blank (`core.ts:86`).
    pub wait_keyword: String,
    /// `transferMode`, defaulting to `move` (`core.ts:87`).
    pub transfer_mode: ClassqTransferMode,
    /// `existingPolicy`, defaulting to `merge` (`core.ts:88`).
    pub existing_policy: ClassqExistingPolicy,
    /// `dryRun`, defaulting to `true` (`core.ts:89`).
    pub dry_run: bool,
}

/// `normalizeClassqInput` (`core.ts:79-91`).
#[must_use]
pub fn normalize_classq_input(input: &ClassqInput) -> NormalizedClassqInput {
    let roots = std::iter::once(input.path.as_deref().map(str::to_owned))
        .chain(input.paths.as_ref().into_iter().flat_map(|list| list.slots().into_iter().map(Some)))
        .chain(parse_list(input.list_text.as_deref()).into_iter().map(Some))
        .collect::<Vec<Option<String>>>();
    NormalizedClassqInput {
        action: input.action.unwrap_or(ClassqAction::Plan),
        path: clean(input.path.as_deref()),
        paths: unique_clean(&roots),
        list_text: input.list_text.clone().unwrap_or_default(),
        keyword: non_blank_or(clean(input.keyword.as_deref()), "already"),
        wait_keyword: non_blank_or(clean(input.wait_keyword.as_deref()), "wait"),
        transfer_mode: input.transfer_mode.unwrap_or(ClassqTransferMode::Move),
        existing_policy: input.existing_policy.unwrap_or(ClassqExistingPolicy::Merge),
        dry_run: input.dry_run.as_ref().and_then(ClassqDryRun::as_bool).unwrap_or(true),
    }
}

/// `clean` (`core.ts:245-247`): `String(value ?? "").trim()`. Rust's `trim` removes the same set of Unicode
/// whitespace for every input this node sees; a path that is only whitespace reads as empty, which is the point.
#[must_use]
pub fn clean(value: Option<&str>) -> String {
    value.unwrap_or_default().trim().to_owned()
}

/// `parseList` (`core.ts:237-239`): split on `\r?\n|,`, trim, drop blanks.
#[must_use]
pub fn parse_list(value: Option<&str>) -> Vec<String> {
    crate::text_splits::split_newline_or_comma(value.unwrap_or_default())
        .into_iter()
        .map(|part| part.trim().to_owned())
        .filter(|part| !part.is_empty())
        .collect()
}

/// The definition language's `Transform::Delimited` — `interaction.ts:31`'s `[\r\n,;]+` split.
#[must_use]
pub fn split_delimited(value: &str) -> Vec<String> {
    crate::text_splits::split_newline_comma_semicolon(value)
        .into_iter()
        .map(|part| part.trim().to_owned())
        .filter(|part| !part.is_empty())
        .collect()
}

/// `uniqueClean` (`core.ts:241-243`): clean each value, drop blanks, dedupe while keeping first-seen order.
#[must_use]
pub fn unique_clean(values: &[Option<String>]) -> Vec<String> {
    let mut seen: Vec<String> = Vec::with_capacity(values.len());
    for value in values {
        let cleaned = clean(value.as_deref());
        if cleaned.is_empty() {
            continue;
        }
        if !seen.iter().any(|existing| existing == &cleaned) {
            seen.push(cleaned);
        }
    }
    seen
}

/// `clean(x) || "already"` (`core.ts:85-86`): a blank keyword never disables the match, which would plan every
/// sibling in the tree.
#[must_use]
fn non_blank_or(value: String, fallback: &str) -> String {
    if value.is_empty() { fallback.to_owned() } else { value }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_document_is_a_dry_run_plan_over_no_roots() {
        let normalized = normalize_classq_input(&ClassqInput::default());
        assert_eq!(normalized.action, ClassqAction::Plan);
        assert_eq!(normalized.keyword, "already");
        assert_eq!(normalized.wait_keyword, "wait");
        assert_eq!(normalized.transfer_mode, ClassqTransferMode::Move);
        assert_eq!(normalized.existing_policy, ClassqExistingPolicy::Merge);
        assert!(normalized.dry_run);
        assert!(normalized.paths.is_empty());
    }

    #[test]
    fn blank_keyword_falls_back_instead_of_matching_everything() {
        let input: ClassqInput =
            serde_json::from_str(r#"{"paths":[" /root "],"keyword":"   ","waitKeyword":"\\t"}"#).expect("json");
        let normalized = normalize_classq_input(&input);
        assert_eq!(normalized.paths, vec!["/root"]);
        assert_eq!(normalized.keyword, "already");
        // Negative control for the fallback: a value that is not blank is kept, even a control-character-ish one.
        assert_eq!(normalized.wait_keyword, "\\t");
    }

    #[test]
    fn list_text_and_paths_and_the_single_root_merge_in_that_order() {
        // `core.ts:83`: `[input.path, ...input.paths, ...parseList(input.listText)]`, deduped, first-seen wins.
        let input: ClassqInput = serde_json::from_str(
            r#"{"path":"/a","paths":["/b","/a"],"listText":"/c\n/b,/d"}"#,
        )
        .expect("json");
        assert_eq!(normalize_classq_input(&input).paths, vec!["/a", "/b", "/c", "/d"]);
    }

    #[test]
    fn list_text_does_not_split_on_semicolons_but_field_text_does() {
        let from_list_text = parse_list(Some("/a;/b"));
        assert_eq!(from_list_text, vec!["/a;/b"], "core.ts:238 splits on newline or comma only");
        let from_field_text = split_delimited("/a;/b");
        assert_eq!(from_field_text, vec!["/a", "/b"], "interaction.ts:31 also splits on `;`");
    }

    #[test]
    fn a_dry_run_flag_that_cannot_be_read_keeps_the_run_dry() {
        let parsed: ClassqInput = serde_json::from_str(r#"{"dryRun":"maybe"}"#).expect("json");
        assert!(normalize_classq_input(&parsed).dry_run);
        let off: ClassqInput = serde_json::from_str(r#"{"dryRun":"false"}"#).expect("json");
        assert!(!normalize_classq_input(&off).dry_run);
        let literal: ClassqInput = serde_json::from_str(r#"{"dryRun":false}"#).expect("json");
        assert!(!normalize_classq_input(&literal).dry_run);
    }
}
