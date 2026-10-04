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
