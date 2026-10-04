//! One Linedup run: resolve text, filter it, explain it, optionally write it.
//!
//! This is `packages/nodes/linedup/src/interaction.ts`'s `runLinedupInteraction` — the operation
//! surface the card and the `/operations` protocol use — with the two file flows the same node
//! publishes on its CLI face (`cli.ts:417-451` `runFilter`, `cli.ts:307-357` `runGuidedText`) folded
//! into the same code path, as ADR-0069 requires: the business logic exists once, in the node crate.
//!
//! ## Order of effects, and why it is this order
//!
//! ```text
//! resolve source text   (sourceFile read through the host, or the request field)
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
//! ## The machine, through the seam
//!
//! `run_linedup` reaches the machine through `xiranite_node_registry::NodeHost` and through nothing
//! else: `read_text` for a `sourceFile`/`filterFile` slot, `write_text` for `outputFile`, `checkpoint`
//! for the batch boundary. That replaces two retired modules at once — `file_access.rs`'s
//! `LinedupFileSystem` (whose `NativeFiles` implementor was `std::fs` against WASI preopens, ADR-0071)
//! and `run_control.rs`'s `LinedupRunControl` — which is why the signature is one host instead of the
//! old `(files, control)` pair. Three consequences are kept on purpose:
//!
//! * Paths go to the host exactly as the caller spelled them ([`crate::contract::LinedupInput`]'s
//!   `js_path_of` documents why the node may not analyse them).
//! * `read_text` answering `None` is a *refusal-shaped* miss — the seam documents a missing, unreadable
//!   or ungranted path as the same answer — so it ends the run with a message naming the path, which is
//!   what the old `NoFiles` double reported for the operation surface.
//! * `Cancelled` never becomes a per-item failure. It stops the run at the arm that produced it, and a
//!   `Failure` keeps its own reason instead of borrowing the cancel's wording. See the
//!   `filter_core::yield_at_boundary` doc for the boundary arm.

use crate::contract::{LinedupData, LinedupInput, LinedupResult, blank_source_message, empty_filter_message};
use crate::filter_core::{BatchedFilterPass, CHECKPOINT_LINE_BATCH, ReadStats, analyze_read_lines, explain_removals, filter_lines_batched};
use crate::line_text::{split_lines, unescape_literal_newlines, unique_non_empty_lines};
use xiranite_node_registry::{NodeHost, NodeHostError};

/// Runs one Linedup operation.
#[must_use]
pub fn run_linedup(input: &LinedupInput, host: &mut dyn NodeHost) -> LinedupResult {
    // `cli.ts:418-423`: a file slot wins over the inline field, and an inline field that the CLI face
    // spelled with `\n` is unescaped here — never the file contents (`cli.ts:453-458`).
    let source_text = match resolve_input_text(input, input.source_file.as_deref(), &input.source_text, host) {
        Ok(text) => text,
        Err(Stop::Cancelled) => return LinedupResult::failure(cancelled_before("reading sourceText")),
        Err(Stop::HostFailure(message)) => return LinedupResult::failure(message),
    };
    let filter_text = match resolve_input_text(input, input.filter_file.as_deref(), &input.filter_text, host) {
        Ok(text) => text,
        Err(Stop::Cancelled) => return LinedupResult::failure(cancelled_before("reading filterText")),
        Err(Stop::HostFailure(message)) => return LinedupResult::failure(message),
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

    let pass: BatchedFilterPass = filter_lines_batched(
        &source_lines,
        &filter_lines,
        input.case_sensitive,
        input.sort,
        CHECKPOINT_LINE_BATCH,
        host,
    );
    if let Some((processed, reason)) = pass.host_failure {
        return LinedupResult::failure(format!(
            "Linedup lost the host after {processed} of {} unique line(s): {reason}.",
            pass.total_lines
        ));
    }
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
        match host.write_text(path, &content) {
            Ok(()) => {}
            Err(NodeHostError::Cancelled) => return LinedupResult::failure(cancelled_before("writing outputFile")),
            Err(NodeHostError::Failure(reason)) => {
                return LinedupResult::failure(format!("could not write {path}: {reason}"));
            }
        }
    }

    LinedupResult::filtered(data)
}

/// Why text resolution stopped before the rules could run.
enum Stop {
    /// The owning operation was cancelled — a hard stop, never a per-item failure.
    Cancelled,
    /// A refusal or a machine failure, already worded for the result document.
    HostFailure(String),
}

