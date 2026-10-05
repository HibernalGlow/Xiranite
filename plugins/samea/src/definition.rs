//! The behaviour half of `packages/nodes/samea/src/interaction.ts`, which is the node's own semantics and
//! must exist exactly once (ADR-0069: CLI, TUI and GUI read this, they do not re-implement it).
//!
//! What is here and why:
//! * **Input bindings** — the `transform` column of `node-definitions/samea.json:311-361`, i.e. how a form
//!   value becomes an `input` field. Spelling of the *slots* is the definition's, and
//!   `interaction.ts:43`'s `toInput` is the reference implementation.
//! * **Validation** — the three rules the definition declares
//!   (`node-definitions/samea.json:69-75`, `:97-104`, `:151-157`), evaluated the way
//!   `packages/node-definitions/src/form-bridge.ts:185-204` evaluates them, plus `interaction.ts:44`'s
//!   "at least one root" message.
//! * **The danger gate** — `interaction.ts:46` and the definition's `all(actionIs classify, not
//!   fieldTrue dryRun)` (`node-definitions/samea.json:363-384`). The gate is a function of the two facts,
//!   not a re-read of the JSON, so a face that has already resolved the fields cannot drift.
//! * **`preview` and `result_view`** — the two exports the definition names at `:399-400`, implemented from
//!   `interaction.ts:45` and `:48`.
//!
//! Field labels, group titles and the help prose are deliberately **not** duplicated here: `definition.json`
//! is the single published copy of those strings, and `tests/definition_contract.rs` checks this module
//! against it.

use serde_json::{Value, json};

use crate::contract::{
    MAX_OCCURRENCES, MIN_OCCURRENCES, SameaAction, SameaData, SameaRunResult,
};
use crate::input::NormalizedSameaInput;

/// The language half of `createSameaInteractionSchema`'s second parameter (`interaction.ts:18`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SameaLanguage {
    /// `interaction.ts:19` `zh`, the default.
    Zh,
    /// The English side.
    En,
}

impl SameaLanguage {
    /// `zh` / `en`, the two keys `LocalizedText` accepts (`packages/node-definitions/src/contract.ts:34`).
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Zh => "zh",
            Self::En => "en",
        }
    }
}

impl From<&str> for SameaLanguage {
    /// Anything unrecognised lands on `zh`, which is `language: TerminalLanguage = "zh"` at
    /// `interaction.ts:18`.
    fn from(value: &str) -> Self {
        if value == "en" { Self::En } else { Self::Zh }
    }
}

/// `interaction.ts:28`'s two options, which are also `node-definitions/samea.json:37-56`.
pub const ACTION_OPTIONS: [&str; 2] = ["plan", "classify"];

/// The `pathsText` field's `atLeastLines` minimum (`node-definitions/samea.json:99-102`).
pub const PATHS_MINIMUM_LINES: usize = 1;

/// `transform: "trim"` (`node-definitions/samea.json:312-316`).
#[must_use]
pub fn transform_trim(value: &str) -> String {
    value.trim().to_string()
}

/// `transform: "lines"` (`node-definitions/samea.json:318-321` and the four list bindings), i.e.
/// `interaction.ts:52`'s `lines`: split on newlines only, trim, drop blanks. A comma is **not** a
/// separator here, unlike `core.ts:249`'s `parseList`.
#[must_use]
pub fn transform_lines(value: &str) -> Vec<String> {
    value
        .split('\n')
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect()
}

/// `transform: "asBoolean"` (`node-definitions/samea.json:322-341`) — `interaction.ts:43` uses `=== true`
/// for the two list-less flags and `!== false` for `dryRun`.
#[must_use]
pub fn transform_as_boolean(value: Option<&Value>) -> bool {
    matches!(value, Some(Value::Bool(true)))
}

/// `transform: "asInteger"` (`node-definitions/samea.json:327-331`), i.e. `Number(values.minOccurrences ?? 1)`.
/// A value that is not a number lands on the field default, which is what `core.ts:87`'s clamp would do
/// with the `NaN` `Number("abc")` produces.
#[must_use]
pub fn transform_as_integer(value: Option<&Value>) -> i64 {
    crate::js_value::js_number_of(value)
        .map(|number| crate::js_value::js_math_round(number) as i64)
        .unwrap_or(MIN_OCCURRENCES as i64)
}

/// `oneOfDeclaredOptions` (`node-definitions/samea.json:69-75`, evaluated by
/// `packages/node-definitions/src/form-bridge.ts:195-198`).
#[must_use]
pub fn validate_action(value: &str) -> Result<(), String> {
    if ACTION_OPTIONS.contains(&value) {
        Ok(())
    } else {
        Err(format!("action must be one of {}", ACTION_OPTIONS.join(", ")))
    }
}

