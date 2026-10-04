//! The Axum HTTP/Operation backend that replaces the Bun + Elysia service.
//!
//! ADR-0063 principle 2 keeps the protocol, so this crate is a re-implementation of the
//! surface the React layer already calls, not a new API. ADR-0065 puts it on
//! `127.0.0.1` with a per-instance bearer token that the desktop host hands to the
//! WebView through one bootstrap call.
//!
//! ## The auth boundary is copied, not improvised
//!
//! `packages/backend/src/index.ts:224-232` is the contract:
//!
//! - `/health` answers without a token, because the status banner polls it before the
//!   channel exists.
//! - every other route requires the token either as `x-xiranite-token` or as the
//!   `token` query parameter — the query form exists because a browser `EventSource`
//!   and a plain download cannot add headers, and the React client uses it
//!   (`src/backend/localBackendConfig.ts:176`).
//! - a rejected request answers `401` with the body `Unauthorized`.
//! - responses carry `access-control-allow-headers: content-type,x-xiranite-token,x-xiranite-filename`
//!   (`packages/backend/src/index.ts:791`), which the WebView's dev origin depends on.
//!
//! ## What is wired and what is a seam
//!
//! Operations run through [`OperationLauncher`], the seam the Extism host implements
//! (ADR-0063 principle 8, task `crates/xiranite-plugins`). Until that crate is attached,
//! [`NoPluginRuntime`] finishes a started operation as `error` with an explicit message:
//! the routes, the auth, the event stream and the lifecycle all behave exactly as they
//! will later, and nothing pretends a plugin ran.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::Request;
use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use xiranite_core::{NodeRunResultRecord, OperationControl, OperationManager, OperationPhase};

pub mod routes;

/// The token header the WebView and the CLI send. Same spelling as the TypeScript.
pub const TOKEN_HEADER: &str = "x-xiranite-token";
/// The query parameter fallback for clients that cannot set headers.
pub const TOKEN_QUERY: &str = "token";

/// Everything a handler needs. One instance per running host process.
pub struct ApiContext {
    /// The operation registry from `xiranite-core`.
    pub operations: OperationManager,
    /// Per-instance bearer token; a fresh random value on every start (ADR-0065).
    pub token: String,
    /// Identifies this host process so a restarted backend invalidates cached state in
    /// the client, which is what `instanceId` does today.
    pub instance_id: String,
    /// The plugin seam: starts the run for a freshly created operation.
    pub launcher: Arc<dyn OperationLauncher>,
}

impl ApiContext {
    /// A context with an explicit token, for tests and for the host that generates it.
    #[must_use]
    pub fn new(
        operations: OperationManager,
        token: impl Into<String>,
        instance_id: impl Into<String>,
        launcher: Arc<dyn OperationLauncher>,
    ) -> Self {
        Self { operations, token: token.into(), instance_id: instance_id.into(), launcher }
    }

    /// A context that answers `/health` but cannot run plugins yet.
    #[must_use]
    pub fn without_plugin_runtime(operations: OperationManager, token: impl Into<String>, instance_id: impl Into<String>) -> Self {
        Self::new(operations, token, instance_id, Arc::new(NoPluginRuntime))
    }
}

/// What [`OperationLauncher::launch`] receives: everything one run needs, owned, so the
/// launcher can move it into the task that drives the plugin.
pub struct LaunchRequest {
    /// The registry, for event push and the terminal transition. `OperationControl` reads
    /// state but does not mutate the registry, so the host needs both.
    pub manager: OperationManager,
    /// The operation `start()` just registered.
    pub control: OperationControl,
    /// The plugin id in the rewritten stack.
    pub node_id: String,
    /// `nodeRunRequestSchema.input` as the raw JSON document the client sent.
    pub input: Bytes,
}

/// Starts the run behind an operation. Implemented by the Extism host.
pub trait OperationLauncher: Send + Sync + 'static {
    /// Hands the input to the plugin for `node_id` and drives the operation to a terminal
    /// phase. Returning is not completion: the launcher owns the task, writes `running`
    /// first the way `executeOperation()` does, and reports through `control`/`manager`.
    fn launch(&self, request: LaunchRequest);
}

/// The placeholder launcher used until the Extism host crate is attached.
///
/// It finishes the operation as `error` rather than leaving it queued forever, because a
/// silently stuck operation is the failure mode a user would report as "the card spins".
pub struct NoPluginRuntime;

