//! The boundary documents: what one Linedup call takes and what it answers.
//!
//! The shapes are `packages/nodes/linedup/src/interaction.ts`'s own types, kept field-for-field
//! because ADR-0063 preserves the HTTP/Operation protocol and the React card reads these keys today:
//!
//! ```text
//! LinedupInput   { sourceText, filterText, caseSensitive, sort }        interaction.ts
//! LinedupResult  { success, message, data }                             interaction.ts
//! data           { filteredLines, removedLines, removedCount, keptCount,
//!                 sourceTotal, sourceUnique, details[{line, matchedFilter}] }
//! ```
//!
//! `data` is `filterLines`' result spread (`...r`) plus the two read-stat fields plus the removal
//! details, so the field order in `interaction.ts`'s declaration and the values in
//! [`crate::filter_core`] are the same numbers the old core produced.
//!
//! ## Three fields the TypeScript interface does not have
//!
//! They are the CLI face's inputs (`cli.ts:44-53`), which ADR-0069 routes through this same business
//! implementation instead of a second copy:
//!
//! * `sourceFile` / `filterFile` / `outputFile` — text paths the host resolves for the node through
//!   `xiranite_node_registry::NodeHost::read_text` / `..::write_text` (ADR-0073 replaced the WASI
//!   preopens ADR-0071 had used); absent on every operation request, because `definition.json`
//!   publishes no path field.
//! * `unescapeLiteralNewlines` — `--source`/`--filter` spell a line break as `\n` (`cli.ts:457`,
//!   `cli.ts:308-309`); a GUI paste must not run that replacement or a path token containing `\n`
//!   would split. Default `false`.
//! * `requireFilterTokens` — the guided flow refuses an empty filter list before running
//!   (`cli.ts:319-324`); the operation surface does not, because `filterText` declares no rule
//!   (`definition.json:75`). Default `false`.
//!
//! ## Coercion follows `toInput`, not serde
//!
//! `interaction.ts`'s `toInput` is `String(v.sourceText ?? "")` and `v.caseSensitive !== false`.
//! Those are JS coercions with observable results that `serde`'s typed deserialization would refuse
//! (a `null` text field, the string `"off"` as a boolean), and ADR-0069 says the published data
//! contract is read by all three faces, so the coercion is ported here rather than re-derived per
//! face. Unknown fields are ignored, matching `{ ...clean(d) }`'s tolerance.

use serde::Serialize;
use serde_json::Value;

use crate::filter_core::{FilterOutcome, ReadStats, RemovalDetail};
use crate::line_text::js_trim;

/// The one action `definition.json:12-20` publishes.
pub const LINEDUP_ACTION: &str = "filter";

/// `TerminalLanguage` (`packages/cli-runtime/src/i18n.ts:3`), the copy language of the terminal and
/// the message strings `interaction.ts` picks from. Default `zh`, which is that function's own
/// default parameter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TerminalLanguage {
    #[default]
    /// Chinese copy.
    Zh,
    /// English copy.
    En,
}

impl TerminalLanguage {
    /// Parses `"en"` (case-insensitively) as [`Self::En`]; everything else is [`Self::Zh`].
    #[must_use]
    pub fn from_text(text: &str) -> Self {
        if text.eq_ignore_ascii_case("en") { Self::En } else { Self::Zh }
    }

    /// The `zh`/`en` tag, for round-tripping through a request document.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Zh => "zh",
            Self::En => "en",
        }
    }
}

/// One Linedup request.
#[derive(Debug, Clone, PartialEq)]
pub struct LinedupInput {
    /// `LinedupInput.sourceText`, already coerced by [`LinedupInput::from_json`].
    pub source_text: String,
    /// `LinedupInput.filterText`.
    pub filter_text: String,
    /// `LinedupInput.caseSensitive`, the `?? true` of `core.ts:30` after `!== false`.
    pub case_sensitive: bool,
    /// `LinedupInput.sort`; only `false` preserves order (`core.ts:47`).
    pub sort: bool,
    /// `--sourceFile` (`cli.ts:46`).
    pub source_file: Option<String>,
    /// `--filterFile` (`cli.ts:47`).
    pub filter_file: Option<String>,
    /// `--outputFile` (`cli.ts:49`).
    pub output_file: Option<String>,
    /// Whether text fields carry `\n` escapes, the CLI flag contract.
    pub unescape_literal_newlines: bool,
    /// Whether an empty filter list refuses the run, the guided-flow contract.
    pub require_filter_tokens: bool,
    /// Copy language, for [`LinedupInput::validate_source_text`] and [`LinedupInput::preview_lines`].
    pub language: TerminalLanguage,
}

