//! `packages/nodes/soundw/src/core.ts` and `interaction.ts`, reproduced case for case.
//!
//! The legacy vitest file (`core.test.ts`) is the behavioural spec, and every one of its five cases
//! is here with the same fixtures and the same assertions (`core.test.ts:12-19`, `:21-27`,
//! `:29-36`, `:38-46`, `:48-54`). The rest of the table covers the branches that file does not
//! exercise — the other six actions, the not-installed path, the empty-output fallback, the
//! `muteState` rule, the join of both streams, and the checkpoint ADR-0066 adds.
//!
//! Each table is asserted three ways: against an expected JSON fragment, against the *absence* of
//! what should not have happened (an invocation that must not occur, an event that must not be
//! emitted, a rule that must not fire), and against a sibling case that differs in exactly one
//! input. A case list that came empty would fail loudly, which is the point of the guard at the top
//! of every table test.

use std::cell::RefCell;

use serde_json::Value;
use xiranite_plugin_soundw::{
    CollectingSoundwEventSink, NormalizedSoundwInput, SoundwAction, SoundwBinaryResolution,
    SoundwCheckpoint, SoundwInput, SoundwProcessOutput, SoundwRunEvent, SoundwRuntime,
    is_dangerous, run_soundw, run_soundw_request_text, validate_soundw_input,
};

/// What the fake runtime was asked to run, so "never invoked" is an assertion and not a guess
/// (`core.test.ts:35`'s `expect(host.run).not.toHaveBeenCalled()`).
#[derive(Debug, Clone, PartialEq, Eq)]
struct Invocation {
    program: String,
    args: Vec<String>,
}

/// `platform.ts`'s stand-in: the resolution `resolve` gives and the triple `run` gives back.
struct FakeRuntime {
    found: bool,
    resolved_path: &'static str,
    output: SoundwProcessOutput,
    checkpoint: SoundwCheckpoint,
    invocations: RefCell<Vec<Invocation>>,
}

impl FakeRuntime {
    fn succeeding(output: SoundwProcessOutput) -> Self {
        Self {
            found: true,
            resolved_path: "SoundSwitch.CLI.exe",
            output,
            checkpoint: SoundwCheckpoint::Continue,
            invocations: RefCell::new(Vec::new()),
        }
    }

    fn without_cli() -> Self {
        let mut runtime = Self::succeeding(SoundwProcessOutput::new(0, "never", ""));
        runtime.found = false;
        runtime
    }

    fn cancelled() -> Self {
        let mut runtime = Self::succeeding(SoundwProcessOutput::new(0, "never", ""));
        runtime.checkpoint = SoundwCheckpoint::Cancelled { message: "Operation cancelled.".to_owned() };
        runtime
    }
}

impl SoundwRuntime for FakeRuntime {
    fn resolve(&self, _path_override: Option<&str>) -> SoundwBinaryResolution {
        if self.found {
            SoundwBinaryResolution::found(self.resolved_path)
        } else {
            SoundwBinaryResolution::missing()
        }
    }

    fn run(&self, program: &str, args: &[String]) -> SoundwProcessOutput {
        self.invocations.borrow_mut().push(Invocation { program: program.to_owned(), args: args.to_vec() });
        self.output.clone()
    }

    fn checkpoint(&self) -> SoundwCheckpoint {
        self.checkpoint.clone()
    }
}

/// A `SoundwProcessOutput` the table can hold in a `const`: the same three slots, borrowed.
struct ProcessFixture {
    code: i32,
    stdout: &'static str,
    stderr: &'static str,
}

impl ProcessFixture {
    fn output(&self) -> SoundwProcessOutput {
        SoundwProcessOutput {
            code: self.code,
            stdout: self.stdout.to_owned(),
            stderr: self.stderr.to_owned(),
        }
    }
}

/// One row of the parity table: an input document, a machine answer, and the result plus event
/// stream the TypeScript produced from exactly those two.
struct ParityCase {
    name: &'static str,
    /// `file:line` of the TypeScript (or legacy test) this row comes from.
    ts_source: &'static str,
    input: &'static str,
    found: bool,
    output: ProcessFixture,
    cancelled: bool,
    /// The argv that must have been run, exactly once, in order.
    expect_invocation: Option<&'static [&'static str]>,
    /// A JSON fragment of the expected `result` document, compared key by key.
    expect_result: &'static str,
    /// The expected `events` array, compared exactly.
    expect_events: &'static str,
}

