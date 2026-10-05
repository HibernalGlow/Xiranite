//! `normalizeSameaInput` (`core.ts:80-97`) and the four text helpers it is built from.
//!
//! This is the only place the node decides what a caller meant: defaults, the `1..=100` clamp, the
//! blacklist fallbacks and the clean-and-dedupe rules. Everything downstream reads
//! [`NormalizedSameaInput`] and never looks at the request document again, which is what lets the plan,
//! the CLI, the TUI and the GUI share one vocabulary (ADR-0069).
//!
//! Three TypeScript details that are easy to lose and are reproduced deliberately:
//! * an **empty** `artistBlacklist`/`pathBlacklist`/`archiveExtensions` array means "use the defaults",
//!   because `core.ts:92-95` tests `input.artistBlacklist?.length` rather than presence;
//! * an empty `regexBlacklist` stays empty (`core.ts:94` uses `?? []`), and `dryRun` defaults to `true`
//!   (`core.ts:91`), which is what makes the shipped default mode non-destructive
//!   (`node-definitions/samea.json:451`);
//! * a boolean flag reads through `??`, so `0`/`""`/`[]` keep their own truthiness instead of becoming
//!   the default (`core.ts:86-91`).

use serde_json::{Value, json};

use crate::contract::{
    DEFAULT_ARCHIVE_EXTENSIONS, DEFAULT_ARTIST_BLACKLIST, DEFAULT_PATH_BLACKLIST, MAX_OCCURRENCES,
    MIN_OCCURRENCES, SameaAction,
};
use crate::js_value::{
    js_bool_or_fallback, js_math_round, js_number_of, js_string_of_value, unique_preserving_order,
};

/// `Required<SameaInput>` (`core.ts:6-23` with every default resolved).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedSameaInput {
    /// `core.ts:82`.
    pub action: SameaAction,
    /// `core.ts:83`, the single-path spelling.
    pub path: String,
    /// `core.ts:84`, `path` + `paths` + `listText` cleaned and deduplicated.
    pub paths: Vec<String>,
    /// `core.ts:85`.
    pub list_text: String,
    /// `core.ts:86`.
    pub ignore_path_blacklist: bool,
    /// `core.ts:87`, clamped into [`MIN_OCCURRENCES`]..=[`MAX_OCCURRENCES`].
    pub min_occurrences: usize,
    /// `core.ts:88`.
    pub centralize: bool,
    /// `core.ts:89`, first-level directories become work items. Not exposed by
    /// `interaction.ts:27-38`, but part of the node's input contract.
    pub include_directories: bool,
    /// `core.ts:90`, do not descend into `[Artist]` folders. Also definition-hidden but reachable.
    pub skip_grouped_directories: bool,
    /// `core.ts:91`.
    pub dry_run: bool,
    /// `core.ts:92`.
    pub artist_blacklist: Vec<String>,
    /// `core.ts:93`.
    pub path_blacklist: Vec<String>,
    /// `core.ts:94`.
    pub regex_blacklist: Vec<String>,
    /// `core.ts:95`, lowercased.
    pub archive_extensions: Vec<String>,
}

impl NormalizedSameaInput {
    /// The normalized document `normalizeInput` answers with: every field the node resolved, under the
    /// same camelCase keys `core.ts:80-97` reads.
    #[must_use]
    pub fn to_json(&self) -> Value {
        json!({
            "action": self.action.as_str(),
            "path": self.path,
            "paths": self.paths,
            "listText": self.list_text,
            "ignorePathBlacklist": self.ignore_path_blacklist,
            "minOccurrences": self.min_occurrences,
            "centralize": self.centralize,
            "includeDirectories": self.include_directories,
            "skipGroupedDirectories": self.skip_grouped_directories,
            "dryRun": self.dry_run,
            "artistBlacklist": self.artist_blacklist,
            "pathBlacklist": self.path_blacklist,
            "regexBlacklist": self.regex_blacklist,
            "archiveExtensions": self.archive_extensions,
        })
    }
}

/// An input the old core would have thrown on, as text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SameaInputError(String);

