//! The czkawka host service reached the way a product node reaches it: one `JsNodeSpec`, the services
//! the node declared, and a real duplicate scan through the built-in registry.
//!
//! This is the registration shape of `crates/nodes/dissolvef/src/builtin.rs` with a bundle standing
//! where the Rust business modules stand, so the wiring the `czkawka` node needs is proven before any
//! product bundle is linked in. It deliberately does **not** read `artifacts/node-bundles/kisaki.js`:
//! the pipeline cannot currently produce an evaluable host bundle for that node (rolldown emits the
//! `__esmMin` helper after its first use), and registering a bundle that fails at evaluation would put
//! a node in the product table that cannot run — a claim that is green but not true.
//!
//! Each test says how it would also pass had nothing run, because that is the failure mode this crate
//! exists to avoid.

mod support;

use support::Harness;
use xiranite_node_registry::{BuiltInNode, NodeDescriptor, NodeRegistry, RootAccess, RootRequirement};
use xiranite_quickjs_executor::{RealmRun, JsNode, JsNodeSpec};
use xiranite_core::filesystem::FileCapability;

/// A scripted node that does what the `czkawka` platform face does: ask for the engine's identity,
/// start one duplicate scan, follow it, and report what the engine found.
///
/// The calls go through the **synchronous** `__xrh.call` rather than `callAsync`, so this test exercises
/// the service seam without also testing the job pump (which `tests/executor.rs` and
/// `tests/cancel_pause.rs` already pin). The `waitMs` on `scan.progress` is what keeps the loop from
/// spinning the realm: the wait is spent host-side, where the operation's pause and cancel are checked.
static SCAN_BUNDLE: &str = r#"
function invoke(method, args) {
  return JSON.parse(__xrh.call("service.invoke", JSON.stringify({ service: "czkawka", method, args })));
}
export function run(input) {
  const info = invoke("info", {});
  invoke("scan.duplicates", {
    scanId: input.scanId,
    includedDirectories: [input.directory],
    threadCount: 2,
    minimumFileSize: 1,
    useCache: false,
  });
  let round = invoke("scan.progress", { scanId: input.scanId, waitMs: 200 });
  for (let spins = 0; !round.done; spins += 1) {
    if (spins > 600) throw new Error("the scan never reported a result");
    round = invoke("scan.progress", { scanId: input.scanId, waitMs: 200 });
  }
  const groups = round.result.groups;
  return {
    apiVersion: info.apiVersion,
    capabilities: info.capabilities,
    groupCount: groups.length,
    fileCount: groups.reduce((total, group) => total + group.files.length, 0),
    firstHash: groups.length && groups[0].files[0].hash ? groups[0].files[0].hash : "",
    stopped: round.result.stopped,
  };
}
"#;

const fn budget_bytes() -> usize {
    8_388_608
}

static SCAN_SPEC: JsNodeSpec = JsNodeSpec::pure(
    NodeDescriptor::new("quickjs-czkawka-scan", "0.1.0", 1)
        .with_roots(&[RootRequirement { role: "workspace", access: RootAccess::ReadWrite }])
        .with_services(&["czkawka"])
        .budget(budget_bytes(), 1),
    SCAN_BUNDLE,
    "run",
    "czkawka scan completed",
);
static SCAN_NODE: JsNode = JsNode::new(&SCAN_SPEC);
static SCAN_RUNNABLE: &'static dyn BuiltInNode = &SCAN_NODE;

xiranite_node_registry::register_node!(SCAN_SPEC.descriptor);
xiranite_node_registry::register_node!(SCAN_RUNNABLE);

/// The same bundle, on a node that declared nothing: the gate is the registration, so this must refuse.
static UNGRANTED_SPEC: JsNodeSpec = JsNodeSpec::pure(
    NodeDescriptor::new("quickjs-czkawka-ungranted", "0.1.0", 1)
        .with_roots(&[RootRequirement { role: "workspace", access: RootAccess::ReadWrite }])
        .budget(budget_bytes(), 1),
    SCAN_BUNDLE,
    "run",
    "must never run",
);
static UNGRANTED_NODE: JsNode = JsNode::new(&UNGRANTED_SPEC);
static UNGRANTED_RUNNABLE: &'static dyn BuiltInNode = &UNGRANTED_NODE;

xiranite_node_registry::register_node!(UNGRANTED_SPEC.descriptor);
xiranite_node_registry::register_node!(UNGRANTED_RUNNABLE);

/// Two identical files and one different one, so a scan that finds nothing is a scan that did not run.
fn fixture(harness: &Harness) -> String {
    let duplicated = "z".repeat(700_000);
    harness.root.write("first.bin", &duplicated);
    harness.root.write("second.bin", &duplicated);
    harness.root.write("other.bin", &"q".repeat(700_000));
    harness.root.path().to_string_lossy().into_owned()
}

