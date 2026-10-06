//! The Findz index core as a sidecar service (ADR-0077).
//!
//! ## What this file is not
//!
//! It is not a second implementation of anything. `native/findz-go` owns scanning, the index,
//! the archive-member model, image analysis, task state and pagination; the node's TypeScript
//! owns the action vocabulary and how a snapshot is worded for the three faces. What sits here
//! is the transport: name the method, hand over the parameter document, answer the core's JSON.
//! ADR-0074 §1 makes that the only allowed shape for a host service, and the czkawka service
//! header records the same rule for the in-process engine.
//!
//! ## Why the method list is a copy of the core's capability list
//!
//! `METHODS` below is `native/findz-go/protocol.go`'s declared capabilities, and the test pins
//! that it stays equal. A published set that falls behind the dispatch is a real failure this
//! crate has already been bitten by: `scan.basic` was answered by the czkawka engine for a whole
//! round while the service table still advertised four methods, and the realm was refused for a
//! call that worked.
//!
//! ## Why there is no `info` method
//!
//! The C ABI had two entry points beyond `findz_call` — `findz_abi_version` and `findz_api_info`
//! (`ffi.go:18`/`:23`) — which the old `bun:ffi` client used for its handshake
//! (`packages/findz-native/src/index.ts:113-139`). The envelope subsumes both: `service.handle`
//! refuses a wrong `requestVersion` and carries `currentAPIInfo()` in that refusal's `details`
//! (`service.go:38-42`). Version negotiation therefore happens on the first request instead of
//! through a second channel, so nothing here needs an ABI symbol table.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

use serde_json::{Value, json};
use xiranite_core::config_paths::PathContext;
use xiranite_node_registry::NodeHost;

use crate::host_calls::{CallError, HostAnswer, answer, required_text};
use crate::machine::MachineAccess;
use crate::watch::LibraryWatch;
use crate::sidecar::{
    DEFAULT_SIDECAR_TIMEOUT, SidecarTable, WatchOutcome, attach_watch, drain_watch_signals,
    lock_sidecars, report_watch_outcome,
};

/// The program this service fronts.
///
/// It is a bare name on purpose: `src/sidecar.rs` refuses path-shaped names exactly as
/// `proc_operations.rs` does, so where the executable lives is a staging decision (the child's
/// PATH, or `XIRANITE_SIDECAR_DIR`), not something a node can steer from its arguments.
const PROGRAM: &str = "findz";

/// The variable the Findz core reads to decide where its indexes live
/// (`native/findz-go/database.go`'s `indexDirEnv`).
pub(crate) const INDEX_DIR_ENV: &str = "XIRANITE_FINDZ_INDEX_DIR";

/// Resolves the index directory from the host's data root, with one explicit override.
///
/// Pure and side-effect free on purpose: the core creates the directory itself
/// (`database.go:58` does the `MkdirAll`), so the host passes a name and never touches the file
/// system during a node call. Deriving it from `PathContext` rather than `LOCALAPPDATA` is what
/// makes the placement identical on the three platforms instead of leaning on a Windows-shaped
/// variable that macOS and Linux do not have.
/// The variable a portable install uses to move Xiranite's whole data root.
///
/// `PathContext` honors it when locating the shared config document but **not** in
/// `data_dir()` — that one spells the platform location on purpose — so the index placement has to
/// read it here or a relocated data root would silently leave indexes behind (measured
/// 2026-10-05: with only `XIRANITE_DATA_DIR` set, the core fell back to its own platform cache).
const DATA_DIR_ENV: &str = "XIRANITE_DATA_DIR";

/// The root the index directory hangs off of, looked up through `lookup`.
///
/// Pure over the lookup rather than reading `std::env` inside, so both branches are assertable
/// without mutating the process environment (which Rust 2024 makes unsafe and racy).
pub(crate) fn host_data_root(lookup: impl Fn(&str) -> Option<OsString>) -> PathBuf {
    match lookup(DATA_DIR_ENV).filter(|value| !value.is_empty()) {
        Some(root) => PathBuf::from(root),
        None => PathContext::from_environment().data_dir(),
    }
}

pub(crate) fn index_dir(data_root: &Path, override_dir: Option<&OsStr>) -> PathBuf {
    match override_dir {
        Some(explicit) if !explicit.is_empty() => PathBuf::from(explicit),
        _ => data_root.join("findz").join("indexes"),
    }
}

/// The request version `native/findz-go/protocol.go` declares (`findzRequestVersion`).
const FINDZ_REQUEST_VERSION: u8 = 1;

/// The phase reported at every checkpoint, so a paused or cancelled run says which engine it
/// was waiting on.
const FINDZ_PHASE: &str = "findz";

/// The methods the core answers. Keep equal to `protocol.go`'s capability list; the test in this
/// file asserts the equality against the Go source, so drift here is caught rather than shipped.
pub(crate) const METHODS: &[&str] = &[
    "library.open",
    "api.info",
    "library.close",
    "scan.start",
    "scan.reconcile",
    "watcher.apply_changes",
    "watcher.set_health",
    "query.archives",
    "query.members",
    "export.rows",
    "projection.treemap",
    "analysis.start",
    "task.get",
    "task.wait",
    "task.pause",
    "task.resume",
    "task.cancel",
];

