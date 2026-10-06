//! The node's borrowed engine as a child process the **run** owns (ADR-0077).
//!
//! ## Why a child at all, and why the run owns it
//!
//! `findz`'s index core is Go (`native/findz-go`), and a QuickJS realm cannot reach one: the
//! machine surface is a closed set of operations (`crate::host_calls::HostOperation`) with no
//! socket, no timer, no worker and no way to load a native module, so `bun:ffi` and `koffi` are
//! both out of the room. The face processes could spawn it but must not — ADR-0074 §5 refuses a
//! second engine inside a face, and a GUI renderer cannot spawn anything anyway.
//!
//! So the host spawns it, and the run owns it. That scope is the whole design: a child that
//! lives exactly as long as the run that started it cannot leak across runs, which is the
//! failure mode `crate::machine::ProcessTable` already guards against for `bandia`/`jellypot`.
//! A host-session-scoped pool was rejected in ADR-0077 because what it saves — one 14–47 ms
//! start per run, measured on 2026-10-05 — is not worth a table that can leak.
//!
//! ## Why line framing instead of MCP
//!
//! One request per line in, one response per line out, and the envelope
//! `native/findz-go/protocol.go` already speaks (`requestVersion`/`requestId`/`method`/`params`
//! answered by `ok`/`result`/`error{code,message,retryable,details}`). ADR-0077 measured the
//! alternative: `rmcp` would add three crates plus a current-thread runtime per session, and the
//! layer it offers — version negotiation and capability checking — this envelope already
//! implements. Dispatch here is synchronous, so waiting uses `crossbeam`'s `recv_timeout`, the
//! same primitive `crate::czkawka_operations` uses to keep the pump in charge of a long wait.
//!
//! ## Why frames are matched by order
//!
//! The write half is held under one lock and the core answers one request per line
//! (`native/findz-go/serve.go`), so a response always answers the request before it.
//! `requestId` therefore stays what it was in the C ABI — an idempotency key the core replays a
//! mutation receipt on (`service.go`'s `dispatchMutation`) — not a correlation key.
//!
//! ## Why the process group, not just the child
//!
//! `std::process::Child::kill` does not kill descendants, and dropping a `Child` neither kills
//! nor reaps. `process-wrap`'s `std` frontend puts the child in its own Unix process group
//! (`start_kill` is `killpg(SIGKILL)`, and its `wait` reaps the group so no zombie survives) or,
//! on Windows, into a job object that terminates the tree. Its `kill-on-drop` arm exists only in
//! the tokio frontend, so the drop arm stays ours — which is how `ProcessTable` does it too.

use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, Stdio};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crossbeam_channel::{Receiver, Sender};
use process_wrap::std::*;
use xiranite_node_registry::NodeHost;

use crate::host_calls::{CallError, checkpoint};
use crate::watch::{LibraryWatch, PendingChange};

/// How long one wait round on the child's answer is before the run's control state is consulted.
///
/// A parked operation must not park inside a channel receive: `checkpoint` is what lets the pump
/// pause or cancel the run, so it runs between rounds, and a short round keeps the wait
/// responsive without turning it into a spin.
const SIDECAR_RETRY_SLEEP: Duration = Duration::from_millis(25);

/// The default ceiling on one request: generous for a scan round, short enough that a wedged
/// engine surfaces as a refusal rather than as a hung operation.
pub(crate) const DEFAULT_SIDECAR_TIMEOUT: Duration = Duration::from_secs(120);

/// The largest answer one frame may carry.
///
/// `findz` pages are capped by its own core at 1,000 rows, measured at 320 KB, so this is
/// headroom rather than a live limit; it exists so a buggy engine cannot make the host read an
/// unbounded line into memory.
const MAX_SIDECAR_FRAME_BYTES: usize = 8 * 1024 * 1024;

/// How much of a child's stderr the host keeps for diagnostics.
const MAX_SIDECAR_STDERR_BYTES: usize = 8 * 1024;

/// How long a refusal waits for the stderr drain thread to reach EOF.
///
/// Bounded on purpose. Once the child is reaped its write end is closed, so EOF is imminent and
/// the wait is normally a few microseconds; the ceiling exists so a pipe held open by something
/// outside the killed process group can never turn a refusal into a hang.
const STDERR_DRAIN_WAIT: Duration = Duration::from_millis(250);

