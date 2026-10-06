//! The host operation vocabulary, and the one Rust implementation behind each name.
//!
//! This is the other half of the protocol the shim layer codes against; the JavaScript side is in
//! [`crate::shims`]. The rules that shaped it are ADR-0074 §2:
//!
//! - **Arguments and results are JSON text.** `__xrh.call` answers a JSON string and the shim parses
//!   it. Nothing crosses as a raw buffer — the node seam only carries *text* documents, and
//!   inventing a byte channel here would repeat ADR-0071's base64-in-JSON mistake.
//! - **One implementation per answer.** The clock is [`NodeHost::now`], the filesystem is the granted
//!   filesystem behind [`NodeHost`], never `Date` and never `std::fs` from inside the sandbox. A
//!   second "equivalent" path is how `["a","ä","b"]` becomes `["a","b","ä"]`.
//! - **Refusals are data.** A host failure becomes a thrown JS `Error` carrying the host's message,
//!   and a cancel becomes a thrown `Error` whose text is exactly [`CANCELLED_MESSAGE`], so a bundle
//!   can tell the two apart and the executor can recognise an escaped cancel.
//!
//! ## Where `proc.exec`'s confirmation gate lives
//!
//! [`ProcessGrant::confirm_before_run`](xiranite_node_registry::ProcessGrant) is *not* enforced
//! here, and that is the documented design rather than an oversight: ADR-0069 hangs the danger gate
//! on the registration, and the face that renders the definition (`form-bridge.ts`'s `dangerGate`,
//! the CLI's confirmation, the GUI's dialog) asks the user **before the operation exists**. By the
//! time a node runs, the confirmation has either happened or the operation was never started. The
//! executor's job is the part no face can do: refuse any program the node did not declare, refuse a
//! path-shaped program name, and refuse a working directory the operation was not granted.

use std::hash::BuildHasher;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Deserialize;
use serde_json::{Map, Value, json};
use xiranite_node_registry::{NodeCheckpointRequest, NodeHost, NodeHostError, ProcessGrant};
use xiranite_plugin_api::{LogEvent, OpaquePayload, ProgressEvent, ProgressPercent, PluginRunEvent};

/// The message a bundle sees when the owning operation was cancelled mid-call.
pub(crate) const CANCELLED_MESSAGE: &str = "operation cancelled";

/// The phase name the pump's own boundary checkpoints report.
pub(crate) const PUMP_CHECKPOINT_PHASE: &str = "quickjs-pump";

/// The phase name the engine's interrupt handler reports when it re-reads the operation mid-JS.
///
/// A separate spelling because the two arms answer different questions: the pump's read is a run
/// yielding on purpose, this one is the host reaching CPU-bound JavaScript.
pub(crate) const INTERRUPT_CHECKPOINT_PHASE: &str = "quickjs-interrupt";

/// The ceiling on captured `proc.exec` output, per stream.
///
/// A node that shells out to a tool with a 200 MiB log must not be able to hold that log in the
/// engine's heap. The seam's own text ceiling is 4 MiB (`MAX_TEXT_BYTES` in
/// `crates/xiranite-core/src/filesystem.rs`) and a subprocess transcript is no different, but a
/// transcript is also not data the node plans on, so the cap is a quarter of it.
pub const MAX_PROCESS_OUTPUT_BYTES: usize = 1024 * 1024;

/// The largest `crypto.randomBytes` answer, in bytes.
pub(crate) const MAX_RANDOM_BYTES: usize = 64;

/// One host operation, named exactly as the shim layer names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostOperation {
    /// `fs.stat` — does the path exist inside the grant, and what kind is it.
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
    /// `proc.exec` — one external program from the node's registration.
    ProcExec,
    /// `clock.now` — the host clock in the journals' spelling.
    ClockNow,
    /// `crypto.randomUUID` — one id, host-supplied so a script never reads `Math.random()`.
    RandomUuid,
    /// `crypto.randomBytes` — up to [`MAX_RANDOM_BYTES`] bytes, hex-encoded.
    RandomBytes,
    /// `os.tmpdir` — the host's temporary directory.
    OsTmpdir,
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
        Self::ProcExec,
        Self::ClockNow,
        Self::RandomUuid,
        Self::RandomBytes,
        Self::OsTmpdir,
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
            Self::ProcExec => "proc.exec",
            Self::ClockNow => "clock.now",
            Self::RandomUuid => "crypto.randomUUID",
            Self::RandomBytes => "crypto.randomBytes",
            Self::OsTmpdir => "os.tmpdir",
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
}

