//! The machine surface a run may reach *besides* [`NodeHost`]'s ten methods, and the children it opened.
//!
//! ## Why the seam is not enough
//!
//! [`NodeHost`] is the contract the ported native nodes were written against: documents in, kinds out.
//! It carries no byte channel (a base64 payload inside a JSON document is ADR-0071's retired failure mode,
//! restated in AGENTS.md), no size or time on `stat`, no temp directory, no link family, and no child
//! process that is still running. A scripted node needs all of that on day one — the first real node
//! bundles proved it (`synct`/`timeu`/`enginev` read `sizeBytes`/`mtimeMs`, 15+ platform closures call
//! `mkdtemp`, `linku` calls `link`/`symlink`/`realpath`, two nodes read a child's live progress).
//!
//! So the run is handed a second object: the **same** [`FileCapability`] the host was built over, taken
//! out through [`xiranite_native_host::NativeNodeHost::files`] rather than a second copy of the policy.
//! Authorization therefore has exactly one source; this type only adds the primitives the seam cannot
//! express.
//!
//! ## The `SeamOnly` arm exists, and is not a workaround
//!
//! A node run through [`crate::JsNode`] as a [`xiranite_node_registry::BuiltInNode`] receives
//! `&mut dyn NodeHost` and *nothing else* — the seam's signature is not this crate's to widen. Until the
//! runtime's launcher passes the grant alongside the host (a one-line change at
//! `crates/xiranite-node-runtime/src/launcher.rs:100`, where `files` is already in scope), such a run gets
//! [`MachineAccess::seam_only`] and every widened operation refuses *by name*, saying which wiring would
//! answer it. A silent `0` for a size nobody read, or an empty buffer for a file nobody opened, would be
//! worse: it would be a wrong answer instead of a missing one.
//!
//! ## Why the child-process table lives here
//!
//! `proc.spawn` hands back a handle to a process that is still running. Handles have to be owned by
//! somebody, and the only owner with the right lifetime is the run: when the run ends — settled,
//! cancelled, or failed — whatever the node left running must stop running too. That is
//! [`ProcessTable`]’s `Drop`, and it is why the table is an `Arc<Mutex<..>>` shared between the JS
//! callbacks and the pump rather than a field of either.

use std::collections::HashMap;
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use xiranite_core::filesystem::FileCapability;

use crate::host_calls::CallError;

/// The largest captured output of one live child, per stream.
///
/// The same reasoning as [`crate::host_calls::MAX_PROCESS_OUTPUT_BYTES`]: a node that shells out to a
/// tool with a 200 MiB transcript must not be able to hold it in the host's heap, and a progress log a
/// nobody reads to the end is not data the node planned on.
pub(crate) const MAX_LIVE_CHILD_OUTPUT_BYTES: usize = 4 * 1024 * 1024;

/// The widened machine access one run owns.
#[derive(Clone)]
pub(crate) struct MachineAccess {
    /// The operation's grant, or `None` when the run came in through the seam alone.
    files: Option<FileCapability>,
    /// Every child this run started, keyed by the handle the bundle was given.
    processes: Arc<Mutex<ProcessTable>>,
    /// The host services this node declared, copied off its `NodeDescriptor`.
    ///
    /// It rides on the machine rather than on the call arguments because the answer belongs to the
    /// registration: a bundle naming a service it never asked for is refused, the same way an
    /// undeclared program is refused before its argv is read.
    services: &'static [&'static str],
}

impl MachineAccess {
    /// A run that carries the operation's grant: every widened operation can be answered.
    #[must_use]
    pub fn granted(files: FileCapability) -> Self {
        Self { files: Some(files), processes: Arc::new(Mutex::new(ProcessTable::default())), services: &[] }
    }

    /// A run that only has [`NodeHost`]. Widened operations refuse; see the module header.
    #[must_use]
    pub fn seam_only() -> Self {
        Self::granted_in_place(None)
    }

    /// The one construction, so the two arms cannot disagree about the process table.
    fn granted_in_place(files: Option<FileCapability>) -> Self {
        Self { files, processes: Arc::new(Mutex::new(ProcessTable::default())), services: &[] }
    }