impl std::fmt::Display for SameaInputError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// `normalizeSameaInput` (`core.ts:80`).
///
/// A non-array, non-string `paths` is reported instead of thrown. TypeScript threw
/// `TypeError: … is not iterable` from `core.ts:84`, which sits *outside* `runSamea`'s `try`
/// (`core.ts:100`), so it escaped to the host; ADR-0068 requires a plugin to answer with data rather than
/// a trap, and `run_samea` turns this into the failed result document the caller would otherwise have
/// seen as an exception.
pub fn normalize_samea_input(input: &Value) -> Result<NormalizedSameaInput, SameaInputError> {
    let path = clean(property(input, "path"));
    // `core.ts:84`: `[input.path, ...(input.paths ?? []), ...parseList(input.listText)]`.
    let mut roots: Vec<String> = vec![path.clone()];
    match property(input, "paths") {
        None | Some(Value::Null) => {}
        Some(Value::Array(items)) => {
            roots.extend(items.iter().map(|item| clean(Some(item))));
        }
        Some(Value::String(text)) => {
            // `..."​/a"` spreads to characters, which is why a bare string in `paths` silently became
            // fragments in the old core.
            roots.extend(text.chars().map(|character| clean(Some(&Value::String(character.to_string())))));
        }
        Some(other) => {
            return Err(SameaInputError(format!("{} is not iterable", describe_value(other))));
        }
    }
    roots.extend(parse_list(property(input, "listText")));

    let action = match property(input, "action") {
        None | Some(Value::Null) => SameaAction::Plan,
        Some(other) => SameaAction::from(js_string_of_value(Some(other)).as_str()),
    };

    Ok(NormalizedSameaInput {
        action,
        path,
        paths: unique_preserving_order(roots).into_iter().filter(|value| !value.is_empty()).collect(),
        list_text: js_string_or_empty(property(input, "listText")),
        ignore_path_blacklist: js_bool_or_fallback(property(input, "ignorePathBlacklist"), false),
        min_occurrences: clamp_int(
            property(input, "minOccurrences"),
            MIN_OCCURRENCES,
            MAX_OCCURRENCES,
            MIN_OCCURRENCES,
        ),
        centralize: js_bool_or_fallback(property(input, "centralize"), false),
        include_directories: js_bool_or_fallback(property(input, "includeDirectories"), false),
        skip_grouped_directories: js_bool_or_fallback(property(input, "skipGroupedDirectories"), false),
        dry_run: js_bool_or_fallback(property(input, "dryRun"), true),
        artist_blacklist: list_with_defaults(property(input, "artistBlacklist"), &DEFAULT_ARTIST_BLACKLIST)?,
        path_blacklist: list_with_defaults(property(input, "pathBlacklist"), &DEFAULT_PATH_BLACKLIST)?,
        regex_blacklist: string_list(property(input, "regexBlacklist"), &[])?,
        archive_extensions: lower_all(list_with_defaults(
            property(input, "archiveExtensions"),
            &DEFAULT_ARCHIVE_EXTENSIONS,
        )?),
    })
}

/// `clean` (`core.ts:251`): `String(value ?? "")`, trimmed, with one leading and one trailing quote
/// removed (`replace(/^['"]|['"]$/g, "")` strips each end independently).
#[must_use]
pub fn clean(value: Option<&Value>) -> String {
    let text = js_string_of_value(value);
    let trimmed = text.trim();
    let without_head = trimmed.strip_prefix(['\'', '"']).unwrap_or(trimmed);
    without_head.strip_suffix(['\'', '"']).unwrap_or(without_head).to_string()
}

/// `parseList` (`core.ts:249`): split on `\r?\n` or `,`, then `clean`, then drop empties.
#[must_use]
pub fn parse_list(value: Option<&Value>) -> Vec<String> {
    let text = js_string_of_value(value);
    let normalized = text.replace("\r\n", "\n");
    normalized
        .split(['\n', ','])
        .map(|part| clean(Some(&Value::String(part.to_string()))))
        .filter(|part| !part.is_empty())
        .collect()
}

/// `uniqueClean` (`core.ts:250`) over already-`Value` items.
#[must_use]
pub fn unique_clean(values: &[Value]) -> Vec<String> {
    unique_preserving_order(
        values.iter().map(|item| clean(Some(item))).filter(|item| !item.is_empty()).collect(),
    )
}

