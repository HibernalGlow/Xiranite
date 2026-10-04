//! Cancel and pause, driven the way an operator drives them: from another thread, mid-run.
//!
//! ADR-0066's cooperative checkpoint plus ADR-0074's engine primitives mean a run has to stop for two
//! different reasons, in two different places, and the probe measured why both are needed:
//!
//! - **JS that never yields** (`while (true) {}`) is stopped by the engine's interrupt handler reading
//!   the same cancel flag the pump uses — `spikes/quickjs-probe` recorded `elapsed_ms=501` for a
//!   cancel asked for at 500 ms.
//! - **JS parked on host work** cannot be interrupted at all (`state=Pending`, no jobs pending), so
//!   the *host* has to release or refuse the wait. That is what `waitWhilePaused` is for.

mod support;

use std::time::{Duration, Instant};

use support::{Harness, fixture};
use xiranite_node_registry::{NodeDescriptor, NodeRunError, RootAccess, RootRequirement};
use xiranite_quickjs_executor::{EntryPlan, Executor, DEFAULT_HOST_POLL_INTERVAL};

/// The poll cadence these tests run at: fast enough to assert on, slow enough to be the shipped one
/// in spirit (the production default is 50 ms).
const TEST_POLL: Duration = Duration::from_millis(10);

fn descriptor(id: &'static str) -> NodeDescriptor {
    NodeDescriptor::new(id, "0.1.0", 1)
        .with_roots(&[RootRequirement { role: "workspace", access: RootAccess::ReadWrite }])
        .budget(8 * 1024 * 1024, 1)
}

fn spin_executor(id: &'static str) -> Executor<'static> {
    Executor::new(descriptor(id), EntryPlan {
        bundle_name: id,
        source: fixture("spin-node.js"),
        run_export: "run",
        create_runtime_export: None,
        pure_message: "spun",
    })
    .expect("budgeted")
    .with_host_poll_interval(TEST_POLL)
}

fn platform_executor(id: &'static str) -> Executor<'static> {
    Executor::new(descriptor(id), EntryPlan {
        bundle_name: id,
        source: fixture("platform-node.js"),
        run_export: "run",
        create_runtime_export: Some("createRuntime"),
        pure_message: "",
    })
    .expect("budgeted")
    .with_host_poll_interval(TEST_POLL)
}

/// (d) A runaway loop is interrupted within a stated bound once the operation is cancelled.
#[test]
fn a_cancel_from_another_thread_interrupts_a_spin_loop_within_its_poll_bound() {
    let harness = Harness::new("cancel", "quickjs-test.cancel");
    let manager = harness.manager.clone();
    let operation_id = harness.operation_id.clone();
    let asked_at = Instant::now();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(60));
        manager.cancel(&operation_id, "integration test");
    });

    let mut host = harness.host();
    // No `spinMs`, so the loop is infinite and only the interrupt can end the run.
    let error = spin_executor("quickjs-test.cancel")
        .with_run_deadline(Duration::from_secs(30))
        .run("{}", &mut host)
        .expect_err("a spin loop does not return on its own");
    let elapsed = asked_at.elapsed();

    assert_eq!(error.message, "operation cancelled", "{}", error.message);
    // Measured bound: the flag is polled every `TEST_POLL`, so the cancel should land within a few
    // intervals of the 60 ms the operator waited. 700 ms is the point at which this stopped being an
    // interrupt and started being the 30 s deadline, so a regression in either arm is caught.
    assert!(
        elapsed >= Duration::from_millis(50) && elapsed < Duration::from_millis(700),
        "the cancel was asked for at 60 ms and the run stopped after {elapsed:?}; the interrupt arm \
         is what makes this bound possible, so a value near the 30 s deadline means it broke"
    );

    // Positive control: the same bundle with a bounded spin completes and reports its work, so the
    // assertion above cannot be the result of a bundle that always fails. It needs its **own**
    // operation: this one is cancelled now, and `Executor` refuses to start JavaScript for a cancelled
    // operation (`a_run_that_completes_before_any_cancel_is_a_normal_document` asserts exactly that),
    // so reusing it would prove nothing about the bundle.
    let control = Harness::new("cancel-control", "quickjs-test.cancel-control");
    let mut second = control.host();
    let answer = spin_executor("quickjs-test.cancel-control")
        .run(r#"{"spinMs":30}"#, &mut second)
        .expect("a bounded spin finishes");
    let value: serde_json::Value = serde_json::from_str(&answer).expect("json");
    assert_eq!(value["message"], "spun", "{value}");
    assert_eq!(value["success"], true, "{value}");
    assert!(
        value["data"]["spins"].as_u64().expect("spins") > 0,
        "the loop must have actually run: {value}"
    );
    // And the cancelled operation does *not* get a second run, which is the difference between this
    // control proving the bundle works and proving the cancel arm works.
    let mut again = harness.host();
    let refused = spin_executor("quickjs-test.cancel")
        .run(r#"{"spinMs":30}"#, &mut again)
        .expect_err("a cancelled operation must not get another run");
    assert_eq!(refused.message, "operation cancelled", "{}", refused.message);
}

/// The other arm of the same fact: a *parked* run is cancelled by the host, not by the engine.
#[test]
fn a_cancel_releases_a_run_parked_in_wait_while_paused() {
    let harness = Harness::new("cancel-parked", "quickjs-test.cancel-parked");
    harness.root.write("notes.txt", "body\n");
    let manager = harness.manager.clone();
    let operation_id = harness.operation_id.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(80));
        manager.cancel(&operation_id, "integration test");
    });

    // Paused *before* the run: that is what makes the node's `waitWhilePaused` park instead of
    // answering immediately, so the cancel is asked for while the run is provably inside the wait.
    // The run is a platform run, so the executor does not read the host before launching JavaScript —
    // the bundle holds the triple and is the one that reaches the checkpoint.
    harness.pause();
    let mut host = harness.host();
    let request = format!(r#"{{"root":{:?}}}"#, harness.root.text().replace('\\', "/"));
    let started = Instant::now();
    let error = platform_executor("quickjs-test.cancel-parked")
        .with_run_deadline(Duration::from_secs(30))
        .run(&request, &mut host)
        .expect_err("the operation is cancelled while the node waits");
    assert_eq!(error.message, "operation cancelled", "{}", error.message);
    assert!(
        started.elapsed() < Duration::from_millis(2_000),
        "a cancel of pending host work must be released by the host: {:?}",
        started.elapsed()
    );

    // Where it stopped is the claim, and two facts pin it: the run got as far as the listing (the
    // events below) and no further than the wait (`summary.txt` is written *after* `waitWhilePaused`,
    // so its absence says the run was parked in the node's own wait when the cancel arrived).
    let lines = harness.event_lines();
    assert!(
        lines.iter().any(|(kind, message)| kind == "progress" && message == "fixture: listing"),
        "the bundle never reached its first await: {lines:?}"
    );
    assert!(
        harness.root.read("summary.txt").is_none(),
        "the run went past `waitWhilePaused`, so nothing was parked to be cancelled"
    );
}

