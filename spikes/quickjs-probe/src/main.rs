//! The Windows-spike probe for ADR-0074, kept small enough to copy to a Windows box as-is.
//!
//! It answers three questions with numbers, on whatever machine it runs on:
//!   1. does `rquickjs` build and run here at all (pre-generated bindings, `bindgen` off);
//!   2. does `set_interrupt_handler` actually break a runaway script, and how fast;
//!   3. does `set_memory_limit` produce an observable failure instead of taking the process down.
//! Then it runs a real node bundle the same way the runtime would: evaluate the bundle, call its
//! entry with one JSON document, print the answer.
//!
//! Usage:
//!   quickjs-probe smoke
//!   quickjs-probe spin <ms-before-cancel>      # expects the interrupt to fire
//!   quickjs-probe alloc <mb>                   # expects a catchable memory-limit error
//!   quickjs-probe bundle <file.js> <input-json>
//!
//! Every probe prints one `probe=<name>` line plus measured fields; there is no JSON envelope
//! because the reader is a human filling in an ADR, not a program.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use rquickjs::{Context, Ctx, Function, Runtime};

/// Counts host calls so the probe can prove the shim was really reached.
static HOST_CALLS: AtomicUsize = AtomicUsize::new(0);

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mode = args.first().map(String::as_str).unwrap_or("smoke");
    let result = match mode {
        "smoke" => probe_smoke(),
        "spin" => probe_spin(args.get(1).and_then(|ms| ms.parse().ok()).unwrap_or(500)),
        "alloc" => probe_alloc(args.get(1).and_then(|mb| mb.parse().ok()).unwrap_or(64)),
        "bundle" => probe_bundle(
            args.get(1).map(String::as_str).unwrap_or_else(|| {
                eprintln!("bundle needs <file.js> <input-json>");
                std::process::exit(2);
            }),
            args.get(2).map(String::as_str).unwrap_or("{}"),
        ),
        "async" => probe_async(),
        "parked" => probe_parked(args.get(1).and_then(|ms| ms.parse().ok()).unwrap_or(200)),
        other => {
            eprintln!("unknown probe {other:?}");
            std::process::exit(2);
        }
    };
    if let Err(error) = result {
        println!("probe={mode} outcome=harness-error error={error}");
        std::process::exit(1);
    }
}

fn build_runtime(memory_limit_bytes: usize) -> Result<Runtime, rquickjs::Error> {
    let runtime = Runtime::new()?;
    if memory_limit_bytes > 0 {
        runtime.set_memory_limit(memory_limit_bytes);
    }
    runtime.set_max_stack_size(1024 * 1024);
    Ok(runtime)
}