/// `clampInt(value, min, max, fallback)` (`core.ts:253`): `Number`, then `Math.max(min, Math.min(max,
/// Math.round(v)))`, then the fallback for `NaN`.
#[must_use]
pub fn clamp_int(value: Option<&Value>, min: usize, max: usize, fallback: usize) -> usize {
    let Some(number) = js_number_of(value) else {
        return fallback;
    };
    if !number.is_finite() {
        return fallback;
    }
    let rounded = js_math_round(number);
    let clamped = rounded.min(max as f64).max(min as f64);
    clamped as usize
}

/// `input.x?.length ? input.x : DEFAULT` then `uniqueClean` (`core.ts:92-95`).
///
/// `?.length` is the whole rule: arrays and strings have one, and numbers, booleans, objects and
/// `undefined` do not — so `minOccurrences: 5` silently takes the default list in TypeScript and must
/// here too.
fn list_with_defaults(
    value: Option<&Value>,
    defaults: &[&str],
) -> Result<Vec<String>, SameaInputError> {
    let length_is_truthy = match value {
        Some(Value::Array(items)) => !items.is_empty(),
        Some(Value::String(text)) => !text.is_empty(),
        _ => false,
    };
    if length_is_truthy { string_list(value, defaults) } else { Ok(owned(defaults)) }
}

/// `uniqueClean(array)` with the same "a non-array has no `.map`" rule as `core.ts:250`.
fn string_list(value: Option<&Value>, defaults: &[&str]) -> Result<Vec<String>, SameaInputError> {
    match value {
        None | Some(Value::Null) => Ok(owned(defaults)),
        Some(Value::Array(items)) => Ok(unique_clean(items)),
        Some(other) => Err(SameaInputError(format!("{}.map is not a function", describe_value(other)))),
    }
}

fn js_string_or_empty(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(other) => js_string_of_value(Some(other)),
    }
}

fn lower_all(values: Vec<String>) -> Vec<String> {
    values.into_iter().map(|value| value.to_lowercase()).collect()
}

fn owned(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

fn property<'value>(input: &'value Value, key: &str) -> Option<&'value Value> {
    match input {
        Value::Object(fields) => fields.get(key),
        // `input.path` on a non-object base reads `undefined` in JavaScript, which `??` then defaults.
        _ => None,
    }
}

