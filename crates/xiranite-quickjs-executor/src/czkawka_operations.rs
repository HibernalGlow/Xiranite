//! The duplicate-find engine as a host service (ADR-0074 §1/§4).
//!
//! ## Why this exists instead of the addon
//!
//! The `czkawka` node always ran one borrowed engine: crates.io `czkawka_core`, wrapped by
//! `native/czkawka-core`. Until now the node reached it through a NAPI addon
//! (`packages/czkawka-native` → `createRequire` → `.node`), which a QuickJS realm cannot load — that
//! is `owithu`'s blocker class, and it is why the node's platform face was the one part of it that
//! could not move off Node. The engine is now linked into the host and driven from here, so the
//! node's TypeScript stays the one implementation and the borrowed Rust stays the one engine.
//!
//! ## Why the vocabulary is not duplicated
//!
//! The node owns its progress wording: `nativeProgressPercent` / `nativeProgressMessage` in
//! `packages/nodes/czkawka/src/core.ts` turn a progress snapshot into the events the three faces
//! print. So the host never emits a progress event of its own. It answers a *snapshot* and the node
//! formats it — one vocabulary, matching the rule that a node's word list is written once.
//!
//! ## Why a poll rather than a callback
//!
//! The realm has no timers (measured: no `setTimeout`/`setInterval` anywhere in this crate), and the
//! old face drove cancel-and-progress off a 100 ms `setInterval`. `czkawka.scan.progress` is a
//! long-poll the awaiting bundle calls in a loop: the scan runs on its own worker thread, and each
//! call drains whatever the engine reported since the last round. That keeps the pump in charge of
//! the wait, so [`crate::host_calls::checkpoint`] still sees the operation's pause and cancel on
//! every round — the reason the loop lives here and not in a realm timer.
//!
//! ## The grant is enforced before the engine sees a path
//!
//! The engine takes bare directory lists and walks them itself (`common/dir_traversal.rs` upstream),
//! so nothing in it would respect an operation's file grant. Every included, reference and excluded
//! directory is canonicalized through [`xiranite_core::filesystem::FileCapability::resolve`] first,
//! and a path outside the grant is a refusal. That also means an excluded directory that does not
//! exist is refused rather than silently ignored — stated cost of putting the walk behind a grant.

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crossbeam_channel::Receiver;
use serde_json::{Value, json};
use xiranite_czkawka_core::{
    BasicScanOptions, BasicScanResult, BasicTool, DuplicateCheckMethod, DuplicateHashType,
    DuplicateScanOptions, DuplicateScanResult, ScanControl, ScanProgress, czkawka_info, initialize_threads,
    scan_basic_files_controlled, scan_duplicate_files_controlled,
};
use xiranite_node_registry::NodeHost;

use crate::host_calls::{CallError, HostAnswer, answer, checkpoint, required_text};
use crate::machine::MachineAccess;

/// The checkpoint phase named in the operation log while a bundle polls a live scan.
const SCAN_PHASE: &str = "czkawka-scan";

/// How many scans one run may have going at once.
///
/// The engine sizes its own rayon pool per scan, so an unbounded count here is a node asking the host
/// for an unbounded number of workers. A refusal above the cap is the budget speaking (`NodeRequirements`'
/// concurrency half), not a crash waiting to happen.
const MAX_LIVE_SCANS: usize = 4;

/// The largest `threadCount` one scan may ask for.
const MAX_SCAN_THREADS: usize = 64;

/// How long a `scan.progress` call waits for a report before answering what it has.
const DEFAULT_PROGRESS_WAIT_MS: u64 = 50;

/// The ceiling on that wait, so a bundle cannot park the pump on one call.
const MAX_PROGRESS_WAIT_MS: u64 = 1_000;

/// How the bounded wait is chopped up: short sleeps with the session table released between them.
const PROGRESS_RETRY_SLEEP_MS: u64 = 5;

