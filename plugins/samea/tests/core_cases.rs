//! `packages/nodes/samea/src/core.test.ts`, reproduced case for case, plus the branches that file leaves
//! untested.
//!
//! Every expected value below is read off the node's own TypeScript and each row cites the `file:line` it
//! comes from. The four plan/move cases keep their fixtures — the same directory trees, the same `baseInput`
//! (`core.test.ts:70-73`), the same assertions — and the rows after them cover the `core.ts` branches the
//! vitest file never enters: the root guard (`:102`), a non-directory root (`:133`), the path blacklist and
//! its switch (`:86`, `:190`), the threshold (`:154`), the already-grouped skip and the conflict report
//! (`:159-164`), `centralize` (`:205`), the label-only regex blacklist (`:246`), the dry-run gate (`:106`), a
//! refused rename (`:116`) and a failed listing (`:123`).
//!
//! The runner refuses an empty table: a parity table with no rows would pass silently, and a silently-green
//! parity is the failure mode this file exists to prevent.

use samea::artist::{Blacklists, PatternList, extract_artist};
use samea::fs_surface::{CancelAfterRunControl, CollectingEventSink, ContinueThroughRunControl, NoopEventSink};
use samea::input::normalize_samea_input;
use samea::memory_fs::MemoryFileSystem;
use samea::plugin_entry::danger_samea_request_text;
use samea::run::run_samea;
use samea::{SameaPlanStatus, SameaRunEvent};
use serde_json::{Value, json};

/// The counts a run must produce, in the order `core.ts:229-237` builds them.
#[derive(Debug, Clone, Copy)]
struct Counts {
    scanned: usize,
    detected: usize,
    ready: usize,
    moved: usize,
    ignored: usize,
    skipped: usize,
    conflict: usize,
    error: usize,
}

#[derive(Debug, Clone, Copy)]
struct ExpectedItem {
    /// `sourceName`, i.e. the name the listing reported (`core.ts:145`).
    source: &'static str,
    /// `status` (`core.ts:4`).
    status: SameaPlanStatus,
    /// `reason`, or `None` when the document must not carry the key at all (`core.ts:164`).
    reason: Option<&'static str>,
    /// `targetPath`; `None` means "whatever the plan chose".
    target: Option<&'static str>,
}

#[derive(Debug, Clone, Copy)]
struct ExpectedGroup {
    name: &'static str,
    target_dir: &'static str,
    count: usize,
    status: &'static str,
}

/// One parity row: a fixture, an input document, and the answer the TypeScript produced.
struct ParityCase {
    name: &'static str,
    /// The `file:line` the expectation is read from, so a drift names its source.
    source: &'static str,
    /// `directory → [(entry name, is_directory)]`, in listing order.
    dirs: &'static [(&'static str, &'static [(&'static str, bool)])],
    /// Paths whose effect fails, with the message `platform.ts` would have thrown.
    failing: &'static [(&'static str, &'static str)],
    input: &'static str,
    success: bool,
    message: &'static str,
    counts: Counts,
    items: &'static [ExpectedItem],
    groups: &'static [ExpectedGroup],
    errors: &'static [&'static str],
    moves: &'static [(&'static str, &'static str)],
    events: &'static [(u32, &'static str)],
}

/// `core.test.ts:70-73`, the fixture every spread case shares.
const BASE_INPUT: &str = r#"{
    "ignorePathBlacklist": false, "minOccurrences": 1, "centralize": false, "includeDirectories": false,
    "skipGroupedDirectories": false, "dryRun": true, "artistBlacklist": ["various"],
    "pathBlacklist": ["[00画师分类]"], "regexBlacklist": [], "archiveExtensions": [".zip", ".rar", ".7z"]
}"#;

/// Merges `baseInput` with the per-case overrides, which is what `{ ...baseInput, paths: ["/archive"] }`
/// means at `core.test.ts:18`.
fn with_base_input(overrides: &str) -> String {
    let base: Value = serde_json::from_str(BASE_INPUT).expect("the base fixture is valid JSON");
    let extra: Value = serde_json::from_str(overrides).expect("the overrides are valid JSON");
    let mut merged = base.as_object().expect("object").clone();
    for (key, value) in extra.as_object().expect("object") {
        merged.insert(key.clone(), value.clone());
    }
    Value::Object(merged).to_string()
}

