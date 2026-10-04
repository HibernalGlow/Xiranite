//! The shared node runtime (ADR-0069): one place that loads a node's `wasm`, serves its declared
//! `xiranite.*` capabilities against `xiranite-core`, and drives an operation from `queued` to a
//! terminal phase.
//!
//! The Tauri host, each node CLI (`x<id>`) and each node TUI reach node behaviour through
//! [`NodeRuntime`]; none of them may reimplement the load-run-report loop. The Extism mechanics stay
//! one layer down in `xiranite-extism-adapter`, and the vocabulary stays in `xiranite-plugin-api`, so
//! a face that wants to run a node needs exactly this crate plus a grant list.
//!
//! ```text
//! HTTP / CLI / TUI  →  NodeRuntime (this crate)
//!                         ├─ NodeRegistry      staged <id>/manifest.json + <id>.wasm, compiled cache
//!                         ├─ CompiledNode      xiranite-extism-adapter
//!                         └─ OperationCapabilities   xiranite-core: fs service, event stream, pause
//! ```

mod capabilities;
mod launcher;
mod manifest;
mod registry;

pub use capabilities::{SERVED_CAPABILITIES, OperationCapabilities};
pub use launcher::NodeRuntime;
pub use manifest::{MANIFEST_FILE, ManifestError, PluginManifest};
pub use registry::{NodeDescriptor, NodeRegistry, RegistryError};
