//! The host operation vocabulary, and the one Rust implementation behind each name.
//!
//! This is the other half of the protocol the shim layer codes against; the JavaScript side is in
//! `quickjs_realm::shims`. The rules that shaped it are ADR-0074 §2:
//!
//! - **Text answers are JSON.** `__xrh.call` answers a JSON string and the shim parses it.
//! - **Bytes answers are bytes.** `fs.readBytes` answers [`HostAnswer::Bytes`] and crosses as a
//!   `Uint8Array`; `fs.writeBytes`/`crypto.digest` take their payload through `__xrh.sendBytes`. Nothing
//!   in this protocol base64s a file into a JSON document — the failure mode ADR-0071 retired and
//!   AGENTS.md restates.
//! - **One implementation per answer.** The clock is [`NodeHost::now`], the filesystem is the granted
//!   [`FileCapability`](xiranite_core::filesystem::FileCapability) reached through
//!   [`MachineAccess`](crate::machine::MachineAccess), the digests are `quickjs_realm::digest`. A second
//!   "equivalent" path is how `["a","ä","b"]` becomes `["a","b","ä"]`.
//! - **Refusals are data.** A host failure becomes a thrown JS `Error` carrying the host's message, and a
//!   cancel becomes a thrown `Error` whose text is exactly [`CANCELLED_MESSAGE`], so a bundle can tell the
//!   two apart and the executor can recognise an escaped cancel.
//!
//! ## The three modules this file dispatches to
//!
//! [`crate::fs_operations`] owns the file arms and [`crate::proc_operations`] the process arms; this file
//! owns the vocabulary, the argument discipline, the event and checkpoint channels, and the small clock /
//! entropy / digest / machine-facts arms. The split is by *machine domain*, not by size: an operation's
//! answer must have one place where its refusal wording, its ceiling and its grant rule are written.
//!
//! ## Where `proc.exec`'s confirmation gate lives
//!
//! [`ProcessGrant::confirm_before_run`](xiranite_node_registry::ProcessGrant) is *not* enforced here, and
//! that is the documented design rather than an oversight: ADR-0069 hangs the danger gate on the
//! registration, and the face that renders the definition (`form-bridge.ts`'s `dangerGate`, the CLI's
//! confirmation, the GUI's dialog) asks the user **before the operation exists**. By the time a node runs,
//! the confirmation has either happened or the operation was never started. The executor's job is the part
//! no face can do: refuse any program the node did not declare, refuse a path-shaped program name, and
//! refuse a working directory the operation was not granted.


use serde_json::{Value, json};
use xiranite_core::filesystem::FsCapabilityError;
use xiranite_node_registry::{NodeCheckpointRequest, NodeHost, NodeHostError, ProcessGrant};
use xiranite_plugin_api::{LogEvent, OpaquePayload, ProgressEvent, ProgressPercent, PluginRunEvent};

use quickjs_realm::{Algorithm, fill_entropy, format_uuid, hex};
use crate::machine::MachineAccess;
use crate::{fs_operations, host_services, proc_operations};

// The vocabulary, the byte/text envelope and the run-control strings are the protocol crate's now
// (ADR-0078); this file keeps only what needs the host's own error types.
pub use quickjs_host_protocol::{
    HostAnswer, HostOperation, MAX_PROCESS_OUTPUT_BYTES, MAX_RANDOM_BYTES, answer,
    parse_arguments, required_path, required_text, serialize,
};
use quickjs_host_protocol::HostRefusal;
#[cfg(test)]
use quickjs_host_protocol::{CANCELLED_MESSAGE, PUMP_CHECKPOINT_PHASE};

impl From<CallError> for HostRefusal {
    /// The one place a host refusal becomes a realm-visible refusal.
    ///
    /// Kept as a mapping rather than one shared type because the protocol crate must not learn about
    /// `NodeHostError` or `FsCapabilityError` (orphan rule and layering both forbid it), and `CallError`
    /// is what the arms already build their refusals from.
    fn from(error: CallError) -> Self {
        match error {
            CallError::Failure(message) => Self::Failure(message),
            CallError::Cancelled => Self::Cancelled,
        }
    }
}