const PARITY_CASES: &[ParityCase] = &[
    // ── the vitest file, case for case ────────────────────────────────────────────────────────────────
    ParityCase {
        name: "plans matching archives into artist folders without touching unrelated archives",
        source: "core.test.ts:10-24",
        dirs: &[(
            "/archive",
            &[
                ("[Circle (Artist A)] one.zip", false),
                ("[Circle (Artist A)] two.rar", false),
                ("[Various] collection.7z", false),
            ],
        )],
        failing: &[],
        input: r#"{"action":"plan","paths":["/archive"],"ignorePathBlacklist":false,"minOccurrences":1,"centralize":false,"includeDirectories":false,"skipGroupedDirectories":false,"dryRun":true,"artistBlacklist":["various"],"pathBlacklist":["[00画师分类]"],"regexBlacklist":[],"archiveExtensions":[".zip",".rar",".7z"]}"#,
        success: true,
        message: "SameA planned 2 archive transfer(s).",
        counts: Counts {
            scanned: 3,
            detected: 2,
            ready: 2,
            moved: 0,
            ignored: 1,
            skipped: 0,
            conflict: 0,
            error: 0,
        },
        items: &[
            ExpectedItem {
                source: "[Circle (Artist A)] one.zip",
                status: SameaPlanStatus::Ready,
                reason: None,
                target: Some("/archive/[Circle (Artist A)]/[Circle (Artist A)] one.zip"),
            },
            ExpectedItem {
                source: "[Circle (Artist A)] two.rar",
                status: SameaPlanStatus::Ready,
                reason: None,
                target: Some("/archive/[Circle (Artist A)]/[Circle (Artist A)] two.rar"),
            },
            ExpectedItem {
                source: "[Various] collection.7z",
                status: SameaPlanStatus::Ignored,
                reason: Some("artist_not_detected"),
                target: Some("/archive/[Various] collection.7z"),
            },
        ],
        groups: &[ExpectedGroup {
            name: "[Circle (Artist A)]",
            target_dir: "/archive/[Circle (Artist A)]",
            count: 2,
            status: "ready",
        }],
        errors: &[],
        moves: &[],
        events: &[(15, "Scanning SameA archive roots.")],
    },
    ParityCase {
        name: "only moves ready archives after dry run is disabled",
        source: "core.test.ts:26-35",
        dirs: &[("/archive", &[("[Artist] one.zip", false), ("[Artist] two.zip", false)])],
        failing: &[],
        // `core.test.ts:29` hands `{ action, paths, dryRun }` straight to `runSamea`, so every other field
        // takes the `core.ts:82-95` default — including `artistBlacklist`, which defaults to the eleven-term
        // list at `core.ts:76` and does not match "Artist".
        input: r#"{"action":"classify","paths":["/archive"],"dryRun":false}"#,
        success: true,
        message: "SameA organized 2 archive(s).",
        counts: Counts {
            scanned: 2,
            detected: 2,
            ready: 0,
            moved: 2,
            ignored: 0,
            skipped: 0,
            conflict: 0,
            error: 0,
        },
        items: &[
            ExpectedItem {
                source: "[Artist] one.zip",
                status: SameaPlanStatus::Moved,
                reason: None,
                target: Some("/archive/[Artist]/[Artist] one.zip"),
            },
            ExpectedItem {
                source: "[Artist] two.zip",
                status: SameaPlanStatus::Moved,
                reason: None,
                target: Some("/archive/[Artist]/[Artist] two.zip"),
            },
        ],
        groups: &[ExpectedGroup {
            name: "[Artist]",
            target_dir: "/archive/[Artist]",
            count: 2,
            status: "ready",
        }],
        errors: &[],
        moves: &[
            ("/archive/[Artist] one.zip", "/archive/[Artist]/[Artist] one.zip"),
            ("/archive/[Artist] two.zip", "/archive/[Artist]/[Artist] two.zip"),
        ],
        events: &[
            (15, "Scanning SameA archive roots."),
            (65, "Organizing detected artist archives."),
            (100, "SameA organization completed."),
        ],
    },
    ParityCase {
        name: "does not rescan archives inside existing artist group directories",
        source: "core.test.ts:37-50",
        dirs: &[
            ("/archive", &[("[Artist]", true), ("[New Artist] new.zip", false)]),
            ("/archive/[Artist]", &[("[Artist] old.zip", false)]),
        ],
        failing: &[],
        input: r#"{"action":"plan","paths":["/archive"],"ignorePathBlacklist":false,"minOccurrences":1,"centralize":false,"includeDirectories":false,"skipGroupedDirectories":true,"dryRun":true,"artistBlacklist":["various"],"pathBlacklist":["[00画师分类]"],"regexBlacklist":[],"archiveExtensions":[".zip",".rar",".7z"]}"#,
        success: true,
        message: "SameA planned 1 archive transfer(s).",
        counts: Counts {
            scanned: 1,
            detected: 1,
            ready: 1,
            moved: 0,
            ignored: 0,
            skipped: 0,
            conflict: 0,
            error: 0,
        },
        // `core.test.ts:49` asserts exactly one item, whose sourcePath is the new archive: the `[Artist]`
        // folder's own contents never enter the scan.
        items: &[ExpectedItem {
            source: "[New Artist] new.zip",
            status: SameaPlanStatus::Ready,
            reason: None,
            target: Some("/archive/[New Artist]/[New Artist] new.zip"),
        }],
        groups: &[ExpectedGroup {
            name: "[New Artist]",
            target_dir: "/archive/[New Artist]",
            count: 1,
            status: "ready",
        }],
        errors: &[],
        moves: &[],
        events: &[(15, "Scanning SameA archive roots.")],
    },
    ParityCase {
        name: "treats extracted work directories as movable artist items",
        source: "core.test.ts:52-67",
        dirs: &[("/archive", &[("[Artist] first work", true), ("[Artist] second work", true)])],
        failing: &[],
        input: r#"{"action":"classify","paths":["/archive"],"includeDirectories":true,"minOccurrences":2,"dryRun":false}"#,
        success: true,
        message: "SameA organized 2 archive(s).",
        counts: Counts {
            scanned: 2,
            detected: 2,
            ready: 0,
            moved: 2,
            ignored: 0,
            skipped: 0,
            conflict: 0,
            error: 0,
        },
        items: &[
            ExpectedItem {
                source: "[Artist] first work",
                status: SameaPlanStatus::Moved,
                reason: None,
                target: Some("/archive/[Artist]/[Artist] first work"),
            },
            ExpectedItem {
                source: "[Artist] second work",
                status: SameaPlanStatus::Moved,
                reason: None,
                target: Some("/archive/[Artist]/[Artist] second work"),
            },
        ],
        groups: &[ExpectedGroup {
            name: "[Artist]",
            target_dir: "/archive/[Artist]",
            count: 2,
            status: "ready",
        }],
        errors: &[],
        moves: &[
            ("/archive/[Artist] first work", "/archive/[Artist]/[Artist] first work"),
            ("/archive/[Artist] second work", "/archive/[Artist]/[Artist] second work"),
        ],
        events: &[
            (15, "Scanning SameA archive roots."),
            (65, "Organizing detected artist archives."),
            (100, "SameA organization completed."),
        ],
    },
    // ── the branches `core.test.ts` never enters ──────────────────────────────────────────────────────
    ParityCase {
        name: "an empty root list fails before any scan happens",
        source: "core.ts:102, core.ts:242",
        dirs: &[("/archive", &[("[Artist] one.zip", false)])],
        failing: &[],
        input: r#"{"action":"plan","paths":[]}"#,
        success: false,
        message: "At least one archive root directory is required.",
        counts: Counts {
            scanned: 0,
            detected: 0,
            ready: 0,
            moved: 0,
            ignored: 0,
            skipped: 0,
            conflict: 0,
            error: 1,
        },
        // `failure` (`core.ts:242`) still hands back a `SameaData`, built from one synthetic error item whose
        // paths are empty — which is why the projected error line starts with ": ".
        items: &[ExpectedItem {
            source: "",
            status: SameaPlanStatus::Error,
            reason: Some("At least one archive root directory is required."),
            target: Some(""),
        }],
        groups: &[],
        errors: &[": At least one archive root directory is required."],
        moves: &[],
        events: &[],
    },
    ParityCase {
        name: "a root that is not a directory becomes one error item",
        source: "core.ts:133, core.ts:146, core.ts:105",
        dirs: &[],
        failing: &[],
        // `/oops` is registered nowhere, so `pathInfo` reports `exists: false`, exactly as `platform.ts:9`'s
        // `catch` did.
        input: r#"{"action":"plan","paths":["/oops"]}"#,
        success: false,
        message: "/oops: root_not_directory",
        counts: Counts {
            scanned: 0,
            detected: 0,
            ready: 0,
            moved: 0,
            ignored: 0,
            skipped: 0,
            conflict: 0,
            error: 1,
        },
        items: &[ExpectedItem {
            source: "oops",
            status: SameaPlanStatus::Error,
            reason: Some("root_not_directory"),
            target: Some("/oops"),
        }],
        groups: &[],
        errors: &["/oops: root_not_directory"],
        moves: &[],
        events: &[(15, "Scanning SameA archive roots.")],
    },
    ParityCase {
        name: "a file on a blacklisted path is ignored with its own item",
        source: "core.ts:190-192",
        dirs: &[("/archive", &[("trash.zip", false), ("[Artist] two.zip", false)])],
        failing: &[],
        input: r#"{"action":"plan","paths":["/archive"],"artistBlacklist":["various"],"pathBlacklist":["trash"]}"#,
        success: true,
        message: "SameA planned 1 archive transfer(s).",
        counts: Counts {
            scanned: 2,
            detected: 1,
            ready: 1,
            moved: 0,
            ignored: 1,
            skipped: 0,
            conflict: 0,
            error: 0,
        },
        items: &[
            ExpectedItem {
                source: "trash.zip",
                status: SameaPlanStatus::Ignored,
                reason: Some("path_blacklisted"),
                target: Some("/archive/trash.zip"),
            },
            ExpectedItem {
                source: "[Artist] two.zip",
                status: SameaPlanStatus::Ready,
                reason: None,
                target: Some("/archive/[Artist]/[Artist] two.zip"),
            },
        ],
        groups: &[ExpectedGroup {
            name: "[Artist]",
            target_dir: "/archive/[Artist]",
            count: 1,
            status: "ready",
        }],
        errors: &[],
        moves: &[],
        events: &[(15, "Scanning SameA archive roots.")],
    },
    ParityCase {
        name: "ignorePathBlacklist takes the same file back into the scan",
        source: "core.ts:86, core.ts:190",
        dirs: &[("/archive", &[("trash.zip", false)])],
        failing: &[],
        input: r#"{"action":"plan","paths":["/archive"],"ignorePathBlacklist":true,"artistBlacklist":["various"],"pathBlacklist":["trash"]}"#,
        success: true,
        // The negative control for the row above: the switch does not make the archive movable, it only
        // stops the path from being dropped — the artist is still undetected.
        message: "SameA planned 0 archive transfer(s).",
        counts: Counts {
            scanned: 1,
            detected: 0,
            ready: 0,
            moved: 0,
            ignored: 1,
            skipped: 0,
            conflict: 0,
            error: 0,
        },
        items: &[ExpectedItem {
            source: "trash.zip",
            status: SameaPlanStatus::Ignored,
            reason: Some("artist_not_detected"),
            target: Some("/archive/trash.zip"),
        }],
        groups: &[],
        errors: &[],
        moves: &[],
        events: &[(15, "Scanning SameA archive roots.")],
    },
    ParityCase {
        name: "an artist below the threshold is ignored with the threshold reason",
        source: "core.ts:154-155, core.ts:206",
        dirs: &[("/archive", &[("[Artist] one.zip", false), ("[Other] two.zip", false)])],
        failing: &[],
        input: r#"{"action":"plan","paths":["/archive"],"minOccurrences":2}"#,
        success: true,
        message: "SameA planned 0 archive transfer(s).",
        counts: Counts {
            scanned: 2,
            detected: 2,
            ready: 0,
            moved: 0,
            ignored: 2,
            skipped: 0,
            conflict: 0,
            error: 0,
        },
        items: &[
            ExpectedItem {
                source: "[Artist] one.zip",
                status: SameaPlanStatus::Ignored,
                reason: Some("below_min_occurrences"),
                target: Some("/archive/[Artist] one.zip"),
            },
            ExpectedItem {
                source: "[Other] two.zip",
                status: SameaPlanStatus::Ignored,
                reason: Some("below_min_occurrences"),
                target: Some("/archive/[Other] two.zip"),
            },
        ],
        groups: &[
            ExpectedGroup { name: "[Artist]", target_dir: "/archive/[Artist]", count: 1, status: "below_threshold" },
            ExpectedGroup { name: "[Other]", target_dir: "/archive/[Other]", count: 1, status: "below_threshold" },
        ],
        errors: &[],
        moves: &[],
        events: &[(15, "Scanning SameA archive roots.")],
    },
    ParityCase {
        name: "an archive already in its group skips and an existing target conflicts",
        source: "core.ts:159-160, core.ts:163-164, core.ts:227",
        dirs: &[
            ("/archive", &[("[Artist]", true), ("[Artist] one.zip", false)]),
            ("/archive/[Artist]", &[("[Artist] one.zip", false)]),
        ],
        failing: &[],
        input: r#"{"action":"plan","paths":["/archive"],"minOccurrences":2}"#,
        success: true,
        // `core.ts:105` fails the run on `errorCount`, and a conflict is not an error status: the plan answer
        // still reports success while `data.errors` carries the collision
        // (`node-definitions/samea.json:462` is the prose that says so).
        message: "SameA planned 0 archive transfer(s).",
        counts: Counts {
            scanned: 2,
            detected: 2,
            ready: 0,
            moved: 0,
            ignored: 0,
            skipped: 1,
            conflict: 1,
            error: 0,
        },
        items: &[
            ExpectedItem {
                source: "[Artist] one.zip",
                status: SameaPlanStatus::Skipped,
                reason: Some("same_path"),
                target: Some("/archive/[Artist]/[Artist] one.zip"),
            },
            ExpectedItem {
                source: "[Artist] one.zip",
                status: SameaPlanStatus::Conflict,
                reason: Some("target_exists"),
                target: Some("/archive/[Artist]/[Artist] one.zip"),
            },
        ],
        groups: &[ExpectedGroup {
            name: "[Artist]",
            target_dir: "/archive/[Artist]",
            count: 2,
            status: "ready",
        }],
        errors: &["/archive/[Artist] one.zip: target_exists"],
        moves: &[],
        events: &[(15, "Scanning SameA archive roots.")],
    },
    ParityCase {
        name: "centralize gathers every target under the artist-classification folder",
        source: "core.ts:205-207",
        dirs: &[("/archive", &[("[Artist] one.zip", false)])],
        failing: &[],
        input: r#"{"action":"plan","paths":["/archive"],"centralize":true}"#,
        success: true,
        message: "SameA planned 1 archive transfer(s).",
        counts: Counts {
            scanned: 1,
            detected: 1,
            ready: 1,
            moved: 0,
            ignored: 0,
            skipped: 0,
            conflict: 0,
            error: 0,
        },
        items: &[ExpectedItem {
            source: "[Artist] one.zip",
            status: SameaPlanStatus::Ready,
            reason: None,
            target: Some("/archive/[00画师分类]/[Artist]/[Artist] one.zip"),
        }],
        groups: &[ExpectedGroup {
            name: "[Artist]",
            target_dir: "/archive/[00画师分类]/[Artist]",
            count: 1,
            status: "ready",
        }],
        errors: &[],
        moves: &[],
        events: &[(15, "Scanning SameA archive roots.")],
    },
    ParityCase {
        name: "a regex blacklist that only catches the label marks the group blacklisted",
        source: "core.ts:183, core.ts:195, core.ts:246, core.ts:155",
        dirs: &[("/archive", &[("[Circle (Artist)] one.zip", false)])],
        failing: &[],
        // `\[…\]$` cannot match the bare candidate `Circle (Artist)` (`core.ts:215`) but does match the label
        // `[Circle (Artist)]` (`core.ts:246`) — the only route to the `artist_blacklisted` reason that
        // `core.ts:155` can report.
        input: r#"{"action":"plan","paths":["/archive"],"regexBlacklist":["\\[.*\\]$"]}"#,
        success: true,
        message: "SameA planned 0 archive transfer(s).",
        counts: Counts {
            scanned: 1,
            detected: 1,
            ready: 0,
            moved: 0,
            ignored: 1,
            skipped: 0,
            conflict: 0,
            error: 0,
        },
        items: &[ExpectedItem {
            source: "[Circle (Artist)] one.zip",
            status: SameaPlanStatus::Ignored,
            reason: Some("artist_blacklisted"),
            target: Some("/archive/[Circle (Artist)] one.zip"),
        }],
        groups: &[ExpectedGroup {
            name: "[Circle (Artist)]",
            target_dir: "/archive/[Circle (Artist)]",
            count: 0,
            status: "blacklisted",
        }],
        errors: &[],
        moves: &[],
        events: &[(15, "Scanning SameA archive roots.")],
    },
    ParityCase {
        name: "classify with dry run left on answers a plan and touches nothing",
        source: "core.ts:106, interaction.ts:46, node-definitions/samea.json:363-384",
        dirs: &[("/archive", &[("[Artist] one.zip", false), ("[Artist] two.zip", false)])],
        failing: &[],
        input: r#"{"action":"classify","paths":["/archive"]}"#,
        success: true,
        message: "SameA planned 2 archive transfer(s).",
        counts: Counts {
            scanned: 2,
            detected: 2,
            ready: 2,
            moved: 0,
            ignored: 0,
            skipped: 0,
            conflict: 0,
            error: 0,
        },
        items: &[
            ExpectedItem {
                source: "[Artist] one.zip",
                status: SameaPlanStatus::Ready,
                reason: None,
                target: Some("/archive/[Artist]/[Artist] one.zip"),
            },
            ExpectedItem {
                source: "[Artist] two.zip",
                status: SameaPlanStatus::Ready,
                reason: None,
                target: Some("/archive/[Artist]/[Artist] two.zip"),
            },
        ],
        groups: &[ExpectedGroup {
            name: "[Artist]",
            target_dir: "/archive/[Artist]",
            count: 2,
            status: "ready",
        }],
        errors: &[],
        // The gate's proof: two ready archives, and not one effect.
        moves: &[],
        events: &[(15, "Scanning SameA archive roots.")],
    },
    ParityCase {
        name: "a refused rename marks only that item and fails the run",
        source: "core.ts:116-117, core.ts:122, core.ts:254",
        dirs: &[("/archive", &[("[Artist] one.zip", false), ("[Artist] two.zip", false)])],
        failing: &[("/archive/[Artist]/[Artist] two.zip", "EACCES: permission denied")],
        input: r#"{"action":"classify","paths":["/archive"],"dryRun":false}"#,
        success: false,
        message: "SameA organized 1 archive(s).",
        counts: Counts {
            scanned: 2,
            detected: 2,
            ready: 0,
            moved: 1,
            ignored: 0,
            skipped: 0,
            conflict: 0,
            error: 1,
        },
        items: &[
            ExpectedItem {
                source: "[Artist] one.zip",
                status: SameaPlanStatus::Moved,
                reason: None,
                target: Some("/archive/[Artist]/[Artist] one.zip"),
            },
            ExpectedItem {
                source: "[Artist] two.zip",
                status: SameaPlanStatus::Error,
                reason: Some("EACCES: permission denied"),
                target: Some("/archive/[Artist]/[Artist] two.zip"),
            },
        ],
        groups: &[ExpectedGroup {
            name: "[Artist]",
            target_dir: "/archive/[Artist]",
            count: 2,
            status: "ready",
        }],
        errors: &["/archive/[Artist] two.zip: EACCES: permission denied"],
        moves: &[("/archive/[Artist] one.zip", "/archive/[Artist]/[Artist] one.zip")],
        events: &[
            (15, "Scanning SameA archive roots."),
            (65, "Organizing detected artist archives."),
            (100, "SameA organization completed."),
        ],
    },
    ParityCase {
        name: "a failed listing fails the whole run with the thrown message",
        source: "core.ts:123-125, core.ts:254",
        dirs: &[("/archive", &[("[Artist] one.zip", false)])],
        failing: &[("/archive", "ENOENT: no such file or directory, scandir")],
        input: r#"{"action":"plan","paths":["/archive"]}"#,
        success: false,
        message: "ENOENT: no such file or directory, scandir",
        counts: Counts {
            scanned: 0,
            detected: 0,
            ready: 0,
            moved: 0,
            ignored: 0,
            skipped: 0,
            conflict: 0,
            error: 1,
        },
        items: &[ExpectedItem {
            source: "",
            status: SameaPlanStatus::Error,
            reason: Some("ENOENT: no such file or directory, scandir"),
            target: Some(""),
        }],
        groups: &[],
        errors: &[": ENOENT: no such file or directory, scandir"],
        moves: &[],
        events: &[(15, "Scanning SameA archive roots.")],
    },
];

