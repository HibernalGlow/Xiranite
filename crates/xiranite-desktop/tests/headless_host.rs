//! Headless proof of the desktop host's channel contract (ADR-0065), with no window involved.
//!
//! Each test drives [`xiranite_desktop::start_backend`] — the function `main.rs` calls — over a real
//! loopback socket, so the ephemeral port, the two token positions, the `/node-operations` family and
//! the NDJSON stream are all evidenced against the shipped code path instead of a test-only imitation.
//! Every host is stopped through [`xiranite_desktop::BackendHandle::shutdown`] inside the test body,
//! which is the Rust form of the repo's isolated-backend rule: own data directory, finite lifetime, and
//! a confirmed closed listener (`a_second_host_gets_its_own_port_and_token` checks exactly that).
//!
//! With no plugin runtime attached, `xiranite-api`'s `NoPluginRuntime` finishes a started operation as
//! `error` with an explicit message. The assertions below encode that as *expected*, because the point
//! is the protocol and the lifecycle, not a pretend successful run.

mod support;

use std::net::TcpStream;
use std::path::Path;
use std::time::Duration;

use support::{Reply, request, try_request};
use xiranite_desktop::{BackendHandle, BackendStart, BootstrapPayload, HostChannel, start_backend};

/// `packages/nodes/dissolvef/src/interaction.ts`'s `toInput()` shape, camelCase, so the body the host
/// accepts is the body the terminal faces would send.
const DISSOLVEF_INPUT: &str = r#"{"action":"plan","path":"","preview":true,"fileConflict":"auto","dirConflict":"auto","enableSimilarity":true,"similarityThreshold":0.6,"protectFirstLevel":true,"exclude":"","historyPath":"","historyLimit":20,"undoId":"","skipBlacklist":false}"#;

/// The WebView's own rule, mirrored from `src/backend/tauriChannel.ts:39`
/// (`/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i`). Written by hand because this crate has no regex
/// dependency and must not add one for a single assertion.
fn base_url_is_a_loopback_channel(base_url: &str) -> bool {
    let Some(rest) = base_url.strip_prefix("http://").or_else(|| base_url.strip_prefix("HTTP://")) else {
        return false;
    };
    let (host, port) = match rest.rsplit_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (rest, None),
    };
    let host_is_allowed = host.eq_ignore_ascii_case("127.0.0.1") || host.eq_ignore_ascii_case("localhost");
    if !host_is_allowed {
        return false;
    }
    match port {
        None => true,
        Some(port) => !port.is_empty() && port.bytes().all(|byte| byte.is_ascii_digit()),
    }
}

/// The payload half of the contract: the field spellings and non-empty rules
/// `parseTauriBootstrapPayload` applies before it configures anything.
fn assert_webview_validator_accepts(channel: &HostChannel) -> BootstrapPayload {
    let payload = BootstrapPayload::from_channel(channel);
    let value = serde_json::to_value(&payload).expect("the bootstrap payload is serializable");
    assert!(base_url_is_a_loopback_channel(&payload.base_url), "baseUrl `{}` fails the WebView regex", payload.base_url);
    assert!(!payload.token.is_empty(), "an empty token makes the client drop the channel");
    assert!(!payload.instance_id.is_empty(), "an empty instanceId cannot detect a restarted host");
    // The validator reads `baseUrl`/`token`/`instanceId`; anything else in the object is ignored, and
    // a snake_case key would read as `undefined` and silently mean "no usable loopback channel".
    assert_eq!(value["baseUrl"].as_str(), Some(payload.base_url.as_str()));
    assert_eq!(value["token"].as_str(), Some(payload.token.as_str()));
    assert_eq!(value["instanceId"].as_str(), Some(payload.instance_id.as_str()));
    assert!(value.get("instance_id").is_none() && value.get("base_url").is_none(), "camelCase keys are the protocol");
    payload
}

fn token_header(token: &str) -> [(&str, &str); 1] {
    [("x-xiranite-token", token)]
}

