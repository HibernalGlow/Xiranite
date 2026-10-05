//! Xiranite's business core: the layer the Axum backend calls.
//!
//! ADR-0063 fixes the shape. The React product layer and the HTTP/Operation protocol
//! stay; the Bun/Elysia backend behind them is replaced by Rust on Tokio, plugins run in
//! Extism, and the desktop host becomes Tauri 2. This crate is the business half of that:
//! [`operation`] is the lifecycle the `/node-operations/:id/...` routes serve, and
//! [`support`] is the injected clock and identifier vocabulary the wire protocol needs.
//! `crates/xiranite-api` owns routes and `crates/xiranite-plugins` owns Extism; neither is
//! a dependency of this crate.
//!
//! ## Protocol, not invention
//!
//! Phase strings, DTO field names and lifecycle rules mirror the shipped TypeScript
//! rather than a redesign: `packages/shared/src/index.ts` (`nodeOperationPhaseSchema`,
//! `nodeOperationSchema`, `nodeOperationStreamMessageSchema`) and
//! `packages/services/src/index.ts` (`startOperation`, `pauseOperation`, `resumeOperation`,
//! `cancelOperation`, `pushEvent`, `finishOperation`, `getOperationEvents`,
//! `cleanupOperations`, `subscribeOperation`). Where a behaviour is *not* reproduced, the
//! module says so and why — the JavaScript heap guard is the deliberate example, replaced
//! by the retained-event ceiling plus the Extism manifest memory limit.
//!
//! ## Pause is cooperative, never a frozen thread
//!
//! ADR-0066: `xiranite.operation.checkpoint` is a yield at an item boundary. The host
//! waits *inside* the call while the operation is paused and answers `Cancelled` once it is
//! cancelled, so the plugin needs no suspension primitive.
//! [`operation::OperationControl::checkpoint`] is the only awaiting transition here: it is
//! `async`, parks a task and releases the state mutex before doing so.
//!
//! ## Boundary types stay WIT-expressible
//!
//! ADR-0068: public structs and signatures use fixed-width integers
//! ([`support::TimestampMs`] is `u64` epoch milliseconds, exactly what
//! `z.number().int().nonnegative()` carries today), `String`, `bool`, `f64`, `Option`,
//! `Vec` and the opaque `u64` handles defined in `xiranite-plugin-api`. No `usize`,
//! `isize`, raw pointer or lifetime appears in the public API surface, so replacing the
//! Extism adapter does not have to reshape this crate.

pub mod config_store;
pub mod enumeration;
pub mod file_stream;
pub mod filesystem;
pub mod operation;
pub mod support;

pub use operation::{
    DEFAULT_OPERATION_RETENTION_MS, IndexedOperationEvent, NodeOperationCleanupResponse,
    NodeOperationEventsResponse, NodeOperationListResponse, NodeOperationRecord,
    NodeRunEventRecord, NodeRunResultRecord, OperationControl, OperationFilter,
    OperationManager, OperationManagerOptions, OperationNotFound, OperationPhase,
    OperationStreamMessage, OperationSubscription, RetainedEventStats, SubscribeOptions,
};
pub use support::{Clock, IdGenerator, ManualClock, SystemClock, TimestampMs, to_base36};

// The remaining ADR-0063 core modules — the resource scheduler, the SQLite repositories and the
// `xiranite.fs.*` capability service — land with the crate that consumes them: the Axum routes need
// the scheduler and the repositories, the host needs the filesystem capability. Declaring empty modules
// for each now would only hide that behind names.
//
// The config half of that list has landed as [`config_store`], and deliberately not as a "TOML service":
// parsing and merging a config document is node and product logic (`packages/config/src/schema.ts`), while
// the lock and the durable replace are host behaviour. The host therefore owns the second half and answers
// documents, never schemas.