    /// Attaches the services this node declared. Returns `self` so the engine can chain it onto the
    /// machine it builds once per run.
    #[must_use]
    pub const fn with_services(mut self, services: &'static [&'static str]) -> Self {
        self.services = services;
        self
    }

    /// Whether this node may call `service` at all.
    #[must_use]
    pub fn declares_service(&self, service: &str) -> bool {
        let mut index = 0;
        while index < self.services.len() {
            if self.services[index] == service {
                return true;
            }
            index += 1;
        }
        false
    }

    /// The declared services, for the refusal text that has to name what the node *can* call.
    #[must_use]
    pub const fn declared_services(&self) -> &'static [&'static str] {
        self.services
    }

    /// The grant, or the named refusal that says which wiring would supply it.
    ///
    /// `operation` is the wire name so the bundle's error text names the call it made rather than an
    /// internal type.
    pub(crate) fn files(&self, operation: &str) -> Result<&FileCapability, CallError> {
        self.files.as_ref().ok_or_else(|| CallError::Failure(format!("{operation} needs the operation's granted filesystem, and this run was started with the NodeHost seam alone. Build it with Executor::with_files(..) / MachineAccess::granted(..).")))
    }

    /// The grant, or `None` when the run came in through the seam alone.
    ///
    /// For the one operation that has a *narrower* honest answer on the seam — `fs.stat`, whose four
    /// fields `NodeHost` does carry — rather than no answer at all.
    #[must_use]
    pub(crate) fn capability(&self) -> Option<&FileCapability> {
        self.files.as_ref()
    }

    /// The child-process table, shared with the pump and the JS callbacks.
    #[must_use]
    pub(crate) fn processes(&self) -> &Arc<Mutex<ProcessTable>> {
        &self.processes
    }
}

/// One live child and the two threads draining it.
pub(crate) struct LiveChild {
    /// Held so the run can `wait` on it and so dropping the table can kill it.
    child: Child,
    /// The program name, for the error text a node sees.
    program: String,
    /// Cumulative stdout, capped at [`MAX_LIVE_CHILD_OUTPUT_BYTES`].
    stdout: Arc<Mutex<Captured>>,
    /// Cumulative stderr, same ceiling.
    stderr: Arc<Mutex<Captured>>,
    /// The reader threads. Joined when the child is reaped so a run never leaves a thread behind.
    readers: Vec<std::thread::JoinHandle<()>>,
}

/// A capped byte transcript, with the offset a caller has already consumed.
#[derive(Default)]
pub(crate) struct Captured {
    bytes: Vec<u8>,
    overflowed: bool,
}

impl Captured {
    /// Appends until the ceiling, then records that output was dropped rather than pretending it was
    /// the whole transcript.
    fn push(&mut self, chunk: &[u8]) {
        let room = MAX_LIVE_CHILD_OUTPUT_BYTES.saturating_sub(self.len());
        let take = room.min(chunk.len());
        self.bytes.extend_from_slice(&chunk[..take]);
        if take < chunk.len() {
            self.overflowed = true;
        }
    }

    #[must_use]
    fn text_from(&self, offset: usize) -> (String, usize, bool) {
        let end = self.len();
        let slice = &self.bytes[offset.min(end)..];
        (String::from_utf8_lossy(slice).into_owned(), end, self.overflowed)
    }

    #[must_use]
    fn len(&self) -> usize {
        self.bytes.len()
    }
}

/// The children one run started.
#[derive(Default)]
pub(crate) struct ProcessTable {
    children: HashMap<u64, LiveChild>,
    next_handle: u64,
}

