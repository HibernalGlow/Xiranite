//! A node's `manifest.toml`, as the host reads it.
//!
//! The manifest is TOML because it is Xiranite's own contract rather than a runtime's file format: one
//! document carries the node identity, the `[backend]` half the Extism host needs, and — for a plugin
//! with a UI — the `[frontend]` and permission halves the Plugin Manager reads
//! (`docs/plugin-architecture.md` §2.1). `mf-manifest.json` is the Module Federation runtime's own
//! metadata and is deliberately not read here.
//!
//! ADR-0068's three version facts are spelled `version` (the node's own release), `backend_api` (the
//! Plugin API the shim was written against) and `backend.runtime_version` (the Extism version it was
//! measured on). Only `backend_api` gates loading here — Xiranite's version is not the Plugin API
//! version, so a host bump must not silently refuse an old plugin or accept an incompatible one.

use serde::Deserialize;
use std::path::Path;
use thiserror::Error;
use xiranite_plugin_api::PLUGIN_ABI_VERSION_MAJOR;

/// The file name a node directory is recognized by.
pub const MANIFEST_FILE: &str = "manifest.toml";

/// The only `[backend] runtime` this host can execute.
pub const BACKEND_RUNTIME: &str = "extism";

/// One node's declared plugin contract.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PluginManifest {
    /// The node id; also the key in `docs/xiranite-target-node-manifest.json`.
    pub id: String,
    /// Display name for the plugin list. Not read by the backend host.
    #[serde(default)]
    pub name: Option<String>,
    /// The node's own release (`pluginVersion` in ADR-0068's vocabulary).
    pub version: String,
    /// The Plugin API version this node's *frontend* half targets. Absent for a backend-only node;
    /// the frontend Plugin Manager is the consumer, not this host.
    #[serde(default)]
    pub frontend_api: Option<String>,
    /// The Plugin API this backend shim was written against, `"major.minor"` (`pluginApiVersion`).
    pub backend_api: String,
    /// The wasm half the host installs and calls.
    pub backend: BackendManifest,
}