/// The environment variable that points a development host at a staged sidecar directory.
///
/// Same precedence shape as `xiranite_core::config_paths` (explicit override first, then the
/// platform root), so a developer can run a freshly built `findz` executable without installing
/// it on the system PATH.
pub(crate) const SIDECAR_DIR_ENV: &str = "XIRANITE_SIDECAR_DIR";

/// The child a run started, split so the table lock is not held while an answer is awaited.
pub(crate) struct LiveSidecar {
    /// The write half. Locked for the length of one round: the answer that comes back is the
    /// answer to the frame written under this lock.
    stdin: Arc<Mutex<ChildStdin>>,
    /// Answers arrive in request order, so a round is only safe while the table lock spans the
    /// write *and* its read — see `concurrent_callers_each_get_their_own_answer`. No per-child
    /// round guard: `request` takes `&mut SidecarTable`, so every caller is already serialized on
    /// the table. If a future change starts releasing the table across the wait (the way
    /// `czkawka_operations` releases its session table between sleeps), that is when this type
    /// needs its own round lock, and the test goes red first.
    /// The answer stream. `crossbeam` receivers are cheap to clone, so a waiter does not need
    /// the table while it blocks.
    answers: Receiver<String>,
    /// The child handle, behind a lock because terminating it needs `&mut`.
    child: Arc<Mutex<Box<dyn ChildWrapper>>>,
    program: String,
    pid: u32,
    /// Whatever the child wrote to stderr, kept so a crashed engine's reason travels with the
    /// refusal instead of dying with the process.
    stderr: Arc<Mutex<String>>,
    /// The library watches this run started against this engine (ADR-0077 decision 5).
    ///
    /// They live here rather than in a session-level registry because a watch that outlives the
    /// engine it feeds would queue changes nobody can receive, and the leak this crate exists to
    /// prevent is exactly that shape: dropping the run drops the watches, whose `Drop` signals and
    /// joins their threads.
    watches: Mutex<Vec<LibraryWatch>>,
    /// The thread that fills the buffer above, kept so a refusal can wait for it.
    ///
    /// Without this the reason races its own message: what ends a failed round is the *stdout*
    /// stream reaching EOF (or the write failing), which says nothing about the separate stderr
    /// thread having stored the line the child wrote last. Measured before the fix: roughly one
    /// refusal in ten (`die` mode) arrived saying "nothing on stderr".
    stderr_drain: Mutex<Option<JoinHandle<()>>>,
}

/// The sidecars this run has started, keyed by program name.
#[derive(Default)]
pub(crate) struct SidecarTable {
    live: HashMap<String, Arc<LiveSidecar>>,
    /// Where bare program names are resolved from, in front of the inherited PATH.
    staging_dir: Option<PathBuf>,
    /// Environment added to the child only, never to the host process.
    ///
    /// This is how a service tells its engine where the engine's own files belong (see
    /// `findz_operations`): the grant model already refuses a node-supplied file path, and a core
    /// that derives its identifiers must also be the one that creates the file — so what the host
    /// passes is a directory, via the child's environment, not an argument the node can forge.
    child_env: Vec<(String, OsString)>,
    /// The request sequence, so every frame carries an idempotency key the core can replay on.
    sequence: u64,
}

impl SidecarTable {
    /// A table that resolves bare program names through the inherited PATH, plus
    /// `SIDECAR_DIR_ENV` when the host has it set.
    #[must_use]
    pub(crate) fn from_environment() -> Self {
        // Built field by field: `SidecarTable` implements `Drop`, so a functional record update
        // (`..Self::default()`) would be moving a `HashMap` out of a type that owns one.
        Self {
            live: HashMap::new(),
            staging_dir: std::env::var_os(SIDECAR_DIR_ENV).map(PathBuf::from),
            child_env: Vec::new(),
            sequence: 0,
        }
    }