/// Pause parks the run at the next `waitWhilePaused`, and resume releases it.
#[test]
fn wait_while_paused_actually_waits_and_a_resume_finishes_the_run() {
    let harness = Harness::new("pause", "quickjs-test.pause");
    harness.root.write("notes.txt", "paused body\n");
    let manager = harness.manager.clone();
    let operation_id = harness.operation_id.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(150));
        manager.resume(&operation_id);
    });

    // Paused *before* the run starts, so the first checkpoint the node reaches has to wait.
    harness.pause();
    let mut host = harness.host();
    let request = format!(r#"{{"root":{:?}}}"#, harness.root.text().replace('\\', "/"));
    let started = Instant::now();
    let answer = platform_executor("quickjs-test.pause")
        .with_run_deadline(Duration::from_secs(30))
        .run(&request, &mut host)
        .expect("the resume releases the wait and the run completes");
    let elapsed = started.elapsed();
    let value: serde_json::Value = serde_json::from_str(&answer).expect("json");

    assert_eq!(value["success"], true, "{value}");
    assert_eq!(value["data"]["content"], "paused body\n", "{value}");
    // `summary.txt` is written after `waitWhilePaused`, so its presence is the proof the run was
    // released by the resume and carried on, not aborted and not skipped.
    assert_eq!(
        harness.root.read("summary.txt").as_deref(),
        Some("paused body\n"),
        "the resumed run did not finish its work"
    );
    assert!(
        elapsed >= Duration::from_millis(100),
        "the run returned after {elapsed:?}, so `waitWhilePaused` did not wait for the resume"
    );

    // Positive control for the same bundle: unpaused, it does not sit around.
    let unpaused = Harness::new("pause-control", "quickjs-test.pause-control");
    unpaused.root.write("notes.txt", "body\n");
    let mut second = unpaused.host();
    let control_request = format!(r#"{{"root":{:?}}}"#, unpaused.root.text().replace('\\', "/"));
    let started = Instant::now();
    platform_executor("quickjs-test.pause-control")
        .run(&control_request, &mut second)
        .expect("the same run answers without a pause");
    assert!(
        started.elapsed() < Duration::from_millis(100),
        "an unpaused run waited {:?}, so the timing claim above measures nothing",
        started.elapsed()
    );
}

/// A run that never reaches a boundary of its own still cannot deliver an answer for an operation
/// that is already cancelled: the executor refuses it at the moment the answer would be handed back.
#[test]
fn a_run_that_settles_on_a_cancelled_operation_is_refused_at_the_settle_boundary() {
    // `function-node.js` is the bundle for this claim: it is a platform run (so the executor does not
    // read the host before launching JavaScript) whose `run` makes no host call and never awaits, so
    // the only place the cancel can be noticed is the boundary read before the document is returned.
    // Its `onEvent` line is refused by the manager (a cancelled operation is terminal) and a refused
    // report is not a failed run, so nothing else in the run could have answered the cancel.
    let harness = Harness::new("cancel-settle", "quickjs-test.cancel-settle");
    let plan = EntryPlan {
        bundle_name: "quickjs-test.cancel-settle",
        source: fixture("function-node.js"),
        run_export: "run",
        create_runtime_export: Some("createRuntime"),
        pure_message: "",
    };

    // Positive control first, on a live operation: the same bundle really does answer, so the refusal
    // below cannot be a bundle that never loaded or a host that always says cancelled.
    let mut live = harness.host();
    let answered = Executor::new(descriptor("quickjs-test.cancel-settle"), plan.clone())
        .expect("budgeted")
        .with_host_poll_interval(TEST_POLL)
        .run(r#"{"action":"plan"}"#, &mut live)
        .expect("a live operation gets its document");
    let value: serde_json::Value = serde_json::from_str(&answered).expect("json");
    assert_eq!(value["message"], "function fixture", "{value}");
    assert_eq!(value["data"]["action"], "plan", "{value}");

    harness.cancel();
    let mut cancelled = harness.host();
    let error = Executor::new(descriptor("quickjs-test.cancel-settle"), plan)
        .expect("budgeted")
        .with_host_poll_interval(TEST_POLL)
        .run(r#"{"action":"plan"}"#, &mut cancelled)
        .expect_err("a cancelled operation must not deliver a node's document");
    assert_eq!(error.message, "operation cancelled", "{}", error.message);
}

/// A cancel asked for *after* the run is over does not retroactively fail it, and the shipped poll
/// interval is the documented one.
#[test]
fn a_run_that_completes_before_any_cancel_is_a_normal_document() {
    let harness = Harness::new("late-cancel", "quickjs-test.late-cancel");
    harness.root.write("notes.txt", "fast body\n");
    let mut host = harness.host();
    let request = format!(r#"{{"root":{:?}}}"#, harness.root.text().replace('\\', "/"));
    let answer = platform_executor("quickjs-test.late-cancel")
        .run(&request, &mut host)
        .expect("nothing cancelled this run");
    assert!(answer.contains("fast body"), "{answer}");
    assert_eq!(
        DEFAULT_HOST_POLL_INTERVAL,
        Duration::from_millis(50),
        "the shipped cadence is the number the native host documents"
    );
    harness.cancel();
    let error: NodeRunError = spin_executor("quickjs-test.late-cancel")
        .run(r#"{"spinMs":1}"#, &mut harness.host())
        .expect_err("a cancelled operation must not schedule another run's work");
    // A pure bundle gets no `NodeRunControl` triple and `__xrh` answers no checkpoint operation, so it
    // has no boundary of its own: the executor reads the host *before* it evaluates the bundle, which
    // is what makes this a refusal to start rather than a run whose answer got thrown away. The test
    // below is what proves the difference, because a message alone cannot tell those two apart.
    assert_eq!(error.message, "operation cancelled", "{}", error.message);
}

/// The pre-launch read is a refusal to *start*, not a refusal to deliver: the bundle's write never
/// reaches the machine.
#[test]
fn a_cancelled_operation_does_not_get_a_pure_bundles_write_to_the_machine() {
    let harness = Harness::new("cancel-writer", "quickjs-test.cancel-writer");
    let plan = EntryPlan {
        bundle_name: "quickjs-test.cancel-writer",
        source: fixture("writer-node.js"),
        run_export: "run",
        create_runtime_export: None,
        pure_message: "written",
    };
    let request_for = |name: &str| {
        format!(r#"{{"target":{:?}}}"#, format!("{}/{}", harness.root.text().replace('\\', "/"), name))
    };

    // Positive control, on a live operation: the same bundle does reach the machine, so the absence of
    // the second file is about the cancel and not about a bundle that never ran.
    let mut live = harness.host();
    Executor::new(descriptor("quickjs-test.cancel-writer"), plan.clone())
        .expect("budgeted")
        .with_host_poll_interval(TEST_POLL)
        .run(&request_for("live.txt"), &mut live)
        .expect("a live operation runs the bundle");
    assert_eq!(
        harness.root.read("live.txt").as_deref(),
        Some("scheduled\n"),
        "the control write never landed, so nothing below measures anything"
    );

    harness.cancel();
    let mut cancelled = harness.host();
    let error = Executor::new(descriptor("quickjs-test.cancel-writer"), plan)
        .expect("budgeted")
        .with_host_poll_interval(TEST_POLL)
        .run(&request_for("cancelled.txt"), &mut cancelled)
        .expect_err("a cancelled operation must not get work done");
    assert_eq!(error.message, "operation cancelled", "{}", error.message);
    assert!(
        harness.root.read("cancelled.txt").is_none(),
        "the bundle ran and wrote, so the cancel was only noticed after the machine was touched"
    );
}
