//! The pump: the one loop where JavaScript and the machine meet.
//!
//! QuickJS is not an event loop. A promise the host has to settle stays parked until somebody runs
//! the job queue, and the engine's own interrupt check only fires while JS is executing
//! (`spikes/quickjs-probe/README.md`, measured: `state=Pending`, no jobs pending, cancel flag set,
//! nothing happens). So this file is that somebody: it drains the host's request queue, settles the
//! parked promises through the JS registry, runs jobs, watches the shared flags, and decides when a
//! run is over.
//!
//! ## The three ways a run ends, and why each lives where it does
//!
//! | way | detected by | why there |
//! | --- | --- | --- |
//! | settled | the `__xrOutcome` global | the node's promise resolved or rejected on its own |
//! | interrupted | the engine interrupt handler | CPU-bound JS never yields to the pump |
//! | parked | the pump, after idle rounds | a promise nothing will settle; an interrupt cannot break it |
//!
//! Pause and cancel are read through [`NodeHost::checkpoint`](xiranite_node_registry::NodeHost::checkpoint),
//! at most every [`DEFAULT_HOST_POLL_INTERVAL`] in each of the two places — the same 50 ms cadence
//! `crates/xiranite-native-host` documents for its plain-thread poll arm. A pause therefore stops the
//! run at the next boundary in both directions, and a cancel additionally stops a loop that refuses
//! to reach a boundary.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use rquickjs::{Context, Function, Object, TypedArray, Type, Value};
use xiranite_node_registry::NodeRunError;

use crate::engine::EngineLimits;
use crate::host_calls::{self, HostAnswer, HostOperation};
use crate::host_slot::HostSlot;
use crate::machine::MachineAccess;

/// The cadence at which the pump and the interrupt handler re-read the operation's state.
///
/// 50 ms is `PAUSE_POLL_INTERVAL` in `crates/xiranite-native-host/src/lib.rs:46` — the number the wasm
/// shim used and the number the native host's own tests measure against. Reusing it keeps "how long
/// does a pause take to land" one answer across the two executors.
pub const DEFAULT_HOST_POLL_INTERVAL: Duration = Duration::from_millis(50);

/// The wall-clock ceiling on one run.
///
/// [`NodeRequirements`](xiranite_node_registry::NodeRequirements) declares byte and item budgets but
/// no time budget, so this bound is the executor's own and is overridable per run
/// ([`crate::Executor::with_run_deadline`]). It exists because a parked run has no natural end: the
/// engine cannot break it and the host has nothing left to wait for.
pub const DEFAULT_RUN_DEADLINE: Duration = Duration::from_secs(120);

/// One host-side request handed over by the JS glue.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Request {
    /// `__xrh.callAsync(op, args[, bytes])` — answered by the host, then the promise resolves with the
    /// host's answer: JSON text, or a `Uint8Array` for a byte operation.
    Operation {
        id: u64,
        operation: String,
        arguments: String,
        /// The payload a `writeBytes`/`digest` call handed over, copied out of the realm at enqueue time
        /// so the buffer the node passed is not read after JS has moved on.
        payload: Option<Vec<u8>>,
    },
    /// `runtime.waitWhilePaused()` — answered by a checkpoint, which is where a pause parks the run.
    WaitWhilePaused { id: u64 },
}

/// What a settled host call hands back to the realm.
///
/// Three shapes, not one, because the protocol has exactly three: a document, a buffer (or its absence),
/// and a refusal. A buffer never travels as text — `Bytes` becomes a `Uint8Array` built by Rust inside the
/// settle scope, which is ADR-0071's rule as it applies to this pump.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SettlePayload {
    /// Resolves with this JSON text.
    Text(String),
    /// Resolves with a `Uint8Array`, or `null` when there was nothing to read.
    Bytes(Option<Vec<u8>>),
    /// Rejects with an `Error` carrying this message.
    Failure(String),
}