    /// Points the table at one staging directory.
    ///
    /// Test-only for now: the production host resolves the engine through `from_environment`
    /// (`XIRANITE_SIDECAR_DIR`), and where a packaged executable lives is still an open decision
    /// (ADR-0077 roadmap §6.5), so this stays a knob only the test that proves the framing uses.
    #[cfg(test)]
    pub(crate) fn set_staging_dir(&mut self, directory: Option<PathBuf>) {
        self.staging_dir = directory;
    }

    /// Adds one variable to the child's environment, replacing an earlier value for the same key.
    pub(crate) fn set_child_env(&mut self, key: &str, value: impl Into<OsString>) {
        let value = value.into();
        match self.child_env.iter_mut().find(|(existing, _)| existing == key) {
            Some(slot) => slot.1 = value,
            None => self.child_env.push((key.to_string(), value)),
        }
    }

    /// The next idempotency key. The core requires a non-blank `requestId` for every mutating
    /// method (`service.go`'s `handle`), and a fresh key per request is what makes a *retry* of
    /// the same frame the thing that gets a cached receipt.
    pub(crate) fn next_request_id(&mut self) -> String {
        self.sequence += 1;
        format!("xiranite-{}", self.sequence)
    }

    /// Sends one request frame and answers the response line.
    ///
    /// `frame` is the envelope document; this file adds no semantics to it — that is the point
    /// of ADR-0077's "the vocabulary is not duplicated" rule.
    pub(crate) fn request(
        &mut self,
        program: &str,
        args: &[&str],
        frame: &str,
        timeout: Duration,
        host: &mut (dyn NodeHost + 'static),
        phase: &'static str,
    ) -> Result<String, CallError> {
        if program.contains('/') || program.contains('\\') {
            // The same rule `proc.exec`/`proc.spawn` hang their allowlist on: a grant names a
            // program, and a path-shaped name could point at a different file than the
            // declaration covers.
            return Err(CallError::Failure(format!(
                "sidecar grants name program names, not paths: {program:?}"
            )));
        }

        let sidecar = self.attach_or_start(program, args)?;
        let outcome = self.round(&sidecar, frame, timeout, host, phase);
        if outcome.is_err() {
            // A round that failed means the engine died or went unresponsive mid-call. Keep the
            // handle and every later call in this run fails on the same broken pipe forever;
            // evict it so the next call starts a fresh engine. The failed call itself still
            // returns its refusal — we do not re-run it, because "did the mutation land before the
            // crash?" is a question the core's durable state answers and this file must not guess.
            terminate(&sidecar);
            self.live.remove(program);
        }
        outcome
    }

    /// One write-and-read round against a live child, with the pairing rule enforced by holding
    /// the stdin lock across it.
    fn round(
        &self,
        sidecar: &Arc<LiveSidecar>,
        frame: &str,
        timeout: Duration,
        host: &mut (dyn NodeHost + 'static),
        phase: &'static str,
    ) -> Result<String, CallError> {
        if let Err(write_error) = {
            let mut stdin = lock(&sidecar.stdin);
            stdin
                .write_all(frame.as_bytes())
                .and_then(|_| stdin.write_all(b"\n"))
                .and_then(|_| stdin.flush())
        } {
            // A write only fails this way because the reader is gone, so stop the child first:
            // that is also what lets its stderr drain finish before the message below is built.
            terminate(sidecar);
            return Err(CallError::Failure(format!(
                "sidecar {} (pid {}) could not be asked: {write_error} (stderr: {})",
                sidecar.program,
                sidecar.pid,
                stderr_snippet(&sidecar.stderr)
            )));
        }

        let deadline = Instant::now() + timeout;
        loop {
            // The wait is the yield point: a paused operation parks here, and a cancelled one
            // travels back as `Cancelled` with its child terminated rather than left scanning.
            if let Err(error) = checkpoint(host, phase) {
                terminate(sidecar);
                return Err(error);
            }
            match sidecar.answers.recv_timeout(SIDECAR_RETRY_SLEEP) {
                Ok(line) => {
                    if line.len() > MAX_SIDECAR_FRAME_BYTES {
                        return Err(CallError::Failure(format!(
                            "sidecar {} answered a {}-byte frame, over the {}-byte limit",
                            sidecar.program,
                            line.len(),
                            MAX_SIDECAR_FRAME_BYTES
                        )));
                    }
                    return Ok(line);
                }
                Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                    if Instant::now() >= deadline {
                        terminate(sidecar);
                        return Err(CallError::Failure(format!(
                            "sidecar {} (pid {}) did not answer within {} ms; it was asked: {}; stderr: {}",
                            sidecar.program,
                            sidecar.pid,
                            timeout.as_millis(),
                            frame_head(frame),
                            stderr_snippet(&sidecar.stderr)
                        )));
                    }
                }
                Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                    // The reader thread ends when stdout closes, i.e. the engine died. An error
                    // is data the node can show, so the reason goes out with drained stderr.
                    terminate(sidecar);
                    return Err(CallError::Failure(format!(
                        "sidecar {} (pid {}) closed its answer stream; stderr: {}",
                        sidecar.program,
                        sidecar.pid,
                        stderr_snippet(&sidecar.stderr)
                    )));
                }
            }
        }
    }

