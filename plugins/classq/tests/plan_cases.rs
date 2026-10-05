//! Query-semantics parity table: `packages/nodes/classq/src/core.ts`'s planner, row by row.
//!
//! Every row cites the TypeScript line it reproduces, and every row carries a negative control — the same probe
//! re-run against one deliberate mutation — so a rule that stopped being enforced shows up as a *failed control*,
//! not as a green suite. The four published vitest cases (`core.test.ts`) are rows 1-4 with their fixtures intact.
//!
//! Organised around what a query surface can get wrong: ordering, the four sibling filters, the empty result, the
//! counters, and a result set big enough that a display-layer `slice` (`cli.ts:48`) would have hidden the tail.

mod support;

use support::{Control, Probe, Tree, assert_control, assert_probes, assert_table_is_not_empty, run_row};

/// One table row.
struct Case<'a> {
    name: &'a str,
    source: &'a str,
    tree: Tree,
    input: &'a str,
    asserts: Vec<Probe<'a>>,
    control: Control<'a>,
}

fn keyword_tree() -> Tree {
    // `core.test.ts:21-31`.
    Tree::from_fixture(&[
        ("/root", &[("already", true), ("pending.zip", false), ("extra", true)]),
        ("/root/already", &[]),
        ("/root/extra", &[]),
    ])
}

fn one_ready_tree() -> Tree {
    // `core.test.ts:65-73`: one keyword folder, one sibling.
    Tree::from_fixture(&[("/root", &[("already", true), ("pending.zip", false)]), ("/root/already", &[])])
}