/// The flags shared between the pump, the engine's interrupt handler and the JS control triple.
///
/// `cancelled` is the value the interrupt handler reads: the probe's `AtomicBool` pattern, in one
/// place, so `runtime.isCancelled()`, the engine's stop and the pump's exit are the same fact rather
/// than three polls that can disagree.
pub struct RunSignals {
    cancelled: AtomicBool,
    timed_out: AtomicBool,
    over_budget: AtomicBool,
    used_bytes: AtomicU64,
    budget_bytes: u64,
    /// When the next `checkpoint` is due, shared so the two callers cannot poll twice as often.
    next_poll: std::sync::Mutex<Instant>,
    poll_interval: Duration,
    deadline: Instant,
}

impl RunSignals {
    /// Flags for a run with a given ceiling and the shipped cadences. Test-facing: the engine builds
    /// its signals from [`crate::EngineLimits`], which is the only place those defaults belong.
    #[cfg(test)]
    #[must_use]
    pub(crate) fn new(budget_bytes: u64) -> Self {
        Self::with_budget_and_deadline(budget_bytes, DEFAULT_HOST_POLL_INTERVAL, DEFAULT_RUN_DEADLINE)
    }

    #[must_use]
    pub(crate) fn from_limits(limits: &EngineLimits) -> Self {
        Self::with_budget_and_deadline(
            limits.memory_limit_bytes as u64,
            limits.host_poll_interval,
            limits.run_deadline,
        )
    }

    #[must_use]
    pub(crate) fn with_budget_and_deadline(
        budget_bytes: u64,
        poll_interval: Duration,
        run_deadline: Duration,
    ) -> Self {
        let now = Instant::now();
        Self {
            cancelled: AtomicBool::new(false),
            timed_out: AtomicBool::new(false),
            over_budget: AtomicBool::new(false),
            used_bytes: AtomicU64::new(0),
            budget_bytes,
            next_poll: std::sync::Mutex::new(now + poll_interval),
            poll_interval,
            deadline: now + run_deadline,
        }
    }

    /// Marks the run cancelled. Idempotent, and the engine's stop condition.
    pub(crate) fn mark_cancelled(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }

    #[must_use]
    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }

    pub(crate) fn mark_timed_out(&self) {
        self.timed_out.store(true, Ordering::Relaxed);
    }

    #[must_use]
    pub(crate) fn is_timed_out(&self) -> bool {
        self.timed_out.load(Ordering::Relaxed)
    }

    /// Records the engine's live bytes and refreshes the over-budget flag.
    ///
    /// `>=` rather than `>`: the ceiling is what the node declared for itself, so arriving at it is
    /// arriving at the limit.
    pub(crate) fn record_used(&self, used_bytes: u64) -> bool {
        self.used_bytes.store(used_bytes, Ordering::Relaxed);
        let over = self.budget_bytes > 0 && used_bytes >= self.budget_bytes;
        self.over_budget.store(over, Ordering::Relaxed);
        over
    }

    #[must_use]
    pub(crate) fn used_bytes(&self) -> u64 {
        self.used_bytes.load(Ordering::Relaxed)
    }

    #[must_use]
    pub(crate) fn budget_bytes(&self) -> u64 {
        self.budget_bytes
    }

    #[must_use]
    pub(crate) fn is_over_budget(&self) -> bool {
        self.over_budget.load(Ordering::Relaxed)
    }

    /// Whether the run is past its wall-clock deadline.
    #[must_use]
    pub(crate) fn expired(&self) -> bool {
        Instant::now() >= self.deadline
    }

    /// Whether a `checkpoint` is due now, moving the due time forward if it was.
    pub(crate) fn poll_due(&self) -> bool {
        let now = Instant::now();
        let mut guard = self
            .next_poll
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if now < *guard {
            return false;
        }
        *guard = now + self.poll_interval;
        true
    }
}

/// Why the pump stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PumpReason {
    /// The node's run produced an outcome — a success *or* a caught exception.
    Settled,
    /// The operation was cancelled.
    Cancelled,
    /// The wall-clock deadline passed.
    TimedOut,
    /// Nothing was in flight and nothing could settle it: a parked promise.
    Parked,
}

