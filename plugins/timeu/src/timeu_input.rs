//! Input normalization, ported from `normalizeTimeuInput` (`core.ts:80-91`).
//!
//! This is the whole "rule matching" half of TimeU before any host call: how the
//! card's JSON becomes the list of paths to work on and the flag defaults. It is
//! deliberately permissive, because the TypeScript read properties with `??`,
//! `String(value ?? "")` and truthiness instead of validating them, and the
//! preserved React card (`src/nodes/timeu/Component.tsx:493-495`) sends values the
//! old core had to accept.
//!
//! `TimeuInput` keeps raw `serde_json::Value`s rather than typed options so the
//! coercions below are the only place JS semantics are encoded.

use serde_json::Value;

use crate::js_value::{
    SpreadMembers, js_bool_or_fallback, js_string_of_value, js_string_or_fallback, property_of,
    spread_members,
};
use crate::timeu_model::TimeuAction;
use crate::timeu_runtime::TimeuHostError;

/// `TimeuInput` (`core.ts:6-15`), uncoerced.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct TimeuInput {
    pub action: Option<Value>,
    pub path: Option<Value>,
    pub paths: Option<Value>,
    pub list_text: Option<Value>,
    pub record_path: Option<Value>,
    pub recursive: Option<Value>,
    pub include_directories: Option<Value>,
    pub dry_run: Option<Value>,
}

impl TimeuInput {
    /// Reads the eight known properties off any JSON value. A non-object base
    /// reads as an all-absent input, which is what `input.path` did in JavaScript
    /// for a string or number base.
    pub fn from_json(value: &Value) -> Self {
        let base = Some(value);
        Self {
            action: property_of(base, "action").cloned(),
            path: property_of(base, "path").cloned(),
            paths: property_of(base, "paths").cloned(),
            list_text: property_of(base, "listText").cloned(),
            record_path: property_of(base, "recordPath").cloned(),
            recursive: property_of(base, "recursive").cloned(),
            include_directories: property_of(base, "includeDirectories").cloned(),
            dry_run: property_of(base, "dryRun").cloned(),
        }
    }
}

/// `Required<TimeuInput>` (`core.ts:80`), after coercion and de-duplication.
#[derive(Debug, Clone, PartialEq)]
pub struct NormalizedTimeuInput {
    pub action: TimeuAction,
    pub path: String,
    pub paths: Vec<String>,
    pub list_text: String,
    pub record_path: String,
    pub recursive: bool,
    pub include_directories: bool,
    pub dry_run: bool,
}

impl NormalizedTimeuInput {
    /// The document the `normalizeInput` entry point answers with. Key names match
    /// `Required<TimeuInput>` so the host can render or persist it unchanged.
    pub fn to_json(&self) -> Value {
        Value::Object(serde_json::Map::from_iter([
            ("action".to_string(), Value::String(self.action.as_text().to_string())),
            ("path".to_string(), Value::String(self.path.clone())),
            (
                "paths".to_string(),
                Value::Array(self.paths.iter().cloned().map(Value::String).collect()),
            ),
            ("listText".to_string(), Value::String(self.list_text.clone())),
            ("recordPath".to_string(), Value::String(self.record_path.clone())),
            ("recursive".to_string(), Value::Bool(self.recursive)),
            ("includeDirectories".to_string(), Value::Bool(self.include_directories)),
            ("dryRun".to_string(), Value::Bool(self.dry_run)),
        ]))
    }
}

/// `clean` (`core.ts:267`): `String(value ?? "").trim()`.
pub fn clean(value: Option<&Value>) -> String {
    js_string_of_value(value).trim().to_string()
}

/// `parseList` (`core.ts:259`): split on `\r?\n` or `,`, trim, drop empties.
pub fn parse_list(value: Option<&Value>) -> Vec<String> {
    js_string_of_value(value)
        .split(['\n', ','])
        .map(|piece| {
            piece
                .strip_suffix('\r')
                .unwrap_or(piece)
                .trim()
                .to_string()
        })
        .filter(|piece| !piece.is_empty())
        .collect()
}

