//! The executor's contract, against the real host chain.
//!
//! Each test states how it could fail, because an assertion that would also pass when nothing ran is
//! worth nothing here: the failure modes this crate is meant to rule out are exactly the silent ones
//! (a bundle that never evaluated, a pump that never settled, an event that never reached the stream).

mod support;

use support::{Harness, fixture};

use xiranite_node_registry::{
    BuiltInNode, NodeDescriptor, NodeRegistry, RootAccess, RootRequirement,
};
use xiranite_quickjs_executor::{EngineLimits, EntryPlan, RealmRun, JsNode, JsNodeSpec};

fn budget() -> usize {
    8 * 1024 * 1024
}

fn descriptor(id: &'static str) -> NodeDescriptor {
    NodeDescriptor::new(id, "0.1.0", 1)
        .with_roots(&[RootRequirement { role: "workspace", access: RootAccess::ReadWrite }])
        .budget(budget(), 1)
}

fn executor<'a>(id: &'static str, plan_source: &'a str) -> RealmRun<'a> {
    // The plan borrows the caller's strings, so the bundle text and the export names must outlive it;
    // fixtures are `&'static str` and the export names are literals.
    RealmRun::new(descriptor(id), EntryPlan {
        bundle_name: id,
        source: plan_source,
        run_export: "run",
        create_runtime_export: None,
        pure_message: "fixture completed",
    })
    .expect("the descriptor declares a budget, so the limits are derivable")
}