impl OperationLauncher for NoPluginRuntime {
    fn launch(&self, request: LaunchRequest) {
        let message = format!("no plugin runtime is attached to this host, so {} cannot run yet", request.node_id);
        request.manager.mark_running(request.control.operation_id());
        request.manager.finish(
            request.control.operation_id(),
            OperationPhase::Error,
            NodeRunResultRecord::failed(message),
        );
    }
}

/// Builds the router. Kept a pure function so tests drive it with `tower::ServiceExt`.
pub fn router(context: Arc<ApiContext>) -> Router {
    let authorized = Arc::clone(&context);
    Router::new()
        .route("/health", get(routes::health))
        .route("/nodes/{id}/operations", post(routes::start_operation))
        .route("/node-operations", get(routes::list_operations).delete(routes::cleanup_operations))
        .route("/node-operations/{operationId}", get(routes::get_operation))
        .route("/node-operations/{operationId}/events", get(routes::get_operation_events))
        .route("/node-operations/{operationId}/stream", get(routes::stream_operation))
        .route("/node-operations/{operationId}/cancel", post(routes::cancel_operation))
        .route("/node-operations/{operationId}/pause", post(routes::pause_operation))
        .route("/node-operations/{operationId}/resume", post(routes::resume_operation))
        .layer(middleware::from_fn(move |request, next| authorize(Arc::clone(&authorized), request, next)))
        .with_state(context)
}

/// The `/health` exemption plus the two accepted token positions.
async fn authorize(context: Arc<ApiContext>, request: Request, next: Next) -> Response {
    let path_is_health = request.uri().path() == "/health";
    if !path_is_health && !token_matches(&context, &request) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }
    let mut response = next.run(request).await;
    if let Ok(value) = HeaderValue::from_str("content-type,x-xiranite-token,x-xiranite-filename") {
        response.headers_mut().insert(
            HeaderName::from_static("access-control-allow-headers"),
            value,
        );
    }
    response
}

fn token_matches(context: &ApiContext, request: &Request) -> bool {
    let headers = request.headers();
    if let Some(value) = headers.get(TOKEN_HEADER).and_then(|value| value.to_str().ok())
        && value == context.token
    {
        return true;
    }
    request.uri().query().is_some_and(|query| {
        form_pairs(query).any(|(key, value)| key == TOKEN_QUERY && value == context.token)
    })
}

/// Minimal `application/x-www-form-urlencoded` pair reader for a query string: only
/// `=` and `&` splitting plus `%XX`/`+` decoding, which is all the token needs and
/// avoids pulling in a URL crate for one comparison.
fn form_pairs(query: &str) -> impl Iterator<Item = (String, String)> {
    query.split('&').filter(|pair| !pair.is_empty()).map(|pair| {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        (decode(key), decode(value))
    })
}

fn decode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut bytes = value.bytes();
    while let Some(byte) = bytes.next() {
        match byte {
            b'+' => out.push(' '),
            b'%' => {
                let hex: String = bytes.by_ref().take(2).map(char::from).collect();
                if let Ok(decoded) = u8::from_str_radix(&hex, 16) {
                    out.push(decoded as char);
                } else {
                    out.push('%');
                    out.push_str(&hex);
                }
            }
            other => out.push(other as char),
        }
    }
    out
}

/// The JSON error shape the client already renders for backend failures
/// (`{ error }`, as `{ error: "Node operation not found." }` in `packages/api/src/index.ts:142`).
#[must_use]
pub fn json_error(status: axum::http::StatusCode, message: impl Into<String>) -> Response {
    let message = message.into();
    (status, Json(serde_json::json!({ "error": message }))).into_response()
}

/// The same `{ error }` body as `json_error`, sized for a handler `Result`'s `Err` slot.
///
/// `Response` measures 128 bytes, so `Result<T, Response>` copies that on every early return
/// (`clippy::result_large_err`). Boxing it is not available: axum implements `IntoResponse` for
/// `Box<str>` and `Box<[u8]>`, not for a generic `Box<T: IntoResponse>`.
#[derive(Debug)]
pub struct ApiError {
    status: axum::http::StatusCode,
    message: String,
}

impl ApiError {
    #[must_use]
    pub fn new(status: axum::http::StatusCode, message: impl Into<String>) -> Self {
        Self { status, message: message.into() }
    }
}

impl axum::response::IntoResponse for ApiError {
    fn into_response(self) -> Response {
        json_error(self.status, self.message)
    }
}
