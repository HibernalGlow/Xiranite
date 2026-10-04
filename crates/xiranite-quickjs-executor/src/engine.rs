//! The executor: one `Runtime` and one fresh `Context` per run, and the result document.
//!
//! [`Executor`] is the adapter between [`xiranite_node_registry::BuiltInNode`] and a JavaScript
//! bundle. It is a *plan* — descriptor, entry names, source — and each run builds the engine,
//! evaluates the bundle, drives [`Pump`], and drops the context and the runtime before returning.
//! A fresh context per run is the cheaper mistake: the probe measured a full node bundle evaluating
//! in 2–4 ms, while an engine reused across operations would inherit one run's globals, one run's
//! parked promises and one run's memory ceiling.
//!
//! ## Behavioural compatibility with `packages/runtime/src/node-runner.ts`
//!
//! The TypeScript runner is the contract this crate has to keep:
//!
//! | `node-runner.ts` | here |
//! | --- | --- |
//! | `PureNodeSpec{run, message}` → `{success: true, message, data: run(input)}` | no `createRuntime` export ⇒ the same envelope is built from the run's answer |
//! | `PlatformNodeSpec{run, createRuntime}` → `run(input, runtime, onEvent)` | both exports resolved from the bundle; `onEvent` answers synchronously into the host |
//! | `runtime = {...runtime, isCancelled, waitWhilePaused, checkMemory}` | those three keys injected onto whatever `createRuntime()` returned (`crate::shims`' `__xrControl`) |
//! | `catch (error) { onEvent({type:"log", message}); return {success:false, message: \`Node "${id}" failed: …\`} }` | an escaped JS exception becomes that same document and that same log line |
//! | `getFunction(module, name)` refusing a non-function | a missing or non-function export is a run error naming what was searched and what exists |
//! | `BuiltInNode::call` (no TypeScript analogue: the definition language's node functions) | a string answer crosses verbatim, anything else crosses as its JSON text |
//!
//! Three deliberate deviations, each stated at the point it matters. (1) A *pure* run's answer is
//! awaited, so a pure node that returns a promise yields its data instead of `{}`. (2) An
//! engine-level failure (live-byte ceiling, stack ceiling, interrupt, deadline, cancel) comes back as
//! [`NodeRunError`](xiranite_node_registry::NodeRunError) rather than as a `{success:false}`
//! document, because the operation has to be marked failed rather than "the node said no". (3)
//! `createRuntime()` is called without the failure-document wrapper: TypeScript called it inside the
//! same `try`, so its throw became a document, but here it is a run error — the factory is host
//! wiring, not the node's answer, and a factory that cannot build a runtime leaves the operation with
//! nothing to run.

use std::sync::Arc;
use std::time::{Duration, Instant};

use rquickjs::{Context, Ctx, Function, Object, Runtime, Value};
use xiranite_node_registry::{NodeDescriptor, NodeHost, NodeRunError};

use crate::bundle::{self, Bundle, Exports, failed, unwound};
use crate::host_calls::{self, CallError};
use crate::host_slot::HostSlot;
use crate::jobs::{self, Answered, Pump, PumpReason, RawOutcome, Request, RunSignals};
use crate::shims::{self, Bindings};

/// What one run has to know about a bundle.
///
/// Borrowed rather than owned, so a linked-in node hands its `include_str!` source over without
/// copying it on every operation.
#[derive(Debug, Clone)]
pub struct EntryPlan<'a> {
    /// The name QuickJS records for syntax errors and stack frames; the node id is the honest value.
    pub bundle_name: &'a str,
    /// The bundle's JavaScript text.
    pub source: &'a str,
    /// The export that runs the operation (`PlatformRunFunction` or `PureRunFunction`).
    pub run_export: &'a str,
    /// The export that builds the platform object; `None` means the node is pure.
    pub create_runtime_export: Option<&'a str>,
    /// The message a pure node's result document carries, mirroring `PureNodeSpec.message`.
    pub pure_message: &'a str,
}

impl<'a> EntryPlan<'a> {
    /// A plan for a platform node: `run(input, runtime, onEvent)` plus `createRuntime()`.
    #[must_use]
    pub fn platform(
        bundle_name: &'a str,
        source: &'a str,
        run_export: &'a str,
        create_runtime_export: &'a str,
    ) -> Self {
        Self {
            bundle_name,
            source,
            run_export,
            create_runtime_export: Some(create_runtime_export),
            pure_message: "",
        }
    }

