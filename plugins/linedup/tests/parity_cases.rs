//! Table-driven parity cases for Linedup, derived from `packages/nodes/linedup/src`.
//!
//! Every row names the TypeScript it comes from. `core.test.ts` and `cli.test.ts` are the executable
//! spec, `interaction.ts` is the request/response contract and `definition.json` is the published rule
//! set; where those disagree, this file follows the TypeScript and the crate docs record the drift.
//!
//! Each table has a negative control next to it. A row that a wrong implementation would also pass is
//! not a parity case — so the controls are deliberately the cases a naive port fails: comparing lines
//! by equality instead of containment, by byte length instead of content, or reporting the token as
//! typed instead of as folded.

use xiranite_plugin_linedup::{
    CancelAfterCheckpoints, ContinueThroughRunControl, DiffStatus, DuplicateLine, LinedupInput, MemoryFiles, NoFiles,
    RemovalDetail, analyze_read_lines, create_diff_rows, explain_removals, filter_lines, filter_lines_batched,
    find_duplicate_lines, result_view_of, run_linedup, split_lines, unique_non_empty_lines,
};

/// The `usize` → boundary `u64` widening the parity tables need; never a silent `as`.
fn count(value: usize) -> u64 {
    u64::try_from(value).expect("a parity table row cannot exceed u64")
}

fn own(values: &[&'static str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

/// One `filterLines` row: inputs, the two flags, and the four outputs.
struct FilterCase {
    /// The TypeScript or CLI case this row comes from.
    source_citation: &'static str,
    what_it_pins: &'static str,
    source: &'static [&'static str],
    tokens: &'static [&'static str],
    case_sensitive: bool,
    sort: bool,
    kept: &'static [&'static str],
    removed: &'static [&'static str],
}

/// `core.test.ts:17-27`, `cli.test.ts:33-44`, `core.ts:30/39/47` and the boundaries they imply.
const FILTER_CASES: &[FilterCase] = &[
    FilterCase {
        source_citation: "core.test.ts:17-27",
        what_it_pins: "a token removes every line that CONTAINS it, both kept lists sorted",
        source: &["alpha", "beta-one", "gamma", "beta-two"],
        tokens: &["beta"],
        case_sensitive: true,
        sort: true,
        kept: &["alpha", "gamma"],
        removed: &["beta-one", "beta-two"],
    },
    FilterCase {
        source_citation: "cli.test.ts:36-43",
        what_it_pins: "`--source alpha\\nbeta-one\\ngamma --filter beta --json`",
        source: &["alpha", "beta-one", "gamma"],
        tokens: &["beta"],
        case_sensitive: true,
        sort: true,
        kept: &["alpha", "gamma"],
        removed: &["beta-one"],
    },
    FilterCase {
        source_citation: "core.ts:39",
        what_it_pins: "a line equal to a token is removed, and a line merely containing it too",
        source: &["beta", "xbetax", "bet"],
        tokens: &["beta"],
        case_sensitive: true,
        sort: true,
        kept: &["bet"],
        removed: &["beta", "xbetax"],
    },
    FilterCase {
        source_citation: "core.test.ts:60-62",
        what_it_pins: "caseSensitive is the default, so `alpha` does not remove `Alpha`",
        source: &["Alpha", "BETA"],
        tokens: &["alpha"],
        case_sensitive: true,
        sort: true,
        kept: &["Alpha", "BETA"],
        removed: &[],
    },
    FilterCase {
        source_citation: "core.test.ts:64-66",
        what_it_pins: "caseSensitive:false folds BOTH sides before the containment test",
        source: &["Alpha", "BETA"],
        tokens: &["alpha"],
        case_sensitive: false,
        sort: true,
        kept: &["BETA"],
        removed: &["Alpha"],
    },
    FilterCase {
        source_citation: "core.ts:16/28",
        what_it_pins: "lines are trimmed before matching, so padding cannot hide a token",
        source: &["  beta-one  ", "alpha"],
        tokens: &["beta"],
        case_sensitive: true,
        sort: true,
        kept: &["alpha"],
        removed: &["beta-one"],
    },
    FilterCase {
        source_citation: "core.ts:20",
        what_it_pins: "a duplicate source line is counted once in either output",
        source: &["beta-a", "beta-a", "alpha"],
        tokens: &["beta"],
        case_sensitive: true,
        sort: true,
        kept: &["alpha"],
        removed: &["beta-a"],
    },
    FilterCase {
        source_citation: "core.ts:29 + core.ts:39 guard",
        what_it_pins: "an empty token list removes nothing; a blank token cannot empty the document",
        source: &["alpha", "beta"],
        tokens: &["", "   "],
        case_sensitive: true,
        sort: true,
        kept: &["alpha", "beta"],
        removed: &[],
    },
    FilterCase {
        source_citation: "core.ts:47 `input.sort === false`",
        what_it_pins: "cli.test.ts:46-66: sort:false keeps source order in BOTH vectors",
        source: &["gamma", "beta-one", "alpha", "beta-two"],
        tokens: &["beta"],
        case_sensitive: true,
        sort: false,
        kept: &["gamma", "alpha"],
        removed: &["beta-one", "beta-two"],
    },
    FilterCase {
        source_citation: "core.ts:47 + core.ts:115 numeric collation",
        what_it_pins: "digit runs order by value, so item2 precedes item10",
        source: &["item10", "item2", "drop"],
        tokens: &["drop"],
        case_sensitive: true,
        sort: true,
        kept: &["item2", "item10"],
        removed: &["drop"],
    },
    FilterCase {
        source_citation: "core.ts:47, Array#sort stability",
        what_it_pins: "lines equal at base strength keep their source order",
        source: &["Beta", "beta", "Drop"],
        tokens: &["drop"],
        // Case-insensitive matching is what removes `Drop` at all; the two `beta` spellings then tie
        // under the collation, and stability — not the comparator — decides that they stay in order.
        case_sensitive: false,
        sort: true,
        kept: &["Beta", "beta"],
        removed: &["Drop"],
    },
    FilterCase {
        source_citation: "core.ts:28 over an empty document",
        what_it_pins: "empty input yields two empty lists and zero counts, not an error",
        source: &[],
        tokens: &["beta"],
        case_sensitive: true,
        sort: true,
        kept: &[],
        removed: &[],
    },
];

