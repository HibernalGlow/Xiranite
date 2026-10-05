//! The host operation vocabulary, and the one Rust implementation behind each name.
//!
//! This is the other half of the protocol the shim layer codes against; the JavaScript side is in
//! [`crate::shims`]. The rules that shaped it are ADR-0074 §2:
//!
//! - **Text answers are JSON.** `__xrh.call` answers a JSON string and the shim parses it.
//! - **Bytes answers are bytes.** `fs.readBytes` answers [`HostAnswer::Bytes`] and crosses as a
//!   `Uint8Array`; `fs.writeBytes`/`crypto.digest` take their payload through `__xrh.sendBytes`. Nothing
//!   in this protocol base64s a file into a JSON document — the failure mode ADR-0071 retired and
//!   AGENTS.md restates.
//! - **One implementation per answer.** The clock is [`NodeHost::now`], the filesystem is the granted
//!   [`FileCapability`](xiranite_core::filesystem::FileCapability) reached through
//!   [`MachineAccess`](crate::machine::MachineAccess), the digests are [`crate::digest`]. A second
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

use std::hash::BuildHasher;
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{Map, Value, json};
use xiranite_core::filesystem::FsCapabilityError;
use xiranite_node_registry::{NodeCheckpointRequest, NodeHost, NodeHostError, ProcessGrant};
use xiranite_plugin_api::{LogEvent, OpaquePayload, ProgressEvent, ProgressPercent, PluginRunEvent};

use crate::digest::Algorithm;
use crate::machine::MachineAccess;
use crate::{fs_operations, host_services, proc_operations};

/// The message a bundle sees when the owning operation was cancelled mid-call.
pub(crate) const CANCELLED_MESSAGE: &str = "operation cancelled";

/// The phase name the pump's own boundary checkpoints report.
pub(crate) const PUMP_CHECKPOINT_PHASE: &str = "quickjs-pump";

/// The phase name the engine's interrupt handler reports when it re-reads the operation mid-JS.
///
/// A separate spelling because the two arms answer different questions: the pump's read is a run yielding
/// on purpose, this one is the host reaching CPU-bound JavaScript.
pub(crate) const INTERRUPT_CHECKPOINT_PHASE: &str = "quickjs-interrupt";

/// The ceiling on captured `proc.exec` output, per stream.
///
/// A node that shells out to a tool with a 200 MiB log must not be able to hold that log in the engine's
/// heap. The seam's own text ceiling is 4 MiB (`MAX_TEXT_BYTES` in
/// `crates/xiranite-core/src/filesystem.rs`) and a subprocess transcript is no different, but a transcript
/// is also not data the node plans on, so the cap is a quarter of it.
pub const MAX_PROCESS_OUTPUT_BYTES: usize = 1024 * 1024;

/// The largest `crypto.randomBytes` answer, in bytes.
pub(crate) const MAX_RANDOM_BYTES: usize = 64;

/// One host operation, named exactly as the shim layer names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostOperation {
    /// `fs.stat` — kind, and with a grant also size and times.
    Stat,
    /// `fs.list` — one directory level.
    List,
    /// `fs.readText` — one bounded text document.
    ReadText,
    /// `fs.writeText` — one bounded text document, creating the parent.
    WriteText,
    /// `fs.ensureDir` — directory and its parents.
    EnsureDir,
    /// `fs.move` — rename with the host's cross-volume fallback.
    Move,
    /// `fs.delete` — delete, refusing a non-empty directory unless `recursive`.
    Delete,
    /// `fs.mkdtemp` — a unique directory inside the grant.
    Mkdtemp,
    /// `fs.copy` — one file, or a tree.
    Copy,
    /// `fs.appendText` — append without reading the document back.
    AppendText,
    /// `fs.utimes` — restore access and modification times.
    Utimes,
    /// `fs.readBytes` — a bounded buffer, optionally a range. The only arm that answers bytes.
    ReadBytes,
    /// `fs.writeBytes` — a bounded buffer, taking its payload out of band.
    WriteBytes,
    /// `fs.link` — hard link.
    Link,
    /// `fs.symlink` — symbolic link.
    Symlink,
    /// `fs.readlink` — the stored target text.
    Readlink,
    /// `fs.realpath` — the canonical path, still inside the grant.
    Realpath,
    /// `proc.exec` — one external program from the node's registration, waited on.
    ProcExec,
    /// `proc.spawn` — one external program from the registration, left running.
    ProcSpawn,
    /// `proc.poll` — a live child's state plus the transcript text since an offset.
    ProcPoll,
    /// `proc.wait` — reap a live child and answer its transcript.
    ProcWait,
    /// `proc.kill` — stop a child this run started.
    ProcKill,
    /// `clock.now` — the host clock in the journals' spelling.
    ClockNow,
    /// `crypto.randomUUID` — one id, host-supplied so a script never reads `Math.random()`.
    RandomUuid,
    /// `crypto.randomBytes` — up to [`MAX_RANDOM_BYTES`] bytes, hex-encoded.
    RandomBytes,
    /// `crypto.digest` — a host SHA-1/SHA-256 over a payload that crossed out of band.
    Digest,
    /// `os.tmpdir` — the host's temporary directory.
    OsTmpdir,
    /// `os.homedir` — the host's home directory, from its own environment.
    OsHomedir,
    /// `os.cpus` — how many workers the host may ask for.
    OsCpus,
    /// `service.invoke` — one call against a host service this node declared it needs.
    ///
    /// The only arm that carries a node's domain vocabulary, and it carries none of its own: the
    /// service and method names are arguments, resolved against a table
    /// (`crate::host_services`) that says which engine answers which name. A node-specific engine
    /// gets a *service*, not four new operations on the machine surface.
    ServiceInvoke,
}