    /// A plan for a pure node: `run(input)` and a fixed success message.
    #[must_use]
    pub fn pure(
        bundle_name: &'a str,
        source: &'a str,
        run_export: &'a str,
        pure_message: &'a str,
    ) -> Self {
        Self { bundle_name, source, run_export, create_runtime_export: None, pure_message }
    }

    /// Whether this plan runs a platform node, and so builds a runtime object.
    #[must_use]
    pub const fn is_platform(&self) -> bool {
        self.create_runtime_export.is_some()
    }
}

/// The ceilings one run is started with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EngineLimits {
    /// The engine's live-byte ceiling, taken from the node's own declaration.
    pub memory_limit_bytes: usize,
    /// The stack ceiling, derived from the same declaration (see [`Self::stack_from_budget`]).
    pub max_stack_bytes: usize,
    /// How often the pump and the interrupt handler re-read the operation's state.
    pub host_poll_interval: Duration,
    /// The wall-clock bound on one run.
    pub run_deadline: Duration,
}

impl EngineLimits {
    /// The floor of the derived stack ceiling: 256 KiB is QuickJS's own default.
    pub const MIN_STACK_BYTES: usize = 256 * 1024;
    /// The top of the derived stack ceiling, so a generously budgeted node cannot make the host
    /// thread recurse past the stack it was actually given.
    pub const MAX_STACK_BYTES: usize = 1024 * 1024;

    /// Derives the run's ceilings from the node's declaration.
    ///
    /// # Errors
    ///
    /// Refuses a node whose `max_live_bytes` is `0`. ADR-0073 made "not declared" mean "the host must
    /// refuse to schedule", so an undeclared ceiling is a refusal, not unlimited.
    pub fn from_descriptor(descriptor: &NodeDescriptor) -> Result<Self, NodeRunError> {
        let budget = descriptor.requirements.max_live_bytes;
        if budget == 0 {
            return Err(NodeRunError {
                message: format!(
                    "node {:?} declares no live-byte budget (max_live_bytes = 0), so the QuickJS \
                     executor refuses to schedule it",
                    descriptor.id
                ),
            });
        }
        Ok(Self {
            memory_limit_bytes: budget,
            max_stack_bytes: Self::stack_from_budget(budget),
            host_poll_interval: jobs::DEFAULT_HOST_POLL_INTERVAL,
            run_deadline: jobs::DEFAULT_RUN_DEADLINE,
        })
    }

    /// One eighth of the live-byte budget, clamped into `[MIN_STACK_BYTES, MAX_STACK_BYTES]`.
    ///
    /// `NodeRequirements` has no stack field, and hardcoding 1 MiB (the probe's number) would let a
    /// node declared at 256 KiB of live bytes recurse into a stack nobody promised. Deriving keeps
    /// one knob — the node's own declaration — and the clamp keeps the limit meaningful at both ends.
    #[must_use]
    pub const fn stack_from_budget(max_live_bytes: usize) -> usize {
        let derived = max_live_bytes / 8;
        if derived < Self::MIN_STACK_BYTES {
            Self::MIN_STACK_BYTES
        } else if derived > Self::MAX_STACK_BYTES {
            Self::MAX_STACK_BYTES
        } else {
            derived
        }
    }
}

/// Runs one node bundle, from its entry names to its result document.
pub struct Executor<'plan> {
    descriptor: NodeDescriptor,
    plan: EntryPlan<'plan>,
    limits: EngineLimits,
}

impl<'plan> Executor<'plan> {
    /// Binds a plan to the node's registration and derives the ceilings from it.
    ///
    /// # Errors
    ///
    /// [`EngineLimits::from_descriptor`]'s refusal for an undeclared byte budget.
    pub fn new(descriptor: NodeDescriptor, plan: EntryPlan<'plan>) -> Result<Self, NodeRunError> {
        Ok(Self { descriptor, plan, limits: EngineLimits::from_descriptor(&descriptor)? })
    }