/// `atLeastLines` with `minimum: 1` (`node-definitions/samea.json:97-104`,
/// `form-bridge.ts:200-203`): split on runs of `\r`/`\n`, trim, drop blanks.
#[must_use]
pub fn validate_paths_text(value: &str, minimum: usize) -> Result<(), String> {
    let lines = line_count(value);
    if lines >= minimum { Ok(()) } else { Err(format!("pathsText needs at least {minimum} line(s)")) }
}

/// `integerInRange` over the declared `range` (`node-definitions/samea.json:134-157`,
/// `form-bridge.ts:185-194`).
#[must_use]
pub fn validate_min_occurrences(value: f64) -> Result<(), String> {
    if !value.is_finite() || value < MIN_OCCURRENCES as f64 || value > MAX_OCCURRENCES as f64 {
        return Err(format!("minOccurrences must be between {MIN_OCCURRENCES} and {MAX_OCCURRENCES}"));
    }
    if value.fract() != 0.0 {
        return Err("minOccurrences must be an integer".to_string());
    }
    Ok(())
}

/// `interaction.ts:44`'s `validate`, which is the rule the terminal applies after the field rules.
#[must_use]
pub fn validate_input(input: &NormalizedSameaInput, language: SameaLanguage) -> Option<String> {
    if input.paths.is_empty() {
        return Some(match language {
            SameaLanguage::Zh => "请至少输入一个归档根目录。",
            SameaLanguage::En => "Enter at least one archive root.",
        }
        .to_string());
    }
    None
}

/// The number of lines `atLeastLines` counts.
#[must_use]
pub fn line_count(value: &str) -> usize {
    value
        .split(|character| character == '\r' || character == '\n')
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .count()
}

/// `interaction.ts:46` `isDangerous`, which is the same fact the definition encodes as
/// `all(actionIs("classify"), not fieldTrue("dryRun"))`.
#[must_use]
pub fn is_dangerous(action: &SameaAction, dry_run: bool) -> bool {
    action.is_classify() && !dry_run
}

/// `interaction.ts:47`'s `dangerPrompt()` triple, which `node-definitions/samea.json:385-398` publishes.
#[must_use]
pub fn danger_prompt(language: SameaLanguage) -> Value {
    let (title, body, confirm_label) = match language {
        SameaLanguage::Zh => ("确认实时分类", "SameA 将移动就绪的归档文件。", "确认移动"),
        SameaLanguage::En => (
            "Confirm live classification",
            "SameA will move ready archives.",
            "Move archives",
        ),
    };
    json!({ "title": title, "body": body, "confirmLabel": confirm_label })
}

/// `interaction.ts:45`'s `preview(input)`, which the definition exports as `previewExport: "preview"`.
#[must_use]
pub fn preview_lines(input: &NormalizedSameaInput, language: SameaLanguage) -> Vec<String> {
    let roots_label = match language {
        SameaLanguage::Zh => "个归档根目录",
        SameaLanguage::En => "archive root(s)",
    };
    vec![
        format!("{} {roots_label}", input.paths.len()),
        format!("{} · min {}", input.action.as_str(), input.min_occurrences),
    ]
}

/// `interaction.ts:48`'s `result(result)`, which the definition exports as `resultExport: "result_view"`.
///
/// The four lines are the counter summary the terminal prints; `lines` is empty when the document carries
/// no `data`, exactly as the `result.data ? [...] : []` ternary decides.
#[must_use]
pub fn result_view_lines(result: &SameaRunResult) -> Vec<String> {
    let Some(data) = result.data.as_ref() else {
        return Vec::new();
    };
    vec![
        format!("Scanned: {}", data.scanned_count),
        format!("Ready: {}", data.ready_count),
        format!("Moved: {}", data.moved_count),
        format!("Errors: {}", data.error_count),
    ]
}

/// The `result_view` document: the same three fields `interaction.ts:48` returns.
#[must_use]
pub fn result_view(result: &SameaRunResult) -> Value {
    json!({
        "success": result.success,
        "message": result.message,
        "lines": result_view_lines(result),
    })
}

/// The `preview` document: the lines plus the normalized input they were computed from.
#[must_use]
pub fn preview_document(input: &NormalizedSameaInput, language: SameaLanguage) -> Value {
    json!({
        "preview": preview_lines(input, language),
        "input": input.to_json(),
    })
}

