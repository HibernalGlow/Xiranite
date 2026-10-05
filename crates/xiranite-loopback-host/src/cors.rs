//! The cross-origin half of the loopback channel.
//!
//! ADR-0065 puts the backend on `127.0.0.1`, but the client reading it is a browser: the React
//! bundle runs at `http://localhost:1420` under `bun run dev:desktop` and at `tauri://localhost`
//! when packaged, and a plugin loaded from a different origin needs the same channel. Every one of
//! those requests is cross-origin, and the browser drops the response body without CORS headers. A
//! `POST` with `content-type: application/json` also preflights, and an unrouted `OPTIONS` would
//! never reach a handler.
//!
//! The legacy host answered both: `packages/backend/src/index.ts:789-795` (`writeCorsHeaders`,
//! stamped on *every* response at `:731`) and the `OPTIONS` short circuit at `:219-222` that replies
//! `204`. `crates/xiranite-api` has ported the header list only as an echo on its own way out
//! (`crates/xiranite-api/src/lib.rs:145-151`), which is not a CORS grant, so the host supplies the
//! missing half rather than editing a crate this seam does not own.
//!
//! Why the grant is the fixed `*`: the credential is a per-process bearer token that only the host's
//! own client is handed (through `xiranite_bootstrap`, a channel file, or an explicit flag), never a
//! cookie, and the listener is bound to loopback. A foreign page that guesses the port still has to
//! produce the token, and `credentials: include` is not in play, so no origin can be privileged over
//! another by name. That also means this layer is *not* an authorization boundary — the 401 path in
//! `xiranite-api` is — and it is applied as an outer layer so it covers the responses that
//! authorization short-circuits.

use axum::body::Body;
use axum::extract::Request;
use axum::http::{HeaderName, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::Response;

/// Every header value here is a copy of the legacy host's, so the React client's behaviour does not
/// change when the transport moves from Elysia to Axum.
const ALLOW_ORIGIN: &str = "*";
const ALLOW_METHODS: &str = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
/// `packages/backend/src/index.ts:791`, restated by `xiranite-api`'s own middleware.
const ALLOW_HEADERS: &str = "content-type,x-xiranite-token,x-xiranite-filename";
const MAX_AGE: &str = "86400";

/// The fixed grant, as `(name, value)` pairs with static spellings so insertion allocates nothing.
const CORS_GRANT: [(&str, &str); 4] = [
    ("access-control-allow-origin", ALLOW_ORIGIN),
    ("access-control-allow-methods", ALLOW_METHODS),
    ("access-control-allow-headers", ALLOW_HEADERS),
    ("access-control-max-age", MAX_AGE),
];

/// Wraps `xiranite_api::router`: answers preflight itself, stamps every other response — including
/// the `401` the authorization middleware produces — with the loopback grant.
pub async fn webview_cors(request: Request, next: Next) -> Response {
    let mut response = if request.method() == Method::OPTIONS {
        preflight_response()
    } else {
        next.run(request).await
    };
    apply_grant(&mut response);
    response
}

/// `204` with no body, the way the legacy host closes a preflight (`:220`).
fn preflight_response() -> Response {
    Response::builder()
        .status(StatusCode::NO_CONTENT)
        .body(Body::empty())
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

fn apply_grant(response: &mut Response) {
    for (name, value) in CORS_GRANT {
        // Both constructors are infallible for `'static` lowercase ASCII literals, which is the whole
        // table above: no per-request parsing, and no branch that could drop a header silently.
        response
            .headers_mut()
            .insert(HeaderName::from_static(name), HeaderValue::from_static(value));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The four field names are the legacy grant, in the legacy order; a rename here is a protocol
    /// change for the WebView, so it is asserted rather than eyeballed.
    #[test]
    fn the_grant_mirrors_the_legacy_header_set() {
        let names: Vec<&str> = CORS_GRANT.iter().map(|(name, _)| *name).collect();
        assert_eq!(
            names,
            vec![
                "access-control-allow-origin",
                "access-control-allow-methods",
                "access-control-allow-headers",
                "access-control-max-age",
            ]
        );
    }

    /// The token header spelling comes from `xiranite-api`, so this crate never carries a second copy
    /// of it that could drift from the middleware that checks it.
    #[test]
    fn the_allow_headers_list_admits_the_api_token_header() {
        assert!(
            ALLOW_HEADERS
                .split(',')
                .any(|entry| entry == xiranite_api::TOKEN_HEADER),
            "{ALLOW_HEADERS}"
        );
    }

    #[test]
    fn the_preflight_answer_is_the_legacy_204() {
        let response = preflight_response();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
    }
}
