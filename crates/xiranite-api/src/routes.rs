//! The nine `/node-operations` family handlers, mirroring `packages/api/src/index.ts:99-181`.
//!
//! Every response shape here is the legacy one, because ADR-0063 principle 2 keeps the
//! protocol and the React layer is not rewritten:
//!
//! | route | legacy line | answer |
//! | --- | --- | --- |
//! | `POST /nodes/:id/operations` | `:99-104` | `{ operation }` |
//! | `GET /node-operations` | `:128-134` | the list response object, unwrapped |
//! | `DELETE /node-operations` | `:123-127` | the cleanup response object, unwrapped |
//! | `GET /node-operations/:operationId` | `:174-181` | `{ operation }` |
//! | `GET …/events` | `:135-145` | the events response, unwrapped |
//! | `GET …/stream` | `:164-173` | NDJSON frames, `application/x-ndjson; charset=utf-8` |
//! | `POST …/cancel`, `…/pause`, `…/resume` | `:146-163` | `{ operation }` |
//!
//! Missing operations answer `404` with `{ "error": "Node operation not found." }`, the exact
//! text the legacy routes write, because `packages/api/src/client.ts` surfaces that message in
//! the monitor card.

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use serde::Deserialize;
use serde_json::value::RawValue;

use crate::{ApiContext, ApiError, LaunchRequest};

/// `/health` → `{ ok: true }` (`packages/api/src/index.ts:25`).
///
/// `instanceId` is deliberately absent: the desktop host hands it to the WebView through the
/// bootstrap call (ADR-0065), and no route published it before.
pub async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true }))
}

/// `nodeRunRequestSchema` (`packages/shared/src/index.ts:140-146`).
///
/// `input` is `z.unknown()`, so it arrives as the raw JSON document and leaves as the raw
/// JSON document: it is never re-serialized through a Rust model (ADR-0068: JSON is an
/// encoding, not the ABI).
#[derive(Debug, Deserialize)]
struct RunRequest {
    #[serde(default)]
    input: Option<Box<RawValue>>,
    #[serde(default)]
    context: Option<RunRequestContext>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunRequestContext {
    #[serde(default)]
    component_id: Option<String>,
    #[serde(default)]
    workspace_id: Option<String>,
}

/// `POST /nodes/:id/operations`: registers a `queued` operation and hands it to the launcher.
///
/// The legacy `startOperation()` returns the record immediately and runs the plugin in the
/// background (`void this.executeOperation(state)`), so the answer is the `queued` record and
/// the caller learns the rest over `/stream`. A malformed body is `400` with the `{ error }`
/// shape rather than Axum's plain-text default, because the client renders `error`.
pub async fn start_operation(
    State(context): State<std::sync::Arc<ApiContext>>,
    Path(node_id): Path<String>,
    body: Bytes,
) -> Result<Json<serde_json::Value>, ApiError> {
    let request = parse_run_request(&body)?;
    let component_id = request.context.as_ref().and_then(|value| value.component_id.clone());
    let workspace_id = request.context.as_ref().and_then(|value| value.workspace_id.clone());
    let control = context.operations.start(node_id.clone(), component_id, workspace_id);
    let operation = control.record();

    let input = match request.input {
        Some(raw) => Bytes::from(raw.get().to_owned()),
        // An absent `input` is `undefined` in the legacy body, which the runner receives as an
        // empty JSON object rather than as invalid bytes.
        None => Bytes::from_static(b"{}"),
    };
    context.launcher.launch(LaunchRequest {
        manager: context.operations.clone(),
        control,
        node_id,
        input,
    });

    Ok(Json(serde_json::json!({ "operation": operation })))
}

fn parse_run_request(body: &Bytes) -> Result<RunRequest, ApiError> {
    if body.is_empty() {
        // `nodeRunRequestSchema` makes both fields optional, so an empty body is legal.
        return Ok(RunRequest { input: None, context: None });
    }
    serde_json::from_slice::<RunRequest>(body)
        .map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, format!("invalid request body: {error}")))
}

/// `GET /node-operations`' query. Every value arrives as a string and is parsed with the
/// legacy leniency (`parseOptionalInteger`, `packages/api/src/index.ts:452-456`): an
/// unparseable `limit` is dropped, not rejected. `#[serde(default)]` is load-bearing — the
/// legacy route declares no query schema, so absent keys must not become a `400`.
#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ListQuery {
    pub node_id: Option<String>,
    pub active_only: Option<String>,
    pub limit: Option<String>,
}

/// `listOperations`: `{ operations, total }`.
pub async fn list_operations(
    State(context): State<std::sync::Arc<ApiContext>>,
    Query(query): Query<ListQuery>,
) -> Json<xiranite_core::NodeOperationListResponse> {
    let filter = xiranite_core::OperationFilter {
        // `query.nodeId || undefined`: an empty string filters on nothing.
        node_id: query.node_id.filter(|value| !value.is_empty()),
        // `query.activeOnly === "true"`, so anything else means false.
        active_only: query.active_only.as_deref() == Some("true"),
        limit: optional_integer(query.limit.as_deref()),
    };
    Json(context.operations.list(&filter))
}

/// `DELETE /node-operations`' query: `maxAgeMs`.
#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CleanupQuery {
    pub max_age_ms: Option<String>,
}

/// `cleanupOperations`: `{ removedCount, remainingCount }`.
pub async fn cleanup_operations(
    State(context): State<std::sync::Arc<ApiContext>>,
    Query(query): Query<CleanupQuery>,
) -> Json<xiranite_core::NodeOperationCleanupResponse> {
    Json(context.operations.cleanup(optional_integer(query.max_age_ms.as_deref()), None))
}