/// 01 + 02 + 03: the triple, the `/health` exemption, and the rejection path.
#[test]
fn the_published_channel_passes_the_webview_validator_and_gates_every_route_but_health() {
    let backend = start_backend(BackendStart::placeholder()).expect("the loopback backend starts headlessly");
    let channel = backend.channel().clone();
    let payload = assert_webview_validator_accepts(&channel);

    // The command name is spelled by the frontend, not by this crate.
    assert_eq!(xiranite_desktop::BOOTSTRAP_COMMAND_NAME, "xiranite_bootstrap");

    // `/health` with no header and no query token — the status banner polls it before a channel exists.
    let health = request(channel.base_url(), "GET", "/health", &[], None);
    assert_eq!(health.status, 200, "/health must answer without a token");
    assert_eq!(health.json()["ok"], serde_json::json!(true));
    assert_eq!(
        health.header("access-control-allow-origin"),
        Some("*"),
        "the WebView origin can only read the body once the host grants it"
    );

    // A wrong token is a 401 with the legacy plain-text body, on a non-/health route.
    let wrong = request(channel.base_url(), "GET", "/node-operations", &token_header("not-the-instance-token"), None);
    assert_eq!(wrong.status, 401);
    assert_eq!(wrong.text(), "Unauthorized");
    // …and so is a missing one.
    let missing = request(channel.base_url(), "GET", "/node-operations", &[], None);
    assert_eq!(missing.status, 401);
    assert_eq!(missing.text(), "Unauthorized");

    // The query form is the second accepted position (an `EventSource`-shaped client cannot add a
    // header), and it works on the plain list route too.
    let via_query = request(channel.base_url(), "GET", &format!("/node-operations?token={}", payload.token), &[], None);
    assert_eq!(via_query.status, 200, "a query token is a valid credential");
    assert_eq!(via_query.json()["total"], serde_json::json!(0));

    // A preflight from the WebView origin is answered before authorization, with the legacy grant.
    let preflight = request(
        channel.base_url(),
        "OPTIONS",
        "/node-operations",
        &[("origin", "tauri://localhost"), ("access-control-request-method", "GET")],
        None,
    );
    assert_eq!(preflight.status, 204, "the host must answer OPTIONS itself");
    assert_eq!(preflight.header("access-control-allow-origin"), Some("*"));
    assert!(
        preflight
            .header("access-control-allow-headers")
            .is_some_and(|value| value.contains("x-xiranite-token")),
        "the WebView sends the token header on POSTs"
    );

    backend.shutdown().expect("the host stops cleanly");
}

