//! A node's `manifest.json`, as the host reads it.
//!
//! ADR-0068 splits the three version fields on purpose: `pluginVersion` is the node's own release,
//! `pluginApiVersion` is the Plugin API the shim was written against, `runtimeVersion` is Extism's.
//! Only the middle one is a compatibility gate here — Xiranite's version is not the Plugin API
//! version, so a host bump must not silently refuse an old plugin or accept an incompatible one.

use serde::Deserialize;
use std::path::Path;
use thiserror::Error;
use xiranite_plugin_api::PLUGIN_ABI_VERSION_MAJOR;

/// The file name a node directory is recognized by.
pub const MANIFEST_FILE: &str = "manifest.json";

/// One node's declared plugin contract.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    /// The node id; also the key in `docs/xiranite-target-node-manifest.json`.
    pub id: String,
    /// The wasm file name, resolved next to this manifest.
    pub wasm: String,
    /// The node's own release.
    pub plugin_version: String,
    /// The Plugin API this shim was written against, `"major.minor"`.
    pub plugin_api_version: String,
    /// The Extism runtime the port was measured on.
    pub runtime_version: String,
    /// The exported entry point. It is called with zero wasm parameters, because the official
    /// `extism` Rust host invokes exports with no arguments (see `xiranite_extism_adapter::CompiledNode`).
    pub entry_point: String,
    /// `memoryMaxPages`: the Extism-side half of ADR-0066's two-layer enforcement.
    #[serde(default)]
    pub memory_max_pages: Option<u32>,
    /// Static paths the plugin may reach. An empty list means the manifest declares no fixed roots
    /// and the host's per-operation grant governs.
    #[serde(default)]
    pub allowed_paths: Vec<String>,
    /// Hosts the plugin may reach; no served capability uses them yet, and the field stays because
    /// `bun run audit:plugin-manifests` requires the three version fields plus this shape.
    #[serde(default)]
    pub allowed_hosts: Vec<String>,
    /// The settled `xiranite.*` capability names the plugin imports.
    pub host_functions: Vec<String>,
}

/// Why a manifest could not be used.
#[derive(Debug, Error)]
pub enum ManifestError {
    /// The file could not be read.
    #[error("could not read {path}: {source}")]
    Read {
        /// The path that failed.
        path: String,
        /// The underlying OS error.
        source: std::io::Error,
    },
    /// The JSON did not match the manifest shape.
    #[error("manifest {path} is not a valid plugin manifest: {source}")]
    Decode {
        /// The offending file.
        path: String,
        /// The serde error.
        source: serde_json::Error,
    },
    /// The declared Plugin API major is not the one this host serves.
    #[error("plugin {id} targets Plugin API {declared}, this host serves {PLUGIN_ABI_VERSION_MAJOR}.x")]
    ApiVersion {
        /// The node id.
        id: String,
        /// The declared `pluginApiVersion`.
        declared: String,
    },
}

impl PluginManifest {
    /// Reads one manifest file.
    pub fn read(path: &Path) -> Result<Self, ManifestError> {
        let text = std::fs::read_to_string(path).map_err(|source| ManifestError::Read {
            path: path.display().to_string(),
            source,
        })?;
        let manifest: PluginManifest =
            serde_json::from_str(&text).map_err(|source| ManifestError::Decode {
                path: path.display().to_string(),
                source,
            })?;
        manifest.check_plugin_api()?;
        Ok(manifest)
    }

    /// Refuses a plugin written against a different Plugin API major.
    fn check_plugin_api(&self) -> Result<(), ManifestError> {
        let declared_major =
            self.plugin_api_version.split('.').next().unwrap_or_default().parse::<u8>();
        if declared_major == Ok(PLUGIN_ABI_VERSION_MAJOR) {
            Ok(())
        } else {
            Err(ManifestError::ApiVersion {
                id: self.id.clone(),
                declared: self.plugin_api_version.clone(),
            })
        }
    }
}