    /// Overrides the wall-clock bound, for a node the scheduler knows runs long.
    #[must_use]
    pub fn with_run_deadline(mut self, deadline: Duration) -> Self {
        self.limits.run_deadline = deadline;
        self
    }

    /// Overrides the cancel/pause re-read cadence. Tests use it to keep a cancel assertion short.
    #[must_use]
    pub fn with_host_poll_interval(mut self, interval: Duration) -> Self {
        self.limits.host_poll_interval = interval;
        self
    }

    #[must_use]
    pub const fn descriptor(&self) -> &NodeDescriptor {
        &self.descriptor
    }

    #[must_use]
    pub const fn limits(&self) -> &EngineLimits {
        &self.limits
    }

    #[must_use]
    pub const fn plan(&self) -> &EntryPlan<'plan> {
        &self.plan
    }

    /// Runs the node's `run` export to completion.
    ///
    /// # Errors
    ///
    /// A [`NodeRunError`] when the bundle cannot be loaded, when an export is missing or not a
    /// function, when the operation is cancelled or past its deadline, or when the run failed at
    /// engine level. A node's own thrown error is *not* an error here: it becomes the failure
    /// document the TypeScript runner produced for the same throw.
    pub fn run(&self, input: &str, host: &mut dyn NodeHost) -> Result<String, NodeRunError> {
        let call = if self.plan.is_platform() { Call::PlatformRun } else { Call::PureRun };
        self.execute(call, self.plan.run_export, input, host)
    }

    /// Calls one named export the way [`xiranite_node_registry::BuiltInNode::call`] does.
    ///
    /// A node function is called with one argument — the request document, parsed — because that is
    /// what a definition can name: the danger gate, the preview lines, the result renderer, the
    /// computed prompt. Its answer crosses verbatim when it is already a string and as JSON text
    /// otherwise, which is the "answer is text the caller renders" rule in
    /// [`xiranite_node_registry::BuiltInNode::call`].
    ///
    /// # Errors
    ///
    /// As [`Self::run`], plus a refusal when the bundle has no such export.
    pub fn call_function(
        &self,
        function: &str,
        input: &str,
        host: &mut dyn NodeHost,
    ) -> Result<String, NodeRunError> {
        self.execute(Call::NodeFunction, function, input, host)
    }

    fn execute(
        &self,
        call: Call,
        export_name: &str,
        input: &str,
        host: &mut dyn NodeHost,
    ) -> Result<String, NodeRunError> {
        let started = Instant::now();
        let limits = self.limits;
        let signals = Arc::new(RunSignals::from_limits(&limits));
        let requests: Arc<std::sync::Mutex<Vec<Request>>> =
            Arc::new(std::sync::Mutex::new(Vec::new()));
        let allowed = host_calls::allowed_programs(self.descriptor.requirements.processes);

        let runtime = Runtime::new().map_err(|error| {
            NodeRunError { message: format!("the QuickJS runtime could not start: {error}") }
        })?;
        // Both ceilings come from the node's declaration, never from a literal in this file.
        runtime.set_memory_limit(limits.memory_limit_bytes);
        runtime.set_max_stack_size(limits.max_stack_bytes);

        let slot = HostSlot::new();
        install_interrupt_handler(&runtime, &slot, Arc::clone(&signals));
        let context = Context::full(&runtime).map_err(|error| NodeRunError {
            message: format!("the QuickJS context could not start: {error}"),
        })?;

        // The borrow of `host` moves into the guard; every later host call goes through the slot,
        // which is the single access path `host_slot` documents.
        let installed = slot.install(host);
        let bindings = Bindings::new(
            installed.slot().clone(),
            Arc::clone(&requests),
            Arc::clone(&signals),
            allowed.clone(),
        );

        let invocation = Invocation { call, export_name, input };
        let result = {
            let mut pump = Pump::new(
                &context,
                installed.slot().clone(),
                Arc::clone(&requests),
                Arc::clone(&signals),
                allowed,
            );
            self.drive(&mut pump, &bindings, invocation, started)
        };

        // Teardown order is the shutdown item: the handler goes first (nothing may reach the host
        // from the engine again), then the host guard, then the context, then the runtime.
        runtime.set_interrupt_handler(None);
        drop(installed);
        drop(context);
        drop(runtime);
        result
    }

    /// The part of a run that needs the engine alive: launch, pump, classify.
    ///
    /// The context, the host slot and the shared flags all come back off the [`Pump`], which owns
    /// them for the run; carrying them alongside it would only make the lifetime story harder to
    /// read (and `clippy::too_many_arguments` is the symptom, not the reason).
    fn drive(
        &self,
        pump: &mut Pump<'_>,
        bindings: &Bindings,
        invocation: Invocation<'_>,
        started: Instant,
    ) -> Result<String, NodeRunError> {
        // Only a platform run gets the `NodeRunControl` triple, and `__xrh` answers no checkpoint
        // operation (`crate::host_calls::HostOperation`), so a pure run or a node function has no way
        // to reach a boundary of its own. For those two the executor owes the host a read before any
        // JavaScript is evaluated: a cancelled operation must not get a run, and a paused one waits
        // for its resume before work starts.
        if !invocation.call.has_control_triple() {
            pump.poll_before_launch()?;
            if pump.signals().is_cancelled() {
                return Err(NodeRunError { message: host_calls::CANCELLED_MESSAGE.to_string() });
            }
        }
        if let Err(error) = launch(pump.context(), &self.plan, invocation, bindings) {
            return Err(classify_launch(
                error,
                pump.signals(),
                &self.descriptor,
                started.elapsed(),
            ));
        }
        let reason = pump.drain()?;
        let outcome = jobs::read_outcome(pump.context())?;
        match reason {
            PumpReason::Cancelled => {
                Err(NodeRunError { message: host_calls::CANCELLED_MESSAGE.to_string() })
            }
            PumpReason::TimedOut => Err(NodeRunError {
                message: format!(
                    "the run of {:?} exceeded its {} ms wall-clock bound",
                    self.descriptor.id,
                    self.limits.run_deadline.as_millis()
                ),
            }),
            PumpReason::Parked => Err(NodeRunError {
                message: format!(
                    "the run of {:?} parked on a promise no host call will settle; a parked await \
                     cannot be interrupted, so the executor stops rather than waits forever",
                    self.descriptor.id
                ),
            }),
            PumpReason::Settled => document_for(
                invocation.call,
                &self.plan,
                &self.descriptor,
                outcome,
                pump.slot(),
                started.elapsed(),
            ),
        }
    }
}