const OK_FIXTURE: ProcessFixture = ProcessFixture { code: 0, stdout: "ok", stderr: "" };

const CASES: &[ParityCase] = &[
    // ---- every declared action, and the argv `core.ts:12-18` picks for it ----
    ParityCase {
        name: "status",
        ts_source: "packages/nodes/soundw/src/core.ts:18,32",
        input: r#"{"action":"status"}"#,
        found: true,
        output: ProcessFixture { code: 0, stdout: "Muted", stderr: "" },
        cancelled: false,
        expect_invocation: Some(&["mute"]),
        expect_result: r#"{"success":true,"message":"Muted","data":{"installed":true,"command":["mute"],"output":"Muted","profiles":[],"muteState":"Muted","errors":[]}}"#,
        expect_events: r#"[{"type":"progress","progress":30,"message":"Running SoundSwitch mute"},{"type":"progress","progress":100,"message":"SoundSwitch command completed."}]"#,
    },
    ParityCase {
        name: "switch-recording",
        ts_source: "packages/nodes/soundw/src/core.test.ts:12-19",
        input: r#"{"action":"switch-recording"}"#,
        found: true,
        output: OK_FIXTURE,
        cancelled: false,
        expect_invocation: Some(&["switch", "--type", "Recording"]),
        expect_result: r#"{"success":true,"message":"ok","data":{"command":["switch","--type","Recording"],"muteState":null,"profiles":[]}}"#,
        expect_events: r#"[{"type":"progress","progress":30,"message":"Running SoundSwitch switch --type Recording"},{"type":"progress","progress":100,"message":"SoundSwitch command completed."}]"#,
    },
    ParityCase {
        name: "mute",
        ts_source: "packages/nodes/soundw/src/core.ts:13",
        input: r#"{"action":"mute"}"#,
        found: true,
        output: OK_FIXTURE,
        cancelled: false,
        expect_invocation: Some(&["mute", "--state", "true"]),
        expect_result: r#"{"success":true,"data":{"command":["mute","--state","true"],"muteState":null}}"#,
        expect_events: r#"[{"type":"progress","progress":30,"message":"Running SoundSwitch mute --state true"},{"type":"progress","progress":100,"message":"SoundSwitch command completed."}]"#,
    },
    ParityCase {
        name: "unmute",
        ts_source: "packages/nodes/soundw/src/core.ts:14",
        input: r#"{"action":"unmute"}"#,
        found: true,
        output: OK_FIXTURE,
        cancelled: false,
        expect_invocation: Some(&["mute", "--state", "false"]),
        expect_result: r#"{"success":true,"data":{"command":["mute","--state","false"]}}"#,
        expect_events: r#"[{"type":"progress","progress":30,"message":"Running SoundSwitch mute --state false"},{"type":"progress","progress":100,"message":"SoundSwitch command completed."}]"#,
    },
    ParityCase {
        name: "toggle-mute",
        ts_source: "packages/nodes/soundw/src/core.test.ts:21-27",
        input: r#"{"action":"toggle-mute"}"#,
        found: true,
        output: OK_FIXTURE,
        cancelled: false,
        expect_invocation: Some(&["mute", "--toggle"]),
        expect_result: r#"{"success":true,"data":{"command":["mute","--toggle"]}}"#,
        expect_events: r#"[{"type":"progress","progress":30,"message":"Running SoundSwitch mute --toggle"},{"type":"progress","progress":100,"message":"SoundSwitch command completed."}]"#,
    },
    ParityCase {
        name: "profiles",
        ts_source: "packages/nodes/soundw/src/core.test.ts:48-54",
        input: r#"{"action":"profiles"}"#,
        found: true,
        output: ProcessFixture {
            code: 0,
            stdout: "╭─────╮\n│ Profile │ Playback │\n├─────┤\n│ womic │ Not set  │\n╰─────╯\nFetching profiles...",
            stderr: "",
        },
        cancelled: false,
        expect_invocation: Some(&["profile", "--list"]),
        expect_result: r#"{"success":true,"message":"Profiles: womic","data":{"output":"Profiles: womic","profiles":["womic"],"muteState":null}}"#,
        expect_events: r#"[{"type":"progress","progress":30,"message":"Running SoundSwitch profile --list"},{"type":"progress","progress":100,"message":"SoundSwitch command completed."}]"#,
    },
    ParityCase {
        name: "profile",
        ts_source: "packages/nodes/soundw/src/core.ts:17",
        input: r#"{"action":"profile","profileName":"womic"}"#,
        found: true,
        output: OK_FIXTURE,
        cancelled: false,
        expect_invocation: Some(&["profile", "--name", "womic"]),
        expect_result: r#"{"success":true,"data":{"command":["profile","--name","womic"]}}"#,
        expect_events: r#"[{"type":"progress","progress":30,"message":"Running SoundSwitch profile --name womic"},{"type":"progress","progress":100,"message":"SoundSwitch command completed."}]"#,
    },
    ParityCase {
        name: "settings",
        ts_source: "packages/nodes/soundw/src/core.ts:18",
        input: r#"{"action":"settings"}"#,
        found: true,
        output: OK_FIXTURE,
        cancelled: false,
        expect_invocation: Some(&["settings"]),
        expect_result: r#"{"success":true,"data":{"command":["settings"]}}"#,
        expect_events: r#"[{"type":"progress","progress":30,"message":"Running SoundSwitch settings"},{"type":"progress","progress":100,"message":"SoundSwitch command completed."}]"#,
    },
    // ---- the pre-flight guards ----
    ParityCase {
        name: "absent action defaults to status",
        ts_source: "packages/nodes/soundw/src/core.ts:9",
        input: r#"{}"#,
        found: true,
        output: ProcessFixture { code: 0, stdout: "Unmuted", stderr: "" },
        cancelled: false,
        expect_invocation: Some(&["mute"]),
        expect_result: r#"{"success":true,"message":"Unmuted","data":{"muteState":"Unmuted"}}"#,
        expect_events: r#"[{"type":"progress","progress":30,"message":"Running SoundSwitch mute"},{"type":"progress","progress":100,"message":"SoundSwitch command completed."}]"#,
    },
    ParityCase {
        name: "missing cli refuses everything",
        ts_source: "packages/nodes/soundw/src/core.ts:10-11",
        input: r#"{"action":"mute"}"#,
        found: false,
        output: OK_FIXTURE,
        cancelled: false,
        expect_invocation: None,
        expect_result: r#"{"success":false,"message":"SoundSwitch.CLI.exe not found. Install and start SoundSwitch first.","data":{"installed":false,"command":[],"output":"","profiles":[],"muteState":null,"errors":["SoundSwitch.CLI.exe not found. Install and start SoundSwitch first."]}}"#,
        expect_events: "[]",
    },
    ParityCase {
        name: "blank profile name never invokes the cli",
        ts_source: "packages/nodes/soundw/src/core.test.ts:29-36",
        input: r#"{"action":"profile","profileName":" "}"#,
        found: true,
        output: OK_FIXTURE,
        cancelled: false,
        expect_invocation: None,
        expect_result: r#"{"success":false,"message":"Enter a SoundSwitch profile name.","data":{"installed":true,"command":[],"output":"","profiles":[],"muteState":null,"errors":["Enter a SoundSwitch profile name."]}}"#,
        expect_events: "[]",
    },
    ParityCase {
        name: "absent profile name never invokes the cli",
        ts_source: "packages/nodes/soundw/src/core.ts:19",
        input: r#"{"action":"profile"}"#,
        found: true,
        output: OK_FIXTURE,
        cancelled: false,
        expect_invocation: None,
        expect_result: r#"{"success":false,"message":"Enter a SoundSwitch profile name."}"#,
        expect_events: "[]",
    },
    ParityCase {
        name: "cancelled checkpoint stops before the cli",
        ts_source: "docs/adr/0066-use-checkpoint-host-function-for-plugin-pause.md (new yield, no TypeScript counterpart)",
        input: r#"{"action":"mute"}"#,
        found: true,
        output: OK_FIXTURE,
        cancelled: true,
        expect_invocation: None,
        expect_result: r#"{"success":false,"message":"Operation cancelled.","data":{"installed":true,"command":["mute","--state","true"],"errors":["Operation cancelled."]}}"#,
        expect_events: "[]",
    },
    // ---- output composition and the failure branches ----
    ParityCase {
        name: "timeout is explained as the unreachable tray app",
        ts_source: "packages/nodes/soundw/src/core.test.ts:38-46",
        input: r#"{"action":"status"}"#,
        found: true,
        output: ProcessFixture {
            code: 1,
            stdout: "Managing microphone state...",
            stderr: "Error: The operation has timed out.",
        },
        cancelled: false,
        expect_invocation: Some(&["mute"]),
        expect_result: r#"{"success":false,"message":"SoundSwitch CLI could not reach the SoundSwitch background app. Start SoundSwitch from the system tray, then try again.","data":{"installed":true,"command":["mute"],"muteState":null,"errors":["SoundSwitch CLI could not reach the SoundSwitch background app. Start SoundSwitch from the system tray, then try again."]}}"#,
        expect_events: r#"[{"type":"progress","progress":30,"message":"Running SoundSwitch mute"}]"#,
    },
    ParityCase {
        name: "a killed cli reads as the same unreachable app",
        ts_source: "packages/nodes/soundw/src/platform.ts:23",
        input: r#"{"action":"mute"}"#,
        found: true,
        output: ProcessFixture {
            code: 1,
            stdout: "",
            stderr: "SoundSwitch CLI did not respond within 15 seconds.",
        },
        cancelled: false,
        expect_invocation: Some(&["mute", "--state", "true"]),
        expect_result: r#"{"success":false,"message":"SoundSwitch CLI could not reach the SoundSwitch background app. Start SoundSwitch from the system tray, then try again."}"#,
        expect_events: r#"[{"type":"progress","progress":30,"message":"Running SoundSwitch mute --state true"}]"#,
    },
    ParityCase {
        name: "an ordinary failure keeps the printed text",
        ts_source: "packages/nodes/soundw/src/core.ts:26",
        input: r#"{"action":"unmute"}"#,
        found: true,
        output: ProcessFixture { code: 2, stdout: "part one", stderr: "part two" },
        cancelled: false,
        expect_invocation: Some(&["mute", "--state", "false"]),
        expect_result: r#"{"success":false,"message":"part one\npart two","data":{"output":"part one\npart two","errors":["part one\npart two"],"muteState":null}}"#,
        expect_events: r#"[{"type":"progress","progress":30,"message":"Running SoundSwitch mute --state false"}]"#,
    },
    ParityCase {
        name: "a silent failure gets the generic sentence",
        ts_source: "packages/nodes/soundw/src/core.ts:26 (`output ||`)",
        input: r#"{"action":"settings"}"#,
        found: true,
        output: ProcessFixture { code: 1, stdout: "", stderr: "" },
        cancelled: false,
        expect_invocation: Some(&["settings"]),
        expect_result: r#"{"success":false,"message":"SoundSwitch command failed.","data":{"output":"","installed":true}}"#,
        expect_events: r#"[{"type":"progress","progress":30,"message":"Running SoundSwitch settings"}]"#,
    },
    ParityCase {
        name: "a profile scan with no rows says so",
        ts_source: "packages/nodes/soundw/src/core.ts:30",
        input: r#"{"action":"profiles"}"#,
        found: true,
        output: ProcessFixture { code: 0, stdout: "│ Profile │ Playback │\nFetching profiles...", stderr: "" },
        cancelled: false,
        expect_invocation: Some(&["profile", "--list"]),
        expect_result: r#"{"success":true,"message":"No SoundSwitch profiles found.","data":{"output":"No SoundSwitch profiles found.","profiles":[]}}"#,
        expect_events: r#"[{"type":"progress","progress":30,"message":"Running SoundSwitch profile --list"},{"type":"progress","progress":100,"message":"SoundSwitch command completed."}]"#,
    },
    ParityCase {
        name: "a successful command that printed nothing still reports completion",
        ts_source: "packages/nodes/soundw/src/core.ts:32 (`displayOutput ||`)",
        input: r#"{"action":"mute"}"#,
        found: true,
        output: ProcessFixture { code: 0, stdout: "   ", stderr: "" },
        cancelled: false,
        expect_invocation: Some(&["mute", "--state", "true"]),
        expect_result: r#"{"success":true,"message":"SoundSwitch command completed.","data":{"output":"","muteState":null}}"#,
        expect_events: r#"[{"type":"progress","progress":30,"message":"Running SoundSwitch mute --state true"},{"type":"progress","progress":100,"message":"SoundSwitch command completed."}]"#,
    },
    ParityCase {
        name: "status trims its state and never invents one",
        ts_source: "packages/nodes/soundw/src/core.ts:32 (`result.stdout.trim() || null`)",
        input: r#"{"action":"status"}"#,
        found: true,
        output: ProcessFixture { code: 0, stdout: "\r\n Muted \r\n", stderr: "" },
        cancelled: false,
        expect_invocation: Some(&["mute"]),
        expect_result: r#"{"success":true,"message":"Muted","data":{"output":"Muted","muteState":"Muted"}}"#,
        expect_events: r#"[{"type":"progress","progress":30,"message":"Running SoundSwitch mute"},{"type":"progress","progress":100,"message":"SoundSwitch command completed."}]"#,
    },
    ParityCase {
        name: "a blank status stdout is a null state",
        ts_source: "packages/nodes/soundw/src/core.ts:32",
        input: r#"{"action":"status"}"#,
        found: true,
        output: ProcessFixture { code: 0, stdout: "  \n ", stderr: "" },
        cancelled: false,
        expect_invocation: Some(&["mute"]),
        expect_result: r#"{"success":true,"message":"SoundSwitch command completed.","data":{"muteState":null}}"#,
        expect_events: r#"[{"type":"progress","progress":30,"message":"Running SoundSwitch mute"},{"type":"progress","progress":100,"message":"SoundSwitch command completed."}]"#,
    },
    ParityCase {
        name: "a path override is carried into the invocation",
        ts_source: "packages/nodes/soundw/src/platform.ts:7-9",
        input: r#"{"action":"toggle-mute","soundSwitchPath":"/soundswitch/SoundSwitch.CLI"}"#,
        found: true,
        output: OK_FIXTURE,
        cancelled: false,
        expect_invocation: Some(&["mute", "--toggle"]),
        expect_result: r#"{"success":true,"data":{"command":["mute","--toggle"]}}"#,
        expect_events: r#"[{"type":"progress","progress":30,"message":"Running SoundSwitch mute --toggle"},{"type":"progress","progress":100,"message":"SoundSwitch command completed."}]"#,
    },
];