#[test]
fn the_filter_table_has_rows_and_each_row_names_its_typescript_source() {
    assert!(!FILTER_CASES.is_empty(), "an empty parity table proves nothing");
    for case in FILTER_CASES {
        assert!(case.source_citation.contains(':'), "{} must cite file:line", case.source_citation);
        assert!(!case.what_it_pins.is_empty(), "{} has no stated purpose", case.source_citation);
    }
}

#[test]
fn filter_cases_reproduce_the_typescript_outcomes() {
    for case in FILTER_CASES {
        let source = own(case.source);
        let tokens = own(case.tokens);
        let outcome = filter_lines(&source, &tokens, case.case_sensitive, case.sort);
        let kept = own(case.kept);
        let removed = own(case.removed);

        assert_eq!(outcome.filtered_lines, kept, "{} / {}", case.source_citation, case.what_it_pins);
        assert_eq!(outcome.removed_lines, removed, "{} / {}", case.source_citation, case.what_it_pins);
        assert_eq!(outcome.kept_count, count(kept.len()), "{}", case.source_citation);
        assert_eq!(outcome.removed_count, count(removed.len()), "{}", case.source_citation);
        assert_eq!(
            outcome.kept_count + outcome.removed_count,
            count(unique_non_empty_lines(&source).len()),
            "{}: kept + removed must account for every deduplicated line",
            case.source_citation
        );
    }
}

#[test]
fn the_negative_controls_separate_contains_from_equals() {
    // The row above that a set-difference port fails outright: none of these lines equals `beta`.
    let source = own(&["beta-one", "beta-two"]);
    let outcome = filter_lines(&source, &["beta".to_owned()], true, true);
    assert!(outcome.filtered_lines.is_empty(), "equality-based filtering would keep both");
    assert_eq!(outcome.removed_count, 2);

    // And the mirror: a token that is a substring of nothing removes nothing.
    let none = filter_lines(&source, &["zeta".to_owned()], true, true);
    assert_eq!(none.kept_count, 2, "an unused token must not be reported as a removal");
    assert!(none.removed_lines.is_empty());
}