/// Builds the fixture a row describes: `core.test.ts:75-87`'s `fakeRuntime` as a value.
fn build_tree(case: &ParityCase) -> MemoryFileSystem {
    let mut tree = MemoryFileSystem::new();
    for (directory, entries) in case.dirs {
        tree = tree.with_directory(directory, entries);
    }
    for (path, message) in case.failing {
        tree = tree.with_failing_path(path, message);
    }
    tree
}

/// Runs every row of a table and returns how many were checked. An empty table is a hard failure: the
/// parity proof would otherwise be a green that proves nothing.
fn run_table(cases: &[ParityCase]) -> usize {
    assert!(!cases.is_empty(), "a parity table with no cases proves nothing");
    for case in cases {
        let mut tree = build_tree(case);
        let mut sink = CollectingEventSink::new();
        let request: Value =
            serde_json::from_str(case.input).unwrap_or_else(|error| panic!("{}: {error}", case.name));
        let result = run_samea(&request, &mut tree, &mut sink, &mut ContinueThroughRunControl);
        let document = serde_json::to_value(&result)
            .unwrap_or_else(|error| panic!("{}: result is not serializable: {error}", case.name));

        assert_eq!(result.success, case.success, "{} [{}]: `success`", case.name, case.source);
        assert_eq!(result.message, case.message, "{} [{}]: `message`", case.name, case.source);

        let data = document.get("data").cloned().unwrap_or(Value::Null);
        let counted = |key: &str| data.get(key).and_then(Value::as_u64).unwrap_or(u64::MAX) as usize;
        assert_eq!(counted("scannedCount"), case.counts.scanned, "{}: scannedCount", case.name);
        assert_eq!(counted("detectedCount"), case.counts.detected, "{}: detectedCount", case.name);
        assert_eq!(counted("readyCount"), case.counts.ready, "{}: readyCount", case.name);
        assert_eq!(counted("movedCount"), case.counts.moved, "{}: movedCount", case.name);
        assert_eq!(counted("ignoredCount"), case.counts.ignored, "{}: ignoredCount", case.name);
        assert_eq!(counted("skippedCount"), case.counts.skipped, "{}: skippedCount", case.name);
        assert_eq!(counted("conflictCount"), case.counts.conflict, "{}: conflictCount", case.name);
        assert_eq!(counted("errorCount"), case.counts.error, "{}: errorCount", case.name);

        let items = data.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
        assert_eq!(items.len(), case.items.len(), "{}: item count", case.name);
        for (index, expected) in case.items.iter().enumerate() {
            let actual = &items[index];
            assert_eq!(actual["sourceName"], json!(expected.source), "{}: sourceName", case.name);
            assert_eq!(
                actual["status"],
                json!(expected.status.as_str()),
                "{}: status of {}",
                case.name,
                expected.source
            );
            match expected.reason {
                Some(reason) => {
                    assert_eq!(actual["reason"], json!(reason), "{}: reason of {}", case.name, expected.source)
                }
                // `core.ts:164` never sets `reason` for a ready item and `JSON.stringify` drops the key, so
                // asserting it absent is part of the wire contract.
                None => assert!(
                    actual.get("reason").is_none(),
                    "{}: item {} must carry no reason, got {actual}",
                    case.name,
                    expected.source
                ),
            }
            if let Some(target) = expected.target {
                assert_eq!(
                    actual["targetPath"],
                    json!(target),
                    "{}: targetPath of {}",
                    case.name,
                    expected.source
                );
            }
        }

        let groups = data.get("groups").and_then(Value::as_array).cloned().unwrap_or_default();
        assert_eq!(groups.len(), case.groups.len(), "{}: group count", case.name);
        for (index, expected) in case.groups.iter().enumerate() {
            let actual = &groups[index];
            assert_eq!(actual["name"], json!(expected.name), "{}: group name", case.name);
            assert_eq!(
                actual["targetDir"],
                json!(expected.target_dir),
                "{}: group targetDir of {}",
                case.name,
                expected.name
            );
            assert_eq!(actual["count"], json!(expected.count), "{}: group count of {}", case.name, expected.name);
            assert_eq!(
                actual["status"],
                json!(expected.status),
                "{}: group status of {}",
                case.name,
                expected.name
            );
        }

        assert_eq!(
            data.get("errors").and_then(Value::as_array).cloned().unwrap_or_default(),
            case.errors.iter().map(|line| json!(line)).collect::<Vec<Value>>(),
            "{}: errors",
            case.name
        );
        assert_eq!(
            tree.recorded_moves().to_vec(),
            case.moves
                .iter()
                .map(|(source, target)| ((*source).to_string(), (*target).to_string()))
                .collect::<Vec<(String, String)>>(),
            "{}: applied moves",
            case.name
        );
        assert_eq!(
            sink.events,
            case.events
                .iter()
                .map(|(progress, message)| SameaRunEvent::Progress {
                    progress: *progress,
                    message: (*message).to_string()
                })
                .collect::<Vec<SameaRunEvent>>(),
            "{}: emitted events",
            case.name
        );
    }
    cases.len()
}

