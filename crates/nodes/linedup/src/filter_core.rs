//! The node's business rules, ported line-for-line from `packages/nodes/linedup/src/core.ts`.
//!
//! | TypeScript | Rust |
//! | --- | --- |
//! | `core.ts:8-13` `LinedupFilterResult` | [`FilterOutcome`] |
//! | `core.ts:15-21` `normalizeLine` / `uniqueNonEmptyLines` | [`crate::line_text`] |
//! | `core.ts:23-25` `splitLines` | [`crate::line_text::split_lines`] |
//! | `core.ts:27-56` `filterLines` | [`filter_lines`], [`filter_lines_batched`] |
//! | `core.ts:58-64` `createDiffRows` | [`create_diff_rows`] |
//! | `core.ts:72-84` `findDuplicateLines` | [`find_duplicate_lines`] |
//! | `core.ts:86-93` `analyzeReadLines` | [`analyze_read_lines`] |
//! | `core.ts:100-112` `explainRemovals` | [`explain_removals`] |
//! | `core.ts:114-116` `localeSort` | [`crate::natural_order`] |
//!
//! The one rule worth reading twice: **a source line is removed when it *contains* a filter token,
//! not when it equals one** (`core.ts:39` `comparableLine.includes(filter)`). That is what makes this
//! a subtraction over lists of names/IDs/paths (`help.ts:8`), and it is the difference between
//! `filter == "beta"` removing `beta-one` and a set-difference implementation keeping it.
//!
//! ## The yield, after ADR-0073
//!
//! The batched pass is the only place this module touches the machine, and it touches exactly one
//! method: `NodeHost::checkpoint`. The retired shim had its own `CheckpointOutcome` enum plus an ABI
//! tag table for it (`plugins/linedup/src/run_control.rs:23-76`); the native node uses the published
//! `xiranite_plugin_api::checkpoint::CheckpointOutcome` directly, because with no boundary there is no
//! tag to translate and a second enum would be the fork ADR-0068 was written to stop.

use serde::Serialize;

use crate::line_text::{normalize_line, unique_non_empty_lines};
use crate::natural_order::natural_sort;
use xiranite_node_registry::{NodeCheckpointRequest, NodeHost, NodeHostError};

/// Source lines partitioned between two checkpoint calls (ADR-0066's item boundary).
///
/// Re-homed here from `plugins/linedup/src/run_control.rs:15` because the batch bound belongs to the
/// code that batches, and that was the only behaviour the retired module carried that a real run needs.
///
/// The batch is a pause-latency bound, not a performance knob: pause is cooperative, so an operation
/// becomes unresponsive for at most one batch of work. 4096 is roughly the largest paste the card
/// accepts, which keeps an ordinary run at a single checkpoint while a 500 000-line `source.txt` yields
/// 122 times.
pub const CHECKPOINT_LINE_BATCH: usize = 4096;

/// The [`NodeCheckpointRequest::phase`] this node reports while it partitions.
///
/// The retired `xiranite.operation.checkpoint` took no phase at all (`plugins/linedup/src/run_control.rs:81`),
/// so nothing existing pins this string; it is the host's log line and the operation's phase label, and
/// `"filtering"` is the node's own action name (`LINEDUP_ACTION`).
const CHECKPOINT_PHASE: &str = "filtering";

/// `core.ts:8-13` `LinedupFilterResult`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterOutcome {
    /// Kept lines, deduplicated, optionally sorted.
    pub filtered_lines: Vec<String>,
    /// Removed lines, deduplicated, optionally sorted.
    pub removed_lines: Vec<String>,
    /// `removedLines.length`.
    pub removed_count: u64,
    /// `filteredLines.length`.
    pub kept_count: u64,
}

