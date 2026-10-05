//! One Linedup run: resolve text, filter it, explain it, optionally write it.
//!
//! This is `interaction.ts`'s `runLinedupInteraction` — the operation surface the card and the
//! `/operations` protocol use — with the two file flows the same node publishes on its CLI face
//! (`cli.ts:417-451` `runFilter`, `cli.ts:307-357` `runGuidedText`) folded into the same code path, as
//! ADR-0069 requires: the business logic exists once, in the wasm.
//!
//! ## Order of effects, and why it is this order
//!
//! ```text
//! resolve source text   (sourceFile read through std::fs, or the request field)
//! resolve filter text
//! refuse blank source   (the `sourceText` required/nonBlank rules)
//! refuse empty filters  (only when requireFilterTokens is set — cli.ts:319-324)
//! partition             (filter_core::filter_lines_batched, checkpoint per CHECKPOINT_LINE_BATCH)
//! read stats + details  (filter_core::{analyze_read_lines, explain_removals})
//! write kept lines      (only when outputFile is set — cli.ts:341/441)
//! ```
//!
//! Reads come before filtering because `readGuidedFile` (`cli.ts:406-415`) stops the run there, and the
//! write comes last because `cli.ts:341`/`cli.ts:441` write after filtering. The output content is
//! `filteredLines.join("\n") + "\n"` verbatim, **including the empty case**: with nothing kept the old
//! node wrote a file holding exactly one newline, and reproducing that byte-for-byte is what lets a
//! re-run of a script compare equal.
//!
//! ## The three endings that have no TypeScript counterpart
//!
//! `runLinedupInteraction` can only succeed. A port that pretends otherwise would hide failures, and a
//! port that traps would lose the history line, so they are reported as `success: false` results
//! (ADR-0068: capability failures are data, not traps):
//!
//! * a file the host's preopen refuses,
//! * a checkpoint that answered cancellation (ADR-0066's hard stop),
//! * an empty filter list, but only for a face that asked for that guard.

use crate::contract::{LinedupData, LinedupInput, LinedupResult, blank_source_message, empty_filter_message};
use crate::file_access::LinedupFileSystem;
use crate::filter_core::{ReadStats, analyze_read_lines, explain_removals, filter_lines_batched};
use crate::line_text::{split_lines, unescape_literal_newlines, unique_non_empty_lines};
use crate::run_control::{CHECKPOINT_LINE_BATCH, LinedupRunControl};

/// Runs one Linedup operation.
#[must_use]
pub fn run_linedup(
    input: &LinedupInput,
    files: &dyn LinedupFileSystem,
    control: &mut dyn LinedupRunControl,
) -> LinedupResult {
    // `cli.ts:418-423`: a file slot wins over the inline field, and an inline field that the CLI face
    // spelled with `\n` is unescaped here — never the file contents (`cli.ts:453-458`).
    let source_text = match resolve_input_text(input, input.source_file.as_deref(), &input.source_text, files) {
        Ok(text) => text,
        Err(message) => return LinedupResult::failure(message),
    };
    let filter_text = match resolve_input_text(input, input.filter_file.as_deref(), &input.filter_text, files) {
        Ok(text) => text,
        Err(message) => return LinedupResult::failure(message),
    };

    // The one rule the node declares (`definition.json:42-53`), read against the resolved text the way
    // `runFilter` reads it against `sourceText` after the read (`cli.ts:425`).
    if let Some(message) = blank_source_message(&source_text, input.language) {
        return LinedupResult::failure(message);
    }

    let source_lines = split_lines(&source_text);
    let filter_lines = split_lines(&filter_text);

    if input.require_filter_tokens && unique_non_empty_lines(&filter_lines).is_empty() {
        return LinedupResult::failure(empty_filter_message(input.language));
    }

    let pass = filter_lines_batched(
        &source_lines,
        &filter_lines,
        input.case_sensitive,
        input.sort,
        CHECKPOINT_LINE_BATCH,
        control,
    );
    if let Some(processed) = pass.cancelled_after {
        return LinedupResult::failure(format!(
            "Linedup stopped after {processed} of {} unique line(s).",
            pass.total_lines
        ));
    }

    let stats: ReadStats = analyze_read_lines(&source_lines);
    let details = explain_removals(&source_lines, &filter_lines, input.case_sensitive);
    let data = LinedupData::from_parts(pass.outcome, stats, details);

    if let Some(path) = input.output_file.as_deref() {
        let content = format!("{}\n", data.filtered_lines.join("\n"));
        if let Err(failure) = files.write_text(path, &content) {
            return LinedupResult::failure(failure.to_string());
        }
    }

    LinedupResult::filtered(data)
}

