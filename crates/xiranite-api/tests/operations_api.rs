//! Integration tests for the `/node-operations` family, driven through `tower::ServiceExt`
//! against the router in `crates/xiranite-api/src/lib.rs`.
//!
//! The assertions are shape assertions: the field names and status codes here are the ones
//! `packages/api/src/index.ts` publishes and `packages/api/src/client.ts` reads, so a drift in
//! this file is a protocol break, not a test preference.

use std::sync::Arc;
use std::sync::Mutex;

use axum::body::Body;
use axum::http::{HeaderName, Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt;
use xiranite_api::{ApiContext, LaunchRequest, OperationLauncher, router};
use xiranite_core::{
    ManualClock, NodeRunEventRecord, NodeRunResultRecord, OperationManager, OperationManagerOptions,
    OperationPhase,
};

const TOKEN: &str = "test-token";

/// Records what the seam receives, and optionally drives the operation to a terminal phase in
/// the calling thread so a test can observe a finished operation without sleeping.
struct Recorder {
    launches: Mutex<Vec<(String, Vec<u8>)>>,
    finish: bool,
}

impl Recorder {
    fn new(finish: bool) -> Self {
        Self { launches: Mutex::new(Vec::new()), finish }
    }
}

impl OperationLauncher for Recorder {
    fn launch(&self, request: LaunchRequest) {
        let manager = request.manager.clone();
        let operation_id = request.control.operation_id().to_owned();
        self.launches
            .lock()
            .expect("recorder")
            .push((request.node_id.clone(), request.input.to_vec()));
        // `executeOperation()` writes `running` before the first plugin call.
        manager.mark_running(&operation_id);
        if self.finish {
            manager.push_event(&operation_id, NodeRunEventRecord::log_line("scanning 12 of 48"));
            manager.finish(&operation_id, OperationPhase::Completed, NodeRunResultRecord::succeeded("12 rows"));
        }
    }
}

fn manager() -> OperationManager {
    OperationManager::with_manual_clock(
        ManualClock::new(1_000),
        OperationManagerOptions::default(),
    )
}

fn app(launcher: Arc<dyn OperationLauncher>) -> axum::Router {
    router(Arc::new(ApiContext::new(
        manager(),
        TOKEN,
        "test-instance",
        launcher,
    )))
}

async fn ask(
    app: axum::Router,
    request: Request<Body>,
) -> (StatusCode, serde_json::Value, axum::http::HeaderMap) {
    let response = app.oneshot(request).await.expect("router answers");
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("body collects")
        .to_bytes();
    // The stream route answers NDJSON, so a blank body must not be fed to the JSON parser.
    let value = if bytes.is_empty() {
        serde_json::Value::Null
    } else {
        match serde_json::from_slice(&bytes) {
            Ok(value) => value,
            Err(_) => serde_json::Value::String(String::from_utf8_lossy(&bytes).into_owned()),
        }
    };
    (status, value, headers)
}

fn get(uri: &str) -> Request<Body> {
    Request::builder().method("GET").uri(uri).body(Body::empty()).expect("request")
}

fn post(uri: &str, json: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(json.to_owned()))
        .expect("request")
}

fn with_token(request: Request<Body>) -> Request<Body> {
    let (mut parts, body) = request.into_parts();
    parts.headers.insert(
        HeaderName::from_static("x-xiranite-token"),
        axum::http::HeaderValue::from_static(TOKEN),
    );
    Request::from_parts(parts, body)
}

#[tokio::test]
async fn health_answers_without_a_token_and_cors_headers_are_advertised() {
    let (status, body, headers) = ask(app(Arc::new(xiranite_api::NoPluginRuntime)), get("/health")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, serde_json::json!({ "ok": true }), "health answers the ok object");
    assert_eq!(
        headers.get("access-control-allow-headers").and_then(|value| value.to_str().ok()),
        Some("content-type,x-xiranite-token,x-xiranite-filename"),
        "the WebView's dev origin depends on this exact list"
    );
}