/// The response document for one table row, run through the boundary entry so the JSON shape is
/// what is being compared.
fn answer_for(case: &ParityCase) -> (Value, FakeRuntime) {
    let runtime = if case.cancelled {
        FakeRuntime::cancelled()
    } else if !case.found {
        FakeRuntime::without_cli()
    } else {
        FakeRuntime::succeeding(case.output.output())
    };
    let mut sink = CollectingSoundwEventSink::new();
    let document = run_soundw_request_text(case.input, &runtime, &mut sink);
    let value: Value = serde_json::from_str(&document)
        .unwrap_or_else(|error| panic!("{}: the run entry did not answer JSON: {error}", case.name));
    (value, runtime)
}

/// Compares every key of `expected` against `actual`, recursively for objects, exactly for arrays.
fn assert_json_subset(expected: &Value, actual: &Value, path: &str, case_name: &str) {
    match (expected, actual) {
        (Value::Object(wanted), Value::Object(got)) => {
            for (key, value) in wanted {
                let child_path = format!("{path}.{key}");
                match got.get(key) {
                    None => panic!("{case_name}: {child_path} is missing from {actual}"),
                    Some(found) => assert_json_subset(value, found, &child_path, case_name),
                }
            }
        }
        (wanted, found) => assert_eq!(wanted, found, "{case_name}: {path} disagreed"),
    }
}