/// 04 + 05 + 06: a dissolvef operation, its NDJSON stream over the query token, and its terminal state.
#[test]
fn a_dissolvef_operation_is_queued_then_finishes_and_the_stream_reports_the_terminal_state() {
    let backend = start_backend(BackendStart::placeholder()).expect("the loopback backend starts headlessly");
    let channel = backend.channel().clone();

    let started = request(
        channel.base_url(),
        "POST",
        "/nodes/dissolvef/operations",
        &[("content-type", "application/json"), ("x-xiranite-token", channel.token())],
        Some(&format!(r#"{{"input":{DISSOLVEF_INPUT},"context":{{"componentId":"host-selfcheck","workspaceId":"headless"}}}}"#)),
    );
    assert_eq!(started.status, 200, "start_operation answers the record: {}", started.text());
    let operation = started.json()["operation"].clone();
    let operation_id = operation["operationId"]
        .as_str()
        .expect("the response carries `operation.operationId`")
        .to_owned();
    assert_eq!(operation["nodeId"], "dissolvef");
    assert_eq!(operation["phase"], "queued", "the legacy handler returns the record before the run advances");

    // The stream over the *only* channel a headerless client has: the query token, no headers at all.
    let stream = request(
        channel.base_url(),
        "GET",
        &format!("/node-operations/{operation_id}/stream?token={}", channel.token()),
        &[],
        None,
    );
    assert_eq!(stream.status, 200, "a query token authenticates the stream");
    assert_eq!(
        stream.header("content-type"),
        Some("application/x-ndjson; charset=utf-8"),
        "the client's NDJSON reader is the protocol"
    );
    let frames = stream.ndjson();
    assert!(!frames.is_empty(), "the stream carries at least the snapshot frame");
    assert_eq!(frames[0]["type"], "operation", "include_snapshot is on for the stream route");
    let last = frames.last().expect("at least one frame");
    assert_eq!(last["type"], "result", "the stream closes after the result frame");
    let phase = last["operation"]["phase"]
        .as_str()
        .expect("the result frame carries the terminal operation");
    assert!(
        matches!(phase, "completed" | "error" | "cancelled"),
        "the stream must end on a terminal phase, got {phase}"
    );
    // With no plugin runtime attached, `NoPluginRuntime` is what writes that phase — the documented
    // behaviour of the seam, and the message must say so rather than leave a silent failure.
    assert_eq!(phase, "error");
    assert_eq!(last["result"]["success"], serde_json::json!(false));
    assert!(
        last["result"]["message"]
            .as_str()
            .is_some_and(|message| message.contains("no plugin runtime") && message.contains("dissolvef")),
        "the result explains the missing runtime: {last}"
    );

    // The terminal record is still addressable, again with the query token only.
    let fetched = request(
        channel.base_url(),
        "GET",
        &format!("/node-operations/{operation_id}?token={}", channel.token()),
        &[],
        None,
    );
    assert_eq!(fetched.status, 200);
    assert_eq!(fetched.json()["operation"]["phase"], "error");
    assert!(fetched.json()["operation"]["finishedAt"].is_number(), "a terminal operation stamps finishedAt");

    // …and the same route answers for the header position too, which is what the React client uses
    // everywhere except the stream.
    let via_header = request(
        channel.base_url(),
        "GET",
        &format!("/node-operations/{operation_id}"),
        &token_header(channel.token()),
        None,
    );
    assert_eq!(via_header.status, 200);

    // A body that is not valid JSON is the client's error, reported in the `{ error }` shape.
    let malformed = request(
        channel.base_url(),
        "POST",
        "/nodes/dissolvef/operations",
        &[("content-type", "application/json"), ("x-xiranite-token", channel.token())],
        Some("{not json"),
    );
    assert_eq!(malformed.status, 400);
    assert!(malformed.json()["error"].is_string(), "{}", malformed.text());

    // An unknown operation id is the legacy 404 with the legacy text.
    let unknown = request(
        channel.base_url(),
        "GET",
        &format!("/node-operations/op-does-not-exist?token={}", channel.token()),
        &[],
        None,
    );
    assert_eq!(unknown.status, 404);
    assert_eq!(unknown.json()["error"], "Node operation not found.");

    backend.shutdown().expect("the host stops cleanly");
}

/// A second host process (here: a second handle) must not collide on the port and must not reuse the
/// token; shutting one down must actually release its listener.
#[test]
fn a_second_host_gets_its_own_port_and_token_and_shutdown_releases_the_listener() {
    let first = start_backend(BackendStart::placeholder()).expect("the first host starts");
    let second = start_backend(BackendStart::placeholder()).expect("a second host starts on the same machine");

    let first_url = first.channel().base_url().to_owned();
    let second_url = second.channel().base_url().to_owned();
    assert_ne!(first_url, second_url, "port 0 means two hosts never share a listener");
    assert_ne!(first.channel().token(), second.channel().token(), "a restarted host gets a fresh token");
    assert_ne!(
        first.channel().instance_id(),
        second.channel().instance_id(),
        "instanceId separates the two host processes"
    );
    assert!(base_url_is_a_loopback_channel(&second_url), "{second_url}");

    // Both answer for their own token and reject the other's — the credential is per instance.
    let healthy = request(&second_url, "GET", "/health", &[], None);
    assert_eq!(healthy.status, 200);
    let borrowed = request(&second_url, "GET", "/node-operations", &token_header(first.channel().token()), None);
    assert_eq!(borrowed.status, 401, "instance A's token must not open instance B");

    let second_port = port_of(&second_url);
    let first_channel = first.shutdown().expect("the first host stops cleanly");
    assert_eq!(first_channel.base_url(), first_url, "shutdown hands the channel back");

    // Dropping the handle without an explicit shutdown still stops the host: `Drop` requests the
    // graceful stop, so the listener goes away within a bounded wait instead of leaking a socket.
    drop(second);
    wait_until_refused(second_port, Duration::from_secs(5));
}

/// Polls the published port until a connect is refused, failing the test if the host outlives its
/// handle. The host thread needs a scheduling slot to leave `serve`, so a deadline beats a sleep.
fn wait_until_refused(port: u16, deadline: Duration) {
    let attempt = Duration::from_millis(25);
    let mut waited = Duration::ZERO;
    while waited < deadline {
        if TcpStream::connect(("127.0.0.1", port)).is_err() {
            return;
        }
        std::thread::sleep(attempt);
        waited += attempt;
    }
    panic!("port {port} is still accepting after its handle was dropped");
}

/// The `tauri.conf.json` the WebView depends on is one of the two things `src/backend/tauriChannel.ts`
/// cannot work without: the global Tauri object (there is no `@tauri-apps/api` in the bundle).
#[test]
fn the_desktop_config_keeps_the_webview_contract_and_stays_platform_neutral() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{} is unreadable: {error}", path.display()));
    let config: serde_json::Value = serde_json::from_str(&text).expect("tauri.conf.json is valid JSON");

    assert_eq!(config["app"]["withGlobalTauri"], serde_json::json!(true), "window.__TAURI__ must exist for the structural read");
    assert_eq!(config["bundle"]["active"], serde_json::json!(false), "bundling is not part of this seam yet");
    assert_eq!(
        config["bundle"]["icon"].as_array().map(Vec::len),
        Some(0),
        "no icon means no platform-specific asset requirement"
    );
    assert!(config["build"].get("beforeDevCommand").is_none(), "the self-check page needs no build tool");
    assert!(config["app"]["windows"].is_array(), "one window is declared");
}

/// The self-check page is served from the crate's own `frontend/` directory through Tauri's asset
/// mechanism, and it must say what it is rather than look like the product GUI.
#[test]
fn the_selfcheck_page_is_plain_html_and_names_itself_honestly() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("frontend").join("index.html");
    let page = std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{} is unreadable: {error}", path.display()));

    assert!(page.contains("Rust 后端 + 节点运行自检页"), "the page title must state what it is");
    assert!(page.contains("这不是产品 GUI"), "the page must not pose as the product surface");
    assert!(page.contains("xiranite_bootstrap"), "the page calls the bootstrap command");
    assert!(page.contains("/nodes/dissolvef/operations"), "the page drives a dissolvef operation");
    assert!(page.contains("/stream?token="), "the page uses the query-token stream channel");
    // The real property is "no bundler and no npm dependency", which a bare substring search for
    // `@tauri-apps/api` would not express: the page explains *why* it does not import that package,
    // so the name appears in prose while the module graph stays empty.
    assert!(!page.contains("<script src="), "no external script: inline only");
    assert!(!page.contains("type=\"module\""), "no ES module graph to build");
    assert!(!page.contains("import \"@tauri-apps") && !page.contains("from \"@tauri-apps"), "the Tauri global is read structurally");
}