/// The run's outcome, as JS recorded it.
pub(crate) enum RawOutcome {
    /// The run answered. `document` is the JSON text of the value, `None` for `undefined`.
    Answered { document: Option<String>, answer: Answered },
    /// The run threw. `cancelled` is JS's own reading of the message; the pump's flags outrank it.
    Failed { message: String, cancelled: bool },
}

/// What the entry returned, as JavaScript saw it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Answered {
    /// `typeof value === "string"`, which is how a node function answers with renderable text.
    Text,
    /// Anything else: an object, array, number, boolean or `undefined`.
    Structured,
}

/// Drives one run's job queue.
pub(crate) struct Pump<'engine> {
    context: &'engine Context,
    slot: HostSlot,
    requests: Arc<std::sync::Mutex<Vec<Request>>>,
    signals: Arc<RunSignals>,
    allowed_programs: Vec<&'static str>,
    /// The widened machine surface, the same object the JS callbacks read.
    machine: MachineAccess,
    /// Rounds that ran with nothing to do; the parked test's counter.
    idle_rounds: u32,
}

impl<'engine> Pump<'engine> {
    pub(crate) fn new(
        context: &'engine Context,
        slot: HostSlot,
        requests: Arc<std::sync::Mutex<Vec<Request>>>,
        signals: Arc<RunSignals>,
        allowed_programs: Vec<&'static str>,
        machine: MachineAccess,
    ) -> Self {
        Self { context, slot, requests, signals, allowed_programs, machine, idle_rounds: 0 }
    }