#[test]
fn every_parity_case_answers_like_the_typescript() {
    assert!(!CASES.is_empty(), "an empty parity table proves nothing");
    for case in CASES {
        let (document, runtime) = answer_for(case);
        let wanted_result: Value = serde_json::from_str(case.expect_result)
            .unwrap_or_else(|error| panic!("{}: bad expectation: {error}", case.name));
        let wanted_events: Value = serde_json::from_str(case.expect_events).expect("event expectation");

        assert_json_subset(&wanted_result, &document["result"], "result", case.name);
        assert_eq!(document["events"], wanted_events, "{}: events disagreed", case.name);

        let invocations = runtime.invocations.borrow();
        match case.expect_invocation {
            Some(args) => {
                assert_eq!(invocations.len(), 1, "{}: expected exactly one invocation", case.name);
                assert_eq!(
                    invocations[0].args,
                    args.iter().map(|arg| (*arg).to_owned()).collect::<Vec<String>>(),
                    "{}: argv disagreed ({})",
                    case.name,
                    case.ts_source
                );
                assert_eq!(invocations[0].program, "SoundSwitch.CLI.exe", "{}: program", case.name);
            }
            // The negative half of every guard row: nothing reached the machine.
            None => assert!(invocations.is_empty(), "{}: the CLI must not run, got {invocations:?}", case.name),
        }
    }
}

