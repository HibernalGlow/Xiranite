//! Integration tests for the `/config` read family, driven through `tower::ServiceExt` against the
//! router in `crates/xiranite-api/src/lib.rs`.
//!
//! Two things are pinned here that are easy to lose: the response shapes are the ones
//! `packages/api/src/index.ts` publishes and `packages/api/src/client.ts:160-` reads (including the
//! "absent section drops the `config` key" behaviour that falls out of `JSON.stringify`), and every
//! arm has its opposite — a missing document, a missing section, a missing theme file, a malformed
//! document, and a request with no token.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::http::{HeaderName, HeaderValue, Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt;
use xiranite_api::{ApiContext, ConfigSurface, NoPluginRuntime, router};
use xiranite_core::{OperationManager, OperationManagerOptions};

const TOKEN: &str = "test-token";

struct TempDir {
    root: PathBuf,
}

impl TempDir {
    fn new(label: &str) -> Self {
        let built = std::env::temp_dir().join(format!(
            "xiranite-config-api-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock ahead of epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(&built).expect("fixture dir");
        Self { root: built.canonicalize().expect("canonical root") }
    }

    fn file(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }

    fn write(&self, name: &str, contents: &str) -> PathBuf {
        let path = self.file(name);
        std::fs::write(&path, contents).expect("seed fixture");
        path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

const DOCUMENT: &str = r#"
[app.ui]
version = 3
colorMode = "dark"

[app.ui.workspace]
theme = "wuling"
chromeActionOrder = [ "collapse", "focus" ]
overlayWidth = 530
grainEnabled = false
ratio = 0.5

[nodes.dissolvef]
mode = "scan"
roots = [ "/work/album" ]

[nodes.linku]
direction = "toSoftLink"
"#;

fn app_at(document: &Path) -> axum::Router {
    let context = ApiContext::new(
        OperationManager::new(OperationManagerOptions::default()),
        TOKEN,
        "config-test-instance",
        Arc::new(NoPluginRuntime),
    )
    .with_config(Arc::new(ConfigSurface::at(document.to_path_buf())));
    router(Arc::new(context))
}

async fn ask(app: axum::Router, uri: &str, token: Option<&str>) -> (StatusCode, serde_json::Value) {
    let mut builder = Request::builder().method("GET").uri(uri).header("accept", "application/json");
    if let Some(token) = token {
        builder = builder.header(HeaderName::from_static("x-xiranite-token"), HeaderValue::from_str(token).expect("token"));
    }
    let response = app.oneshot(builder.body(Body::empty()).expect("request")).await.expect("router answers");
    let status = response.status();
    let bytes = response.into_body().collect().await.expect("body").to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null))
}

#[tokio::test]
async fn the_document_projects_onto_the_protocol_shape() {
    let dir = TempDir::new("project");
    let document = dir.write("xiranite.config.toml", DOCUMENT);
    let (status, body) = ask(app_at(&document), "/config", Some(TOKEN)).await;

    assert_eq!(status, StatusCode::OK, "a seeded document answers 200");
    assert_eq!(body["config"]["app"]["ui"]["version"], 3, "integers stay integers");
    assert_eq!(body["config"]["app"]["ui"]["colorMode"], "dark");
    assert_eq!(body["path"], document.to_string_lossy().as_ref(), "the client shows this path at the top level");

    // TOML types the React layer branches on, each through the same projection.
    let workspace = &body["config"]["app"]["ui"]["workspace"];
    assert_eq!(workspace["chromeActionOrder"], serde_json::json!(["collapse", "focus"]), "array of strings");
    assert_eq!(workspace["overlayWidth"], 530);
    assert_eq!(workspace["grainEnabled"], false, "bool stays bool");
    assert_eq!(workspace["ratio"], 0.5, "float stays float");
    assert_eq!(body["config"]["nodes"]["dissolvef"]["roots"], serde_json::json!(["/work/album"]));
}

#[tokio::test]
async fn a_missing_document_answers_an_empty_config_not_an_error() {
    let dir = TempDir::new("absent");
    let document = dir.file("xiranite.config.toml");
    let (status, body) = ask(app_at(&document), "/config", Some(TOKEN)).await;

    assert_eq!(status, StatusCode::OK, "transport.ts:221 answers an empty object when the file is not there yet");
    assert_eq!(body["config"], serde_json::json!({}), "and the empty document is an object, not null");
    assert_eq!(body["path"], document.to_string_lossy().as_ref());
}

/// The merge order in `crate::router` is the claim under test: `/config` sits behind the same bearer
/// gate as the operation family, and `/health` stays exempt.
#[tokio::test]
async fn the_config_family_is_behind_the_instance_token() {
    let dir = TempDir::new("auth");
    let document = dir.write("xiranite.config.toml", DOCUMENT);

    let (anonymous, _) = ask(app_at(&document), "/config", None).await;
    assert_eq!(anonymous, StatusCode::UNAUTHORIZED, "no token means no document");

    let (wrong, _) = ask(app_at(&document), "/config", Some("not-the-token")).await;
    assert_eq!(wrong, StatusCode::UNAUTHORIZED, "a wrong token is the same refusal");

    let (right, _) = ask(app_at(&document), "/config", Some(TOKEN)).await;
    assert_eq!(right, StatusCode::OK, "the positive arm: the gate is not simply rejecting everything");
}

#[tokio::test]
async fn sections_answer_by_name_and_an_absent_one_drops_the_key() {
    let dir = TempDir::new("section");
    let document = dir.write("xiranite.config.toml", DOCUMENT);
    let app = app_at(&document);

    let (status, body) = ask(app.clone(), "/config/app/ui", Some(TOKEN)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["config"]["version"], 3, "a present section carries its value");
    assert_eq!(body["path"], document.to_string_lossy().as_ref());

    let (status, body) = ask(app.clone(), "/config/nodes/dissolvef", Some(TOKEN)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["config"]["mode"], "scan");

    let (status, absent) = ask(app.clone(), "/config/app/notthere", Some(TOKEN)).await;
    assert_eq!(status, StatusCode::OK, "an absent section is not an error");
    assert!(absent.get("config").is_none(), "config: undefined does not survive JSON.stringify");
    assert_eq!(absent["path"], document.to_string_lossy().as_ref());

    let (_, ghost) = ask(app, "/config/nodes/ghost", Some(TOKEN)).await;
    assert!(ghost.get("config").is_none(), "a node with no section reads as unconfigured");
}

#[tokio::test]
async fn themes_come_from_the_sibling_file() {
    let dir = TempDir::new("themes");
    let document = dir.write("xiranite.config.toml", DOCUMENT);
    dir.write("themes.json", r#"[{"name":"amethyst-haze"},{"name":"symphonic-night"}]"#);
    let app = app_at(&document);

    let (status, body) = ask(app.clone(), "/config/themes", Some(TOKEN)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["themes"].as_array().map(Vec::len), Some(2), "the array the theme picker enumerates");
    assert_eq!(body["themes"][0]["name"], "amethyst-haze");
    assert_eq!(body["path"], dir.file("themes.json").to_string_lossy().as_ref(), "themes live beside the document");

    // The two degenerate arms `configService.ts:501-515` also answers as an empty list.
    let empty_dir = TempDir::new("themes-absent");
    let (_, missing) = ask(app_at(&empty_dir.file("xiranite.config.toml")), "/config/themes", Some(TOKEN)).await;
    assert_eq!(missing["themes"], serde_json::json!([]), "no sidecar yet means no custom themes");

    let wrong_dir = TempDir::new("themes-object");
    wrong_dir.write("themes.json", r#"{"not":"an array"}"#);
    let (_, wrong_shape) = ask(app_at(&wrong_dir.file("xiranite.config.toml")), "/config/themes", Some(TOKEN)).await;
    assert_eq!(wrong_shape["themes"], serde_json::json!([]), "a document that is not an array is not themes");
}

#[tokio::test]
async fn a_byte_order_mark_does_not_break_the_parse() {
    let dir = TempDir::new("bom");
    let document = dir.write("xiranite.config.toml", "\u{feff}[app.ui]\nversion = 3\n");
    let (status, body) = ask(app_at(&document), "/config", Some(TOKEN)).await;

    assert_eq!(status, StatusCode::OK, "the TypeScript strips the BOM before parsing (transport.ts:223)");
    assert_eq!(body["config"]["app"]["ui"]["version"], 3);
}

#[tokio::test]
async fn a_malformed_document_is_refused_with_a_message() {
    let dir = TempDir::new("malformed");
    let document = dir.write("xiranite.config.toml", "[app.ui\nversion = 3\n");
    let (status, body) = ask(app_at(&document), "/config", Some(TOKEN)).await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR, "a file that is not TOML is not an empty config");
    let message = body["error"].as_str().unwrap_or_default();
    assert!(message.contains("could not be parsed"), "{message}");
}

#[tokio::test]
async fn a_group_that_is_not_a_table_reads_as_unconfigured() {
    let dir = TempDir::new("scalar-group");
    // `app` exists but is not a table, so `app.ui` cannot be one either. The client treats a missing
    // section as "nothing stored yet"; handing it a string as if it were a config object is the wrong
    // shape this guards.
    let document = dir.write("xiranite.config.toml", "app = \"scalar\"\n");
    let (status, body) = ask(app_at(&document), "/config/app/ui", Some(TOKEN)).await;

    assert_eq!(status, StatusCode::OK);
    assert!(body.get("config").is_none(), "{body}");
    assert_eq!(body["path"], document.to_string_lossy().as_ref());
}