/// Which entry is being called, with what.
#[derive(Debug, Clone, Copy)]
struct Invocation<'a> {
    /// The calling shape, which is also what decides how the answer becomes a document.
    call: Call,
    /// The export name the plan or the definition asked for.
    export_name: &'a str,
    /// The request document, as the caller spelled it.
    input: &'a str,
}

/// Which entry of the bundle is being called, and therefore how its answer becomes a document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Call {
    /// `run(input, runtime, onEvent)` — `node-runner.ts:93-100`.
    PlatformRun,
    /// `run(input)` — the pure arm of `node-runner.ts:88-91`, whose answer the runner wrapped.
    PureRun,
    /// A named node function: `fn(input)`, answering the text a definition renders.
    NodeFunction,
}

impl Call {
    /// Whether this call injects the `NodeRunControl` triple, which is the same question as "can the
    /// bundle reach a checkpoint by itself".
    const fn has_control_triple(self) -> bool {
        matches!(self, Self::PlatformRun)
    }

    /// How many arguments the entry is called with.
    const fn is_three_argument_form(self) -> bool {
        matches!(self, Self::PlatformRun)
    }
}

/// Launches the entry: installs the glue, loads the bundle, resolves the export, calls it.
///
/// This is one context scope. Whatever the entry returns is written to `globalThis.__xrRunValue` and
/// `__xrInvoke` is started, which is what lets the pump read the outcome afterwards without the Rust
/// side holding a JS reference.
fn launch(
    context: &Context,
    plan: &EntryPlan<'_>,
    invocation: Invocation<'_>,
    bindings: &Bindings,
) -> Result<(), NodeRunError> {
    let bundle = Bundle { name: plan.bundle_name, source: plan.source };
    context.with(|ctx| -> Result<(), NodeRunError> {
        shims::install(&ctx, bindings)
            .map_err(|error| failed("the host protocol could not be installed", &error))?;
        // Snapshot before the bundle runs: the global names that appear after it are the bundle's
        // own, which is what makes an error message able to name them.
        let before = bundle::global_names(&ctx);
        let exports = bundle::resolve(&ctx, bundle, &before)
            .map_err(|error| bundle::note_search(error, invocation.export_name, bundle))?;
        let entry = bundle::entry(&ctx, &exports, invocation.export_name, bundle)?;
        let request = bundle::parsed_input(&ctx, invocation.input)?;

        // `node-runner.ts:144` calls `runSpec` inside its `try`, so a node that throws *synchronously*
        // became a failure document plus a log line. Calling the entry straight from Rust would unwind
        // through the FFI boundary as a launch error instead, so the entry is wrapped by the glue's
        // `__xrGuard`: a synchronous throw becomes a rejected promise, which is the shape
        // `__xrInvoke` already records as `RawOutcome::Failed`, and an engine-level failure inside it
        // is still read as one by `document_for`.
        let guard: Function = ctx
            .globals()
            .get("__xrGuard")
            .map_err(|error| failed("the entry guard is missing", &error))?;
        let guarded: Function = guard
            .call::<_, Function>((entry,))
            .map_err(|error| unwound(&ctx, "the entry guard could not be built", &error))?;

        let answer = if invocation.call.is_three_argument_form() {
            let runtime_object = create_runtime(&ctx, &exports, plan, bundle)?;
            // The glue's own wrapper, which stringifies the event and calls the host: a Rust
            // closure could not do the stringify itself, because `Ctx<'js>` is invariant in `'js`
            // and the event's lifetime belongs to the callback.
            let on_event: Function = ctx
                .globals()
                .get("__xrOnEvent")
                .map_err(|error| failed("onEvent could not be installed", &error))?;
            guarded.call::<_, Value>((request, runtime_object, on_event))
        } else {
            guarded.call::<_, Value>((request,))
        }
        .map_err(|error| unwound(&ctx, "the node entry threw", &error))?;

        store_and_invoke(&ctx, answer)
    })
}