/// One scan the host started and has not handed back yet.
struct ScanSession {
    /// The engine call, running. `is_finished()` is how a poll learns the scan is over without blocking.
    ///
    /// It answers a JSON document rather than one result type because one table holds every scan kind
    /// this service can start: a duplicate run and a basic run differ only in the engine call, and the
    /// poll, the cancel flag and the progress channel are identical for all of them.
    worker: JoinHandle<Result<Value, String>>,
    /// The flag the engine reads per entry and between stages.
    stop: Arc<AtomicBool>,
    /// The engine's progress reports, drained into [`ScanSession::newest`] on every poll.
    receiver: Receiver<ScanProgress>,
    /// The most recent snapshot seen, so a poll can answer it without a second channel.
    newest: Option<ScanProgress>,
}

thread_local! {
    /// The scans this run has started. A run is driven by one pump thread for its whole life
    /// (`src/jobs.rs`), which is what makes thread storage the right scope: a second run on another
    /// thread cannot poll a first run's scan, and the map is gone with the thread.
    static SCAN_SESSIONS: RefCell<HashMap<String, ScanSession>> = RefCell::new(HashMap::new());
}

/// The methods this engine answers, spelled once here and published by the service table.
///
/// `host_services` reads this constant rather than repeating the names: a table that lists a method the
/// dispatcher refuses (or omits one it answers) is invisible to a unit test that calls the dispatcher
/// directly, which is how a real gap was found from the realm side instead.
pub(crate) const METHODS: &[&str] = &["info", "scan.duplicates", "scan.basic", "scan.progress", "scan.cancel"];