impl ProcessTable {
    /// Starts `program` with `argv`, piped on both streams, and answers `(handle, pid)`.
    ///
    /// The allowlist check is the caller's (`host_calls` owns it, because the gate belongs to the
    /// registration and not to this file), so this function assumes `program` was declared.
    ///
    /// # Errors
    ///
    /// A refusal carrying the OS cause when the child could not be started.
    pub(crate) fn spawn(
        &mut self,
        program: &str,
        argv: &[String],
        cwd: Option<&str>,
    ) -> Result<(u64, u32), CallError> {
        let mut command = Command::new(program);
        command.args(argv).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        if let Some(directory) = cwd {
            command.current_dir(directory);
        }
        let mut child = command.spawn().map_err(|error| {
            CallError::Failure(format!("proc.spawn {program} could not start: {error}"))
        })?;
        let pid = child.id();
        // `take` twice: the pipes are moved into the reader threads, and a child with a dropped pipe
        // would block on its first write once both handles are gone.
        let stdout = Arc::new(Mutex::new(Captured::default()));
        let stderr = Arc::new(Mutex::new(Captured::default()));
        let mut readers = Vec::new();
        attach_reader(child.stdout.take(), Arc::clone(&stdout), &mut readers);
        attach_reader(child.stderr.take(), Arc::clone(&stderr), &mut readers);
        self.next_handle += 1;
        let handle = self.next_handle;
        self.children.insert(
            handle,
            LiveChild { child, program: program.to_string(), stdout, stderr, readers },
        );
        Ok((handle, pid))
    }

    /// Reports a child's state and the transcript text a caller has not consumed yet.
    ///
    /// `since` is the byte offset the caller read up to last time, which is what makes a progress reader
    /// cheap: it never re-reads the log. The child is reaped here (`try_wait`), never from a thread, so
    /// `exitCode` is available the moment the OS reports it.
    pub(crate) fn poll(&mut self, handle: u64, since: usize) -> Result<PollReport, CallError> {
        // `lookup_mut` because reaping is a mutation: `try_wait` takes `&mut Child`.
        let child = self.lookup_mut(handle)?;
        // Named in the refusal, because "the exit could not be read" without the program is a message
        // nobody can act on when a run has several children live.
        let program = child.program.as_str();
        let exit = child
            .child
            .try_wait()
            .map_err(|error| CallError::Failure(format!("proc.poll of {program} could not read the exit: {error}")))?;
        let (stdout, stdout_end, stdout_cut) = child.stdout_text(since);
        let (stderr, stderr_end, stderr_cut) = child.stderr_text(since);
        Ok(PollReport {
            running: exit.is_none(),
            exit_code: exit.and_then(|status| status.code()),
            signal: exit.as_ref().and_then(signal_of),
            success: exit.map(|status| status.success()),
            stdout,
            stderr,
            stdout_offset: stdout_end,
            stderr_offset: stderr_end,
            truncated: stdout_cut || stderr_cut,
        })
    }

    /// Waits for a child to finish and answers the same report as [`crate::host_calls`]’s `proc.exec`.
    ///
    /// Waiting is bounded by the pump's own deadline rather than a per-call timeout, so a node that asks
    /// to wait cannot outlive the run that asked.
    pub(crate) fn wait(&mut self, handle: u64, since: usize) -> Result<PollReport, CallError> {
        let child = self.lookup_mut(handle)?;
        let status = child
            .child
            .wait()
            .map_err(|error| CallError::Failure(format!("proc.wait could not wait: {error}")))?;
        for reader in child.readers.drain(..) {
            // A reader only stops once the pipe closes, which `wait` has just guaranteed.
            let _ = reader.join();
        }
        let exit_code = status.code();
        let signal = signal_of(&status);
        let (stdout, stdout_end, stdout_cut) = child.stdout_text(since);
        let (stderr, stderr_end, stderr_cut) = child.stderr_text(since);
        Ok(PollReport {
            running: false,
            exit_code,
            signal,
            success: Some(status.success()),
            stdout,
            stderr,
            stdout_offset: stdout_end,
            stderr_offset: stderr_end,
            truncated: stdout_cut || stderr_cut,
        })
    }

    /// Kills a child. The run owns the process, so asking it to stop is never a refusal.
    pub(crate) fn kill(&mut self, handle: u64) -> Result<bool, CallError> {
        let child = self.lookup_mut(handle)?;
        let killed = child.child.kill().is_ok();
        // Reap so the child does not linger as a zombie between `kill` and the end of the run.
        let _ = child.child.wait();
        Ok(killed)
    }

    /// Stops every child the run still owns, which is what `Drop` does when the run ends.
    fn shutdown(&mut self) {
        for child in self.children.values_mut() {
            let _ = child.child.kill();
            let _ = child.child.wait();
        }
        self.children.clear();
    }