    /// The context this run's engine is on.
    ///
    /// Read back from the pump instead of being passed alongside it: the pump and the executor are
    /// holding the same two objects, and a `drive` with ten parameters is how a run's lifetime story
    /// stops being readable.
    pub(crate) fn context(&self) -> &'engine Context {
        self.context
    }

    /// The host access this run owns.
    pub(crate) fn slot(&self) -> &HostSlot {
        &self.slot
    }

    /// The flags shared with the JS control triple and the engine's interrupt handler.
    pub(crate) fn signals(&self) -> &RunSignals {
        &self.signals
    }

    /// Runs until the node settles, the operation cancels, the deadline passes, or nothing that
    /// could still settle is left.
    pub(crate) fn drain(&mut self) -> Result<PumpReason, NodeRunError> {
        loop {
            if self.signals.is_cancelled() {
                return Ok(PumpReason::Cancelled);
            }
            if self.signals.is_timed_out() || self.signals.expired() {
                self.signals.mark_timed_out();
                return Ok(PumpReason::TimedOut);
            }

            let batch = self.take_requests();
            let did_work = !batch.is_empty();
            for request in batch {
                self.answer(request)?;
            }

            match self.run_jobs() {
                Ok(jobs) => {
                    if jobs == 0 && !did_work {
                        self.idle_rounds += 1;
                        if self.idle_rounds > IDLE_ROUNDS_BEFORE_PARKED && self.nothing_left_to_do()? {
                            return Ok(PumpReason::Parked);
                        }
                        std::thread::sleep(Duration::from_millis(1));
                    } else {
                        self.idle_rounds = 0;
                    }
                }
                Err(JobStop::Cancelled) => return Ok(PumpReason::Cancelled),
                Err(JobStop::Failed(message)) => {
                    return Err(NodeRunError {
                        message: format!("a queued job threw outside the node's own handler: {message}"),
                    });
                }
            }

            // Live bytes are read on the host side, because `Runtime::memory_usage` would re-enter
            // the runtime lock that the open context scope already holds.
            let used = self.context.runtime().memory_usage().memory_used_size.max(0) as u64;
            self.signals.record_used(used);
            self.poll_operation_state()?;

            if read_outcome(self.context)?.is_some() {
                // The settle boundary is a checkpoint like any other. Without this read a run that
                // never touched the host could hand back a document for an operation the operator has
                // already cancelled, which is the one answer the seam must not deliver
                // (`tests/cancel_pause.rs`'s settle-boundary test is what pins it).
                self.poll(host_calls::PUMP_CHECKPOINT_PHASE, Force::Yes)?;
                if self.signals.is_cancelled() {
                    return Ok(PumpReason::Cancelled);
                }
                return Ok(PumpReason::Settled);
            }
        }
    }

    fn take_requests(&self) -> Vec<Request> {
        let mut guard = self
            .requests
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        std::mem::take(&mut *guard)
    }

    /// Executes one request against the host and settles the JS promise that belongs to it.
    ///
    /// The host answer is produced with no context scope open, so a slow `fs.list` cannot hold the
    /// engine's runtime lock, and the settle is a separate short scope. That ordering is the probe's
    /// `RefCell already borrowed` lesson applied on the host side too.
    fn answer(&self, request: Request) -> Result<(), NodeRunError> {
        let (id, payload) = match request {
            Request::Operation { id, operation, arguments, payload } => {
                // `callAsync` never consults the table before queueing, so the check is here too.
                match HostOperation::parse(&operation) {
                    None => (
                        id,
                        SettlePayload::Failure(format!(
                            "unknown host operation {operation:?} for an asynchronous call"
                        )),
                    ),
                    Some(operation) => {
                        let allowed = self.allowed_programs.as_slice();
                        let machine = &self.machine;
                        match self.slot.with_host(|host| {
                            host_calls::execute(operation, &arguments, payload.as_deref(), host, allowed, machine)
                        }) {
                            Some(Ok(HostAnswer::Text(text))) => (id, SettlePayload::Text(text)),
                            Some(Ok(HostAnswer::Bytes(bytes))) => (id, SettlePayload::Bytes(bytes)),
                            Some(Err(error)) => {
                                let cancelled = matches!(error, host_calls::CallError::Cancelled);
                                if cancelled {
                                    self.signals.mark_cancelled();
                                }
                                (id, SettlePayload::Failure(error.message().to_string()))
                            }
                            None => (
                                id,
                                SettlePayload::Failure(String::from(
                                    "the host call arrived outside a run scope",
                                )),
                            ),
                        }
                    }
                }
            }
            Request::WaitWhilePaused { id } => {
                match self
                    .slot
                    .with_host(|host| host_calls::checkpoint(host, WAIT_CHECKPOINT_PHASE))
                {
                    // The value is informational: the TypeScript control resolved `void`, and the
                    // protocol says a host promise settles with text.
                    Some(Ok(())) => (id, SettlePayload::Text(String::from("continue"))),
                    Some(Err(error)) => {
                        self.signals.mark_cancelled();
                        (id, SettlePayload::Failure(error.message().to_string()))
                    }
                    None => (
                        id,
                        SettlePayload::Failure(String::from("the checkpoint arrived outside a run scope")),
                    ),
                }
            }
        };
        settle(self.context, id, &payload)
    }

    /// Drains the microtask queue. Called with no context scope open.
    fn run_jobs(&self) -> Result<usize, JobStop> {
        let runtime = self.context.runtime();
        let mut executed = 0usize;
        while runtime.is_job_pending() {
            if let Err(exception) = runtime.execute_pending_job() {
                // `execute_pending_job` answers `JobException`, not `Error`, and the type is not
                // re-exported, so the message is read off the pending exception instead.
                let message = pending_exception_text(self.context);
                if self.signals.is_cancelled() || message.contains(host_calls::CANCELLED_MESSAGE) {
                    return Err(JobStop::Cancelled);
                }
                let _ = exception;
                return Err(JobStop::Failed(if message.is_empty() {
                    String::from("the engine reported a failed job")
                } else {
                    message
                }));
            }
            executed += 1;
            if self.signals.is_cancelled() {
                return Err(JobStop::Cancelled);
            }
            if executed >= MAX_JOBS_PER_ROUND {
                break;
            }
        }
        Ok(executed)
    }

    /// Re-reads the operation's state on the shared cadence: how a pause parks an idle run, and how
    /// a cancel reaches a JS loop that is between two host calls.
    fn poll_operation_state(&self) -> Result<(), NodeRunError> {
        self.poll(host_calls::PUMP_CHECKPOINT_PHASE, Force::OnCadence)
    }

    /// The one host read that happens *before* any JavaScript is evaluated, for a bundle that cannot
    /// reach a checkpoint of its own (no `NodeRunControl` triple, and no checkpoint operation in
    /// [`crate::host_calls::HostOperation`]).
    ///
    /// A cancelled operation must not get a run, and a paused one waits for its resume before work
    /// starts. Marking the shared flag is enough to end the run: the caller reads it and answers the
    /// cancel, so the reason stays the cancel rather than a node bug.
    pub(crate) fn poll_before_launch(&self) -> Result<(), NodeRunError> {
        self.poll(RUN_START_CHECKPOINT_PHASE, Force::Yes)
    }

    /// One `checkpoint`, forced or on the shared cadence.
    fn poll(&self, phase: &'static str, force: Force) -> Result<(), NodeRunError> {
        // A forced read does not consume a slot on the shared cadence: `poll_due` only moves the next
        // due time forward when it answers true, so the boundary reads keep their own rhythm.
        if force == Force::OnCadence && !self.signals.poll_due() {
            return Ok(());
        }
        match self.slot.with_host(|host| host_calls::checkpoint(host, phase)) {
            Some(Ok(())) => Ok(()),
            // A cancel is not a failure to report: it ends the run, and the reason is the cancel.
            Some(Err(host_calls::CallError::Cancelled)) => {
                self.signals.mark_cancelled();
                Ok(())
            }
            Some(Err(host_calls::CallError::Failure(message))) => Err(NodeRunError {
                message: format!("the operation could not be polled at a pump boundary: {message}"),
            }),
            None => Ok(()),
        }
    }

    /// Whether nothing the host knows about is still in flight.
    fn nothing_left_to_do(&self) -> Result<bool, NodeRunError> {
        if !self
            .requests
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_empty()
        {
            return Ok(false);
        }
        let deferred: usize = self
            .context
            .with(|ctx| {
                ctx.globals()
                    .get::<_, Function>("__xrDeferredSize")
                    .and_then(|size| size.call::<_, usize>(()))
            })
            .map_err(|error| NodeRunError {
                message: format!("the deferred registry could not be read: {error}"),
            })?;
        Ok(deferred == 0 && !self.context.runtime().is_job_pending())
    }
}

