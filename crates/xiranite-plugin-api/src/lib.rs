//! The Xiranite Plugin API: the stable, capability-oriented contract between plugins and the host.
//!
//! Layering is fixed (ADR-0068): Xiranite Plugin API -> Extism Adapter -> plugin.wasm. Nothing in this
//! crate may name an Extism mechanism, a linear-memory ownership rule, or a host internal type
//! (xiranite-core, Tokio, Axum, Tauri, Wails, React). Boundary types stay WIT-expressible: strings,
//! booleans, fixed-width integers, floats, records, fieldless enums with stable tags, lists, options,
//! results and opaque u64 handles. Replacing the adapter with a WIT/Component Model adapter must not
//! force a change here, so an interface that could not be expressed in WIT gets redesigned instead of
//! cemented with an Extism-specific mechanism.
//! Plugin ABI contract for Xiranite's Extism WASM plugins and the Rust host.
//!
//! ADR-0063 fixes the shape this crate describes: Extism is the only plugin
//! substrate, plugins never touch the filesystem or the OS directly, and large
//! payloads do not cross the boundary as bytes. ADR-0066 adds the cooperative
//! control plane: `xiranite.operation.checkpoint()` is a yield that waits while the owning
//! operation is paused, so pause stays a phase change plus a wait rather than CPU
//! suspension.
//!
//! This crate carries vocabulary and invariants only. It has no dependencies, so
//! the same types compile into a `wasm32-unknown-unknown` plugin and into the
//! Tokio/Axum host: no filesystem, network, clock, threads, serialization library
//! or async runtime appears below. Byte-for-byte JSON encoding of these types is
//! the job of the host and plugin shim layers (see [`payload`]), because adding
//! serde here would put a derive-dependency in front of every plugin.
//!
//! The HTTP/Operation protocol keeps its existing JSON field names
//! (ADR-0063 principle 3); the numeric ABI codes in [`abi_code`] exist for the
//! WASM boundary, where a plugin shim needs fixed-size tags it can produce
//! without a serialization framework.

pub mod abi_code;
pub mod checkpoint;
pub mod host_calls;
pub mod host_function_names;
pub mod identifiers;
pub mod invocation;
pub mod node_definition;
pub mod operation_status;
pub mod payload;
pub mod protocol_version;
pub mod run_events;
pub mod run_options;
pub mod tokens;

/// The node definition vocabulary (ADR-0069), re-exported with the rest of the boundary types so a
/// plugin, `xiranite-cli-runtime` and `xiranite-tui-runtime` name the same types.
pub use node_definition::{
    DEFINITION_VERSION_V1, Condition, DangerGate, DangerPrompt, DefinitionError, FieldDefinition,
    FieldGroup, FieldKind, FieldOption, FieldRange, InputBinding, NodeAction, NodeDefinition,
    LocalizedText, Scalar, Transform,
};

pub use abi_code::{AbiCode, UnknownAbiCode, RESERVED_UNASSIGNED_CODE};
pub use checkpoint::{CheckpointContradiction, CheckpointDecision, CheckpointOutcome};
pub use host_calls::{FileAccessMode, HostCallError, HostCallErrorCode, HostCalls, ResolvedPath};
pub use host_function_names::{
    HOST_FUNCTION_NAMES, HOST_FUNCTION_SYMBOLS, host_function_name_for_symbol, host_function_symbol,
};
pub use identifiers::{
    EmptyIdentifier, EntryPointNameRejected, OperationId, PluginEntryPoint, PluginId,
};
pub use invocation::{
    CompletionContradiction, PluginInvocationRequest, PluginInvocationResponse, PluginRunResult,
};
pub use operation_status::{OperationPhase, ADR_0066_PLUGIN_VISIBLE_PHASES};
pub use payload::OpaquePayload;
pub use protocol_version::{
    DOCUMENTED_HOST_CONTRACT_VERSION, PLUGIN_ABI_VERSION, PLUGIN_ABI_VERSION_MAJOR,
    PLUGIN_ABI_VERSION_MINOR, PLUGIN_ABI_VERSION_PATCH,
};
pub use run_events::{
    EventIndex, LogEvent, PluginRunEvent, PluginRunEventKind, ProgressEvent, ProgressPercent,
    ProgressValueRejected,
};
pub use run_options::{
    DEFAULT_CAPACITY_WEIGHT, EventRetentionCeiling, ManifestResourceLimits, PluginRunOptions,
    ResourceAdmissionRequest, ResourceClass, ResourcePriority, SchedulerWeightInversion,
    ZeroEventCeiling,
};
pub use tokens::{
    FileHandleToken, PathToken, ResourceLeaseToken, RESERVED_INVALID_TOKEN_VALUE,
};