/// `LinedupInput.sourceFile ? read(path) : field`, with the CLI's `\n` spelling resolved on the
/// inline branch only.
fn resolve_input_text(
    input: &LinedupInput,
    path: Option<&str>,
    inline: &str,
    host: &mut dyn NodeHost,
) -> Result<String, Stop> {
    match path {
        Some(path) => match host.read_text(path) {
            Ok(Some(text)) => Ok(text),
            // The seam collapses "missing", "unreadable" and "outside the granted root" into one answer,
            // so the node says all three; the host keeps the real reason in its own log (`host_seam`
            // documents that trade for `stat`, and `read_text` inherits it).
            Ok(None) => Err(Stop::HostFailure(format!(
                "could not read {path}: nothing readable there (missing, undecodable, or outside the granted root)"
            ))),
            Err(NodeHostError::Cancelled) => Err(Stop::Cancelled),
            Err(NodeHostError::Failure(reason)) => {
                Err(Stop::HostFailure(format!("could not read {path}: {reason}")))
            }
        },
        None if input.unescape_literal_newlines => Ok(unescape_literal_newlines(inline)),
        None => Ok(inline.to_owned()),
    }
}

/// The copy for a cancel that landed on a file effect rather than on a batch boundary.
///
/// There is no TypeScript counterpart and no old-port counterpart: `runLinedupInteraction` could only
/// succeed, and the wasm port's three extra endings were all reported through the filtering path
/// (`plugins/linedup/src/run.rs:26-34`). A cancel that arrives while a file is being read has to say
/// which effect it stopped, or the history line claims the run filtered something it never looked at.
fn cancelled_before(effect: &str) -> String {
    format!("Linedup was cancelled before {effect}.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::TerminalLanguage;
    use crate::test_host::TestHost;
    use serde_json::json;

    fn input(fields: serde_json::Value) -> LinedupInput {
        LinedupInput::from_json(&fields)
    }

    fn run(fields: serde_json::Value, host: &mut TestHost) -> LinedupResult {
        run_linedup(&input(fields), host)
    }

    #[test]
    fn the_operation_surface_is_runlinedupinteraction() {
        // interaction.ts: `{ ...filterLines(...), sourceTotal, sourceUnique, details }`.
        let mut host = TestHost::new();
        let result = run(
            json!({ "sourceText": "alpha\nbeta-one\ngamma\nbeta-two", "filterText": "beta" }),
            &mut host,
        );
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
        // The guarantee the retired `NoFiles` double used to stand in for, stated directly: a request
        // with no path slot reaches the host at the batch boundary and nowhere else — no read, no
        // write, and no listing or clock either (see `test_host`'s refusal of those seven methods).
        assert!(
            host.calls.iter().all(|call| call.starts_with("checkpoint")),
            "the operation surface must not reach a file effect: {:?}",
            host.calls
        );
        assert_eq!(host.checkpoints, 1, "one batch of four lines yields exactly once");
    }

    #[test]
    fn blank_source_refuses_before_any_filtering() {
        for fields in [json!({}), json!({ "sourceText": "   " }), json!({ "sourceText": "\n\n" })] {
            let mut host = TestHost::new();
            let result = run(fields.clone(), &mut host);
            assert!(!result.success, "{fields} should not run");
            assert_eq!(result.message, "请输入原文本。");
            assert!(result.data.is_none());
        }
        // The negative control: a source of one whitespace-padded line is not blank.
        let mut host = TestHost::new();
        assert!(run(json!({ "sourceText": " a " }), &mut host).success);
    }

    #[test]
    fn an_empty_filter_list_runs_unless_the_face_asked_for_the_guard() {
        let mut host = TestHost::new();
        let plain = run(json!({ "sourceText": "alpha" }), &mut host);
        assert!(plain.success, "filterText declares no rule (definition.json:75)");
        assert_eq!(plain.data.clone().expect("data").removed_count, 0);

        let mut host = TestHost::new();
        let refused = run(json!({ "sourceText": "alpha", "filterText": "   ", "requireFilterTokens": true }), &mut host);
        assert_eq!(refused.message, "过滤 token 为空，无法过滤。");
        let mut host = TestHost::new();
        let english = run(
            json!({ "sourceText": "alpha", "filterText": "", "requireFilterTokens": true, "language": "en" }),
            &mut host,
        );
        assert_eq!(english.message, "Filter token list is empty, so no line can be removed.");
        // Negative control: one real token clears the same guard.
        let mut host = TestHost::new();
        assert!(
            run(json!({ "sourceText": "alpha", "filterText": "x", "requireFilterTokens": true }), &mut host).success,
            "the guard refuses an empty token list, not a non-matching one"
        );
    }

    #[test]
    fn file_slots_read_and_write_through_the_host_seam() {
        // cli.ts:51-63 `cli.test.ts`: source.txt + filter.txt -> kept.txt, preserveOrder.
        let mut host = TestHost::new()
            .with_file("/data/source.txt", "gamma\nbeta-one\nalpha\nbeta-two\n")
            .with_file("/data/filter.txt", "beta\n");
        let result = run(
            json!({ "sourceFile": "/data/source.txt", "filterFile": "/data/filter.txt", "outputFile": "/data/kept.txt", "sort": false }),
            &mut host,
        );
        assert!(result.success, "{}", result.message);
        assert_eq!(result.data.clone().expect("data").kept_count, 2);
        assert_eq!(host.contents_of("/data/kept.txt").expect("written"), "gamma\nalpha\n");
        assert_eq!(
            host.calls.first().map(String::as_str),
            Some("read_text /data/source.txt"),
            "the first effect of a file flow must be the read the CLI face performed"
        );
    }

    #[test]
    fn an_unreadable_input_file_is_a_result_not_a_trap() {
        let mut host = TestHost::new().with_read_failure("/data/source.txt", "permission denied");
        let result = run(json!({ "sourceFile": "/data/source.txt", "filterText": "x" }), &mut host);
        assert!(!result.success);
        assert!(result.message.contains("/data/source.txt"), "{}", result.message);
        assert!(result.message.contains("permission denied"), "{}", result.message);
    }

    #[test]
    fn a_missing_input_file_is_reported_the_same_way_as_a_refused_one() {
        // The seam's `Ok(None)` arm: missing, unreadable and ungranted arrive as one answer, so the run
        // must name the path rather than report an empty filter over empty text.
        let mut host = TestHost::new();
        let result = run(json!({ "sourceFile": "/data/nope.txt", "filterText": "x" }), &mut host);
        assert!(!result.success);
        assert!(result.message.contains("/data/nope.txt"), "{}", result.message);
        assert_eq!(result.data, None);
    }

    #[test]
    fn an_unwritable_output_file_reports_the_refusal() {
        let mut host = TestHost::new().with_write_failure("/ro/kept.txt", "read-only file system");
        let result = run(json!({ "sourceText": "alpha", "filterText": "zz", "outputFile": "/ro/kept.txt" }), &mut host);
        assert_eq!(result.message, "could not write /ro/kept.txt: read-only file system");
    }

    #[test]
    fn writing_with_nothing_kept_produces_one_newline() {
        // `[""].join("\n") + "\n"` — the byte-for-byte behaviour `cli.ts:341`/`cli.ts:441` produce.
        let mut host = TestHost::new();
        let result = run(json!({ "sourceText": "alpha", "filterText": "alpha", "outputFile": "/data/kept.txt" }), &mut host);
        assert!(result.success);
        assert_eq!(host.contents_of("/data/kept.txt").expect("written"), "\n");
    }

    #[test]
    fn a_cancelled_checkpoint_ends_the_run_with_what_it_reached() {
        let mut host = TestHost::new().cancelling_at(1);
        let result = run(json!({ "sourceText": "a\nb\nc\nd", "filterText": "z", "sort": true }), &mut host);
        assert!(!result.success);
        assert_eq!(result.message, "Linedup stopped after 4 of 4 unique line(s).");
        assert_eq!(host.checkpoints, 1, "the run stops at the first refusal");
    }

    #[test]
    fn a_cancelled_read_is_never_worded_as_a_machine_failure() {
        // ADR-0073 keeps "failed" and "cancelled" as the two arms a node branches on; flattening them
        // would put the operator's cancel in the history line as a broken folder.
        let mut host = TestHost::new().with_file("/data/source.txt", "alpha");
        host.cancel_on_read = true;
        let cancelled = run(json!({ "sourceFile": "/data/source.txt", "filterText": "x" }), &mut host);
        assert_eq!(cancelled.message, "Linedup was cancelled before reading sourceText.");

        let mut host = TestHost::new().with_read_failure("/data/source.txt", "disk offline");
        let failed = run(json!({ "sourceFile": "/data/source.txt", "filterText": "x" }), &mut host);
        assert_eq!(failed.message, "could not read /data/source.txt: disk offline");
        assert_ne!(cancelled.message, failed.message);
    }

    #[test]
    fn inline_newline_unescaping_is_opt_in() {
        let escaped = json!({ "sourceText": "a\\nb", "filterText": "a" });
        let mut host = TestHost::new();
        let raw = run(escaped.clone(), &mut host);
        assert_eq!(raw.data.clone().expect("data").kept_count, 0, "one line \"a\\nb\" contains \"a\"");
        let mut host = TestHost::new();
        let cli = run(json!({ "sourceText": "a\\nb", "filterText": "a", "unescapeLiteralNewlines": true }), &mut host);
        assert_eq!(cli.data.clone().expect("data").kept_count, 1);
    }

    #[test]
    fn the_copy_language_comes_from_the_request() {
        let mut host = TestHost::new();
        let result = run(json!({ "sourceText": "", "language": "en" }), &mut host);
        assert_eq!(result.message, "Enter source text.");
        assert_eq!(LinedupInput::from_json(&json!({ "language": "EN" })).language, TerminalLanguage::En);
        assert_eq!(LinedupInput::from_json(&json!({ "language": "fr" })).language, TerminalLanguage::Zh);
    }
}