/// (a) A pure node: `run(input)` returning data yields the envelope the TypeScript runner built.
#[test]
fn a_pure_node_answers_the_runspec_envelope_with_its_own_numbers() {
    let harness = Harness::new("pure", "quickjs-test.pure");
    let mut host = harness.host();
    let document = executor("quickjs-test.pure", fixture("pure-node.js"))
        .run(r#"{"path":"/work","names":["alpha","beta"],"count":21}"#, &mut host)
        .expect("a pure run answers a document");
    let value: serde_json::Value = serde_json::from_str(&document).expect("the document is JSON");

    assert_eq!(value["success"], true, "{value}");
    assert_eq!(value["message"], "fixture completed", "{value}");
    assert_eq!(value["data"]["path"], "/work", "{value}");
    assert_eq!(value["data"]["items"], 2, "{value}");
    assert_eq!(value["data"]["characters"], 9, "alpha+beta: {value}");
    assert_eq!(value["data"]["doubled"], 42, "{value}");
    // How this could pass while nothing ran: every field above would be `null`, and `data` would be
    // absent. The arithmetic on `characters` and `doubled` is done inside the bundle, so a green
    // assertion here is proof the JavaScript evaluated.
    assert!(
        harness.events().is_empty(),
        "a pure run must not invent events, got {:?}",
        harness.event_lines()
    );
}

/// (a, second arm) An `--format=iife` bundle: exports come from `globalThis`, the probe's shape.
#[test]
fn a_global_script_bundle_resolves_its_entry_from_the_global_object() {
    let harness = Harness::new("iife", "quickjs-test.iife");
    let mut host = harness.host();
    let plan = EntryPlan {
        bundle_name: "quickjs-test.iife",
        source: fixture("iife-node.js"),
        run_export: "__nodeEntry",
        create_runtime_export: None,
        pure_message: "iife completed",
    };
    let document = RealmRun::new(descriptor("quickjs-test.iife"), plan)
        .expect("budgeted")
        .run(r#"{"values":[1,2,3,7]}"#, &mut host)
        .expect("the global entry is callable")
        ;
    let value: serde_json::Value = serde_json::from_str(&document).expect("json");
    // The bundle sums the four values it was handed, so 13 is the bundle's own arithmetic: an entry
    // that had never been called would answer `null` here, and the glue's globals are filtered out of
    // the lookup, so this cannot be some other `__nodeEntry`.
    assert_eq!(value["data"]["total"], 13, "{value}");
    assert_eq!(value["data"]["kind"], "global-script", "{value}");
    assert_eq!(value["message"], "iife completed", "{value}");
}

/// (b) A platform node: the pump settles a parked `__xrh.callAsync` against a real directory.
#[test]
fn an_async_host_call_is_settled_by_the_pump_and_the_run_reads_the_disk() {
    let harness = Harness::new("platform", "quickjs-test.platform");
    // The bundle reads `entries[0]` of the listing, and `FileCapability::list` sorts by name
    // (`crates/xiranite-core/src/filesystem.rs:249`), so `notes.txt` is that first entry and
    // `zeta.txt` is the one nothing reads — the second name is here to prove the listing really came
    // back sorted rather than being a single hard-wired path.
    harness.root.write("notes.txt", "hello from disk\n");
    harness.root.write("zeta.txt", "unused second entry");

    let mut host = harness.host();
    let plan = EntryPlan {
        bundle_name: "quickjs-test.platform",
        source: fixture("platform-node.js"),
        run_export: "run",
        create_runtime_export: Some("createRuntime"),
        pure_message: "",
    };
    let request = format!(r#"{{"root":{:?}}}"#, harness.root.text().replace('\\', "/"));
    let document = RealmRun::new(descriptor("quickjs-test.platform"), plan)
        .expect("budgeted")
        .run(&request, &mut host)
        .expect("the platform run settles");
    let value: serde_json::Value = serde_json::from_str(&document).expect("json");

    assert_eq!(value["success"], true, "{value}");
    assert_eq!(value["message"], "fixture platform run", "{value}");
    // The two awaited `callAsync` answers: a listing and then a document read.
    assert_eq!(value["data"]["content"], "hello from disk\n", "{value}");
    let entries: Vec<&str> = value["data"]["entries"]
        .as_array()
        .expect("entries array")
        .iter()
        .map(|entry| entry.as_str().expect("entry name"))
        .collect();
    assert_eq!(entries, vec!["notes.txt", "zeta.txt"], "{value}");

    // `fs.list` sorts by name, so the entry the run read is determined; the write is the synchronous
    // arm of the same protocol, proven by the file appearing on disk.
    let written = value["data"]["writtenTo"].as_str().expect("written path").to_string();
    assert!(written.ends_with("summary.txt"), "{written}");
    assert_eq!(
        harness.root.read("summary.txt").expect("summary.txt on disk"),
        "hello from disk\n",
        "the synchronous write must land in the granted root"
    );

    // The runtime object is the bundle's own, with the control triple added — the exact shape
    // `{ ...runtime, isCancelled, waitWhilePaused, checkMemory }` produced.
    assert_eq!(value["data"]["runtimeName"], "fixture-platform", "{value}");
    assert_eq!(value["data"]["runtimeMarker"], "kept", "the bundle's own field must survive");
    assert_eq!(
        value["data"]["controlKeys"],
        serde_json::json!(["isCancelled", "waitWhilePaused", "checkMemory"]),
        "{value}"
    );
    assert_eq!(
        value["data"]["hostCwd"],
        serde_json::Value::String(
            std::env::current_dir().expect("cwd").to_string_lossy().into_owned()
        ),
        "the platform answer must be the host's, not the engine's"
    );
    // The clock: one spelling, and the harness clock's value, proving `now()` came from the host.
    assert_eq!(value["data"]["clock"], "2023-11-14T22:13:20.000Z", "{value}");

    // How this could fail: if the pump never settled the parked promise, the run would end as an
    // error mentioning a parked await (`tests/parked` below proves that arm reports rather than
    // hangs), and none of the fields above would exist.
    assert!(!harness.event_lines().is_empty(), "the run reported nothing");
}

/// (c) `onEvent` forwards into the operation's event stream.
#[test]
fn on_event_lines_land_in_the_operations_stream_with_their_percentages() {
    let harness = Harness::new("events", "quickjs-test.events");
    harness.root.write("notes.txt", "body\n");

    let mut host = harness.host();
    let plan = EntryPlan {
        bundle_name: "quickjs-test.events",
        source: fixture("platform-node.js"),
        run_export: "run",
        create_runtime_export: Some("createRuntime"),
        pure_message: "",
    };
    let request = format!(r#"{{"root":{:?}}}"#, harness.root.text().replace('\\', "/"));
    RealmRun::new(descriptor("quickjs-test.events"), plan)
        .expect("budgeted")
        .run(&request, &mut host)
        .expect("the run answers");

    let lines = harness.event_lines();
    let kinds: Vec<&str> = lines.iter().map(|(kind, _)| kind.as_str()).collect();
    assert_eq!(
        lines,
        vec![
            (
                "progress".to_string(),
                "fixture: listing".to_string()
            ),
            ("log".to_string(), "fixture: found 1 entries".to_string()),
            ("progress".to_string(), "fixture: done".to_string()),
        ],
        "the stream must carry the node's lines in order, got {lines:?}"
    );
    assert_eq!(kinds.len(), 3, "{kinds:?}");

    // The percentages are the other half of the claim: a report that lost them would still print the
    // messages and the monitor would render a run that never advances.
    let events = harness.events();
    assert_eq!(events[0].progress, Some(10.0), "{:?}", events[0]);
    assert_eq!(events[2].progress, Some(100.0), "{:?}", events[2]);
    assert_eq!(events[1].progress, None, "a log line carries no percentage");
    assert_eq!(events[0].kind, xiranite_plugin_api::PluginRunEventKind::Progress);
}

/// (e) A path outside the granted root reads as missing, exactly as the seam documents.
#[test]
fn a_path_outside_the_grant_reads_as_missing_while_a_refused_listing_still_fails() {
    let harness = Harness::new("grant", "quickjs-test.grant");
    harness.root.write("inside.txt", "x");
    let root = harness.root.text().replace('\\', "/");

    let mut host = harness.host();
    let request = format!(
        r#"{{"root":{:?},"inside":{:?},"outside":"/definitely/not/granted/x.txt"}}"#,
        root,
        format!("{root}/inside.txt")
    );
    let plan = EntryPlan {
        bundle_name: "quickjs-test.grant",
        source: fixture("grant-node.js"),
        run_export: "run",
        create_runtime_export: None,
        pure_message: "grant completed",
    };
    let document = RealmRun::new(descriptor("quickjs-test.grant"), plan.clone())
        .expect("budgeted")
        .run(&request, &mut host)
        .expect("a refusal inside the run is data, not a failed run");
    let value: serde_json::Value = serde_json::from_str(&document).expect("json");
    let data = &value["data"];
    // The envelope is the runner's (`node-runner.ts:90`), and `data` is the bundle's answer with
    // nothing added: a second wrap would put the fields under `data.data`, which is exactly the shape
    // this fixture used to be written in.
    assert_eq!(value["message"], "grant completed", "{value}");
    assert!(data.get("data").is_none(), "the pure envelope wrapped itself: {value}");
    assert_eq!(data["insideExists"], true, "{value}");
    assert_eq!(data["insideIsDirectory"], false, "{value}");
    assert_eq!(data["outsideExists"], false, "a refused path must read as missing: {value}");
    assert_eq!(data["missingExists"], false, "{value}");
    // The documented asymmetry: `stat` has a lenient arm, `list` does not.
    let listing_error = data["listedOutsideError"].as_str().expect("the listing threw").to_string();
    assert!(
        listing_error.contains("outside the authorized roots"),
        "the refusal message must be the host's, got {listing_error}"
    );

    // Positive control for the *grant*, not the refusal: with nothing granted, the inside path reads
    // as missing too. Without this arm the assertions above could mean "the grant was never wired".
    let mut denied = harness.denied_host();
    let denied_document = RealmRun::new(descriptor("quickjs-test.grant"), plan)
        .expect("budgeted")
        .run(&request, &mut denied)
        .expect("a denied root is still a well-formed answer");
    let denied: serde_json::Value = serde_json::from_str(&denied_document).expect("json");
    assert_eq!(denied["data"]["insideExists"], false, "{denied}");
}

/// (f) A memory-limit breach is a reported failure, and the host process survives it.
#[test]
fn a_live_byte_breach_comes_back_as_a_run_error_and_leaves_the_host_usable() {
    let harness = Harness::new("leak", "quickjs-test.leak");
    let started = std::time::Instant::now();
    let mut host = harness.host();
    let error = executor("quickjs-test.leak", fixture("leak-node.js"))
        .with_run_deadline(std::time::Duration::from_secs(5))
        .run(r#"{"blockBytes":262144}"#, &mut host)
        .expect_err("allocating past the declared ceiling must fail the run");
    let elapsed = started.elapsed();

    assert!(
        error.message.contains("engine level"),
        "the failure must be told apart from a node bug: {}",
        error.message
    );
    assert!(
        error.message.contains("live-byte ceiling"),
        "the reason must name the ceiling the node declared: {}",
        error.message
    );
    assert!(
        error.message.contains("out of memory"),
        "the engine's own text must be carried: {}",
        error.message
    );
    // Measured, not assumed: the probe recorded `elapsed_ms=2` for the same allocation pattern at a
    // 64 MiB ceiling. At 8 MiB the breach is reached sooner, so the bound below is a regression guard
    // against a limit that silently stopped being enforced (which would run until the deadline).
    assert!(
        elapsed < std::time::Duration::from_secs(2),
        "the ceiling should trip in well under a second, took {elapsed:?}"
    );

    // A node that *catches* the same failure is allowed to answer, which is the difference between an
    // engine limit and an aborted run.
    let mut second = harness.host();
    let answered = executor("quickjs-test.leak", fixture("leak-node.js"))
        .run(r#"{"blockBytes":262144,"swallow":true}"#, &mut second)
        .expect("a caught out-of-memory is the node's own document");
    let value: serde_json::Value = serde_json::from_str(&answered).expect("json");
    assert_eq!(value["success"], true, "{value}");
    assert!(
        value["data"]["note"].as_str().expect("note").contains("out of memory"),
        "{value}"
    );
    // Surviving proof: the process is still usable for a third run, and it is not a broken engine.
    let mut third = harness.host();
    let again = executor("quickjs-test.third", fixture("pure-node.js"))
        .run(r#"{"path":"/work","names":["a"],"count":1}"#, &mut third)
        .expect("a later run in the same process still works after a breach");
    assert!(again.contains("\"items\":1"), "{again}");
}

/// A node's own exception becomes the failure document `node-runner.ts` produced, with its log line.
#[test]
fn an_escaped_node_exception_becomes_the_runner_failure_document_plus_a_log_event() {
    let harness = Harness::new("throws", "quickjs-test.throws");
    let source = r#"
export function run(input) {
  if (input.boom) { throw new Error("the planner refused row 3"); }
  return { ok: true };
}
"#;
    let mut host = harness.host();
    let document = executor("quickjs-test.throws", source)
        .run(r#"{"boom":true}"#, &mut host)
        .expect("a thrown error is a document, not a failed run");
    let value: serde_json::Value = serde_json::from_str(&document).expect("json");
    assert_eq!(value["success"], false, "{value}");
    assert_eq!(
        value["message"],
        r#"Node "quickjs-test.throws" failed: the planner refused row 3"#,
        "the message is the runner's shape: {value}"
    );
    assert_eq!(
        harness.event_lines(),
        vec![("log".to_string(), value["message"].as_str().expect("message").to_string())],
        "the runner also reported the failure as a log line"
    );

    // Positive control: the same bundle without the throw answers normally, so the arm above cannot
    // be the result of a bundle that never loaded.
    let mut second = harness.host();
    let fine = executor("quickjs-test.throws", source)
        .run(r#"{"boom":false}"#, &mut second)
        .expect("the normal arm");
    assert!(fine.contains("\"message\":\"fixture completed\""), "{fine}");
    assert!(fine.contains("\"ok\":true"), "{fine}");
}

/// A missing export is a run error that names what the bundle actually exports.
#[test]
fn a_missing_export_is_refused_with_the_names_that_do_exist() {
    let harness = Harness::new("missing", "quickjs-test.missing");
    let mut host = harness.host();
    let plan = EntryPlan {
        bundle_name: "quickjs-test.missing",
        source: fixture("pure-node.js"),
        run_export: "runOperation",
        create_runtime_export: None,
        pure_message: "",
    };
    let error = RealmRun::new(descriptor("quickjs-test.missing"), plan)
        .expect("budgeted")
        .run("{}", &mut host)
        .expect_err("the fixture exports `run`, not `runOperation`");
    assert!(error.message.contains("does not export \"runOperation\""), "{}", error.message);
    assert!(error.message.contains("run"), "the answer must list what exists: {}", error.message);
}

/// A request document that is not JSON is refused before the bundle runs.
#[test]
fn an_unparseable_request_document_is_a_run_error() {
    let harness = Harness::new("badrequest", "quickjs-test.badrequest");
    let mut host = harness.host();
    let error = executor("quickjs-test.badrequest", fixture("pure-node.js"))
        .run("{not json", &mut host)
        .expect_err("the request document is JSON, by the operation protocol");
    assert!(error.message.contains("request document"), "{}", error.message);
}

/// A parked promise is reported as a parked run instead of hanging the operation.
#[test]
fn a_run_parked_on_a_never_settled_promise_is_stopped_and_explained() {
    let harness = Harness::new("parked", "quickjs-test.parked");
    let started = std::time::Instant::now();
    let mut host = harness.host();
    let plan = EntryPlan {
        bundle_name: "quickjs-test.parked",
        source: fixture("parked-node.js"),
        run_export: "run",
        create_runtime_export: Some("run"),
        pure_message: "",
    };
    let error = RealmRun::new(descriptor("quickjs-test.parked"), plan)
        .expect("budgeted")
        .with_run_deadline(std::time::Duration::from_secs(10))
        .run("{}", &mut host)
        .expect_err("nothing will settle this await");
    assert!(error.message.contains("parked"), "{}", error.message);
    assert!(
        started.elapsed() < std::time::Duration::from_secs(3),
        "the executor must stop waiting, not wait out the deadline: {:?}",
        started.elapsed()
    );
}

/// The registry's own dispatch path: a definition-named node function reaches its JS export.
static FUNCTION_SPEC: JsNodeSpec = JsNodeSpec::platform(
    NodeDescriptor::new("quickjs-test.functions", "0.1.0", 1)
        .with_roots(&[RootRequirement { role: "workspace", access: RootAccess::ReadWrite }])
        .budget(8 * 1024 * 1024, 1),
    include_str!("fixtures/function-node.js"),
    "run",
    "createRuntime",
)
.with_functions(&["isDangerous", "preview", "normalizeName"]);

static FUNCTION_NODE: JsNode = JsNode::new(&FUNCTION_SPEC);

static FUNCTION_RUNNABLE: &'static dyn BuiltInNode = &FUNCTION_NODE;

xiranite_node_registry::register_node!(FUNCTION_SPEC.descriptor);
xiranite_node_registry::register_node!(FUNCTION_RUNNABLE);

#[test]
fn a_definition_named_node_function_resolves_to_its_js_export_through_the_registry() {
    let registry = NodeRegistry::builtin().expect("one node per id in this test binary");
    assert!(
        registry.supports_function("quickjs-test.functions", "preview"),
        "the published list is what a definition is checked against"
    );
    assert!(!registry.supports_function("quickjs-test.functions", "danger_prompt"));

    let harness = Harness::new("functions", "quickjs-test.functions");
    let mut host = harness.host();
    let preview = registry
        .call_function(
            "quickjs-test.functions",
            "preview",
            r#"{"names":["one","two","three","four"]}"#,
            &mut host,
        )
        .expect("published, so callable");
    let value: serde_json::Value = serde_json::from_str(&preview).expect("the answer is JSON");
    assert_eq!(value["count"], 3, "{value}");
    assert_eq!(value["rows"].as_array().expect("rows").len(), 3, "{value}");

    // A scalar answer crosses as its JSON text, which is what `isDangerous` is declared to return.
    let dangerous = registry
        .call_function("quickjs-test.functions", "isDangerous", r#"{"action":"dissolve"}"#, &mut host)
        .expect("published");
    assert_eq!(dangerous, "true", "{dangerous}");
    let not_dangerous = registry
        .call_function("quickjs-test.functions", "isDangerous", r#"{"action":"plan"}"#, &mut host)
        .expect("published");
    assert_eq!(not_dangerous, "false", "{not_dangerous}");

    // A string answer crosses verbatim, because the caller renders the text.
    let name = registry
        .call_function("quickjs-test.functions", "normalizeName", r#"{"value":"  MiXeD Case "}"#, &mut host)
        .expect("published");
    assert_eq!(name, "mixed case", "{name}");

    // Drift and link failures stay distinguishable, the way the registry documents them.
    let drift = registry
        .call_function("quickjs-test.functions", "result_view", "{}", &mut host)
        .expect_err("the definition names something the bundle does not publish");
    assert!(drift.message.contains("publishes"), "{}", drift.message);
    assert!(
        registry
            .call_function("quickjs-test.absent", "preview", "{}", &mut host)
            .expect_err("no such node is a link problem")
            .message
            .contains("no built-in node"),
        "the two failure arms must not collapse"
    );
}

#[test]
fn the_registered_scripted_node_declares_the_policy_the_host_has_to_enforce() {
    let registry = NodeRegistry::builtin().expect("no duplicate id");
    let descriptor = registry
        .get("quickjs-test.functions")
        .expect("the spec reached the table");
    assert_eq!(descriptor.requirements.roots[0].role, "workspace");
    assert_eq!(descriptor.requirements.max_live_bytes, 8 * 1024 * 1024);
    assert_eq!(
        descriptor.requirements.max_live_bytes / 8,
        EngineLimits::stack_from_budget(descriptor.requirements.max_live_bytes),
        "the stack ceiling must be derived from the node's own declaration"
    );
    assert_eq!(
        registry.functions_of("quickjs-test.functions").expect("runnable"),
        &["isDangerous", "preview", "normalizeName"][..]
    );
}