    fn lookup_mut(&mut self, handle: u64) -> Result<&mut LiveChild, CallError> {
        self.children
            .get_mut(&handle)
            .ok_or_else(|| CallError::Failure(format!("no child process is live under handle {handle}")))
    }
}

impl Drop for ProcessTable {
    fn drop(&mut self) {
        // The failure mode this exists for: a node spawns a child, then its run is cancelled or throws.
        // Without this arm the child outlives the operation and the host process accumulates whoever
        // `bandia`/`jellypot` launched.
        self.shutdown();
    }
}

impl LiveChild {
    fn stdout_text(&self, since: usize) -> (String, usize, bool) {
        lock_captured(&self.stdout).text_from(since)
    }

    fn stderr_text(&self, since: usize) -> (String, usize, bool) {
        lock_captured(&self.stderr).text_from(since)
    }
}

/// Locks one transcript. A poisoned mutex here means a reader thread panicked on a closed pipe, and the
/// bytes already captured are still the answer the node should see.
fn lock_captured(sink: &Arc<Mutex<Captured>>) -> MutexGuard<'_, Captured> {
    sink.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Reads one pipe into the shared transcript until it closes, on its own thread.
///
/// The thread is the whole point: a child that writes more than a pipe buffer would otherwise block
/// with nobody draining it, which is exactly how a "live progress" reader deadlocks against a tool that
/// prints a lot. The join handle is kept so `wait` and the table's `Drop` cannot leave one behind.
fn attach_reader<R>(pipe: Option<R>, sink: Arc<Mutex<Captured>>, readers: &mut Vec<std::thread::JoinHandle<()>>)
where
    R: Read + Send + 'static,
{
    let Some(mut pipe) = pipe else { return };
    readers.push(std::thread::spawn(move || {
        let mut buffer = [0u8; 8 * 1024];
        loop {
            match pipe.read(&mut buffer) {
                // `Ok(0)` is end of pipe and `Err` is a closed or broken descriptor; both mean this
                // stream is finished, and neither is a reason to fail the run.
                Ok(0) | Err(_) => return,
                Ok(read) => lock_captured(&sink).push(&buffer[..read]),
            }
        }
    }));
}

/// The terminating signal, when the child died by one.
#[cfg(unix)]
fn signal_of(status: &std::process::ExitStatus) -> Option<i32> {
    use std::os::unix::process::ExitStatusExt;
    status.signal()
}

#[cfg(not(unix))]
fn signal_of(_status: &std::process::ExitStatus) -> Option<i32> {
    None
}

/// What `proc.poll` and `proc.wait` answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PollReport {
    running: bool,
    exit_code: Option<i32>,
    signal: Option<i32>,
    success: Option<bool>,
    stdout: String,
    stderr: String,
    stdout_offset: usize,
    stderr_offset: usize,
    truncated: bool,
}

impl PollReport {
    /// The wire document. `stdout`/`stderr` are the *new* text since the offset the caller passed, and
    /// `stdoutOffset`/`stderrOffset` are what it should pass next time — one pair of numbers, so a
    /// progress reader cannot re-read the log by accident.
    #[must_use]
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "running": self.running,
            "exitCode": self.exit_code,
            "signal": self.signal,
            "success": self.success,
            "stdout": self.stdout,
            "stderr": self.stderr,
            "stdoutOffset": self.stdout_offset,
            "stderrOffset": self.stderr_offset,
            "truncated": self.truncated,
        })
    }
}