/// `GET /node-operations/:operationId`: `{ operation }`.
pub async fn get_operation(
    State(context): State<std::sync::Arc<ApiContext>>,
    Path(operation_id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let operation = context
        .operations
        .get(&operation_id)
        .ok_or_else(|| not_found(&operation_id))?;
    Ok(Json(serde_json::json!({ "operation": operation })))
}

/// `GET …/events`' query: `from` and `limit`.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct EventsQuery {
    pub from: Option<String>,
    pub limit: Option<String>,
}

/// `getOperationEvents`: the paged event window with absolute indexes.
pub async fn get_operation_events(
    State(context): State<std::sync::Arc<ApiContext>>,
    Path(operation_id): Path<String>,
    Query(query): Query<EventsQuery>,
) -> Result<Json<xiranite_core::NodeOperationEventsResponse>, ApiError> {
    // `parseEventIndex` defaults to 0 rather than dropping the value.
    let from = event_index(query.from.as_deref());
    context
        .operations
        .events(&operation_id, Some(from), optional_integer(query.limit.as_deref()))
        .map(Json)
        .ok_or_else(|| not_found(&operation_id))
}

/// `POST …/cancel`. The legacy route passes no reason, so `NodeRunnerService`'s default text
/// (`"Node operation cancelled."`) is what the history row and the log line carry.
pub async fn cancel_operation(
    State(context): State<std::sync::Arc<ApiContext>>,
    Path(operation_id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    operation_response(context.operations.cancel(&operation_id, "Node operation cancelled."), &operation_id)
}

/// `POST …/pause`: only a running operation changes phase; the rest answer unchanged.
pub async fn pause_operation(
    State(context): State<std::sync::Arc<ApiContext>>,
    Path(operation_id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    operation_response(context.operations.pause(&operation_id), &operation_id)
}

/// `POST …/resume`: releases every parked `xiranite.operation.checkpoint` (ADR-0066).
pub async fn resume_operation(
    State(context): State<std::sync::Arc<ApiContext>>,
    Path(operation_id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    operation_response(context.operations.resume(&operation_id), &operation_id)
}

fn operation_response(
    operation: Option<xiranite_core::NodeOperationRecord>,
    operation_id: &str,
) -> Result<Json<serde_json::Value>, ApiError> {
    operation
        .map(|operation| Json(serde_json::json!({ "operation": operation })))
        .ok_or_else(|| not_found(operation_id))
}

/// `GET …/stream`'s query: `from`.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct StreamQuery {
    pub from: Option<String>,
}

/// `GET …/stream`: the snapshot, the retained events, then live frames as NDJSON.
///
/// Framing is `JSON_LINE\n` closed after the `result` frame
/// (`packages/api/src/index.ts:494-525`), so the client's reader needs no change. Unlike the
/// legacy queue this one cannot overflow: `OperationManager::subscribe` hands back an unbounded
/// `mpsc` receiver, and the response body is the only consumer, so back pressure arrives as a
/// slow poll instead of as dropped frames. The legacy drop rule (256 messages / 2 MiB, newest
/// kept) exists because Elysia wrote into a `ReadableStream` synchronously from the event
/// emitter; reproducing it here would discard events a slow client had already paid to receive.
pub async fn stream_operation(
    State(context): State<std::sync::Arc<ApiContext>>,
    Path(operation_id): Path<String>,
    Query(query): Query<StreamQuery>,
) -> Result<Response, ApiError> {
    if context.operations.get(&operation_id).is_none() {
        return Err(not_found(&operation_id));
    }
    let subscription = context
        .operations
        .subscribe(
            &operation_id,
            &xiranite_core::SubscribeOptions {
                from_event_index: Some(event_index(query.from.as_deref())),
                include_snapshot: true,
            },
        )
        .map_err(|error| not_found(&error.0))?;

    let frames = futures::stream::unfold(
        (subscription, false),
        |(mut subscription, finished)| async move {
            if finished {
                return None;
            }
            let message = subscription.next().await?;
            let is_result = matches!(message, xiranite_core::OperationStreamMessage::Result { .. });
            let mut line = serde_json::to_vec(&message).unwrap_or_default();
            line.push(b'\n');
            // The legacy writer closes the response once the `result` frame is queued
            // (`packages/api/src/index.ts:497-501`), so the client's reader sees EOF at the
            // same place either way.
            Some((Ok::<Bytes, std::convert::Infallible>(Bytes::from(line)), (subscription, is_result)))
        },
    );
    let body = axum::body::Body::from_stream(frames);
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "application/x-ndjson; charset=utf-8")
        .header("cache-control", "no-store")
        .body(body)
        .unwrap_or_else(|_| crate::json_error(StatusCode::INTERNAL_SERVER_ERROR, "stream build failed")))
}

/// The legacy `404` body, verbatim.
fn not_found(_operation_id: &str) -> ApiError {
    ApiError::new(StatusCode::NOT_FOUND, "Node operation not found.")
}

/// `parseOptionalInteger`: a non-negative integer as text, or `None` for anything else.
fn optional_integer(value: Option<&str>) -> Option<u64> {
    let text = value?.trim();
    if text.is_empty() {
        return None;
    }
    let parsed: i128 = text.parse().ok()?;
    u64::try_from(parsed).ok()
}

/// `parseEventIndex`: the same leniency, defaulting to `0`.
fn event_index(value: Option<&str>) -> u64 {
    let text = value.unwrap_or_default().trim();
    if text.is_empty() {
        return 0;
    }
    text.parse::<i128>().map(|parsed| u64::try_from(parsed).unwrap_or(0)).unwrap_or(0)
}