/// `uniqueClean` (`core.ts:263`): clean, drop empties, keep first-seen order.
pub fn unique_clean(values: &[Option<&Value>]) -> Vec<String> {
    let mut cleaned: Vec<String> = Vec::new();
    for value in values {
        let text = clean(*value);
        if text.is_empty() {
            continue;
        }
        if !cleaned.iter().any(|existing| existing == &text) {
            cleaned.push(text);
        }
    }
    cleaned
}

/// `input.action ?? "scan"` (`core.ts:82`), keeping unrecognised values the way
/// the TypeScript comparisons kept them.
pub fn timeu_action_from_value(value: Option<&Value>) -> TimeuAction {
    match value {
        None | Some(Value::Null) => TimeuAction::DEFAULT,
        Some(Value::String(text)) => TimeuAction::from_text(text),
        Some(other) => TimeuAction::Other(js_string_of_value(Some(other))),
    }
}

/// `normalizeTimeuInput`. The only way it fails is the way `core.ts:84` could
/// fail: spreading a `paths` value that is not iterable.
pub fn normalize_timeu_input(input: &TimeuInput) -> Result<NormalizedTimeuInput, TimeuHostError> {
    let spread = match spread_members(input.paths.as_ref()) {
        SpreadMembers::Elements(items) => items,
        SpreadMembers::Characters(characters) => characters,
        SpreadMembers::NotIterable => {
            return Err(TimeuHostError::new(
                "input.paths is not iterable",
            ));
        }
    };

    let mut members: Vec<Option<&Value>> = Vec::with_capacity(spread.len() + 2);
    // `[input.path, ...(input.paths ?? []), ...parseList(input.listText)]`
    // (`core.ts:84`): the single `path` first, then the array, then the queue.
    members.push(input.path.as_ref());
    for item in &spread {
        members.push(Some(item));
    }
    let list_members = parse_list(input.list_text.as_ref());
    let list_values: Vec<Value> = list_members.into_iter().map(Value::String).collect();
    for item in &list_values {
        members.push(Some(item));
    }

    Ok(NormalizedTimeuInput {
        action: timeu_action_from_value(input.action.as_ref()),
        path: clean(input.path.as_ref()),
        paths: unique_clean(&members),
        list_text: js_string_or_fallback(input.list_text.as_ref(), ""),
        record_path: clean(input.record_path.as_ref()),
        recursive: js_bool_or_fallback(input.recursive.as_ref(), true),
        include_directories: js_bool_or_fallback(input.include_directories.as_ref(), false),
        dry_run: js_bool_or_fallback(input.dry_run.as_ref(), true),
    })
}