/// Why a call did not answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CallError {
    /// The host refused or the machine failed; the message is what the node would have shown.
    Failure(String),
    /// The owning operation is cancelled. Every operation can answer this and a bundle must not be
    /// able to swallow it — the run stops.
    Cancelled,
}

impl CallError {
    fn from_host(error: NodeHostError) -> Self {
        match error {
            NodeHostError::Cancelled => Self::Cancelled,
            NodeHostError::Failure(message) => Self::Failure(message),
        }
    }

    /// The message thrown into JS.
    pub(crate) fn message(&self) -> &str {
        match self {
            Self::Failure(message) => message,
            Self::Cancelled => CANCELLED_MESSAGE,
        }
    }
}

/// Runs one operation against the host the operation was started with.
///
/// `allowed_programs` comes from the node's registration, and is a parameter rather than a lookup
/// here because the gate belongs to the registration, not to the argv being run (ADR-0069).
pub(crate) fn execute(
    operation: HostOperation,
    arguments: &str,
    host: &mut (dyn NodeHost + 'static),
    allowed_programs: &[&'static str],
) -> Result<String, CallError> {
    let arguments = parse_arguments(arguments)?;
    let answer = match operation {
        HostOperation::Stat => {
            let path = required_path(&arguments)?;
            let info = host.stat(path).map_err(CallError::from_host)?;
            json!({
                "path": info.path,
                "exists": info.exists,
                "isFile": info.is_file,
                "isDirectory": info.is_directory,
            })
        }
        HostOperation::List => {
            let path = required_path(&arguments)?;
            let entries = host.list_dir(path).map_err(CallError::from_host)?;
            let mapped: Vec<Value> = entries
                .into_iter()
                .map(|entry| {
                    json!({
                        "name": entry.name,
                        "path": entry.path,
                        "isFile": entry.is_file,
                        "isDirectory": entry.is_directory,
                    })
                })
                .collect();
            json!({ "entries": mapped })
        }
        HostOperation::ReadText => {
            let path = required_path(&arguments)?;
            // `None` (absent, unreadable or refused) crosses as JSON null, which is the
            // `platform.ts` answer the retained nodes' planners already branch on.
            let content = host.read_text(path).map_err(CallError::from_host)?;
            json!({ "path": path, "content": content })
        }
        HostOperation::WriteText => {
            let path = required_path(&arguments)?;
            let content = arguments
                .get("content")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    CallError::Failure("fs.writeText needs a string `content`".to_string())
                })?;
            host.write_text(path, content).map_err(CallError::from_host)?;
            json!({ "path": path, "written": true })
        }
        HostOperation::EnsureDir => {
            let path = required_path(&arguments)?;
            host.ensure_dir(path).map_err(CallError::from_host)?;
            json!({ "path": path, "created": true })
        }
        HostOperation::Move => {
            let source = required_text(&arguments, "source")?;
            let target = required_text(&arguments, "target")?;
            host.move_path(source, target).map_err(CallError::from_host)?;
            json!({ "source": source, "target": target, "moved": true })
        }
        HostOperation::Delete => {
            let path = required_path(&arguments)?;
            let recursive = arguments.get("recursive").and_then(Value::as_bool).unwrap_or(false);
            host.delete_path(path, recursive).map_err(CallError::from_host)?;
            json!({ "path": path, "deleted": true, "recursive": recursive })
        }
        HostOperation::ClockNow => Value::String(host.now().map_err(CallError::from_host)?),
        HostOperation::ProcExec => return exec(&arguments, host, allowed_programs),
        HostOperation::RandomUuid => {
            let mut bytes = [0u8; 16];
            fill_entropy(&mut bytes);
            Value::String(format_uuid(&bytes))
        }
        HostOperation::RandomBytes => {
            let requested = arguments.get("length").and_then(Value::as_u64).unwrap_or(16);
            let length = requested.clamp(1, MAX_RANDOM_BYTES as u64) as usize;
            let mut bytes = vec![0u8; length];
            fill_entropy(&mut bytes);
            Value::String(hex(&bytes))
        }
        HostOperation::OsTmpdir => {
            Value::String(std::env::temp_dir().to_string_lossy().into_owned())
        }
    };
    // Every answer is JSON text, the bare strings included: a shim that parses the result must not
    // have to know which shape each operation happened to use.
    Ok(serialize(&answer))
}