/// `core.ts:27-56` `filterLines`.
///
/// `case_sensitive` is `core.ts:30`'s `input.caseSensitive ?? true`; the caller resolves the
/// `??` because that is a request-shape concern (`contract::LinedupInput::from_json`).
///
/// `sort` follows `core.ts:47-48` literally: **only `false` preserves order**. Both vectors get the
/// node's collation otherwise, and deduplication already happened, so sorting cannot merge two
/// case variants that the filter kept apart.
///
/// This is [`filter_lines_batched`] with no host and therefore no yield: the same `partition` runs,
/// so a boundary can never be the reason two faces disagree. A face that must be pausable — the host,
/// the CLI, the TUI — calls the batched form with its own host.
#[must_use]
pub fn filter_lines(
    source_lines: &[String],
    filter_tokens: &[String],
    case_sensitive: bool,
    sort: bool,
) -> FilterOutcome {
    partition(source_lines, filter_tokens, case_sensitive, sort, usize::MAX, None).outcome
}

/// The pass `core.ts:27-56` describes, cut into batches with a checkpoint after each one (ADR-0066).
///
/// Deduplication happens once, up front, exactly as `core.ts:28-29` does, so batching cannot change
/// which lines exist; it only decides where the run is willing to stop.
///
/// The `#[must_use]` lives on [`BatchedFilterPass`], not on this signature: a function returning a type
/// that is already `#[must_use]` must not repeat the attribute.
pub fn filter_lines_batched(
    source_lines: &[String],
    filter_tokens: &[String],
    case_sensitive: bool,
    sort: bool,
    batch: usize,
    host: &mut dyn NodeHost,
) -> BatchedFilterPass {
    partition(source_lines, filter_tokens, case_sensitive, sort, batch, Some(host))
}

/// [`filter_lines`] and [`filter_lines_batched`] over one implementation.
///
/// Kept as one function on purpose: the invariant `batching_never_changes_the_filter_result` asserts is
/// only worth something if there is exactly one partitioning loop to drift.
fn partition(
    source_lines: &[String],
    filter_tokens: &[String],
    case_sensitive: bool,
    sort: bool,
    batch: usize,
    mut host: Option<&mut dyn NodeHost>,
) -> BatchedFilterPass {
    let source = unique_non_empty_lines(source_lines);
    let compare_tokens = comparable_tokens(filter_tokens, case_sensitive);
    let total_lines = count_of(&source);

    let mut filtered_lines: Vec<String> = Vec::new();
    let mut removed_lines: Vec<String> = Vec::new();
    let mut cancelled_after: Option<u64> = None;
    let mut host_failure: Option<(u64, String)> = None;

    for chunk in source.chunks(batch.max(1)) {
        for line in chunk {
            let comparable = fold_for_compare(line, case_sensitive);
            // `core.ts:39`: `filter.length > 0` is redundant after `uniqueNonEmptyLines`, kept in
            // `comparable_tokens` so an empty token can never remove every line.
            let removed = compare_tokens.iter().any(|token| !token.is_empty() && comparable.contains(token));
            if removed { removed_lines.push(line.clone()) } else { filtered_lines.push(line.clone()) }
        }

        // No host means no boundary: the face that asked for a plain `filterLines` is not pausable and
        // must not be charged a checkpoint it never granted a host to answer.
        let Some(host) = host.as_deref_mut() else { continue };
        let partitioned = filtered_lines.len() + removed_lines.len();
        match yield_at_boundary(
            host,
            &NodeCheckpointRequest {
                phase: CHECKPOINT_PHASE,
                processed_item_count: partitioned,
                total_item_count: source.len(),
            },
        ) {
            Boundary::Continue => {}
            Boundary::Cancelled => {
                cancelled_after = Some(count_of(&filtered_lines) + count_of(&removed_lines));
                break;
            }
            Boundary::Failed(reason) => {
                host_failure = Some((count_of(&filtered_lines) + count_of(&removed_lines), reason));
                break;
            }
        }
    }

    if sort && cancelled_after.is_none() && host_failure.is_none() {
        natural_sort(&mut filtered_lines);
        natural_sort(&mut removed_lines);
    }

    BatchedFilterPass {
        cancelled_after,
        host_failure,
        total_lines,
        outcome: FilterOutcome {
            kept_count: count_of(&filtered_lines),
            removed_count: count_of(&removed_lines),
            filtered_lines,
            removed_lines,
        },
    }
}