impl HostOperation {
    /// Every operation, in the order the protocol lists them.
    pub const ALL: &'static [Self] = &[
        Self::Stat,
        Self::List,
        Self::ReadText,
        Self::WriteText,
        Self::EnsureDir,
        Self::Move,
        Self::Delete,
        Self::Mkdtemp,
        Self::Copy,
        Self::AppendText,
        Self::Utimes,
        Self::ReadBytes,
        Self::WriteBytes,
        Self::Link,
        Self::Symlink,
        Self::Readlink,
        Self::Realpath,
        Self::ProcExec,
        Self::ProcSpawn,
        Self::ProcPoll,
        Self::ProcWait,
        Self::ProcKill,
        Self::ClockNow,
        Self::RandomUuid,
        Self::RandomBytes,
        Self::Digest,
        Self::OsTmpdir,
        Self::OsHomedir,
        Self::OsCpus,
        Self::ServiceInvoke,
    ];

    /// The wire name a bundle calls.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Stat => "fs.stat",
            Self::List => "fs.list",
            Self::ReadText => "fs.readText",
            Self::WriteText => "fs.writeText",
            Self::EnsureDir => "fs.ensureDir",
            Self::Move => "fs.move",
            Self::Delete => "fs.delete",
            Self::Mkdtemp => "fs.mkdtemp",
            Self::Copy => "fs.copy",
            Self::AppendText => "fs.appendText",
            Self::Utimes => "fs.utimes",
            Self::ReadBytes => "fs.readBytes",
            Self::WriteBytes => "fs.writeBytes",
            Self::Link => "fs.link",
            Self::Symlink => "fs.symlink",
            Self::Readlink => "fs.readlink",
            Self::Realpath => "fs.realpath",
            Self::ProcExec => "proc.exec",
            Self::ProcSpawn => "proc.spawn",
            Self::ProcPoll => "proc.poll",
            Self::ProcWait => "proc.wait",
            Self::ProcKill => "proc.kill",
            Self::ClockNow => "clock.now",
            Self::RandomUuid => "crypto.randomUUID",
            Self::RandomBytes => "crypto.randomBytes",
            Self::Digest => "crypto.digest",
            Self::OsTmpdir => "os.tmpdir",
            Self::OsHomedir => "os.homedir",
            Self::OsCpus => "os.cpus",
            Self::ServiceInvoke => "service.invoke",
        }
    }

    /// Resolves a wire name. An unknown name is a *call* failure carrying the answered list, not a
    /// protocol failure: the bundle asked for something this host does not answer.
    #[must_use]
    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL.iter().copied().find(|operation| operation.as_str() == name)
    }

    /// The names, for error text and for the audit that keeps the shim and the host in step.
    pub fn names() -> Vec<&'static str> {
        Self::ALL.iter().copied().map(Self::as_str).collect()
    }

    /// Whether this operation takes a byte payload from the realm.
    ///
    /// Part of the protocol's shape, not a detail of one arm: `shims.rs` refuses `__xrh.call` for these and
    /// the pump refuses an inline buffer for them, so a byte can only ever arrive out of band.
    #[must_use]
    pub const fn takes_payload(self) -> bool {
        matches!(self, Self::WriteBytes | Self::Digest)
    }

    /// Whether this operation's answer is a buffer rather than a document.
    #[must_use]
    pub const fn answers_bytes(self) -> bool {
        matches!(self, Self::ReadBytes)
    }
}

/// One operation's answer, in the shape it crosses in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum HostAnswer {
    /// A JSON document, the shape every text operation answers.
    Text(String),
    /// A buffer, or `None` for "nothing is there to read". Only [`HostOperation::ReadBytes`] answers this,
    /// and it becomes a `Uint8Array` (or `null`) in the realm rather than a string somewhere inside JSON.
    Bytes(Option<Vec<u8>>),
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

    /// The message thrown into JS.
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

/// A JSON document answer, serialized the one way the protocol says.
pub(crate) fn answer(value: Value) -> HostAnswer {
    HostAnswer::Text(serialize(&value))
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

fn parse_arguments(raw: &str) -> Result<Value, CallError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    serde_json::from_str(trimmed)
        .map_err(|error| CallError::Failure(format!("host call arguments are not JSON: {error}")))
}