impl Default for LinedupInput {
    /// `interaction.ts`'s `initialValues`: `sourceText ""`, `filterText ""`, both booleans true.
    fn default() -> Self {
        Self {
            source_text: String::new(),
            filter_text: String::new(),
            case_sensitive: true,
            sort: true,
            source_file: None,
            filter_file: None,
            output_file: None,
            unescape_literal_newlines: false,
            require_filter_tokens: false,
            language: TerminalLanguage::default(),
        }
    }
}

impl LinedupInput {
    /// `interaction.ts`'s `toInput` over a request document, with the three CLI-only slots read by
    /// the same rules their flags use.
    #[must_use]
    pub fn from_json(request: &Value) -> Self {
        let mut input = Self::default();
        let Some(object) = request.as_object() else {
            // `String(undefined ?? "")` on every field: a request that is not an object behaves like
            // an absent one, so the defaults above stand and the run reports the blank-source rule.
            return input;
        };

        input.source_text = js_text_of(object.get("sourceText"));
        input.filter_text = js_text_of(object.get("filterText"));
        input.case_sensitive = not_false(object.get("caseSensitive"));
        input.sort = not_false(object.get("sort"));
        input.source_file = js_path_of(object.get("sourceFile"));
        input.filter_file = js_path_of(object.get("filterFile"));
        input.output_file = js_path_of(object.get("outputFile"));
        input.unescape_literal_newlines = not_false_absent(object.get("unescapeLiteralNewlines"), false);
        input.require_filter_tokens = not_false_absent(object.get("requireFilterTokens"), false);
        if let Some(language) = object.get("language").and_then(Value::as_str) {
            input.language = TerminalLanguage::from_text(language);
        }
        input
    }

    /// The same defaults, re-emitted as the normalized document `normalizeInput` answers with.
    #[must_use]
    pub fn to_json(&self) -> Value {
        let mut object = serde_json::Map::new();
        object.insert("sourceText".to_owned(), Value::String(self.source_text.clone()));
        object.insert("filterText".to_owned(), Value::String(self.filter_text.clone()));
        object.insert("caseSensitive".to_owned(), Value::Bool(self.case_sensitive));
        object.insert("sort".to_owned(), Value::Bool(self.sort));
        for (key, value) in [
            ("sourceFile", &self.source_file),
            ("filterFile", &self.filter_file),
            ("outputFile", &self.output_file),
        ] {
            if let Some(path) = value {
                object.insert(key.to_owned(), Value::String(path.clone()));
            }
        }
        if self.unescape_literal_newlines {
            object.insert("unescapeLiteralNewlines".to_owned(), Value::Bool(true));
        }
        if self.require_filter_tokens {
            object.insert("requireFilterTokens".to_owned(), Value::Bool(true));
        }
        object.insert("language".to_owned(), Value::String(self.language.as_str().to_owned()));
        Value::Object(object)
    }

    /// `interaction.ts`'s `validate` over this request's own field. [`blank_source_message`] carries
    /// the rule and the copy.
    #[must_use]
    pub fn validate_source_text(&self) -> Option<String> {
        blank_source_message(&self.source_text, self.language)
    }

    /// `interaction.ts`'s `preview(i)`, the two count lines the card and the terminal show before a
    /// run.
    ///
    /// The counts are not the run's counts and the difference is the point:
    /// * line count is `splitLines(sourceText).length`, which counts blank lines and the empty tail
    ///   after a trailing newline (`split_lines("a\n").len() == 2`);
    /// * filter count is `splitLines(filterText).filter(Boolean).length`, where `Boolean` is
    ///   **non-empty**, so a whitespace-only line counts as a filter token even though
    ///   `uniqueNonEmptyLines` will drop it before matching.
    #[must_use]
    pub fn preview_lines(&self) -> Vec<String> {
        use crate::line_text::split_lines;

        let source_lines = split_lines(&self.source_text).len();
        let filter_tokens = split_lines(&self.filter_text).into_iter().filter(|line| !line.is_empty()).count();
        let filter_suffix = u64::try_from(filter_tokens).unwrap_or(u64::MAX);
        let source_suffix = u64::try_from(source_lines).unwrap_or(u64::MAX);

        match self.language {
            TerminalLanguage::Zh => vec![format!("{source_suffix} 行"), format!("{filter_suffix} filters")],
            TerminalLanguage::En => vec![format!("{source_suffix} line(s)"), format!("{filter_suffix} filters")],
        }
    }
}

