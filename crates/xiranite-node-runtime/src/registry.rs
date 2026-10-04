//! The staged plugin layout the host loads: `<root>/<id>/manifest.json` plus `<id>.wasm` beside it.
//!
//! Staging rather than pointing straight at `crates/nodes/<id>/target/…` is deliberate: the same
//! directory is what a Tauri `resources` entry ships (ADR-0069's per-build config overlay), so the
//! desktop host, a node CLI and a packaged app all read one shape. `scripts/build-node-wasm.ts`
//! produces it.
//!
//! One wasm is compiled once and reused by every operation of that node (ADR-0068's
//! plugin-lifecycle / operation-lifecycle split); the per-operation state lives in the capability
//! host built fresh for each run.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use thiserror::Error;
use xiranite_extism_adapter::{CompiledNode, PluginSetup};

use crate::manifest::{MANIFEST_FILE, ManifestError, PluginManifest};

/// One node's manifest plus the wasm bytes it names.
#[derive(Debug, Clone)]
pub struct NodeDescriptor {
    /// The declared plugin contract.
    pub manifest: PluginManifest,
    wasm: Vec<u8>,
    directory: PathBuf,
}

impl NodeDescriptor {
    /// Reads `directory/manifest.json` and the wasm file it names.
    pub fn read(directory: &Path) -> Result<Self, RegistryError> {
        let manifest = PluginManifest::read(&directory.join(MANIFEST_FILE))?;
        let wasm_path = directory.join(&manifest.wasm);
        let wasm = std::fs::read(&wasm_path).map_err(|source| RegistryError::WasmMissing {
            path: wasm_path.display().to_string(),
            source,
        })?;
        Ok(Self { manifest, wasm, directory: directory.to_path_buf() })
    }

    /// Where the wasm was read from, for an error line that a user can act on.
    #[must_use]
    pub fn wasm_path(&self) -> PathBuf {
        self.directory.join(&self.manifest.wasm)
    }

    /// The wasm bytes, for the adapter.
    #[must_use]
    pub fn wasm(&self) -> &[u8] {
        &self.wasm
    }
}

/// Why a node could not be loaded or compiled.
#[derive(Debug, Error)]
pub enum RegistryError {
    /// A manifest could not be read or did not match the shape.
    #[error(transparent)]
    Manifest(#[from] ManifestError),
    /// The staged directory could not be listed.
    #[error("could not scan the plugin root {path}: {source}")]
    Scan {
        /// The root that failed.
        path: String,
        /// The underlying OS error.
        source: std::io::Error,
    },
    /// The manifest names a wasm file that is not there.
    #[error("node {path} declares a wasm file that could not be read: {source}")]
    WasmMissing {
        /// The expected wasm path.
        path: String,
        /// The underlying OS error.
        source: std::io::Error,
    },
    /// No node with that id is staged.
    #[error("no staged plugin for node `{0}`")]
    UnknownNode(String),
    /// Extism could not install the module.
    #[error("could not install the plugin for node `{id}`: {message}")]
    Compile {
        /// The node id.
        id: String,
        /// The adapter's message.
        message: String,
    },
}

/// The staged nodes, with their compiled forms cached.
///
/// `Debug` is written by hand because `extism::CompiledPlugin` does not implement it, and an audit
/// line only ever needs the ids and how much of the cache is warm.
pub struct NodeRegistry {
    nodes: BTreeMap<String, Arc<NodeDescriptor>>,
    compiled: Mutex<BTreeMap<String, Arc<CompiledNode>>>,
}

impl std::fmt::Debug for NodeRegistry {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("NodeRegistry")
            .field("nodes", &self.nodes.keys().collect::<Vec<_>>())
            .field("compiled", &self.compiled.lock().map(|cache| cache.len()).unwrap_or_default())
            .finish()
    }
}

impl NodeRegistry {
    /// Loads every `<root>/<id>/manifest.json`. A directory without a manifest is skipped; a
    /// manifest that fails to parse or targets another Plugin API major is an error, because a
    /// half-loaded node would show up later as an unexplained "node is not available".
    pub fn load(root: &Path) -> Result<Self, RegistryError> {
        let mut nodes = BTreeMap::new();
        let entries = std::fs::read_dir(root).map_err(|source| RegistryError::Scan {
            path: root.display().to_string(),
            source,
        })?;
        for entry in entries {
            let entry = entry.map_err(|source| RegistryError::Scan {
                path: root.display().to_string(),
                source,
            })?;
            let directory = entry.path();
            if !directory.join(MANIFEST_FILE).is_file() {
                continue;
            }
            let descriptor = NodeDescriptor::read(&directory)?;
            let previous = nodes.insert(descriptor.manifest.id.clone(), Arc::new(descriptor));
            if let Some(previous) = previous {
                // Two staged directories claiming one id would make the run depend on readdir order.
                return Err(RegistryError::Compile {
                    id: previous.manifest.id.clone(),
                    message: format!(
                        "staged twice: {} and {}",
                        previous.directory.display(),
                        directory.display()
                    ),
                });
            }
        }
        Ok(Self { nodes, compiled: Mutex::new(BTreeMap::new()) })
    }

    /// A registry from descriptors already read, for tests and for a host that stages in memory.
    #[must_use]
    pub fn from_descriptors(descriptors: impl IntoIterator<Item = NodeDescriptor>) -> Self {
        Self {
            nodes: descriptors.into_iter().map(|descriptor| (descriptor.manifest.id.clone(), Arc::new(descriptor))).collect(),
            compiled: Mutex::new(BTreeMap::new()),
        }
    }

    /// The staged node ids, sorted.
    pub fn ids(&self) -> impl Iterator<Item = &str> {
        self.nodes.keys().map(String::as_str)
    }

    /// The descriptor for one node id.
    pub fn node(&self, id: &str) -> Option<Arc<NodeDescriptor>> {
        self.nodes.get(id).map(Arc::clone)
    }

    /// The compiled plugin for one node, installing it on first use.
    pub fn compiled(&self, id: &str) -> Result<Arc<CompiledNode>, RegistryError> {
        let cached = self
            .compiled
            .lock()
            .expect("compiled plugin cache")
            .get(id)
            .map(Arc::clone);
        if let Some(compiled) = cached {
            return Ok(compiled);
        }
        let descriptor = self.node(id).ok_or_else(|| RegistryError::UnknownNode(id.to_owned()))?;
        let compiled = Arc::new(
            CompiledNode::compile(PluginSetup {
                wasm: descriptor.wasm(),
                entry_point: &descriptor.manifest.entry_point,
                host_functions: &descriptor.manifest.host_functions,
                memory_max_pages: descriptor.manifest.memory_max_pages,
            })
            .map_err(|error| RegistryError::Compile { id: id.to_owned(), message: error.to_string() })?,
        );
        self.compiled
            .lock()
            .expect("compiled plugin cache")
            .insert(id.to_owned(), Arc::clone(&compiled));
        Ok(compiled)
    }
}
