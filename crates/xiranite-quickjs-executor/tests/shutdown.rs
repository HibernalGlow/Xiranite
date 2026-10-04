//! The shutdown path, measured in child processes.
//!
//! `spikes/quickjs-probe/README.md` left one item open and refused to hide it: with a promise that
//! went through `rquickjs::Persistent`, dropping the runtime still tripped QuickJS's `JS_FreeRuntime`
//! assertion `list_empty(&rt->gc_obj_list)`, and the probe worked around it by exiting before the
//! abort could print. An executor cannot do that — it runs many nodes inside one desktop process, and
//! an abort there takes the app with it.
//!
//! This file measures two claims, both in a **child process**, because the failure mode is a signal
//! death that would otherwise kill the whole test binary and hide every other result:
//!
//! 1. **the shipped path exits cleanly.** `__xrh.callAsync` keeps its promise resolvers in a JS-side
//!    registry keyed by an integer and hands Rust only that integer, so no `Persistent` handle is ever
//!    created; the harness binary running a real async node and returning 0 *is* the measurement, and
//!    the same for a run that was interrupted.
//! 2. **the probe's `Persistent` shape is the difference**, exercised through `--feature probe` plus
//!    the `XIRANITE_SHUTDOWN_CHILD` env guard so the reproduction is not in the default test run.
//!    Measured on this machine (macOS 27 beta, arm64, rquickjs 0.14 with the pre-generated bindings)
//!    by `cargo test --features probe --test shutdown -- --exact \
//!    the_probe_reproduction_can_be_rerun_and_its_answer_is_printed --nocapture`:
//!    `exit=None signal=Some(6)` with `Assertion failed: (list_empty(&rt->gc_obj_list)), function
//!    JS_FreeRuntime, line 2704` — the abort reproduces, and the three child-process tests above pass
//!    without it. That is the whole argument for the JS-side resolver registry in `crate::shims`.

mod support;

use std::process::Command;

/// The harness binary's bundle, addressed by absolute path so the test does not depend on the cwd.
const PLATFORM_BUNDLE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/platform-node.js");
const SPIN_BUNDLE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/spin-node.js");