fn cases() -> Vec<Case<'static>> {
    vec![
        Case {
            name: "plans sibling items into the wait folder",
            source: "packages/nodes/classq/src/core.test.ts:20-43",
            tree: keyword_tree(),
            input: r#"{"input":{"action":"plan","paths":["/root"],"keyword":"already","waitKeyword":"wait"}}"#,
            asserts: vec![
                ("/result/success", "true"),
                ("/result/data/keywordCount", "1"),
                ("/result/data/readyCount", "2"),
                // The triple sequence `core.test.ts:38-42` asserts, row by row.
                ("/result/data/items/0/stage", r#""keyword""#),
                ("/result/data/items/0/sourceName", r#""already""#),
                ("/result/data/items/0/targetRelative", r#""wait""#),
                ("/result/data/items/0/status", r#""found""#),
                ("/result/data/items/0/targetPath", r#""/root/wait""#),
                ("/result/data/items/1/stage", r#""wait""#),
                ("/result/data/items/1/sourceName", r#""pending.zip""#),
                ("/result/data/items/1/targetRelative", r#""wait/pending.zip""#),
                ("/result/data/items/1/kind", r#""file""#),
                ("/result/data/items/1/targetPath", r#""/root/wait/pending.zip""#),
                ("/result/data/items/2/sourceName", r#""extra""#),
                ("/result/data/items/2/targetRelative", r#""wait/extra""#),
                ("/result/data/items/2/kind", r#""folder""#),
                // Listing order is the plan order: `pending.zip` was listed before `extra`.
                ("/result/data/items/2/sourcePath", r#""/root/extra""#),
                ("/result/data/items/1/parentPath", r#""/root""#),
                ("/events/0/type", r#""progress""#),
                ("/events/0/progress", "20.0"),
                ("/events/0/message", r#""Scanning keyword folders.""#),
            ],
            control: Control {
                note: "a keyword nobody named finds nothing, so every count the row asserts must move",
                tree: None,
                input: r#"{"input":{"action":"plan","paths":["/root"],"keyword":"done","waitKeyword":"wait"}}"#,
                pointer: "/result/data/keywordCount",
                expected: "0",
            },
        },
        Case {
            name: "reports existing wait targets as conflicts",
            source: "packages/nodes/classq/src/core.test.ts:45-61",
            tree: one_ready_tree().existing_file("/root/wait/pending.zip"),
            input: r#"{"input":{"action":"plan","paths":["/root"]}}"#,
            asserts: vec![
                ("/result/data/conflictCount", "1"),
                ("/result/data/readyCount", "0"),
                ("/result/data/items/1/status", r#""conflict""#),
                ("/result/data/items/1/reason", r#""target_exists""#),
                // `core.ts:206`: the errors array quotes `sourcePath: reason`.
                ("/result/data/errors/0", r#""/root/pending.zip: target_exists""#),
                // A conflict is not an error row, so the run still reports success (`core.ts:226`).
                ("/result/success", "true"),
            ],
            control: Control {
                note: "the `skip` policy reports the same collision under a different reason and nothing else changes",
                tree: None,
                input: r#"{"input":{"action":"plan","paths":["/root"],"existingPolicy":"skip"}}"#,
                pointer: "/result/data/items/1/reason",
                expected: r#""target_exists_skip""#,
            },
        },
        Case {
            name: "applies live wait transfers",
            source: "packages/nodes/classq/src/core.test.ts:63-81",
            tree: one_ready_tree(),
            input: r#"{"input":{"action":"classify","paths":["/root"],"dryRun":false}}"#,
            asserts: vec![
                ("/result/success", "true"),
                ("/result/message", r#""ClassQ applied 1 transfer(s).""#),
                ("/result/data/movedCount", "1"),
                ("/result/data/copiedCount", "0"),
                ("/result/data/readyCount", "0"),
                ("/result/data/items/1/status", r#""moved""#),
                ("/result/data/action", r#""classify""#),
                ("/events/1/progress", "70.0"),
                ("/events/1/message", r#""Applying wait-folder transfers.""#),
            ],
            control: Control {
                note: "the same live action with `dryRun` left at its default writes nothing at all",
                tree: None,
                input: r#"{"input":{"action":"classify","paths":["/root"]}}"#,
                pointer: "/result/data/movedCount",
                expected: "0",
            },
        },
        Case {
            name: "finds keyword folders recursively",
            source: "packages/nodes/classq/src/core.test.ts:6-18",
            tree: Tree::from_fixture(&[
                ("/root", &[("series", true)]),
                ("/root/series", &[("already", true)]),
                ("/root/series/already", &[]),
            ]),
            input: r#"{"input":{"action":"plan","paths":["/root"]}}"#,
            asserts: vec![
                ("/result/data/keywordCount", "1"),
                ("/result/data/items/0/keywordPath", r#""/root/series/already""#),
                ("/result/data/items/0/parentPath", r#""/root/series""#),
                // The wait folder lives next to the keyword folder, not next to the root (`core.ts:146`).
                ("/result/data/items/0/targetPath", r#""/root/series/wait""#),
                ("/result/data/items/0/targetRelative", r#""series/wait""#),
            ],
            control: Control {
                note: "a root that is not a directory is reported instead of walked",
                tree: Some(Tree::new()),
                input: r#"{"input":{"action":"plan","paths":["/root"]}}"#,
                pointer: "/result/data/items/0/reason",
                expected: r#""root_not_directory""#,
            },
        },
        Case {
            name: "copy mode reports copied rows and keeps the source",
            source: "packages/nodes/classq/src/core.ts:111 (status), :187-203 (target)",
            tree: one_ready_tree(),
            input: r#"{"input":{"action":"classify","paths":["/root"],"transferMode":"copy","dryRun":false}}"#,
            asserts: vec![
                ("/result/data/copiedCount", "1"),
                ("/result/data/movedCount", "0"),
                ("/result/data/items/1/status", r#""copied""#),
                ("/result/data/transferMode", r#""copy""#),
            ],
            control: Control {
                note: "with the default mode the same row is `moved`, which is the only difference",
                tree: None,
                input: r#"{"input":{"action":"classify","paths":["/root"],"dryRun":false}}"#,
                pointer: "/result/data/items/1/status",
                expected: r#""moved""#,
            },
        },
        Case {
            name: "a root that is not a directory is one error row",
            source: "packages/nodes/classq/src/core.ts:126-130",
            tree: one_ready_tree(),
            input: r#"{"input":{"action":"plan","paths":["/missing"]}}"#,
            asserts: vec![
                ("/result/success", "false"),
                ("/result/data/errorCount", "1"),
                ("/result/data/items/0/status", r#""error""#),
                ("/result/data/items/0/reason", r#""root_not_directory""#),
                ("/result/data/items/0/rootPath", r#""/missing""#),
                // `errorItem` (`core.ts:233-235`) fills every path field with the root and both display fields with
                // its basename.
                ("/result/data/items/0/sourceName", r#""missing""#),
                ("/result/data/items/0/targetRelative", r#""missing""#),
                ("/result/data/keywordCount", "0"),
            ],
            control: Control {
                note: "the same document with a real root reports no root problem",
                tree: None,
                input: r#"{"input":{"action":"plan","paths":["/root"]}}"#,
                pointer: "/result/success",
                expected: "true",
            },
        },
        Case {
            name: "a root without a keyword folder reports it",
            source: "packages/nodes/classq/src/core.ts:132-136",
            tree: Tree::from_fixture(&[("/root", &[("nothing", true), ("a.zip", false)]), ("/root/nothing", &[])]),
            input: r#"{"input":{"action":"plan","paths":["/root"]}}"#,
            asserts: vec![
                ("/result/data/items/0/reason", r#""keyword_folder_missing""#),
                ("/result/data/items/0/status", r#""error""#),
                ("/result/data/readyCount", "0"),
                // `errorItem` (`core.ts:233-235`) files the row under the wait stage, so the one row this root
                // produces is counted there — an empty plan is not an empty item list.
                ("/result/data/waitCount", "1"),
                ("/result/message", r#""ClassQ planned 1 item(s).""#),
            ],
            control: Control {
                note: "rename `nothing` to `already` and the same fixture plans a transfer",
                tree: Some(Tree::from_fixture(&[
                    ("/root", &[("already", true), ("a.zip", false)]),
                    ("/root/already", &[]),
                ])),
                input: r#"{"input":{"action":"plan","paths":["/root"]}}"#,
                pointer: "/result/data/readyCount",
                expected: "1",
            },
        },
        Case {
            name: "no roots fails before the walk",
            source: "packages/nodes/classq/src/core.ts:96",
            tree: one_ready_tree(),
            input: r#"{"input":{"action":"plan","paths":[]}}"#,
            asserts: vec![
                ("/result/success", "false"),
                ("/result/message", r#""At least one root directory is required.""#),
                // `failure()` (`core.ts:229-231`) answers with the synthetic row: empty paths, message in `reason`.
                ("/result/data/items/0/sourcePath", r#""""#),
                ("/result/data/items/0/reason", r#""At least one root directory is required.""#),
                ("/result/data/items/0/stage", r#""wait""#),
                ("/result/data/items/0/kind", r#""folder""#),
                ("/result/data/rootCount", "0"),
                ("/events", "[]"),
            ],
            control: Control {
                note: "one root gets past the guard, so the answer is a plan and not the guard message",
                tree: None,
                input: r#"{"input":{"action":"plan","paths":["/root"]}}"#,
                pointer: "/result/message",
                expected: r#""ClassQ planned 2 item(s).""#,
            },
        },
        Case {
            name: "the keyword folder is never its own transfer",
            source: "packages/nodes/classq/src/core.ts:149",
            tree: one_ready_tree(),
            input: r#"{"input":{"action":"plan","paths":["/root"]}}"#,
            asserts: vec![
                // Two rows only: the keyword row and the sibling. The keyword folder is skipped by path identity.
                ("/result/data/items/1/sourceName", r#""pending.zip""#),
                ("/result/data/waitCount", "1"),
                ("/result/data/keywordCount", "1"),
            ],
            control: Control {
                note: "add a second sibling and the wait rows grow by exactly one",
                tree: Some(Tree::from_fixture(&[
                    ("/root", &[("already", true), ("pending.zip", false), ("other.zip", false)]),
                    ("/root/already", &[]),
                ])),
                input: r#"{"input":{"action":"plan","paths":["/root"]}}"#,
                pointer: "/result/data/waitCount",
                expected: "2",
            },
        },
        Case {
            name: "an existing wait folder is not planned into itself",
            source: "packages/nodes/classq/src/core.ts:150",
            tree: Tree::from_fixture(&[
                ("/root", &[("already", true), ("wait", true)]),
                ("/root/already", &[]),
                ("/root/wait", &[]),
            ]),
            input: r#"{"input":{"action":"plan","paths":["/root"]}}"#,
            asserts: vec![
                ("/result/data/waitCount", "0"),
                ("/result/data/readyCount", "0"),
                ("/result/data/keywordCount", "1"),
            ],
            control: Control {
                note: "call the queue folder `hold` and it becomes an ordinary transfer candidate",
                tree: Some(Tree::from_fixture(&[
                    ("/root", &[("already", true), ("hold", true)]),
                    ("/root/already", &[]),
                    ("/root/hold", &[]),
                ])),
                input: r#"{"input":{"action":"plan","paths":["/root"]}}"#,
                pointer: "/result/data/waitCount",
                expected: "1",
            },
        },
        Case {
            name: "a sibling folder named with the keyword is not planned",
            source: "packages/nodes/classq/src/core.ts:151",
            tree: Tree::from_fixture(&[
                ("/root", &[("already", true), ("already-notes", true), ("a.zip", false)]),
                ("/root/already", &[]),
                ("/root/already-notes", &[]),
            ]),
            input: r#"{"input":{"action":"plan","paths":["/root"]}}"#,
            asserts: vec![
                // `already-notes` is a directory whose name contains the keyword, so it is a reviewed folder too —
                // but it is not queued. `a.zip` is.
                ("/result/data/waitCount", "1"),
                ("/result/data/items/1/sourceName", r#""a.zip""#),
            ],
            control: Control {
                note: "the filter is directory-only: a *file* named `already-notes.zip` is queued",
                tree: Some(Tree::from_fixture(&[
                    ("/root", &[("already", true), ("already-notes.zip", false), ("a.zip", false)]),
                    ("/root/already", &[]),
                ])),
                input: r#"{"input":{"action":"plan","paths":["/root"]}}"#,
                pointer: "/result/data/waitCount",
                expected: "2",
            },
        },
        Case {
            name: "an entry that is neither file nor directory is dropped",
            source: "packages/nodes/classq/src/core.ts:152",
            tree: Tree::from_fixture(&[("/root", &[("already", true), ("a.zip", false)]), ("/root/already", &[])])
                .other_entry("/root", "dangling-link"),
            input: r#"{"input":{"action":"plan","paths":["/root"]}}"#,
            asserts: vec![
                ("/result/data/waitCount", "1"),
                ("/result/data/items/1/sourceName", r#""a.zip""#),
            ],
            control: Control {
                note: "the same entry reported as a file is queued, which is what makes the filter observable",
                tree: Some(Tree::from_fixture(&[
                    ("/root", &[("already", true), ("a.zip", false), ("dangling-link", false)]),
                    ("/root/already", &[]),
                ])),
                input: r#"{"input":{"action":"plan","paths":["/root"]}}"#,
                pointer: "/result/data/waitCount",
                expected: "2",
            },
        },
        Case {
            name: "two keyword folders in one parent are planned once",
            source: "packages/nodes/classq/src/core.ts:138-143",
            tree: Tree::from_fixture(&[
                ("/root", &[("already-one", true), ("already-two", true), ("a.zip", false)]),
                ("/root/already-one", &[]),
                ("/root/already-two", &[]),
            ]),
            input: r#"{"input":{"action":"plan","paths":["/root"]}}"#,
            asserts: vec![
                // `processedParents` collapses the second keyword folder, so one `found` row and one listing pass.
                ("/result/data/keywordCount", "1"),
                ("/result/data/waitCount", "1"),
                ("/result/data/items/1/sourceName", r#""a.zip""#),
                ("/result/data/items/0/keywordPath", r#""/root/already-one""#),
            ],
            control: Control {
                note: "split the two keyword folders across two parents and each gets its own row",
                tree: Some(Tree::from_fixture(&[
                    ("/root", &[("already-one", true), ("series", true)]),
                    ("/root/already-one", &[]),
                    ("/root/series", &[("already-two", true), ("b.zip", false)]),
                    ("/root/series/already-two", &[]),
                ])),
                input: r#"{"input":{"action":"plan","paths":["/root"]}}"#,
                pointer: "/result/data/keywordCount",
                expected: "2",
            },
        },
        Case {
            name: "nested keyword folders keep the plan's pre-order",
            source: "packages/nodes/classq/src/core.ts:132-155",
            tree: Tree::from_fixture(&[
                ("/root", &[("already", true), ("series", true), ("a.zip", false)]),
                ("/root/already", &[]),
                ("/root/series", &[("already", true), ("b.zip", false)]),
                ("/root/series/already", &[]),
            ]),
            input: r#"{"input":{"action":"plan","paths":["/root"]}}"#,
            asserts: vec![
                ("/result/data/keywordCount", "2"),
                ("/result/data/readyCount", "3"),
                // Ordering: root's keyword row, root's siblings (`series` is queued *and* descended into), then the
                // nested parent's rows. A planner that sorted by path would put `series/wait` first.
                ("/result/data/items/0/stage", r#""keyword""#),
                ("/result/data/items/1/sourcePath", r#""/root/series""#),
                ("/result/data/items/2/sourcePath", r#""/root/a.zip""#),
                ("/result/data/items/3/stage", r#""keyword""#),
                ("/result/data/items/3/keywordPath", r#""/root/series/already""#),
                ("/result/data/items/4/sourcePath", r#""/root/series/b.zip""#),
                ("/result/data/items/1/targetPath", r#""/root/wait/series""#),
            ],
            control: Control {
                note: "the listing order is the plan order: swap the two siblings and the rows swap with them",
                tree: Some(Tree::from_fixture(&[
                    ("/root", &[("already", true), ("a.zip", false), ("series", true)]),
                    ("/root/already", &[]),
                    ("/root/series", &[("already", true), ("b.zip", false)]),
                    ("/root/series/already", &[]),
                ])),
                input: r#"{"input":{"action":"plan","paths":["/root"]}}"#,
                pointer: "/result/data/items/1/sourcePath",
                expected: r#""/root/a.zip""#,
            },
        },
        Case {
            name: "several roots each walk their own parents",
            source: "packages/nodes/classq/src/core.ts:125-138",
            tree: Tree::from_fixture(&[
                ("/a", &[("already", true), ("a.zip", false)]),
                ("/a/already", &[]),
                ("/b", &[("already", true), ("b.zip", false)]),
                ("/b/already", &[]),
            ]),
            input: r#"{"input":{"action":"plan","paths":["/a","/b"]}}"#,
            asserts: vec![
                ("/result/data/rootCount", "2"),
                ("/result/data/keywordCount", "2"),
                ("/result/data/readyCount", "2"),
                ("/result/data/items/0/rootPath", r#""/a""#),
                ("/result/data/items/2/rootPath", r#""/b""#),
            ],
            control: Control {
                note: "repeat one root three times and `uniqueClean` (`core.ts:83`) leaves one, so the two-root answer above is a dedupe result and not a row count",
                tree: None,
                input: r#"{"input":{"action":"plan","paths":["/a","/a","/a"]}}"#,
                pointer: "/result/data/rootCount",
                expected: "1",
            },
        },
        Case {
            name: "a wide result set arrives whole",
            source: "packages/nodes/classq/src/cli.ts:48 (display slice), core.ts:147-154 (no limit)",
            tree: wide_tree(200),
            input: r#"{"input":{"action":"plan","paths":["/root"]}}"#,
            asserts: vec![
                ("/result/data/readyCount", "200"),
                ("/result/data/waitCount", "200"),
                ("/result/data/items/1/sourceName", r#""item-000.zip""#),
                ("/result/data/items/200/sourceName", r#""item-199.zip""#),
                ("/result/data/items/200/targetRelative", r#""wait/item-199.zip""#),
                // A naive port that carried the CLI's 80-row slice into the contract would stop at `item-079`.
                ("/result/data/items/80/sourceName", r#""item-079.zip""#),
                ("/result/message", r#""ClassQ planned 201 item(s).""#),
            ],
            control: Control {
                note: "the same document over a one-sibling tree reports 1, so the 200 above is not a constant",
                tree: Some(one_ready_tree()),
                input: r#"{"input":{"action":"plan","paths":["/root"]}}"#,
                pointer: "/result/data/readyCount",
                expected: "1",
            },
        },
        Case {
            name: "a listing that fails aborts the run",
            source: "packages/nodes/classq/src/core.ts:117-119",
            tree: one_ready_tree().unreadable("/root"),
            input: r#"{"input":{"action":"plan","paths":["/root"]}}"#,
            asserts: vec![
                ("/result/success", "false"),
                ("/result/data/errorCount", "1"),
                // The message is the runtime's; `failure()` puts it in the result message and in the synthetic row's
                // `reason`, whose `sourcePath` is empty (`core.ts:229-231`).
                ("/result/data/items/0/sourcePath", r#""""#),
                ("/result/data/items/0/reason", r#""EACCES: permission denied, scandat '/root'""#),
                // The scan event went out before the walk failed (`core.ts:97` precedes `:98`).
                ("/events/0/progress", "20.0"),
            ],
            control: Control {
                note: "without the blocked listing the same fixture plans two rows",
                tree: Some(one_ready_tree()),
                input: r#"{"input":{"action":"plan","paths":["/root"]}}"#,
                pointer: "/result/data/readyCount",
                expected: "1",
            },
        },
        Case {
            name: "a failing transfer is one error row and a failed run",
            source: "packages/nodes/classq/src/core.ts:112-114, :226",
            tree: Tree::from_fixture(&[
                ("/root", &[("already", true), ("a.zip", false), ("b.zip", false)]),
                ("/root/already", &[]),
            ])
            .untransferable("/root/a.zip"),
            input: r#"{"input":{"action":"classify","paths":["/root"],"dryRun":false}}"#,
            asserts: vec![
                ("/result/success", "false"),
                ("/result/data/movedCount", "1"),
                ("/result/data/errorCount", "1"),
                ("/result/data/items/1/status", r#""error""#),
                ("/result/data/items/2/status", r#""moved""#),
                ("/result/message", r#""ClassQ applied 1 transfer(s).""#),
            ],
            control: Control {
                note: "with nothing blocked both siblings move and the run succeeds",
                tree: Some(Tree::from_fixture(&[
                    ("/root", &[("already", true), ("a.zip", false), ("b.zip", false)]),
                    ("/root/already", &[]),
                ])),
                input: r#"{"input":{"action":"classify","paths":["/root"],"dryRun":false}}"#,
                pointer: "/result/success",
                expected: "true",
            },
        },
        Case {
            name: "a cancelled classify reports what it already did",
            source: "docs/adr/0066 (checkpoint) — no TypeScript counterpart",
            tree: Tree::from_fixture(&[
                ("/root", &[("already", true), ("a.zip", false), ("b.zip", false), ("c.zip", false)]),
                ("/root/already", &[]),
            ]),
            input: r#"{"input":{"action":"classify","paths":["/root"],"dryRun":false}}"#,
            asserts: vec![
                ("/result/success", "false"),
                ("/result/message", r#""Operation cancelled.""#),
                ("/result/data/movedCount", "1"),
                ("/result/data/readyCount", "1"),
                ("/result/data/items/2/reason", r#""cancelled_by_checkpoint""#),
            ],
            control: Control {
                note: "a run whose checkpoint never cancels moves all three siblings",
                tree: None,
                input: r#"{"input":{"action":"classify","paths":["/root"],"dryRun":false}}"#,
                pointer: "/result/data/movedCount",
                expected: "3",
            },
        },
    ]
}

/// A tree with `count` siblings, enough to cross the CLI's display slice.
fn wide_tree(count: usize) -> Tree {
    let mut entries: Vec<(String, bool)> = vec![("already".to_owned(), true)];
    for index in 0..count {
        entries.push((format!("item-{index:03}.zip"), false));
    }
    let refs: Vec<(&str, bool)> = entries.iter().map(|(name, dir)| (name.as_str(), *dir)).collect();
    Tree::new().dir("/root", &refs).dir("/root/already", &[])
}

#[test]
fn plan_semantics_table() {
    let rows = cases();
    assert_table_is_not_empty(rows.len(), "tests/plan_cases.rs");
    for row in rows {
        let (document, streamed) = run_row(&row.tree, row.input, cancellation_for(row.name));
        // Every row names the TypeScript line it reproduces, so a failure points at the source of truth.
        let label = format!("{} [{}]", row.name, row.source);
        assert_probes(&document, &label, &row.asserts);
        assert_control(&document, &row.tree, &row.control);
        // The response document replays the stream the host already saw, so the two must agree.
        assert_eq!(
            document["events"],
            serde_json::Value::Array(streamed),
            "row {label}: the reply's events diverged from the emitted ones"
        );
    }
}

/// The rows that rehearse a cancellation: the nth `checkpoint` answer is `Cancelled`.
fn cancellation_for(name: &str) -> Option<usize> {
    match name {
        "a cancelled classify reports what it already did" => Some(3),
        _ => None,
    }
}

/// The row count is also a smoke check that this file is wired to the node and not to itself.
#[test]
fn the_table_covers_every_published_status_transition() {
    let rows = cases();
    let statuses: Vec<String> = rows
        .iter()
        .flat_map(|row| {
            let (document, _) = run_row(&row.tree, row.input, cancellation_for(row.name));
            document
                .pointer("/result/data/items")
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|item| item.get("status").and_then(serde_json::Value::as_str))
                .map(str::to_owned)
                .collect::<Vec<String>>()
        })
        .collect();
    for expected in ["found", "ready", "moved", "copied", "conflict", "error"] {
        assert!(statuses.iter().any(|status| status == expected), "no row of the table reaches status {expected}");
    }
    // Negative control for the whole file: `skipped` is declared by `core.ts:6` and produced by nothing, so a row
    // that asserted it would be asserting a state the node cannot reach.
    assert!(!statuses.iter().any(|status| status == "skipped"), "the planner produced `skipped`, which core.ts never does");
}