fn install_host(ctx: &Ctx<'_>) -> Result<(), rquickjs::Error> {
    let globals = ctx.globals();

    // The host surface is deliberately tiny: one JSON-in/JSON-out call, one clock, one logger.
    // What the real runtime needs per node is measured elsewhere; what this probe needs is proof
    // that a JS -> Rust call lands.
    globals.set(
        "__hostCall",
        Function::new(ctx.clone(), |request: String| -> String {
            HOST_CALLS.fetch_add(1, Ordering::Relaxed);
            format!(r#"{{"ok":true,"echo":{}}}"#, json_string(&request))
        })?,
    )?;
    globals.set(
        "__hostNow",
        Function::new(ctx.clone(), || -> String {
            HOST_CALLS.fetch_add(1, Ordering::Relaxed);
            "2023-11-14T22:13:20.000Z".to_string()
        })?,
    )?;
    Ok(())
}

/// One promise Rust resolves *later*: the shape a node's `await fs.read(...)` needs.
///
/// The resolve function has to outlive the host call, which is what `Persistent` is for; the pump
/// loop below owns the clock, so "async host work" is really "the host decides when to settle".
struct Deferred {
    due: Instant,
    resolve: rquickjs::Persistent<Function<'static>>,
}

fn take_due(queue: &std::sync::Mutex<std::collections::VecDeque<Deferred>>) -> Vec<Deferred> {
    let mut guard = queue.lock().expect("deferred queue");
    let now = Instant::now();
    let mut due = Vec::new();
    let mut index = 0;
    while index < guard.len() {
        if guard[index].due <= now {
            due.push(guard.remove(index).expect("index checked"));
        } else {
            index += 1;
        }
    }
    due
}

fn probe_async() -> Result<(), rquickjs::Error> {
    let runtime = build_runtime(16 * 1024 * 1024)?;
    let context = Context::full(&runtime)?;
    let queue = Arc::new(std::sync::Mutex::new(std::collections::VecDeque::new()));
    let host_queue = Arc::clone(&queue);

    let started = Instant::now();
    // The promise cannot leave the scope it was created in, so it is kept as a Persistent and the
    // pump loop re-enters the context to look at it. `Runtime::is_job_pending` borrows the runtime, so
    // it must be called *outside* `Context::with` — that combination is what made the first version of
    // this probe panic with "RefCell already borrowed".
    let promise: rquickjs::Persistent<rquickjs::Promise<'static>> =
        context.with(|ctx| -> Result<_, rquickjs::Error> {
            install_host(&ctx)?;
            let host_ctx = ctx.clone();
            let deferred = Function::new(
                ctx.clone(),
                move |delay_ms: f64| -> rquickjs::Result<rquickjs::Promise<'_>> {
                    let (promise, resolve, _reject) = rquickjs::Promise::new(&host_ctx)?;
                    host_queue
                        .lock()
                        .expect("deferred queue")
                        .push_back(Deferred {
                            due: Instant::now() + Duration::from_millis(delay_ms.max(0.0) as u64),
                            resolve: rquickjs::Persistent::save(&host_ctx, resolve),
                        });
                    Ok(promise)
                },
            )?;
            ctx.globals().set("__hostDeferred", deferred)?;
            let promise = ctx.eval::<rquickjs::Promise, _>(
                r#"
                (async () => {
                    const echoed = __hostCall("first");
                    const waited = await __hostDeferred(40);
                    return "echoed=" + echoed + " waited=" + waited;
                })()
                "#,
            )?;
            Ok(rquickjs::Persistent::save(&ctx, promise))
        })?;

    let mut job_error: Option<String> = None;
    let deadline = Duration::from_millis(2000);
    while started.elapsed() < deadline {
        for entry in take_due(&queue) {
            context.with(|ctx| -> Result<(), rquickjs::Error> {
                let resolve = entry.resolve.clone().restore(&ctx)?;
                resolve.call::<_, ()>(("deferred-done",))
            })?;
        }
        if runtime.is_job_pending() {
            // `execute_pending_job` answers `JobException`, not `Error`: a throwing job is a failure of
            // the run, so it is reported rather than propagated as a harness error.
            if let Err(error) = runtime.execute_pending_job() {
                job_error = Some(format!("{error:?}"));
                break;
            }
        } else {
            std::thread::sleep(Duration::from_millis(2));
        }
        let settled = context.with(|ctx| -> Result<bool, rquickjs::Error> {
            let promise = promise.clone().restore(&ctx)?;
            Ok(promise.result::<String>().is_some())
        })?;
        if settled {
            break;
        }
    }

    let (state, outcome) = context.with(|ctx| -> Result<(String, String), rquickjs::Error> {
        let promise = promise.clone().restore(&ctx)?;
        let outcome = match promise.result::<String>() {
            None if job_error.is_some() => {
                format!("job failed: {}", job_error.unwrap_or_default())
            }
            None => "STILL-PENDING (the pump loop did not settle it)".to_string(),
            Some(Err(error)) => format!("rejected: {error}"),
            Some(Ok(value)) => format!("settled: {value}"),
        };
        Ok((format!("{:?}", promise.state()), outcome))
    })?;
    println!(
        "probe=async state={state} outcome={outcome} elapsed_ms={}",
        started.elapsed().as_millis()
    );
    // `Persistent` values must be gone before the runtime drops, or QuickJS aborts the process in
    // `JS_FreeRuntime` ("list_empty(&rt->gc_obj_list)"); the runtime's own lifecycle has to end in the
    // same order, so this is a rule the executor inherits, not a probe detail.
    queue.lock().expect("deferred queue").clear();
    drop(promise);
    drop(context);
    // Known open item, stated instead of hidden: with a promise that went through `Persistent`,
    // dropping the runtime still trips QuickJS's `JS_FreeRuntime` assertion
    // (`list_empty(&rt->gc_obj_list)`) even with the persistent and the context dropped first. The run
    // result above is unaffected; the *shutdown* path is what needs work, so the probe exits before the
    // abort can print a misleading failure. The executor cannot ship with this, and it is cheaper to
    // find it here than after the runtime layer is written.
    println!("probe=async note=shutdown-path-aborts-at-runtime-drop (see source comment)");
    std::process::exit(0);
}

/// A promise that never settles: what a blocked host call looks like to the engine.
///
/// This probe answers the cancel question that ADR-0074 has to get right: the interrupt handler only
/// runs while JS is executing, so a *parked* await cannot be interrupted from the engine side.
fn probe_parked(park_ms: u64) -> Result<(), rquickjs::Error> {
    let cancelled = Arc::new(AtomicBool::new(false));
    let runtime = build_runtime(16 * 1024 * 1024)?;
    let handler_flag = Arc::clone(&cancelled);
    runtime.set_interrupt_handler(Some(Box::new(move || {
        handler_flag.load(Ordering::Relaxed)
    })));
    let context = Context::full(&runtime)?;

    let promise: rquickjs::Persistent<rquickjs::Promise<'static>> =
        context.with(|ctx| -> Result<_, rquickjs::Error> {
            let promise = ctx.eval::<rquickjs::Promise, _>(
                r#"(async () => { await new Promise(() => {}); return "never"; })()"#,
            )?;
            Ok(rquickjs::Persistent::save(&ctx, promise))
        })?;
    let jobs_before = runtime.is_job_pending();
    std::thread::sleep(Duration::from_millis(park_ms));
    cancelled.store(true, Ordering::Relaxed);
    let jobs_after = runtime.is_job_pending();
    let state = context.with(|ctx| -> Result<String, rquickjs::Error> {
        let promise = promise.clone().restore(&ctx)?;
        Ok(format!("{:?}", promise.state()))
    })?;
    println!(
        "probe=parked state={state} jobs_pending_initially={jobs_before} \
         jobs_pending_after_cancel_flag={jobs_after} \
         (an interrupt cannot fire while the promise is parked: the host must abort from its own loop)"
    );
    Ok(())
}