fn describe_value(value: &Value) -> String {
    match value {
        Value::Object(_) => "#<object>".to_string(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn defaults_are_the_dry_run_plan_the_definition_declares() {
        let normalized = normalize_samea_input(&json!({})).expect("empty object normalizes");
        assert_eq!(normalized.action, SameaAction::Plan);
        assert!(normalized.dry_run, "core.ts:91 `input.dryRun ?? true`");
        assert!(!normalized.centralize);
        assert!(!normalized.include_directories);
        assert!(!normalized.skip_grouped_directories);
        assert_eq!(normalized.min_occurrences, 1);
        assert_eq!(normalized.paths, Vec::<String>::new());
        assert_eq!(normalized.artist_blacklist, owned(&DEFAULT_ARTIST_BLACKLIST));
        assert_eq!(normalized.path_blacklist, owned(&DEFAULT_PATH_BLACKLIST));
        assert!(normalized.regex_blacklist.is_empty(), "core.ts:94 has no default list");
        assert_eq!(normalized.archive_extensions, owned(&DEFAULT_ARCHIVE_EXTENSIONS));
    }

    #[test]
    fn an_empty_blacklist_falls_back_to_the_default_not_to_nothing() {
        // `core.ts:92` tests `.length`, so `[]` means "not supplied".
        let normalized = normalize_samea_input(&json!({ "artistBlacklist": [], "archiveExtensions": [] }))
            .expect("normalized");
        assert_eq!(normalized.artist_blacklist, owned(&DEFAULT_ARTIST_BLACKLIST));
        assert_eq!(normalized.archive_extensions, owned(&DEFAULT_ARCHIVE_EXTENSIONS));
        // Negative control: a one-element list is taken verbatim, default and all.
        let explicit = normalize_samea_input(&json!({ "artistBlacklist": ["various"] })).expect("normalized");
        assert_eq!(explicit.artist_blacklist, vec!["various".to_string()]);
    }

    #[test]
    fn a_valueless_blacklist_takes_the_default_because_length_is_undefined() {
        // `5?.length` and `{}?.length` are `undefined`, so `core.ts:92` lands on the default list.
        let normalized = normalize_samea_input(&json!({ "pathBlacklist": 5 })).expect("normalized");
        assert_eq!(normalized.path_blacklist, owned(&DEFAULT_PATH_BLACKLIST));
        let object = normalize_samea_input(&json!({ "pathBlacklist": { "a": 1 } })).expect("normalized");
        assert_eq!(object.path_blacklist, owned(&DEFAULT_PATH_BLACKLIST));
    }

    #[test]
    fn path_fields_merge_in_order_and_keep_trailing_slashes() {
        // `clean` (`core.ts:251`) trims whitespace and one quote per end — nothing else. A trailing
        // separator therefore survives, which is why `core.ts:153`'s `targetDir.startsWith(rootPath)`
        // prefix test and `core.ts:207`'s join both have to tolerate it.
        let normalized = normalize_samea_input(&json!({
            "path": "'/archive'",
            "paths": ["/archive", " /other/ "],
            "listText": "third,fourth\n/archive"
        }))
        .expect("normalized");
        assert_eq!(
            normalized.paths,
            vec![
                "/archive".to_string(),
                "/other/".to_string(),
                "third".to_string(),
                "fourth".to_string()
            ]
        );
        assert_eq!(normalized.path, "/archive");
        assert_eq!(normalized.list_text, "third,fourth\n/archive");
    }

    #[test]
    fn min_occurrences_clamps_and_rounds_like_clampint() {
        assert_eq!(clamp_int(Some(&json!(250)), 1, 100, 1), 100);
        assert_eq!(clamp_int(Some(&json!(-5)), 1, 100, 1), 1);
        assert_eq!(clamp_int(Some(&json!("4.6")), 1, 100, 1), 5);
        assert_eq!(clamp_int(Some(&json!("abc")), 1, 100, 1), 1, "NaN takes the fallback");
        assert_eq!(clamp_int(None, 1, 100, 1), 1);
        // Negative control: a value inside the range is not touched.
        assert_eq!(clamp_int(Some(&json!(7)), 1, 100, 1), 7);
    }

    #[test]
    fn clean_strips_one_quote_from_each_end_and_parse_list_splits_both_separators() {
        assert_eq!(clean(Some(&json!("\"a b\""))), "a b");
        assert_eq!(clean(Some(&json!("  'x'  "))), "x");
        assert_eq!(clean(Some(&json!("\"\""))), "", "both ends go, leaving nothing");
        assert_eq!(parse_list(Some(&json!("a\r\nb,c\nd"))), vec!["a", "b", "c", "d"]);
        assert_eq!(parse_list(Some(&json!("a\rb"))), vec!["a\rb"], "a lone \\r is not a separator");
    }

    #[test]
    fn extensions_are_lowercased_after_deduplication_and_a_non_array_paths_is_reported() {
        // `core.ts:95` is `uniqueClean(list).map(toLowerCase)`: the dedupe happens on the original
        // spelling, so `".ZIP"` and `".zip"` both survive and both land lowercased. Harmless — the
        // membership test at `core.ts:243` is a `some()` over the list — but it is what the node does, and
        // an assertion that "corrected" it would hide the order of those two calls.
        let normalized =
            normalize_samea_input(&json!({ "archiveExtensions": [".ZIP", ".7z", ".zip"] })).expect("normalized");
        assert_eq!(
            normalized.archive_extensions,
            vec![".zip".to_string(), ".7z".to_string(), ".zip".to_string()]
        );
        // Negative control: an exact duplicate does collapse.
        let deduped =
            normalize_samea_input(&json!({ "archiveExtensions": [".zip", ".zip"] })).expect("normalized");
        assert_eq!(deduped.archive_extensions, vec![".zip".to_string()]);

        let error = normalize_samea_input(&json!({ "paths": { "a": 1 } })).expect_err("objects are not iterable");
        assert!(error.to_string().ends_with("is not iterable"), "{error}");
        // Negative control: the same document with an array reads fine.
        assert!(normalize_samea_input(&json!({ "paths": [{ "a": 1 }] })).is_ok());
    }
}
