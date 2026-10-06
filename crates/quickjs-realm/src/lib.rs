//! The QuickJS realm substrate.
//!
//! One [`Executor`] owns one `Runtime` plus one fresh `Context` per run, installs the host bridge the
//! bundle calls (`globalThis.__xrh`), resolves the bundle's entry, and drives the run to a result document.
//! It speaks [`quickjs_host_protocol`] and nothing else: whatever machine stands behind the realm answers a
//! [`HostDispatch`](quickjs_host_protocol::HostDispatch) and this crate never learns what it is.
//!
//! It was extracted from `crates/xiranite-quickjs-executor` by ADR-0078 so that a second project embedding
//! QuickJS does not rewrite the engine facts below. **They are all measured, not inferred** — the probes are
//! `spikes/quickjs-probe/`, `spikes/polyfill-realm-probe/`, `spikes/fs-ops-realm-probe/`.
//!
//! ## Engine facts this crate is built on
//!
//! - **The engine is QuickJS-NG through `rquickjs` 0.14**, with pre-generated bindings (`bindgen` off), so
//!   LLVM/Clang stays out of the build. `array-buffer` is required, not cosmetic: the byte channel crosses
//!   as a `Uint8Array`, and the protocol forbids base64 inside JSON.
//! - **The interrupt handler only fires while JavaScript is executing.** A run parked on `await` is therefore
//!   not interruptible: the *host* must release it or refuse it. That is why the pump lives in `jobs.rs` and why a
//!   parked `callAsync` is settled by the pump rather than by a timer — there are no timers in this realm.
//! - **Pumping the job queue inside `Context::with` re-enters the `RefCell`** and aborts the process, so the
//!   pump holds the context and calls `execute_queued_jobs` from the same borrow discipline it documents.
//! - **No `Intl`, and the default `localeCompare` silently reorders non-ASCII text.** Environment-dependent
//!   answers come from the host, one implementation each; a second "equivalent" path is how
//!   `["a","ä","b"]` becomes `["a","b","ä"]`.
//! - **No wall clock, no `Math.random()` answers a journal.** `clock.now` and the entropy arms are host
//!   calls; the realm's own entropy source is documented as non-cryptographic where it exists.
//! - **Teardown order is fixed**: interrupt handler off, then the host guard, then the context, then the
//!   runtime. Reordering it is the `Persistent`-promise abort the `probe` feature gate isolates.
//!
//! ## What deliberately is not here
//!
//! - **No `node:` builtin emulation.** That is the shim layer's job (`packages/quickjs-shims`); this crate
//!   provides only the host surface those shims call into.
//! - **No node registry, no granted filesystem, no host services.** A run's authorization — which roots,
//!   which programs, which services — belongs to the embedding host, which builds the dispatch it hands
//!   [`Executor::run`].
//! - **No scheduler and no operation ownership.** Whoever calls [`Executor::run`] owns the operation, the
//!   cancel signals and the event stream.

mod bundle;
mod crypto;
mod error;
mod digest;
mod engine;
mod host_slot;
mod jobs;
mod shims;
mod wire;

#[cfg(test)]
mod test_dispatch;

pub use digest::Algorithm;
pub use crypto::{fill_entropy, format_uuid, hex};
pub use engine::{EngineLimits, EntryPlan, Executor};
pub use error::RealmError;
pub use jobs::{DEFAULT_HOST_POLL_INTERVAL, DEFAULT_RUN_DEADLINE, RunSignals};