/// Records the run's answer where the pump can find it and starts the outcome wrapper.
fn store_and_invoke<'js>(ctx: &Ctx<'js>, answer: Value<'js>) -> Result<(), NodeRunError> {
    ctx.globals()
        .set("__xrRunValue", answer)
        .map_err(|error| failed("the run answer could not be recorded", &error))?;
    let invoke: Function = ctx
        .globals()
        .get("__xrInvoke")
        .map_err(|error| failed("the outcome wrapper is missing", &error))?;
    invoke
        .call::<_, ()>(())
        .map_err(|error| unwound(ctx, "the outcome wrapper threw", &error))
}

/// Calls `createRuntime()` and injects the `NodeRunControl` triple onto its answer.
fn create_runtime<'js>(
    ctx: &Ctx<'js>,
    exports: &Exports<'js>,
    plan: &EntryPlan<'_>,
    bundle: Bundle<'_>,
) -> Result<Value<'js>, NodeRunError> {
    let create_name = plan
        .create_runtime_export
        .expect("a platform plan always names its createRuntime export");
    let create = bundle::entry(ctx, exports, create_name, bundle)?;
    // `runNodeWithEvents`' `runtimeContext` has no producer behind this seam yet, so the factory is
    // called the way the TypeScript called it with no context: it sees `undefined`.
    let value = create
        .call::<_, Value>(())
        .map_err(|error| unwound(ctx, "createRuntime() threw", &error))?;
    if let Some(object) = value.as_object() {
        let control: Object = ctx
            .eval::<Object, _>("globalThis.__xrControl()")
            .map_err(|error| failed("the control triple could not be built", &error))?;
        for key in ["isCancelled", "waitWhilePaused", "checkMemory"] {
            let member: Value = control
                .get(key)
                .map_err(|error| failed("the control triple is missing a member", &error))?;
            object
                .set(key, member)
                .map_err(|error| failed("the control triple could not be injected", &error))?;
        }
    }
    Ok(value)
}