/// The `[backend]` section: everything needed to install one node's wasm and call it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct BackendManifest {
    /// The execution runtime. Anything but [`BACKEND_RUNTIME`] is refused rather than quietly run as
    /// Extism, because the field is the manifest's promise about how the wasm is entered.
    pub runtime: String,
    /// The wasm file name, resolved next to this manifest. Distinct from `entry_point`, which is the
    /// export *inside* that file.
    pub entry: String,
    /// The exported entry point. It is called with zero wasm parameters, because the official
    /// `extism` Rust host invokes exports with no arguments (see `xiranite_extism_adapter::CompiledNode`).
    pub entry_point: String,
    /// The Extism runtime version the port was measured on (`runtimeVersion`).
    pub runtime_version: String,
    /// `memory_max_pages`: the Extism-side half of ADR-0066's two-layer enforcement.
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
    /// The TOML did not match the manifest shape.
    #[error("manifest {path} is not a valid plugin manifest: {source}")]
    Decode {
        /// The offending file.
        path: String,
        /// The TOML/serde error.
        source: toml::de::Error,
    },
    /// `[backend] runtime` names something this host cannot execute.
    #[error("plugin {id} declares backend runtime {declared}, this host only runs runtime {BACKEND_RUNTIME}")]
    Runtime {
        /// The node id.
        id: String,
        /// The declared `[backend] runtime`.
        declared: String,
    },
    /// The declared Plugin API major is not the one this host serves.
    #[error("plugin {id} targets Plugin API {declared}, this host serves {PLUGIN_ABI_VERSION_MAJOR}.x")]
    ApiVersion {
        /// The node id.
        id: String,
        /// The declared `backend_api`.
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
        Self::parse(&text, path)
    }

    /// Parses one manifest document and applies the two gates that decide whether this host may run
    /// the node at all: the backend runtime, and the Plugin API major.
    pub fn parse(text: &str, path: &Path) -> Result<Self, ManifestError> {
        let manifest: PluginManifest =
            toml::from_str(text).map_err(|source| ManifestError::Decode {
                path: path.display().to_string(),
                source,
            })?;
        if manifest.backend.runtime != BACKEND_RUNTIME {
            return Err(ManifestError::Runtime {
                id: manifest.id.clone(),
                declared: manifest.backend.runtime.clone(),
            });
        }
        manifest.check_plugin_api()?;
        Ok(manifest)
    }

    /// Refuses a plugin written against a different Plugin API major.
    fn check_plugin_api(&self) -> Result<(), ManifestError> {
        let declared_major =
            self.backend_api.split('.').next().unwrap_or_default().parse::<u8>();
        if declared_major == Ok(PLUGIN_ABI_VERSION_MAJOR) {
            Ok(())
        } else {
            Err(ManifestError::ApiVersion {
                id: self.id.clone(),
                declared: self.backend_api.clone(),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// The smallest document the host accepts: a backend-only node.
    const MINIMAL: &str = r#"
id = "dissolvef"
version = "0.1.0"
backend_api = "1.0"

[backend]
runtime = "extism"
entry = "dissolvef.wasm"
entry_point = "dissolvef_run"
runtime_version = "1.30.0"
host_functions = ["xiranite.operation.checkpoint", "xiranite.now"]
"#;

    fn parse(text: &str) -> Result<PluginManifest, ManifestError> {
        PluginManifest::parse(text, Path::new("manifest.toml"))
    }

    #[test]
    fn reads_a_backend_only_manifest() {
        let manifest = parse(MINIMAL).expect("minimal manifest parses");
        assert_eq!(manifest.id, "dissolvef");
        assert_eq!(manifest.backend.entry, "dissolvef.wasm");
        assert_eq!(manifest.backend.entry_point, "dissolvef_run");
        assert_eq!(manifest.backend.memory_max_pages, None);
        assert_eq!(manifest.backend.allowed_paths, Vec::<String>::new());
        // A node with no UI declares no frontend half; that is the normal case, not an error.
        assert_eq!(manifest.frontend_api, None);
        assert_eq!(manifest.name, None);
    }

    /// `[frontend]` and `[permissions]` belong to the Plugin Manager and the frontend host. Ignoring
    /// them here is required: rejecting them would make the one manifest format unusable by the two
    /// halves that read it, which is what a per-runtime manifest file would have been.
    #[test]
    fn tolerates_the_sections_another_face_reads() {
        // `frontend_api` goes next to the other top-level keys: after a `[table]` header a bare key
        // belongs to that table, and the TOML parser would silently file it under `[backend]`.
        let text = format!(
            "{}\n[frontend]\nruntime = \"module-federation\"\nmanifest = \"frontend/mf-manifest.json\"\nalias = \"dissolvef\"\n\n[permissions]\nfilesystem = [\"read\"]\n",
            MINIMAL.replace("backend_api = \"1.0\"", "backend_api = \"1.0\"\nfrontend_api = \"1.0\"")
        );
        let manifest = parse(&text).expect("extra sections must not break the backend reader");
        assert_eq!(manifest.frontend_api.as_deref(), Some("1.0"));
        // The backend half is still read exactly as before, which is the point of one shared document.
        assert_eq!(manifest.backend.entry, "dissolvef.wasm");
        assert_eq!(manifest.backend.entry_point, "dissolvef_run");
    }

    /// The entry point has no default: a plugin that cannot be linked is the failure ADR-0068 was
    /// written to prevent, so a manifest that omits it must not load as "some export name".
    #[test]
    fn entry_point_is_required_not_defaulted() {
        let text = MINIMAL.replace("entry_point = \"dissolvef_run\"\n", "");
        let error = parse(&text).expect_err("missing entry_point must be refused");
        assert!(
            matches!(error, ManifestError::Decode { .. }),
            "unexpected error: {error}"
        );
        assert!(error.to_string().contains("entry_point"), "{error}");
    }

    #[test]
    fn an_unknown_backend_runtime_is_refused() {
        let text = MINIMAL.replace("runtime = \"extism\"", "runtime = \"wasi\"");
        let error = parse(&text).expect_err("a runtime this host cannot execute must be refused");
        assert!(matches!(error, ManifestError::Runtime { .. }), "{error}");
        assert!(error.to_string().contains("wasi"), "{error}");
    }

    #[test]
    fn a_different_plugin_api_major_is_refused() {
        let text = MINIMAL.replace("backend_api = \"1.0\"", "backend_api = \"2.0\"");
        let error = parse(&text).expect_err("an incompatible Plugin API must be refused");
        assert!(matches!(error, ManifestError::ApiVersion { .. }), "{error}");
    }

    /// `MANIFEST_FILE` is the staging contract: `scripts/build-node-wasm.ts` writes this name and the
    /// desktop host's `XIRANITE_PLUGIN_DIR` scan reads it. A test on the constant is the only way a
    /// drift between the TS producer and this consumer shows up without running both.
    #[test]
    fn the_staged_file_name_is_toml() {
        assert_eq!(MANIFEST_FILE, "manifest.toml");
        assert_eq!(PathBuf::from("dissolvef").join(MANIFEST_FILE).extension().and_then(|e| e.to_str()), Some("toml"));
    }
}