/// The two engine methods a **node** must not call, even though the engine answers them.
///
/// ADR-0077 decision 5 puts the filesystem feed on the host's side: `notify` and its debouncer
/// subscribe there and deliver into `watcher.apply_changes` / `watcher.set_health`. Exposing them
/// through `service.invoke` would let a node drive the index directly, and the core takes those
/// claims at face value for any path inside the granted root (`scanner.go`: `pathWithinRoot`, then
/// `deleteArchiveByPath`) — a `delete` for an archive that is still on disk silently removes its
/// rows. The refusal is by name, so the node is told where the feed actually lives.
/// Sends one frame as the **host**, not as a node.
///
/// `watcher.apply_changes` / `watcher.set_health` are refused to nodes (decision 5), but the host has
/// to be able to write them — that is the whole point of owning the subscription. This is the only
/// path that does, and it goes through the same table lock, so the pairing rule still holds.
fn host_frame(
    table: &mut SidecarTable,
    host: &mut (dyn NodeHost + 'static),
    method: &str,
    params: Value,
) -> Result<Option<Value>, CallError> {
    let request_id = table.next_request_id();
    let frame = json!({
        "requestVersion": FINDZ_REQUEST_VERSION,
        "requestId": request_id,
        "method": method,
        "params": params,
    })
    .to_string();
    let reply = table.request(
        PROGRAM,
        &["serve"],
        &frame,
        DEFAULT_SIDECAR_TIMEOUT,
        host,
        FINDZ_PHASE,
    )?;
    Ok(serde_json::from_str::<Value>(&reply)
        .ok()
        .filter(|parsed| parsed["ok"].as_bool().unwrap_or(false))
        .and_then(|parsed| parsed.get("result").cloned()))
}

/// Waits for the task an index mutation just created, so the node's frame answers against applied work.
///
/// `native/findz-go/scanner.go`'s `applyWatcherChanges` only *enqueues* the batch and returns the fresh
/// task record; the work happens on a goroutine. Answering the node without settling that task would
/// make this file's ordering promise ("a query issued after a change must not answer from an index the
/// host already knew was stale") untrue — it is exactly the bug the real-engine watch run caught. The wait
/// is `task.wait` rather than a poll because the realm has no timers, and it is bounded: a wedged engine
/// must not hold the node's frame open forever, and the refusal the caller then gets is the sidecar's own.
fn settle_index_task(
    table: &mut SidecarTable,
    host: &mut (dyn NodeHost + 'static),
    library_id: &str,
    task: Option<Value>,
) {
    const SETTLE_ROUNDS: usize = 8;
    const SETTLE_WAIT_MS: u64 = 1_000;

    let Some(task_id) = task
        .as_ref()
        .and_then(|result| result.get("id"))
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        return;
    };
    for _ in 0..SETTLE_ROUNDS {
        let Ok(Some(current)) = host_frame(
            table,
            host,
            "task.wait",
            json!({ "libraryId": library_id, "taskId": task_id, "timeoutMs": SETTLE_WAIT_MS }),
        ) else {
            return;
        };
        let status = current.get("status").and_then(Value::as_str).unwrap_or_default();
        if status != "running" && status != "queued" {
            return;
        }
    }
}

/// Delivers whatever the run's watches have come to believe, before the node's own frame goes out.
///
/// Order matters for the reader: a query issued after a change must not answer from an index the host
/// already knew was stale. Delivery failures follow the node service's own rules — one
/// `scan.reconcile` per degradation, and a `healthy` report when a later batch lands.
///
/// This runs before **every** node frame, `library.open` included, and needs no per-method exception:
/// the batches come off the live engine's own watch list (`sidecar.watches`), so a replacement engine
/// started after a crash has none to deliver, and the reopen that attaches one is the node's own next
/// frame. That lifetime, not an ordering trick, is what keeps a stale batch from being fed to a fresh
/// engine — `a_replacement_engine_is_watched_again_by_the_nodes_reopen` pins it.
fn flush_findz_watches(table: &mut SidecarTable, host: &mut (dyn NodeHost + 'static)) {
    let Some(sidecar) = table.live(PROGRAM) else {
        return;
    };
    for signal in drain_watch_signals(&sidecar) {
        let index = signal.index;
        let library_id = signal.library_id.clone();
        let changes = signal.changes;
        let changes = changes
            .iter()
            .map(|change| json!({ "path": change.path.to_string_lossy(), "type": change.kind.as_str() }))
            .collect::<Vec<_>>();
        let applied = host_frame(
            table,
            host,
            "watcher.apply_changes",
            json!({ "libraryId": library_id, "changes": changes }),
        )
        .ok()
        .flatten();
        let delivered = applied.is_some();
        settle_index_task(table, host, &library_id, applied);
        match report_watch_outcome(&sidecar, index, delivered) {
            WatchOutcome::Degraded(queue_reconcile) => {
                let _ = host_frame(
                    table,
                    host,
                    "watcher.set_health",
                    json!({ "libraryId": library_id, "health": "degraded" }),
                );
                if queue_reconcile {
                    // Deliberately *not* settled: a degradation reconcile is a full re-scan, and binding
                    // it to the node's frame would stall the run for minutes. The stale read it leaves is
                    // already what `watcherHealth: degraded` tells the faces about.
                    let _ = host_frame(
                        table,
                        host,
                        "scan.reconcile",
                        json!({ "libraryId": library_id }),
                    );
                }
            }
            WatchOutcome::Recovered(report_healthy) if report_healthy => {
                let _ = host_frame(
                    table,
                    host,
                    "watcher.set_health",
                    json!({ "libraryId": library_id, "health": "healthy" }),
                );
            }
            WatchOutcome::Recovered(_) => {}
        }
        if signal.stream_error {
            // The backend stopped, which the faces can only learn through the health row: a dropped
            // subscription looks exactly like a library nobody touched. `degrade()` keeps the
            // reconcile to one per degradation, same as the node's service did.
            if let WatchOutcome::Degraded(queue_reconcile) = report_watch_outcome(&sidecar, index, false) {
                let _ = host_frame(
                    table,
                    host,
                    "watcher.set_health",
                    json!({ "libraryId": library_id, "health": "degraded" }),
                );
                if queue_reconcile {
                    let _ = host_frame(
                        table,
                        host,
                        "scan.reconcile",
                        json!({ "libraryId": library_id }),
                    );
                }
            }
        }
    }
}

/// Starts watching a library the engine just opened, and reports what happened in its health row.
///
/// A subscription that cannot start is `degraded` plus one `scan.reconcile`, which is the rule the
/// deleted Bun worker followed: an open whose watch failed still has to answer, but it must not
/// claim the watcher is healthy.
fn start_library_watch(
    table: &mut SidecarTable,
    host: &mut (dyn NodeHost + 'static),
    library_id: &str,
    root: &Path,
) {
    let Some(sidecar) = table.live(PROGRAM) else {
        return;
    };
    match LibraryWatch::start(library_id, root) {
        Ok(watch) => {
            attach_watch(&sidecar, watch);
        }
        Err(_) => {
            let _ = host_frame(
                table,
                host,
                "watcher.set_health",
                json!({ "libraryId": library_id, "health": "degraded" }),
            );
            let _ = host_frame(table, host, "scan.reconcile", json!({ "libraryId": library_id }));
        }
    }
}

pub(crate) const HOST_ONLY_METHODS: [&str; 2] = ["watcher.apply_changes", "watcher.set_health"];

/// Answers one `findz` service call by asking the sidecar, starting it on the first call.
pub(crate) fn dispatch(
    method: &str,
    arguments: &Value,
    host: &mut (dyn NodeHost + 'static),
    machine: &MachineAccess,
) -> Result<HostAnswer, CallError> {
    dispatch_with_index_dir(
        method,
        arguments,
        host,
        machine,
        &index_dir(
            &host_data_root(|key| std::env::var_os(key)),
            std::env::var_os(INDEX_DIR_ENV).as_deref(),
        ),
    )
}

/// The same call with the placement resolved by the caller.
///
/// Split out because the interesting claim — "the directory the host chose is the one the engine
/// sees" — can only be tested by a value a test picks, not by recomputing the same expression the
/// production path uses.
pub(crate) fn dispatch_with_index_dir(
    method: &str,
    arguments: &Value,
    host: &mut (dyn NodeHost + 'static),
    machine: &MachineAccess,
    index_directory: &Path,
) -> Result<HostAnswer, CallError> {
    if !METHODS.contains(&method) {
        return Err(CallError::Failure(format!(
            "the findz service does not answer {method:?}; it answers: {}",
            METHODS.join(", ")
        )));
    }

    if HOST_ONLY_METHODS.contains(&method) {
        return Err(CallError::Failure(format!(
            "{method} is fed by the host's watch service, not by a node (ADR-0077 decision 5): \
             the library is read through query.* and driven through scan.* and task.*"
        )));
    }

    // The grant is checked before the engine sees a path, for the same reason `czkawka_operations`
    // checks it: the borrowed core walks whatever directory it is handed and knows nothing about
    // an operation's file grant, so the gate has to sit on this side of the pipe. `library.open`
    // is the only method that carries a root — every later method addresses the library that was
    // opened under this run's grant, and the sidecar is per-run, so a stale id from another run
    // cannot reach another user's tree.
    let mut arguments = arguments.clone();
    if method == "library.open" {
        // The index file is the core's to place, not the node's. `defaultDatabasePath`
        // (native/findz-go/database.go) already resolves it from `LOCALAPPDATA` / the platform
        // cache root as `<root>/Xiranite/findz/indexes/<library-id>.sqlite`, and the library id
        // is derived from the canonical root there — deriving it again in Rust would be a second
        // authority on the same identifier, which is the drift this rewrite keeps getting called
        // out for. A node that wants to choose the location is refused rather than ignored:
        // silently dropping the argument would leave the caller believing it took effect.
        if arguments.get("databasePath").is_some() {
            return Err(CallError::Failure(
                "library.open does not take a databasePath: the Findz core places the index under \
                 the host's data root, and its answer reports where (`result.databasePath`)."
                    .to_string(),
            ));
        }
        let root = required_text(&arguments, "root")?;
        let resolved = machine
            .files("service.invoke")?
            .resolve(root)
            .map_err(CallError::from_core)?;
        // The canonical path is what travels, not the string the node typed: a relative or
        // symlinked spelling that resolves inside the grant would otherwise be re-resolved by
        // the core under different rules, and the two answers would name different trees.
        arguments["root"] = Value::String(resolved.to_string_lossy().into_owned());
    }

    // The id is minted inside the table's lock because it is the table's counter, and it is the
    // core's idempotency key: a retried mutation must replay the receipt, so a caller that
    // retries has to reuse the id it was given rather than mint a new one here.
    let request_id = lock_sidecars(machine.sidecars()).next_request_id();
    // Taken before the frame is built, because building it moves `arguments`: the watch that starts
    // after a successful open must watch the *same canonical root* the core derived its library id
    // from, or the two would drift into indexing one tree and observing another.
    let opened_root = arguments
        .get("root")
        .and_then(Value::as_str)
        .map(str::to_string);
    let frame = json!({
        "requestVersion": FINDZ_REQUEST_VERSION,
        "requestId": request_id,
        "method": method,
        "params": arguments,
    })
    .to_string();

    let reply = {
        let mut table = lock_sidecars(machine.sidecars());
        table.set_child_env(INDEX_DIR_ENV, index_directory.as_os_str().to_os_string());
        flush_findz_watches(&mut table, host);
        table.request(
            PROGRAM,
            &["serve"],
            &frame,
            DEFAULT_SIDECAR_TIMEOUT,
            host,
            FINDZ_PHASE,
        )?
    };

    // The answer travels on unchanged. Parsing it here would put the core's error vocabulary in
    // this crate, and the node's TypeScript already turns a `{ ok: false, error }` into the
    // message the three faces print.
    let parsed = serde_json::from_str::<Value>(&reply).map_err(|error| {
        CallError::Failure(format!(
            "the findz sidecar answered something that is not a Findz envelope ({error}): {}",
            snippet(&reply)
        ))
    })?;
    if method == "library.open" {
        let opened = parsed["ok"].as_bool().unwrap_or(false);
        if let (true, Some(root), Some(library_id)) = (
            opened,
            opened_root.as_deref(),
            parsed["result"]["libraryId"].as_str(),
        ) {
            let mut table = lock_sidecars(machine.sidecars());
            start_library_watch(&mut table, host, library_id, Path::new(root));
        }
    }
    Ok(answer(parsed))
}

/// A bounded slice of a reply, for a refusal message that cannot itself be unbounded.
fn snippet(text: &str) -> String {
    let mut taken: String = text.chars().take(240).collect();
    if taken.chars().count() < text.chars().count() {
        taken.push_str(" …");
    }
    taken
}

#[cfg(test)]
mod tests {
    use std::ffi::{OsStr, OsString};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant};

    use xiranite_core::filesystem::FileCapability;

    use super::*;
    use crate::machine::MachineAccess;
    use crate::sidecar::lock_sidecars;
    use crate::test_host::CountingHost;

    /// Stages the test's stand-in engine under the bare program name the service asks for.
    ///
    /// A staging directory on the child's PATH is the only way in, because the holder refuses
    /// path-shaped names — which is also how a packaged host will find the real `findz`.
    fn staged(tag: &str) -> (PathBuf, MachineAccess) {
        let directory =
            std::env::temp_dir().join(format!("xiranite-findz-sidecar-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).expect("the staging directory exists");
        let testee = crate::sidecar::testee_binary();
        let staged_path = directory
            .join(format!("{PROGRAM}{}", std::env::consts::EXE_SUFFIX));
        fs::copy(&testee, &staged_path)
            .unwrap_or_else(|error| panic!("copying {} to {}: {error}", testee.display(), staged_path.display()));
        // The staging directory is the granted root: `library.open` is checked against
        // the operation's grant before the engine sees the path.
        let machine = MachineAccess::granted(FileCapability::new([directory.as_path()]));
        lock_sidecars(machine.sidecars()).set_staging_dir(Some(directory.clone()));
        (directory, machine)
    }

    fn cleanup(directory: &PathBuf) {
        let _ = fs::remove_dir_all(directory);
    }

    /// Reads the stand-in's count of `task.wait` frames out of an answer the node itself received.
    ///
    /// The count rides on the reply because the holder's flush frames are answered and discarded — the
    /// only place a test can see them is the next frame the node asked about.
    fn waits_seen(answered: &HostAnswer) -> u64 {
        let HostAnswer::Text(text) = answered else {
            panic!("a service answers a document");
        };
        let parsed: Value = serde_json::from_str(text).expect("the stand-in answered a document");
        parsed["result"]["waitsSeen"].as_u64().unwrap_or(0)
    }

    #[test]
    fn the_watch_feed_waits_for_the_task_it_created() {
        // `native/findz-go/scanner.go`'s `applyWatcherChanges` only enqueues the batch: the reply means
        // "a task exists", not "the index is current". The flush runs *before* the node's frame precisely
        // so a query cannot answer from an index the host knew was stale, so it has to settle that task —
        // a real-engine run caught this promise being untrue, and this is the gate that keeps it true.
        let (directory, machine) = staged("settle");
        let mut host = CountingHost::new();
        let root = directory.to_string_lossy().to_string();
        let _opened = dispatch("library.open", &json!({ "root": root.clone() }), &mut host, &machine)
            .expect("the granted root opens, and opens its watch with it");

        // Control, before anything lands: an untouched library must show zero waits. Without this the
        // assertion below could be satisfied by the stand-in counting something else entirely.
        let quiet = dispatch("query.archives", &json!({ "libraryId": "library-unused" }), &mut host, &machine);
        let errors_before = match &quiet {
            Ok(answered) => waits_seen(answered),
            Err(_) => 0,
        };
        assert_eq!(errors_before, 0, "a library nobody touched must not make the host wait on a task");

        let arrived = directory.join("settled-while-open.cbz");
        fs::write(&arrived, b"zip bytes").expect("the file lands");

        let mut seen = 0;
        let deadline = Instant::now() + Duration::from_secs(20);
        while Instant::now() < deadline {
            let answered = dispatch(
                "query.archives",
                &json!({ "libraryId": "library-unused" }),
                &mut host,
                &machine,
            );
            if let Ok(answered) = answered {
                seen = waits_seen(&answered);
                if seen > 0 {
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(300));
        }
        assert!(
            seen > 0,
            "the host delivered a watcher batch but never waited for the task it created \
             (waits seen: {seen}) — the node's frame would answer from a knowingly stale index"
        );
        cleanup(&directory);
    }

    #[test]
    fn a_wedged_watcher_task_is_released_rather_than_awaited_forever() {
        // The settle loop's bound is the only thing standing between a wedged engine and a node frame
        // that never answers. The stand-in answers `task.wait` with `queued` forever once a request
        // names a root containing "wedged", so this asserts the bound rather than trusting the constant:
        // widen it (or delete it) and the wait count below goes red.
        let (directory, machine) = staged("wedged");
        let mut host = CountingHost::new();
        let root = directory.to_string_lossy().to_string();
        dispatch("library.open", &json!({ "root": root.clone() }), &mut host, &machine)
            .expect("the granted root opens, and opens its watch with it");

        let arrived = directory.join("wedged-arrival.cbz");
        fs::write(&arrived, b"zip bytes").expect("the file lands");

        let started = Instant::now();
        let mut waits = 0;
        while started.elapsed() < Duration::from_secs(40) {
            let frame = dispatch(
                "query.archives",
                &json!({ "libraryId": "library-unused" }),
                &mut host,
                &machine,
            );
            match frame {
                Ok(answered) => {
                    waits = waits.max(waits_seen(&answered));
                    if waits > 0 {
                        break;
                    }
                }
                Err(error) => panic!(
                    "the node's frame must still answer while the watcher task is wedged: {}",
                    error.message()
                ),
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        assert!(
            waits > 0,
            "the wedged case never produced a settle at all (watch arrived?) — the bound below is then unproven"
        );
        // The lower half is what makes this a bound test rather than a presence test: the stand-in
        // answers `task.wait` immediately (its `timeoutMs` is a request parameter, not a sleep), so
        // without this assertion a settle loop that gave up after one round would look identical here
        // to one that ran to its bound.
        assert!(
            waits >= 2,
            "the host gave up waiting after {waits} round(s) while the task still reported `queued`; \
             a bounded loop must keep polling, not bail on the first non-terminal answer"
        );
        assert!(
            waits <= 8,
            "the host waited {waits} times on a task that never finishes; the settle loop is bounded at 8 rounds \
             so one wedged engine cannot hold the node's frame open indefinitely"
        );
        cleanup(&directory);
    }

    /// The capability names the Go core declares, read out of the block that declares them.
    ///
    /// Scoped to `Capabilities: []string{ … }` on purpose: a whole-file scan for quoted dots
    /// also finds `"0.1.0"` (the core version) and calls it a method, which is exactly the kind
    /// of green-but-wrong comparison this test would be worthless for.
    fn declared_capabilities() -> Vec<String> {
        let source = fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../native/findz-go/protocol.go"
        ))
        .expect("protocol.go is the fact this list copies");
        let marker = "Capabilities: []string{";
        let start = source
            .find(marker)
            .unwrap_or_else(|| panic!("{marker} is gone from protocol.go, so this comparison has no source"))
            + marker.len();
        let block = &source[start..];
        let block = &block[..block.find('}').expect("the capability list is closed")];
        block
            .split('"')
            .skip(1)
            .step_by(2)
            .map(str::to_string)
            .filter(|name| name.contains('.'))
            .collect()
    }

    #[test]
    fn the_published_method_set_equals_the_cores_declared_capabilities() {
        let declared = declared_capabilities();
        assert!(
            declared.len() >= 15,
            "the scan found only {} capability names in protocol.go, which cannot be the list",
            declared.len()
        );
        let published: std::collections::BTreeSet<&str> = METHODS.iter().copied().collect();
        let from_go: std::collections::BTreeSet<&str> =
            declared.iter().map(String::as_str).collect();
        assert_eq!(
            published, from_go,
            "the service publishes {:?} but protocol.go declares {:?}",
            METHODS, declared
        );
    }

    #[test]
    fn a_frame_crosses_the_pipe_with_the_cores_envelope() {
        let (directory, machine) = staged("frame");
        let mut host = CountingHost::new();
        let answered = dispatch(
            "query.archives",
            &json!({ "libraryId": "library-1", "page": { "limit": 10 } }),
            &mut host,
            &machine,
        )
        .expect("the staged engine answers");
        let HostAnswer::Text(text) = answered else {
            panic!("a service answers a document, never bytes");
        };
        let parsed: Value = serde_json::from_str(&text).expect("the answer is a JSON document");
        assert_eq!(parsed["ok"], json!(true));
        assert_eq!(parsed["requestId"], json!("xiranite-1"));
        // `saw` is the frame the testee received, so these are claims about what crossed the
        // pipe rather than about the testee's interpretation of it.
        let saw = &parsed["result"]["saw"];
        assert_eq!(saw["requestVersion"], json!(1));
        assert_eq!(saw["method"], json!("query.archives"));
        assert_eq!(saw["params"]["libraryId"], json!("library-1"));
        assert_eq!(saw["params"]["page"]["limit"], json!(10));
        cleanup(&directory);
    }

    #[test]
    fn ids_count_up_within_one_run() {
        let (directory, machine) = staged("ids");
        let mut host = CountingHost::new();
        for expected in 1..=3 {
            let answered = dispatch(
                "task.get",
                &json!({ "libraryId": "library-1", "taskId": "task-1" }),
                &mut host,
                &machine,
            )
            .expect("the staged engine answers");
            let HostAnswer::Text(text) = answered else {
                panic!("a service answers a document");
            };
            let parsed: Value = serde_json::from_str(&text).expect("a JSON document");
            assert_eq!(
                parsed["requestId"],
                json!(format!("xiranite-{expected}")),
                "the third request must carry the third id, not a fresh 1"
            );
        }
        cleanup(&directory);
    }

    #[test]
    fn a_root_outside_the_grant_is_refused_before_the_engine_starts() {
        // The borrowed core walks whatever directory it is handed and knows nothing about a
        // grant, so the gate has to sit on this side. If this refusal ever arrives *after* the
        // child started, the walk of somebody else's library has already happened.
        let (directory, machine) = staged("grant");
        let mut host = CountingHost::new();
        let outside = std::env::temp_dir().join("xiranite-findz-not-granted");
        let error = dispatch(
            "library.open",
            &json!({ "root": outside.to_string_lossy() }),
            &mut host,
            &machine,
        )
        .expect_err("a root outside the operation's grant must not reach the core");
        assert!(
            !matches!(error, CallError::Cancelled),
            "this is a refusal, not a cancellation: {error:?}"
        );
        assert!(
            lock_sidecars(machine.sidecars()).live_pids().is_empty(),
            "the refusal started an engine anyway: {:?}",
            lock_sidecars(machine.sidecars()).live_pids()
        );
        cleanup(&directory);
    }

    #[test]
    fn the_index_directory_the_host_chose_reaches_the_engine() {
        // Two different placements through two fresh runs: an assertion that only checked
        // "something came back" would pass on a constant, so the pair is the point.
        let (directory, machine) = staged("place-a");
        let mut host = CountingHost::new();
        let chosen = directory.join("data-root/findz/indexes");
        let first = dispatch_with_index_dir(
            "query.archives",
            &json!({ "libraryId": "library-1" }),
            &mut host,
            &machine,
            &chosen,
        )
        .expect("the call answers");
        let HostAnswer::Text(text) = first else {
            panic!("a service answers a document");
        };
        let parsed: Value = serde_json::from_str(&text).expect("a JSON document");
        assert_eq!(
            parsed["result"]["indexDir"],
            json!(chosen.to_string_lossy()),
            "the child must see exactly the directory the host resolved"
        );
        drop(machine);
        cleanup(&directory);

        let (second_directory, second_machine) = staged("place-b");
        let mut second_host = CountingHost::new();
        let other = second_directory.join("elsewhere");
        let answered = dispatch_with_index_dir(
            "query.archives",
            &json!({ "libraryId": "library-1" }),
            &mut second_host,
            &second_machine,
            &other,
        )
        .expect("the second run answers");
        let HostAnswer::Text(second_text) = answered else {
            panic!("a service answers a document");
        };
        let second_parsed: Value = serde_json::from_str(&second_text).expect("a JSON document");
        assert_eq!(
            second_parsed["result"]["indexDir"],
            json!(other.to_string_lossy()),
            "a second run must carry its own placement, not the first one's"
        );
        cleanup(&second_directory);
    }

    #[test]
    fn a_relocated_data_root_takes_the_indexes_with_it() {
        // `PathContext::data_dir()` is the platform location and deliberately ignores
        // `XIRANITE_DATA_DIR`; without this arm a portable install would move its config and leave
        // its indexes behind — the failure mode this test was written for.
        let relocated = index_dir(
            &host_data_root(|key| (key == DATA_DIR_ENV).then(|| OsString::from("/portable/data"))),
            None,
        );
        assert_eq!(
            relocated,
            PathBuf::from("/portable/data/findz/indexes"),
            "an explicit data root must carry the index placement"
        );
        // Positive control for the same gauge: with the variable unset the platform root wins, so
        // the assertion above is not just passing because the lookup always returns the same thing.
        let platform = index_dir(
            &host_data_root(|key| (key == "XIRANITE_NOTHING_SET").then(|| OsString::from("x"))),
            None,
        );
        assert_eq!(
            platform.parent().and_then(Path::file_name),
            PathContext::from_environment().data_dir().join("findz").file_name(),
            "the platform data root must be the fallback, ending in …/Xiranite"
        );
        assert!(
            platform.starts_with(PathContext::from_environment().data_dir()),
            "fallback path escaped the platform data root: {platform:?}"
        );
    }

    #[test]
    fn index_dir_prefers_an_explicit_override_and_else_sits_under_the_data_root() {
        let data_root = Path::new("/host/data");
        assert_eq!(
            index_dir(data_root, None),
            PathBuf::from("/host/data/findz/indexes"),
            "the default placement is under the host's data root"
        );
        assert_eq!(
            index_dir(data_root, Some(OsStr::new("/portable/indexes"))),
            PathBuf::from("/portable/indexes"),
            "a portable install must be able to move the indexes wholesale"
        );
        // An empty override is "not set", not "put it in the working directory": accepting it
        // would make the index path relative to whatever the host happened to cd into.
        assert_eq!(
            index_dir(data_root, Some(OsStr::new(""))),
            PathBuf::from("/host/data/findz/indexes"),
            "an empty override must fall through to the data root"
        );
    }

    #[test]
    fn a_node_supplied_index_path_is_refused_not_ignored() {
        // Two halves: the refusal must happen, and it must happen before anything starts. A host
        // that quietly dropped the argument would pass the first half and fail the design.
        let (directory, machine) = staged("dbpath");
        let mut host = CountingHost::new();
        let error = dispatch(
            "library.open",
            &json!({
                "root": directory.to_string_lossy(),
                "databasePath": "/elsewhere/somebody-elses-index.sqlite",
            }),
            &mut host,
            &machine,
        )
        .expect_err("a node must not choose where the index is written");
        assert!(
            error.message().contains("does not take a databasePath"),
            "{}",
            error.message()
        );
        assert!(
            lock_sidecars(machine.sidecars()).live_pids().is_empty(),
            "the refusal came after an engine had already started"
        );
        cleanup(&directory);
    }

    #[test]
    fn a_granted_root_travels_as_the_canonical_path() {
        // On macOS `temp_dir()` is `/var/folders/…` while its canonical form is
        // `/private/var/folders/…`, so this assertion can only pass if the host actually rewrote
        // the path. A test that passed on both spellings would prove nothing.
        let (directory, machine) = staged("canonical");
        let mut host = CountingHost::new();
        let answered = dispatch(
            "library.open",
            &json!({ "root": directory.to_string_lossy() }),
            &mut host,
            &machine,
        )
        .expect("the granted root is allowed through");
        let HostAnswer::Text(text) = answered else {
            panic!("a service answers a document");
        };
        let parsed: Value = serde_json::from_str(&text).expect("the core answered a document");
        let sent_root = parsed["result"]["saw"]["params"]["root"]
            .as_str()
            .expect("the core saw a root");
        let canonical = std::path::Path::new(&directory)
            .canonicalize()
            .expect("the staging directory canonicalizes");
        assert_eq!(
            sent_root,
            canonical.to_string_lossy().as_ref(),
            "the core must receive the canonical path, not the string the node typed"
        );
        cleanup(&directory);
    }

    #[test]
    fn a_replacement_engine_is_watched_again_by_the_nodes_reopen() {
        // The feed must survive a crash. What makes it survive is *not* a restart hook in the table
        // (I built one, then measured that this test passes without it: the core's ensure-open means
        // the node re-opens on the next action anyway, so a hook table would be abstraction for a
        // case that cannot occur). It survives because `library.open` attaches a watch to whichever
        // engine answers it, dead handle or new one.
        use std::time::{Duration, Instant};

        let (directory, machine) = staged("watch-restart");
        let root = directory.canonicalize().expect("the staging directory canonicalizes");
        let mut host = CountingHost::new();
        let open = |host: &mut CountingHost| {
            dispatch(
                "library.open",
                &json!({ "root": root.to_string_lossy() }),
                host,
                &machine,
            )
            .ok()
        };
        let library_id_of = |answer: Option<HostAnswer>| match answer {
            Some(HostAnswer::Text(text)) => serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|parsed| parsed["result"]["libraryId"].as_str().map(str::to_string)),
            _ => None,
        };
        let first_id = library_id_of(open(&mut host)).expect("the first open answers");
        let dead_pid = lock_sidecars(machine.sidecars())
            .live_pids()
            .into_iter()
            .next()
            .expect("the open started an engine");

        std::process::Command::new("kill")
            .args(["-9", &dead_pid.to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .expect("the external kill runs");
        assert!(
            dispatch(
                "query.archives",
                &json!({ "libraryId": first_id, "page": { "limit": 1 } }),
                &mut host,
                &machine,
            )
            .is_err(),
            "a call into a killed engine must fail rather than pretend"
        );
        let second_id = library_id_of(open(&mut host)).expect("the node's re-open answers");
        assert_eq!(first_id, second_id, "the id comes from the root, so the re-open is the same library");
        let restarted = lock_sidecars(machine.sidecars())
            .live_pids()
            .into_iter()
            .next()
            .expect("the re-open started one");
        assert_ne!(restarted, dead_pid, "the replacement engine is a different process");

        let arrived = root.join("dropped-after-restart.cbz");
        fs::write(&arrived, b"zip bytes").expect("the file lands");
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut seen = Vec::new();
        while Instant::now() < deadline {
            let sidecar = lock_sidecars(machine.sidecars())
                .live(PROGRAM)
                .expect("the replacement engine is live");
            let drained = drain_watch_signals(&sidecar)
                .into_iter()
                .flat_map(|signal| signal.changes)
                .collect::<Vec<_>>();
            if !drained.is_empty() {
                seen = drained;
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        assert!(
            seen.iter().any(|change| change.path == arrived),
            "the engine that came back after the crash is not watched: a file dropped after the \
             restart never reached a buffer (pid {restarted})"
        );
        cleanup(&directory);
    }

    #[test]
    fn the_host_can_feed_the_engine_what_a_node_is_refused() {
        // The asymmetry decision 5 rests on: the same `watcher.apply_changes` frame a node may not
        // send is what the host's watch must be able to send. Both halves are asserted — a test that
        // only checked the delivery would also pass with the node-facing door left open.
        use std::time::{Duration, Instant};

        let (directory, machine) = staged("watch-delivery");
        // The holder resolves the grant, so the watch is rooted at the canonical path; comparing a
        // path built from the unresolved temp dir would fail the same way `/var` vs `/private/var`.
        let root = directory.canonicalize().expect("the staging directory canonicalizes");
        let mut host = CountingHost::new();
        let opened = dispatch(
            "library.open",
            &json!({ "root": root.to_string_lossy() }),
            &mut host,
            &machine,
        )
        .expect("the granted root opens");
        let HostAnswer::Text(text) = opened else {
            panic!("a service answers a document");
        };
        let parsed: Value = serde_json::from_str(&text).expect("the stand-in answered a document");
        let library_id = parsed["result"]["libraryId"]
            .as_str()
            .expect("the open answer names its library")
            .to_string();

        // A file dropped into the watched root must reach the buffer. The notify half of this is
        // covered live in `watch::tests`; here it only has to produce a real batch.
        let arrived = root.join("dropped-while-open.cbz");
        fs::write(&arrived, b"zip bytes").expect("the file lands");
        let sidecar = lock_sidecars(machine.sidecars())
            .live(PROGRAM)
            .expect("the open started an engine");
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut batch = Vec::new();
        while Instant::now() < deadline {
            let drained = crate::sidecar::drain_watch_signals(&sidecar)
                .into_iter()
                .flat_map(|signal| signal.changes)
                .collect::<Vec<_>>();
            if !drained.is_empty() {
                batch = drained;
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        assert!(
            batch.iter().any(|change| change.path == arrived),
            "the watch `library.open` attached never saw the file dropped into its root \
             (buffer empty for 10 s); batch was {batch:?}"
        );

        // The host's own frame goes through, in the vocabulary the Go core asserts on.
        let reply = {
            let mut table = lock_sidecars(machine.sidecars());
            host_frame(
                &mut table,
                &mut host,
                "watcher.apply_changes",
                json!({
                    "libraryId": library_id,
                    "changes": [{ "path": arrived.to_string_lossy(), "type": "create" }],
                }),
            )
            .expect("the host's feed frame is answered")
        };
        assert!(reply.is_some(), "the engine refused the host's own frame");

        // …and a node asking for the same thing is still refused.
        let error = dispatch(
            "watcher.apply_changes",
            &json!({ "libraryId": library_id.clone(), "changes": [] }),
            &mut host,
            &machine,
        )
        .expect_err("a node may not feed the index");
        assert!(
            error.message().contains("watch service"),
            "{}",
            error.message()
        );

        drop(sidecar);
        cleanup(&directory);
    }

    #[test]
    fn the_watch_feed_is_refused_to_nodes_and_names_where_it_lives() {
        // ADR-0077 decision 5: the host's `notify` service feeds these two engine methods. A node
        // that calls them can delete index rows for archives that are still on disk, because the
        // core takes a change for granted as long as the path is inside the root it was opened
        // with (`scanner.go`: `pathWithinRoot` then `deleteArchiveByPath`).
        let (directory, machine) = staged("watch-feed");
        let mut host = CountingHost::new();
        for method in HOST_ONLY_METHODS {
            let error = dispatch(
                method,
                &json!({ "libraryId": "library-x", "changes": [], "health": "ok" }),
                &mut host,
                &machine,
            )
            .expect_err("a node may not drive the watch feed");
            assert!(
                error.message().contains("watch service"),
                "{method}: {}",
                error.message()
            );
            assert!(
                lock_sidecars(machine.sidecars()).live_pids().is_empty(),
                "{method} reached the engine, so a child started before the refusal"
            );
        }

        // Positive control: the gate is exactly these two names wide. A method a node *is* allowed
        // has to get through it and actually cross the pipe, or the refusal above would be a
        // blanket "nothing works" that still reads as a passing gate.
        let answered = dispatch(
            "query.archives",
            &json!({ "libraryId": "library-x", "page": { "limit": 5 } }),
            &mut host,
            &machine,
        )
        .expect("a node-callable method must not be caught by the watch-feed gate");
        let HostAnswer::Text(text) = answered else {
            panic!("a service answers a document");
        };
        let parsed: Value = serde_json::from_str(&text).expect("the engine answered a document");
        assert_eq!(
            parsed["result"]["saw"]["method"].as_str(),
            Some("query.archives"),
            "the frame that crossed the pipe is not the one the node asked for: {text}"
        );
        cleanup(&directory);
    }

    #[test]
    fn an_undeclared_method_is_a_refusal_that_names_the_set() {
        let (directory, machine) = staged("refusal");
        let mut host = CountingHost::new();
        let error = dispatch("delete.everything", &json!({}), &mut host, &machine)
            .expect_err("the service must not forward a method the core never declared");
        assert!(
            error.message().contains("delete.everything"),
            "the refusal must name what was asked: {}",
            error.message()
        );
        assert!(
            error.message().contains("projection.treemap"),
            "the refusal has to say what the service does answer: {}",
            error.message()
        );
        cleanup(&directory);
    }

}