fn request(directory: &str, scan_id: &str) -> String {
    format!(r#"{{"scanId":{scan_id:?},"directory":{directory:?}}}"#)
}

/// One run with the operation's grant attached, the way `src/bin/quickjs-run.rs` builds it.
fn granted_executor(spec: &'static JsNodeSpec, root: &std::path::Path) -> xiranite_quickjs_executor::RealmRun<'static> {
    let granted: Vec<&std::path::Path> = vec![root];
    RealmRun::new(spec.descriptor, spec.plan())
        .expect("the spec declares a budget")
        .with_files(FileCapability::new(granted))
}

#[test]
fn a_scripted_node_finds_the_duplicate_pair_through_the_host_service() {
    let harness = Harness::new("czkawka-scan", "quickjs-czkawka-scan");
    let directory = fixture(&harness);
    let mut host = harness.host();
    let answer = granted_executor(&SCAN_SPEC, harness.root.path())
        .run(&request(&directory, "scan-1"), &mut host)
        .expect("a scan over a granted directory answers a document");
    let envelope: serde_json::Value = serde_json::from_str(&answer).expect("the result is JSON");
    assert_eq!(envelope["success"], true, "{envelope}");
    assert_eq!(envelope["message"], "czkawka scan completed");

    let data = &envelope["data"];
    // The positive control: this fixture is two identical files, so `groupCount: 0` would mean the
    // engine never ran rather than that the folder is clean.
    assert_eq!(data["groupCount"], 1, "one duplicate pair expected in {data}");
    assert_eq!(data["fileCount"], 2, "{data}");
    assert_eq!(data["stopped"], false, "a finished scan is not a stopped one");
    let hash = data["firstHash"].as_str().expect("a hash travels as text");
    assert_eq!(hash.len(), 64, "a blake3 digest is 64 hex characters, got {hash:?}");
    assert!(
        data["capabilities"].as_array().is_some_and(|caps| !caps.is_empty()),
        "the engine must report its own capability vocabulary: {data}"
    );
    // Progress is the node's to format, so the host must not have pushed events on its behalf here.
    assert!(
        harness.events().is_empty(),
        "the service answers snapshots; it is the node that turns them into events: {:?}",
        harness.events()
    );
}

#[test]
fn a_directory_outside_the_grant_never_reaches_the_engine() {
    let harness = Harness::new("czkawka-refused", "quickjs-czkawka-scan");
    // The grant is one temporary root; the request names the directory above it, which is full of files.
    let outside = harness
        .root
        .path()
        .parent()
        .expect("the harness root has a parent")
        .to_string_lossy()
        .into_owned();
    let mut host = harness.host();
    let answer = granted_executor(&SCAN_SPEC, harness.root.path())
        .run(&request(&outside, "scan-outside"), &mut host)
        .expect("a refusal still travels as the node's own document");
    let envelope: serde_json::Value = serde_json::from_str(&answer).expect("the refusal is JSON");
    assert_eq!(envelope["success"], false, "an ungranted walk must not answer a scan: {envelope}");
    assert!(
        envelope["data"].is_null(),
        "no result document may come back from a refused scan: {envelope}"
    );
    let message = envelope["message"].as_str().expect("the refusal says why");
    // The wording is `xiranite-core`'s (`FsCapabilityError::PermissionDenied`, filesystem.rs), and it is
    // asserted rather than skipped because it is the text a node's failure report shows an operator.
    assert!(
        message.contains("outside the authorized roots"),
        "the engine must never see a path the grant does not cover: {message}"
    );
}

/// The gate is the registration, so an undeclared service is refused even over a granted directory.
#[test]
fn a_node_that_declared_no_service_is_refused_before_the_engine_is_reached() {
    let harness = Harness::new("czkawka-ungranted", "quickjs-czkawka-ungranted");
    let directory = fixture(&harness);
    let mut host = harness.host();
    let answer = granted_executor(&UNGRANTED_SPEC, harness.root.path())
        .run(&request(&directory, "scan-ungranted"), &mut host)
        .expect("the refusal travels as the node's own document");
    let envelope: serde_json::Value = serde_json::from_str(&answer).expect("the refusal is JSON");
    assert_eq!(envelope["success"], false, "{envelope}");
    let message = envelope["message"].as_str().expect("a refusal carries text");
    assert!(
        message.contains(r#"declared no \"czkawka\" service"#) || message.contains("declared no"),
        "the refusal must name the missing declaration: {message}"
    );
    assert!(message.contains("info"), "and the method it refused: {message}");
}

/// What the registry path answers today, pinned rather than hoped away.
///
/// `JsNode::run` builds its executor from the descriptor alone, so the machine surface is
/// `MachineAccess::seam_only()` and every grant-backed operation — the czkawka service included, like
/// `fs.readBytes` and `fs.copy` — refuses with the wording that names the wiring which would answer.
/// The grant arrives through the node-runtime launcher (`RealmRun::with_files`), which is the change
/// that turns this from a refusal into a scan; the test exists so that change cannot be claimed
/// without turning this red.
#[test]
fn the_registry_path_refuses_until_the_launcher_passes_the_grant() {
    let harness = Harness::new("czkawka-registry", "quickjs-czkawka-scan");
    let directory = fixture(&harness);
    let registry = NodeRegistry::builtin().expect("one id per node in this test binary");
    let runnable = registry
        .runnable("quickjs-czkawka-scan")
        .expect("reachable by id: the spec submitted both halves");
    assert!(
        !registry.policy_only_ids().contains(&"quickjs-czkawka-scan"),
        "declared but not runnable is the half-registration these tests exist to catch"
    );
    assert!(
        runnable.descriptor().requirements.services.contains(&"czkawka"),
        "the declaration the gate reads must be the one the registry sees: {:?}",
        runnable.descriptor().requirements.services
    );

    let mut host = harness.host();
    let answer = runnable
        .run(&request(&directory, "scan-registry"), &mut host)
        .expect("the refusal is a document, not an engine failure");
    let envelope: serde_json::Value = serde_json::from_str(&answer).expect("the refusal is JSON");
    assert_eq!(envelope["success"], false, "{envelope}");
    let message = envelope["message"].as_str().expect("a refusal carries text");
    assert!(
        message.contains("granted filesystem") && message.contains("MachineAccess::granted"),
        "the refusal must name the wiring that would answer, which is the launcher's grant: {message}"
    );
}
