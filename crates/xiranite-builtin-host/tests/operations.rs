//! The load-bearing proof for ADR-0074: a face starts an operation over the documented HTTP routes and
//! the *linked-in* QuickJS node runs it — the granted filesystem, the host clock and entropy, the event
//! stream, and the node's own result document, with no Bun process and no in-process import of
//! `core.ts`.
//!
//! Everything below is the production path: [`BuiltInNodeLauncher`] behind the real `xiranite-api`
//! router, the same `dissolvef.js` bundle the host links (`build.rs` staged it from
//! `artifacts/node-bundles/`), and a [`FileCapability`] over one temp directory. The expectations are
//! copied from `packages/nodes/dissolvef/src/core.test.ts` so a green run here means the bundle answers
//! what the TypeScript oracle answers, not merely that a promise resolved.
//!
//! Run with `cargo test -p xiranite-builtin-host`. It requires `bun run build:node-bundles` to have
//! produced the bundle — `build.rs` refuses to compile without it.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::http::{HeaderName, Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use xiranite_api::{ApiContext, router};
use xiranite_builtin_host::BuiltInNodeLauncher;
use xiranite_core::{OperationManager, OperationManagerOptions, SystemClock};

const TOKEN: &str = "builtin-host-test-token";

/// The fixture the `collect_archives` oracle case in `scripts/quickjs-parity-cases.ts` builds.
const FIXTURE: &[(&str, &str)] = &[
    ("series_a/series_a.zip", "zip"),
    ("series_b/series_b.zip", "zip"),
    ("series_b/readme.txt", "extra"),
    ("alpha/beta.zip", "zip"),
];

struct TempRoot(PathBuf);

impl TempRoot {
    /// A unique directory under the system temp dir; unique per test thread and per call.
    fn new(tag: &str) -> Self {
        static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let unique = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!(
            "xiranite-builtin-host-{tag}-{}-{unique}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("temp root");
        Self(std::fs::canonicalize(path).expect("canonical temp root"))
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn build_fixture(root: &Path) {
    for (relative, content) in FIXTURE {
        let target = root.join(relative);
        std::fs::create_dir_all(target.parent().expect("fixture parent")).expect("fixture dir");
        std::fs::write(target, content).expect("fixture file");
    }
}

async fn read_body(response: axum::response::Response) -> Value {
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("the body collects")
        .to_bytes();
    serde_json::from_slice(&bytes).expect("the route answers one JSON document")
}

async fn post(app: &axum::Router, path: &str, body: &str) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(path)
                .header(HeaderName::from_static("x-xiranite-token"), TOKEN)
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_owned()))
                .expect("a valid request"),
        )
        .await
        .expect("the router serves the request");
    let status = response.status();
    (status, read_body(response).await)
}

async fn get(app: &axum::Router, path: &str) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(path)
                .header(HeaderName::from_static("x-xiranite-token"), TOKEN)
                .body(Body::empty())
                .expect("a valid request"),
        )
        .await
        .expect("the router serves the request");
    let status = response.status();
    (status, read_body(response).await)
}

/// The documented request envelope: `nodeRunRequestSchema` is `{ input?, context? }` with `input` as
/// raw JSON (`routes.rs:44-46`), so a face that posts the bare input document is answered as "no input".
/// This test found that out the useful way: the node ran inside QuickJS and replied with its own
/// `Path is required.` envelope, which proves the run happened against an empty document.
fn request(input: &Value) -> Value {
    json!({
        "input": input,
        "context": { "componentId": "builtin-host-test", "workspaceId": "builtin-host-test" },
    })
}

/// A host over one granted directory, exactly as `stage_from_environment` builds one.
fn app_over(root: &Path) -> axum::Router {
    let launcher = BuiltInNodeLauncher::new(
        Arc::new(SystemClock),
        vec![root.to_path_buf()],
    )
    .expect("dissolvef is linked into this host");
    let context = ApiContext::new(
        OperationManager::with_clock(Arc::new(SystemClock), OperationManagerOptions::default()),
        TOKEN,
        "builtin-host-test",
        Arc::new(launcher),
    );
    router(Arc::new(context))
}

/// The node id list a correctly linked host reports — the check that the bundle and its descriptor are
/// both in the registry, not just the crate. One entry per node `build.rs` stages, spelled once here so a
/// node that silently stops being linked shows up as a missing id rather than a passing run.
#[tokio::test]
async fn the_built_in_host_lists_every_linked_node() {
    let root = TempRoot::new("ids");
    let launcher = BuiltInNodeLauncher::new(Arc::new(SystemClock), vec![root.0.clone()])
        .expect("a non-empty registry");
    let mut served = launcher.node_ids();
    served.sort_unstable();
    let mut expected = vec!["dissolvef", "kisaki"];
    expected.extend(xiranite_scripted_nodes::SCRIPTED_NODE_IDS.iter().copied());
    expected.sort_unstable();
    assert_eq!(served, expected, "the linked node set is spelled once");
}