/// Why the job drain stopped.
enum JobStop {
    Cancelled,
    Failed(String),
}

/// The settle entry point JS installs, called with no JS on the stack.
///
/// The value handed to `__xrSettle` is the host's answer *in its own shape*: a JSON string for a document,
/// a `Uint8Array` for a buffer, `null` for "nothing to read". JS does not have to know which, and Rust never
/// puts bytes into the text channel — that is the byte rule, applied at the one place the pump can apply it.
fn settle(context: &Context, id: u64, payload: &SettlePayload) -> Result<(), NodeRunError> {
    let ok = !matches!(payload, SettlePayload::Failure(_));
    let handle = f64::from(u32::try_from(id).unwrap_or(u32::MAX));
    context
        .with(|ctx| {
            let settle: Function = ctx.globals().get("__xrSettle")?;
            match payload {
                // A document crosses as the JSON *text*: the shim decides whether to parse, the host
                // never guesses. A refusal crosses as the same string with `ok = false`.
                SettlePayload::Text(text) | SettlePayload::Failure(text) => {
                    settle.call::<_, ()>((handle, ok, text.clone()))
                }
                SettlePayload::Bytes(Some(bytes)) => {
                    let buffer = TypedArray::<u8>::new_copy(ctx.clone(), bytes.as_slice())?.into_value();
                    settle.call::<_, ()>((handle, ok, buffer))
                }
                SettlePayload::Bytes(None) => {
                    settle.call::<_, ()>((handle, ok, Value::new_null(ctx.clone())))
                }
            }
        })
        .map_err(|error| NodeRunError {
            message: format!("a parked host call could not be settled: {error}"),
        })
}