#[test]
fn diff_rows_agree_with_the_filter_outcome_for_every_case() {
    // `createDiffRows(source, filtered)` is the card's two-pane view; it must label exactly the rows
    // `filterLines` split, which is the cross-check between `core.ts:58-64` and `core.ts:27-56`.
    assert!(!FILTER_CASES.is_empty(), "an empty parity table proves nothing");
    for case in FILTER_CASES {
        let source = own(case.source);
        let tokens = own(case.tokens);
        let outcome = filter_lines(&source, &tokens, case.case_sensitive, case.sort);
        let rows = create_diff_rows(&source, &outcome.filtered_lines);
        let removed_rows = rows.iter().filter(|row| row.status == DiffStatus::Removed).count();
        assert_eq!(
            count(removed_rows),
            outcome.removed_count,
            "{}: the diff pane and the counts disagree",
            case.source_citation
        );
        assert_eq!(
            count(rows.len()),
            outcome.kept_count + outcome.removed_count,
            "{}",
            case.source_citation
        );
        for row in &rows {
            // A kept row must appear in `filteredLines`, and only for cases that still filter
            // case-sensitively; a case-folded filter could keep a row the diff cannot find.
            if row.status == DiffStatus::Kept {
                assert!(outcome.filtered_lines.contains(&row.line), "{}", case.source_citation);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Duplicate-line semantics: identical content, not identical size.
// ---------------------------------------------------------------------------

/// One `findDuplicateLines` / `analyzeReadLines` row.
struct DuplicateCase {
    source_citation: &'static str,
    what_it_pins: &'static str,
    lines: &'static [&'static str],
    /// `(line, count)` pairs in first-seen order.
    duplicates: &'static [(&'static str, u64)],
    total: u64,
    unique: u64,
}

const DUPLICATE_CASES: &[DuplicateCase] = &[
    DuplicateCase {
        source_citation: "core.test.ts:36-39",
        what_it_pins: "counts are per normalized line and ordered by first appearance",
        lines: &["a", "b", "a", "c", "b", "a", ""],
        duplicates: &[("a", 3), ("b", 2)],
        total: 6,
        unique: 3,
    },
    DuplicateCase {
        source_citation: "core.ts:15-16",
        what_it_pins: "IDENTICAL CONTENT after trim: `\" a \"` and `\"a\"` are one line",
        lines: &[" a ", "a", "  a"],
        duplicates: &[("a", 3)],
        total: 3,
        unique: 1,
    },
    DuplicateCase {
        source_citation: "core.ts:15-16 negative control",
        what_it_pins: "IDENTICAL SIZE is not identity: `ab` and `ba` are two lines",
        lines: &["ab", "ba", "ab"],
        duplicates: &[("ab", 2)],
        total: 3,
        unique: 2,
    },
    DuplicateCase {
        source_citation: "core.ts:19-21",
        what_it_pins: "blank and whitespace-only lines are never duplicates and never counted",
        lines: &["", "   ", "\t", ""],
        duplicates: &[],
        total: 0,
        unique: 0,
    },
    DuplicateCase {
        source_citation: "core.test.ts:41-46",
        what_it_pins: "totalLines counts duplicates, uniqueLines does not",
        lines: &["alpha", "beta", "alpha", "", "gamma"],
        duplicates: &[("alpha", 2)],
        total: 4,
        unique: 3,
    },
    DuplicateCase {
        source_citation: "core.ts:72-84 over empty input",
        what_it_pins: "an empty list is zero statistics, not a failure",
        lines: &[],
        duplicates: &[],
        total: 0,
        unique: 0,
    },
    DuplicateCase {
        source_citation: "core.ts:75 (BOM)",
        what_it_pins: "a BOM-prefixed line is the same line as its bare form (ECMAScript trim)",
        lines: &["\u{FEFF}alpha", "alpha"],
        duplicates: &[("alpha", 2)],
        total: 2,
        unique: 1,
    },
];

#[test]
fn duplicate_cases_are_the_typescript_statistics() {
    assert!(!DUPLICATE_CASES.is_empty(), "an empty parity table proves nothing");
    for case in DUPLICATE_CASES {
        let lines = own(case.lines);
        let stats = analyze_read_lines(&lines);
        let expected: Vec<DuplicateLine> = case
            .duplicates
            .iter()
            .map(|(line, count)| DuplicateLine { line: (*line).to_owned(), count: *count })
            .collect();

        assert_eq!(stats.total_lines, case.total, "{} / {}", case.source_citation, case.what_it_pins);
        assert_eq!(stats.unique_lines, case.unique, "{} / {}", case.source_citation, case.what_it_pins);
        assert_eq!(stats.duplicates.0, expected, "{} / {}", case.source_citation, case.what_it_pins);
        // The ordering claim `cli.ts:365-377` prints in, and the agreement between the two entry points.
        assert_eq!(
            stats.duplicates,
            find_duplicate_lines(&lines),
            "{}: analyzeReadLines and findDuplicateLines must agree",
            case.source_citation
        );
        assert_eq!(
            count(stats.duplicates.to_json_object().as_object().expect("object").len()),
            count(expected.len()),
            "{}: the map shape `cli.ts` prints has one key per duplicated line",
            case.source_citation
        );
    }
}

// ---------------------------------------------------------------------------
// Which token removed which line.
// ---------------------------------------------------------------------------

/// One `explainRemovals` row.
struct RemovalCase {
    source_citation: &'static str,
    what_it_pins: &'static str,
    source: &'static [&'static str],
    tokens: &'static [&'static str],
    case_sensitive: bool,
    /// `(line, matchedFilter)` pairs in source order.
    expected: &'static [(&'static str, &'static str)],
}