    /// The engine this run already has for `program`, if it has one.
    ///
    /// The host-side watch delivery uses this rather than the attach-or-start path: a queued
    /// filesystem change must never be able to resurrect an engine the run did not ask for.
    pub(crate) fn live(&self, program: &str) -> Option<Arc<LiveSidecar>> {
        self.live.get(program).map(Arc::clone)
    }


    fn attach_or_start(
        &mut self,
        program: &str,
        args: &[&str],
    ) -> Result<Arc<LiveSidecar>, CallError> {
        if let Some(sidecar) = self.live.get(program) {
            return Ok(Arc::clone(sidecar));
        }
        let started = start_sidecar(program, args, self.staging_dir.as_deref(), &self.child_env)?;
        let sidecar = Arc::new(started);
        self.live
            .insert(sidecar.program.clone(), Arc::clone(&sidecar));
        Ok(sidecar)
    }

    /// The pids this run owns.
    ///
    /// Test-only by design: it exists so a test can assert that nothing survived the run, which
    /// is the whole promise `Drop` makes, and it must not become a way for a node to see pids.
    #[cfg(test)]
    pub(crate) fn live_pids(&self) -> Vec<u32> {
        self.live.values().map(|sidecar| sidecar.pid).collect()
    }

    /// Stops every child this run still owns, which is what `Drop` does when the run ends.
    fn shutdown(&mut self) {
        for sidecar in self.live.values() {
            terminate(sidecar);
        }
        self.live.clear();
    }
}

impl Drop for SidecarTable {
    fn drop(&mut self) {
        // The failure mode this exists for: a node asks the engine for a scan, then its run is
        // cancelled or throws. Without this arm the Go child outlives the operation and the
        // desktop host accumulates whoever asked for a library.
        self.shutdown();
    }
}

/// Builds the child's PATH with the staging directory in front, before anything is spawned.
///
/// Done outside the `CommandWrap` closure because `join_paths` can fail and the closure cannot
/// report: a PATH that cannot be assembled is a refusal, not a child started with a broken one.
fn child_path(staging_dir: Option<&Path>) -> Result<Option<OsString>, CallError> {
    let Some(directory) = staging_dir else {
        return Ok(None);
    };
    let mut parts = vec![directory.as_os_str().to_os_string()];
    if let Some(existing) = std::env::var_os("PATH") {
        parts.extend(std::env::split_paths(&existing).map(std::path::PathBuf::into_os_string));
    }
    std::env::join_paths(parts).map(Some).map_err(|error| {
        CallError::Failure(format!(
            "sidecar staging directory {} could not be added to the child's PATH: {error}",
            directory.display()
        ))
    })
}