impl From<HostRefusal> for CallError {
    /// Lets an arm `?` a protocol helper (`parse_arguments`, `required_text`) inside a
    /// `Result<_, CallError>` signature without renaming the 190 sites that already spell it this way.
    fn from(refusal: HostRefusal) -> Self {
        match refusal {
            HostRefusal::Failure(message) => Self::Failure(message),
            HostRefusal::Cancelled => Self::Cancelled,
        }
    }
}

/// Why a call did not answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CallError {
    /// The host refused or the machine failed; the message is what the node would have shown.
    Failure(String),
    /// The owning operation is cancelled. Every operation can answer this and a bundle must not be able to
    /// swallow it — the run stops.
    Cancelled,
}

impl CallError {
    pub(crate) fn from_host(error: NodeHostError) -> Self {
        match error {
            NodeHostError::Cancelled => Self::Cancelled,
            NodeHostError::Failure(message) => Self::Failure(message),
        }
    }

    /// A core capability refusal, in the node's vocabulary.
    ///
    /// The message is `FsCapabilityError`'s own, because that is the text the extism capability layer put
    /// in the same envelope and the retained nodes' `catch` blocks already print.
    pub(crate) fn from_core(error: FsCapabilityError) -> Self {
        Self::Failure(error.message())
    }

    /// The message a refusal carries, for the arms' own assertions.
    ///
    /// What JS actually throws is `HostRefusal::message` (the protocol crate owns that spelling), so this
    /// accessor has no production caller and is compiled only under `cfg(test)` — otherwise the shipped
    /// library carries a second way to read the same text.
    #[cfg(test)]
    pub(crate) fn message(&self) -> &str {
        match self {
            Self::Failure(message) => message,
            Self::Cancelled => CANCELLED_MESSAGE,
        }
    }
}

impl From<FsCapabilityError> for CallError {
    /// Lets every `fs.*` arm use `?` on a core refusal, which is the whole point of refusals being data:
    /// one error type travels out of the grant, and the message is the node's.
    fn from(error: FsCapabilityError) -> Self {
        Self::from_core(error)
    }
}