/// Locks the table, recovering from a poisoned mutex the way the rest of the crate does: the table is
/// still well-formed after a node callback panicked, and dropping a child would leak a process.
pub(crate) fn lock_table(table: &Arc<Mutex<ProcessTable>>) -> MutexGuard<'_, ProcessTable> {
    table.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn a_seam_only_run_refuses_by_naming_the_wiring_that_would_answer() {
        let machine = MachineAccess::seam_only();
        assert!(machine.capability().is_none(), "the seam-only arm carries no grant");
        let error = machine
            .files("fs.readBytes")
            .expect_err("no grant means no bytes");
        assert!(error.message().contains("fs.readBytes"), "{}", error.message());
        assert!(error.message().contains("MachineAccess::granted"), "{}", error.message());
    }

    #[test]
    fn a_granted_run_answers_with_the_same_capability_it_was_given() {
        let directory = std::env::temp_dir();
        let files = FileCapability::new([directory.as_path()]);
        let machine = MachineAccess::granted(files);
        assert!(machine.capability().is_some(), "the run answers with the grant it was handed");
        assert!(
            !machine.files("fs.mkdtemp").expect("granted").roots().is_empty(),
            "a grant built over a real directory must not read as empty"
        );
    }

    #[test]
    fn a_captured_transcript_stops_at_its_ceiling_and_says_so() {
        let mut captured = Captured::default();
        let chunk = vec![b'a'; 1024];
        captured.push(&chunk);
        assert_eq!(captured.len(), 1024);
        let (text, end, truncated) = captured.text_from(512);
        assert_eq!(text.len(), 512, "the caller gets what it has not read yet");
        assert_eq!(end, 1024, "and the offset to ask for next");
        assert!(!truncated);

        // The ceiling arm, measured rather than asserted in the abstract: fill past it and the extra
        // bytes are dropped with the flag set.
        let mut flooded = Captured::default();
        let big = vec![b'b'; MAX_LIVE_CHILD_OUTPUT_BYTES + 10];
        flooded.push(&big);
        assert_eq!(flooded.len(), MAX_LIVE_CHILD_OUTPUT_BYTES);
        assert!(flooded.text_from(0).2, "overflow must be reported, not hidden");
    }

    #[cfg(unix)]
    #[test]
    fn a_spawned_child_is_reported_and_reaped() {
        let table = Arc::new(Mutex::new(ProcessTable::default()));
        let (handle, pid) = lock_table(&table)
            .spawn("printf", &["hello".to_string()], None)
            .expect("printf starts");
        assert!(pid > 0, "the child reports a pid");
        // Poll until the child has exited, without a fixed sleep: the loop is bounded by the test's own
        // patience budget and ends as soon as the OS says so.
        let mut report = lock_table(&table).poll(handle, 0).expect("poll answers");
        for _ in 0..400 {
            if !report.running {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
            report = lock_table(&table).poll(handle, 0).expect("poll answers again");
        }
        assert!(!report.running, "printf exits on its own: {report:?}");
        assert_eq!(report.exit_code, Some(0), "{report:?}");
        assert_eq!(report.stdout, "hello", "the transcript is what the child wrote");
        assert!(report.stdout_offset > 0);
        let again = lock_table(&table).poll(handle, report.stdout_offset).expect("second poll");
        assert_eq!(again.stdout, "", "a second read at the reported offset reads nothing twice");
    }

    #[cfg(unix)]
    #[test]
    fn dropping_the_table_stops_a_child_the_run_never_waited_for() {
        let table = Arc::new(Mutex::new(ProcessTable::default()));
        let (handle, pid) = lock_table(&table)
            .spawn("sleep", &["30".to_string()], None)
            .expect("sleep starts");
        // The handle is real and the process exists before the drop.
        assert!(lock_table(&table).poll(handle, 0).expect("poll").running);
        drop(table);
        let exited = wait_for_exit(pid);
        assert!(exited, "the run's end must stop the child it left running (pid {pid})");
    }

    /// Whether the OS has released `pid`, read from `ps -p` rather than from a guess about timing.
    ///
    /// `kill -0` through `/usr/bin/kill` measured backwards here (it reported a freshly started `sleep`
    /// as gone), and `ps` is the call the positive control in
    /// `proc_operations::a_liveness_gauge_sees_a_live_process` checks the same way.
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
    fn wait_for_exit(pid: u32) -> bool {
        for _ in 0..200 {
            if !process_alive(pid) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        false
    }

    #[test]
    fn an_unknown_handle_is_a_refusal_naming_it() {
        let table = Arc::new(Mutex::new(ProcessTable::default()));
        let error = lock_table(&table).poll(4_242, 0).expect_err("nothing is live under 4242");
        assert!(error.message().contains("4242"), "{}", error.message());
    }
}
