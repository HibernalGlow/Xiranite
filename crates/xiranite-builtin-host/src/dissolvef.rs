//! `dissolvef` as a scripted node: one implementation, the TypeScript core, executed by QuickJS.
//!
//! The declaration mirrors `crates/nodes/dissolvef/src/builtin.rs:36-45` on purpose — same id, same
//! version, same policy (`workspace` read-write root, recursive walk, the 16 MiB live-byte ceiling that
//! node shipped with). That is the point of ADR-0074 §1: the *policy* is the contract, and the executor
//! behind it is a choice the registry makes, so a node moving from the native reference implementation to
//! its bundle must not change what the host grants it or what a face can ask it to do.
//!
//! The node declares no external programs. Its old `manifest.toml` listed no `xiranite.fs.run-process`,
//! and the core reaches `pbpaste`/`Get-Clipboard` only through `platform.ts`'s clipboard helper, which the
//! CLI face owns, not the run — so an allowlist entry here would widen the policy for free.

use xiranite_node_registry::{BuiltInNode, NodeDescriptor, RootAccess, RootRequirement};
use xiranite_quickjs_executor::{JsNode, JsNodeSpec};

/// The bundle `build.rs` staged out of `artifacts/node-bundles/dissolvef.js`.
const DISSOLVEF_BUNDLE: &str = include_str!(concat!(env!("OUT_DIR"), "/dissolvef.js"));

/// The one registration. Both halves below read this `static`, so the policy the host enforces and the
/// runnable the host calls cannot disagree about the id.
static DISSOLVEF_SPEC: JsNodeSpec = JsNodeSpec::platform(
    NodeDescriptor::new("dissolvef", "0.1.0", 1)
        .with_roots(&[RootRequirement {
            role: "workspace",
            access: RootAccess::ReadWrite,
        }])
        .walk_tree(true)
        .budget(16_777_216, 1),
    DISSOLVEF_BUNDLE,
    "runDissolvef",
    "createNodeDissolvefRuntime",
);

static DISSOLVEF_JS: JsNode = JsNode::new(&DISSOLVEF_SPEC);

/// The dispatch half, named because a registry only learns about a node through what the host lists.
pub static DISSOLVEF: &'static dyn BuiltInNode = &DISSOLVEF_JS;

/// The policy half, for the registry's descriptor table.
pub static DISSOLVEF_DESCRIPTOR: &NodeDescriptor = &DISSOLVEF_SPEC.descriptor;