/// Reads the run's outcome JS wrote, if it wrote one.
pub(crate) fn read_outcome(context: &Context) -> Result<Option<RawOutcome>, NodeRunError> {
    context
        .with(|ctx| -> rquickjs::Result<Option<RawOutcome>> {
            let outcome: Option<Object> = ctx.globals().get("__xrOutcome")?;
            let Some(outcome) = outcome else { return Ok(None) };
            if outcome.get::<_, bool>("done").unwrap_or(false) {
                if outcome.get::<_, bool>("ok").unwrap_or(false) {
                    let value: Option<Value> = outcome.get("value").ok();
                    let document = match value {
                        None => None,
                        Some(value) if value.is_undefined() => None,
                        Some(value) => ctx
                            .json_stringify(value)?
                            .and_then(|text| text.to_string().ok()),
                    };
                    let answer = match outcome.get::<_, Option<String>>("kind") {
                        Ok(Some(kind)) if kind == "string" => Answered::Text,
                        _ => Answered::Structured,
                    };
                    // A string answer is `JSON.stringify`'d like everything else (so it arrives with
                    // quotes); `Answered::Text` is what lets the caller take it back off.
                    return Ok(Some(RawOutcome::Answered { document, answer }));
                }
                return Ok(Some(RawOutcome::Failed {
                    message: outcome
                        .get::<_, String>("message")
                        .unwrap_or_else(|_| String::from("the node threw without a message")),
                    cancelled: outcome.get("cancelled").unwrap_or(false),
                }));
            }
            Ok(None)
        })
        .map_err(|error| NodeRunError {
            message: format!("the run outcome could not be read: {error}"),
        })
}

/// The message of the exception the engine left pending, or an empty string.
fn pending_exception_text(context: &Context) -> String {
    // The job's exception is pending on the context the job ran on; this run has exactly one.
    context.with(|ctx| {
        let caught = ctx.catch();
        exception_text(&caught)
    })
}

/// Turns a thrown JS value into the text a run error carries.
pub(crate) fn exception_text(value: &Value) -> String {
    if let Some(exception) = value.as_exception()
        && let Some(message) = exception.message()
    {
        return message;
    }
    if let Some(text) = value.as_string() {
        return text.to_string().unwrap_or_default();
    }
    match value.type_of() {
        Type::Object => object_word(value),
        Type::Undefined => String::from("undefined was thrown"),
        Type::Null => String::from("null was thrown"),
        Type::String => String::from("a string was thrown"),
        other => format!("a {other:?} was thrown"),
    }
}

/// The first stack frame the engine recorded for a thrown value, e.g. `at evaluate (bundle.js:12:3)`.
///
/// A bundle rejected during module evaluation otherwise says `not a function`, which is not a diagnosis: the
/// frame names the position inside the bundle text, so the next step is a line in the artifact rather than a
/// guess. `None` when the thrown value is not an Error or carries no stack.
pub(crate) fn exception_frame(value: &Value) -> Option<String> {
    let stack = value.as_exception()?.stack()?;
    stack
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with("at "))
        .map(str::to_owned)
}

/// `Error name: message` for a thrown object, so a run error says more than "an object".
fn object_word(value: &Value) -> String {
    let name = value
        .as_object()
        .and_then(|object| object.get::<_, Option<String>>("name").ok().flatten())
        .unwrap_or_else(|| String::from("object"));
    let message = value
        .as_object()
        .and_then(|object| object.get::<_, Option<String>>("message").ok().flatten())
        .unwrap_or_default();
    let detail = if message.is_empty() { "no message".to_string() } else { message };
    format!("an {name} was thrown ({detail})")
}

/// The phase a `waitWhilePaused` release reports.
pub(crate) const WAIT_CHECKPOINT_PHASE: &str = "wait-while-paused";