/// `interaction.ts`'s `validate`, as a free function so a run can apply it to text that arrived in a
/// file instead of in a field.
///
/// This is the machine reading of `definition.json`'s two `sourceText` rules (`required`, `nonBlank`,
/// lines 42-53) and it is the only rule the node declares, so a blank source never reaches
/// [`crate::filter_core::filter_lines`] on any face: the card blocks submit, `runFilter` throws
/// (`cli.ts:425-427`) and the guided flow prints 源文本为空 (`cli.ts:312-316`).
#[must_use]
pub fn blank_source_message(text: &str, language: TerminalLanguage) -> Option<String> {
    if !js_trim(text).is_empty() {
        return None;
    }
    Some(match language {
        TerminalLanguage::Zh => "请输入原文本。",
        TerminalLanguage::En => "Enter source text.",
    }
    .to_owned())
}

/// `cli.ts:319-324`'s refusal of an empty token list, for the face that opts in with
/// `requireFilterTokens`.
#[must_use]
pub const fn empty_filter_message(language: TerminalLanguage) -> &'static str {
    match language {
        TerminalLanguage::Zh => "过滤 token 为空，无法过滤。",
        // `cli.ts:321` only ever renders the Chinese panel, so the TypeScript has no English string to
        // port; this copy is ours, and a test pins it so it cannot drift silently.
        TerminalLanguage::En => "Filter token list is empty, so no line can be removed.",
    }
}

/// `LinedupResult.data`.
///
/// `Deserialize` exists because `result_view` is handed a finished result document by the host
/// (`interaction.ts`'s `result` callback takes `LinedupResult`), and every field defaults so a partial
/// document still renders rather than turning into a plugin error.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LinedupData {
    /// `filterLines().filteredLines`.
    pub filtered_lines: Vec<String>,
    /// `filterLines().removedLines`.
    pub removed_lines: Vec<String>,
    /// `filterLines().removedCount`.
    pub removed_count: u64,
    /// `filterLines().keptCount`.
    pub kept_count: u64,
    /// `analyzeReadLines(source).totalLines`.
    pub source_total: u64,
    /// `analyzeReadLines(source).uniqueLines`.
    pub source_unique: u64,
    /// `explainRemovals(source, filters, caseSensitive)`.
    pub details: Vec<RemovalDetail>,
}

impl LinedupData {
    /// The `data` object `interaction.ts` builds as `{ ...r, sourceTotal, sourceUnique, details }`.
    #[must_use]
    pub fn from_parts(outcome: FilterOutcome, stats: ReadStats, details: Vec<RemovalDetail>) -> Self {
        Self {
            filtered_lines: outcome.filtered_lines,
            removed_lines: outcome.removed_lines,
            removed_count: outcome.removed_count,
            kept_count: outcome.kept_count,
            source_total: stats.total_lines,
            source_unique: stats.unique_lines,
            details,
        }
    }
}

/// `LinedupResult` (`interaction.ts`), the `nodeRunResultSchema` triple this node actually fills.
///
/// `Deserialize` is for `result_view`, which receives the finished document; `default` keeps a sparse
/// document readable instead of failing a display call.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LinedupResult {
    /// `success`.
    pub success: bool,
    /// `message`, the history line `finishOperation()` writes.
    pub message: String,
    /// `data`, absent only on a refusal; every successful run carries it as `interaction.ts` does.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<LinedupData>,
}

impl LinedupResult {
    /// The successful document, with `interaction.ts`'s message text verbatim.
    #[must_use]
    pub fn filtered(data: LinedupData) -> Self {
        Self {
            success: true,
            message: format!("Filtered {} line(s); kept {}.", data.removed_count, data.kept_count),
            data: Some(data),
        }
    }

    /// A refusal the node reports as a result rather than as a plugin error, so the card keeps its
    /// existing error branch and the isolate never traps (ADR-0068: capability failures are data).
    #[must_use]
    pub fn failure(message: impl Into<String>) -> Self {
        Self { success: false, message: message.into(), data: None }
    }

    /// The JSON document, for a host that stores it verbatim.
    #[must_use]
    pub fn to_json(&self) -> Value {
        serde_json::to_value(self).unwrap_or_else(|_| Value::Object(serde_json::Map::new()))
    }
}

/// The `result_view` document: `interaction.ts`'s `result(r)`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinedupResultView {
    /// `r.success`, passed through rather than recomputed.
    pub success: bool,
    /// `r.message`, passed through.
    pub message: String,
    /// `["Kept: n", "Removed: n"]`, the two lines the terminal prints. No localized variant exists in
    /// the TypeScript, so none is invented here.
    pub lines: Vec<String>,
}