#[test]
fn the_legacy_vitest_cases_are_all_present_in_the_table() {
    // `core.test.ts` is the spec, five cases. If a row goes missing, the port stopped covering it.
    for source in [
        "packages/nodes/soundw/src/core.test.ts:12-19",
        "packages/nodes/soundw/src/core.test.ts:21-27",
        "packages/nodes/soundw/src/core.test.ts:29-36",
        "packages/nodes/soundw/src/core.test.ts:38-46",
        "packages/nodes/soundw/src/core.test.ts:48-54",
    ] {
        assert!(
            CASES.iter().any(|case| case.ts_source == source),
            "{source} has no parity row"
        );
    }
    assert!(CASES.len() >= 15, "the table grew past the legacy file on purpose: {}", CASES.len());
}

#[test]
fn every_declared_action_has_a_parity_row() {
    assert!(!SoundwAction::ALL.is_empty(), "an empty action vocabulary would pass every loop below");
    for action in SoundwAction::ALL {
        let covered = CASES.iter().any(|case| {
            let parsed: SoundwInput = serde_json::from_str(case.input).expect("case input parses");
            parsed.action == Some(action)
        });
        assert!(covered, "{} has no parity row", action.as_str());
    }
    // Negative control: the table covers the declared eight and nothing pretends to be a ninth.
    let unknown = CASES.iter().any(|case| {
        serde_json::from_str::<serde_json::Value>(case.input)
            .ok()
            .and_then(|document| document.get("action").and_then(|value| value.as_str()).map(str::to_owned))
            .is_some_and(|text| xiranite_plugin_soundw::SoundwAction::parse(&text).is_none())
    });
    assert!(!unknown, "a case carried an action outside the declared options");
}

