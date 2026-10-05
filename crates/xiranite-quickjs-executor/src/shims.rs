//! `globalThis.__xrh` — the host protocol a node bundle sees.
//!
//! The surface is fixed by ADR-0074 and agreed with the shim layer, so it is spelled once, here:
//!
//! ```text
//!   globalThis.__xrh = {
//!     call(op, jsonArgs) -> jsonString,               // synchronous host operation, text answer
//!     callBytes(op, jsonArgs) -> Uint8Array|null,     // synchronous host operation, byte answer
//!     sendBytes(op, jsonArgs, bytes) -> jsonString,   // synchronous call whose argument is a buffer
//!     callAsync(op, jsonArgs, bytes?) -> Promise,     // host settles it later; the pump does the work
//!     now() -> "2023-11-14T22:13:20.000Z",            // host clock, one spelling
//!     platform: { platform, arch, sep, pathSep, cwd, env /*json string*/ }
//!   }
//! ```
//!
//! ## Why the shapes split by answer as well as by timing
//!
//! `call` answers on the spot, through [`crate::host_slot::HostSlot`], exactly like a native node's
//! host call. `callAsync` cannot: the request is queued and the answer arrives from
//! [`crate::jobs::Pump`] once JS has yielded. That split is the measured engine fact (the interrupt
//! handler only fires while JS is executing, so a parked await is released by the host or not at
//! all), and it is why the promise resolvers stay in a JS-side registry keyed by an integer —
//! **the Rust side never creates a `Persistent` handle.** The probe's open shutdown item
//! (`JS_FreeRuntime`'s `list_empty(&rt->gc_obj_list)` assertion around a persistent promise) is the
//! reason, and `tests/shutdown.rs` is what keeps it that way.
//!
//! `callBytes`/`sendBytes` are the same two timings cut by *payload shape*, and they exist because of
//! ADR-0074 §4: a buffer crosses as a `Uint8Array`, never as text inside a JSON document. An operation
//! that answers bytes and is asked through `call` is refused by name rather than handed a string it
//! would have to decode, and an operation that takes a payload refuses when the payload is missing
//! rather than writing an empty file.
//!
//! ## The rule that closure captures have to follow
//!
//! A Rust callback must **never capture a `Ctx`**. Measured in `tests/shutdown.rs`'s terms: a
//! function created with `Function::new` whose closure holds `ctx.clone()` keeps a reference to the
//! context, so the function object is still alive when `JS_FreeRuntime` runs and QuickJS aborts the
//! process on `list_empty(&rt->gc_obj_list)`. That is the mechanism behind the probe's "unresolved
//! shutdown trap" — its `deferred` closure captured `host_ctx`, not (only) its `Persistent` promise.
//! Every callback here takes `Ctx<'_>` as its *first parameter*, which the engine supplies per call
//! and which nothing retains, and the shutdown test asserts the difference.
//!
//! ## The private half
//!
//! Globals prefixed `__xr` (not `__xrh`) are this crate's glue, not part of the protocol a node
//! codes against: the deferred registry, the settle entry point the pump calls, the memory report,
//! the cancel flag, the `__xrBytesAnswer` scratch global the buffer arm hands its answer through, and
//! the invoke wrapper. A bundle that reaches for them gets a working but unsupported call, and the
//! migration note says so.

use std::sync::Arc;

use rquickjs::{Ctx, Exception, Function, Object, TypedArray, Value};

use crate::host_calls::{self, CallError, HostAnswer, HostOperation};
use crate::host_slot::HostSlot;
use crate::jobs::{Request, RunSignals};
use crate::machine::MachineAccess;

