//! `kisaki` as a scripted node: the czkawka surface, one implementation, executed by QuickJS.
//!
//! The shape mirrors `src/dissolvef.rs` — a `JsNodeSpec::platform` over the bundle `build.rs` staged out
//! of `artifacts/node-bundles/kisaki.js`, and the two halves reading the same `static` so the policy the
//! host enforces and the runnable the host calls cannot disagree about the id.
//!
//! ## Why it declares a service
//!
//! The node's engine is `czkawka_core`, linked into the host (`src/czkawka_operations.rs` in the executor
//! crate) rather than reached through the NAPI addon it used to load — a realm cannot load a `.node` file,
//! which is the reason this node was the last one that could not leave Node. The engine is a *host service*,
//! so it is granted the way external programs are: named on the registration, refused for any node that did
//! not name it. Without the declaration below every scan call dies at the gate.
//!
//! ## What is deliberately not declared yet
//!
//! `processes` is empty. The restored platform face still has `openCzkawkaPath`, which shells out to
//! `open` / `xdg-open` / `explorer.exe` / `rundll32.exe`, and the video-optimizer tools reach ffmpeg through
//! the engine rather than argv. Neither is wired to the host service in this round (only
//! `scan.duplicates` is), so an allowlist entry here would widen the policy for a path that cannot run.
//! Those actions therefore answer the gate's own refusal, naming the declaration they need — a visible gap
//! rather than a silently broader one.
//!
//! The live-byte ceiling is not yet measured against a large tree: a scan's result arrives as one JSON
//! document in the realm, so a folder with tens of thousands of duplicate groups is the case that would
//! find this number too small. It is set to double `dissolvef`'s ceiling for that reason, and the
//! measurement is the open item.

use xiranite_node_registry::{BuiltInNode, NodeDescriptor, RootAccess, RootRequirement};
use xiranite_quickjs_executor::{JsNode, JsNodeSpec};

/// The bundle `build.rs` staged out of `artifacts/node-bundles/kisaki.js`.
const KISAKI_BUNDLE: &str = include_str!(concat!(env!("OUT_DIR"), "/kisaki.js"));

/// The one registration. Both halves below read this `static`.
///
/// The entry names follow the node's own id (`runKisaki`, `createNodeKisakiRuntime`), which is what
/// `scripts/generate-node-registries.ts` derives by convention, so the TypeScript registry and this
/// declaration now read the same spelling without an override entry.
static KISAKI_SPEC: JsNodeSpec = JsNodeSpec::platform(
    NodeDescriptor::new("kisaki", "0.1.0", 1)
        .with_roots(&[RootRequirement {
            role: "workspace",
            access: RootAccess::ReadWrite,
        }])
        .walk_tree(true)
        .with_services(&["czkawka"])
        .budget(33_554_432, 1),
    KISAKI_BUNDLE,
    "runKisaki",
    "createNodeKisakiRuntime",
);

static KISAKI_JS: JsNode = JsNode::new(&KISAKI_SPEC);

/// The dispatch half, named because a registry only learns about a node through what the host lists.
pub static KISAKI: &'static dyn BuiltInNode = &KISAKI_JS;

/// The policy half, for the registry's descriptor table.
pub static KISAKI_DESCRIPTOR: &NodeDescriptor = &KISAKI_SPEC.descriptor;