/// 1. The executor's shutdown path after a settled async run.
#[test]
fn a_shipped_async_run_exits_cleanly_from_a_child_process() {
    let root = support::TempRoot::new("shutdown-async");
    root.write("notes.txt", "shutdown body\n");
    let request = format!(r#"{{"root":{:?}}}"#, root.text().replace('\\', "/"));

    let output = Command::new(env!("CARGO_BIN_EXE_quickjs-run"))
        .arg(PLATFORM_BUNDLE)
        .arg("run")
        .arg("createRuntime")
        .arg(&request)
        .arg(root.path())
        .arg("--deadline-ms")
        .arg("5000")
        .output()
        .expect("the harness binary runs");

    // The status is the claim: `JS_FreeRuntime`'s assertion aborts the process, so a signal death
    // here means the executor leaks a GC object at teardown.
    assert!(
        output.status.success(),
        "exit={:?} stderr={}",
        output.status.code(),
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let document: serde_json::Value = serde_json::from_str(stdout.trim()).unwrap_or_else(|error| {
        panic!("stdout is not exactly one document: {stdout:?} ({error})")
    });
    assert_eq!(document["success"], true, "{document}");
    assert_eq!(document["data"]["content"], "shutdown body\n", "{document}");

    // Positive control: the async arm really ran, so a clean exit is not an early bail.
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    assert!(stderr.contains("elapsed_ms="), "no summary line, so no run: {stderr}");
    assert!(stderr.contains("events=3"), "the run reported nothing: {stderr}");
    assert!(
        !stderr.contains("Persistent"),
        "the executor must not have taken the probe's route: {stderr}"
    );
}

/// The same claim for a run that was **interrupted**, since teardown after an interrupt is a
/// different path out of the engine.
#[test]
fn an_interrupted_run_also_exits_cleanly_from_a_child_process() {
    let root = support::TempRoot::new("shutdown-cancel");
    let output = Command::new(env!("CARGO_BIN_EXE_quickjs-run"))
        .arg(SPIN_BUNDLE)
        .arg("run")
        .arg("-")
        .arg("{}")
        .arg(root.path())
        .arg("--deadline-ms")
        .arg("5000")
        .arg("--cancel-after-ms")
        .arg("120")
        .arg("--poll-ms")
        .arg("10")
        .output()
        .expect("the harness binary runs");

    // A cancelled run is exit 2 with a parseable document, and it must still not be a signal death.
    assert!(
        !output.status.success(),
        "a cancelled run may never read as success"
    );
    assert_eq!(
        output.status.code(),
        Some(2),
        "a signal death here is the shutdown trap, not a cancel: signal={:?}",
        output_status_signal(&output)
    );
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let document: serde_json::Value = serde_json::from_str(stdout.trim())
        .unwrap_or_else(|error| panic!("stdout is not exactly one document: {stdout:?} ({error})"));
    assert_eq!(document["success"], false, "{document}");
    assert!(
        document["message"]
            .as_str()
            .unwrap_or_default()
            .contains("operation cancelled"),
        "{document}"
    );
}

/// 1b. And for a run that hit its wall-clock bound from inside a spin loop, which is the arm where
/// the engine's interrupt is the only thing that could have gotten out.
#[test]
fn a_deadline_stop_from_a_spin_loop_exits_cleanly_too() {
    let root = support::TempRoot::new("shutdown-deadline");
    let output = Command::new(env!("CARGO_BIN_EXE_quickjs-run"))
        .arg(SPIN_BUNDLE)
        .arg("run")
        .arg("-")
        .arg("{}")
        .arg(root.path())
        .arg("--deadline-ms")
        .arg("150")
        .arg("--poll-ms")
        .arg("10")
        .output()
        .expect("the harness binary runs");

    assert_eq!(
        output.status.code(),
        Some(2),
        "signal={:?} stderr={}",
        output_status_signal(&output),
        String::from_utf8_lossy(&output.stderr)
    );
    let document: serde_json::Value =
        serde_json::from_str(String::from_utf8_lossy(&output.stdout).trim()).expect("one document");
    assert_eq!(document["success"], false, "{document}");
}

/// The child-process entry point for the probe reproduction.
#[test]
fn persistent_promise_shutdown_probe_child() {
    if std::env::var("XIRANITE_SHUTDOWN_CHILD").as_deref() != Ok("persistent") {
        // Not the child: assert the shape of the guard rather than run the trap. `cargo test --test
        // shutdown` without the env must never abort on its own.
        return;
    }
    probe_persistent_shape();
    eprintln!("XIRANITE_SHUTDOWN_CHILD=persistent: the runtime dropped without an abort");
}

/// Runs the child twice — once with the probe's `Persistent` shape, once with the guard off — and
/// reports which way this machine answers. It asserts the *harness* works either way, because the
/// shipped path is what the crate promises; the probe result is recorded in `README.md`.
#[test]
fn the_probe_reproduction_can_be_rerun_and_its_answer_is_printed() {
    let exe = std::env::current_exe().expect("test binary");
    let run = |child: bool| {
        let mut command = Command::new(&exe);
        command.arg("--exact").arg("persistent_promise_shutdown_probe_child").arg("--nocapture");
        if child {
            command.env("XIRANITE_SHUTDOWN_CHILD", "persistent");
        }
        command.output().expect("the child runs")
    };

    let guarded = run(false);
    assert!(
        guarded.status.success(),
        "the probe child must be inert without its env guard: {}",
        String::from_utf8_lossy(&guarded.stderr)
    );

    let probe = run(true);
    // Both answers are information, so print rather than guess. The shipped path's claim is the two
    // tests above, which fail loudly if QuickJS does abort on teardown.
    eprintln!(
        "probe(Persistent) exit={:?} signal={:?} stderr_tail={}",
        probe.status.code(),
        output_status_signal(&probe),
        tail(&String::from_utf8_lossy(&probe.stderr))
    );
}

fn output_status_signal(output: &std::process::Output) -> Option<i32> {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        output.status.signal()
    }
    #[cfg(not(unix))]
    {
        let _ = output;
        None
    }
}

fn tail(text: &str) -> String {
    let lines: Vec<&str> = text.lines().filter(|line| !line.is_empty()).collect();
    let start = lines.len().saturating_sub(6);
    lines[start..].join(" | ")
}

/// The probe's `probe_async`, reduced to the two facts it turned on: a promise held as a
/// `Persistent`, re-entered from the pump, then dropped in the documented order.
///
/// Deliberately *not* the executor's design. It exists so the difference between "no Persistent
/// anywhere" and "one Persistent promise" stays measurable rather than folkloric. Gated behind the
/// `probe` feature because a known-aborting path has no business in a default test run.
#[cfg(feature = "probe")]
fn probe_persistent_shape() {
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use rquickjs::{Context, Function, Promise, Runtime};

    struct Deferred {
        due: Instant,
        resolve: rquickjs::Persistent<Function<'static>>,
    }

    let runtime = Runtime::new().expect("runtime");
    runtime.set_memory_limit(16 * 1024 * 1024);
    runtime.set_max_stack_size(1024 * 1024);
    let context = Context::full(&runtime).expect("context");
    let queue: Arc<Mutex<VecDeque<Deferred>>> = Arc::new(Mutex::new(VecDeque::new()));
    let host_queue = Arc::clone(&queue);

    let promise: rquickjs::Persistent<Promise<'static>> = context
        .with(|ctx| -> rquickjs::Result<rquickjs::Persistent<Promise<'static>>> {
            let host_ctx = ctx.clone();
            let deferred = Function::new(ctx.clone(), move |delay_ms: f64| -> rquickjs::Result<Promise<'_>> {
                let (promise, resolve, _reject) = Promise::new(&host_ctx)?;
                host_queue.lock().expect("queue").push_back(Deferred {
                    due: Instant::now() + Duration::from_millis(delay_ms.max(0.0) as u64),
                    resolve: rquickjs::Persistent::save(&host_ctx, resolve),
                });
                Ok(promise)
            })?;
            ctx.globals().set("__hostDeferred", deferred)?;
            let started = ctx.eval::<Promise, _>(
                r#"(async () => { const waited = await __hostDeferred(20); return "waited=" + waited; })()"#,
            )?;
            // The rule the executor inherited: this line may not exist.
            Ok(rquickjs::Persistent::save(&ctx, started))
        })
        .expect("the probe's setup runs");

    let mut settled = false;
    let started = Instant::now();
    while started.elapsed() < Duration::from_millis(1_000) {
        let due: Vec<rquickjs::Persistent<Function<'static>>> = {
            let mut guard = queue.lock().expect("queue");
            let now = Instant::now();
            let mut due = Vec::new();
            while guard.front().is_some_and(|entry| entry.due <= now) {
                due.push(guard.pop_front().expect("front").resolve);
            }
            due
        };
        for resolve in due {
            context.with(|ctx| -> rquickjs::Result<()> {
                let resolve = resolve.clone().restore(&ctx)?;
                resolve.call::<_, ()>(("deferred-done",))
            })
            .expect("the deferred settles");
        }
        while runtime.is_job_pending() {
            let _ = runtime.execute_pending_job();
        }
        let done = context
            .with(|ctx| -> rquickjs::Result<bool> {
                let restored = promise.clone().restore(&ctx)?;
                Ok(restored.result::<String>().is_some())
            })
            .expect("the promise is readable");
        if done {
            settled = true;
            break;
        }
    }
    assert!(
        settled,
        "the probe's async shape must still settle before the shutdown question matters"
    );

    // The documented teardown: persistent handles first, then the context, then the runtime. The
    // probe recorded the abort happening anyway, at this exact point.
    let mut guard = queue.lock().expect("queue");
    guard.clear();
    drop(guard);
    drop(promise);
    drop(context);
    drop(runtime);
    eprintln!("XIRANITE_SHUTDOWN_CHILD: dropped the runtime without an abort");
}

/// Without the feature, the child entry point says what it did not do, so a run that forgot `--features
/// probe` cannot be mistaken for the measurement.
#[cfg(not(feature = "probe"))]
fn probe_persistent_shape() {
    panic!("the probe reproduction needs `--features probe`; the shipped path is covered by the tests above");
}