/// `interaction.ts`'s `result` callback.
#[must_use]
pub fn result_view_of(result: &LinedupResult) -> LinedupResultView {
    let (kept, removed) = result
        .data
        .as_ref()
        .map(|data| (data.kept_count, data.removed_count))
        .unwrap_or((0, 0));
    LinedupResultView {
        success: result.success,
        message: result.message.clone(),
        lines: vec![format!("Kept: {kept}"), format!("Removed: {removed}")],
    }
}

/// `String(v.field ?? "")`.
fn js_text_of(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(text)) => text.clone(),
        Some(Value::Bool(flag)) => flag.to_string(),
        Some(Value::Number(number)) => number.to_string(),
        Some(Value::Array(items)) => {
            // `String(["a","b"])` is `"a,b"`: elements joined by commas, each itself `String()`-ed.
            items.iter().map(|item| js_text_of(Some(item))).collect::<Vec<String>>().join(",")
        }
        Some(Value::Object(_)) => "[object Object]".to_owned(),
    }
}

/// `v.field !== false` — everything except the literal `false` (including an absent field) is true,
/// which is why `definition.json`'s `asBoolean` bindings default to `true`.
fn not_false(value: Option<&Value>) -> bool {
    !matches!(value, Some(Value::Bool(false)))
}

/// A boolean slot read with JS truthiness: absent or `null` takes `default`, everything else is
/// judged by `Boolean(v)` (`0`, `""` false; arrays and objects true, as they are in JS).
fn not_false_absent(value: Option<&Value>, default: bool) -> bool {
    match value {
        None | Some(Value::Null) => default,
        Some(other) => js_truthy(other),
    }
}