fn probe_smoke() -> Result<(), rquickjs::Error> {
    let started = Instant::now();
    let runtime = build_runtime(16 * 1024 * 1024)?;
    let context = Context::full(&runtime)?;
    let answer = context.with(|ctx| {
        install_host(&ctx)?;
        ctx.eval::<String, _>(
            r#"
            const echoed = __hostCall(JSON.stringify({ hello: "world" }));
            const stamp = __hostNow();
            JSON.stringify({ echoed, stamp, sum: [1,2,3,4].reduce((a,b)=>a+b, 0) })
            "#,
        )
    })?;
    println!(
        "probe=smoke outcome=ok elapsed_ms={} host_calls={} answer={answer}",
        started.elapsed().as_millis(),
        HOST_CALLS.load(Ordering::Relaxed)
    );
    Ok(())
}

/// Runs one evaluation and reports the JS-level error text, not just `Error::Exception`.
///
/// The distinction matters for the ADR: "the allocation stopped" and "the allocation stopped
/// *because of the memory limit*" are different claims, and only the message tells them apart.
fn eval_reporting_js_error(context: &Context, source: &str) -> Result<(), String> {
    context.with(|ctx| match ctx.eval::<(), _>(source) {
        Ok(value) => Ok(value),
        Err(rquickjs::Error::Exception) => {
            let caught = ctx.catch();
            let message = caught
                .as_exception()
                .and_then(|exception| exception.message())
                .unwrap_or_else(|| "(no message)".to_string());
            Err(format!("JS exception: {message}"))
        }
        Err(other) => Err(other.to_string()),
    })
}

fn probe_spin(cancel_after_ms: u64) -> Result<(), rquickjs::Error> {
    let cancelled = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&cancelled);
    let runtime = build_runtime(16 * 1024 * 1024)?;
    let handler_flag = Arc::clone(&cancelled);
    runtime.set_interrupt_handler(Some(Box::new(move || {
        handler_flag.load(Ordering::Relaxed)
    })));

    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(cancel_after_ms));
        flag.store(true, Ordering::Relaxed);
    });

    let context = Context::full(&runtime)?;
    let started = Instant::now();
    let outcome = eval_reporting_js_error(&context, "while (true) {}");
    let elapsed = started.elapsed();
    match outcome {
        Ok(()) => println!(
            "probe=spin outcome=NOT-INTERRUPTED elapsed_ms={} (the runaway loop returned: interrupt handling is broken)",
            elapsed.as_millis()
        ),
        Err(message) => println!(
            "probe=spin outcome=interrupted cancel_after_ms={cancel_after_ms} elapsed_ms={} error={message}",
            elapsed.as_millis()
        ),
    }
    Ok(())
}

fn probe_alloc(megabytes: usize) -> Result<(), rquickjs::Error> {
    let runtime = build_runtime(megabytes * 1024 * 1024)?;
    let context = Context::full(&runtime)?;
    let started = Instant::now();
    // Keeps references alive so the engine cannot collect them before the limit is reached.
    let outcome = eval_reporting_js_error(
        &context,
        r#"
        const kept = [];
        for (;;) { kept.push(new Uint8Array(1024 * 1024)); }
        "#,
    );
    let elapsed = started.elapsed();
    match outcome {
        Ok(()) => println!(
            "probe=alloc outcome=NOT-LIMITED limit_mb={megabytes} elapsed_ms={} (allocation finished: the limit is not what stopped it)",
            elapsed.as_millis()
        ),
        Err(message) => println!(
            "probe=alloc outcome=failed-observably limit_mb={megabytes} elapsed_ms={} error={message}",
            elapsed.as_millis()
        ),
    }
    Ok(())
}

fn probe_bundle(path: &str, input: &str) -> Result<(), rquickjs::Error> {
    let source = std::fs::read_to_string(path).expect("bundle file");
    let runtime = build_runtime(64 * 1024 * 1024)?;
    let context = Context::full(&runtime)?;
    let started = Instant::now();
    let answer = context.with(|ctx| {
        install_host(&ctx)?;
        ctx.eval::<(), _>(source.as_bytes())?;
        let entry: Function = ctx.globals().get("__nodeEntry")?;
        entry.call::<_, String>((input.to_string(),))
    })?;
    println!(
        "probe=bundle outcome=ok bundle={path} elapsed_ms={} host_calls={} answer={answer}",
        started.elapsed().as_millis(),
        HOST_CALLS.load(Ordering::Relaxed)
    );
    Ok(())
}

/// Minimal JSON string quoting for the echo payload; the probe must not grow a serde dependency.
fn json_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for character in value.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            other => out.push(other),
        }
    }
    out.push('"');
    out
}