#[test]
fn every_parity_row_matches_the_typescript() {
    let checked = run_table(PARITY_CASES);
    assert_eq!(checked, PARITY_CASES.len());
    assert!(checked >= 14, "five vitest cases plus nine `core.ts` branches the vitest file never enters");
}

#[test]
#[should_panic(expected = "a parity table with no cases proves nothing")]
fn an_empty_case_list_is_refused_rather_than_green() {
    run_table(&[]);
}

/// `core.test.ts:6-8` — `extracts circle and artist names from archive brackets`.
#[test]
fn circle_and_artist_names_come_out_of_the_brackets() {
    let bare = Blacklists { artist: &[], path: &[], patterns: &PatternList::empty() };
    let found = extract_artist("[Circle (Artist A)] book.zip", &bare).expect("artist detected");
    assert_eq!(found.key, "circle\0artist a", "core.test.ts:7");
    assert_eq!(found.label, "[Circle (Artist A)]", "core.test.ts:7");

    // Negative control: with no brackets there is no artist at all.
    assert!(extract_artist("plain book.zip", &bare).is_none());
    // And an empty bracket pair is dropped by `filter(Boolean)` (`core.ts:213`).
    assert!(extract_artist("[] book.zip", &bare).is_none());
}

/// `core.ts:140`: the count that drives the threshold is per artist key, across every root, and an ignored
/// entry does not contribute.
#[test]
fn the_same_artist_across_two_roots_shares_one_count() {
    let mut tree = MemoryFileSystem::new()
        .with_directory("/a", &[("[Artist] one.zip", false)])
        .with_directory("/b", &[("[Artist] two.zip", false)]);
    let mut sink = NoopEventSink;
    let result = run_samea(
        &json!({ "action": "plan", "paths": ["/a", "/b"], "minOccurrences": 2 }),
        &mut tree,
        &mut sink,
        &mut ContinueThroughRunControl,
    );
    let data = result.data.expect("a plan document");
    assert_eq!(data.groups.len(), 2, "one group per (root, artist) pair (`core.ts:203`)");
    assert_eq!(data.groups[0].count, 2, "the count is global (`core.ts:140`)");
    assert_eq!(data.ready_count, 2, "both roots clear the shared threshold");
    // Negative control: with a threshold of three nothing clears.
    let mut strict_tree = MemoryFileSystem::new()
        .with_directory("/a", &[("[Artist] one.zip", false)])
        .with_directory("/b", &[("[Artist] two.zip", false)]);
    let mut strict_sink = NoopEventSink;
    let strict = run_samea(
        &json!({ "action": "plan", "paths": ["/a", "/b"], "minOccurrences": 3 }),
        &mut strict_tree,
        &mut strict_sink,
        &mut ContinueThroughRunControl,
    );
    assert_eq!(strict.data.expect("plan").ready_count, 0);
}