#[tokio::test]
async fn collect_archives_runs_the_bundled_node_over_the_http_routes() {
    let root = TempRoot::new("collect");
    build_fixture(&root.0);
    let app = app_over(&root.0);

    let input = json!({
        "action": "collect_archives",
        "path": root.0.display().to_string(),
        "protectFirstLevel": false,
        "similarityThreshold": 0.9,
        "skipBlacklist": true,
    });
    let (status, queued) = post(&app, "/nodes/dissolvef/operations", &request(&input).to_string()).await;
    assert_eq!(status, StatusCode::OK, "the start route answered: {queued}");
    let operation_id = queued["operation"]["operationId"].as_str().expect("an operation id").to_owned();
    assert_eq!(queued["operation"]["phase"], "queued", "start answers before the run finishes");

    // The run is on a blocking thread, so the client polls the documented route. The bound is generous
    // and the assertion is on the *terminal* phase: a host that never gets there must fail this test,
    // not pass it on a partial read.
    let mut record = Value::Null;
    for _ in 0..600 {
        let (status, body) = get(&app, &format!("/node-operations/{operation_id}")).await;
        assert_eq!(status, StatusCode::OK, "the operation is readable while it runs");
        let phase = body["operation"]["phase"].as_str().unwrap_or_default().to_owned();
        if phase != "queued" && phase != "running" && phase != "pausing" && phase != "paused" {
            record = body;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let operation = &record["operation"];
    assert_eq!(
        operation["phase"].as_str(),
        Some("completed"),
        "the QuickJS node must reach a terminal phase, saw: {record}"
    );

    // The oracle: `collect_archives` keeps only `series_a/series_a.zip` (similarity ≥ 0.9 between the
    // folder name and the archive name), and every path is the caller's own absolute spelling.
    let expected = root.0.join("series_a").join("series_a.zip");
    let result = &operation["result"];
    assert_eq!(result["success"], json!(true), "the node reported success: {operation}");
    assert_eq!(
        result["data"]["archivePaths"],
        json!([expected.display().to_string()]),
        "the same archive list the TypeScript core returns"
    );
    assert_eq!(result["data"]["skippedCount"], json!(0), "{operation}");

    // The monitor card and the terminal faces read this page, so it has to answer the operation's phase
    // alongside its event list — an event stream that never reached the operation is the failure a UI
    // reports as "the card spins".
    let (status, events) = get(&app, &format!("/node-operations/{operation_id}/events")).await;
    assert_eq!(status, StatusCode::OK, "the event page is served: {events}");
    assert!(events["events"].is_array(), "the event page answers a list: {events}");
    assert_eq!(events["operation"]["phase"], "completed", "the page carries the operation too: {events}");
}

/// The filesystem half, with teeth: a real dissolve must move a file *inside the grant*, and the host
/// must refuse the same call when the path sits outside it.
#[tokio::test]
async fn a_nested_dissolve_moves_the_file_and_an_unganted_path_is_refused() {
    let root = TempRoot::new("nested");
    std::fs::create_dir_all(root.0.join("a/b/c")).expect("fixture dirs");
    std::fs::write(root.0.join("a/b/c/test.txt"), "hello").expect("fixture file");
    let app = app_over(&root.0);

    let history = root.0.join("history.json");
    let input = json!({
        "action": "nested",
        "path": root.0.join("a").display().to_string(),
        "historyPath": history.display().to_string(),
        "enableSimilarity": false,
    });
    let (_, queued) = post(&app, "/nodes/dissolvef/operations", &request(&input).to_string()).await;
    let operation_id = queued["operation"]["operationId"].as_str().expect("an operation id").to_owned();
    let record = await_terminal(&app, &operation_id).await;
    assert_eq!(
        record["operation"]["result"]["success"],
        json!(true),
        "the granted nested dissolve succeeds: {}",
        record["operation"]
    );
    assert!(root.0.join("a/test.txt").is_file(), "the file moved up out of a/b/c");
    assert!(!root.0.join("a/b/c/test.txt").exists(), "and the emptied folders are gone");

    // Same action, pointed at a directory the operation was never granted. `FileCapability` answers the
    // refusal, the node reports it as a failed run, and the host must not have touched anything.
    let outside = TempRoot::new("outside");
    let escaped = json!({ "action": "nested", "path": outside.0.join("a").display().to_string() });
    let (status, refused) = post(&app, "/nodes/dissolvef/operations", &request(&escaped).to_string()).await;
    assert_eq!(status, StatusCode::OK, "an ungranted path is refused by the run, not by the route");
    let escaped_id = refused["operation"]["operationId"]
        .as_str()
        .unwrap_or_else(|| panic!("the ungranted run still registers an operation: {refused}"))
        .to_owned();
    let record = await_terminal(&app, &escaped_id).await;
    assert_eq!(
        record["operation"]["phase"].as_str(),
        Some("error"),
        "a path outside the granted root must not run: {}",
        record["operation"]
    );
    assert!(
        record["operation"]["result"]["message"]
            .as_str()
            .is_some_and(|message| !message.trim().is_empty()),
        "the refusal says why: {}",
        record["operation"]
    );
}

/// Polls the documented route until the operation leaves the non-terminal phases.
async fn await_terminal(app: &axum::Router, operation_id: &str) -> Value {
    for _ in 0..600 {
        let (_, body) = get(app, &format!("/node-operations/{operation_id}")).await;
        let phase = body["operation"]["phase"].as_str().unwrap_or_default().to_owned();
        if !matches!(phase.as_str(), "queued" | "running" | "pausing" | "paused") {
            return body;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    panic!("operation {operation_id} never reached a terminal phase")
}

/// The 401 arm is part of this crate's story too: a face that attaches without the token gets nothing,
/// so `XIRANITE_BACKEND_TOKEN` is not optional decoration.
#[tokio::test]
async fn an_unauthenticated_operation_request_is_refused() {
    let root = TempRoot::new("token");
    let app = app_over(&root.0);
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/nodes/dissolvef/operations")
                .body(Body::from("{}"))
                .expect("a valid request"),
        )
        .await
        .expect("the router serves the request");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "no token, no run");
}