/// Decides how the answer becomes the result document.
///
/// The three arms are the three contracts the answer can be under, and they are not interchangeable:
/// a pure run's answer is *data* the runner wrapped (`node-runner.ts:90`), a platform run's answer is
/// already the document, and a node function's answer is text a definition renders.
fn document_for(
    call: Call,
    plan: &EntryPlan<'_>,
    descriptor: &NodeDescriptor,
    outcome: Option<RawOutcome>,
    slot: &HostSlot,
    elapsed: Duration,
) -> Result<String, NodeRunError> {
    let Some(outcome) = outcome else {
        return Err(NodeRunError {
            message: format!(
                "the run of {:?} settled nothing after {} ms",
                descriptor.id,
                elapsed.as_millis()
            ),
        });
    };
    match outcome {
        RawOutcome::Failed { message, cancelled: js_says_cancelled } => {
            if js_says_cancelled {
                return Err(NodeRunError { message: host_calls::CANCELLED_MESSAGE.to_string() });
            }
            if let Some(reason) = engine_failure_reason(&message) {
                return Err(NodeRunError {
                    message: format!(
                        "the run of {:?} failed at engine level ({reason}): {message}",
                        descriptor.id
                    ),
                });
            }
            // `node-runner.ts:146-150`: the throw becomes the failure document, plus one log line.
            let text = format!("Node {:?} failed: {message}", descriptor.id);
            let event = serde_json::json!({ "type": "log", "message": text });
            // A refused report does not change the answer; this is the seam's own rule, and the
            // document is what the caller is waiting for.
            let _ = slot.with_host(|host| host_calls::emit_event(host, &event.to_string()));
            Ok(serde_json::to_string(&serde_json::json!({ "success": false, "message": text }))
                .unwrap_or_else(|_| String::from(r#"{"success":false}"#)))
        }
        RawOutcome::Answered { document, answer } => match call {
            // A pure node answers *data*, and the envelope is the runner's, never the bundle's. That
            // is why a bundle whose `run` returns a whole `{success, message, data}` document under a
            // pure plan reads back double-wrapped: the TypeScript runner wrapped it the same way.
            Call::PureRun => pure_envelope(document, answer, plan.pure_message),
            Call::PlatformRun => answered_platform(document, answer),
            Call::NodeFunction => answered_function(document, answer),
        },
    }
}

fn pure_envelope(
    answer: Option<String>,
    kind: Answered,
    message: &str,
) -> Result<String, NodeRunError> {
    let data: serde_json::Value = match (answer, kind) {
        (None, _) => serde_json::Value::Null,
        // A node function that returns a string *means* a string: `node-runner.ts:90` puts it in `data`
        // as-is, so re-parsing it as JSON would turn `"\"12 lines\""` into a different answer.
        (Some(text), Answered::Text) => serde_json::Value::String(text),
        (Some(text), Answered::Structured) => {
            serde_json::from_str(&text).map_err(|error| NodeRunError {
                message: format!("the pure node answered something that is not JSON text: {error}"),
            })?
        }
    };
    encode(&serde_json::json!({ "success": true, "message": message, "data": data }))
}

/// A platform node's own result document, passed through as the TypeScript runner passed it.
fn answered_platform(
    answer: Option<String>,
    kind: Answered,
) -> Result<String, NodeRunError> {
    let document = answer.ok_or_else(|| NodeRunError {
        message: String::from("the platform run returned no result document"),
    })?;
    if kind == Answered::Structured {
        return Ok(document);
    }
    // `run` is declared to answer a `NodeRunResult`, so text is only usable when the text is itself
    // the document. A node that answers prose is a run error, not a body the client has to guess at.
    let text = json_text_to_string(&document)?;
    serde_json::from_str::<serde_json::Value>(&text).map_err(|error| NodeRunError {
        message: format!(
            "the platform node answered with a string that is not a result document: {error}"
        ),
    })?;
    Ok(text)
}

/// A node function's answer, crossing the way `BuiltInNode::call` documents it: the answer is *text
/// the caller renders*, so a bundle that answered with a string gives that string back verbatim and
/// anything else gives its JSON text.
///
/// The verbatim arm is the one that used to double-encode: the outcome reader stores
/// `JSON.stringify(value)`, so a string answer arrives with quotes around it and those quotes are the
/// encoding, not part of the answer.
fn answered_function(answer: Option<String>, kind: Answered) -> Result<String, NodeRunError> {
    match (answer, kind) {
        (None, _) => Err(NodeRunError {
            message: String::from(
                "the node function answered undefined; a published node function answers text",
            ),
        }),
        (Some(text), Answered::Text) => json_text_to_string(&text),
        (Some(structured), Answered::Structured) => Ok(structured),
    }
}

/// Takes the engine's `JSON.stringify` text back off a value that was a JS string.
fn json_text_to_string(text: &str) -> Result<String, NodeRunError> {
    serde_json::from_str::<String>(text).map_err(|error| NodeRunError {
        message: format!("the node answered text that is not JSON string text: {error}"),
    })
}

/// A launch failure, told apart by the flag that caused it.
///
/// The engine's interrupt is how a cancel stops JS that never yields, so an `interrupted` exception
/// with the cancel flag set is the operation's cancellation, not a node bug and not a mystery.
///
/// This arm only sees failures that happened *outside* the guarded entry call — a bundle that would
/// not load, a `createRuntime()` that could not build its object, an interrupt that landed while the
/// module was still evaluating. A node's own throw goes through the outcome reader instead, because
/// `node-runner.ts` documented that as a failure document.
fn classify_launch(
    error: NodeRunError,
    signals: &RunSignals,
    descriptor: &NodeDescriptor,
    elapsed: Duration,
) -> NodeRunError {
    if signals.is_cancelled() {
        return NodeRunError { message: host_calls::CANCELLED_MESSAGE.to_string() };
    }
    let Some(reason) = engine_failure_reason(&error.message) else {
        return error;
    };
    let bound = if signals.is_timed_out() { ", past its wall-clock bound" } else { "" };
    NodeRunError {
        message: format!(
            "the run of {:?} stopped after {} ms{bound}, {reason}: {}",
            descriptor.id,
            elapsed.as_millis(),
            error.message
        ),
    }
}

/// The engine-level messages a run must not report as "the node said no".
fn engine_failure_reason(message: &str) -> Option<&'static str> {
    let lowered = message.to_lowercase();
    if lowered.contains("out of memory") || lowered.contains("live-bytes budget") {
        return Some("the node's declared live-byte ceiling");
    }
    if lowered.contains("stack overflow") {
        return Some("the stack ceiling derived from that budget");
    }
    if lowered.contains("interrupted") {
        return Some("the engine interrupted the run");
    }
    None
}

fn encode(value: &serde_json::Value) -> Result<String, NodeRunError> {
    serde_json::to_string(value).map_err(|error| NodeRunError {
        message: format!("the result document could not be encoded: {error}"),
    })
}

/// The interrupt handler: the cancel flag, the deadline, and a host re-read on the shared cadence.
///
/// This is the arm that reaches JS which never yields — the probe's `while (true) {}`, and the
/// promise-driven spin that keeps queueing jobs. Pause is deliberately *not* enforced by returning
/// `true`: an interrupt is an uncatchable exception, so pausing would kill the run instead of
/// waiting for it. A pause takes effect at the next pump boundary or the next `waitWhilePaused`.
///
/// The host re-read can therefore wait inside an executing JS loop, because `NodeHost::checkpoint`
/// waits while the operation is paused — the same trade the wasm shim made with its 50 ms poll
/// (`crates/xiranite-node-runtime/src/capabilities.rs:21-27`, quoted in `xiranite-native-host`), and
/// it buys the one thing the engine cannot: a cancel that lands while the node is computing.
fn install_interrupt_handler(runtime: &Runtime, slot: &HostSlot, signals: Arc<RunSignals>) {
    let handler_signals = Arc::clone(&signals);
    let handler_slot = slot.clone();
    runtime.set_interrupt_handler(Some(Box::new(move || {
        if handler_signals.is_cancelled() {
            return true;
        }
        if handler_signals.expired() {
            handler_signals.mark_timed_out();
            return true;
        }
        // A refusal to poll is not a reason to stop the node; the pump reports it where it can. Only
        // a cancel ends JS here, because an interrupt is uncatchable.
        if handler_signals.poll_due()
            && matches!(
                handler_slot.with_host(|host| {
                    host_calls::checkpoint(host, host_calls::INTERRUPT_CHECKPOINT_PHASE)
                }),
                Some(Err(CallError::Cancelled))
            )
        {
            handler_signals.mark_cancelled();
            return true;
        }
        false
    })));
}