/// Answers one `czkawka` service method.
pub(crate) fn dispatch(
    method: &str,
    arguments: &Value,
    host: &mut (dyn NodeHost + 'static),
    machine: &MachineAccess,
) -> Result<HostAnswer, CallError> {
    match method {
        "info" => Ok(answer(info_document())),
        "scan.duplicates" => start_duplicates_scan(arguments, machine),
        "scan.basic" => start_basic_scan(arguments, machine),
        "scan.progress" => poll_scan(arguments, host),
        "scan.cancel" => cancel_scan(arguments),
        other => Err(CallError::Failure(format!(
            "the czkawka service does not answer {other:?}; it answers: info, scan.duplicates, scan.basic, scan.progress, scan.cancel"
        ))),
    }
}

/// The engine's own identity, in the shape `CzkawkaRuntimeInfo` reads.
fn info_document() -> Value {
    let info = czkawka_info();
    json!({
        "apiVersion": info.api_version,
        "sourceVersion": info.source_version,
        "capabilities": info.capabilities,
    })
}

/// What every scan kind needs before its own options are read.
struct ScanRequest {
    scan_id: String,
    included: Vec<PathBuf>,
    reference: Vec<PathBuf>,
    excluded: Vec<PathBuf>,
    requested_threads: usize,
}

/// Reads the identity and the directories, authorizing each against the operation's grant.
///
/// `operation` is the caller's wire name so a refusal names the call the bundle actually made.
fn read_request(operation: &str, arguments: &Value, machine: &MachineAccess) -> Result<ScanRequest, CallError> {
    let scan_id = required_text(arguments, "scanId")?.to_string();
    let files = machine.files(operation)?;
    let included = authorize_all(files, string_list(arguments, "includedDirectories"))?;
    if included.is_empty() {
        return Err(CallError::Failure(format!("{operation} needs a non-empty `includedDirectories`")));
    }
    Ok(ScanRequest {
        scan_id,
        included,
        reference: authorize_all(files, string_list(arguments, "referenceDirectories"))?,
        excluded: authorize_all(files, string_list(arguments, "excludedDirectories"))?,
        requested_threads: arguments
            .get("threadCount")
            .and_then(Value::as_u64)
            .unwrap_or(1)
            .clamp(1, MAX_SCAN_THREADS as u64) as usize,
    })
}

/// Puts a started scan in the run's table and answers its id.
///
/// The body runs on its own thread because the engine blocks: it walks the tree and hashes files with
/// its own rayon pool, and the pump thread has to stay free to answer the bundle's other calls.
fn begin_scan(request: &ScanRequest, body: impl FnOnce(ScanControl) -> Result<Value, String> + Send + 'static) -> Result<HostAnswer, CallError> {
    // The engine's rayon pool is a process-wide `OnceLock`: whoever scans first sets the size for the
    // whole host. The answer says which number won, so a node that asked for 16 and got 4 can see it.
    let threads = initialize_threads(request.requested_threads);
    let stop = Arc::new(AtomicBool::new(false));
    let (control, receiver) = ScanControl::channel(Arc::clone(&stop));
    let worker = std::thread::spawn(move || body(control));

    SCAN_SESSIONS.with(|sessions| {
        let mut sessions = sessions.borrow_mut();
        // A scan whose result nobody polled is finished work; the worker thread has already returned,
        // so dropping its handle detaches nothing. Reaping here is what keeps a bundle that abandoned
        // a scan from eating the concurrency budget of the next one.
        sessions.retain(|_, session| !session.worker.is_finished());
        if sessions.len() >= MAX_LIVE_SCANS {
            return Err(CallError::Failure(format!(
                "this run already has {MAX_LIVE_SCANS} czkawka scans in flight; finish or cancel one before starting another"
            )));
        }
        if sessions.insert(
            request.scan_id.clone(),
            ScanSession {
                worker,
                stop,
                receiver,
                newest: None,
            },
        )
        .is_some()
        {
            return Err(CallError::Failure(format!(
                "a czkawka scan with id {:?} is already running in this run",
                request.scan_id
            )));
        }
        Ok(answer(json!({ "scanId": request.scan_id, "threads": threads })))
    })
}

/// The shared option fields the retained nodes' `to*ScanOptions` all emit.
fn common_options(arguments: &Value, request: &ScanRequest) -> (Vec<PathBuf>, String, String, u64, u64) {
    (
        request.excluded.clone(),
        text_or(arguments, "allowedExtensions"),
        text_or(arguments, "excludedExtensions"),
        number_or(arguments, "minimumFileSize", 1),
        number_or(arguments, "maximumFileSize", u64::MAX),
    )
}

/// Starts one duplicate scan: the hash-or-name search whose result is a set of groups.
fn start_duplicates_scan(arguments: &Value, machine: &MachineAccess) -> Result<HostAnswer, CallError> {
    let operation = "czkawka.scan.duplicates";
    let request = read_request(operation, arguments, machine)?;
    let (excluded, allowed_extensions, excluded_extensions, minimum_file_size, maximum_file_size) =
        common_options(arguments, &request);
    if minimum_file_size > maximum_file_size {
        return Err(CallError::Failure(
            "czkawka.scan.duplicates needs minimumFileSize <= maximumFileSize".to_string(),
        ));
    }

    let check_method = match arguments.get("checkMethod").and_then(Value::as_str).unwrap_or("hash") {
        "name" => DuplicateCheckMethod::Name,
        "size" => DuplicateCheckMethod::Size,
        "size-and-name" | "sizeAndName" => DuplicateCheckMethod::SizeAndName,
        "hash" => DuplicateCheckMethod::Hash,
        other => {
            return Err(CallError::Failure(format!(
                "{operation} does not check by {other:?}; this host answers: name, size, size-and-name, hash"
            )));
        }
    };
    let hash_type = match arguments.get("hashType").and_then(Value::as_str).unwrap_or("blake3") {
        "crc32" => DuplicateHashType::Crc32,
        "xxh3" => DuplicateHashType::Xxh3,
        "blake3" => DuplicateHashType::Blake3,
        other => {
            return Err(CallError::Failure(format!(
                "{operation} does not hash with {other:?}; this host answers: crc32, xxh3, blake3"
            )));
        }
    };

    let options = DuplicateScanOptions {
        included_directories: request.included.clone(),
        reference_directories: request.reference.clone(),
        excluded_directories: excluded,
        excluded_items: string_list(arguments, "excludedItems"),
        allowed_extensions,
        excluded_extensions,
        minimum_file_size,
        maximum_file_size,
        recursive: bool_or(arguments, "recursive", true),
        use_cache: bool_or(arguments, "useCache", false),
        save_also_as_json: bool_or(arguments, "saveAlsoAsJson", false),
        delete_outdated_cache: bool_or(arguments, "deleteOutdatedCache", true),
        minimal_cache_file_size: number_or(arguments, "minimalCacheFileSize", 256 * 1024),
        minimal_prehash_cache_file_size: number_or(arguments, "minimalPrehashCacheFileSize", 256 * 1024),
        ignore_hard_links: bool_or(arguments, "ignoreHardLinks", true),
        use_prehash: bool_or(arguments, "usePrehash", true),
        case_sensitive_names: bool_or(arguments, "caseSensitiveNames", false),
        check_method,
        hash_type,
    };

    begin_scan(&request, move |control| {
        scan_duplicate_files_controlled(options, &control).map(duplicate_result_document).map_err(|error| error.to_string())
    })
}

/// The six `scan.basic` tools, spelled by the wire name the node sends.
fn basic_tool(operation: &str, raw: &str) -> Result<BasicTool, CallError> {
    Ok(match raw {
        "big-files" => BasicTool::BigFiles,
        "empty-files" => BasicTool::EmptyFiles,
        "empty-folders" => BasicTool::EmptyFolders,
        "temporary-files" => BasicTool::TemporaryFiles,
        "invalid-symlinks" => BasicTool::InvalidSymlinks,
        "bad-names" => BasicTool::BadNames,
        other => {
            return Err(CallError::Failure(format!(
                "{operation} does not scan {other:?}; this host answers: big-files, empty-files, empty-folders, temporary-files, invalid-symlinks, bad-names"
            )));
        }
    })
}

/// Starts one `scan.basic` run: a flat entry list, no grouping.
///
/// The tool is read from the request because the node's `tool` field carries one of six spellings and
/// the engine's `BasicTool` is the same choice in different letters — the mapping is the whole cost of
/// these six modes, which is why they share one service method.
fn start_basic_scan(arguments: &Value, machine: &MachineAccess) -> Result<HostAnswer, CallError> {
    let operation = "czkawka.scan.basic";
    let request = read_request(operation, arguments, machine)?;
    let tool = basic_tool(operation, required_text(arguments, "tool")?)?;
    let (excluded, allowed_extensions, excluded_extensions, minimum_file_size, maximum_file_size) =
        common_options(arguments, &request);
    if minimum_file_size > maximum_file_size {
        return Err(CallError::Failure(
            "czkawka.scan.basic needs minimumFileSize <= maximumFileSize".to_string(),
        ));
    }

    let options = BasicScanOptions {
        tool,
        included_directories: request.included.clone(),
        reference_directories: request.reference.clone(),
        excluded_directories: excluded,
        excluded_items: string_list(arguments, "excludedItems"),
        allowed_extensions,
        excluded_extensions,
        recursive: bool_or(arguments, "recursive", true),
        minimum_file_size,
        maximum_file_size,
        use_cache: bool_or(arguments, "useCache", false),
        save_also_as_json: bool_or(arguments, "saveAlsoAsJson", false),
        delete_outdated_cache: bool_or(arguments, "deleteOutdatedCache", true),
        number_of_files: number_or(arguments, "numberOfFiles", 10) as usize,
        biggest_first: bool_or(arguments, "biggestFirst", true),
        empty_files_search_zero_byte_content: bool_or(arguments, "emptyFilesSearchZeroByteContent", true),
        empty_files_search_non_printable_content: bool_or(arguments, "emptyFilesSearchNonPrintableContent", false),
        temporary_file_extensions: arguments
            .get("temporaryFileExtensions")
            .map(|_| string_list(arguments, "temporaryFileExtensions")),
    };

    begin_scan(&request, move |control| {
        scan_basic_files_controlled(options, &control).map(basic_result_document).map_err(|error| error.to_string())
    })
}

/// Answers one live scan's newest progress, and its result document once the engine has returned.
///
/// The optional `waitMs` (default [`DEFAULT_PROGRESS_WAIT_MS`]) is what makes this a long-poll rather
/// than a spin: the realm has no timers, so a bundle that polls in an `await` loop would otherwise
/// round-trip the pump as fast as it can turn. The wait is bounded and is spent in short sleeps with
/// the session table released between them, so nothing holds a borrow across a park.
fn poll_scan(arguments: &Value, host: &mut (dyn NodeHost + 'static)) -> Result<HostAnswer, CallError> {
    let scan_id = required_text(arguments, "scanId")?.to_string();
    // The wait is here, so this is the round's yield point: a paused operation parks the bundle inside
    // this call, and a cancelled one travels back as `Cancelled` rather than as another empty poll.
    checkpoint(host, SCAN_PHASE)?;

    let wait_ms = arguments
        .get("waitMs")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_PROGRESS_WAIT_MS)
        .min(MAX_PROGRESS_WAIT_MS);
    let deadline = Instant::now() + Duration::from_millis(wait_ms);
    let round = loop {
        let round = SCAN_SESSIONS.with(|sessions| {
            let mut sessions = sessions.borrow_mut();
            let Some(session) = sessions.get_mut(&scan_id) else {
                return Round::Gone;
            };
            while let Ok(progress) = session.receiver.try_recv() {
                session.newest = Some(progress);
            }
            let progress = session.newest.as_ref().map(progress_document);
            if !session.worker.is_finished() {
                return Round::Running { progress };
            }
            // The result is consumed by this round, so the session leaves the table with it and the
            // concurrency budget is returned.
            let session = sessions.remove(&scan_id).expect("the lookup above just held for this id");
            match session.worker.join() {
                Ok(Ok(result)) => Round::Done {
                    answer: Ok(answer(json!({
                        "done": true,
                        "progress": progress,
                        "result": result,
                    }))),
                },
                // An engine refusal is data, and it rejects the awaited promise the way the addon's
                // rejection did, so the node's own `catch` still produces its own failure message.
                Ok(Err(message)) => Round::Refused { message },
                // A panic in the engine's thread says nothing about what it read, and the seam's rule is
                // that an error is data the node can show — so this is a refusal with the scan id in it.
                Err(_) => Round::Refused {
                    message: format!("the czkawka scan thread for {scan_id:?} panicked"),
                },
            }
        });
        match round {
            Round::Running { .. } if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(PROGRESS_RETRY_SLEEP_MS));
                continue;
            }
            other => break other,
        }
    };

    match round {
        Round::Gone => Err(CallError::Failure(format!(
            "no czkawka scan with id {scan_id:?} is live in this run"
        ))),
        Round::Refused { message } => Err(CallError::Failure(message)),
        Round::Done { answer } => answer,
        Round::Running { progress } => Ok(answer(json!({
            "done": false,
            "progress": progress,
            "result": Value::Null,
        }))),
    }
}

