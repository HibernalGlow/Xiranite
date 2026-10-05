//! The `/config` read family the React layer already calls (`packages/api/src/index.ts:297-426`).
//!
//! ## Where the boundary sits
//!
//! `packages/config/src/transport.ts:216-224` is `loadXiraniteConfig`: resolve the path, read the bytes,
//! strip a BOM, parse TOML, run `xiraniteConfigSchema.parse`. That schema (`schema.ts:8-19`) is
//! `.passthrough()` with `app` and `nodes` typed as `record(string, unknown)` — it applies no defaults to
//! the sections served here. So what this crate adds is transport, not meaning: which document, the lock,
//! and TOML→JSON. The zod layer, the `[nodes.<id>]` merge and the hint text stay in TypeScript, exactly
//! where `config_operations.rs` put them for the realm. A second implementation of the schema in Rust is
//! what this module must not become.
//!
//! ## Writes are deliberately absent
//!
//! `PUT /config/nodes/:id` and `PUT /config/app/:section` are not here yet, and the reason is the user's
//! document, not the protocol: the legacy writer is `smol-toml`'s `stringify`
//! (`packages/config/src/xiraniteToml.ts:13`), while `toml::to_string_pretty` would rewrite a curated file's
//! multi-line arrays and inline tables into its own layout. `ConfigStore` guarantees no lost update; it
//! cannot guarantee no lost formatting. A byte-fidelity writer (`toml_edit`, which keeps comments and layout)
//! is the precondition, so reads answer 200 here and the write family stays unregistered — a 404 that is
//! honest beats a 200 that rewrote somebody's config.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};
use crate::ApiContext;
use std::path::PathBuf;
use std::sync::Arc;
use xiranite_core::config_paths::{PathContext, THEMES_FILENAME};
use xiranite_core::config_store::ConfigStore;
use xiranite_core::filesystem::FileCapability;
use xiranite_core::support::SystemClock;

/// The document this host serves configuration out of, with the lock protocol that belongs to it.
pub struct ConfigSurface {
    document: PathBuf,
    themes: PathBuf,
    store: ConfigStore,
}

impl ConfigSurface {
    /// The machine's own document: `XIRANITE_CONFIG_PATH` and friends, then the platform data root.
    #[must_use]
    pub fn from_environment() -> Self {
        let context = PathContext::from_environment();
        Self::at(context.config_path())
    }

    /// A surface over one explicit document. The test seam, and the shape a portable setup needs:
    /// `themes.json` is always this file's sibling, never a separately resolved root.
    #[must_use]
    pub fn at(document: PathBuf) -> Self {
        let directory = document.parent().map_or_else(|| PathBuf::from("/"), PathBuf::from);
        let themes = directory.join(THEMES_FILENAME);
        let store = ConfigStore::new(FileCapability::new([directory.as_path()]), Arc::new(SystemClock));
        Self { document, themes, store }
    }

    /// Absolute path of the document, as the protocol reports it.
    #[must_use]
    pub fn document_path(&self) -> &PathBuf {
        &self.document
    }

    /// The whole document as a JSON object, `{}` when the file does not exist yet (`transport.ts:221`).
    ///
    /// # Errors
    ///
    /// [`ConfigFailure`] when the grant refuses the path, the bytes are not UTF-8, or the TOML does not parse.
    pub fn document(&self) -> Result<Value, ConfigFailure> {
        let contents = self
            .store
            .read(&self.document.to_string_lossy())
            .map_err(|error| ConfigFailure::Read(error.to_string()))?;
        Ok(project_document(contents.as_deref())?)
    }

    /// One `[app.<section>]` value, or `None` when the section is absent.
    ///
    /// # Errors
    ///
    /// As [`Self::document`].
    pub fn app_section(&self, section: &str) -> Result<Option<Value>, ConfigFailure> {
        Ok(typed_section(&self.document()?, "app", section))
    }

    /// One `[nodes.<node_id>]` value, or `None` when the node has no section.
    ///
    /// # Errors
    ///
    /// As [`Self::document`].
    pub fn node_section(&self, node_id: &str) -> Result<Option<Value>, ConfigFailure> {
        Ok(typed_section(&self.document()?, "nodes", node_id))
    }