/// The phase the boundary read before the bundle runs reports.
///
/// It is a different string from [`host_calls::PUMP_CHECKPOINT_PHASE`] on purpose: an operator
/// comparing the two executors' logs has to be able to tell "the executor refused to start a run"
/// apart from "a run yielded mid-work".
const RUN_START_CHECKPOINT_PHASE: &str = "quickjs-run-start";

/// Whether a checkpoint read is allowed to wait for its turn on the shared cadence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Force {
    /// Ask now, whatever the cadence says.
    Yes,
    /// Ask only if the cadence is due, which is how the pump and the interrupt handler share one
    /// rhythm instead of polling twice as often.
    OnCadence,
}

/// The most jobs one round runs before yielding the loop, so a promise-driven spin still lets the
/// pump re-read its own flags.
const MAX_JOBS_PER_ROUND: usize = 50_000;

/// How many consecutive empty rounds count as "nothing will ever settle this".
const IDLE_ROUNDS_BEFORE_PARKED: u32 = 40;

#[cfg(test)]
mod tests {
    use super::*;
    use rquickjs::{Context, Runtime};

    #[test]
    fn the_cancel_flag_is_the_single_fact_the_three_readers_share() {
        let signals = RunSignals::new(1024);
        assert!(!signals.is_cancelled());
        signals.mark_cancelled();
        assert!(signals.is_cancelled());
        // Idempotent, because both the interrupt handler and a refused host call mark it.
        signals.mark_cancelled();
        assert!(signals.is_cancelled());
    }

    #[test]
    fn the_budget_flag_follows_measured_bytes_and_zero_is_not_a_limit_here() {
        let signals = RunSignals::new(1000);
        assert!(!signals.record_used(999));
        assert!(signals.record_used(1000), "reaching the declared ceiling is reaching the limit");
        assert!(signals.is_over_budget());
        assert!(!signals.record_used(10), "coming back under the ceiling clears the flag");

        let undeclared = RunSignals::new(0);
        assert!(
            !undeclared.record_used(u64::MAX),
            "a zero budget is answered by the executor refusing to schedule, not by this flag"
        );
    }

    #[test]
    fn the_poll_cadence_is_once_per_interval_across_both_readers() {
        let signals = RunSignals::with_budget_and_deadline(
            1024,
            Duration::from_millis(20),
            Duration::from_secs(30),
        );
        assert!(!signals.poll_due(), "the first poll is one interval away, not now");
        std::thread::sleep(Duration::from_millis(25));
        assert!(signals.poll_due(), "positive control: the interval did pass");
        assert!(!signals.poll_due(), "and the next is deferred again, so two readers share one cadence");
    }

    #[test]
    fn the_deadline_is_measured_from_the_start_of_the_run() {
        let running = RunSignals::with_budget_and_deadline(1024, Duration::from_millis(5), Duration::from_secs(30));
        assert!(!running.expired());
        let passed = RunSignals::with_budget_and_deadline(1024, Duration::from_millis(5), Duration::ZERO);
        std::thread::sleep(Duration::from_millis(2));
        assert!(passed.expired(), "a zero-length deadline is already past");
    }

    #[test]
    fn a_thrown_js_value_reports_its_message_and_not_just_its_type() {
        let runtime = Runtime::new().expect("runtime");
        let context = Context::full(&runtime).expect("context");
        context.with(|ctx| {
            let thrown = ctx.eval::<(), _>("throw new Error('the node said no')");
            assert!(thrown.is_err(), "the eval must fail: {thrown:?}");
            let value = ctx.catch();
            assert_eq!(exception_text(&value), "the node said no");

            // Positive controls: a bare string throw has no `message` property on the value, and a
            // plain object throw is not an `Error`; neither may read as an empty run error.
            ctx.eval::<(), _>(
                r#"globalThis.__throwString = () => { throw 'plain text'; };
                   globalThis.__throwObject = () => { throw { name: 'PlanError', message: 'row 3 refused' }; };"#,
            )
            .expect("define");
            for (source, expected) in [
                ("__throwString()", "plain text"),
                ("__throwObject()", "row 3 refused"),
            ] {
                ctx.eval::<(), _>(source).expect_err("the helper throws");
                let text = exception_text(&ctx.catch());
                assert!(text.contains(expected), "{source} reported {text:?}");
            }
        });
    }

