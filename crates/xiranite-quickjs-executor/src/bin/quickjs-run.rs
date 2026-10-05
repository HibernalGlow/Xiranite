//! `quickjs-run` — the dev harness for one bundle, before it is linked into a host.
//!
//! This is how a per-node migration agent exercises its node without waiting for the registry wiring:
//! hand it the bundle the shim build produced, the export names from the node's spec, a request
//! document, and the directory the node is granted.
//!
//! ```text
//! quickjs-run <bundle.js> <runExport> <createRuntimeExport|-> <request.json|@file> <grantedRoot> [options]
//! ```
//!
//! - `<runExport>` — the export `node-runner.ts` would call for `spec.run` (`"run"`, or
//!   `"__nodeEntry"` for an `--format=iife` bundle).
//! - `<createRuntimeExport|->` — `spec.createRuntime` for a platform node; `-` means a pure node, and
//!   then the result document is the `{success, message, data}` envelope the TypeScript runner built.
//! - `<request.json|@file>` — the request document inline, or `@path` to read it from a file.
//! - `<grantedRoot>` — the one directory the operation's file access is granted.
//!
//! Options, after the five positional arguments:
//! `--node-id <id>` `--services <csv>` `--budget-bytes <n>` `--deadline-ms <n>` `--poll-ms <n>`
//! `--cancel-after-ms <n>` `--pause-after-ms <n>` `--resume-after-ms <n>` `--pretty`
//!
//! # Output contract
//!
//! stdout is **exactly one JSON document**, always: the node's result document when the run produced
//! one, and `{"success":false,"message":"quickjs-run: …"}` when the harness refused to start or the
//! run failed at engine level. Diagnostics (timing, byte budget, event count, which file was loaded)
//! go to stderr, one `quickjs-run: <line>` each, so `quickjs-run … | jq .` always works and a failure
//! is still explicit. The exit status is 0 when a document was produced and 2 on a usage error or a
//! failed run — the two-code convention `xr` uses.
//!
//! # Why the harness starts a real operation
//!
//! `--cancel-after-ms` and `--pause-after-ms` only mean something if the thing being cancelled is the
//! operation the node runs against, so the harness builds the same chain production does:
//! [`OperationManager`] → [`NativeNodeHost`] → the granted [`FileCapability`]. A harness that stubbed
//! the host would let a node pass here and fail in the desktop.

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use xiranite_core::filesystem::FileCapability;
use xiranite_core::{OperationManager, OperationManagerOptions, SystemClock};
use xiranite_native_host::NativeNodeHost;
use xiranite_node_registry::NodeDescriptor;
use xiranite_quickjs_executor::{
    DEFAULT_HOST_POLL_INTERVAL, EntryPlan, Executor, MAX_PROCESS_OUTPUT_BYTES,
};

/// The live-byte budget a harness run gets when the operator does not say.
///
/// A linked-in node declares its own (`NodeDescriptor::requirements.max_live_bytes`) and the
/// executor refuses a node that declares none, so the *product* never carries this number. A dev tool
/// has to pick one to start an engine at all; it prints the choice on stderr so a result that changed
/// because of it is at least visible. The value is dissolvef's declared 16 MiB — the ceiling the
/// retained nodes' wasm manifests shipped with.
const DEFAULT_BUDGET_BYTES: usize = 16_777_216;

/// The wall-clock bound on a harness run, deliberately generous: a hang here is a finding, and the
/// harness exists to surface it rather than to hide it behind a short timeout.
const DEFAULT_DEADLINE_MS: u64 = 60_000;

const USAGE: &str = "usage: quickjs-run <bundle.js> <runExport> <createRuntimeExport|-> \
                    <request.json|@file> <grantedRoot> [--node-id <id>] [--services <csv>] [--budget-bytes <n>] \
                    [--deadline-ms <n>] [--poll-ms <n>] [--cancel-after-ms <n>] \
                    [--pause-after-ms <n>] [--resume-after-ms <n>] [--pretty]";

fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    match Options::parse(&arguments) {
        Ok(options) => run(options),
        Err(message) => {
            eprintln!("quickjs-run: {message}");
            emit_failure(&message);
            ExitCode::from(2)
        }
    }
}

