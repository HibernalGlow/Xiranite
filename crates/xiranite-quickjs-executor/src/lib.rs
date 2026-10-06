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
//! ## The three crates, and which one owns which fact
//!
//! Since ADR-0078 the substrate is not in this crate:
//!
//! - **`crates/quickjs-host-protocol`** owns the wire vocabulary (`HostOperation` and its 30 names), the
//!   two envelopes (`HostAnswer`, `HostRefusal`), the run-control strings (the cancel text and the four
//!   checkpoint phases) and the ceilings. **If you are about to write one of those out somewhere else,
//!   stop and change the protocol crate instead.**
//! - **`crates/quickjs-realm`** owns the engine facts: one `Runtime` and one fresh `Context` per run, the
//!   `__xrh` bridge, the asynchronous pump, bundle resolution, the host-side digests. Its `src/lib.rs` is
//!   where the measured engine rules live (no timers in the realm, the interrupt handler only firing while
//!   JS executes, the `Context::with` re-entry rule, no `Intl`, the teardown order).
//! - **this crate** owns only Xiranite's machine: the granted filesystem, the declared programs, the child
//!   process and sidecar tables, the host services, and the node seam.
//!
//! ## The shape of one run
//!
//! ```text
//!   BuiltInNode::run(input, host)                       node.rs (JsNode) — this crate
//!     -> realm_run::RealmRun                            ceilings + machine surface — this crate
//!     -> quickjs_realm::Executor::run(input, dispatch)  one Runtime + one fresh Context
//!          -> quickjs_realm::shims::install             globalThis.__xrh
//!          -> quickjs_realm::bundle::resolve            ES module, else global script
//!          -> run(input, runtime, onEvent)              [+ createRuntime() + the control triple]
//!          -> quickjs_realm::jobs::Pump                 drains __xrh.callAsync, pumps jobs
//!               -> dispatch::NodeHostDispatch           HostDispatch -> host_calls::execute — this crate
//! ```
//!
//! JS is only ever entered from Rust and the host is only ever touched from Rust, so the pump loop is where
//! the two meet. Host calls therefore have two shapes, not one: `__xrh.call` answers synchronously through
//! the run-scoped host slot, while `__xrh.callAsync` hands the request to the pump and settles a promise
//! later. That split is the realm's; the arms that answer the calls are this crate's.
//!
//! ## What is deliberately not here
//!
//! - No Node/Bun builtin emulation. `node:fs`, `node:path`, `node:child_process` and the rest are the shim
//!   layer's job (`packages/quickjs-shims`); this crate provides only the host surface those shims call into.
//! - No second copy of an engine rule or a wire name. Both live in the two crates above, and the vocabulary
//!   is checked across the language boundary by `bun run audit:quickjs-host-ops`, which reads the compiled
//!   `HostOperation::ALL` rather than a file.
//! - No scheduler and no operation ownership. Whoever calls
//!   [`BuiltInNode::run`](xiranite_node_registry::BuiltInNode::run) owns the operation.

mod config_operations;
mod dispatch;
#[cfg(feature = "czkawka")]
mod czkawka_operations;
#[cfg(feature = "findz")]
mod findz_operations;
mod fs_operations;
mod host_calls;
mod host_services;
mod machine;
mod node;
mod os_operations;
mod power_operations;
mod realm_run;
mod proc_operations;
// The sidecar holder and the filesystem feed are compiled in whenever `findz` is, and are dead code
// when it is not: the only engine that starts a sidecar is Findz, while `machine.rs` keeps the table
// as a generic machine-surface field. `#[cfg]`-ing these two modules off properly needs the same
// treatment on `MachineAccess` (the `SidecarTable` field, its two constructors and the `sidecars()`
// accessor), which is why the cut stops at the row today
// (`docs/migration/host-service-feature-gate.md` §12).
#[cfg_attr(not(feature = "findz"), allow(dead_code))]
mod sidecar;
mod trash_operations;
#[cfg_attr(not(feature = "findz"), allow(dead_code))]
mod watch;

#[cfg(test)]
mod test_host;

pub use host_services::published_services;
pub use node::{JsNode, JsNodeSpec};
pub use realm_run::RealmRun;

// The realm and the protocol live in their own crates now (ADR-0078); this crate re-exports the names it
// runs with, so an embedder reads one API and the source of truth stays where it is written.
pub use quickjs_host_protocol::{HostOperation, MAX_PROCESS_OUTPUT_BYTES};
pub use quickjs_realm::{DEFAULT_HOST_POLL_INTERVAL, DEFAULT_RUN_DEADLINE, EngineLimits, EntryPlan, RealmError, RunSignals};

/// Re-exported so a diagnostic printed by this host and by the shim layer spell the protocol
/// generation the same way; the value itself is the protocol crate's (ADR-0078).
pub use quickjs_host_protocol::PROTOCOL_VERSION;