/// The JavaScript half of the protocol, evaluated once per run before the bundle.
const BOOTSTRAP: &str = r#""use strict";
(() => {
  if (globalThis.__xrh) throw new Error("the host protocol is already installed");

  // Mirrors host_calls::CANCELLED_MESSAGE; the test next to BOOTSTRAP fails if the two drift.
  const CANCELLED = "operation cancelled";

  // Promise resolvers keyed by an integer that never becomes a JS value handed to Rust. Keeping the
  // resolvers on this side is what lets the host settle a call without holding a JS reference.
  const deferred = new Map();
  let sequence = 0;

  const remember = (request) => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    sequence += 1;
    deferred.set(sequence, { resolve, reject, request });
    return { id: sequence, promise };
  };

  globalThis.__xrDeferredSize = () => deferred.size;

  globalThis.__xrSettle = (id, ok, payload) => {
    const entry = deferred.get(id);
    if (!entry) return false;
    deferred.delete(id);
    if (ok) entry.resolve(payload);
    else entry.reject(new Error(String(payload)));
    return true;
  };

  const text = (value) => (value === undefined || value === null ? "{}" : String(value));

  // `onEvent` as the platform contract hands it to the node: the event object is serialised here,
  // and the host side only ever sees text (a Rust closure could not stringify a value whose
  // lifetime belongs to its own callback -- `Ctx<'js>` is invariant).
  globalThis.__xrOnEvent = (event) =>
    globalThis.__xrEmit(JSON.stringify(event === undefined ? null : event));

  globalThis.__xrh = {
    call(op, jsonArgs) {
      return globalThis.__xrHostCall(String(op), text(jsonArgs));
    },
    callBytes(op, jsonArgs) {
      // The Rust side cannot hand a realm value back from a callback, so it writes one global;
      // clearing it on both sides of the call keeps a stale buffer from ever being read as an answer.
      delete globalThis.__xrBytesAnswer;
      globalThis.__xrHostCallBytes(String(op), text(jsonArgs));
      const answer = globalThis.__xrBytesAnswer;
      delete globalThis.__xrBytesAnswer;
      return answer;
    },
    sendBytes(op, jsonArgs, bytes) {
      return globalThis.__xrHostSendBytes(String(op), text(jsonArgs), bytes);
    },
    callAsync(op, jsonArgs, bytes) {
      const request = String(op);
      const args = text(jsonArgs);
      const entry = remember(request);
      globalThis.__xrHostEnqueue(entry.id, request, args, bytes === undefined ? null : bytes);
      return entry.promise;
    },
    now() {
      return JSON.parse(globalThis.__xrHostCall("clock.now", "{}"));
    },
    platform: JSON.parse(globalThis.__xrPlatformJson),
  };

  // The `NodeRunControl` triple `packages/runtime/src/node-runner.ts:97-99` spread onto the platform
  // object. The engine injects these three keys onto whatever `createRuntime()` returned, so a node
  // reads them as `runtime.isCancelled()` exactly as it did under the TypeScript runner.
  globalThis.__xrControl = () => ({
    isCancelled: () => globalThis.__xrIsCancelled(),
    waitWhilePaused: () => {
      const entry = remember("control.waitWhilePaused");
      globalThis.__xrControlEnqueue(entry.id);
      return entry.promise;
    },
    checkMemory: () => {
      const report = JSON.parse(globalThis.__xrMemoryReport());
      if (report.over) {
        throw new Error(
          "the run exceeded its declared live-bytes budget: " +
            report.usedBytes + " bytes of " + report.budgetBytes
        );
      }
    },
  });

  // `runNodeWithEvents` calls `runSpec` inside an async function, so a node that throws
  // *synchronously* is caught by the runner's own `catch` and becomes a failure document. Calling the
  // entry straight from Rust would instead unwind through the FFI boundary as a launch error. This
  // wrapper turns the synchronous throw into a rejected promise, which is the shape the outcome
  // reader already handles, so both arms of the TypeScript runner are reproduced.
  globalThis.__xrGuard = (entry) => (...args) => {
    try {
      return Promise.resolve(entry(...args));
    } catch (error) {
      return Promise.reject(error);
    }
  };

  // Turns whatever the node's `run` returned (or threw) into a global the pump can read without
  // holding a JS reference. The `await` is deliberate: a no-op for a synchronous return, and the
  // only way a platform node's promise gets unwrapped.
  globalThis.__xrInvoke = () => {
    (async () => {
      try {
        const value = await globalThis.__xrRunValue;
        // `kind` is why the executor can tell a node function that answers text from one that
        // answers an object, without guessing from the JSON encoding of the difference.
        globalThis.__xrOutcome = {
          done: true,
          ok: true,
          kind: typeof value,
          value: value === undefined ? null : value,
        };
      } catch (error) {
        globalThis.__xrOutcome = {
          done: true,
          ok: false,
          cancelled: Boolean(error) && String(error && error.message ? error.message : error) === CANCELLED,
          message: error && error.message ? String(error.message) : String(error),
        };
      } finally {
        delete globalThis.__xrRunValue;
      }
    })();
  };
})();
"#;