#[tokio::test]
async fn every_other_route_refuses_a_missing_or_wrong_token_with_the_plain_text_body() {
    let app = app(Arc::new(xiranite_api::NoPluginRuntime));
    let (missing, body, _) = ask(app.clone(), get("/node-operations")).await;
    assert_eq!(missing, StatusCode::UNAUTHORIZED);
    assert_eq!(
        body,
        serde_json::Value::String("Unauthorized".to_owned()),
        "the legacy middleware answers the bare text, not a JSON envelope"
    );

    let wrong = Request::builder()
        .method("GET")
        .uri("/node-operations")
        .header("x-xiranite-token", "nope")
        .body(Body::empty())
        .expect("request");
    let (status, _, _) = ask(app.clone(), wrong).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "a wrong token is not a valid token");

    // The query form exists because EventSource and downloads cannot add headers.
    let (query_ok, _, _) = ask(app, get("/node-operations?token=test-token")).await;
    assert_eq!(query_ok, StatusCode::OK);
}

#[tokio::test]
async fn start_operation_hands_the_raw_input_to_the_launcher_and_answers_the_queued_record() {
    let recorder = Arc::new(Recorder::new(false));
    let app = app(Arc::clone(&recorder) as Arc<dyn OperationLauncher>);

    let (status, body, _) = ask(
        app.clone(),
        with_token(post("/nodes/enginev/operations", r#"{"input":{"path":"D:/in"},"context":{"workspaceId":"ws-1"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let operation = &body["operation"];
    assert_eq!(operation["nodeId"], "enginev");
    assert_eq!(operation["workspaceId"], "ws-1");
    assert_eq!(operation["phase"], "queued", "startOperation answers before the plugin runs");
    assert_eq!(operation["eventCount"], 0);
    assert_eq!(operation["createdAt"], 1_000);
    for absent in ["componentId", "startedAt", "finishedAt", "result"] {
        assert!(operation.get(absent).is_none(), "{absent} serialized although the state lacks it");
    }

    {
        let launches = recorder.launches.lock().expect("recorder");
        assert_eq!(launches.len(), 1);
        assert_eq!(launches[0].0, "enginev");
        // ADR-0068: `input` is an encoding, so the bytes the client sent reach the seam unchanged.
        let forwarded: serde_json::Value = serde_json::from_slice(&launches[0].1).expect("input survives");
        assert_eq!(forwarded["path"], "D:/in");
    }

    // The same operation is now readable, and its `running` write came from the launcher.
    let operation_id = operation["operationId"].as_str().expect("operationId").to_owned();
    let (_, body, _) = ask(app, with_token(get(&format!("/node-operations/{operation_id}")))).await;
    assert_eq!(body["operation"]["phase"], "running");
}

#[tokio::test]
async fn an_empty_body_is_a_legal_run_request() {
    let recorder = Arc::new(Recorder::new(false));
    let (status, body, _) = ask(
        app(Arc::clone(&recorder) as Arc<dyn OperationLauncher>),
        with_token(post("/nodes/snf/operations", "")),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["operation"]["nodeId"], "snf");
    let launches = recorder.launches.lock().expect("recorder");
    assert_eq!(launches[0].1, b"{}", "an absent input reaches the plugin as an empty object");
}

#[tokio::test]
async fn a_malformed_body_is_rejected_with_the_error_envelope_the_client_renders() {
    let (status, body, _) = ask(
        app(Arc::new(xiranite_api::NoPluginRuntime)),
        with_token(post("/nodes/snf/operations", "{not json")),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].is_string(), "got {body}");
}

#[tokio::test]
async fn list_operations_filters_sorts_and_clamps_like_the_legacy_route() {
    let recorder = Arc::new(Recorder::new(true));
    let app = app(Arc::clone(&recorder) as Arc<dyn OperationLauncher>);
    let tokenized = |uri: &'static str| with_token(get(uri));

    let (status, trename, _) = ask(
        app.clone(),
        with_token(post("/nodes/trename/operations", r#"{"input":{"action":"scan"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, snf, _) = ask(app.clone(), with_token(post("/nodes/snf/operations", ""))).await;
    assert_eq!(status, StatusCode::OK);
    let trename_id = trename["operation"]["operationId"].as_str().expect("id").to_owned();
    let snf_id = snf["operation"]["operationId"].as_str().expect("id").to_owned();

    // Both were created on a frozen clock, so the tie is broken by id: the registry is a BTreeMap
    // and trename started first, hence snf sorts first under `createdAt` descending.
    let (_, all, _) = ask(app.clone(), tokenized("/node-operations")).await;
    assert_eq!(all["operations"].as_array().expect("array").len(), 2);
    assert_eq!(all["total"], 2);
    assert_eq!(all["operations"][0]["nodeId"], "snf");
    assert!(all["operations"][0].get("operations").is_none());

    let (_, filtered, _) = ask(app.clone(), tokenized("/node-operations?nodeId=trename")).await;
    assert_eq!(filtered["operations"].as_array().expect("array").len(), 1);
    assert_eq!(filtered["operations"][0]["operationId"], trename_id);

    // `activeOnly === "true"`: everything is terminal here, so the page is empty.
    let (_, active, _) = ask(app.clone(), tokenized("/node-operations?activeOnly=true")).await;
    assert_eq!(active["operations"].as_array().expect("array").len(), 0);

    // An unparseable limit is dropped rather than rejected, and the clamp is 1..=500.
    let (_, loose, _) = ask(app.clone(), tokenized("/node-operations?limit=abc")).await;
    assert_eq!(loose["operations"].as_array().expect("array").len(), 2);
    let (_, clamped, _) = ask(app, tokenized("/node-operations?limit=0")).await;
    assert_eq!(clamped["operations"].as_array().expect("array").len(), 1);
    let _ = snf_id;
}

#[tokio::test]
async fn events_page_with_absolute_indexes_and_the_legacy_default_from() {
    let recorder = Arc::new(Recorder::new(true));
    let app = app(Arc::clone(&recorder) as Arc<dyn OperationLauncher>);
    let (_, body, _) = ask(app.clone(), with_token(post("/nodes/enginev/operations", ""))).await;
    let operation_id = body["operation"]["operationId"].as_str().expect("id").to_owned();

    let (status, events, _) = ask(
        app.clone(),
        with_token(get(&format!("/node-operations/{operation_id}/events"))),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(events["total"], 1, "the recorder pushed exactly one event");
    assert_eq!(events["from"], 0);
    assert_eq!(events["events"][0]["index"], 0);
    assert_eq!(events["events"][0]["event"]["message"], "scanning 12 of 48");
    assert_eq!(events["operation"]["phase"], "completed");
    assert!(events["next"].is_null(), "a full page reports no continuation");

    // `from` past the end answers an empty window without inventing an event.
    let (_, tail, _) = ask(
        app.clone(),
        with_token(get(&format!("/node-operations/{operation_id}/events?from=9"))),
    )
    .await;
    assert_eq!(tail["events"].as_array().expect("array").len(), 0);
    assert_eq!(tail["total"], 1, "total keeps counting whether retained or not");

    // The token gate answers before the store is consulted, so a bad token cannot probe existence.
    let (unauthorized, _, _) = ask(app.clone(), get("/node-operations/op-gone/events")).await;
    assert_eq!(unauthorized, StatusCode::UNAUTHORIZED);

    let (status, missing, _) = ask(app, with_token(get("/node-operations/op-gone/events"))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(missing["error"], "Node operation not found.");
}

#[tokio::test]
async fn pause_and_resume_and_cancel_answer_the_record_and_the_legacy_default_cancel_reason() {
    let recorder = Arc::new(Recorder::new(false));
    let app = app(Arc::clone(&recorder) as Arc<dyn OperationLauncher>);
    let (_, body, _) = ask(app.clone(), with_token(post("/nodes/enginev/operations", ""))).await;
    let operation_id = body["operation"]["operationId"].as_str().expect("id").to_owned();
    let control = |path: &str| with_token(post(&format!("/node-operations/{operation_id}/{path}"), ""));

    let (status, paused, _) = ask(app.clone(), control("pause")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(paused["operation"]["phase"], "paused");

    let (_, resumed, _) = ask(app.clone(), control("resume")).await;
    assert_eq!(resumed["operation"]["phase"], "running");

    let (_, cancelled, _) = ask(app.clone(), control("cancel")).await;
    assert_eq!(cancelled["operation"]["phase"], "cancelled");
    assert!(cancelled["operation"]["cancelledAt"].is_number());
    assert_eq!(
        cancelled["operation"]["result"]["message"],
        "Node operation cancelled.",
        "the legacy route passes no reason, so NodeRunnerService's default text is what lands"
    );

    // A terminal operation answers its own record rather than an error.
    let (status, again, _) = ask(app.clone(), control("pause")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(again["operation"]["phase"], "cancelled");

    let (status, missing, _) = ask(
        app,
        with_token(post("/node-operations/op-gone/cancel", "")),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(missing["error"], "Node operation not found.");
}

#[tokio::test]
async fn cleanup_reports_both_counts_as_an_unwrapped_object() {
    let recorder = Arc::new(Recorder::new(true));
    let app = app(Arc::clone(&recorder) as Arc<dyn OperationLauncher>);
    let (status, _, _) = ask(app.clone(), with_token(post("/nodes/enginev/operations", ""))).await;
    assert_eq!(status, StatusCode::OK);

    // Nothing is old yet on a frozen clock, so cleanup removes nothing.
    let (status, body, _) = ask(app.clone(), with_token(Request::builder().method("DELETE").uri("/node-operations").body(Body::empty()).expect("request"))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["removedCount"], 0);
    assert_eq!(body["remainingCount"], 1);

    // A zero window ages the finished operation out immediately.
    let (status, cleared, _) = ask(
        app.clone(),
        with_token(
            Request::builder()
                .method("DELETE")
                .uri("/node-operations?maxAgeMs=0")
                .body(Body::empty())
                .expect("request"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(cleared["removedCount"], 1);
    assert_eq!(cleared["remainingCount"], 0);
}

#[tokio::test]
async fn the_stream_answers_ndjson_snapshot_then_events_then_result() {
    let recorder = Arc::new(Recorder::new(true));
    let app = app(Arc::clone(&recorder) as Arc<dyn OperationLauncher>);
    let (_, body, _) = ask(app.clone(), with_token(post("/nodes/enginev/operations", ""))).await;
    let operation_id = body["operation"]["operationId"].as_str().expect("id").to_owned();

    let response = app
        .clone()
        .oneshot(with_token(get(&format!("/node-operations/{operation_id}/stream?token={TOKEN}"))))
        .await
        .expect("router answers");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get("content-type").and_then(|value| value.to_str().ok()),
        Some("application/x-ndjson; charset=utf-8")
    );
    assert_eq!(response.headers().get("cache-control").and_then(|value| value.to_str().ok()), Some("no-store"));

    let bytes = response.into_body().collect().await.expect("body").to_bytes();
    let text = String::from_utf8(bytes.to_vec()).expect("utf-8 stream");
    let lines: Vec<&str> = text.lines().collect();
    let frames: Vec<serde_json::Value> = lines
        .iter()
        .map(|line| serde_json::from_str(line).unwrap_or_else(|error| panic!("{line}: {error}")))
        .collect();
    assert_eq!(frames[0]["type"], "operation", "includeSnapshot is true on this route");
    assert_eq!(frames[1]["type"], "event");
    assert_eq!(frames[1]["event"]["message"], "scanning 12 of 48");
    assert_eq!(frames.last().expect("frame")["type"], "result");
    assert_eq!(frames.last().expect("frame")["result"]["message"], "12 rows");
    assert!(text.ends_with('\n'), "each frame is one JSON line");

    let (status, missing, _) = ask(app.clone(), with_token(get("/node-operations/op-gone/stream"))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(missing["error"], "Node operation not found.");
}

#[tokio::test]
async fn without_a_plugin_runtime_an_operation_fails_loudly_instead_of_hanging() {
    let app = app(Arc::new(xiranite_api::NoPluginRuntime));
    let (status, body, _) = ask(app.clone(), with_token(post("/nodes/enginev/operations", ""))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["operation"]["phase"], "queued", "the HTTP answer is still the queued record");

    let operation_id = body["operation"]["operationId"].as_str().expect("id").to_owned();
    let (_, finished, _) = ask(app, with_token(get(&format!("/node-operations/{operation_id}")))).await;
    assert_eq!(finished["operation"]["phase"], "error");
    let message = finished["operation"]["result"]["message"].as_str().unwrap_or_default();
    assert!(message.contains("no plugin runtime"), "{message}");
    assert!(message.contains("enginev"), "the message names the node that could not run: {message}");
}