const REMOVAL_CASES: &[RemovalCase] = &[
    RemovalCase {
        source_citation: "core.test.ts:48-58",
        what_it_pins: "source order, and one detail per removed line",
        source: &["alpha", "beta-one", "gamma", "beta-two"],
        tokens: &["beta", "gamma"],
        case_sensitive: true,
        expected: &[("beta-one", "beta"), ("gamma", "gamma"), ("beta-two", "beta")],
    },
    RemovalCase {
        source_citation: "core.ts:108-109",
        what_it_pins: "the FOLDED token is reported, not the token as typed",
        source: &["Alpha"],
        tokens: &["ALPHA"],
        case_sensitive: false,
        expected: &[("Alpha", "alpha")],
    },
    RemovalCase {
        source_citation: "core.test.ts:60-62",
        what_it_pins: "case-sensitive matching explains nothing it did not remove",
        source: &["Alpha", "BETA"],
        tokens: &["alpha"],
        case_sensitive: true,
        expected: &[],
    },
    RemovalCase {
        source_citation: "core.ts:108 first-match-wins",
        what_it_pins: "the earliest matching token is named when several match",
        source: &["a-b-c"],
        tokens: &["b", "a"],
        case_sensitive: true,
        expected: &[("a-b-c", "b")],
    },
    RemovalCase {
        source_citation: "core.ts:101 dedupe",
        what_it_pins: "a line repeated in the source is explained once",
        source: &["beta", "beta", "alpha"],
        tokens: &["beta"],
        case_sensitive: true,
        expected: &[("beta", "beta")],
    },
];

#[test]
fn removal_details_are_the_typescript_explanations() {
    assert!(!REMOVAL_CASES.is_empty(), "an empty parity table proves nothing");
    for case in REMOVAL_CASES {
        let found = explain_removals(&own(case.source), &own(case.tokens), case.case_sensitive);
        let expected: Vec<RemovalDetail> = case
            .expected
            .iter()
            .map(|(line, token)| RemovalDetail {
                line: (*line).to_owned(),
                matched_filter: (*token).to_owned(),
            })
            .collect();
        assert_eq!(found, expected, "{} / {}", case.source_citation, case.what_it_pins);
    }
}