/// Runs one operation against the host the operation was started with.
///
/// `payload` is the byte buffer a `sendBytes` call handed over, `None` for every text call.
/// `allowed_programs` comes from the node's registration, and is a parameter rather than a lookup here
/// because the gate belongs to the registration, not to the argv being run (ADR-0069).
pub(crate) fn execute(
    operation: HostOperation,
    arguments: &str,
    payload: Option<&[u8]>,
    host: &mut (dyn NodeHost + 'static),
    allowed_programs: &[&'static str],
    machine: &MachineAccess,
) -> Result<HostAnswer, CallError> {
    let arguments = parse_arguments(arguments)?;
    if payload.is_some() && !operation.takes_payload() {
        return Err(CallError::Failure(format!(
            "{} takes no byte payload",
            operation.as_str()
        )));
    }
    match operation {
        // Routed by machine domain. Each arm owns its own refusal wording and its own ceiling.
        // These are patterns rather than `if matches!` guards so that adding a `HostOperation` without
        // an arm here is a compile error instead of a runtime refusal nobody noticed.
        HostOperation::Stat
        | HostOperation::List
        | HostOperation::ReadText
        | HostOperation::WriteText
        | HostOperation::EnsureDir
        | HostOperation::Move
        | HostOperation::Delete
        | HostOperation::Mkdtemp
        | HostOperation::Copy
        | HostOperation::AppendText
        | HostOperation::Utimes
        | HostOperation::ReadBytes
        | HostOperation::WriteBytes
        | HostOperation::Link
        | HostOperation::Symlink
        | HostOperation::Readlink
        | HostOperation::Realpath => fs_operations::execute(operation, &arguments, payload, host, machine),
        HostOperation::ProcExec
        | HostOperation::ProcSpawn
        | HostOperation::ProcPoll
        | HostOperation::ProcWait
        | HostOperation::ProcKill => {
            proc_operations::execute(operation, &arguments, host, allowed_programs, machine)
        }
        // One call against a declared host service. This arm is the machine surface's only door to a
        // node's domain engine, and it stays generic: which engine answers, and whether this node may
        // ask it, is decided in `crate::host_services` from the registration.
        HostOperation::ServiceInvoke => host_services::execute(&arguments, host, machine),
        HostOperation::ClockNow => Ok(answer(json!(host.now().map_err(CallError::from_host)?))),
        HostOperation::ClockSleep => clock_sleep(host, &arguments),
        HostOperation::RandomUuid => {
            let mut bytes = [0u8; 16];
            fill_entropy(&mut bytes);
            Ok(answer(json!(format_uuid(&bytes))))
        }
        HostOperation::RandomBytes => {
            let requested = arguments.get("length").and_then(Value::as_u64).unwrap_or(16);
            let length = requested.clamp(1, MAX_RANDOM_BYTES as u64) as usize;
            let mut bytes = vec![0u8; length];
            fill_entropy(&mut bytes);
            Ok(answer(json!(hex(&bytes))))
        }
        HostOperation::Digest => {
            let Some(bytes) = payload else {
                return Err(CallError::Failure(String::from(
                    "crypto.digest needs a byte payload; call it through __xrh.sendBytes(op, args, bytes)",
                )));
            };
            let requested = arguments
                .get("algorithm")
                .and_then(Value::as_str)
                .ok_or_else(|| CallError::Failure("crypto.digest needs `algorithm`".to_string()))?;
            let Some(algorithm) = Algorithm::parse(requested) else {
                return Err(CallError::Failure(format!(
                    "crypto.digest does not answer {requested:?}; this host answers: {}",
                    Algorithm::names().join(", ")
                )));
            };
            Ok(answer(json!({
                "algorithm": algorithm.as_str(),
                "hex": algorithm.digest_hex(bytes),
                "byteLength": bytes.len(),
            })))
        }
        HostOperation::OsTmpdir => Ok(answer(json!(std::env::temp_dir().to_string_lossy()))),
        HostOperation::OsHomedir => {
            // The host's own environment, one answer for both spellings. A home that is not in the
            // environment is refused rather than guessed: a wrong home writes outside every grant.
            let home = ["HOME", "USERPROFILE"]
                .iter()
                .filter_map(|key| std::env::var(key).ok())
                .find(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    CallError::Failure(
                        "os.homedir is not in the host's environment (HOME / USERPROFILE)".to_string(),
                    )
                })?;
            Ok(answer(json!(home)))
        }
        HostOperation::OsCpus => {
            // `available_parallelism` is the count the *host's* scheduler may use, affinity-aware; Node's
            // `os.cpus()` lists every logical CPU. The difference is stated in the answer itself so a node
            // sizing a worker pool is not left to guess which number it got.
            let count = std::thread::available_parallelism()
                .map(std::num::NonZeroUsize::get)
                .unwrap_or(1);
            let listed: Vec<Value> = (0..count)
                .map(|index| json!({ "model": format!("cpu{index}"), "speed": 0, "logical": true }))
                .collect();
            Ok(answer(json!({ "count": count, "cpus": listed })))
        }
    }
}

/// Yields at an item boundary, which is what the JS `waitWhilePaused` control asks for.
///
/// `phase` is `&'static str` because [`NodeCheckpointRequest::phase`] is: it names a loop in the *host's*
/// vocabulary, not one a script invented at run time. The three callers are the whole set, which is what
/// makes the operation log readable across both executors.
/// The longest wait one `clock.sleep` call may ask for.
///
/// A node that wants an hour asks again. That is not a quota for its own sake: every call returns to the
/// realm's pump, and the pump (`quickjs-realm/src/jobs.rs:274-281`) is the only thing that reads the run's
/// wall-clock deadline, which it can only do between calls. One second is also the cadence every waiting
/// node in this repo already samples at, so the loop costs a node nothing it was not already paying.
const MAX_SLEEP_MS: u64 = 1_000;

/// How long one blocking step of a wait may be before the arm re-reads the operation's state.
const SIGNAL_STEP: std::time::Duration = std::time::Duration::from_millis(50);

/// The phase a sleeping run reports while it waits, so the journal says where the run was.
const SLEEP_PHASE: &str = "clock.sleep";

/// Wait on the host's clock, in short rounds, each beginning with a checkpoint.
///
/// The realm has no timers (ADR-0074 §2; `czkawka_operations.rs:21` records the same measurement for the
/// scan loop), so without this arm a node can only wait by spawning `/bin/sleep` and reaping it — a
/// program grant and a child process per second of a countdown. Answering the wait is the host's job;
/// deciding *why* to wait stays with the node.
///
/// The loop is what makes the wait interruptible: the pump cannot see inside a blocking call, so a single
/// `thread::sleep(2h)` would be deaf to a cancel and to a pause for its whole duration. Each round starts
/// with [`checkpoint`], which is where a pause parks the run and a cancel travels back as
/// [`CallError::Cancelled`]. The answer is the milliseconds actually waited, so a caller (and a test) can
/// see that the wait happened rather than being told it did.
fn clock_sleep(host: &mut (dyn NodeHost + 'static), given: &Value) -> Result<HostAnswer, CallError> {
    let ms = match given.get("ms") {
        Some(Value::Number(number)) => number.as_u64(),
        _ => None,
    }
    .ok_or_else(|| CallError::Failure("clock.sleep needs {\"ms\"} as a non-negative integer".to_string()))?;

    if ms > MAX_SLEEP_MS {
        return Err(CallError::Failure(format!(
            "clock.sleep asks for {ms}ms; one call may not exceed {MAX_SLEEP_MS}ms — ask again for the rest, because the run's deadline is only read between calls"
        )));
    }

    let wanted = std::time::Duration::from_millis(ms);
    let started = std::time::Instant::now();
    loop {
        checkpoint(host, SLEEP_PHASE)?;
        let left = wanted.saturating_sub(started.elapsed());
        if left.is_zero() {
            let waited = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
            return Ok(answer(json!(waited)));
        }
        std::thread::sleep(left.min(SIGNAL_STEP));
    }
}

pub(crate) fn checkpoint(host: &mut (dyn NodeHost + 'static), phase: &'static str) -> Result<(), CallError> {
    host.checkpoint(&NodeCheckpointRequest {
        phase,
        processed_item_count: 0,
        total_item_count: 0,
    })
    .map_err(CallError::from_host)?;
    Ok(())
}

/// Reports one `onEvent` line into the operation's stream.
///
/// A `Failure` is swallowed — a dropped report is not a failed run, per the seam's `emit` doc — and only a
/// cancel travels back to the bundle.
pub(crate) fn emit_event(host: &mut (dyn NodeHost + 'static), event_json: &str) -> Result<(), CallError> {
    let event = parse_event(event_json)?;
    match host.emit(&event) {
        Ok(()) | Err(NodeHostError::Failure(_)) => Ok(()),
        Err(NodeHostError::Cancelled) => Err(CallError::Cancelled),
    }
}

/// Turns the bundle's `{type, message, progress, data}` event object into the seam's event.
///
/// `nodeRunEventSchema` in `packages/shared/src/index.ts` is the shape. [`ProgressPercent`] refuses values
/// outside 0..=100; a node reporting an impossible percentage is a bug in the node's report, not a reason
/// to end the run, so the percentage is dropped and the line still lands.
fn parse_event(event_json: &str) -> Result<PluginRunEvent, CallError> {
    let value: Value = serde_json::from_str(event_json).map_err(|error| {
        CallError::Failure(format!("onEvent needs a JSON event object: {error}"))
    })?;
    let message = value.get("message").and_then(Value::as_str).unwrap_or_default().to_string();
    // The `data` sidecar is kept as its JSON text. `NativeNodeHost::emit` does not forward a payload to the
    // operation record today, so this is as far as it goes for now.
    let structured_data = value
        .get("data")
        .filter(|data| !data.is_null())
        .map(|data| OpaquePayload::from_text(&data.to_string()));
    if value.get("type").and_then(Value::as_str) == Some("progress") {
        let percent = value
            .get("progress")
            .and_then(Value::as_f64)
            .and_then(|number| ProgressPercent::try_new(number).ok());
        return Ok(PluginRunEvent::Progress(ProgressEvent { message, percent, structured_data }));
    }
    Ok(PluginRunEvent::Log(LogEvent { message, structured_data }))
}

/// The allowlist as the executor sees it: program names, straight off the registration.
pub(crate) fn allowed_programs(grants: &[ProcessGrant]) -> Vec<&'static str> {
    grants.iter().map(|grant| grant.program).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_host::{CountingHost, SCRIPTED_NOW};
    use xiranite_node_registry::{NodeDirEntry, NodePathInfo};
    use xiranite_plugin_api::checkpoint::CheckpointOutcome;

    fn run(
        operation: HostOperation,
        arguments: &str,
        host: &mut CountingHost,
    ) -> Result<String, CallError> {
        execute(operation, arguments, None, host, &[], &MachineAccess::seam_only()).map(text_of)
    }

    fn text_of(answer: HostAnswer) -> String {
        match answer {
            HostAnswer::Text(text) => text,
            HostAnswer::Bytes(_) => panic!("this arm answers bytes"),
        }
    }

    fn answer(operation: HostOperation, arguments: &str, host: &mut CountingHost) -> String {
        run(operation, arguments, host).unwrap_or_else(|error| {
            panic!("{} refused: {}", operation.as_str(), error.message())
        })
    }

    #[test]
    fn every_text_answer_crosses_as_json_with_the_callers_spelling_kept() {
        let mut host = CountingHost::new();
        let read = answer(HostOperation::ReadText, r#"{"path":"/work/a.txt"}"#, &mut host);
        assert!(read.contains("body of /work/a.txt"), "{read}");
        assert_eq!(host.calls, vec!["read_text /work/a.txt".to_string()]);

        let listing = answer(HostOperation::List, r#"{"path":"/work"}"#, &mut host);
        let listing: Value = serde_json::from_str(&listing).expect("list answer is JSON");
        assert_eq!(listing["entries"].as_array().expect("array").len(), 1, "{listing}");
    }

    #[test]
    fn a_missing_document_is_json_null_and_not_a_failure() {
        let mut host = CountingHost::new();
        host.missing_path = Some("/work/gone.txt".to_string());
        let read = answer(HostOperation::ReadText, r#"{"path":"/work/gone.txt"}"#, &mut host);
        let value: Value = serde_json::from_str(&read).expect("read answer is JSON");
        assert!(value["content"].is_null(), "{value}");
        // Positive control: the same host still answers a path it was not told to hide.
        let kept = answer(HostOperation::ReadText, r#"{"path":"/work/a.txt"}"#, &mut host);
        assert!(kept.contains("body of"), "{kept}");
    }

    #[test]
    fn a_refused_listing_stays_a_failure_because_there_is_no_empty_answer_for_it() {
        let mut host = CountingHost::new();
        host.missing_path = Some("/outside".to_string());
        let error = run(HostOperation::List, r#"{"path":"/outside"}"#, &mut host)
            .expect_err("a refused listing must not read as an empty folder");
        assert!(matches!(error, CallError::Failure(_)), "{error:?}");
    }

    #[test]
    fn the_clock_answer_is_the_one_spelling_the_journals_already_carry() {
        let mut host = CountingHost::new();
        assert_eq!(answer(HostOperation::ClockNow, "{}", &mut host), format!(r#""{SCRIPTED_NOW}""#));
        assert_eq!(
            answer(HostOperation::ClockNow, "  ", &mut host),
            format!(r#""{SCRIPTED_NOW}""#),
            "an omitted argument list is an empty object, not a refusal"
        );
    }

    /// The wait is the answer's whole subject, so the test measures time: `ms: 40` must not come back in
    /// 2 ms (not waiting) and must not come back in 4 s (waiting for the wrong amount).
    #[test]
    fn a_sleep_waits_and_reports_the_window_it_actually_slept() {
        let mut host = CountingHost::new();
        let started = std::time::Instant::now();
        let waited: Value = serde_json::from_str(&answer(HostOperation::ClockSleep, r#"{"ms":40}"#, &mut host))
            .expect("the answer is a number");

        assert!(waited.as_u64().expect("waited ms") >= 40, "{waited}");
        let elapsed = started.elapsed();
        assert!(elapsed >= std::time::Duration::from_millis(40), "{elapsed:?} for a 40ms sleep");
        assert!(elapsed < std::time::Duration::from_secs(4), "a 40ms sleep took {elapsed:?}");
        assert!(
            host.calls.iter().any(|call| call.starts_with("checkpoint ")),
            "the wait must hand the run's state back to the host: {:?}",
            host.calls
        );
    }

    /// `ms: 0` is a yield point, not an error: it still reads the operation's state once and returns.
    #[test]
    fn a_zero_sleep_is_a_checkpoint_rather_than_a_refusal() {
        let mut host = CountingHost::new();
        let waited: Value = serde_json::from_str(&answer(HostOperation::ClockSleep, r#"{"ms":0}"#, &mut host))
            .expect("the answer is a number");

        assert!(waited.as_u64().expect("waited ms") < 50, "a zero sleep returned after {waited}ms");
    }

    #[test]
    fn one_call_is_capped_so_the_pump_keeps_ownership_of_the_deadline() {
        let mut host = CountingHost::new();
        let error = run(HostOperation::ClockSleep, r#"{"ms":60001}"#, &mut host)
            .expect_err("a wait longer than the cap must be refused, not silently truncated");

        assert!(error.message().contains("60000"), "{error:?}");
        assert!(host.calls.is_empty(), "a refused call must not have waited: {:?}", host.calls);
    }

    /// The reason the arm loops in [`SIGNAL_STEP`] rounds instead of sleeping once: a cancel arriving
    /// mid-wait has to end the wait, not be noticed after it.
    #[test]
    fn a_cancel_lands_inside_a_wait_that_would_otherwise_run_for_minutes() {
        let mut host = CountingHost::new();
        host.cancel_at = Some(3);
        let started = std::time::Instant::now();

        let error = run(HostOperation::ClockSleep, r#"{"ms":120000}"#, &mut host)
            .expect_err("the scripted cancel must travel back");

        assert!(matches!(error, CallError::Cancelled), "{error:?}");
        let elapsed = started.elapsed();
        assert!(elapsed < std::time::Duration::from_secs(20), "cancel was ignored for {elapsed:?}");
    }

        #[test]
    fn a_bad_argument_is_a_refusal_before_the_machine_is_touched() {
        let mut host = CountingHost::new();
        for (operation, arguments) in [
            (HostOperation::Stat, "not json"),
            (HostOperation::Stat, "{}"),
            (HostOperation::WriteText, r#"{"path":"/work/a.txt"}"#),
            (HostOperation::Move, r#"{"source":"/a"}"#),
            (HostOperation::Delete, r#"{"path":"   "}"#),
        ] {
            let error = run(operation, arguments, &mut host)
                .expect_err(&format!("{} must refuse", operation.as_str()));
            assert!(matches!(error, CallError::Failure(_)), "{error:?}");
            assert!(!error.message().is_empty(), "{} refused silently", operation.as_str());
        }
        // The argument check happens before the host call, so a malformed request must not have reached the
        // machine — that is the whole reason the checks are here and not in the shim.
        assert!(host.calls.is_empty(), "a refused call touched the machine: {:?}", host.calls);

        // Positive control: a well-formed call of the same operation does reach it.
        run(HostOperation::Delete, r#"{"path":"/work/a.txt"}"#, &mut host).expect("a complete delete answers");
        assert_eq!(host.calls, vec!["delete_path /work/a.txt false".to_string()]);
    }

    #[test]
    fn uuid_shape_is_a_version_four_rfc_4122_id_and_random_bytes_are_bounded_hex() {
        let mut host = CountingHost::new();
        let first =
            serde_json::from_str::<String>(&answer(HostOperation::RandomUuid, "{}", &mut host)).expect("json");
        let second =
            serde_json::from_str::<String>(&answer(HostOperation::RandomUuid, "{}", &mut host)).expect("json");
        assert_eq!(first.len(), 36, "{first}");
        assert_eq!(first.matches('-').count(), 4, "{first}");
        assert_eq!(&first[14..15], "4", "version nibble: {first}");
        assert!(matches!(&first[19..20], "8" | "9" | "a" | "b"), "variant nibble: {first}");
        assert_ne!(first, second, "two ids in one process must differ");

        let bytes = serde_json::from_str::<String>(&answer(
            HostOperation::RandomBytes,
            r#"{"length":8}"#,
            &mut host,
        ))
        .expect("json");
        assert_eq!(bytes.len(), 16, "8 bytes as hex: {bytes}");
        assert!(bytes.bytes().all(|bit| bit.is_ascii_hexdigit()), "{bytes}");

        // The ceiling is enforced, not advertised: a request for a megabyte yields the cap, so a bundle
        // cannot make the host hold an unbounded buffer.
        let capped = serde_json::from_str::<String>(&answer(
            HostOperation::RandomBytes,
            r#"{"length":100000}"#,
            &mut host,
        ))
        .expect("json");
        assert_eq!(capped.len(), MAX_RANDOM_BYTES * 2, "cap not enforced");
    }

    #[test]
    fn tmpdir_and_homedir_answer_absolute_paths_or_refuse() {
        let mut host = CountingHost::new();
        let text =
            serde_json::from_str::<String>(&answer(HostOperation::OsTmpdir, "{}", &mut host)).expect("json");
        assert!(!text.trim().is_empty(), "{text}");
        assert!(std::path::Path::new(&text).is_absolute(), "{text}");

        // `os.homedir` is an environment answer, so on a host with no `HOME` at all the honest result is a
        // refusal naming both spellings it tried, not an empty string a node would join onto.
        let home = execute(
            HostOperation::OsHomedir,
            "{}",
            None,
            &mut host,
            &[],
            &MachineAccess::seam_only(),
        );
        match std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
            Ok(value) if !value.trim().is_empty() => {
                let document = serde_json::from_str::<String>(&text_of(home.expect("a homedir in the env")))
                    .expect("json");
                assert_eq!(document, value, "the host's own value, unedited");
            }
            _ => {
                let error = home.expect_err("no HOME in this environment");
                assert!(error.message().contains("HOME"), "{}", error.message());
            }
        }
    }

    #[test]
    fn os_cpus_answers_a_count_the_host_could_actually_use() {
        let mut host = CountingHost::new();
        let document: Value =
            serde_json::from_str(&answer(HostOperation::OsCpus, "{}", &mut host)).expect("json");
        let count = document["count"].as_u64().expect("a count");
        assert!(count >= 1, "{document}");
        assert_eq!(
            document["cpus"].as_array().expect("a list").len(),
            usize::try_from(count).expect("in range"),
            "Node's `os.cpus().length` has to equal the count, or a node sizes its pool wrong"
        );
        // The difference from Node is recorded in the answer itself, not only in this comment: `speed` is
        // what the host does not read.
        assert_eq!(document["cpus"][0]["speed"], 0, "{document}");
        assert!(document["cpus"][0]["model"].is_string());
    }

    #[test]
    fn the_digest_is_computed_from_the_payload_and_never_from_the_json() {
        let mut host = CountingHost::new();
        let document = execute(
            HostOperation::Digest,
            r#"{"algorithm":"sha256"}"#,
            Some(b"abc"),
            &mut host,
            &[],
            &MachineAccess::seam_only(),
        )
        .map(text_of)
        .expect("digest answers");
        let value: Value = serde_json::from_str(&document).expect("json");
        // The same vector `quickjs_realm::digest` checks against OpenSSL.
        assert_eq!(
            value["hex"],
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            "{value}"
        );
        assert_eq!(value["algorithm"], "sha256", "the answer names what it computed");
        assert_eq!(value["byteLength"], 3);

        let without_payload = execute(
            HostOperation::Digest,
            r#"{"algorithm":"sha256"}"#,
            None,
            &mut host,
            &[],
            &MachineAccess::seam_only(),
        )
        .expect_err("a digest of nothing is a caller bug");
        assert!(without_payload.message().contains("sendBytes"), "{}", without_payload.message());

        let unknown = execute(
            HostOperation::Digest,
            r#"{"algorithm":"md5"}"#,
            Some(b"x"),
            &mut host,
            &[],
            &MachineAccess::seam_only(),
        )
        .expect_err("md5 is not answered here");
        assert!(unknown.message().contains("sha256"), "the refusal lists what is answered: {unknown:?}");
    }

    #[test]
    fn a_cancelled_checkpoint_is_distinguishable_from_a_refusal() {
        let mut host = CountingHost::new();
        host.cancel_at = Some(1);
        let error = checkpoint(&mut host, "dissolving").expect_err("the checkpoint cancels");
        assert_eq!(error, CallError::Cancelled);
        assert_eq!(error.message(), CANCELLED_MESSAGE);

        let mut polite = CountingHost::new();
        checkpoint(&mut polite, PUMP_CHECKPOINT_PHASE).expect("a running operation continues");
        assert!(
            polite
                .calls
                .iter()
                .any(|call| call.starts_with("checkpoint quickjs-pump")),
            "the phase name must reach the seam's log line, got {:?}",
            polite.calls
        );
    }

    #[test]
    fn events_reach_the_seam_and_an_impossible_percentage_only_loses_the_percentage() {
        let mut host = CountingHost::new();
        emit_event(&mut host, r#"{"type":"progress","message":"scan","progress":40}"#)
            .expect("a progress line is accepted");
        emit_event(&mut host, r#"{"type":"log","message":"done"}"#).expect("a log line is accepted");
        emit_event(&mut host, r#"{"type":"progress","message":"odd","progress":140}"#)
            .expect("an out-of-range percentage must not end the run");
        let emitted: Vec<&String> = host.calls.iter().filter(|call| call.starts_with("emit")).collect();
        assert_eq!(emitted.len(), 3, "{emitted:?}");
        assert!(emitted[0].contains("Progress scan"), "{}", emitted[0]);
        assert!(emitted[1].contains("Log done"), "{}", emitted[1]);
        assert!(emitted[2].contains("Progress odd"), "{}", emitted[2]);

        let error = emit_event(&mut host, "not json").expect_err("garbage is a refusal");
        assert!(matches!(error, CallError::Failure(_)));
    }

    #[test]
    fn a_cancelled_emit_travels_back_to_the_bundle() {
        struct Cancelling(CountingHost);
        impl NodeHost for Cancelling {
            fn stat(&mut self, path: &str) -> Result<NodePathInfo, NodeHostError> {
                self.0.stat(path)
            }
            fn list_dir(&mut self, path: &str) -> Result<Vec<NodeDirEntry>, NodeHostError> {
                self.0.list_dir(path)
            }
            fn ensure_dir(&mut self, path: &str) -> Result<(), NodeHostError> {
                self.0.ensure_dir(path)
            }
            fn move_path(&mut self, source: &str, target: &str) -> Result<(), NodeHostError> {
                self.0.move_path(source, target)
            }
            fn delete_path(&mut self, path: &str, recursive: bool) -> Result<(), NodeHostError> {
                self.0.delete_path(path, recursive)
            }
            fn read_text(&mut self, path: &str) -> Result<Option<String>, NodeHostError> {
                self.0.read_text(path)
            }
            fn write_text(&mut self, path: &str, content: &str) -> Result<(), NodeHostError> {
                self.0.write_text(path, content)
            }
            fn now(&mut self) -> Result<String, NodeHostError> {
                self.0.now()
            }
            fn emit(&mut self, _event: &PluginRunEvent) -> Result<(), NodeHostError> {
                Err(NodeHostError::Cancelled)
            }
            fn checkpoint(&mut self, request: &NodeCheckpointRequest) -> Result<CheckpointOutcome, NodeHostError> {
                self.0.checkpoint(request)
            }
        }

        let mut host = Cancelling(CountingHost::new());
        let error = emit_event(&mut host, r#"{"type":"log","message":"line"}"#)
            .expect_err("a cancelled sink must not read as a dropped report");
        assert_eq!(error, CallError::Cancelled);
    }

    #[test]
    fn entropy_blocks_are_not_a_repeating_stream() {
        let mut first = [0u8; 24];
        let mut second = [0u8; 24];
        fill_entropy(&mut first);
        fill_entropy(&mut second);
        assert_ne!(first, second, "two draws must differ");
        // The measurable failure mode of a weak mixer is a repeating block, so the shortest period worth
        // asserting is that no two blocks of one draw are equal.
        assert_ne!(&first[0..8], &first[8..16], "block 0 == block 1");
        assert_ne!(&first[8..16], &first[16..24], "block 1 == block 2");
    }

    #[test]
    fn allowed_programs_reads_the_registration_not_the_request() {
        let grants = [
            ProcessGrant { program: "ffmpeg", confirm_before_run: true },
            ProcessGrant { program: "7zip", confirm_before_run: false },
        ];
        assert_eq!(allowed_programs(&grants), vec!["ffmpeg", "7zip"]);
        // `confirm_before_run` is the face's gate, so it must not narrow the executor's list: the assertion
        // that the flagged entry is still present is what catches someone "fixing" it by dropping declared
        // programs at run time.
        assert!(grants[0].confirm_before_run);
    }
}