pub(crate) fn required_text<'a>(arguments: &'a Value, key: &str) -> Result<&'a str, CallError> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| CallError::Failure(format!("host call needs a non-empty string `{key}`")))
}

pub(crate) fn required_path(arguments: &Value) -> Result<&str, CallError> {
    required_text(arguments, "path")
}

pub(crate) fn serialize(value: &Value) -> String {
    match serde_json::to_string(value) {
        Ok(text) => text,
        // A `Value` built in this crate is always serializable, so this arm means a bug here rather than a
        // machine condition — and it still has to answer JSON, because the shim parses.
        Err(_) => r#"{"serializeError":"the host answer could not be encoded"}"#.to_string(),
    }
}

/// The allowlist as the executor sees it: program names, straight off the registration.
pub(crate) fn allowed_programs(grants: &[ProcessGrant]) -> Vec<&'static str> {
    grants.iter().map(|grant| grant.program).collect()
}

/// A run-scoped source of id entropy.
///
/// **This is not a CSPRNG, and nothing here may be treated as secret material.** It exists because
/// ADR-0074 §2 says a script must not reach for `Math.random()` for anything the journals record and that
/// the host must be the single supplier; the retained nodes use these values as undo-id suffixes and
/// temp-name bits. Each 8-byte block mixes a fresh `RandomState` (whose keys the OS picks at process start),
/// a process-wide counter and the wall clock, which gives uniqueness without adding an RNG dependency to the
/// workspace. Secret-grade bytes, if a node ever needs them, is a host service behind its own operation —
/// not a stronger function in this file.
fn fill_entropy(target: &mut [u8]) {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let mut position = 0usize;
    while position < target.len() {
        let tick = COUNTER.fetch_add(1, Ordering::Relaxed);
        let clock = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos() as u64)
            .unwrap_or_default();
        let state = std::collections::hash_map::RandomState::new();
        let word = state.hash_one((tick, clock, position, target.len())).to_le_bytes();
        let take = (target.len() - position).min(word.len());
        target[position..position + take].copy_from_slice(&word[..take]);
        position += take;
    }
}

fn format_uuid(bytes: &[u8; 16]) -> String {
    let mut shaped = *bytes;
    shaped[6] = (shaped[6] & 0x0f) | 0x40; // version 4
    shaped[8] = (shaped[8] & 0x3f) | 0x80; // RFC 4122 variant
    let text = hex(&shaped);
    format!(
        "{}-{}-{}-{}-{}",
        &text[0..8],
        &text[8..12],
        &text[12..16],
        &text[16..20],
        &text[20..32]
    )
}

/// The one lowercase-hex spelling in this crate: `crypto.randomBytes` answers it, and `crypto.digest`
/// encodes its hash with it.
pub(crate) fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(char::from(DIGITS[usize::from(byte >> 4)]));
        out.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    out
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
    fn the_vocabulary_is_the_agreed_list_and_every_name_parses() {
        assert_eq!(
            HostOperation::names(),
            vec![
                "fs.stat",
                "fs.list",
                "fs.readText",
                "fs.writeText",
                "fs.ensureDir",
                "fs.move",
                "fs.delete",
                "fs.mkdtemp",
                "fs.copy",
                "fs.appendText",
                "fs.utimes",
                "fs.readBytes",
                "fs.writeBytes",
                "fs.link",
                "fs.symlink",
                "fs.readlink",
                "fs.realpath",
                "proc.exec",
                "proc.spawn",
                "proc.poll",
                "proc.wait",
                "proc.kill",
                "clock.now",
                "crypto.randomUUID",
                "crypto.randomBytes",
                "crypto.digest",
                "os.tmpdir",
                "os.homedir",
                "os.cpus",
                "service.invoke",
            ]
        );
        for name in HostOperation::names() {
            assert_eq!(HostOperation::parse(name).map(HostOperation::as_str), Some(name));
        }
        assert_eq!(HostOperation::parse("fs.readRange"), None, "an invented name must not parse");
        assert_eq!(HostOperation::parse("fs.read_bytes"), None, "the Rust spelling is not the wire spelling");
    }

    #[test]
    fn exactly_the_byte_operations_take_or_answer_a_buffer() {
        // The shim and the engine both branch on these two, so the sets are asserted rather than implied by
        // which arm happens to read `payload`.
        for operation in [HostOperation::WriteBytes, HostOperation::Digest] {
            assert!(operation.takes_payload(), "{} must take bytes", operation.as_str());
        }
        assert!(
            HostOperation::ReadBytes.answers_bytes(),
            "fs.readBytes must answer bytes, got {}",
            HostOperation::ReadBytes.as_str()
        );
        for operation in [
            HostOperation::Stat,
            HostOperation::ReadText,
            HostOperation::ProcExec,
            HostOperation::OsCpus,
        ] {
            assert!(!operation.takes_payload() && !operation.answers_bytes(), "{operation:?} is text both ways");
        }
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
        // The same vector `crate::digest` checks against OpenSSL.
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
