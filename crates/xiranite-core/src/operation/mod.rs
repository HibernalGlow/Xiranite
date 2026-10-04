//! The operation lifecycle the `/node-operations/:id/...` routes serve.
//!
//! [`OperationManager`] is the Rust counterpart of `NodeRunnerService`'s operation
//! half in `packages/services/src/index.ts`: the registry, the phase transitions,
//! the retained event buffer and the stream subscription. [`OperationControl`] is
//! the handle a caller (the Extism host, later) keeps for one run, and the only
//! place that awaits — [`OperationControl::checkpoint`] is ADR-0066's cooperative
//! yield, so pause never parks a thread.

mod control;
mod dto;
mod manager;
mod retention;
mod state;

pub use control::{OperationControl, OperationNotFound};
pub use dto::{
    IndexedOperationEvent, NodeOperationRecord, NodeRunEventRecord, NodeRunResultRecord,
    OperationStreamMessage,
};
pub use manager::{
    DEFAULT_OPERATION_RETENTION_MS, NodeOperationCleanupResponse, NodeOperationEventsResponse,
    NodeOperationListResponse, OperationFilter, OperationManager, OperationManagerOptions,
    OperationSubscription, SubscribeOptions,
};
pub use retention::{RetainedEventStats, normalize_event_index, normalize_event_limit};

// The phase enum is a Plugin API type (ADR-0068): the host, the plugin and the HTTP
// DTO all name the same six strings, so it is defined once in xiranite-plugin-api and
// re-exported here rather than mirrored.
pub use xiranite_plugin_api::OperationPhase;
