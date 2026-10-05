//! The `proc.*` host operations: one waiting exec, and the live child a node can watch.
//!
//! Two shapes of the same permission, and the permission is the interesting part. ADR-0069 hangs the
//! danger gate on the *registration*, not on the argument string, so both arms refuse a program the node
//! did not declare before `argv` is even looked at, and refuse a path-shaped program name whatever the
//! filesystem then says about it. [`crate::host_calls`] owns that gate and the reasoning behind it; this
//! file owns what happens after it passes.
//!
//! ## `proc.exec` versus `proc.spawn`
//!
//! `proc.exec` waits. That is the whole of its contract, and it is fine for the 30+ nodes that shell out
//! once and read the transcript afterwards. Two nodes cannot use it: `bandia` reads Bandizip's progress
//! while the archive runs, and `jellypot` watches a launcher's output to decide when the game is up. For
//! those the host keeps the child in a table ([`crate::machine::ProcessTable`]) and answers incremental
//! text on every `proc.poll`, so a bundle can loop on progress without holding the engine.
//!
//! ## Why the transcript is text
//!
//! A progress log is text; the ceiling is [`MAX_PROCESS_OUTPUT_BYTES`]. A node that needs a child's
//! *bytes* (a tool that writes an archive to stdout) is not in the retained set, and when one arrives the
//! answer is the byte channel `fs.readBytes` already uses — not base64 in this document.
//!
//! ## The cancellation rule
//!
//! A child outliving its run is a leaked process in the desktop host, so the run that started it owns it:
//! [`crate::machine::ProcessTable`]'s `Drop` kills and reaps whatever is still live. `proc.kill` is the
//! node's own arm of the same mechanism, and `proc.wait` is bounded by the run's deadline rather than a
//! per-call timeout, so a node cannot park the pump forever on a child that never exits.

use serde::Deserialize;
use serde_json::{Value, json};
use xiranite_node_registry::NodeHost;

use crate::host_calls::{CallError, HostAnswer, HostOperation, MAX_PROCESS_OUTPUT_BYTES};
use crate::machine::{MachineAccess, lock_table};

/// The largest transcript one `proc.poll` window answers.
///
/// A poll window is a *slice* of a live log, so it gets a quarter of `proc.exec`'s ceiling: a node that
/// reads 1 MiB of progress in one round is doing something other than showing progress.
const MAX_POLL_WINDOW_BYTES: usize = MAX_PROCESS_OUTPUT_BYTES / 4;