/// One round of [`poll_scan`], before the caller decides whether to wait again.
enum Round {
    /// The id is not live in this run.
    Gone,
    /// Still scanning; the newest snapshot seen so far, if the engine has reported one.
    Running { progress: Option<Value> },
    /// Scanning ended, and its document is ready to hand back.
    Done { answer: Result<HostAnswer, CallError> },
    /// The engine refused, or its thread panicked.
    Refused { message: String },
}

/// Asks a live scan to stop. An id that is gone answers `false` rather than failing, because the
/// bundle's cancel loop is still running when the scan has already returned its result.
fn cancel_scan(arguments: &Value) -> Result<HostAnswer, CallError> {
    let scan_id = required_text(arguments, "scanId")?.to_string();
    let stopped = SCAN_SESSIONS.with(|sessions| {
        sessions
            .borrow_mut()
            .get(&scan_id)
            .is_some_and(|session| {
                session.stop.store(true, Ordering::Relaxed);
                true
            })
    });
    Ok(answer(json!({ "scanId": scan_id, "stopped": stopped })))
}

/// One progress snapshot, in the field names `CzkawkaNativeProgress` reads.
fn progress_document(progress: &ScanProgress) -> Value {
    json!({
        "stage": progress.stage,
        "stageIndex": progress.stage_index,
        "stageCount": progress.stage_count,
        "entriesChecked": progress.entries_checked,
        "entriesTotal": progress.entries_total,
        "bytesChecked": progress.bytes_checked,
        "bytesTotal": progress.bytes_total,
    })
}