/// Yields at an item boundary, which is what the JS `waitWhilePaused` control asks for.
///
/// `phase` is `&'static str` because [`NodeCheckpointRequest::phase`] is: it names a loop in the
/// *host's* vocabulary, not one a script invented at run time. The three callers below are the whole
/// set, which is what makes the operation log readable across both executors.
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
/// A `Failure` is swallowed — a dropped report is not a failed run, per the seam's `emit` doc — and
/// only a cancel travels back to the bundle.
pub(crate) fn emit_event(host: &mut (dyn NodeHost + 'static), event_json: &str) -> Result<(), CallError> {
    let event = parse_event(event_json)?;
    match host.emit(&event) {
        Ok(()) | Err(NodeHostError::Failure(_)) => Ok(()),
        Err(NodeHostError::Cancelled) => Err(CallError::Cancelled),
    }
}

/// Turns the bundle's `{type, message, progress, data}` event object into the seam's event.
///
/// `nodeRunEventSchema` in `packages/shared/src/index.ts` is the shape. [`ProgressPercent`] refuses
/// values outside 0..=100; a node reporting an impossible percentage is a bug in the node's report,
/// not a reason to end the run, so the percentage is dropped and the line still lands.
fn parse_event(event_json: &str) -> Result<PluginRunEvent, CallError> {
    let value: Value = serde_json::from_str(event_json).map_err(|error| {
        CallError::Failure(format!("onEvent needs a JSON event object: {error}"))
    })?;
    let message = value.get("message").and_then(Value::as_str).unwrap_or_default().to_string();
    // The `data` sidecar is kept as its JSON text. `NativeNodeHost::emit` does not forward a
    // payload to the operation record today, so this is as far as it goes for now.
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

fn exec(
    arguments: &Value,
    host: &mut (dyn NodeHost + 'static),
    allowed_programs: &[&'static str],
) -> Result<String, CallError> {
    let program = required_text(arguments, "program")?;
    // Refused before `argv` is even looked at, and before anything is spawned: that is the whole
    // content of "the gate hangs on the registration, not on the argument string".
    if !allowed_programs.contains(&program) {
        return Err(CallError::Failure(format!(
            "program {program:?} is not in this node's declared process allowlist"
        )));
    }
    // An allowlist entry is a program *name*, resolved by the OS. A path-shaped request could name a
    // different file than the declaration covers, whatever the filesystem then says about it.
    if program.contains('/') || program.contains('\\') {
        return Err(CallError::Failure(format!(
            "allowlist entries are program names, not paths: {program:?}"
        )));
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ExecRequest {
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        cwd: Option<String>,
    }
    let request: ExecRequest = serde_json::from_value(arguments.clone()).map_err(|error| {
        CallError::Failure(format!("proc.exec arguments are not usable: {error}"))
    })?;

    let mut command = std::process::Command::new(program);
    command.args(&request.args);
    if let Some(cwd) = request.cwd.as_deref() {
        // The grant is what says "this directory is ours to run in", and `stat` is the only way the
        // executor can ask. A refused path reads as missing, so an ungranted cwd is refused here
        // rather than handed to the child.
        let info = host.stat(cwd).map_err(CallError::from_host)?;
        if !info.exists || !info.is_directory {
            return Err(CallError::Failure(format!(
                "proc.exec cwd {cwd:?} is not a granted directory"
            )));
        }
        command.current_dir(cwd);
    }
    let output = command.output().map_err(|error| {
        CallError::Failure(format!("proc.exec {program} could not start: {error}"))
    })?;

    let (stdout, stdout_truncated) = decode(&output.stdout);
    let (stderr, stderr_truncated) = decode(&output.stderr);
    Ok(serialize(&json!({
        "exitCode": output.status.code(),
        "signal": signal_of(&output.status),
        "success": output.status.success(),
        "stdout": stdout,
        "stderr": stderr,
        "truncated": stdout_truncated || stderr_truncated,
    })))
}

/// The terminating signal, when the child died by one; `None` where the platform does not report it.
#[cfg(unix)]
fn signal_of(status: &std::process::ExitStatus) -> Option<i32> {
    use std::os::unix::process::ExitStatusExt;
    status.signal()
}

#[cfg(not(unix))]
fn signal_of(_status: &std::process::ExitStatus) -> Option<i32> {
    None
}

fn decode(bytes: &[u8]) -> (String, bool) {
    let truncated = bytes.len() > MAX_PROCESS_OUTPUT_BYTES;
    let slice = &bytes[..bytes.len().min(MAX_PROCESS_OUTPUT_BYTES)];
    (String::from_utf8_lossy(slice).into_owned(), truncated)
}

/// A run-scoped source of id entropy.
///
/// **This is not a CSPRNG, and nothing here may be treated as secret material.** It exists because
/// ADR-0074 §2 says a script must not reach for `Math.random()` for anything the journals record and
/// that the host must be the single supplier; the retained nodes use these values as undo-id suffixes
/// and temp-name bits. Each 8-byte block mixes a fresh `RandomState` (whose keys the OS picks at
/// process start), a process-wide counter and the wall clock, which gives uniqueness without adding
/// an RNG dependency to the workspace. Secret-grade bytes, if a node ever needs them, is a host
/// service behind its own operation — not a stronger function in this file.
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
        let word = state
            .hash_one((tick, clock, position, target.len()))
            .to_le_bytes();
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

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(char::from(DIGITS[usize::from(byte >> 4)]));
        out.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    out
}

fn parse_arguments(raw: &str) -> Result<Value, CallError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    serde_json::from_str(trimmed)
        .map_err(|error| CallError::Failure(format!("host call arguments are not JSON: {error}")))
}

fn required_text<'a>(arguments: &'a Value, key: &str) -> Result<&'a str, CallError> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| {
            CallError::Failure(format!("host call needs a non-empty string `{key}`"))
        })
}

