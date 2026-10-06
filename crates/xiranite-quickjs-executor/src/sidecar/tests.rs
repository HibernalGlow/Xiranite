// The sidecar holder's tests, included as a child module of `src/sidecar.rs` (see the `#[path]`
// declaration there) so the holder file stays within the size AGENTS.md asks of a source file.
// A child module reaches the parent's private items, so nothing here needs a widened surface.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use xiranite_core::filesystem::FileCapability;

use super::*;
use crate::machine::MachineAccess;
use crate::test_host::CountingHost;

/// The program name the tests stage under. Bare, because a path-shaped name is refused.
const TESTEE: &str = "xiranite-sidecar-testee";

/// Stages the testee under `TESTEE` and points a run's table at that directory.
fn staged(tag: &str) -> (PathBuf, MachineAccess) {
    let directory =
        std::env::temp_dir().join(format!("xiranite-sidecar-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&directory);
    fs::create_dir_all(&directory).expect("the staging directory exists");
    let binary = testee_binary();
    let staged_path = directory.join(format!("{TESTEE}{}", std::env::consts::EXE_SUFFIX));
    fs::copy(&binary, &staged_path).unwrap_or_else(|error| {
        panic!(
            "copying {} to {}: {error}",
            binary.display(),
            staged_path.display()
        )
    });
    let machine = MachineAccess::granted(FileCapability::new([]));
    lock_sidecars(machine.sidecars()).set_staging_dir(Some(directory.clone()));
    (directory, machine)
}

fn cleanup(directory: &Path) {
    let _ = fs::remove_dir_all(directory);
}

/// Is this pid still *running*?
///
/// Deliberately not `kill -0`: on Unix a killed-but-unreaped child is a zombie and still
/// answers `kill -0`, which would make the terminate assertions pass on a run that left
/// corpses behind. `ps -o state=` says `Z` for that case and nothing at all once the child
/// has been reaped, which is the difference `terminate`'s `wait()` is supposed to make.
fn pid_running(pid: u32) -> bool {
    #[cfg(unix)]
    {
        let output = std::process::Command::new("ps")
            .args(["-o", "state=", "-p", &pid.to_string()])
            .output()
            .expect("ps must run");
        let state = String::from_utf8_lossy(&output.stdout).trim().to_string();
        !state.is_empty() && !state.starts_with('Z')
    }
    #[cfg(windows)]
    {
        // Compile-verified only: this box is macOS, and per ADR-0082 (cited by AGENTS.md) the
        // `windows-latest` leg of the `rust-host` matrix is where this arm gets executed for the first
        // time. `tasklist /FI "PID eq <n>"` is the probe; if the job-object arm ever leaks a child, this
        // is the assertion that says so — it is not evidence of anything until that leg runs.
        let filter = format!("PID eq {pid}");
        std::process::Command::new("tasklist")
            .args(["/FI", &filter, "/NH"])
            .output()
            .map(|output| String::from_utf8_lossy(&output.stdout).contains(&pid.to_string()))
            .unwrap_or(false)
    }
}

/// Does the pid exist at all, zombie included? Used to prove a child was *reaped*, not
/// merely stopped.
#[cfg(unix)]
fn pid_exists(pid: u32) -> bool {
    let output = std::process::Command::new("ps")
        .args(["-o", "state=", "-p", &pid.to_string()])
        .output()
        .expect("ps must run");
    !String::from_utf8_lossy(&output.stdout).trim().is_empty()
}

fn ask(
    machine: &MachineAccess,
    args: &[&str],
    frame: &str,
    timeout: Duration,
    host: &mut (dyn NodeHost + 'static),
) -> Result<String, CallError> {
    let mut table = lock_sidecars(machine.sidecars());
    table.request(TESTEE, args, frame, timeout, host, "test")
}

fn frame(id: &str, method: &str) -> String {
    format!(r#"{{"requestVersion":1,"requestId":"{id}","method":"{method}","params":{{}}}}"#)
}

#[test]
fn a_path_shaped_program_name_is_refused_before_anything_starts() {
    let (_directory, machine) = staged("name");
    let mut host = CountingHost::new();
    let error = {
        let mut table = lock_sidecars(machine.sidecars());
        table
            .request(
                "/etc/evil/findz",
                &["serve"],
                "{}",
                Duration::from_secs(1),
                &mut host,
                "test",
            )
            .expect_err("a path is not a granted program name")
    };
    assert!(
        error.message().contains("program names, not paths"),
        "{}",
        error.message()
    );
    assert!(
        lock_sidecars(machine.sidecars()).live_pids().is_empty(),
        "a refusal must not have started a child"
    );
    cleanup(&_directory);
}

/// The group id of a pid, or `None` when it is gone.
#[cfg(unix)]
fn pgid_of(pid: u32) -> Option<u32> {
    let output = std::process::Command::new("ps")
        .args(["-o", "pgid=", "-p", &pid.to_string()])
        .output()
        .expect("ps must run");
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<u32>()
        .ok()
}

#[test]
fn the_child_leads_its_own_process_group() {
    // The whole terminate design rests on this: `killpg` and the group-wide `wait` only
    // address *our* engine if the child is the leader of its own group. If it inherited the
    // harness's group, `start_kill` would signal every sibling test process and the group
    // `wait` would reap other tests' children — a stolen SIGCHLD looks exactly like a
    // "child that never exits" in whoever trips next.
    let (directory, machine) = staged("pgid");
    let mut host = CountingHost::new();
    ask(
        &machine,
        &["answer"],
        &frame("grp", "api.info"),
        Duration::from_secs(20),
        &mut host,
    )
    .expect("the frame answers");
    #[cfg(unix)]
    {
        let pid = lock_sidecars(machine.sidecars()).live_pids()[0];
        let harness = std::process::id();
        assert_ne!(pid, harness, "the child is a separate process");
        assert_eq!(
            pgid_of(pid),
            Some(pid),
            "the child must lead its own group; its pgid is otherwise shared with the harness ({})",
            pgid_of(pid).unwrap_or_default()
        );
        assert_ne!(
            pgid_of(pid),
            pgid_of(harness),
            "the child must not sit in the harness's process group"
        );
    }
    let _ = machine;
    cleanup(&directory);
}

#[test]
fn a_child_started_without_a_placement_variable_reports_none() {
    // The other half of `the_index_directory_the_host_chose_reaches_the_engine`: the holder on
    // its own sets no child environment, so the stand-in must report an empty value. Without
    // this arm a testee that ignored the variable entirely would still satisfy the positive
    // case.
    let (directory, machine) = staged("noenv");
    let mut host = CountingHost::new();
    let answer = ask(
        &machine,
        &["answer"],
        &frame("plain", "api.info"),
        Duration::from_secs(20),
        &mut host,
    )
    .expect("the frame answers");
    let parsed: serde_json::Value =
        serde_json::from_str(&answer).expect("the stand-in answers a JSON document");
    assert_eq!(
        parsed["result"]["indexDir"],
        serde_json::Value::String(String::new()),
        "a child the holder started with no placement variable must report an empty one, got {answer}"
    );
    cleanup(&directory);
}

/// Two callers, one engine: each must get the line that answers its own frame.
///
/// Without the round lock this races — the second writer can slip its frame in before the
/// first reader takes its line, and both callers then read the *other* answer, which looks
/// like a correct response to each of them. That is the silent failure worth a test.
#[test]
fn concurrent_callers_each_get_their_own_answer() {
    let (directory, machine) = staged("concurrent");
    let table = Arc::clone(machine.sidecars());
    let mut threads = Vec::new();
    for index in 0..4 {
        let table = Arc::clone(&table);
        threads.push(std::thread::spawn(move || {
            let mut host = CountingHost::new();
            let id = format!("c{index}");
            let answer = {
                let mut guard = table.lock().unwrap_or_else(PoisonError::into_inner);
                guard
                    .request(
                        TESTEE,
                        &["answer"],
                        &frame(&id, "task.get"),
                        Duration::from_secs(30),
                        &mut host,
                        "test",
                    )
                    .expect("the frame answers")
            };
            let parsed: serde_json::Value =
                serde_json::from_str(&answer).expect("the child answers a JSON document");
            assert_eq!(
                parsed["requestId"],
                serde_json::Value::String(id.clone()),
                "caller {id} was answered someone else's frame: {answer}"
            );
        }));
    }
    for thread in threads {
        thread
            .join()
            .expect("a concurrent caller must not lose its answer");
    }
    assert_eq!(
        lock_sidecars(machine.sidecars()).live_pids().len(),
        1,
        "four rounds share one engine, they do not each start one"
    );
    cleanup(&directory);
}

#[test]
fn answers_come_back_in_the_order_the_frames_went_out() {
    let (directory, machine) = staged("order");
    let mut host = CountingHost::new();
    let first = ask(
        &machine,
        &["answer"],
        &frame("first", "library.open"),
        Duration::from_secs(20),
        &mut host,
    )
    .expect("the first frame answers");
    let second = ask(
        &machine,
        &["answer"],
        &frame("second", "task.get"),
        Duration::from_secs(20),
        &mut host,
    )
    .expect("the second frame answers");
    assert!(first.contains("\"requestId\":\"first\""), "{first}");
    assert!(second.contains("\"requestId\":\"second\""), "{second}");
    // One child for two requests: reusing it is the entire point of the run-scoped table.
    assert_eq!(
        lock_sidecars(machine.sidecars()).live_pids().len(),
        1,
        "the second request must not have started a second engine"
    );
    cleanup(&directory);
}

#[test]
fn a_chatty_child_cannot_deadlock_the_request() {
    // The testee writes ~600 KB to stderr before answering. With nobody draining that pipe
    // it would block on its own stderr and the request would time out — the failure
    // `machine.rs` records for `proc.spawn`, reproduced here against the answer stream.
    let (directory, machine) = staged("chatty");
    let mut host = CountingHost::new();
    let answer = ask(
        &machine,
        &["chatty"],
        &frame("loud", "scan.start"),
        Duration::from_secs(20),
        &mut host,
    )
    .expect("a chatty child still answers");
    assert!(answer.contains("\"requestId\":\"loud\""), "{answer}");
    cleanup(&directory);
}

#[test]
fn a_child_that_never_answers_times_out_and_its_process_is_reaped() {
    let (directory, machine) = staged("stall");
    let mut host = CountingHost::new();
    // The stall mode's first frame answers, which is how this test learns the child's pid from
    // the child itself: a failed round evicts its handle, so the table is no longer a place the
    // pid can be read from afterwards.
    let alive = ask(
        &machine,
        &["stall"],
        &frame("warm", "api.info"),
        Duration::from_secs(20),
        &mut host,
    )
    .expect("a stalled engine still answers before it stalls");
    let pid_before = reported_pid(&alive);
    let error = ask(
        &machine,
        &["stall"],
        &frame("slow", "scan.start"),
        Duration::from_millis(400),
        &mut host,
    )
    .expect_err("an engine that stops answering must not hang the run");
    assert!(
        error.message().contains("did not answer within"),
        "the refusal must say the wait expired, not that it got an answer: {}",
        error.message()
    );
    assert!(
        error.message().contains("\"slow\""),
        "the refusal has to say what was never answered: {}",
        error.message()
    );
    assert!(
        error.message().contains("holding the request back"),
        "the refusal should carry the child's own stderr: {}",
        error.message()
    );
    assert!(
        !pid_running(pid_before),
        "the timed-out child (pid {pid_before}) is still running — a hung engine would keep scanning"
    );
    // The reap claim is a POSIX shape: a killed child that nobody waits on stays visible as `Z`,
    // and that is what this distinguishes from a mere signal. Windows has no zombie state, so the
    // `pid_running` check above is the whole claim there — an ungated call here would not even
    // compile on the `windows-latest` CI leg, which is where this arm runs for the first time.
    #[cfg(unix)]
    assert!(
        !pid_exists(pid_before),
        "the timed-out child (pid {pid_before}) is a zombie: terminate must reap, not just signal"
    );
    cleanup(&directory);
}

#[test]
fn a_child_that_exits_without_answering_refuses_with_its_stderr() {
    let (directory, machine) = staged("die");
    let mut host = CountingHost::new();
    let error = ask(
        &machine,
        &["die"],
        &frame("gone", "library.close"),
        Duration::from_secs(20),
        &mut host,
    )
    .expect_err("an engine that dies mid-request cannot answer");
    assert!(
        error.message().contains("closed its answer stream"),
        "{}",
        error.message()
    );
    assert!(
        error.message().contains("exiting without an answer"),
        "{}",
        error.message()
    );
    cleanup(&directory);
}

/// The pid the testee reported for itself, read out of the answer frame.
fn reported_pid(answer: &str) -> u32 {
    const MARKER: &str = "\"pid\":";
    let start = answer
        .find(MARKER)
        .unwrap_or_else(|| panic!("the answer carried no pid: {answer}"))
        + MARKER.len();
    let digits: String = answer[start..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digits.parse().unwrap_or_else(|error| {
        panic!("the pid the child reported ({digits:?}) is not a number: {error}")
    })
}

/// Signals a child from outside the table, the way a segfault or an out-of-memory reaper does.
fn kill_from_outside(pid: u32) {
    let pid_arg = pid.to_string();
    #[cfg(unix)]
    let (program, args): (&str, &[&str]) = ("kill", &["-9", pid_arg.as_str()]);
    #[cfg(windows)]
    let (program, args): (&str, &[&str]) = ("taskkill", &["/F", "/PID", pid_arg.as_str()]);
    let status = std::process::Command::new(program)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("the external kill must run");
    assert!(
        status.success() || !pid_running(pid),
        "the external kill of pid {pid} neither succeeded nor left it dead"
    );
}

/// Blocks until `pid` stops reporting as running, so a test does not race its own kill.
fn wait_until_dead(pid: u32) {
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while pid_running(pid) {
        assert!(
            std::time::Instant::now() < deadline,
            "pid {pid} survived an external SIGKILL"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn a_child_that_dies_between_calls_is_replaced_for_the_next_one() {
    // The failure this guards: the table hands back the handle it cached, and after a crash that
    // handle is a closed pipe. Without eviction every later call in the same run fails against
    // the same dead engine — a scan that could have carried on becomes a run that can never ask
    // anything again.
    let (directory, machine) = staged("crash");
    let mut host = CountingHost::new();

    let first = ask(
        &machine,
        &["answer"],
        &frame("pre", "api.info"),
        Duration::from_secs(20),
        &mut host,
    )
    .expect("the engine answers while it is alive");
    let dead_pid = reported_pid(&first);
    assert_eq!(
        Some(dead_pid),
        lock_sidecars(machine.sidecars()).live_pids().first().copied(),
        "the pid the child reported must be the pid the table recorded"
    );

    kill_from_outside(dead_pid);
    wait_until_dead(dead_pid);

    let error = ask(
        &machine,
        &["answer"],
        &frame("post", "api.info"),
        Duration::from_secs(20),
        &mut host,
    )
    .expect_err("a request into a dead engine cannot answer");
    assert!(
        error.message().contains(&dead_pid.to_string()),
        "the refusal must name the engine that died: {}",
        error.message()
    );
    assert!(
        lock_sidecars(machine.sidecars())
            .live_pids()
            .is_empty(),
        "the dead handle was not evicted: {:?}",
        lock_sidecars(machine.sidecars()).live_pids()
    );

    let second = ask(
        &machine,
        &["answer"],
        &frame("next", "api.info"),
        Duration::from_secs(20),
        &mut host,
    )
    .expect("the next call must get a fresh engine");
    let fresh_pid = reported_pid(&second);
    assert_ne!(
        fresh_pid, dead_pid,
        "the answer came back from the engine that was killed"
    );
    assert!(
        pid_running(fresh_pid),
        "the replacement engine is not running"
    );

    drop(machine);
    assert!(
        !pid_running(fresh_pid),
        "the replacement child (pid {fresh_pid}) outlived the run"
    );
    cleanup(&directory);
}

#[test]
fn a_cancelled_run_terminates_the_child_it_started() {
    let (directory, machine) = staged("cancel");
    let mut host = CountingHost::new();
    // Answer the first frame so the child's pid is known before the run that gets stuck on the
    // second one is cancelled — the cancelled round evicts the handle it was using.
    let alive = ask(
        &machine,
        &["stall"],
        &frame("warm", "api.info"),
        Duration::from_secs(20),
        &mut host,
    )
    .expect("a stalled engine still answers before it stalls");
    let pid = reported_pid(&alive);
    // The next checkpoint cancels, so the wait never sees an answer: this is the path a user's
    // Cancel button takes, and the child must not outlive it.
    host.cancel_at = Some(1);
    let error = ask(
        &machine,
        &["stall"],
        &frame("cancel-me", "scan.start"),
        Duration::from_secs(20),
        &mut host,
    )
    .expect_err("a cancelled run travels back as Cancelled");
    assert_eq!(error, CallError::Cancelled);
    assert!(
        lock_sidecars(machine.sidecars())
            .live_pids()
            .is_empty(),
        "the cancelled round left its child in the table"
    );
    assert!(
        !pid_running(pid),
        "the cancelled run left pid {pid} scanning"
    );
    cleanup(&directory);
}

#[test]
fn dropping_the_run_leaves_no_child_behind() {
    let (directory, machine) = staged("drop");
    let pid = {
        let mut host = CountingHost::new();
        ask(
            &machine,
            &["answer"],
            &frame("drop-me", "api.info"),
            Duration::from_secs(20),
            &mut host,
        )
        .expect("the frame answers");
        lock_sidecars(machine.sidecars()).live_pids()[0]
    };
    drop(machine);
    assert!(
        !pid_running(pid),
        "the run ended but pid {pid} is still running"
    );
    #[cfg(unix)]
    assert!(
        !pid_exists(pid),
        "the run ended and pid {pid} lingers as a zombie — Drop signalled but did not reap"
    );
    cleanup(&directory);
}

#[test]
fn the_liveness_gauge_sees_a_child_that_was_never_terminated() {
    // The positive control for the two assertions above: if `pid_alive` could not see a
    // live child, "no process left behind" would be a green gauge on an empty stove.
    let (directory, machine) = staged("control");
    let leaked = {
        let mut host = CountingHost::new();
        ask(
            &machine,
            &["answer"],
            &frame("control", "api.info"),
            Duration::from_secs(20),
            &mut host,
        )
        .expect("the frame answers");
        let pid = lock_sidecars(machine.sidecars()).live_pids()[0];
        // Leak the table on purpose: Drop is what would have terminated the child.
        std::mem::forget(machine);
        pid
    };
    assert!(
        pid_running(leaked),
        "POSITIVE CONTROL BROKEN: a child we never terminated is not visible to pid_running, \
             so dropping_the_run_leaves_no_child_behind proves nothing"
    );
    // Clean up after the deliberate leak; this test owns the process it left running.
    #[cfg(unix)]
    std::process::Command::new("kill")
        .args(["-9", &leaked.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok();
    // SIGKILL without a reaper leaves a zombie, and that is exactly what the control is for:
    // the state-aware gauge must now say "not running" while the entry still exists.
    assert!(
        !pid_running(leaked),
        "the control's own kill did not land (pid {leaked} still reports as running)"
    );
    #[cfg(unix)]
    assert!(
        pid_exists(leaked),
        "the control expected a zombie here; if ps shows nothing, the parent already reaped \
             it and this test no longer distinguishes signal from reap"
    );
    cleanup(&directory);
}