/// The engine's duplicate result, in the field names `DuplicateScanResult` reads.
///
/// The core derives no `Serialize`, so this is the one place the mapping is spelled — a hand-written
/// document rather than a derive on a borrowed crate.
fn duplicate_result_document(scan: DuplicateScanResult) -> Value {
    let groups: Vec<Value> = scan
        .groups
        .into_iter()
        .map(|group| {
            let files: Vec<Value> = group
                .files
                .into_iter()
                .map(|file| {
                    json!({
                        "path": file.path.to_string_lossy(),
                        "modifiedDate": file.modified_date,
                        "size": file.size,
                        "hash": file.hash,
                        "isReference": file.is_reference,
                    })
                })
                .collect();
            json!({ "files": files })
        })
        .collect();
    json!({ "groups": groups, "messages": scan.messages, "stopped": scan.stopped })
}

/// A `scan.basic` answer, in the field names `BasicEntry`/`BasicScanResult` read.
///
/// The two optional fields are *absent* rather than `null` when the engine had nothing to say, because
/// that is what the addon answered and what the node's `{ ...entry }` spreads forward — a key holding
/// `null` would overwrite the `detail` the node composes for a row it displays.
fn basic_result_document(scan: BasicScanResult) -> Value {
    let entries: Vec<Value> = scan
        .entries
        .into_iter()
        .map(|entry| {
            let mut row = serde_json::Map::new();
            row.insert("path".to_string(), Value::String(entry.path.to_string_lossy().into_owned()));
            row.insert("size".to_string(), json!(entry.size));
            row.insert("modifiedDate".to_string(), json!(entry.modified_date));
            if let Some(secondary) = entry.secondary_path {
                row.insert("secondaryPath".to_string(), Value::String(secondary.to_string_lossy().into_owned()));
            }
            if let Some(detail) = entry.detail {
                row.insert("detail".to_string(), Value::String(detail));
            }
            Value::Object(row)
        })
        .collect();
    json!({ "entries": entries, "messages": scan.messages, "stopped": scan.stopped })
}