fn required_path(arguments: &Value) -> Result<&str, CallError> {
    required_text(arguments, "path")
}

fn serialize(value: &Value) -> String {
    match serde_json::to_string(value) {
        Ok(text) => text,
        // A `Value` built in this file is always serializable, so this arm means a bug here rather
        // than a machine condition — and it still has to answer JSON, because the shim parses.
        Err(_) => r#"{"serializeError":"the host answer could not be encoded"}"#.to_string(),
    }
}

/// The allowlist as the executor sees it: program names, straight off the registration.
pub(crate) fn allowed_programs(grants: &[ProcessGrant]) -> Vec<&'static str> {
    grants.iter().map(|grant| grant.program).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_host::{CountingHost, SCRIPTED_NOW};
    use xiranite_node_registry::{NodeDirEntry, NodeHostResult, NodePathInfo};

    fn answer(operation: HostOperation, arguments: &str, host: &mut CountingHost) -> String {
        execute(operation, arguments, host, &[]).unwrap_or_else(|error| {
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
                "proc.exec",
                "clock.now",
                "crypto.randomUUID",
                "crypto.randomBytes",
                "os.tmpdir",
            ]
        );
        for name in HostOperation::names() {
            assert_eq!(HostOperation::parse(name).map(HostOperation::as_str), Some(name));
        }
        assert_eq!(HostOperation::parse("fs.readRange"), None, "an invented name must not parse");
    }

    #[test]
    fn every_filesystem_answer_crosses_as_json_with_the_callers_spelling_kept() {
        let mut host = CountingHost::new();
        let stat = answer(HostOperation::Stat, r#"{"path":"/work/a.txt"}"#, &mut host);
        let value: Value = serde_json::from_str(&stat).expect("stat answer is JSON");
        assert_eq!(value["path"], "/work/a.txt", "the caller's spelling must survive");
        assert_eq!(value["exists"], true);
        assert_eq!(host.calls, vec!["stat /work/a.txt".to_string()]);

        let read = answer(HostOperation::ReadText, r#"{"path":"/work/a.txt"}"#, &mut host);
        assert!(read.contains("body of /work/a.txt"), "{read}");

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
        let error = execute(HostOperation::List, r#"{"path":"/outside"}"#, &mut host, &[])
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
            let error = execute(operation, arguments, &mut host, &[])
                .expect_err(&format!("{} must refuse", operation.as_str()));
            assert!(matches!(error, CallError::Failure(_)), "{error:?}");
            assert!(!error.message().is_empty(), "{} refused silently", operation.as_str());
        }
        // The argument check happens before the host call, so a malformed request must not have
        // reached the machine — that is the whole reason the checks are here and not in the shim.
        assert!(host.calls.is_empty(), "a refused call touched the machine: {:?}", host.calls);

        // Positive control: a well-formed call of the same operation does reach it.
        execute(HostOperation::Delete, r#"{"path":"/work/a.txt"}"#, &mut host, &[])
            .expect("a complete delete request answers");
        assert_eq!(host.calls, vec!["delete_path /work/a.txt false".to_string()]);
    }

    #[test]
    fn proc_exec_refuses_a_program_that_is_not_registered() {
        let mut host = CountingHost::new();
        let error = execute(
            HostOperation::ProcExec,
            r#"{"program":"ffmpeg","args":["-version"]}"#,
            &mut host,
            &["7zip"],
        )
        .expect_err("an undeclared program is refused before argv is read");
        assert!(error.message().contains("allowlist"), "{}", error.message());
        assert!(host.calls.is_empty(), "a refusal must not have touched the machine");
    }

    #[test]
    fn proc_exec_refuses_a_path_shaped_program_name() {
        let mut host = CountingHost::new();
        let error = execute(
            HostOperation::ProcExec,
            r#"{"program":"/bin/sh","args":["-c","echo"]}"#,
            &mut host,
            &["/bin/sh"],
        )
        .expect_err("an allowlist entry must not be usable as a path");
        assert!(error.message().contains("program names"), "{}", error.message());
        assert!(host.calls.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn proc_exec_runs_a_registered_program_and_reports_the_exit() {
        let mut host = CountingHost::new();
        let run = execute(
            HostOperation::ProcExec,
            r#"{"program":"printf","args":["hello"]}"#,
            &mut host,
            &["printf"],
        )
        .expect("printf is an allowlisted name here");
        let value: Value = serde_json::from_str(&run).expect("exec answer is JSON");
        assert_eq!(value["stdout"], "hello", "{value}");
        assert_eq!(value["exitCode"], 0, "{value}");
        assert_eq!(value["success"], true, "{value}");
        assert_eq!(value["signal"], Value::Null, "{value}");

        // The positive control for the refusal arms: the same call with the program removed from the
        // list must not run.
        let refused = execute(
            HostOperation::ProcExec,
            r#"{"program":"printf","args":["hello"]}"#,
            &mut host,
            &["not-printf"],
        );
        assert!(refused.is_err(), "a name outside the list still runs: {refused:?}");
    }

    #[cfg(unix)]
    #[test]
    fn proc_exec_refuses_a_working_directory_the_operation_was_not_granted() {
        let mut host = CountingHost::new();
        host.missing_path = Some("/outside/grant".to_string());
        let error = execute(
            HostOperation::ProcExec,
            r#"{"program":"printf","args":["x"],"cwd":"/outside/grant"}"#,
            &mut host,
            &["printf"],
        )
        .expect_err("an ungranted cwd is refused");
        assert!(error.message().contains("granted directory"), "{}", error.message());
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

        // The ceiling is enforced, not advertised: a request for a megabyte yields the cap, so a
        // bundle cannot make the host hold an unbounded buffer.
        let capped = serde_json::from_str::<String>(&answer(
            HostOperation::RandomBytes,
            r#"{"length":100000}"#,
            &mut host,
        ))
        .expect("json");
        assert_eq!(capped.len(), MAX_RANDOM_BYTES * 2, "cap not enforced");
    }

    #[test]
    fn tmpdir_answers_an_absolute_path() {
        let mut host = CountingHost::new();
        let text =
            serde_json::from_str::<String>(&answer(HostOperation::OsTmpdir, "{}", &mut host)).expect("json");
        assert!(!text.trim().is_empty(), "{text}");
        assert!(std::path::Path::new(&text).is_absolute(), "{text}");
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
            polite.calls
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
            fn stat(&mut self, path: &str) -> NodeHostResult<NodePathInfo> {
                self.0.stat(path)
            }
            fn list_dir(&mut self, path: &str) -> NodeHostResult<Vec<NodeDirEntry>> {
                self.0.list_dir(path)
            }
            fn ensure_dir(&mut self, path: &str) -> NodeHostResult<()> {
                self.0.ensure_dir(path)
            }
            fn move_path(&mut self, source: &str, target: &str) -> NodeHostResult<()> {
                self.0.move_path(source, target)
            }
            fn delete_path(&mut self, path: &str, recursive: bool) -> NodeHostResult<()> {
                self.0.delete_path(path, recursive)
            }
            fn read_text(&mut self, path: &str) -> NodeHostResult<Option<String>> {
                self.0.read_text(path)
            }
            fn write_text(&mut self, path: &str, content: &str) -> NodeHostResult<()> {
                self.0.write_text(path, content)
            }
            fn now(&mut self) -> NodeHostResult<String> {
                self.0.now()
            }
            fn emit(&mut self, _event: &PluginRunEvent) -> NodeHostResult<()> {
                Err(NodeHostError::Cancelled)
            }
            fn checkpoint(
                &mut self,
                request: &NodeCheckpointRequest,
            ) -> NodeHostResult<xiranite_plugin_api::CheckpointOutcome> {
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
        // The measurable failure mode of a weak mixer is a repeating block, so the shortest period
        // worth asserting is that no two blocks of one draw are equal.
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
        // `confirm_before_run` is the face's gate, so it must not narrow the executor's list: the
        // assertion that the flagged entry is still present is what catches someone "fixing" it by
        // dropping declared programs at run time.
        assert!(grants[0].confirm_before_run);
    }
}