fn port_of(base_url: &str) -> u16 {
    let authority = base_url.strip_prefix("http://").expect("loopback origin");
    authority
        .rsplit(':')
        .next()
        .and_then(|port| port.parse::<u16>().ok())
        .unwrap_or_else(|| panic!("no port in {base_url}"))
}

/// A connect to a released port must be refused rather than accepted; this is the belt for the
/// `shutdown()` path above, kept as its own case so a regression names the socket.
#[test]
fn shutdown_refuses_new_connections_on_the_published_port() {
    let backend: BackendHandle = start_backend(BackendStart::placeholder()).expect("the loopback backend starts headlessly");
    let url = backend.channel().base_url().to_owned();
    let port = port_of(&url);
    assert!(TcpStream::connect(("127.0.0.1", port)).is_ok(), "the listener is up before shutdown");
    backend.shutdown().expect("the host stops cleanly");
    assert!(
        TcpStream::connect(("127.0.0.1", port)).is_err(),
        "port {port} is still accepting after shutdown"
    );
    // The client's own failure mode for the same situation, so the helper and the socket agree.
    let refused = try_request(&url, "GET", "/health", &[], None, Duration::from_millis(400));
    assert!(refused.is_err(), "a released channel must not answer a request");
}

/// The helper's own contract, so a green protocol test cannot be an artifact of the client.
#[test]
fn the_test_client_reads_the_body_encodings_the_server_actually_uses() {
    let backend = start_backend(BackendStart::placeholder()).expect("the loopback backend starts headlessly");
    // `/health` is small enough for hyper to answer with a content-length, which is one branch.
    let sized: Reply = request(backend.channel().base_url(), "GET", "/health", &[], None);
    assert!(sized.header("content-length").is_some() || sized.header("transfer-encoding").is_some(), "the response declares how its body ends: {:?}", sized.headers);
    assert_eq!(sized.status, 200);
    backend.shutdown().expect("the host stops cleanly");
}