/// `LinedupInput.sourceFile ? readFile(path) : field`, with the CLI's `\n` spelling resolved on the
/// inline branch only.
fn resolve_input_text(
    input: &LinedupInput,
    path: Option<&str>,
    inline: &str,
    files: &dyn LinedupFileSystem,
) -> Result<String, String> {
    match path {
        Some(path) => files.read_text(path).map_err(|failure| failure.to_string()),
        None if input.unescape_literal_newlines => Ok(unescape_literal_newlines(inline)),
        None => Ok(inline.to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::TerminalLanguage;
    use crate::file_access::NoFiles;
    use crate::memory_files::MemoryFiles;
    use crate::run_control::{CancelAfterCheckpoints, ContinueThroughRunControl};
    use serde_json::json;

    fn input(fields: serde_json::Value) -> LinedupInput {
        LinedupInput::from_json(&fields)
    }

    fn run(fields: serde_json::Value, files: &dyn LinedupFileSystem) -> LinedupResult {
        run_linedup(&input(fields), files, &mut ContinueThroughRunControl)
    }

    #[test]
    fn the_operation_surface_is_runlinedupinteraction() {
        // interaction.ts: `{ ...filterLines(...), sourceTotal, sourceUnique, details }`.
        let result = run(json!({ "sourceText": "alpha\nbeta-one\ngamma\nbeta-two", "filterText": "beta" }), &NoFiles);
        assert!(result.success, "{}", result.message);
        assert_eq!(result.message, "Filtered 2 line(s); kept 2.");
        assert_eq!(
            result.to_json()["data"],
            json!({
                "filteredLines": ["alpha", "gamma"],
                "removedLines": ["beta-one", "beta-two"],
                "removedCount": 2,
                "keptCount": 2,
                "sourceTotal": 4,
                "sourceUnique": 4,
                "details": [
                    { "line": "beta-one", "matchedFilter": "beta" },
                    { "line": "beta-two", "matchedFilter": "beta" }
                ]
            })
        );
    }

    #[test]
    fn blank_source_refuses_before_any_filtering() {
        for fields in [json!({}), json!({ "sourceText": "   " }), json!({ "sourceText": "\n\n" })] {
            let result = run(fields.clone(), &NoFiles);
            assert!(!result.success, "{fields} should not run");
            assert_eq!(result.message, "请输入原文本。");
            assert!(result.data.is_none());
        }
        // The negative control: a source of one whitespace-padded line is not blank.
        assert!(run(json!({ "sourceText": " a " }), &NoFiles).success);
    }

    #[test]
    fn an_empty_filter_list_runs_unless_the_face_asked_for_the_guard() {
        let plain = run(json!({ "sourceText": "alpha" }), &NoFiles);
        assert!(plain.success, "filterText declares no rule (definition.json:75)");
        assert_eq!(plain.data.clone().expect("data").removed_count, 0);

        let refused = run(json!({ "sourceText": "alpha", "filterText": "   ", "requireFilterTokens": true }), &NoFiles);
        assert_eq!(refused.message, "过滤 token 为空，无法过滤。");
        let english = run(
            json!({ "sourceText": "alpha", "filterText": "", "requireFilterTokens": true, "language": "en" }),
            &NoFiles,
        );
        assert_eq!(english.message, "Filter token list is empty, so no line can be removed.");
        // Negative control: one real token clears the same guard.
        assert!(
            run(json!({ "sourceText": "alpha", "filterText": "x", "requireFilterTokens": true }), &NoFiles).success,
            "the guard refuses an empty token list, not a non-matching one"
        );
    }

    #[test]
    fn file_slots_read_and_write_through_the_injected_filesystem() {
        // cli.ts:51-63 `cli.test.ts`: source.txt + filter.txt -> kept.txt, preserveOrder.
        let files = MemoryFiles::new()
            .with_file("/data/source.txt", "gamma\nbeta-one\nalpha\nbeta-two\n")
            .with_file("/data/filter.txt", "beta\n");
        let result = run(
            json!({ "sourceFile": "/data/source.txt", "filterFile": "/data/filter.txt", "outputFile": "/data/kept.txt", "sort": false }),
            &files,
        );
        assert!(result.success, "{}", result.message);
        assert_eq!(result.data.clone().expect("data").kept_count, 2);
        assert_eq!(files.contents_of("/data/kept.txt").expect("written"), "gamma\nalpha\n");
    }

    #[test]
    fn an_unreadable_input_file_is_a_result_not_a_trap() {
        let files = MemoryFiles::new().with_read_failure("/data/source.txt", "permission denied");
        let result = run(json!({ "sourceFile": "/data/source.txt", "filterText": "x" }), &files);
        assert!(!result.success);
        assert!(result.message.contains("/data/source.txt"), "{}", result.message);
        assert!(result.message.contains("permission denied"), "{}", result.message);
    }

    #[test]
    fn an_unwritable_output_file_reports_the_refusal() {
        let files = MemoryFiles::new().with_write_failure("/ro/kept.txt", "read-only file system");
        let result = run(json!({ "sourceText": "alpha", "filterText": "zz", "outputFile": "/ro/kept.txt" }), &files);
        assert_eq!(result.message, "could not write /ro/kept.txt: read-only file system");
    }

    #[test]
    fn writing_with_nothing_kept_produces_one_newline() {
        // `[""].join("\n") + "\n"` — the byte-for-byte behaviour `cli.ts:341`/`cli.ts:441` produce.
        let files = MemoryFiles::new();
        let result = run(json!({ "sourceText": "alpha", "filterText": "alpha", "outputFile": "/data/kept.txt" }), &files);
        assert!(result.success);
        assert_eq!(files.contents_of("/data/kept.txt").expect("written"), "\n");
    }

    #[test]
    fn a_cancelled_checkpoint_ends_the_run_with_what_it_reached() {
        let mut control = CancelAfterCheckpoints::new(0);
        let fields = json!({ "sourceText": "a\nb\nc\nd", "filterText": "z", "sort": true });
        let result = run_linedup(&input(fields), &NoFiles, &mut control);
        assert!(!result.success);
        assert_eq!(result.message, "Linedup stopped after 4 of 4 unique line(s).");
        assert_eq!(control.checkpoints_taken, 1, "the run stops at the first refusal");
    }

    #[test]
    fn inline_newline_unescaping_is_opt_in() {
        let escaped = json!({ "sourceText": "a\\nb", "filterText": "a" });
        let raw = run(escaped.clone(), &NoFiles);
        assert_eq!(raw.data.clone().expect("data").kept_count, 0, "one line \"a\\nb\" contains \"a\"");
        let cli = run(json!({ "sourceText": "a\\nb", "filterText": "a", "unescapeLiteralNewlines": true }), &NoFiles);
        assert_eq!(cli.data.clone().expect("data").kept_count, 1);
    }

    #[test]
    fn the_copy_language_comes_from_the_request() {
        let result = run(json!({ "sourceText": "", "language": "en" }), &NoFiles);
        assert_eq!(result.message, "Enter source text.");
        assert_eq!(LinedupInput::from_json(&json!({ "language": "EN" })).language, TerminalLanguage::En);
        assert_eq!(LinedupInput::from_json(&json!({ "language": "fr" })).language, TerminalLanguage::Zh);
    }
}