/// Starts the child and hooks its two output pipes up to draining threads.
///
/// The reader threads are not an optimisation. `machine.rs` records why for `proc.spawn`: a child
/// that writes more than a pipe buffer would block with nobody reading it — and here a blocked
/// child is a request that never answers.
fn start_sidecar(
    program: &str,
    args: &[&str],
    staging_dir: Option<&Path>,
    child_env: &[(String, OsString)],
) -> Result<LiveSidecar, CallError> {
    let path_env = child_path(staging_dir)?;
    let mut command = CommandWrap::with_new(program, |command| {
        command.args(args);
        command.stdin(Stdio::piped());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
        // The staging directory goes on the *child's* PATH only: the host's own lookup stays
        // what it was, so a node cannot reach a program the registration did not name.
        if let Some(joined) = &path_env {
            command.env("PATH", joined);
        }
        for (key, value) in child_env {
            command.env(key, value);
        }
    });
    // `process-wrap` deliberately offers no single cross-platform wrapper, so the guarantee is
    // taken per platform: a Unix process group we lead (its `start_kill` is `killpg(SIGKILL)`
    // and its `wait` reaps the group), a Windows job object that terminates the tree.
    #[cfg(unix)]
    command.wrap(ProcessGroup::leader());
    #[cfg(windows)]
    command.wrap(JobObject);

    let mut child = command
        .spawn()
        .map_err(|error| CallError::Failure(format!("sidecar {program} could not start: {error}")))?;
    let pid = child.id();
    let stdin = child
        .stdin()
        .take()
        .ok_or_else(|| not_piped(program, "stdin"))?;
    let stdout = child
        .stdout()
        .take()
        .ok_or_else(|| not_piped(program, "stdout"))?;
    let stderr = child
        .stderr()
        .take()
        .ok_or_else(|| not_piped(program, "stderr"))?;

    let (sender, answers): (Sender<String>, Receiver<String>) = crossbeam_channel::bounded(64);
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    if sender.send(line.trim_end().to_string()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    let stderr_text = Arc::new(Mutex::new(String::new()));
    let stderr_drain = {
        let sink = Arc::clone(&stderr_text);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            loop {
                let mut line = String::new();
                match reader.read_line(&mut line) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let mut held = lock(&sink);
                        // Bounded and oldest-first-trimmed: a chatty engine must not be able to
                        // grow the host's memory, and the newest lines are the interesting ones.
                        held.push_str(&line);
                        if held.len() > MAX_SIDECAR_STDERR_BYTES {
                            let cut = held.len() - MAX_SIDECAR_STDERR_BYTES;
                            held.drain(..cut);
                        }
                    }
                }
            }
        })
    };

    Ok(LiveSidecar {
        stdin: Arc::new(Mutex::new(stdin)),
        answers,
        child: Arc::new(Mutex::new(child)),
        program: program.to_string(),
        pid,
        stderr: stderr_text,
        stderr_drain: Mutex::new(Some(stderr_drain)),
        watches: Mutex::new(Vec::new()),
    })
}

/// The start of a frame, for a timeout message that has to say what was never answered
/// without quoting the caller's whole document.
fn frame_head(frame: &str) -> String {
    let mut head: String = frame.chars().take(120).collect();
    if head.chars().count() < frame.chars().count() {
        head.push_str(" …");
    }
    head
}

fn not_piped(program: &str, which: &str) -> CallError {
    CallError::Failure(format!("sidecar {program} has no piped {which}"))
}

/// Terminates a child and reaps it. Idempotent: a child that already exited is not an error.
///
/// Reaping is not cosmetic. A zombie still answers `kill -0`, so a "nothing left behind" gauge
/// that only signalled would go green on a run that leaked.
///
/// Takes the shared view rather than the `Arc`: every caller already holds a reference to the
/// child it wants stopped, and the holder does not need the handle itself to stop it.
fn terminate(sidecar: &LiveSidecar) {
    {
        let mut child = match sidecar.child.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let _ = child.start_kill();
        let _ = child.wait();
    }
    // Reaping closed the child's write ends, so the stderr drain is about to see EOF. Let it
    // finish before a refusal formats itself: otherwise the engine's own reason loses the race
    // against the message that is supposed to carry it. Bounded, because a pipe still held open
    // by something outside the killed group must never turn a refusal into a hang.
    let drain = lock(&sidecar.stderr_drain).take();
    if let Some(drain) = drain {
        let deadline = Instant::now() + STDERR_DRAIN_WAIT;
        while !drain.is_finished() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        if drain.is_finished() {
            // `join` is what carries the happens-before edge into the buffer read next.
            let _ = drain.join();
        }
        // If it is not finished, dropping the handle detaches the reader: the buffer it fills
        // stays readable, and a reader on a dead child's pipe costs the run nothing.
    }
}