/// One harness invocation.
#[derive(Debug)]
struct Options {
    bundle: PathBuf,
    run_export: String,
    create_runtime_export: Option<String>,
    request: String,
    granted_root: PathBuf,
    node_id: String,
    /// Host services this harness run is allowed to call, as if the node had declared them.
    ///
    /// A product node declares its services once on its own `NodeDescriptor`, and the executor refuses
    /// `service.invoke` for anything else. The harness builds a descriptor out of flags, so the same
    /// gate needs a flag: without it a scripted node that reaches a host engine is refused for the
    /// harness' own missing declaration, which would read as the node failing.
    services: Vec<String>,
    budget_bytes: usize,
    deadline: Duration,
    poll: Duration,
    cancel_after: Option<Duration>,
    pause_after: Option<Duration>,
    resume_after: Option<Duration>,
    pretty: bool,
}

impl Options {
    fn parse(arguments: &[String]) -> Result<Self, String> {
        let mut positional: Vec<String> = Vec::new();
        let mut node_id = String::from("harness");
        let mut services: Vec<String> = Vec::new();
        let mut budget_bytes = DEFAULT_BUDGET_BYTES;
        let mut deadline_ms = DEFAULT_DEADLINE_MS;
        let mut poll_ms: Option<u64> = None;
        let mut cancel_after_ms: Option<u64> = None;
        let mut pause_after_ms: Option<u64> = None;
        let mut resume_after_ms: Option<u64> = None;
        let mut pretty = false;

        let mut index = 0usize;
        while index < arguments.len() {
            let flag = arguments[index].as_str();
            match flag {
                "--node-id" => {
                    node_id = value(arguments, &mut index)?.to_string();
                }
                "--services" => {
                    services = value(arguments, &mut index)?
                        .split(',')
                        .map(str::trim)
                        .filter(|name| !name.is_empty())
                        .map(ToString::to_string)
                        .collect();
                }
                "--budget-bytes" => {
                    budget_bytes = number(arguments, &mut index, "budget-bytes")?;
                }
                "--deadline-ms" => {
                    deadline_ms = number(arguments, &mut index, "deadline-ms")?;
                }
                "--poll-ms" => {
                    poll_ms = Some(number(arguments, &mut index, "poll-ms")?);
                }
                "--cancel-after-ms" => {
                    cancel_after_ms = Some(number(arguments, &mut index, "cancel-after-ms")?);
                }
                "--pause-after-ms" => {
                    pause_after_ms = Some(number(arguments, &mut index, "pause-after-ms")?);
                }
                "--resume-after-ms" => {
                    resume_after_ms = Some(number(arguments, &mut index, "resume-after-ms")?);
                }
                "--pretty" => {
                    pretty = true;
                    index += 1;
                }
                "--help" | "-h" => {
                    return Err(String::from(USAGE));
                }
                other if other.starts_with("--") => {
                    return Err(format!("unknown option {other:?}\n{USAGE}"));
                }
                other => {
                    positional.push(other.to_string());
                    index += 1;
                }
            }
        }

        if positional.len() != 5 {
            return Err(format!(
                "five positional arguments are required, got {}\n{USAGE}",
                positional.len()
            ));
        }
        let request = read_request(&positional[3])?;
        Ok(Self {
            bundle: PathBuf::from(&positional[0]),
            run_export: positional[1].clone(),
            create_runtime_export: (positional[2] != "-").then(|| positional[2].clone()),
            request,
            granted_root: PathBuf::from(&positional[4]),
            node_id,
            services,
            budget_bytes,
            deadline: Duration::from_millis(deadline_ms),
            poll: poll_ms.map_or(DEFAULT_HOST_POLL_INTERVAL, Duration::from_millis),
            cancel_after: cancel_after_ms.map(Duration::from_millis),
            pause_after: pause_after_ms.map(Duration::from_millis),
            resume_after: resume_after_ms.map(Duration::from_millis),
            pretty,
        })
    }
}

/// Leaks the `--services` names so they can ride on a `'static` descriptor, the same way the harness
/// already leaks its node id. A product host never needs this: its nodes declare the list once on
/// their own `static` `NodeDescriptor`.
fn leak_services(names: Vec<String>) -> &'static [&'static str] {
    let leaked: Vec<&'static str> = names
        .into_iter()
        .map(|name| Box::leak(name.into_boxed_str()) as &'static str)
        .collect();
    Box::leak(leaked.into_boxed_slice())
}

/// Reads the value that follows a flag and advances past the pair.
fn value<'a>(arguments: &'a [String], index: &mut usize, ) -> Result<&'a str, String> {
    let next = *index + 1;
    if next >= arguments.len() {
        return Err(format!("{} needs a value", arguments[*index]));
    }
    *index = next + 1;
    Ok(arguments[next].as_str())
}

fn number<T: std::str::FromStr>(arguments: &[String], index: &mut usize, name: &str) -> Result<T, String> {
    let raw = value(arguments, index)?;
    raw.parse()
        .map_err(|_| format!("--{name} needs a number, got {raw:?}"))
}