#[test]
fn every_removal_detail_corresponds_to_a_removed_line() {
    // The cross-check between `core.ts:100-112` and `core.ts:27-56`: the explanation list and the
    // removal list are the same lines, in different orders (details are source order, `removedLines`
    // is collated when `sort` is on).
    for case in FILTER_CASES {
        let source = own(case.source);
        let tokens = own(case.tokens);
        let details = explain_removals(&source, &tokens, case.case_sensitive);
        let outcome = filter_lines(&source, &tokens, case.case_sensitive, case.sort);
        assert_eq!(count(details.len()), outcome.removed_count, "{}", case.source_citation);
        for detail in &details {
            assert!(outcome.removed_lines.contains(&detail.line), "{}: {}", case.source_citation, detail.line);
            // `core.ts:39`'s `filter.length > 0` guard, seen from the other side: an empty token can
            // never be named as the reason.
            assert!(!detail.matched_filter.is_empty(), "{}", case.source_citation);
        }
    }
}

#[test]
fn batching_never_changes_the_filter_result() {
    // ADR-0066 says a checkpoint is a yield and a reporting point, not a transaction boundary, so the
    // batched pass must equal the plain port for every batch size.
    let source = own(&["item2", "item10", "drop-a", "keep", "drop-b", "drop-c", "drop-d"]);
    let tokens = own(&["drop"]);
    let plain = filter_lines(&source, &tokens, true, true);

    for batch in [1usize, 2, 3, 7, 64, usize::MAX] {
        let mut control = ContinueThroughRunControl;
        let pass = filter_lines_batched(&source, &tokens, true, true, batch, &mut control);
        assert_eq!(pass.cancelled_after, None, "batch {batch}");
        assert_eq!(pass.outcome.filtered_lines, plain.filtered_lines, "batch {batch}");
        assert_eq!(pass.outcome.removed_lines, plain.removed_lines, "batch {batch}");
        assert_eq!(pass.outcome.kept_count, plain.kept_count, "batch {batch}");
        assert_eq!(pass.total_lines, count(unique_non_empty_lines(&source).len()), "batch {batch}");
    }

    // The cancel seam, and the count it reports: a run cut after one batch of two has partitioned two
    // of the seven unique lines.
    let mut cancelling = CancelAfterCheckpoints::new(1);
    let pass = filter_lines_batched(&source, &tokens, true, true, 2, &mut cancelling);
    assert_eq!(pass.cancelled_after, Some(4), "two batches of two lines were partitioned before the stop");
    assert_eq!(pass.total_lines, 7);
    assert_eq!(cancelling.checkpoints_taken, 2, "the second checkpoint is the one that refused");
}

#[test]
fn a_size_only_or_hash_of_length_view_would_call_these_lines_distinct() {
    // The requested trap, stated for this node: Linedup has no file hashing at all, and its duplicate
    // notion is *normalized line content*. Two lines of different byte length are still duplicates.
    let lines: Vec<String> = [" a ", "a", "  a"].iter().map(|line| (*line).to_owned()).collect();
    let lengths: Vec<usize> = lines.iter().map(|line| line.len()).collect();
    assert_ne!(lengths, vec![1, 1, 1], "the inputs really do differ in size");
    assert_eq!(find_duplicate_lines(&lines).0.len(), 1, "…and they are still one duplicated line");

    // The mirror case: equal size, different content.
    let equal_size: Vec<String> = ["ab", "ba"].iter().map(|line| (*line).to_owned()).collect();
    assert!(find_duplicate_lines(&equal_size).is_empty(), "same length is not the same line");
}

// ---------------------------------------------------------------------------
// Published rules, the danger gate, and the two export bindings.
// ---------------------------------------------------------------------------

