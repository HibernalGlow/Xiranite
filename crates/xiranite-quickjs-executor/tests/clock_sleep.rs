//! `clock.sleep` — the one way a realm node can wait, and the three properties that make waiting on
//! someone else's clock safe: it really waits, it cannot be asked to swallow the run's deadline, and a
//! cancel reaches it *during* the wait.
//!
//! Why these are tested here instead of in `host_calls.rs`'s unit module: the unit target of this crate
//! currently does not compile in this workspace (`findz_operations.rs:855` calls
//! `crate::sidecar::drain_watch_batches`, and `src/sidecar.rs` is still untracked). An integration test
//! builds against the same arm through the real `__xrh` door, which is the stronger claim anyway — the
//! wire name parses, the grant path is the production one, and the wait is measured from outside.

mod support;

use std::time::{Duration, Instant};

use support::{Harness, fixture};
use xiranite_node_registry::{NodeDescriptor, RootAccess, RootRequirement};
use xiranite_quickjs_executor::{EntryPlan, RealmRun};

/// Fast enough to assert on; the shipped cadence is 50 ms.
const TEST_POLL: Duration = Duration::from_millis(10);

/// A node that keeps waiting, with the deadline its registration would declare.
fn looper(node_id: &'static str, run_deadline_ms: Option<u64>) -> RealmRun<'static> {
    let descriptor = NodeDescriptor::new(node_id, "0.1.0", 1)
        .with_roots(&[RootRequirement { role: "workspace", access: RootAccess::ReadWrite }])
        .budget(8 * 1024 * 1024, 1);
    let descriptor = match run_deadline_ms {
        Some(milliseconds) => descriptor.run_deadline_ms(milliseconds),
        None => descriptor,
    };
    RealmRun::new(
        descriptor,
        EntryPlan {
            bundle_name: node_id,
            source: fixture("sleep-loop-node.js"),
            run_export: "run",
            create_runtime_export: None,
            pure_message: "waited",
        },
    )
    .expect("budgeted")
    .with_host_poll_interval(TEST_POLL)
}

/// The arm's per-call cap. The refusal test asserts against this number rather than a copy of it so the
/// two cannot drift apart.
const CAP_MS: u64 = 1_000;

fn sleeper(node_id: &'static str) -> RealmRun<'static> {
    RealmRun::new(
        NodeDescriptor::new(node_id, "0.1.0", 1)
            .with_roots(&[RootRequirement { role: "workspace", access: RootAccess::ReadWrite }])
            .budget(8 * 1024 * 1024, 1),
        EntryPlan {
            bundle_name: node_id,
            source: fixture("clock-sleep-node.js"),
            run_export: "run",
            create_runtime_export: None,
            pure_message: "slept",
        },
    )
    .expect("budgeted")
    .with_host_poll_interval(TEST_POLL)
}

fn waited_ms(answer: &str) -> u64 {
    let value: serde_json::Value = serde_json::from_str(answer).expect("the run answers JSON");
    value["data"]["waitedMs"].as_u64().unwrap_or_else(|| panic!("waitedMs missing from {value}"))
}

/// Both edges are timed: an arm that returned immediately would satisfy a `>=` alone, and one that
/// slept a fixed amount regardless of the request would satisfy a `<=` alone.
#[test]
fn a_sleep_waits_for_the_time_it_was_asked_for() {
    let harness = Harness::new("clock-sleep", "quickjs-test.clock-sleep");
    let mut host = harness.host();
    let started = Instant::now();

    let answer = sleeper("quickjs-test.clock-sleep")
        .run(r#"{"ms":400}"#, &mut host)
        .expect("a 400ms wait completes");
    let elapsed = started.elapsed();

    assert!(waited_ms(&answer) >= 400, "the arm reported {answer}");
    assert!(elapsed >= Duration::from_millis(400), "a 400ms wait returned after {elapsed:?}");
    assert!(elapsed < Duration::from_millis(2_500), "a 400ms wait took {elapsed:?}");

    // Control: the same door with `ms: 0` is a yield, not a sleep. This is the assertion that fails if
    // the arm waits a constant, and it costs the run nothing.
    let control = Harness::new("clock-sleep-zero", "quickjs-test.clock-sleep-zero");
    let mut second = control.host();
    let control_started = Instant::now();
    let zero = sleeper("quickjs-test.clock-sleep-zero")
        .run(r#"{"ms":0}"#, &mut second)
        .expect("a zero wait is legal");

    assert!(control_started.elapsed() < Duration::from_millis(400), "ms:0 slept anyway: {:?}", control_started.elapsed());
    assert!(waited_ms(&zero) < 400, "ms:0 reported {zero}");
}

/// The cap is what keeps the run's deadline authoritative: the pump that reads it only runs between
/// host calls, so a single call that could wait for hours would put the deadline out of reach for that
/// whole time. Refusing is the honest answer; silently truncating would hand the node a lie.
#[test]
fn one_call_above_the_cap_is_refused_with_the_number_that_explains_it() {
    let harness = Harness::new("clock-sleep-cap", "quickjs-test.clock-sleep-cap");
    let mut host = harness.host();

    // A node's own thrown error is a failure *document*, not a failed run (`realm_run.rs:130`), so this
    // reads the envelope the bundle's caller actually gets.
    let answer = sleeper("quickjs-test.clock-sleep-cap")
        .run(&format!(r#"{{"ms":{}}}"#, CAP_MS + 1), &mut host)
        .unwrap_or_else(|error| panic!("a refusal is a failure document, not a failed run: {}", error.message));
    let value: serde_json::Value = serde_json::from_str(&answer).expect("the answer is JSON");

    assert_eq!(value["success"], false, "an over-cap wait must not read as success: {value}");
    let message = value["message"].as_str().unwrap_or_else(|| panic!("no message in {value}"));
    assert!(message.contains(&CAP_MS.to_string()), "{message}");
    assert!(message.contains("deadline"), "{message}");

    // Control: one millisecond below the cap on the same door is accepted, so the refusal above is the
    // boundary and not a broken argument shape.
    let control = Harness::new("clock-sleep-under-cap", "quickjs-test.clock-sleep-under-cap");
    let mut second = control.host();
    let answer = sleeper("quickjs-test.clock-sleep-under-cap")
        .run(&format!(r#"{{"ms":{CAP_MS}}}"#), &mut second)
        .expect("the cap is inclusive");

    assert!(waited_ms(&answer) >= CAP_MS, "at the cap the arm reported {answer}");
}

/// The reason the arm loops in 50 ms rounds with a checkpoint at the top of each: a cancel that arrives
/// while a node is waiting has to end the wait. Without the rounds this test cannot pass, because the
/// run would simply complete its sleep first and report success.
#[test]
fn a_cancel_lands_inside_a_wait() {
    let harness = Harness::new("clock-sleep-cancel", "quickjs-test.clock-sleep-cancel");
    let manager = harness.manager.clone();
    let operation_id = harness.operation_id.clone();
    let asked_at = Instant::now();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(60));
        manager.cancel(&operation_id, "integration test");
    });

    let mut host = harness.host();
    let error = sleeper("quickjs-test.clock-sleep-cancel")
        .with_run_deadline(Duration::from_secs(30))
        .run(r#"{"ms":900}"#, &mut host)
        .expect_err("a cancelled operation does not get to finish its wait");

    assert_eq!(error.message, "operation cancelled", "{}", error.message);
    let elapsed = asked_at.elapsed();
    assert!(
        elapsed < Duration::from_millis(900),
        "the cancel was asked for at 60 ms and the run stopped after {elapsed:?}; a wait that ignores \
         its rounds would stop near 900 ms, which is the point of this test"
    );

    // Control: with no cancel pending, the same 900 ms wait completes. If this also came back early,
    // the assertion above would be measuring a broken arm rather than a delivered cancel.
    let control = Harness::new("clock-sleep-cancel-control", "quickjs-test.clock-sleep-cancel-control");
    let mut second = control.host();
    let answer = sleeper("quickjs-test.clock-sleep-cancel-control")
        .run(r#"{"ms":900}"#, &mut second)
        .expect("an uncancelled wait completes");

    assert!(waited_ms(&answer) >= 900, "uncancelled control reported {answer}");
}

/// The deadline a node declares is the difference between "the run was cut off mid-countdown" and "the
/// node finished counting down". 40 rounds of 50 ms is ~2 s of waiting; a 500 ms declared bound has to
/// end it, and nothing else about the call changes.
#[test]
fn a_declared_run_deadline_cuts_a_node_that_keeps_waiting() {
    let harness = Harness::new("clock-sleep-deadline", "quickjs-test.clock-sleep-deadline");
    let mut host = harness.host();
    let started = Instant::now();

    let error = looper("quickjs-test.clock-sleep-deadline", Some(500))
        .run(r#"{"rounds":40,"ms":50}"#, &mut host)
        .expect_err("a 500ms bound cannot survive 2s of waiting");
    let elapsed = started.elapsed();

    assert!(error.message.contains("deadline"), "{}", error.message);
    assert!(elapsed < Duration::from_millis(2_500), "the bound was ignored for {elapsed:?}");
}

/// Control, and the reason the test above is about the declaration rather than about the door: the same
/// bundle on the same cadence, with no declared bound, finishes. If this failed the deadline test would
/// be measuring a broken sleep arm.
#[test]
fn a_waiting_node_without_a_declaration_finishes_under_the_default_ceiling() {
    let harness = Harness::new("clock-sleep-default", "quickjs-test.clock-sleep-default");
    let mut host = harness.host();
    let started = Instant::now();

    let answer = looper("quickjs-test.clock-sleep-default", None)
        .run(r#"{"rounds":40,"ms":50}"#, &mut host)
        .expect("the executor's default ceiling is two minutes, so 2s of waiting is not cut off");
    let elapsed = started.elapsed();

    assert!(waited_ms(&answer) >= 40 * 50, "the loop reported {answer}");
    assert!(elapsed >= Duration::from_millis(2_000), "40 x 50ms returned after {elapsed:?}");
}