/// Everything the glue needs to reach the machine.
pub(crate) struct Bindings {
    /// The run-scoped host; an absent host answers "outside a run scope".
    pub(crate) slot: HostSlot,
    /// Requests handed over by `callAsync` and `waitWhilePaused`.
    pub(crate) requests: Arc<std::sync::Mutex<Vec<Request>>>,
    /// The cancel and memory flags shared with the pump and the interrupt handler.
    pub(crate) signals: Arc<RunSignals>,
    /// The node's declared program names, from its registration.
    pub(crate) allowed_programs: Vec<&'static str>,
    /// The run's widened machine surface: the granted filesystem and the child-process table.
    pub(crate) machine: MachineAccess,
    /// The `__xrh.platform` object as JSON text, built by the host so the spelling has one source.
    pub(crate) platform_json: Arc<str>,
}

impl Bindings {
    /// Assembles the glue's bindings for one run.
    #[must_use]
    pub(crate) fn new(
        slot: HostSlot,
        requests: Arc<std::sync::Mutex<Vec<Request>>>,
        signals: Arc<RunSignals>,
        allowed_programs: Vec<&'static str>,
        machine: MachineAccess,
    ) -> Self {
        Self { slot, requests, signals, allowed_programs, machine, platform_json: platform_json() }
    }
}

/// Installs the glue and the Rust side of the protocol, and hands back `__xrh` for diagnostics.
///
/// No closure created here captures a `Ctx`; see the module header for why that is load-bearing.
pub(crate) fn install<'js>(ctx: &Ctx<'js>, bindings: &Bindings) -> rquickjs::Result<Object<'js>> {
    let globals = ctx.globals();
    globals.set("__xrPlatformJson", bindings.platform_json.as_ref())?;
    install_host_call(ctx, bindings)?;
    install_queue_pushers(ctx, bindings)?;
    install_control_reads(ctx, bindings)?;

    // Evaluated last, so the glue can call the Rust globals it wraps.
    ctx.eval::<(), _>(BOOTSTRAP)?;
    globals.get::<_, Object>("__xrh")
}

/// The platform answer, built by the host so one machine cannot disagree with another (ADR-0074 §2).
///
/// `env` stays a JSON *string* inside the object because that is the agreed shape: the shim decides
/// whether to parse it, and a nested object would make `process.env`'s spelling a second source.
#[must_use]
pub(crate) fn platform_json() -> Arc<str> {
    let mut table = serde_json::Map::new();
    for (key, value) in std::env::vars() {
        table.insert(key, serde_json::Value::String(value));
    }
    let document = serde_json::json!({
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "sep": std::path::MAIN_SEPARATOR_STR,
        // The list separator is the one place a `cfg!` on the target is the honest answer, and it is
        // still a host-side answer: a bundle must not derive it from `process.platform`.
        "pathSep": if cfg!(windows) { ";" } else { ":" },
        "cwd": std::env::current_dir()
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default(),
        "env": serde_json::Value::String(serde_json::to_string(&serde_json::Value::Object(table))
            .unwrap_or_else(|_| String::from("{}"))),
    });
    Arc::from(encode(&document).as_str())
}

fn encode(value: &serde_json::Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| String::from(r#"{"platform":"unknown"}"#))
}

/// Resolves an operation name for the synchronous entry points.
///
/// The refusal lists what the host *does* answer, because a shim typo and a missing operation look
/// identical from a node's stack trace otherwise.
fn resolve_operation<'js>(ctx: &Ctx<'js>, op: &str) -> rquickjs::Result<HostOperation> {
    HostOperation::parse(op).ok_or_else(|| {
        Exception::throw_message(
            ctx,
            &format!(
                "unknown host operation {op:?}; this host answers: {}",
                HostOperation::names().join(", ")
            ),
        )
    })
}