fn read_request(argument: &str) -> Result<String, String> {
    if let Some(path) = argument.strip_prefix('@') {
        return std::fs::read_to_string(path)
            .map_err(|error| format!("the request document {path:?} could not be read: {error}"));
    }
    Ok(argument.to_string())
}

fn run(options: Options) -> ExitCode {
    let source = match std::fs::read_to_string(&options.bundle) {
        Ok(source) => source,
        Err(error) => {
            return failure(format!(
                "the bundle {:?} could not be read: {error}",
                options.bundle.display()
            ));
        }
    };
    if !options.granted_root.is_dir() {
        return failure(format!(
            "the granted root {:?} is not a directory, so every file call would read as missing",
            options.granted_root.display()
        ));
    }

    eprintln!(
        "quickjs-run: bundle={} bytes={} runExport={} createRuntime={} grantedRoot={}",
        options.bundle.display(),
        source.len(),
        options.run_export,
        options.create_runtime_export.as_deref().unwrap_or("-"),
        options.granted_root.display()
    );
    eprintln!(
        "quickjs-run: budget_bytes={} deadline_ms={} poll_ms={} processOutputCeiling={MAX_PROCESS_OUTPUT_BYTES}",
        options.budget_bytes,
        options.deadline.as_millis(),
        options.poll.as_millis()
    );

    // The descriptor is what the executor reads its ceilings from. The node id is leaked because a
    // one-shot process never frees it and `NodeDescriptor` names itself with `&'static str`.
    let descriptor = NodeDescriptor::new(Box::leak(options.node_id.into_boxed_str()), "0.0.0", 1)
        .with_services(leak_services(options.services))
        .budget(options.budget_bytes, 1);
    // One grant, handed to both the host and the executor's machine surface, so the widened `fs.*`
    // arms authorize against exactly the same root the seam does.
    let granted: Vec<&Path> = vec![options.granted_root.as_path()];
    let files = FileCapability::new(granted);
    let plan = EntryPlan {
        bundle_name: "quickjs-run",
        source: &source,
        run_export: &options.run_export,
        create_runtime_export: options.create_runtime_export.as_deref(),
        pure_message: "quickjs-run: node completed",
    };
    let executor = match Executor::new(descriptor, plan)
        .map(|executor| {
            executor
                .with_run_deadline(options.deadline)
                .with_host_poll_interval(options.poll)
                .with_files(files.clone())
        }) {
        Ok(executor) => executor,
        Err(error) => return failure(error.message),
    };

    let clock: Arc<dyn xiranite_core::Clock> = Arc::new(SystemClock);
    let manager = OperationManager::with_clock(Arc::clone(&clock), OperationManagerOptions::default());
    let control = manager.start(executor.descriptor().id, None, None);
    let operation_id = control.operation_id().to_string();
    eprintln!("quickjs-run: operation={operation_id}");
    // `mark_running` answers `None` for an operation that is already gone, which in a one-shot
    // harness means the run must not proceed against an id nothing tracks.
    if manager.mark_running(&operation_id).is_none() {
        return failure(format!("the harness operation {operation_id} could not be marked running"));
    }

    // The operator's arms, driven from a second thread exactly like the HTTP routes would: the run
    // thread never sees them, which is the point of testing them this way.
    // One shape for all three operator actions: sleep, then ask the manager, exactly as the route
    // that serves `POST /node-operations/:id/pause` would.
    let watch = |action: &'static str, delay: Duration, manager: OperationManager, id: String| {
        std::thread::spawn(move || {
            std::thread::sleep(delay);
            let answered = match action {
                "pause" => manager.pause(&id).is_some(),
                "resume" => manager.resume(&id).is_some(),
                _ => manager.cancel(&id, "quickjs-run").is_some(),
            };
            eprintln!(
                "quickjs-run: {action} after {} ms, operation answered={answered}",
                delay.as_millis()
            );
        });
    };
    if let Some(delay) = options.pause_after {
        watch("pause", delay, manager.clone(), operation_id.clone());
    }
    if let Some(delay) = options.resume_after {
        watch("resume", delay, manager.clone(), operation_id.clone());
    }
    if let Some(delay) = options.cancel_after {
        watch("cancel", delay, manager.clone(), operation_id.clone());
    }

    let mut host = NativeNodeHost::new(manager.clone(), control, files, clock).with_pause_poll_interval(options.poll);

    let started = std::time::Instant::now();
    let outcome = executor.run(&options.request, &mut host);
    eprintln!(
        "quickjs-run: elapsed_ms={} events={}",
        started.elapsed().as_millis(),
        manager
            .events(&operation_id, None, None)
            .map_or(0usize, |page| page.events.len())
    );

    match outcome {
        Ok(document) => {
            println!("{}", if options.pretty { prettify(&document) } else { document });
            ExitCode::SUCCESS
        }
        Err(error) => failure(error.message),
    }
}