#[test]
fn the_published_definition_declares_the_rules_the_core_implements() {
    let definition: serde_json::Value =
        serde_json::from_str(include_str!("../definition.json")).expect("definition.json parses");

    // One action, four fields — the shape this crate's `LinedupInput` reads.
    assert_eq!(definition["actions"].as_array().expect("actions").len(), 1);
    assert_eq!(definition["actions"][0]["id"], serde_json::json!("filter"));
    let fields = definition["fields"].as_array().expect("fields");
    assert_eq!(fields.len(), 4);

    let source_text = fields.iter().find(|field| field["id"] == serde_json::json!("sourceText")).expect("sourceText");
    let rules: Vec<&str> = source_text["rules"]
        .as_array()
        .expect("rules")
        .iter()
        .map(|entry| entry["rule"]["type"].as_str().expect("rule type"))
        .collect();
    assert_eq!(rules, vec!["required", "nonBlank"], "definition.json:42-53");

    // The only field with a rule is `sourceText`; `filterText` declares none (definition.json:75),
    // which is why an empty token list is a valid run and `help.ts:68-71` claiming `filter` is
    // required is the drift reported in the port notes.
    let filter_text = fields.iter().find(|field| field["id"] == serde_json::json!("filterText")).expect("filterText");
    assert!(filter_text["rules"].as_array().expect("rules").is_empty());

    // The danger gate: `interaction.ts`'s `isDangerous: () => false`.
    assert_eq!(definition["danger"]["type"], serde_json::json!("none"));
    assert!(definition.get("dangerPromptExport").is_none(), "no confirmation document to produce");

    // The two plugin-export bindings the definition publishes.
    assert_eq!(definition["previewExport"], serde_json::json!("preview"));
    assert_eq!(definition["resultExport"], serde_json::json!("result_view"));
    assert_eq!(definition["reportsProgress"], serde_json::json!(false));
    assert_eq!(definition["publishesOutputPath"], serde_json::json!(false));
}

#[test]
fn the_input_binding_slot_names_are_the_fields_this_crate_reads() {
    // A renamed slot would silently read as an absent field, so the definition's binding table is
    // asserted against `LinedupInput::from_json` rather than trusted.
    let definition: serde_json::Value =
        serde_json::from_str(include_str!("../definition.json")).expect("definition.json parses");
    let bindings = definition["inputBindings"].as_array().expect("inputBindings");
    assert_eq!(bindings.len(), 4);

    let mut request = serde_json::Map::new();
    for binding in bindings {
        let slot = binding["slot"].as_str().expect("slot").to_owned();
        request.insert(slot.clone(), serde_json::json!(if slot == "sourceText" { "beta" } else { "" }));
    }
    let input = LinedupInput::from_json(&serde_json::Value::Object(request));
    assert_eq!(input.source_text, "beta", "every declared slot reaches the typed input");
    assert_eq!(input.filter_text, "");
    assert!(input.case_sensitive && input.sort, "the `asBoolean` bindings default to true");

    // Negative control: a slot the definition does not declare is ignored, so a typo in the definition
    // would show up as a blank source rather than as accepted input.
    let typo = LinedupInput::from_json(&serde_json::json!({ "source": "beta" }));
    assert_eq!(typo.source_text, "");
}

#[test]
fn the_danger_gate_never_blocks_a_run() {
    // `definition.json:157-159` says `none`, and `interaction.ts`'s `isDangerous` returns false, so no
    // request flag can change the outcome and no confirmation field is consulted.
    let plain = run_linedup(&json_input(&serde_json::json!({ "sourceText": "a", "filterText": "a" })), &NoFiles, &mut ContinueThroughRunControl);
    let with_confirmation = run_linedup(
        &json_input(&serde_json::json!({ "sourceText": "a", "filterText": "a", "confirm": true, "dryRun": false })),
        &NoFiles,
        &mut ContinueThroughRunControl,
    );
    assert_eq!(plain, with_confirmation, "an unknown flag must not change the filter");
    assert!(plain.success);
}

#[test]
fn preview_and_result_view_are_the_interaction_ts_documents() {
    // previewExport: "preview"
    let input = LinedupInput::from_json(&serde_json::json!({ "sourceText": "keep\nremove\n", "filterText": "a\n\nb" }));
    assert_eq!(input.preview_lines(), ["3 行".to_owned(), "2 filters".to_owned()]);
    let english = LinedupInput::from_json(&serde_json::json!({ "sourceText": "keep", "language": "en" }));
    assert_eq!(english.preview_lines(), ["1 line(s)".to_owned(), "0 filters".to_owned()]);

    // resultExport: "result_view"
    let result = run_linedup(
        &json_input(&serde_json::json!({ "sourceText": "alpha\nbeta", "filterText": "beta" })),
        &NoFiles,
        &mut ContinueThroughRunControl,
    );
    let view = result_view_of(&result);
    assert_eq!(view.lines, ["Kept: 1".to_owned(), "Removed: 1".to_owned()]);
    assert_eq!(view.message, "Filtered 1 line(s); kept 1.");
    assert!(view.success);
}