    /// The theme sidecar: the array it holds, or an empty list when it is missing or not an array
    /// (`configService.ts:501-515` answers `[]` in both cases).
    ///
    /// # Errors
    ///
    /// [`ConfigFailure`] when the grant refuses the path or the bytes are not UTF-8.
    pub fn themes(&self) -> Result<(Value, PathBuf), ConfigFailure> {
        let contents = self
            .store
            .read(&self.themes.to_string_lossy())
            .map_err(|error| ConfigFailure::Read(error.to_string()))?;
        let parsed = match contents.as_deref() {
            None => Value::Array(Vec::new()),
            Some(raw) => serde_json::from_str::<Value>(strip_bom(raw)).unwrap_or(Value::Array(Vec::new())),
        };
        let themes = match parsed {
            Value::Array(items) => Value::Array(items),
            _ => Value::Array(Vec::new()),
        };
        Ok((themes, self.themes.clone()))
    }
}

/// Why a config answer could not be produced. The wire shape is the legacy one: a 500 with a message.
#[derive(Debug)]
pub enum ConfigFailure {
    /// The store refused the read: outside the grant, not UTF-8, or over the size ceiling.
    Read(String),
    /// The bytes are there but are not the document the product claims to read.
    Decode(String),
}

impl IntoResponse for ConfigFailure {
    fn into_response(self) -> Response {
        let message = match self {
            Self::Read(cause) => format!("Xiranite config could not be read: {cause}"),
            Self::Decode(cause) => format!("Xiranite config could not be parsed: {cause}"),
        };
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": message }))).into_response()
    }
}

/// Bytes on disk to the JSON object the client expects: BOM strip, TOML parse, key order kept.
fn project_document(contents: Option<&str>) -> Result<Value, ConfigFailure> {
    let Some(raw) = contents else { return Ok(json!({})) };
    let table: toml::Table =
        toml::from_str(strip_bom(raw)).map_err(|error| ConfigFailure::Decode(error.to_string()))?;
    serde_json::to_value(table).map_err(|error| ConfigFailure::Decode(error.to_string()))
}

/// `config.<group>[name]`, the same two-step the TypeScript does with `config.app?.[section]`.
///
/// A group that exists but is not a table yields `None` rather than a wrong shape: the client treats
/// `undefined` as "this node has no stored settings" and must not be handed a string as if it were one.
fn typed_section(document: &Value, group: &str, name: &str) -> Option<Value> {
    document.get(group)?.get(name).cloned()
}

fn strip_bom(raw: &str) -> &str {
    raw.strip_prefix('\u{feff}').unwrap_or(raw)
}

/// `GET /config` → `{ config, path }` (`configService.ts:205-208`).
pub async fn get_config(state: State<Arc<ApiContext>>) -> Response {
    match state.config.document() {
        Ok(config) => (Json(json!({ "config": config, "path": path_text(&state) }))).into_response(),
        Err(failure) => failure.into_response(),
    }
}

/// `GET /config/path` → `{ path }` (`configService.ts`'s `getConfigPath`, wrapped at `index.ts:301-303`).
pub async fn get_path(state: State<Arc<ApiContext>>) -> Response {
    (Json(json!({ "path": path_text(&state) }))).into_response()
}

/// `GET /config/app/:section` → `{ config?, path }` (`index.ts:383-385`).
pub async fn get_app_section(
    state: State<Arc<ApiContext>>,
    Path(section): Path<String>,
) -> Response {
    match state.config.app_section(&section) {
        Ok(answer) => body_with_section(answer, &path_text(&state)),
        Err(failure) => failure.into_response(),
    }
}

/// `GET /config/nodes/:nodeId` → `{ config?, path }` (`index.ts:372-374`).
pub async fn get_node_section(
    state: State<Arc<ApiContext>>,
    Path(node_id): Path<String>,
) -> Response {
    match state.config.node_section(&node_id) {
        Ok(answer) => body_with_section(answer, &path_text(&state)),
        Err(failure) => failure.into_response(),
    }
}

/// `GET /config/themes` → `{ themes, path }` (`index.ts:409-411`).
pub async fn get_themes(state: State<Arc<ApiContext>>) -> Response {
    match state.config.themes() {
        Ok((themes, path)) => (Json(json!({ "themes": themes, "path": path.display().to_string() }))).into_response(),
        Err(failure) => failure.into_response(),
    }
}

/// A missing section drops the key, which is what `JSON.stringify` of `{ config: undefined }` sends.
fn body_with_section(section: Option<Value>, path: &str) -> Response {
    let body = match section {
        Some(value) => json!({ "config": value, "path": path }),
        None => json!({ "path": path }),
    };
    (Json(body)).into_response()
}

fn path_text(state: &ApiContext) -> String {
    state.config.document_path().display().to_string()
}