/// The dangerous action must be gated: same tree, same action, and the one boolean that decides whether
/// files move (`core.ts:106`, `interaction.ts:46`, `node-definitions/samea.json:363-384`).
#[test]
fn classify_is_dangerous_only_when_dry_run_is_off_and_only_then_moves() {
    let fixture = || {
        MemoryFileSystem::new()
            .with_directory("/archive", &[("[Artist] one.zip", false), ("[Artist] two.zip", false)])
    };

    let mut gated_tree = fixture();
    let mut gated_sink = NoopEventSink;
    let gated = run_samea(
        &json!({ "action": "classify", "paths": ["/archive"], "dryRun": true }),
        &mut gated_tree,
        &mut gated_sink,
        &mut ContinueThroughRunControl,
    );
    assert_eq!(gated.message, "SameA planned 2 archive transfer(s).");
    assert!(gated_tree.recorded_moves().is_empty(), "dry run is the gate");

    let mut armed_tree = fixture();
    let mut armed_sink = NoopEventSink;
    let armed = run_samea(
        &json!({ "action": "classify", "paths": ["/archive"], "dryRun": false }),
        &mut armed_tree,
        &mut armed_sink,
        &mut ContinueThroughRunControl,
    );
    assert_eq!(armed.message, "SameA organized 2 archive(s).");
    assert_eq!(armed_tree.recorded_moves().len(), 2, "the same input with the gate open moves both");

    // The gate as the faces read it, on the same two documents.
    let dry: Value = serde_json::from_str(&danger_samea_request_text(
        r#"{"action":"classify","paths":["/archive"],"dryRun":true}"#,
    ))
    .expect("json");
    assert_eq!(dry["dangerous"], json!(false), "a dry run must not open the confirmation");
    assert_eq!(
        dry["prompt"]["body"],
        json!("SameA 将移动就绪的归档文件。"),
        "interaction.ts:18 defaults the prompt language to zh"
    );
    let live: Value = serde_json::from_str(&danger_samea_request_text(
        r#"{"action":"classify","paths":["/archive"],"dryRun":false,"language":"en"}"#,
    ))
    .expect("json");
    assert_eq!(live["dangerous"], json!(true));
    assert_eq!(live["prompt"]["body"], json!("SameA will move ready archives."), "interaction.ts:47");
    assert_eq!(live["prompt"]["title"], json!("Confirm live classification"), "interaction.ts:47");

    // Third negative control: `plan` with dry run off is never dangerous (`core.ts:106` never moves).
    let planned: Value =
        serde_json::from_str(&danger_samea_request_text(r#"{"action":"plan","paths":["/archive"],"dryRun":false}"#))
            .expect("json");
    assert_eq!(planned["dangerous"], json!(false));
}

/// ADR-0066's cancellation, which has no TypeScript counterpart: a checkpoint answering `Cancelled` stops
/// the run, keeps the effects already applied, and still publishes the partial plan.
#[test]
fn a_cancelled_checkpoint_stops_the_run_and_reports_the_partial_plan() {
    let fixture = || {
        MemoryFileSystem::new()
            .with_directory("/archive", &[("[Artist] one.zip", false), ("[Artist] two.zip", false)])
    };

    let mut tree = fixture();
    let mut sink = NoopEventSink;
    // One checkpoint granted (the root listing), so the scan finishes and the first move boundary cancels.
    let result = run_samea(
        &json!({ "action": "classify", "paths": ["/archive"], "dryRun": false }),
        &mut tree,
        &mut sink,
        &mut CancelAfterRunControl::new(1),
    );
    assert!(!result.success);
    assert_eq!(result.message, "SameA was cancelled.");
    assert!(tree.recorded_moves().is_empty(), "nothing moved once the answer was Cancelled");
    let data = result.data.expect("a cancelled run still carries the plan");
    assert_eq!(data.ready_count, 2, "the items that never got their turn stay ready");
    assert_eq!(data.moved_count, 0);

    // Negative control: the same document with the checkpoint answering Continue does move.
    let mut moved_tree = fixture();
    let mut moved_sink = NoopEventSink;
    let moved = run_samea(
        &json!({ "action": "classify", "paths": ["/archive"], "dryRun": false }),
        &mut moved_tree,
        &mut moved_sink,
        &mut ContinueThroughRunControl,
    );
    assert!(moved.success);
    assert_eq!(moved_tree.recorded_moves().len(), 2);
}

/// ADR-0066 again, one phase earlier: a checkpoint that cancels during the scan ends the run before any plan
/// exists, in the shape `core.ts:123-125` already used for a thrown scan error.
#[test]
fn a_cancelled_scan_answers_like_the_thrown_error() {
    let mut tree = MemoryFileSystem::new().with_directory("/archive", &[("[Artist] one.zip", false)]);
    let mut sink = NoopEventSink;
    let result = run_samea(
        &json!({ "action": "plan", "paths": ["/archive"] }),
        &mut tree,
        &mut sink,
        &mut CancelAfterRunControl::new(0),
    );
    assert!(!result.success);
    assert_eq!(result.message, "operation cancelled");
    let data = result.data.expect("the failure document still carries a summary");
    assert_eq!(data.error_count, 1);
    assert_eq!(data.errors, vec![": operation cancelled".to_string()], "core.ts:227+242 project the message");
    assert!(tree.recorded_moves().is_empty());

    // Negative control: one granted checkpoint lets the scan finish.
    let mut granted = MemoryFileSystem::new().with_directory("/archive", &[("[Artist] one.zip", false)]);
    let mut granted_sink = NoopEventSink;
    let ok = run_samea(
        &json!({ "action": "plan", "paths": ["/archive"] }),
        &mut granted,
        &mut granted_sink,
        &mut CancelAfterRunControl::new(1),
    );
    assert!(ok.success);
}

/// `plan` and `classify` under a dry run must answer with the same document, because `core.ts:106` treats
/// them as one branch.
#[test]
fn plan_and_a_dry_run_classify_answer_identically() {
    let run_with = |action: &str, dry_run: bool| {
        let mut tree = MemoryFileSystem::new()
            .with_directory("/archive", &[("[Artist] one.zip", false), ("[Artist] two.zip", false)]);
        let mut sink = NoopEventSink;
        let result = run_samea(
            &json!({ "action": action, "paths": ["/archive"], "dryRun": dry_run }),
            &mut tree,
            &mut sink,
            &mut ContinueThroughRunControl,
        );
        (serde_json::to_value(&result).expect("serializable"), tree.recorded_moves().len())
    };

    let (planned, planned_moves) = run_with("plan", true);
    let (dry_classified, dry_moves) = run_with("classify", true);
    assert_eq!(planned, dry_classified);
    assert_eq!((planned_moves, dry_moves), (0, 0));

    // Negative control: the same action without the dry-run flag is a different document.
    let (live, live_moves) = run_with("classify", false);
    assert_ne!(planned, live);
    assert_eq!(live_moves, 2);
}

/// `core.ts:105`: when a plan carries more than one error the first one becomes the message, and the whole
/// plan is still returned.
#[test]
fn more_than_one_root_failure_reports_the_first_error_and_keeps_the_plan() {
    let mut tree = MemoryFileSystem::new().with_directory("/archive", &[("[Artist] one.zip", false)]);
    let mut sink = NoopEventSink;
    let result = run_samea(
        &json!({ "action": "plan", "paths": ["/oops", "/also-oops"] }),
        &mut tree,
        &mut sink,
        &mut ContinueThroughRunControl,
    );
    assert!(!result.success);
    assert_eq!(result.message, "/oops: root_not_directory");
    let data = result.data.expect("the plan document");
    assert_eq!(data.error_count, 2);
    assert_eq!(data.errors.len(), 2);

    // Negative control: a good root among the bad ones still plans its archive, and the single remaining
    // error line is what `core.ts:105` picks as the message.
    let mut mixed = MemoryFileSystem::new().with_directory("/archive", &[("[Artist] one.zip", false)]);
    let mut mixed_sink = NoopEventSink;
    let mixed = run_samea(
        &json!({ "action": "plan", "paths": ["/archive", "/oops"] }),
        &mut mixed,
        &mut mixed_sink,
        &mut ContinueThroughRunControl,
    );
    let data = mixed.data.expect("the mixed plan");
    assert_eq!(data.ready_count, 1);
    assert_eq!(data.error_count, 1);
    assert_eq!(data.errors, vec!["/oops: root_not_directory".to_string()]);
    assert_eq!(mixed.message, "/oops: root_not_directory");
}

/// `core.ts:84`: `paths` is a spread of `path`, `paths` and `listText`, and a request may carry all three.
#[test]
fn all_three_root_fields_contribute_in_order() {
    let input = with_base_input(r#"{"action":"plan","path":"/archive","listText":"/archive,/elsewhere"}"#);
    let normalized = normalize_samea_input(&serde_json::from_str::<Value>(&input).expect("json")).expect("normalized");
    assert_eq!(normalized.paths, vec!["/archive".to_string(), "/elsewhere".to_string()]);
}