/// The one failure arm: a line on stderr, a parseable document on stdout, exit 2.
fn failure(message: String) -> ExitCode {
    eprintln!("quickjs-run: {message}");
    emit_failure(&message);
    ExitCode::from(2)
}

fn emit_failure(message: &str) {
    let document = serde_json::json!({ "success": false, "message": format!("quickjs-run: {message}") });
    println!("{document}");
}

fn prettify(document: &str) -> String {
    serde_json::from_str::<serde_json::Value>(document)
        .map(|value| serde_json::to_string_pretty(&value).unwrap_or_else(|_| document.to_string()))
        .unwrap_or_else(|_| document.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const POSITIONAL: [&str; 5] = ["bundle.js", "run", "-", "{}", "/tmp"];

    #[test]
    fn the_five_positional_arguments_are_the_contract() {
        let owned: Vec<String> = POSITIONAL.iter().map(|item| (*item).to_string()).collect();
        let options = Options::parse(&owned).expect("the documented invocation parses");
        assert_eq!(options.run_export, "run");
        assert!(
            options.create_runtime_export.is_none(),
            "`-` is the pure-node arm, not an export named \"-\""
        );
        assert_eq!(options.request, "{}");
        assert_eq!(options.budget_bytes, DEFAULT_BUDGET_BYTES);
        assert_eq!(options.deadline, Duration::from_millis(DEFAULT_DEADLINE_MS));
        assert_eq!(options.poll, DEFAULT_HOST_POLL_INTERVAL);
        assert!(options.cancel_after.is_none() && options.pause_after.is_none());
    }

    #[test]
    fn a_named_create_runtime_export_makes_the_run_a_platform_run() {
        let owned: Vec<String> = ["bundle.js", "run", "createRuntime", "{}", "/tmp"]
            .iter()
            .map(|item| (*item).to_string())
            .collect();
        let options = Options::parse(&owned).expect("platform invocation");
        assert_eq!(options.create_runtime_export.as_deref(), Some("createRuntime"));
    }

    #[test]
    fn missing_and_unknown_arguments_are_refused_with_the_usage_line() {
        let short: Vec<String> = ["bundle.js", "run"].iter().map(|item| (*item).to_string()).collect();
        let error = Options::parse(&short).expect_err("two positional arguments are not five");
        assert!(error.contains("five positional arguments"), "{error}");
        assert!(error.contains("usage: quickjs-run"), "{error}");

        let mut unknown = POSITIONAL.iter().map(|item| (*item).to_string()).collect::<Vec<String>>();
        unknown.push("--nonsense".to_string());
        let error = Options::parse(&unknown).expect_err("an unknown option must not be ignored");
        assert!(error.contains("unknown option"), "{error}");

        let mut dangling = POSITIONAL.iter().map(|item| (*item).to_string()).collect::<Vec<String>>();
        dangling.push("--budget-bytes".to_string());
        assert!(
            Options::parse(&dangling).expect_err("a flag needs its value").contains("needs a value"),
            "a missing value and a bad value are different refusals; the harness must not blur them"
        );

        let mut not_a_number = POSITIONAL.iter().map(|item| (*item).to_string()).collect::<Vec<String>>();
        not_a_number.extend(["--budget-bytes".to_string(), "wide".to_string()]);
        assert!(
            Options::parse(&not_a_number)
                .expect_err("a non-numeric budget is refused")
                .contains("needs a number"),
            "the second arm of the same flag must say what it expected"
        );
    }

    #[test]
    fn a_request_document_can_be_a_file_and_the_file_arm_reports_its_own_failure() {
        let directory = std::env::temp_dir();
        let path = directory.join(format!("xiranite-quickjs-run-request-{}", std::process::id()));
        std::fs::write(&path, "{\"action\":\"plan\"}").expect("request file");
        let argument = format!("@{}", path.display());
        assert_eq!(read_request(&argument).expect("read"), r#"{"action":"plan"}"#);
        let _ = std::fs::remove_file(&path);

        let missing = read_request("@/definitely/not/here.json").expect_err("a missing file is refused");
        assert!(missing.contains("could not be read"), "{missing}");
        // The inline arm must not be confused with the file arm.
        assert_eq!(read_request("{}").expect("inline"), "{}");
    }
}