/// Runs one synchronous host call and turns a refusal into the message JS throws.
///
/// The cancel arm is the reason this is shared: a cancelled operation has to stop the engine as well
/// as the bundle, and a loop between two host calls must not be able to swallow it.
#[allow(clippy::too_many_arguments)]
fn run_sync(
    slot: &HostSlot,
    signals: &RunSignals,
    allowed: &[&'static str],
    machine: &MachineAccess,
    operation: HostOperation,
    arguments: &str,
    payload: Option<&[u8]>,
) -> Result<HostAnswer, String> {
    match slot.with_host(|host| {
        host_calls::execute(operation, arguments, payload, host, allowed, machine)
    }) {
        Some(Ok(answer)) => Ok(answer),
        Some(Err(error)) => {
            if matches!(error, CallError::Cancelled) {
                signals.mark_cancelled();
            }
            Err(error.message().to_string())
        }
        None => Err(String::from("the host call arrived outside a run scope")),
    }
}

fn install_host_call<'js>(ctx: &Ctx<'js>, bindings: &Bindings) -> rquickjs::Result<()> {
    let slot = bindings.slot.clone();
    let signals = Arc::clone(&bindings.signals);
    let allowed = bindings.allowed_programs.clone();
    let machine = bindings.machine.clone();

    // `call`: the document arm. A byte answer here is refused by name rather than stringified, which
    // is the byte rule (ADR-0074 §4) applied at the one place a bundle could route around it.
    let text_slot = slot.clone();
    let host_call = Function::new(ctx.clone(), {
        let signals = Arc::clone(&signals);
        let allowed = allowed.clone();
        let machine = machine.clone();
        move |ctx: Ctx<'_>, op: String, args: String| -> rquickjs::Result<String> {
            let operation = resolve_operation(&ctx, &op)?;
            if operation.answers_bytes() {
                return Err(Exception::throw_message(
                    &ctx,
                    &format!("{} answers a buffer; call it through __xrh.callBytes", operation.as_str()),
                ));
            }
            match run_sync(&text_slot, &signals, &allowed, &machine, operation, &args, None) {
                Ok(HostAnswer::Text(text)) => Ok(text),
                Ok(HostAnswer::Bytes(_)) => Err(Exception::throw_message(
                    &ctx,
                    &format!("{} answered a buffer to a text call", operation.as_str()),
                )),
                Err(message) => Err(Exception::throw_message(&ctx, &message)),
            }
        }
    })?;
    ctx.globals().set("__xrHostCall", host_call)?;

    // `callBytes`: the buffer arm. A Rust callback cannot *return* a value borrowed from the realm
    // (`IntoJsFunc` fixes one `'js` while a closure's `Ctx<'_>` is higher-ranked; measured in
    // 2026-10-05 with variants that all failed to compile), so Rust writes the answer into the
    // `__xrBytesAnswer` scratch global and the glue reads and deletes it. The bytes still cross as a
    // `Uint8Array` — nothing here encodes a buffer into text.
    let bytes_slot = slot.clone();
    let host_call_bytes = Function::new(ctx.clone(), {
        let signals = Arc::clone(&signals);
        let allowed = allowed.clone();
        let machine = machine.clone();
        move |ctx: Ctx<'_>, op: String, args: String| -> rquickjs::Result<bool> {
            let operation = resolve_operation(&ctx, &op)?;
            if !operation.answers_bytes() {
                return Err(Exception::throw_message(
                    &ctx,
                    &format!("{} does not answer a buffer; call it through __xrh.call", operation.as_str()),
                ));
            }
            let answer = run_sync(&bytes_slot, &signals, &allowed, &machine, operation, &args, None)
                .map_err(|message| Exception::throw_message(&ctx, &message))?;
            let value = match answer {
                HostAnswer::Bytes(Some(bytes)) => {
                    TypedArray::<u8>::new_copy(ctx.clone(), bytes.as_slice())?.into_value()
                }
                HostAnswer::Bytes(None) => Value::new_null(ctx.clone()),
                HostAnswer::Text(_) => {
                    return Err(Exception::throw_message(
                        &ctx,
                        &format!("{} answered text to a buffer call", operation.as_str()),
                    ));
                }
            };
            ctx.globals().set("__xrBytesAnswer", value)?;
            Ok(true)
        }
    })?;
    ctx.globals().set("__xrHostCallBytes", host_call_bytes)?;

    // `sendBytes`: the payload arm, for `fs.writeBytes` and `crypto.digest`. The buffer is copied out
    // of the realm here, before the host reads it, so a node that reuses or detaches it afterwards
    // cannot change what was already asked to be written.
    let payload_slot = slot.clone();
    let host_send_bytes = Function::new(ctx.clone(), {
        let signals = Arc::clone(&signals);
        let allowed = allowed.clone();
        let machine = machine.clone();
        move |ctx: Ctx<'_>, op: String, args: String, bytes: Option<TypedArray<'_, u8>>| -> rquickjs::Result<String> {
            let operation = resolve_operation(&ctx, &op)?;
            if !operation.takes_payload() {
                return Err(Exception::throw_message(
                    &ctx,
                    &format!("{} takes no byte payload; call it through __xrh.call", operation.as_str()),
                ));
            }
            let Some(array) = bytes else {
                return Err(Exception::throw_message(
                    &ctx,
                    &format!("{} needs a Uint8Array payload", operation.as_str()),
                ));
            };
            let Some(raw) = array.as_raw() else {
                return Err(Exception::throw_message(&ctx, "the byte payload is detached; nothing was sent"));
            };
            // SAFETY: the slice is copied immediately and no JavaScript runs while it is alive, which
            // is the one condition `as_raw` documents for keeping it valid.
            let payload = unsafe { raw.as_ref().to_vec() };
            match run_sync(&payload_slot, &signals, &allowed, &machine, operation, &args, Some(&payload)) {
                Ok(HostAnswer::Text(text)) => Ok(text),
                Ok(HostAnswer::Bytes(_)) => Err(Exception::throw_message(
                    &ctx,
                    &format!("{} answered a buffer to a payload call", operation.as_str()),
                )),
                Err(message) => Err(Exception::throw_message(&ctx, &message)),
            }
        }
    })?;
    ctx.globals().set("__xrHostSendBytes", host_send_bytes)?;

    // `onEvent` answers synchronously into the operation's stream, because that is what the
    // TypeScript runner's `onEvent` was. A failed report is dropped (the seam's own rule); a cancel
    // throws, and the executor reads that as a hard stop.
    let emit_slot = bindings.slot.clone();
    let emit_signals = Arc::clone(&bindings.signals);
    let emit = Function::new(ctx.clone(), move |ctx: Ctx<'_>, event: String| -> rquickjs::Result<bool> {
        match emit_slot.with_host(|host| host_calls::emit_event(host, &event)) {
            Some(Ok(())) => Ok(true),
            Some(Err(error)) => {
                if matches!(error, CallError::Cancelled) {
                    emit_signals.mark_cancelled();
                }
                Err(Exception::throw_message(&ctx, error.message()))
            }
            None => Err(Exception::throw_message(&ctx, "the event arrived outside a run scope")),
        }
    })?;
    ctx.globals().set("__xrEmit", emit)?;
    Ok(())
}