/// What one batch boundary decided.
enum Boundary {
    /// Keep partitioning the next batch.
    Continue,
    /// The operation was cancelled — ADR-0066's hard stop.
    Cancelled,
    /// The host could not serve the checkpoint, carrying its reason.
    Failed(String),
}

/// The one host call this module makes, translated into [`Boundary`].
///
/// Three rules, each with a reason:
/// * `Ok(Paused)` continues. A pause is reported without holding the call, and the retired port said
///   the same (`plugins/linedup/src/run_control.rs:138`: "a paused report is not a stop").
/// * `Err(NodeHostError::Cancelled)` cancels. The seam documents `Cancelled` as something a node must
///   treat as a hard stop rather than a per-item failure.
/// * `Err(NodeHostError::Failure(..))` also stops, but stays a *failure* rather than becoming a cancel.
///   The old shim collapsed an unservable checkpoint into `Cancelled` because the reserved `0` ABI tag
///   was the only signal it got (`plugins/linedup/src/run_control.rs:47-59`); the seam hands this node a
///   reason string, so reporting "the user cancelled" when the host broke would be a lie the undo/history
///   line has to carry. Stopping anyway is the safe half of the old rule and is kept.
fn yield_at_boundary(host: &mut dyn NodeHost, request: &NodeCheckpointRequest) -> Boundary {
    match host.checkpoint(request) {
        Ok(outcome) if outcome.is_hard_stop() => Boundary::Cancelled,
        Ok(_) => Boundary::Continue,
        Err(NodeHostError::Cancelled) => Boundary::Cancelled,
        Err(NodeHostError::Failure(reason)) => Boundary::Failed(reason),
    }
}

/// [`filter_lines`] plus the facts a batched pass knows and the TypeScript cannot express: how many
/// unique lines existed, and whether — and why — a boundary stopped the run.
#[must_use]
pub struct BatchedFilterPass {
    /// The node's result, as `core.ts:8-13` shapes it.
    pub outcome: FilterOutcome,
    /// Every unique source line in the input, whether or not the pass reached it.
    pub total_lines: u64,
    /// `Some(count)` when a checkpoint answered
    /// [`xiranite_plugin_api::CheckpointOutcome::Cancelled`] (or reported the cancel as an error),
    /// meaning `count` lines were partitioned and the rest were never looked at.
    pub cancelled_after: Option<u64>,
    /// `Some((count, reason))` when the stop came from a host that could not answer rather than from a
    /// cancel. Mutually exclusive with [`Self::cancelled_after`]: ADR-0073 keeps "failed" and
    /// "cancelled" as the two things a node may branch on, and a run that flattened them would show a
    /// broken host as if the operator had pressed cancel.
    pub host_failure: Option<(u64, String)>,
}

/// `core.ts:58-64` `createDiffRows`: annotate every deduplicated source line as kept or removed.
///
/// Status comes from membership in `filteredLines`, so this is the *result* view of a run, not a
/// second filter pass; calling it with the wrong filtered list relabels lines rather than recomputing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffRow {
    /// The deduplicated source line.
    pub line: String,
    /// `"kept"` or `"removed"`, the two literals `core.ts:58` allows.
    pub status: DiffStatus,
}

/// The `status` union of `core.ts:58`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffStatus {
    /// Present in the filtered output.
    Kept,
    /// Absent from the filtered output.
    Removed,
}

#[must_use]
pub fn create_diff_rows(source_lines: &[String], filtered_lines: &[String]) -> Vec<DiffRow> {
    let kept: Vec<String> = filtered_lines.iter().map(|line| normalize_line(line).to_owned()).collect();
    unique_non_empty_lines(source_lines)
        .into_iter()
        .map(|line| DiffRow {
            status: if kept.contains(&line) { DiffStatus::Kept } else { DiffStatus::Removed },
            line,
        })
        .collect()
}

/// `core.ts:72-84` `findDuplicateLines`: a normalized line that appeared more than once.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DuplicateLine {
    /// The normalized line text.
    pub line: String,
    /// How many input lines folded onto it.
    pub count: u64,
}