// ---------------------------------------------------------------------------
// The file flows the node publishes on its CLI face.
// ---------------------------------------------------------------------------

/// `cli.test.ts:46-66`, end to end through the plugin instead of through `runFilter`.
#[test]
fn file_flows_read_filter_and_write_exactly_like_the_cli() {
    let files = MemoryFiles::new()
        .with_file("/data/source.txt", "gamma\nbeta-one\nalpha\nbeta-two\n")
        .with_file("/data/filter.txt", "beta\n");
    let result = run_linedup(
        &json_input(&serde_json::json!({
            "sourceFile": "/data/source.txt",
            "filterFile": "/data/filter.txt",
            "outputFile": "/data/kept.txt",
            "sort": false
        })),
        &files,
        &mut ContinueThroughRunControl,
    );

    assert!(result.success, "{}", result.message);
    // The byte-for-byte file content `cli.ts:341`/`cli.ts:441` write: kept lines joined, one trailing
    // newline, source order because `sort:false`.
    assert_eq!(files.contents_of("/data/kept.txt").expect("output written"), "gamma\nalpha\n");
    let data = result.data.expect("data");
    assert_eq!(data.filtered_lines, ["gamma".to_owned(), "alpha".to_owned()]);
    assert_eq!((data.kept_count, data.removed_count), (2, 2));
    assert_eq!((data.source_total, data.source_unique), (4, 4));

    // Negative control: a filesystem that was never asked to write stays empty.
    let untouched = MemoryFiles::new()
        .with_file("/data/source.txt", "gamma\nalpha\n")
        .with_file("/data/filter.txt", "beta\n");
    let without_output = run_linedup(
        &json_input(&serde_json::json!({ "sourceFile": "/data/source.txt", "filterFile": "/data/filter.txt" })),
        &untouched,
        &mut ContinueThroughRunControl,
    );
    assert!(without_output.success);
    assert_eq!(untouched.paths(), vec!["/data/filter.txt".to_owned(), "/data/source.txt".to_owned()]);
    assert_eq!(without_output.data.expect("data").kept_count, 2, "nothing matched, so nothing was removed");
}

#[test]
fn a_file_slot_beats_the_inline_field_and_a_missing_file_is_reported() {
    // `cli.ts:418-423`/`cli.ts:453-458`: the file branch wins, and a refused read is a failure.
    let files = MemoryFiles::new().with_file("/data/source.txt", "from-file\n");
    let result = run_linedup(
        &json_input(&serde_json::json!({ "sourceFile": "/data/source.txt", "sourceText": "from-field", "filterText": "z" })),
        &files,
        &mut ContinueThroughRunControl,
    );
    assert_eq!(result.data.expect("data").filtered_lines, ["from-file".to_owned()]);

    let missing = run_linedup(
        &json_input(&serde_json::json!({ "sourceFile": "/data/nope.txt", "filterText": "z" })),
        &files,
        &mut ContinueThroughRunControl,
    );
    assert!(!missing.success);
    assert!(missing.message.contains("/data/nope.txt"), "{}", missing.message);
    assert_eq!(missing.data, None, "a run that never read its source produced no data");
}

#[test]
fn splitting_matches_the_typescript_for_the_line_ending_matrix() {
    // core.ts:23-25. `splitLines` is what the preview counts and what every list above is built from.
    assert_eq!(split_lines("a\r\nb\rc\nd"), ["a", "b", "c", "d"]);
    assert_eq!(split_lines("\r\n"), ["", ""], "one CRLF is one break, so two empty lines");
    assert_eq!(split_lines(""), [""], "an empty document is one empty line, which dedupes to zero");
    assert_eq!(split_lines("a\u{2028}b"), ["a\u{2028}b"], "U+2028 is not a line separator here");
}

/// `LinedupInput::from_json` over a bare input document.
fn json_input(request: &serde_json::Value) -> LinedupInput {
    LinedupInput::from_json(request)
}