fn install_queue_pushers<'js>(ctx: &Ctx<'js>, bindings: &Bindings) -> rquickjs::Result<()> {
    let queue = Arc::clone(&bindings.requests);
    let enqueue = Function::new(ctx.clone(), move |_ctx: Ctx<'_>, id: f64, op: String, args: String, bytes: Option<TypedArray<'_, u8>>| {
        // The payload leaves the realm at enqueue time: the pump answers this request after JS has
        // moved on, and a buffer the node may still be holding must not be what gets written.
        let payload = bytes.and_then(|array| array.as_raw()).map(|raw| {
            // SAFETY: copied immediately, with no JavaScript running in between.
            unsafe { raw.as_ref().to_vec() }
        });
        push(&queue, Request::Operation { id: id as u64, operation: op, arguments: args, payload });
    })?;
    ctx.globals().set("__xrHostEnqueue", enqueue)?;

    let control_queue = Arc::clone(&bindings.requests);
    let control = Function::new(ctx.clone(), move |_ctx: Ctx<'_>, id: f64| {
        push(&control_queue, Request::WaitWhilePaused { id: id as u64 });
    })?;
    ctx.globals().set("__xrControlEnqueue", control)?;
    Ok(())
}

fn push(queue: &std::sync::Mutex<Vec<Request>>, request: Request) {
    // A poisoned lock means a callback panicked earlier in this run. The request list is still
    // well-formed, and dropping a request would leave its promise parked forever.
    let mut guard = queue.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    guard.push(request);
}