/// The duplicate set in first-seen order.
///
/// The TypeScript returns a `Map`, whose iteration order is insertion order, and the CLI prints it
/// directly (`cli.ts:365-377`); a `HashMap` here would reshuffle that panel and a `BTreeMap` would
/// sort it. A `Vec` keeps the order and stays expressible as `list<DuplicateLine>`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DuplicateLines(pub Vec<DuplicateLine>);

impl DuplicateLines {
    /// The count for one normalized line, if it is duplicated.
    #[must_use]
    pub fn count_of(&self, line: &str) -> Option<u64> {
        self.0.iter().find(|duplicate| duplicate.line == line).map(|duplicate| duplicate.count)
    }

    /// Whether any duplicate was found.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// How many distinct lines are duplicated.
    #[must_use]
    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// The `JSON.stringify(map)` shape `cli.ts` and any persisted read stats already speak.
    #[must_use]
    pub fn to_json_object(&self) -> serde_json::Value {
        let mut object = serde_json::Map::new();
        for duplicate in &self.0 {
            object.insert(duplicate.line.clone(), serde_json::Value::from(duplicate.count));
        }
        serde_json::Value::Object(object)
    }
}

#[must_use]
pub fn find_duplicate_lines(lines: &[String]) -> DuplicateLines {
    let mut order: Vec<String> = Vec::new();
    let mut counts: Vec<u64> = Vec::new();
    for raw in lines {
        let line = normalize_line(raw);
        if line.is_empty() {
            continue;
        }
        match order.iter().position(|seen| seen == line) {
            Some(index) => counts[index] += 1,
            None => {
                order.push(line.to_owned());
                counts.push(1);
            }
        }
    }

    DuplicateLines(
        order
            .into_iter()
            .zip(counts)
            .filter(|(_, count)| *count > 1)
            .map(|(line, count)| DuplicateLine { line, count })
            .collect(),
    )
}

/// `core.ts:66-70` + `core.ts:86-93` `analyzeReadLines`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ReadStats {
    /// Non-empty normalized line count, duplicates included.
    pub total_lines: u64,
    /// Distinct non-empty normalized lines.
    pub unique_lines: u64,
    /// The duplicated subset, in first-seen order.
    pub duplicates: DuplicateLines,
}

#[must_use]
pub fn analyze_read_lines(lines: &[String]) -> ReadStats {
    let normalized: Vec<String> = lines
        .iter()
        .map(|line| normalize_line(line).to_owned())
        .filter(|line| !line.is_empty())
        .collect();

    let mut unique: Vec<String> = Vec::with_capacity(normalized.len());
    for line in &normalized {
        if !unique.iter().any(|seen| seen == line) {
            unique.push(line.clone());
        }
    }

    ReadStats {
        total_lines: count_of(&normalized),
        unique_lines: count_of(&unique),
        duplicates: find_duplicate_lines(&normalized),
    }
}

/// `core.ts:95-98` `LinedupRemovalDetail`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovalDetail {
    /// The deduplicated source line that was removed.
    pub line: String,
    /// The token that removed it — see [`explain_removals`] for why this is the folded form.
    pub matched_filter: String,
}

/// `core.ts:100-112` `explainRemovals`, the first-match-wins reason for each removal.
///
/// `matchedFilter` is deliberately the **compared** token, not the token as typed: `core.ts:108`
/// searches `compareFilters` (already `toLowerCase()`-folded when case-insensitive) and pushes that
/// value at `core.ts:109`. So `explainRemovals(["Alpha"], ["ALPHA"], false)` reports
/// `matchedFilter: "alpha"`. A port that reports the original `"ALPHA"` is wrong, and a removed line
/// can be attributed to a token the user never typed in that case.
#[must_use]
pub fn explain_removals(source_lines: &[String], filter_tokens: &[String], case_sensitive: bool) -> Vec<RemovalDetail> {
    let source = unique_non_empty_lines(source_lines);
    let compare_tokens = comparable_tokens(filter_tokens, case_sensitive);

    source
        .into_iter()
        .filter_map(|line| {
            let comparable = fold_for_compare(&line, case_sensitive);
            compare_tokens
                .iter()
                .find(|token| !token.is_empty() && comparable.contains(*token))
                .map(|matched_filter| RemovalDetail { line, matched_filter: matched_filter.clone() })
        })
        .collect()
}

