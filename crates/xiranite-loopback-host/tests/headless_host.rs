//! Headless proof of the host's channel contract (ADR-0065), with no window involved.
//!
//! Each test drives [`xiranite_loopback_host::start_backend`] — the function the desktop binary calls
//! — over a real loopback socket, so the ephemeral port, the two token positions, the
//! `/node-operations` family and the NDJSON stream are all evidenced against the shipped code path
//! instead of a test-only imitation. Every host is stopped through
//! [`xiranite_loopback_host::BackendHandle::shutdown`] inside the test body, which is the Rust form of
//! the repo's isolated-backend rule: own data directory, finite lifetime, and a confirmed closed
//! listener (`a_second_host_gets_its_own_port_and_token` checks exactly that).
//!
//! What is *not* here: `tauri.conf.json` and the self-check page. Those belong to the shell that
//! embeds this host and are asserted in `crates/xiranite-desktop/tests/webview_assets.rs`.
//!
//! With no plugin runtime attached, `xiranite-api`'s `NoPluginRuntime` finishes a started operation as
//! `error` with an explicit message. The assertions below encode that as *expected*, because the point
//! is the protocol and the lifecycle, not a pretend successful run.

mod support;

use std::net::TcpStream;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use support::{Reply, request, try_request};
use xiranite_builtin_host::BuiltInNodeLauncher;
use xiranite_core::SystemClock;
use xiranite_loopback_host::{BackendHandle, BackendStart, BootstrapPayload, HostChannel, start_backend};

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

/// 04 + 05 + 06 with the real runtime: the same three routes, driven by the built-in node registry, so
/// what finishes `completed` here is the node's own result document produced by the embedded QuickJS
/// executor — the exact path `src/lib/nodeOperationTransport.ts::runNodeOperation` takes from the GUI.
///
/// This is the host's own proof, over a socket and the WebView's credential, not a `tower::oneshot`
/// against the router (which is what `crates/xiranite-builtin-host` asserts).
#[test]
fn the_built_in_quickjs_node_runs_a_dissolvef_operation_over_the_real_socket() {
    let root = fixture_root("builtin-socket");
    let files = fixture(
        &root,
        &[("series_a/series_a.zip", "zip"), ("series_b/series_b.zip", "zip"), ("series_b/readme.txt", "extra")],
    );
    let launcher = Arc::new(
        BuiltInNodeLauncher::new(Arc::new(SystemClock), vec![root.clone()]).expect("dissolvef is linked in"),
    );
    assert!(launcher.node_ids().contains(&"dissolvef"), "the staged host lists the node it can run");

    let backend: BackendHandle = start_backend(BackendStart::new(launcher)).expect("the host starts");
    let channel = backend.channel().clone();
    let input = serde_json::json!({
        "action": "collect_archives",
        "path": root.display().to_string(),
        "protectFirstLevel": false,
        "similarityThreshold": 0.9,
        "skipBlacklist": true,
    });
    let started = request(
        channel.base_url(),
        "POST",
        "/nodes/dissolvef/operations",
        &[("content-type", "application/json"), ("x-xiranite-token", channel.token())],
        Some(&format!(r#"{{"input":{input},"context":{{"componentId":"host-selfcheck","workspaceId":"headless"}}}}"#)),
    );
    assert_eq!(started.status, 200, "start answers the record: {}", started.text());
    let operation_id = started.json()["operation"]["operationId"]
        .as_str()
        .expect("operationId")
        .to_owned();

    let stream = request(
        channel.base_url(),
        "GET",
        &format!("/node-operations/{operation_id}/stream?token={}", channel.token()),
        &[],
        None,
    );
    let frames = stream.ndjson();
    let last = frames.last().expect("the stream closes with a result frame");
    assert_eq!(last["type"], "result", "the stream ends on the result: {last}");
    assert_eq!(last["operation"]["phase"], "completed", "the QuickJS run completes: {last}");
    assert_eq!(last["result"]["success"], serde_json::json!(true), "{}", last["result"]);
    // The oracle from `packages/nodes/dissolvef/src/core.test.ts`: with a 0.9 similarity threshold only
    // `series_a/series_a.zip` is collected, and the path is the caller's own absolute spelling.
    assert_eq!(
        last["result"]["data"]["archivePaths"],
        serde_json::json!([files["series_a/series_a.zip"]]),
        "the bundled node answers the same archive list the TypeScript core does"
    );

    backend.shutdown().expect("the host stops cleanly");
    let _ = std::fs::remove_dir_all(&root);
}

/// A unique temp directory per test tag, canonicalized because macOS `/var` is a symlink and the host
/// compares granted roots canonically.
fn fixture_root(tag: &str) -> std::path::PathBuf {
    static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let unique = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let path = std::env::temp_dir().join(format!("xiranite-loopback-host-{tag}-{}-{unique}", std::process::id()));
    let _ = std::fs::remove_dir_all(&path);
    std::fs::create_dir_all(&path).expect("fixture root");
    std::fs::canonicalize(path).expect("canonical fixture root")
}

/// Writes the fixture and answers the absolute path of each file, as the node would report them.
fn fixture(root: &Path, files: &[(&str, &str)]) -> std::collections::BTreeMap<String, String> {
    let mut written = std::collections::BTreeMap::new();
    for (relative, content) in files {
        let target = root.join(relative);
        std::fs::create_dir_all(target.parent().expect("fixture parent")).expect("fixture dirs");
        std::fs::write(&target, content).expect("fixture file");
        written.insert((*relative).to_owned(), std::fs::canonicalize(target).expect("canonical file").display().to_string());
    }
    written
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