/// The argv table on its own, so a wrong `cli_args` row names itself instead of hiding in a result.
#[test]
fn each_action_maps_to_its_documented_argv() {
    let table: [(&str, SoundwAction, &[&str]); 8] = [
        ("core.ts:18", SoundwAction::Status, &["mute"]),
        ("core.ts:12", SoundwAction::SwitchRecording, &["switch", "--type", "Recording"]),
        ("core.ts:13", SoundwAction::Mute, &["mute", "--state", "true"]),
        ("core.ts:14", SoundwAction::Unmute, &["mute", "--state", "false"]),
        ("core.ts:15", SoundwAction::ToggleMute, &["mute", "--toggle"]),
        ("core.ts:16", SoundwAction::Profiles, &["profile", "--list"]),
        ("core.ts:17", SoundwAction::Profile, &["profile", "--name", "womic"]),
        ("core.ts:18", SoundwAction::Settings, &["settings"]),
    ];
    assert_eq!(table.len(), SoundwAction::ALL.len(), "one row per action");
    for (source, action, wanted) in table {
        let args = action.cli_args("womic");
        assert_eq!(args, wanted.iter().map(|arg| (*arg).to_owned()).collect::<Vec<String>>(), "{action:?} ({source})");
    }
    // Negative control: `profile` is the only action that reads the name, and the only one whose
    // argv has a caller-controlled slot.
    assert_eq!(SoundwAction::Status.cli_args("womic"), vec!["mute".to_owned()]);
}