pub fn normalize_timeu_input_json(value: &Value) -> Result<NormalizedTimeuInput, TimeuHostError> {
    normalize_timeu_input(&TimeuInput::from_json(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn normalized(value: Value) -> NormalizedTimeuInput {
        normalize_timeu_input_json(&value).expect("normalizable")
    }

    #[test]
    fn defaults_match_the_typescript_fallbacks() {
        let input = normalized(json!({}));
        assert_eq!(input.action, TimeuAction::Scan);
        assert_eq!(input.path, "");
        assert!(input.paths.is_empty());
        assert_eq!(input.list_text, "");
        assert_eq!(input.record_path, "");
        assert!(input.recursive, "core.ts:87 defaults recursive to true");
        assert!(!input.include_directories);
        assert!(input.dry_run, "core.ts:89 defaults dryRun to true");
    }

    #[test]
    fn explicit_false_stays_false_because_question_question_is_nullish_only() {
        let input = normalized(json!({ "dryRun": false, "recursive": false }));
        assert!(!input.dry_run);
        assert!(!input.recursive);
    }

    #[test]
    fn path_sources_are_cleaned_merged_and_deduplicated() {
        let cases: [(&str, Value, Vec<&str>); 6] = [
            ("single path", json!({ "path": "  /root/a.txt  " }), vec!["/root/a.txt"]),
            ("array order", json!({ "paths": ["/root/b.txt", "/root/a.txt"] }), vec!["/root/b.txt", "/root/a.txt"]),
            ("comma queue", json!({ "listText": "a.txt,b.txt" }), vec!["a.txt", "b.txt"]),
            ("crlf queue", json!({ "listText": "a.txt\r\nb.txt\r\n" }), vec!["a.txt", "b.txt"]),
            (
                "path then array then queue, first-seen order",
                json!({ "path": "/root/a.txt", "paths": ["/root/c.txt"], "listText": "/root/b.txt\n/root/a.txt" }),
                vec!["/root/a.txt", "/root/c.txt", "/root/b.txt"],
            ),
            ("blank entries dropped", json!({ "listText": " ,  , a " }), vec!["a"]),
        ];
        for (label, value, expected) in cases {
            assert_eq!(normalized(value).paths, expected.iter().map(|text| text.to_string()).collect::<Vec<String>>(), "{label}");
        }
    }

    #[test]
    fn non_string_values_coerce_the_way_string_and_truthiness_do() {
        let input = normalized(json!({ "path": 12, "recursive": 0, "listText": true }));
        assert_eq!(input.path, "12");
        assert!(!input.recursive, "0 is falsy, exactly what core.ts:153 tested");
        assert_eq!(input.list_text, "true");
        assert_eq!(input.paths, vec!["12".to_string(), "true".to_string()]);
    }

    #[test]
    fn unknown_action_text_is_kept_instead_of_rejected() {
        // core.ts:109-127 falls through to the restore branch for anything that is
        // not "restore"/"scan"/"backup", so the value has to survive normalization.
        let input = normalized(json!({ "action": "wipe" }));
        assert_eq!(input.action, TimeuAction::Other("wipe".into()));
        assert!(!input.action.is_backup());
        assert!(!input.action.is_restore());
        assert!(!input.action.is_scan());
    }

    #[test]
    fn a_string_in_paths_spreads_into_characters_like_the_spread_operator() {
        let input = normalized(json!({ "paths": "/a" }));
        assert_eq!(input.paths, vec!["/".to_string(), "a".to_string()]);
    }

    #[test]
    fn a_non_iterable_paths_value_is_the_one_normalization_error() {
        let error = normalize_timeu_input_json(&json!({ "paths": { "a": 1 } })).unwrap_err();
        assert_eq!(error.message, "input.paths is not iterable");
    }

    #[test]
    fn null_values_take_the_documented_defaults() {
        let input = normalized(json!({ "action": null, "path": null, "paths": null, "recursive": null, "dryRun": null }));
        assert_eq!(input.action, TimeuAction::Scan);
        assert_eq!(input.path, "");
        assert!(input.paths.is_empty());
        assert!(input.recursive);
        assert!(input.dry_run);
    }

    #[test]
    fn parse_list_and_clean_helpers_match_their_one_liners() {
        assert_eq!(parse_list(Some(&json!("a\nb,,c"))), vec!["a".to_string(), "b".to_string(), "c".to_string()]);
        assert!(parse_list(Some(&json!("   "))).is_empty());
        assert_eq!(clean(Some(&json!("  x  "))), "x");
        assert_eq!(clean(None), "");
        assert_eq!(
            unique_clean(&[Some(&json!("a")), Some(&json!("a")), Some(&json!("")), Some(&json!(" b "))]),
            vec!["a".to_string(), "b".to_string()]
        );
    }

    #[test]
    fn timeu_input_from_json_reads_only_the_known_properties() {
        let input = TimeuInput::from_json(&json!({ "action": "scan", "unknown": 1 }));
        assert_eq!(input.action, Some(json!("scan")));
        assert_eq!(input.paths, None);
        assert_eq!(
            TimeuInput::from_json(&json!("not an object")),
            TimeuInput::default(),
            "a non-object base reads as the all-absent input, which is `input.path` on a string base"
        );
    }
}