/// `core.ts:32` `filters.map(normalizeCompare)` after `core.ts:29`'s dedupe.
fn comparable_tokens(filter_tokens: &[String], case_sensitive: bool) -> Vec<String> {
    unique_non_empty_lines(filter_tokens)
        .into_iter()
        .map(|token| fold_for_compare(&token, case_sensitive))
        .collect()
}

/// `core.ts:31` `normalizeCompare`.
fn fold_for_compare(value: &str, case_sensitive: bool) -> String {
    if case_sensitive { value.to_owned() } else { value.to_lowercase() }
}

/// Boundary counts are `u64`, never `usize`: the operation protocol carries fixed-width integers, and
/// machine words would make a 32-bit host answer differently. The conversion cannot fail for a vector
/// this side of the descriptor's `max_live_bytes` budget.
fn count_of<T>(values: &[T]) -> u64 {
    u64::try_from(values.len()).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::line_text::split_lines;

    fn lines(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn a_token_removes_every_line_that_contains_it() {
        // core.test.ts:17-27.
        let outcome = filter_lines(&lines(&["alpha", "beta-one", "gamma", "beta-two"]), &lines(&["beta"]), true, true);
        assert_eq!(outcome.filtered_lines, lines(&["alpha", "gamma"]));
        assert_eq!(outcome.removed_lines, lines(&["beta-one", "beta-two"]));
        assert_eq!((outcome.kept_count, outcome.removed_count), (2, 2));
    }

    #[test]
    fn an_exact_token_is_not_required() {
        // The negative control for the rule above: set-difference would keep all three.
        let outcome = filter_lines(&lines(&["b", "beta", "xbetax"]), &lines(&["beta"]), true, true);
        assert_eq!(outcome.filtered_lines, lines(&["b"]));
        assert_eq!(outcome.removed_lines, lines(&["beta", "xbetax"]));
    }

    #[test]
    fn only_sort_false_preserves_order() {
        // core.ts:47 `input.sort === false ? filteredLines : sort(...)`.
        let kept = filter_lines(&lines(&["zeta", "alpha"]), &lines(&["nope"]), true, false).filtered_lines;
        assert_eq!(kept, lines(&["zeta", "alpha"]), "sort:false keeps source order");
        let sorted = filter_lines(&lines(&["zeta", "alpha"]), &lines(&["nope"]), true, true).filtered_lines;
        assert_eq!(sorted, lines(&["alpha", "zeta"]));
    }

    #[test]
    fn an_empty_token_list_removes_nothing() {
        // `core.ts:39` guards `filter.length > 0`; without the guard an empty token would match via
        // `includes("")` and empty the whole document.
        let outcome = filter_lines(&lines(&["alpha", "beta"]), &[], true, true);
        assert_eq!(outcome.kept_count, 2);
        assert!(outcome.removed_lines.is_empty());
        assert_eq!(outcome.removed_count, 0);
    }

    #[test]
    fn duplicates_are_counted_over_normalized_lines_in_first_seen_order() {
        // core.test.ts:36-39.
        let duplicates = find_duplicate_lines(&lines(&["a", "b", "a", "c", "b", "a", ""]));
        assert_eq!(duplicates.0, lines_and_counts(&[("a", 3), ("b", 2)]));
        assert_eq!(duplicates.count_of("a"), Some(3));
        assert_eq!(duplicates.count_of("c"), None, "a line seen once is not a duplicate");
    }

    #[test]
    fn trailing_whitespace_makes_two_lines_the_same_duplicate() {
        // The port's sharpest edge: `" a "` and `"a"` are one line (`core.ts:16` trims first), while
        // their byte lengths differ, so any length-keyed or raw-text-keyed comparison misses it.
        let duplicates = find_duplicate_lines(&lines(&[" a ", "a", "  a"]));
        assert_eq!(duplicates.0, lines_and_counts(&[("a", 3)]));
    }

    #[test]
    fn read_stats_separate_total_from_unique() {
        // core.test.ts:41-46.
        let stats = analyze_read_lines(&lines(&["alpha", "beta", "alpha", "", "gamma"]));
        assert_eq!(stats.total_lines, 4);
        assert_eq!(stats.unique_lines, 3);
        assert_eq!(stats.duplicates.0, lines_and_counts(&[("alpha", 2)]));
        assert_eq!(stats.duplicates.to_json_object(), serde_json::json!({ "alpha": 2 }));
    }

    #[test]
    fn empty_input_analyzes_to_zero_without_panicking() {
        let stats = analyze_read_lines(&[]);
        assert_eq!(stats.total_lines, 0);
        assert_eq!(stats.unique_lines, 0);
        assert!(stats.duplicates.is_empty());
        assert_eq!(stats.duplicates.to_json_object(), serde_json::json!({}));
    }

    #[test]
    fn diff_rows_label_every_deduplicated_source_line() {
        // core.test.ts:29-34.
        let rows = create_diff_rows(&split_lines("keep\nremove"), &lines(&["keep"]));
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], DiffRow { line: "keep".into(), status: DiffStatus::Kept });
        assert_eq!(rows[1], DiffRow { line: "remove".into(), status: DiffStatus::Removed });
        assert_eq!(serde_json::to_string(&rows[1]).expect("json"), r#"{"line":"remove","status":"removed"}"#);
    }

    #[test]
    fn explain_removals_reports_the_first_matching_token_only() {
        // core.test.ts:48-58, including the order the removals are reported in.
        let details = explain_removals(&lines(&["alpha", "beta-one", "gamma", "beta-two"]), &lines(&["beta", "gamma"]), true);
        assert_eq!(
            details,
            vec![
                RemovalDetail { line: "beta-one".into(), matched_filter: "beta".into() },
                RemovalDetail { line: "gamma".into(), matched_filter: "gamma".into() },
                RemovalDetail { line: "beta-two".into(), matched_filter: "beta".into() },
            ],
            "reports in source order, and `beta-two` names `beta` rather than the later token"
        );
    }

    #[test]
    fn explain_removals_names_the_earliest_token_when_several_match() {
        let details = explain_removals(&lines(&["a-b-c"]), &lines(&["b", "a"]), true);
        assert_eq!(details, vec![RemovalDetail { line: "a-b-c".into(), matched_filter: "b".into() }]);
    }

    #[test]
    fn explain_removals_reports_the_folded_token_when_case_insensitive() {
        // core.ts:108-109 pushes from `compareFilters`, so the reported token is lowercased.
        let details = explain_removals(&lines(&["Alpha", "BETA"]), &lines(&["ALPHA"]), false);
        assert_eq!(details, vec![RemovalDetail { line: "Alpha".into(), matched_filter: "alpha".into() }]);
    }

    #[test]
    fn explain_removals_respects_case_sensitivity() {
        // core.test.ts:60-66.
        assert!(explain_removals(&lines(&["Alpha", "BETA"]), &lines(&["alpha"]), true).is_empty());
        assert_eq!(
            explain_removals(&lines(&["Alpha", "BETA"]), &lines(&["alpha"]), false),
            vec![RemovalDetail { line: "Alpha".into(), matched_filter: "alpha".into() }]
        );
    }

    #[test]
    fn a_pause_is_a_report_and_not_a_stop() {
        // The one rule the retired shim pinned at `run_control.rs:138`, kept through the seam: a host
        // that says "currently paused" without holding the call must not end the pass.
        let mut host = crate::test_host::TestHost::new().pausing_once();
        let pass = filter_lines_batched(
            &lines(&["keep", "drop-a"]),
            &lines(&["drop"]),
            true,
            true,
            1,
            &mut host,
        );
        assert_eq!(pass.cancelled_after, None, "a pause answer is not a cancel");
        assert_eq!(pass.outcome.kept_count, 1);
        assert_eq!(pass.outcome.removed_count, 1);
        assert_eq!(host.checkpoints, 2, "both boundaries were reached");
    }

    fn lines_and_counts(values: &[(&str, u64)]) -> Vec<DuplicateLine> {
        values
            .iter()
            .map(|(line, count)| DuplicateLine { line: (*line).to_owned(), count: *count })
            .collect()
    }
}