/// Resolves every directory through the grant, refusing the first one outside it.
fn authorize_all(
    files: &xiranite_core::filesystem::FileCapability,
    directories: Vec<String>,
) -> Result<Vec<PathBuf>, CallError> {
    directories
        .iter()
        .map(|directory| files.resolve(directory).map_err(CallError::from_core))
        .collect()
}

fn string_list(arguments: &Value, key: &str) -> Vec<String> {
    arguments
        .get(key)
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn text_or(arguments: &Value, key: &str) -> String {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn bool_or(arguments: &Value, key: &str, default: bool) -> bool {
    arguments.get(key).and_then(Value::as_bool).unwrap_or(default)
}

fn number_or(arguments: &Value, key: &str, default: u64) -> u64 {
    arguments.get(key).and_then(Value::as_u64).unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::time::{Duration, Instant};

    use xiranite_core::filesystem::FileCapability;

    use super::*;
    use crate::test_host::CountingHost;

    /// A directory with two identical files and one unique one, unique per test tag.
    fn granted_tree(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("xiranite-czkawka-ops-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("the fixture root exists");
        fs::write(root.join("first.bin"), vec![7u8; 4096]).expect("first copy written");
        fs::write(root.join("second.bin"), vec![7u8; 4096]).expect("second copy written");
        fs::write(root.join("unique.bin"), vec![9u8; 4096]).expect("unique file written");
        root
    }

    fn scan_arguments(root: &Path, scan_id: &str) -> Value {
        json!({
            "scanId": scan_id,
            "includedDirectories": [root.to_string_lossy()],
            "threadCount": 2,
            "minimumFileSize": 1,
        })
    }

    /// Polls to the end the way the bundle does, and returns the answer of the finishing round.
    ///
    /// No `MachineAccess` here on purpose: the scans of a run live in `SCAN_SESSIONS`, the thread local
    /// the pump's own thread owns, so polling needs the host only.
    fn run_to_completion(host: &mut (dyn NodeHost + 'static), scan_id: &str) -> Value {
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let answer =
                poll_scan(&json!({ "scanId": scan_id }), host).expect("a live scan answers a poll");
            let HostAnswer::Text(text) = answer else {
                panic!("a scan poll answers a document");
            };
            let document: Value = serde_json::from_str(&text).expect("the poll answer is JSON");
            if document["done"] == Value::Bool(true) {
                return document;
            }
            assert!(Instant::now() < deadline, "the scan must finish inside its deadline");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn a_granted_duplicate_scan_answers_the_group_the_engine_found() {
        let root = granted_tree("found");
        let files = FileCapability::new([root.as_path()]);
        let machine = MachineAccess::granted(files);
        let mut host = CountingHost::new();

        let started = start_duplicates_scan(&scan_arguments(&root, "scan-found"), &machine).expect("the scan starts");
        let HostAnswer::Text(text) = started else {
            panic!("a start answers a document");
        };
        let start: Value = serde_json::from_str(&text).expect("the start answer is JSON");
        assert_eq!(start["scanId"], "scan-found");
        assert!(
            start["threads"].as_u64().unwrap_or(0) > 0,
            "the engine must report the pool size it actually got: {start}"
        );

        let document = run_to_completion(&mut host, "scan-found");
        let result = &document["result"];
        assert_eq!(result["stopped"], false, "a finished scan is not a stopped one");
        // The positive control: this fixture is two identical files, so a scan that found nothing is
        // the engine not running, not a passing test.
        let groups = result["groups"].as_array().expect("groups");
        assert_eq!(groups.len(), 1, "one duplicate pair expected in {result}");
        assert_eq!(groups[0]["files"].as_array().expect("files").len(), 2);
        // `messages` is the engine's own broadcast (it reports the cache it wrote), so the contract
        // here is "a string travels", not a fixed text the host does not own.
        assert!(result["messages"].is_string(), "messages must travel as text: {result}");

        // The session leaves the table with its result, so the concurrency budget is returned.
        let again = poll_scan(&json!({ "scanId": "scan-found" }), &mut host);
        assert!(again.is_err(), "a consumed scan must not stay live");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_directory_outside_the_grant_is_refused_before_the_engine_walks_it() {
        let root = granted_tree("refused");
        let outside = std::env::temp_dir();
        let machine = MachineAccess::granted(FileCapability::new([root.as_path()]));

        let arguments = json!({
            "scanId": "scan-outside",
            "includedDirectories": [outside.to_string_lossy()],
        });
        let error = start_duplicates_scan(&arguments, &machine).expect_err("the grant does not cover the temp root");
        assert!(
            error.message().contains(outside.to_string_lossy().as_ref())
                || error.message().contains("outside"),
            "the refusal must name what it refused: {}",
            error.message()
        );
        assert!(
            !SCAN_SESSIONS.with(|sessions| sessions.borrow().contains_key("scan-outside")),
            "a refused start must not have left a session behind"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_basic_scan_answers_the_biggest_file_first() {
        let root = std::env::temp_dir().join(format!("xiranite-czkawka-ops-big-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("the fixture root exists");
        fs::write(root.join("huge.bin"), vec![1u8; 6_000_000]).expect("huge written");
        fs::write(root.join("small.bin"), vec![2u8; 1024]).expect("small written");
        let machine = MachineAccess::granted(FileCapability::new([root.as_path()]));
        let mut host = CountingHost::new();

        let started = start_basic_scan(
            &json!({
                "scanId": "scan-big",
                "tool": "big-files",
                "includedDirectories": [root.to_string_lossy()],
                "threadCount": 2,
                "numberOfFiles": 5,
            }),
            &machine,
        )
        .expect("big-files is an answerable tool");
        let HostAnswer::Text(text) = started else { panic!("a start answers a document") };
        assert_eq!(serde_json::from_str::<Value>(&text).expect("start json")["scanId"], "scan-big");

        let document = run_to_completion(&mut host, "scan-big");
        let result = &document["result"];
        let entries = result["entries"].as_array().expect("entries");
        // The positive control: two files exist and the tool asks for the biggest, so an empty list
        // would mean the scan did not run rather than that nothing is big.
        assert_eq!(entries.len(), 2, "both files expected in {result}");
        // The engine answers canonical paths, which on macOS differ in spelling from `temp_dir()`
        // (`/var` is a symlink to `/private/var`), so the assertion is on the name and the size — the
        // two things this tool is about — not on a path string that only matches after resolving.
        let first = entries[0]["path"].as_str().expect("a path");
        assert!(first.ends_with("huge.bin"), "biggest_first must order the 6 MB file first: {entries:?}");
        assert_eq!(entries[0]["size"], 6_000_000, "{entries:?}");
        assert!(
            entries[0].get("secondaryPath").is_none(),
            "an unset optional is absent, not null: {entries:?}"
        );
        assert_eq!(result["stopped"], false);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_unknown_basic_tool_is_refused_by_naming_the_six_it_answers() {
        let root = granted_tree("badtool");
        let machine = MachineAccess::granted(FileCapability::new([root.as_path()]));
        let error = start_basic_scan(
            &json!({ "scanId": "scan-badtool", "tool": "similar-images", "includedDirectories": [root.to_string_lossy()] }),
            &machine,
        )
        .expect_err("similar-images is a scan.media tool, not a basic one");
        let message = error.message();
        assert!(message.contains("similar-images"), "{message}");
        for tool in ["big-files", "empty-files", "empty-folders", "temporary-files", "invalid-symlinks", "bad-names"] {
            assert!(message.contains(tool), "the refusal must list {tool}: {message}");
        }
        let _ = fs::remove_dir_all(&root);
    }
    #[test]
    fn cancel_asks_a_live_scan_to_stop_and_an_unknown_id_is_a_plain_no() {
        let root = granted_tree("cancel");
        let machine = MachineAccess::granted(FileCapability::new([root.as_path()]));
        let mut host = CountingHost::new();

        start_duplicates_scan(&scan_arguments(&root, "scan-cancel"), &machine).expect("the scan starts");
        let stopped = cancel_scan(&json!({ "scanId": "scan-cancel" })).expect("cancel answers");
        let HostAnswer::Text(text) = stopped else {
            panic!("cancel answers a document");
        };
        assert_eq!(text, r#"{"scanId":"scan-cancel","stopped":true}"#);

        let document = run_to_completion(&mut host, "scan-cancel");
        // A scan cancelled mid-flight may still have finished its work; what must hold is that the
        // engine was asked to stop, which is what `stopped:true` above reports.
        assert_eq!(document["done"], true);
        assert!(document["result"].is_object(), "a cancelled scan still answers its result");

        let gone = cancel_scan(&json!({ "scanId": "scan-never-started" })).expect("an unknown id is a no");
        let HostAnswer::Text(text) = gone else {
            panic!("cancel answers a document");
        };
        assert_eq!(text, r#"{"scanId":"scan-never-started","stopped":false}"#);
        let _ = fs::remove_dir_all(&root);
    }
}