/// Runs one `proc.*` operation.
pub(crate) fn execute(
    operation: HostOperation,
    arguments: &Value,
    host: &mut (dyn NodeHost + 'static),
    allowed_programs: &[&'static str],
    machine: &MachineAccess,
) -> Result<HostAnswer, CallError> {
    let name = operation.as_str();
    match operation {
        HostOperation::ProcExec => {
            let request = program_request(arguments, name, allowed_programs, host)?;
            exec(&request)
        }
        HostOperation::ProcSpawn => {
            let request = program_request(arguments, name, allowed_programs, host)?;
            let (handle, pid) = lock_table(machine.processes()).spawn(
                &request.program,
                &request.args,
                request.cwd.as_deref(),
            )?;
            Ok(crate::host_calls::answer(json!({ "handle": handle, "pid": pid, "program": request.program })))
        }
        HostOperation::ProcPoll | HostOperation::ProcWait => {
            let handle = handle(arguments, name)?;
            let since = arguments.get("since").and_then(Value::as_u64).unwrap_or(0) as usize;
            let mut table = lock_table(machine.processes());
            let report = if operation == HostOperation::ProcPoll {
                table.poll(handle, since)?
            } else {
                table.wait(handle, since)?
            };
            Ok(crate::host_calls::answer(truncate_window(report.to_json())))
        }
        HostOperation::ProcKill => {
            let handle = handle(arguments, name)?;
            let killed = lock_table(machine.processes()).kill(handle)?;
            Ok(crate::host_calls::answer(json!({ "handle": handle, "killed": killed })))
        }
        other => Err(CallError::Failure(format!("{} is not a process operation", other.as_str()))),
    }
}

/// What a `proc.exec` / `proc.spawn` call asked for, after every permission check.
#[derive(Debug)]
struct ProgramRequest {
    program: String,
    args: Vec<String>,
    /// A working directory the operation was already granted, or `None`.
    cwd: Option<String>,
}

/// The two arguments `program_request` has to look at as data rather than as single strings.
///
/// `program` is deliberately NOT a field: the gate reads it once, through `required_text`, before `argv`
/// is deserialized at all, so a second copy here would be a second source of truth for the allowlist
/// check — the one drift the gate exists to prevent.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProgramFields {
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    cwd: Option<String>,
}

/// The gate, in one place for both arms.
///
/// Refusals happen before anything is spawned and before `argv` is read, which is what "the allowlist is
/// the permission boundary" has to mean: a declared program name is the only thing that can start.
fn program_request(
    arguments: &Value,
    operation: &str,
    allowed_programs: &[&'static str],
    host: &mut (dyn NodeHost + 'static),
) -> Result<ProgramRequest, CallError> {
    let program = crate::host_calls::required_text(arguments, "program")?.to_string();
    if !allowed_programs.contains(&program.as_str()) {
        return Err(CallError::Failure(format!(
            "program {program:?} is not in this node's declared process allowlist"
        )));
    }
    // An allowlist entry is a program *name*, resolved by the OS. A path-shaped request could name a
    // different file than the declaration covers.
    if program.contains('/') || program.contains('\\') {
        return Err(CallError::Failure(format!(
            "allowlist entries are program names, not paths: {program:?}"
        )));
    }
    let fields: ProgramFields = serde_json::from_value(arguments.clone())
        .map_err(|error| CallError::Failure(format!("{operation} arguments are not usable: {error}")))?;
    let cwd = match fields.cwd.as_deref() {
        None => None,
        Some(directory) => {
            // The grant is what says "this directory is ours to run in", and `stat` is the only way the
            // executor can ask. A refused path reads as missing, so an ungranted directory is refused here
            // rather than handed to the child.
            let info = host.stat(directory).map_err(CallError::from_host)?;
            if !info.exists || !info.is_directory {
                return Err(CallError::Failure(format!(
                    "{operation} cwd {directory:?} is not a granted directory"
                )));
            }
            Some(directory.to_string())
        }
    };
    Ok(ProgramRequest { program, args: fields.args, cwd })
}

/// One waiting run of a declared program, transcript and exit included.
fn exec(request: &ProgramRequest) -> Result<HostAnswer, CallError> {
    let mut command = std::process::Command::new(&request.program);
    command.args(&request.args);
    if let Some(cwd) = request.cwd.as_deref() {
        command.current_dir(cwd);
    }
    let output = command.output().map_err(|error| {
        CallError::Failure(format!("proc.exec {} could not start: {error}", request.program))
    })?;
    let (stdout, stdout_truncated) = decode(&output.stdout);
    let (stderr, stderr_truncated) = decode(&output.stderr);
    Ok(crate::host_calls::answer(json!({
        "exitCode": output.status.code(),
        "signal": signal_of(&output.status),
        "success": output.status.success(),
        "stdout": stdout,
        "stderr": stderr,
        "truncated": stdout_truncated || stderr_truncated,
    })))
}

/// Caps one poll window and says it did, so a chatty child cannot make the answer unbounded.
fn truncate_window(mut document: Value) -> Value {
    let truncated = document.get("truncated").and_then(Value::as_bool).unwrap_or(false);
    let mut window_cut = false;
    for key in ["stdout", "stderr"] {
        if let Some(text) = document.get(key).and_then(Value::as_str)
            && text.len() > MAX_POLL_WINDOW_BYTES
        {
            let cut = floor_to_char_boundary(text, MAX_POLL_WINDOW_BYTES);
            document[key] = Value::String(text[..cut].to_string());
            window_cut = true;
        }
    }
    document["truncated"] = Value::Bool(truncated || window_cut);
    document
}

/// The largest byte index `<= wanted` that is not in the middle of a UTF-8 sequence.
fn floor_to_char_boundary(text: &str, wanted: usize) -> usize {
    let mut index = wanted.min(text.len());
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

fn handle(arguments: &Value, operation: &str) -> Result<u64, CallError> {
    arguments
        .get("handle")
        .and_then(Value::as_u64)
        .ok_or_else(|| CallError::Failure(format!("{operation} needs the number `handle` from proc.spawn")))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host_calls::HostOperation;
    use crate::test_host::CountingHost;

    fn answer(
        operation: HostOperation,
        arguments: &str,
        allowed: &[&'static str],
        machine: &MachineAccess,
    ) -> String {
        let parsed: Value = serde_json::from_str(arguments).expect("test arguments are JSON");
        let mut host = CountingHost::new();
        match execute(operation, &parsed, &mut host, allowed, machine) {
            Ok(HostAnswer::Text(text)) => text,
            Ok(HostAnswer::Bytes(_)) => panic!("a process operation answered bytes"),
            Err(error) => panic!("{} refused: {}", operation.as_str(), error.message()),
        }
    }

    fn refused(
        operation: HostOperation,
        arguments: &str,
        allowed: &[&'static str],
    ) -> String {
        let parsed: Value = serde_json::from_str(arguments).expect("test arguments are JSON");
        let mut host = CountingHost::new();
        execute(operation, &parsed, &mut host, allowed, &MachineAccess::seam_only())
            .expect_err("the call was expected to be refused")
            .message()
            .to_string()
    }

    #[test]
    fn an_undeclared_program_is_refused_by_spawn_exactly_as_by_exec() {
        // The point of sharing one gate: a second entry point must not become a second way around it.
        for operation in [HostOperation::ProcExec, HostOperation::ProcSpawn] {
            let message = refused(
                operation,
                r#"{"program":"ffmpeg","args":["-i","in.mp4"]}"#,
                &["7zip"],
            );
            assert!(message.contains("allowlist"), "{} said: {message}", operation.as_str());
        }
    }

    #[test]
    fn a_path_shaped_program_name_is_refused_even_when_it_is_the_declared_one() {
        for operation in [HostOperation::ProcExec, HostOperation::ProcSpawn] {
            let message = refused(
                operation,
                r#"{"program":"/bin/sh","args":["-c","echo"]}"#,
                &["/bin/sh"],
            );
            assert!(message.contains("program names"), "{} said: {message}", operation.as_str());
        }
    }

    #[test]
    fn a_poll_without_a_handle_names_what_it_needed() {
        let message = refused(HostOperation::ProcPoll, "{}", &[]);
        assert!(message.contains("handle"), "{message}");
        let message = refused(HostOperation::ProcKill, r#"{"handle":"7"}"#, &[]);
        assert!(message.contains("handle"), "{message}");
    }

    #[cfg(unix)]
    #[test]
    fn a_spawned_child_reports_its_handle_and_the_other_arms_read_it() {
        let machine = MachineAccess::seam_only();
        let spawned: Value =
            serde_json::from_str(&answer(HostOperation::ProcSpawn, r#"{"program":"printf","args":["tick"]}"#, &["printf"], &machine))
                .expect("spawn is JSON");
        assert_eq!(spawned["program"], "printf");
        let handle = spawned["handle"].as_u64().expect("a handle");
        assert!(spawned["pid"].as_u64().expect("a pid") > 0);

        // Read until the child has been reaped. A `yield_now` spin measured too short on this machine
        // (200 rounds with a child that had not even been scheduled yet), so each round waits 5 ms and
        // the loop stays bounded — a broken arm fails the test rather than hanging it.
        let mut document = Value::Null;
        for _ in 0..400 {
            document = serde_json::from_str(&answer(
                HostOperation::ProcPoll,
                &json!({ "handle": handle, "since": 0 }).to_string(),
                &["printf"],
                &machine,
            ))
            .expect("poll is JSON");
            if document["running"] == false {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        assert_eq!(document["running"], false, "printf exits: {document}");
        assert_eq!(document["exitCode"], 0, "{document}");
        assert_eq!(document["stdout"], "tick", "{document}");
        assert_eq!(document["success"], true, "{document}");

        let waited = serde_json::from_str::<Value>(&answer(
            HostOperation::ProcWait,
            &json!({ "handle": handle, "since": document["stdoutOffset"].as_u64().unwrap_or(0) }).to_string(),
            &["printf"],
            &machine,
        ))
        .expect("wait is JSON");
        assert_eq!(waited["stdout"], "", "waiting after a full read must not repeat the transcript");
        assert_eq!(waited["running"], false);
    }

    #[cfg(unix)]
    #[test]
    fn killing_a_child_stops_it_and_the_table_reaps_everything_the_run_left() {
        let machine = MachineAccess::seam_only();
        let spawned: Value = serde_json::from_str(&answer(
            HostOperation::ProcSpawn,
            r#"{"program":"sleep","args":["30"]}"#,
            &["sleep"],
            &machine,
        ))
        .expect("spawn");
        let handle = spawned["handle"].as_u64().expect("handle");
        let pid = u32::try_from(spawned["pid"].as_u64().expect("pid")).expect("a real pid");
        let killed: Value = serde_json::from_str(&answer(
            HostOperation::ProcKill,
            &json!({ "handle": handle }).to_string(),
            &["sleep"],
            &machine,
        ))
        .expect("kill");
        assert_eq!(killed["killed"], true, "{killed}");
        let poll = serde_json::from_str::<Value>(&answer(
            HostOperation::ProcPoll,
            &json!({ "handle": handle }).to_string(),
            &["sleep"],
            &machine,
        ))
        .expect("poll after kill");
        assert_eq!(poll["running"], false, "{poll}");
        assert!(poll["signal"].is_number() || poll["exitCode"].is_number(), "a killed child reports why it stopped: {poll}");
        // The process is gone from the machine's own point of view, not just from the table.
        assert!(!process_alive(pid), "pid {pid} outlived the run that started it");
    }

    /// Whether the OS still has a process slot for `pid`.
    ///
    /// `kill -0` through `/usr/bin/kill` measured backwards on this machine (it reported a freshly
    /// started `sleep` as gone), so the gauge is `ps -p`, which is checked both ways by
    /// [`a_liveness_gauge_sees_a_live_process`].
    #[cfg(unix)]
    fn process_alive(pid: u32) -> bool {
        std::process::Command::new("ps")
            .args(["-p", &pid.to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok_and(|code| code.success())
    }

    #[cfg(unix)]
    #[test]
    fn a_liveness_gauge_sees_a_live_process() {
        // Positive control first: an assertion that "the child is gone" means nothing until the same
        // call has been shown to say "alive" about a process that is certainly running.
        assert!(process_alive(std::process::id()), "this test process must read alive");
        assert!(!process_alive(4_294_967_295), "a pid nobody owns must read gone");
    }

    #[test]
    fn a_poll_window_is_capped_and_says_so() {
        let big = "x".repeat(MAX_POLL_WINDOW_BYTES + 100);
        let document = truncate_window(json!({ "stdout": big.clone(), "stderr": "", "truncated": false }));
        assert_eq!(
            document["stdout"].as_str().expect("text").len(),
            MAX_POLL_WINDOW_BYTES,
            "the window ceiling is enforced, not advertised"
        );
        assert_eq!(document["truncated"], true, "and the truncation is reported");

        // Multi-byte safety: cutting at a byte index must not split a character.
        let unicode = "あ".repeat(MAX_POLL_WINDOW_BYTES / 3 + 8);
        let cut = truncate_window(json!({ "stdout": unicode, "stderr": "", "truncated": false }));
        let text = cut["stdout"].as_str().expect("text");
        assert!(std::str::from_utf8(text.as_bytes()).is_ok(), "the window boundary stays on a character");
    }

    #[test]
    fn the_char_boundary_floor_walks_back_off_a_split() {
        let text = "abcdé"; // 'é' is two bytes, starting at index 4.
        assert_eq!(floor_to_char_boundary(text, 5), 4, "a split inside the two-byte letter walks back");
        assert_eq!(floor_to_char_boundary(text, 6), 6);
        assert_eq!(floor_to_char_boundary(text, 100), text.len(), "a wanted index past the end clamps");
        assert_eq!(floor_to_char_boundary("", 3), 0);
    }
}