/// The counter projection of `data` for a host that only wants the summary.
#[must_use]
pub fn counters_of(data: &SameaData) -> Value {
    json!({
        "scannedCount": data.scanned_count,
        "detectedCount": data.detected_count,
        "readyCount": data.ready_count,
        "movedCount": data.moved_count,
        "ignoredCount": data.ignored_count,
        "skippedCount": data.skipped_count,
        "conflictCount": data.conflict_count,
        "errorCount": data.error_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn normalized(paths: Vec<String>, action: SameaAction, dry_run: bool) -> NormalizedSameaInput {
        NormalizedSameaInput {
            action,
            path: String::new(),
            paths,
            list_text: String::new(),
            ignore_path_blacklist: false,
            min_occurrences: 2,
            centralize: false,
            include_directories: false,
            skip_grouped_directories: false,
            dry_run,
            artist_blacklist: Vec::new(),
            path_blacklist: Vec::new(),
            regex_blacklist: Vec::new(),
            archive_extensions: Vec::new(),
        }
    }

    #[test]
    fn action_options_are_the_two_declared_actions() {
        assert!(validate_action("plan").is_ok());
        assert!(validate_action("classify").is_ok());
        // Negative control: anything else violates oneOfDeclaredOptions.
        assert!(validate_action("delete").is_err());
        assert!(validate_action("").is_err());
    }

    #[test]
    fn paths_text_counts_lines_and_not_commas() {
        assert!(validate_paths_text("/a\n/b", 1).is_ok());
        assert!(validate_paths_text("   ", 1).is_err(), "a blank line is not a root");
        assert!(validate_paths_text("", 1).is_err());
        assert_eq!(line_count("a\r\nb\nc"), 3);
        assert_eq!(line_count("a,b"), 1, "`atLeastLines` splits on line breaks only");
    }

    #[test]
    fn min_occurrences_range_and_integrality() {
        assert!(validate_min_occurrences(1.0).is_ok());
        assert!(validate_min_occurrences(100.0).is_ok());
        assert!(validate_min_occurrences(0.0).is_err());
        assert!(validate_min_occurrences(101.0).is_err());
        assert!(validate_min_occurrences(2.5).is_err(), "integerInRange rejects a fraction");
        assert!(validate_min_occurrences(f64::NAN).is_err());
    }

    #[test]
    fn the_input_rule_is_the_empty_roots_message() {
        let empty = normalized(Vec::new(), SameaAction::Plan, true);
        assert_eq!(
            validate_input(&empty, SameaLanguage::En),
            Some("Enter at least one archive root.".to_string())
        );
        assert_eq!(
            validate_input(&empty, SameaLanguage::Zh),
            Some("请至少输入一个归档根目录。".to_string())
        );
        // Negative control: one root clears the rule.
        let filled = normalized(vec!["/archive".to_string()], SameaAction::Plan, true);
        assert_eq!(validate_input(&filled, SameaLanguage::En), None);
    }

    #[test]
    fn only_classify_with_dry_run_off_is_dangerous() {
        assert!(is_dangerous(&SameaAction::Classify, false));
        // Negative controls: the three combinations that must not open the gate.
        assert!(!is_dangerous(&SameaAction::Classify, true), "classify stays safe while dryRun holds");
        assert!(!is_dangerous(&SameaAction::Plan, false));
        assert!(!is_dangerous(&SameaAction::from("rename"), false), "an unknown label is not classify");
    }

    #[test]
    fn preview_lines_carry_roots_and_threshold() {
        let input = normalized(vec!["/a".to_string(), "/b".to_string()], SameaAction::Plan, true);
        assert_eq!(
            preview_lines(&input, SameaLanguage::En),
            vec!["2 archive root(s)".to_string(), "plan · min 2".to_string()]
        );
        assert_eq!(
            preview_lines(&input, SameaLanguage::Zh),
            vec!["2 个归档根目录".to_string(), "plan · min 2".to_string()]
        );
    }

    #[test]
    fn result_view_is_success_message_and_four_counter_lines() {
        let data = crate::contract::SameaData {
            action: SameaAction::Plan,
            centralize: false,
            min_occurrences: 1,
            items: Vec::new(),
            groups: Vec::new(),
            scanned_count: 3,
            detected_count: 2,
            ready_count: 1,
            moved_count: 0,
            ignored_count: 2,
            skipped_count: 0,
            conflict_count: 0,
            error_count: 0,
            errors: Vec::new(),
        };
        let result = SameaRunResult { success: true, message: "done".to_string(), data: Some(data) };
        assert_eq!(
            result_view(&result),
            json!({
                "success": true,
                "message": "done",
                "lines": ["Scanned: 3", "Ready: 1", "Moved: 0", "Errors: 0"]
            })
        );
        // Negative control: a result without data has no lines at all.
        let empty = SameaRunResult { success: false, message: "boom".to_string(), data: None };
        assert_eq!(result_view(&empty)["lines"], json!([]));
    }

    #[test]
    fn transforms_match_the_declared_bindings() {
        assert_eq!(transform_trim("  classify  "), "classify");
        assert_eq!(
            transform_lines("pixiv\n twitter \n\nvarious"),
            vec!["pixiv".to_string(), "twitter".to_string(), "various".to_string()]
        );
        assert!(transform_as_boolean(Some(&json!(true))));
        assert!(!transform_as_boolean(Some(&json!("true"))), "interaction.ts:43 compares to `=== true`");
        assert_eq!(transform_as_integer(Some(&json!("7"))), 7);
        assert_eq!(transform_as_integer(None), 1, "`Number(values.minOccurrences ?? 1)`");
    }
}