fn lock<T>(value: &Mutex<T>) -> MutexGuard<'_, T> {
    value.lock().unwrap_or_else(PoisonError::into_inner)
}

fn stderr_snippet(stderr: &Arc<Mutex<String>>) -> String {
    let text = lock(stderr).trim().to_string();
    if text.is_empty() {
        return "nothing on stderr".to_string();
    }
    let mut snippet: String = text.chars().take(400).collect();
    if snippet.chars().count() < text.chars().count() {
        snippet.push_str(" …");
    }
    snippet
}

/// Where `cargo test` put the stand-in engine binary for this package.
///
/// `CARGO_BIN_EXE_*` is only defined for integration tests, not for unit tests inside the lib,
/// so the sibling is located from the running test binary:
/// `<target>/<profile>/deps/<test exe>` ⇒ `<target>/<profile>/sidecar-testee`. A missing file is
/// a hard failure rather than a skipped test: a gauge that never runs is the failure mode this
/// crate has already been bitten by.
#[cfg(test)]
#[must_use]
pub(crate) fn testee_binary() -> std::path::PathBuf {
    let exe = std::env::current_exe().expect("a test binary knows where it lives");
    let profile_dir = exe
        .parent()
        .and_then(|deps| deps.parent())
        .expect("the test executable sits under <target>/<profile>/deps");
    let candidate = profile_dir.join(format!("sidecar-testee{}", std::env::consts::EXE_SUFFIX));
    assert!(
        candidate.is_file(),
        "the sidecar stand-in was not built next to the test runner: {}",
        candidate.display()
    );
    candidate
}


/// The batches each of this engine's watches believes, newest first per path.
///
/// Taking them out here is what keeps the pipe single-writer: the watch thread only fills a buffer,
/// and the holder is the one that turns a batch into a frame, inside its own round.
pub(crate) fn drain_watch_signals(sidecar: &Arc<LiveSidecar>) -> Vec<WatchSignal> {
    let mut signals = Vec::new();
    for (index, watch) in lock(&sidecar.watches).iter().enumerate() {
        if let Some((changes, stream_error)) = watch.take_signal() {
            signals.push(WatchSignal {
                index,
                library_id: watch.library_id().to_string(),
                changes,
                stream_error,
            });
        }
    }
    signals
}

/// What one watch owes the engine: a batch, a backend error, or both.
pub(crate) struct WatchSignal {
    pub(crate) index: usize,
    pub(crate) library_id: String,
    pub(crate) changes: Vec<PendingChange>,
    pub(crate) stream_error: bool,
}

/// Adds a watch to the engine that serves the given library.
pub(crate) fn attach_watch(sidecar: &Arc<LiveSidecar>, watch: LibraryWatch) {
    lock(&sidecar.watches).push(watch);
}

/// Reports a delivery outcome for one watch. `Outcome::Degraded(true)` / `Outcome::Recovered(true)`
/// tell the caller it owes the engine one more frame — the same single-reconcile and clear-the-health
/// rules the node's `watcher-service.ts` states.
pub(crate) enum WatchOutcome {
    /// Delivery failed. `true` = also queue exactly one `scan.reconcile`.
    Degraded(bool),
    /// Delivery landed. `true` = also report `watcher.set_health healthy`.
    Recovered(bool),
}

pub(crate) fn report_watch_outcome(sidecar: &Arc<LiveSidecar>, index: usize, ok: bool) -> WatchOutcome {
    let watches = lock(&sidecar.watches);
    match watches.get(index) {
        Some(watch) if ok => WatchOutcome::Recovered(watch.delivered()),
        Some(watch) => WatchOutcome::Degraded(watch.degrade()),
        None => WatchOutcome::Recovered(false),
    }
}

/// Locks the run's sidecar table.
///
/// A poisoned mutex here means a draining thread panicked; the children it holds are still real,
/// so the run must still be able to terminate them.
pub(crate) fn lock_sidecars(table: &Arc<Mutex<SidecarTable>>) -> MutexGuard<'_, SidecarTable> {
    table.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The holder's tests, in a child module so the private surface stays private and this file
/// keeps to the size AGENTS.md asks of a source file.
#[cfg(test)]
#[path = "sidecar/tests.rs"]
mod tests;
