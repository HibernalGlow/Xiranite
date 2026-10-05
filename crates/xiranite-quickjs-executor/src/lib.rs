//! QuickJS as one node executor behind the node protocol (ADR-0074).
//!
//! The Core does not know JavaScript exists. [`xiranite_node_registry::BuiltInNode`] is the seam a
//! node is run through, and this crate is an *adapter* on the other side of it: [`JsNode`] answers
//! that trait by evaluating a node's own TypeScript bundle (compiled to JavaScript) in an embedded
//! QuickJS, and hands the bundle the *same* [`xiranite_node_registry::NodeHost`] a native Rust node
//! gets. Nothing in `xiranite-core`, `crates/xiranite-native-host` or the registry learns that a
//! script is involved: the event stream, the granted-root filesystem, the clock and the
//! pause/cancel are the ones the native nodes already use.
//!
//! ## The shape of one run
//!
//! ```text
//!   BuiltInNode::run(input, host)
//!     -> engine::Executor            one Runtime + one fresh Context per run
//!          -> shims::install         globalThis.__xrh  (the agreed host protocol)
//!          -> bundle::resolve        ES module, else global script, exports by name
//!          -> run(input, runtime, onEvent)   [+ createRuntime() and the NodeRunControl triple]
//!          -> jobs::Pump            drains __xrh.callAsync, pumps jobs, watches the outcome
//! ```
//!
//! JS is only ever entered from Rust and the host is only ever touched from Rust, so the pump loop
//! is where the two meet. Host calls therefore have two shapes, not one: `__xrh.call` answers
//! synchronously through the run-scoped host slot, while `__xrh.callAsync` hands the request to the
//! pump and settles a promise later. The split is the measured engine fact from
//! `spikes/quickjs-probe/README.md` — the interrupt handler only fires while JS is executing, so a
//! parked await has to be released (or refused) by the host, never by the engine.
//!
//! ## What is deliberately not here
//!
//! - No Node/Bun builtin emulation. `node:fs`, `node:path`, `node:child_process` and the rest are
//!   the shim layer's job; this crate provides only the host surface those shims call into.
//! - No `Intl`, no locale collation, no wall clock inside the sandbox. ADR-0074 §2: environment
//!   dependent answers come from the host, one implementation, because QuickJS ships no Intl and its
//!   default `localeCompare` silently reorders non-ASCII text.
//! - No binary payloads inside JSON. The node seam carries *text* documents
//!   (`read_text`/`write_text`) and no byte channel, so v1 has no binary path at all rather than a
//!   base64 one — the ADR-0071 lesson. A real byte path is a host-side handle plus
//!   `fs.readRange`/`fs.closeHandle`, which needs a seam method that does not exist yet.
//! - No scheduler and no operation ownership. Whoever calls [`JsNode::run`] owns the operation.

mod bundle;
mod config_operations;
mod czkawka_operations;
mod digest;
mod engine;
mod fs_operations;
mod host_calls;
mod host_services;
mod host_slot;
mod jobs;
mod machine;
mod node;
mod proc_operations;
mod shims;

#[cfg(test)]
mod test_host;

pub use engine::{EngineLimits, EntryPlan, Executor};
pub use host_calls::{HostOperation, MAX_PROCESS_OUTPUT_BYTES};
pub use jobs::{DEFAULT_HOST_POLL_INTERVAL, DEFAULT_RUN_DEADLINE, RunSignals};
pub use node::{JsNode, JsNodeSpec};

/// The spelling every host-call error and every diagnostic uses for this protocol generation.
///
/// Named once because the shim layer and the executor are written by different hands and a drift
/// between `xrh-v1` and `xrh-v2` in an error message is the only clue an operator gets.
pub const PROTOCOL_VERSION: &str = "xrh-v1";