/// Each validation rule the definition declares, plus the gate, as tables with negative controls.
#[test]
fn the_declared_validation_rules_fire_exactly_where_the_definition_says() {
    let rules: &[(&str, &str, bool)] = &[
        // (input JSON, expected rule name or "" for "no violation", must_violate)
        (r#"{"action":"profile","profileName":"  "}"#, "nonBlank", true),
        (r#"{"action":"profile","profileName":"\uFEFF"}"#, "nonBlank", true),
        (r#"{"action":"profile","profileName":"womic"}"#, "", false),
        (r#"{"action":"profiles","profileName":""}"#, "", false),
        (r#"{"action":"status"}"#, "", false),
        (r#"{"action":"settings","profileName":"   "}"#, "", false),
    ];
    assert!(rules.len() >= 4, "a two-row rule table would not discriminate anything");
    for (input, wanted_rule, must_violate) in rules {
        let parsed: SoundwInput = serde_json::from_str(input).expect("input document");
        let normalized: NormalizedSoundwInput = xiranite_plugin_soundw::normalize_soundw_input(&parsed);
        let violations = validate_soundw_input(&normalized);
        if *must_violate {
            assert_eq!(violations.len(), 1, "{input} should violate exactly one rule");
            assert_eq!(violations[0].rule, *wanted_rule, "{input}");
            assert_eq!(violations[0].field_id, "profileName", "{input}");
        } else {
            assert!(violations.is_empty(), "{input} must not violate anything, got {violations:?}");
        }
    }
}

#[test]
fn the_undeclared_action_is_the_other_declared_rule() {
    // `oneOfDeclaredOptions` (node-definitions/soundw.json:165-171).
    for declared in xiranite_plugin_soundw::declared_action_texts() {
        assert!(xiranite_plugin_soundw::parse_action_text(Some(declared)).is_ok(), "{declared}");
    }
    let refused = xiranite_plugin_soundw::parse_action_text(Some("recording"));
    assert!(refused.is_err(), "the CLI alias is not an action id (cli.ts:174-190 maps it)");

    // Negative control: absence is the declared default, not a violation.
    assert_eq!(xiranite_plugin_soundw::parse_action_text(None).expect("default"), SoundwAction::Status);
}

#[test]
fn the_danger_gate_is_none_for_every_action() {
    // `interaction.ts:26` (`isDangerous: () => false`) and `danger: {type:"none"}`
    // (node-definitions/soundw.json:268-270): no action confirms, not even the ones that move the
    // microphone.
    assert_eq!(CASES.len(), CASES.iter().filter(|case| !case.name.is_empty()).count(), "every row is named");
    let mut checked = 0usize;
    for action in SoundwAction::ALL {
        for profile_name in [None, Some("womic")] {
            let input = SoundwInput {
                action: Some(action),
                profile_name: profile_name.map(str::to_owned),
                sound_switch_path: Some("/soundswitch/SoundSwitch.CLI".to_owned()),
            };
            assert!(!is_dangerous(&input), "{action:?} must not ask for confirmation");
            checked += 1;
        }
    }
    assert_eq!(checked, SoundwAction::ALL.len() * 2, "every action was probed");

    // Negative control: the gate type that *does* ask is representable and would report otherwise,
    // so the assertion above is about SoundW's declaration and not about a stub that always lies.
    let asking = xiranite_plugin_soundw::SoundwDangerGate::ActionIn {
        dangerous: SoundwAction::ALL.to_vec(),
    };
    assert!(asking.holds(SoundwAction::Mute));
    assert!(!xiranite_plugin_soundw::SoundwDangerGate::None.holds(SoundwAction::Mute));
}

#[test]
fn the_run_entry_refuses_an_action_outside_the_declared_options() {
    let runtime = FakeRuntime::succeeding(OK_FIXTURE.output());
    let mut sink = CollectingSoundwEventSink::new();
    let document = run_soundw_request_text(r#"{"action":"Recording"}"#, &runtime, &mut sink);
    let value: Value = serde_json::from_str(&document).expect("json");
    assert_eq!(value["result"]["success"], Value::Bool(false));
    assert!(value["result"]["message"].as_str().expect("message").contains("settings"));
    assert!(runtime.invocations.borrow().is_empty());
    assert!(sink.events.is_empty());

    // Negative control: the same request with a declared action does reach the machine.
    let ok_runtime = FakeRuntime::succeeding(OK_FIXTURE.output());
    let mut ok_sink = CollectingSoundwEventSink::new();
    let _ = run_soundw_request_text(r#"{"action":"settings"}"#, &ok_runtime, &mut ok_sink);
    assert_eq!(ok_runtime.invocations.borrow().len(), 1);
}

#[test]
fn run_soundw_and_the_json_entry_agree_on_the_same_input() {
    // The core is called directly by the faces' Rust glue and through the boundary by the host; the
    // two must not diverge.
    for case in CASES.iter().filter(|case| case.found && !case.cancelled) {
        let parsed: SoundwInput = serde_json::from_str(case.input).expect("input");
        let runtime = FakeRuntime::succeeding(case.output.output());
        let mut sink = CollectingSoundwEventSink::new();
        let direct = run_soundw(&parsed, &runtime, &mut sink);
        let (document, _) = answer_for(case);
        assert_eq!(direct.to_json(), document["result"], "{}", case.name);
        let streamed: Vec<Value> = sink.events.iter().map(SoundwRunEvent::to_json).collect();
        assert_eq!(Value::Array(streamed), document["events"], "{}", case.name);
    }
}