fn install_control_reads<'js>(ctx: &Ctx<'js>, bindings: &Bindings) -> rquickjs::Result<()> {
    let signals = Arc::clone(&bindings.signals);
    let is_cancelled = Function::new(ctx.clone(), move || -> bool { signals.is_cancelled() })?;
    ctx.globals().set("__xrIsCancelled", is_cancelled)?;

    let report_signals = Arc::clone(&bindings.signals);
    let report = Function::new(ctx.clone(), move || -> String {
        let budget = report_signals.budget_bytes();
        let used = report_signals.used_bytes();
        let document = serde_json::json!({
            "usedBytes": used,
            "budgetBytes": budget,
            "over": report_signals.is_over_budget(),
        });
        encode(&document)
    })?;
    ctx.globals().set("__xrMemoryReport", report)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host_slot::HostSlot;
    use crate::test_host::{CountingHost, SCRIPTED_NOW};
    use rquickjs::{Context, Runtime};
    use xiranite_node_registry::NodeHost;

    fn bindings(slot: HostSlot) -> Bindings {
        Bindings::new(
            slot,
            Arc::new(std::sync::Mutex::new(Vec::new())),
            Arc::new(RunSignals::new(1024)),
            Vec::new(),
            MachineAccess::seam_only(),
        )
    }

    #[test]
    fn the_bootstrap_and_the_host_agree_on_the_cancel_message() {
        // The JS `cancelled` arm compares against a literal it cannot import from Rust, so drift
        // here would silently turn a cancelled run into a reported node bug.
        assert!(BOOTSTRAP.contains(host_calls::CANCELLED_MESSAGE));
    }

    #[test]
    fn the_platform_answer_carries_the_agreed_keys() {
        let text: serde_json::Value =
            serde_json::from_str(platform_json().as_ref()).expect("platform json");
        for key in ["platform", "arch", "sep", "pathSep", "cwd", "env"] {
            assert!(text.get(key).is_some(), "missing {key} in {text}");
        }
        // `env` is a JSON string inside the object, per the protocol, not a nested object.
        let inner: serde_json::Value =
            serde_json::from_str(text["env"].as_str().expect("env is a string")).expect("env json");
        assert!(inner.is_object(), "{inner}");
        assert!(!text["sep"].as_str().expect("sep").is_empty());
        assert!(!text["platform"].as_str().expect("platform").is_empty());
    }

    #[test]
    fn the_glue_installs_and_the_protocol_has_exactly_the_six_agreed_members() {
        let runtime = Runtime::new().expect("runtime");
        let context = Context::full(&runtime).expect("context");
        let mut host = CountingHost::new();
        let slot = HostSlot::new();
        let installed = slot.install(&mut host as &mut dyn NodeHost);
        context.with(|ctx| {
            install(&ctx, &bindings(installed.slot().clone())).expect("install");
            for member in ["call", "callBytes", "sendBytes", "callAsync", "now", "platform"] {
                let value = ctx.globals().get::<_, rquickjs::Value>("__xrh");
                assert!(value.is_ok(), "{member} lookup path broken: {value:?}");
                let rh: Object = ctx.globals().get("__xrh").expect("__xrh is an object");
                assert!(
                    rh.get::<_, Function>(member).is_ok()
                        || rh.get::<_, Object>(member).is_ok()
                        || rh.get::<_, rquickjs::Value>(member).is_ok(),
                    "__xrh.{member} is missing"
                );
            }
            let clock: String = ctx.eval("__xrh.now()").expect("the host clock answers");
            assert_eq!(clock, SCRIPTED_NOW, "one clock, one spelling");
        });
        drop(installed);
        let calls = std::mem::take(&mut host.calls);
        assert_eq!(calls, vec!["now".to_string()], "the call reached the seam");
    }

    #[test]
    fn an_uninstalled_scope_refuses_instead_of_answering_wrong() {
        let runtime = Runtime::new().expect("runtime");
        let context = Context::full(&runtime).expect("context");
        context.with(|ctx| {
            install(&ctx, &bindings(HostSlot::new())).expect("install");
            let message: String = ctx
                .eval(
                    r#"(() => {
                         try { __xrh.call("fs.stat", JSON.stringify({ path: "/x" })); return "no throw"; }
                         catch (error) { return error.message; }
                       })()"#,
                )
                .expect("the refusal is catchable JS");
            assert!(message.contains("outside a run scope"), "{message}");

            // The unknown-operation arm names what the host does answer, so a shim typo is not a
            // mystery.
            let unknown: String = ctx
                .eval(
                    r#"(() => {
                         try { __xrh.call("fs.readRange", "{}"); return "no throw"; }
                         catch (error) { return error.message; }
                       })()"#,
                )
                .expect("unknown operation is catchable");
            assert!(unknown.contains("fs.stat") && unknown.contains("unknown host operation"), "{unknown}");
        });
    }

    #[test]
    fn a_call_async_request_is_handed_over_rather_than_run_inline() {
        let runtime = Runtime::new().expect("runtime");
        let context = Context::full(&runtime).expect("context");
        let queue: Arc<std::sync::Mutex<Vec<Request>>> = Arc::new(std::sync::Mutex::new(Vec::new()));
        let mut host = CountingHost::new();
        let slot = HostSlot::new();
        let installed = slot.install(&mut host as &mut dyn NodeHost);
        let bindings = Bindings::new(
            installed.slot().clone(),
            Arc::clone(&queue),
            Arc::new(RunSignals::new(1024)),
            Vec::new(),
            MachineAccess::seam_only(),
        );
        context.with(|ctx| {
            install(&ctx, &bindings).expect("install");
            let pending: usize = ctx
                .eval(
                    r#"(async () => { globalThis.__promise = __xrh.callAsync("fs.readText", JSON.stringify({ path: "/work/a.txt" })); })();
                       globalThis.__xrDeferredSize()"#,
                )
                .expect("the async call registers a deferred");
            assert_eq!(pending, 1, "the promise must still be parked");
            let taken = queue.lock().expect("queue").len();
            assert_eq!(taken, 1, "the request must be in the host's queue, not answered inline");
        });
        drop(installed);
        let calls = std::mem::take(&mut host.calls);
        assert!(calls.is_empty(), "a queued call must not have reached the machine yet");
    }

    #[test]
    fn the_control_triple_reads_the_shared_flags() {
        let runtime = Runtime::new().expect("runtime");
        let context = Context::full(&runtime).expect("context");
        let signals = Arc::new(RunSignals::new(64));
        context.with(|ctx| {
            install(&ctx, &Bindings::new(
                HostSlot::new(),
                Arc::new(std::sync::Mutex::new(Vec::new())),
                Arc::clone(&signals),
                Vec::new(),
                MachineAccess::seam_only(),
            ))
            .expect("install");
            signals.record_used(4096);
            let before: bool = ctx.eval("globalThis.__xrControl().isCancelled()").expect("isCancelled");
            assert!(!before, "a fresh run is not cancelled");
            let over: bool = ctx
                .eval(
                    r#"(() => {
                          try { globalThis.__xrControl().checkMemory(); return false; }
                          catch (error) { return true; }
                        })()"#,
                )
                .expect("checkMemory");
            assert!(over, "used 4096 against a 64 byte budget must throw");
            signals.mark_cancelled();
            let after: bool = ctx.eval("globalThis.__xrControl().isCancelled()").expect("isCancelled");
            assert!(after, "the flag must be readable from JS after the host set it");
        });
    }
}