    #[test]
    fn a_text_answer_is_flagged_as_text_and_still_arrives_encoded() {
        let runtime = Runtime::new().expect("runtime");
        let context = Context::full(&runtime).expect("context");
        context
            .with(|ctx| {
                ctx.eval::<(), _>(
                    r#"globalThis.__xrOutcome = { done: true, ok: true, kind: typeof "mixed case", value: "mixed case" };"#,
                )
                .expect("text answer")
            });
        let outcome = read_outcome(&context).expect("read").expect("written");
        match outcome {
            RawOutcome::Answered { document, answer } => {
                assert_eq!(answer, Answered::Text, "the kind must be read from JS");
                assert_eq!(document.expect("json"), r#""mixed case""#, "and stays parseable JSON");
            }
            other => panic!("expected an answered outcome, got {}", describe_outcome(&other)),
        }
    }

    #[test]
    fn the_outcome_reader_distinguishes_pending_answered_and_failed() {
        let runtime = Runtime::new().expect("runtime");
        let context = Context::full(&runtime).expect("context");
        assert!(read_outcome(&context).expect("no outcome yet").is_none(), "before the glue runs");

        context
            .with(|ctx| {
                ctx.eval::<(), _>("globalThis.__xrOutcome = { done: true, ok: true, kind: 'object', value: { a: 1 } };")
                    .expect("answered outcome")
            });
        let outcome = read_outcome(&context).expect("read").expect("written");
        match outcome {
            RawOutcome::Answered { document, answer } => {
                assert_eq!(document.expect("json"), r#"{"a":1}"#);
                assert_eq!(answer, Answered::Structured, "an object answer is structured");
            }
            other => panic!("expected an answered outcome, got {}", describe_outcome(&other)),
        }

        context
            .with(|ctx| {
                ctx.eval::<(), _>(
                    "globalThis.__xrOutcome = { done: true, ok: false, cancelled: true, message: 'operation cancelled' };",
                )
                .expect("failed outcome")
            });
        let outcome = read_outcome(&context).expect("read").expect("written");
        match outcome {
            RawOutcome::Failed { message, cancelled } => {
                assert_eq!(message, "operation cancelled");
                assert!(cancelled, "the JS arm must be read, not assumed");
            }
            other => panic!("expected a failed outcome, got {}", describe_outcome(&other)),
        }

        // A `done: false` placeholder must not read as settled: that is the pump's exit condition.
        context
            .with(|ctx| {
                ctx.eval::<(), _>("globalThis.__xrOutcome = { done: false };").expect("placeholder")
            });
        assert!(read_outcome(&context).expect("read").is_none(), "a placeholder is not an outcome");
    }

    fn describe_outcome(outcome: &RawOutcome) -> String {
        match outcome {
            RawOutcome::Answered { document, .. } => format!("answered({document:?})"),
            RawOutcome::Failed { message, cancelled } => format!("failed({message}, cancelled={cancelled})"),
        }
    }

    #[test]
    fn an_undefined_answer_is_a_none_document_not_the_string_undefined() {
        let runtime = Runtime::new().expect("runtime");
        let context = Context::full(&runtime).expect("context");
        context
            .with(|ctx| {
                ctx.eval::<(), _>("globalThis.__xrOutcome = { done: true, ok: true, kind: 'undefined', value: undefined };")
                    .expect("undefined answer")
            });
        let outcome = read_outcome(&context).expect("read").expect("written");
        match outcome {
            RawOutcome::Answered { document, .. } => assert!(document.is_none(), "{document:?}"),
            other => panic!("expected an answered outcome, got {}", describe_outcome(&other)),
        }
    }
}