/// `Boolean(v)` for the JSON value set.
fn js_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|value| value != 0.0 && !value.is_nan()),
        Value::String(text) => !text.is_empty(),
        // In JS both of these are truthy, and a slot that arrives as a list or a map is not a `false`.
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// `if (filePath)` for a string flag (`cli.ts:454`): present means the `String()` form is non-empty
/// and the value is not the falsy `false`/`null`, and the text is handed to the host's
/// `read_text`/`write_text` unchanged (see [`crate::run`] for why nothing trims or rewrites it).
///
/// The reason this is still true after ADR-0073: the node may not analyse host-shaped paths. The
/// `wasm32-wasip1` measurement ADR-0071 §5 recorded (`is_separator('\\') == false`, one component for
/// `"C:\\windows\\system32"`) disappeared with the guest, but the host half did not — Windows path
/// truth belongs to `xiranite-core`, so no separator rewriting, no drive-letter or case-insensitive
/// comparison and no `Path::is_absolute()` branch happens here either.
fn js_path_of(value: Option<&Value>) -> Option<String> {
    match value {
        None | Some(Value::Null) | Some(Value::Bool(false)) => None,
        Some(Value::String(path)) if path.is_empty() => None,
        Some(other) => {
            let text = js_text_of(Some(other));
            (!text.is_empty()).then_some(text)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn an_empty_request_gets_the_interaction_ts_defaults() {
        let input = LinedupInput::from_json(&json!({}));
        assert_eq!(input, LinedupInput::default());
        assert!(input.case_sensitive, "core.ts:30 defaults caseSensitive to true");
        assert!(input.sort, "only an explicit false preserves order");
        assert_eq!(input.language, TerminalLanguage::Zh);
    }

    #[test]
    fn only_the_literal_false_turns_a_boolean_slot_off() {
        assert!(!LinedupInput::from_json(&json!({ "sort": false })).sort);
        assert!(LinedupInput::from_json(&json!({ "sort": "false" })).sort, "JS `!== false` on a string");
        assert!(LinedupInput::from_json(&json!({ "sort": null })).sort, "`null !== false`");
        assert!(LinedupInput::from_json(&json!({ "sort": true })).sort);
        assert!(!LinedupInput::from_json(&json!({ "caseSensitive": false })).case_sensitive);
    }

    #[test]
    fn text_slots_use_the_js_string_coercion() {
        assert_eq!(LinedupInput::from_json(&json!({ "sourceText": null })).source_text, "");
        assert_eq!(LinedupInput::from_json(&json!({ "sourceText": 12 })).source_text, "12");
        assert_eq!(LinedupInput::from_json(&json!({ "sourceText": ["a", "b"] })).source_text, "a,b");
        assert_eq!(LinedupInput::from_json(&json!({ "sourceText": true })).source_text, "true");
        assert_eq!(LinedupInput::from_json(&json!({ "sourceText": {} })).source_text, "[object Object]");
    }

    #[test]
    fn path_slots_are_present_only_when_non_empty() {
        let with_paths = LinedupInput::from_json(&json!({ "sourceFile": "source.txt", "outputFile": "" }));
        assert_eq!(with_paths.source_file.as_deref(), Some("source.txt"));
        assert_eq!(with_paths.output_file, None, "`if (filePath)` treats \"\" as absent");
        assert_eq!(with_paths.filter_file, None);
    }

    #[test]
    fn a_non_object_request_reads_as_the_empty_one() {
        assert_eq!(LinedupInput::from_json(&Value::Array(vec![])), LinedupInput::default());
        assert_eq!(LinedupInput::from_json(&json!("text")), LinedupInput::default());
    }

    #[test]
    fn normalization_round_trips_the_defaulted_document() {
        let normalized = LinedupInput::from_json(&json!({ "sourceText": "a\nb" })).to_json();
        assert_eq!(
            normalized,
            json!({ "sourceText": "a\nb", "filterText": "", "caseSensitive": true, "sort": true, "language": "zh" })
        );
        assert_eq!(LinedupInput::from_json(&normalized).to_json(), normalized, "normalize is idempotent");
    }

    #[test]
    fn validation_is_the_source_text_rule_and_nothing_else() {
        // definition.json:42-53 attaches rules to `sourceText` only; `filterText` has `rules: []`.
        assert_eq!(
            LinedupInput::default().validate_source_text().as_deref(),
            Some("请输入原文本。")
        );
        assert_eq!(
            LinedupInput { language: TerminalLanguage::En, ..Default::default() }.validate_source_text().as_deref(),
            Some("Enter source text.")
        );
        assert_eq!(LinedupInput { source_text: "  a ".to_owned(), ..Default::default() }.validate_source_text(), None);
        assert_eq!(
            LinedupInput { filter_text: String::new(), ..Default::default() }.validate_source_text().as_deref(),
            Some("请输入原文本。"),
            "an empty filter list is not a validation failure"
        );
    }

    #[test]
    fn whitespace_only_source_is_blank() {
        assert!(LinedupInput { source_text: " \u{A0}\n".to_owned(), ..Default::default() }.validate_source_text().is_some());
    }

    #[test]
    fn preview_counts_lines_as_the_card_sees_them() {
        let input = LinedupInput {
            source_text: "a\nb\n".to_owned(),
            filter_text: "x\n \ny".to_owned(),
            ..Default::default()
        };
        // `splitLines("a\nb\n").length` is 3 and `filter(Boolean)` keeps the whitespace-only line.
        assert_eq!(input.preview_lines(), vec!["3 行".to_owned(), "3 filters".to_owned()]);
        assert_eq!(
            LinedupInput { language: TerminalLanguage::En, ..input }.preview_lines(),
            vec!["3 line(s)".to_owned(), "3 filters".to_owned()]
        );
        assert_eq!(LinedupInput::default().preview_lines(), vec!["1 行".to_owned(), "0 filters".to_owned()]);
    }

    #[test]
    fn the_success_message_is_interaction_ts_verbatim() {
        let data = LinedupData {
            filtered_lines: vec!["alpha".to_owned()],
            removed_lines: vec!["beta".to_owned(), "gamma".to_owned()],
            removed_count: 2,
            kept_count: 1,
            source_total: 3,
            source_unique: 3,
            details: Vec::new(),
        };
        let result = LinedupResult::filtered(data);
        assert_eq!(result.message, "Filtered 2 line(s); kept 1.");
        assert!(result.success);
        let document = result.to_json();
        assert_eq!(document["data"]["sourceTotal"], json!(3));
        assert_eq!(document["data"]["details"], json!([]));
    }

    #[test]
    fn the_result_view_is_the_two_count_lines() {
        let result = LinedupResult::failure("no source");
        assert_eq!(result_view_of(&result), LinedupResultView {
            success: false,
            message: "no source".to_owned(),
            lines: vec!["Kept: 0".to_owned(), "Removed: 0".to_owned()],
        });
        assert_eq!(serde_json::to_value(result_view_of(&result)).expect("json")["lines"], json!(["Kept: 0", "Removed: 0"]));
    }

    #[test]
    fn a_failure_carries_no_data_field() {
        assert_eq!(
            serde_json::to_value(LinedupResult::failure("boom")).expect("json"),
            json!({ "success": false, "message": "boom" })
        );
    }
}
