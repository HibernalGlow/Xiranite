//! Run options carried into one plugin invocation.
//!
//! Three sources meet here and the split is deliberate:
//!
//! - `nodeRunRequestSchema.context` supplies the component and workspace scope
//!   that history rows and file-operation journals are keyed on today;
//! - ADR-0066 keeps permissions in the Extism manifest (`allowed_paths`,
//!   `allowed_hosts`, `memory`, `timeout`), of which only the numeric ceilings the
//!   plugin is allowed to know about travel inside the ABI. The path and host
//!   allow-lists stay host-side: a plugin must not be able to enumerate them;
//! - ADR-0063's replacement for the old JavaScript memory guard is the manifest
//!   memory limit plus operation-manager event-count and event-buffer ceilings,
//!   so the ceilings are part of the call, not a host-private constant.

use std::fmt;

use crate::abi_code::{AbiCode, UnknownAbiCode};
use crate::identifiers::{OperationId, PluginEntryPoint, PluginId};

/// How many events an operation keeps in memory once the stream dropped older
/// ones. Mirrors `maxRetainedEvents` and the stream queue ceiling.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EventRetentionCeiling {
    max_retained_events: u32,
    max_retained_bytes: u64,
}

impl EventRetentionCeiling {
    /// `DEFAULT_NODE_MEMORY_PROTECTION_SETTINGS.defaultPolicy.maxRetainedEvents`.
    pub const DEFAULT_MAX_RETAINED_EVENTS: u32 = 1_000;
    /// `NODE_STREAM_MAX_PENDING_BYTES` in `packages/api/src/index.ts`.
    pub const DEFAULT_MAX_RETAINED_BYTES: u64 = 2 * 1024 * 1024;

    /// Builds a ceiling. A zero in either dimension would silently drop every
    /// event, so it is rejected instead of accepted as "keep nothing".
    pub const fn try_new(
        max_retained_events: u32,
        max_retained_bytes: u64,
    ) -> Result<Self, ZeroEventCeiling> {
        if max_retained_events == 0 {
            return Err(ZeroEventCeiling::Events);
        }
        if max_retained_bytes == 0 {
            return Err(ZeroEventCeiling::Bytes);
        }
        Ok(Self {
            max_retained_events,
            max_retained_bytes,
        })
    }

    /// Maximum events retained per operation.
    pub const fn max_retained_events(self) -> u32 {
        self.max_retained_events
    }

    /// Maximum retained payload bytes per operation.
    pub const fn max_retained_bytes(self) -> u64 {
        self.max_retained_bytes
    }
}

impl Default for EventRetentionCeiling {
    fn default() -> Self {
        Self {
            max_retained_events: Self::DEFAULT_MAX_RETAINED_EVENTS,
            max_retained_bytes: Self::DEFAULT_MAX_RETAINED_BYTES,
        }
    }
}

/// A retention ceiling was given as zero.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ZeroEventCeiling {
    /// The event-count ceiling was zero.
    Events,
    /// The byte ceiling was zero.
    Bytes,
}

impl fmt::Display for ZeroEventCeiling {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let dimension = match self {
            Self::Events => "event count",
            Self::Bytes => "event bytes",
        };
        write!(formatter, "{dimension} ceiling must be greater than zero")
    }
}

impl std::error::Error for ZeroEventCeiling {}

/// Manifest ceilings ADR-0066 says bound a plugin call.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ManifestResourceLimits {
    /// `memory` from the Extism manifest, in bytes.
    pub memory_limit_bytes: Option<u64>,
    /// `timeout` from the Extism manifest, in milliseconds.
    pub wall_clock_timeout_ms: Option<u64>,
}

impl ManifestResourceLimits {
    /// A host that has not read manifest limits yet; the plugin still cannot
    /// exceed what the manifest enforces.
    pub const fn unbounded() -> Self {
        Self {
            memory_limit_bytes: None,
            wall_clock_timeout_ms: None,
        }
    }
}

/// Which admission pool a plugin step needs, from `ResourceClass` in
/// `packages/contract/src/index.ts` as re-expressed by ADR-0063 (CPU, GPU, disk,
/// network behind Tokio semaphores).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ResourceClass {
    /// CPU-bound work.
    Cpu,
    /// Disk or other IO-bound work; named `io` on the wire today.
    Io,
    /// GPU-bound work.
    Gpu,
}

impl ResourceClass {
    /// Every class in wire order.
    pub const ALL: &'static [Self] = &[Self::Cpu, Self::Io, Self::Gpu];

    /// The `ResourceClass` string used by the existing scheduler contract.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Cpu => "cpu",
            Self::Io => "io",
            Self::Gpu => "gpu",
        }
    }
}

impl AbiCode for ResourceClass {
    fn abi_code(self) -> u8 {
        match self {
            Self::Cpu => 1,
            Self::Io => 2,
            Self::Gpu => 3,
        }
    }

    fn try_from_abi_code(code: u8) -> Result<Self, UnknownAbiCode> {
        match code {
            1 => Ok(Self::Cpu),
            2 => Ok(Self::Io),
            3 => Ok(Self::Gpu),
            other => Err(UnknownAbiCode::new(other)),
        }
    }
}

/// Admission priority, from `ResourcePriority` in the existing contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ResourcePriority {
    /// A user is waiting on this step.
    Interactive,
    /// A view or preview needs it.
    View,
    /// Ahead of background work, behind views.
    Ahead,
    /// Batch work that may wait indefinitely.
    Background,
}

impl ResourcePriority {
    /// Every priority in wire order.
    pub const ALL: &'static [Self] = &[
        Self::Interactive,
        Self::View,
        Self::Ahead,
        Self::Background,
    ];

    /// The `ResourcePriority` string used by the existing scheduler contract.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Interactive => "interactive",
            Self::View => "view",
            Self::Ahead => "ahead",
            Self::Background => "background",
        }
    }
}

impl AbiCode for ResourcePriority {
    fn abi_code(self) -> u8 {
        match self {
            Self::Interactive => 1,
            Self::View => 2,
            Self::Ahead => 3,
            Self::Background => 4,
        }
    }

    fn try_from_abi_code(code: u8) -> Result<Self, UnknownAbiCode> {
        match code {
            1 => Ok(Self::Interactive),
            2 => Ok(Self::View),
            3 => Ok(Self::Ahead),
            4 => Ok(Self::Background),
            other => Err(UnknownAbiCode::new(other)),
        }
    }
}

/// One `xiranite.scheduler.acquire` request, mirroring `ResourceTaskRequest`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceAdmissionRequest {
    /// Which pool the step contends for.
    pub resource: ResourceClass,
    /// What kind of step this is, for scheduler diagnostics.
    pub kind: String,
    /// Queue position class.
    pub priority: ResourcePriority,
    /// Owner key the scheduler attributes the grant to.
    pub owner_id: Option<String>,
    /// Maximum capacity units the step can use.
    pub weight: u32,
    /// Minimum capacity units required to start.
    pub minimum_weight: u32,
    /// Resident memory held while the permit is owned, in MiB.
    pub memory_mib: Option<u32>,
}

/// The default `weight`, per `ResourceTaskRequest`'s documented default.
pub const DEFAULT_CAPACITY_WEIGHT: u32 = 1;

/// A request whose minimum could never be satisfied by its own weight.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SchedulerWeightInversion {
    /// The weight the request offered.
    pub weight: u32,
    /// The minimum the request demanded.
    pub minimum_weight: u32,
}

impl fmt::Display for SchedulerWeightInversion {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "scheduler request needs {} capacity units but only offers {}",
            self.minimum_weight, self.weight
        )
    }
}

impl std::error::Error for SchedulerWeightInversion {}

impl ResourceAdmissionRequest {
    /// Builds a request with the documented weight defaults, so
    /// `minimum_weight > weight` cannot be constructed by accident.
    pub fn new(
        resource: ResourceClass,
        kind: impl Into<String>,
        priority: ResourcePriority,
    ) -> Result<Self, SchedulerWeightInversion> {
        Self::with_weights(resource, kind, priority, DEFAULT_CAPACITY_WEIGHT, DEFAULT_CAPACITY_WEIGHT)
    }

    /// Builds a request with explicit weights.
    pub fn with_weights(
        resource: ResourceClass,
        kind: impl Into<String>,
        priority: ResourcePriority,
        weight: u32,
        minimum_weight: u32,
    ) -> Result<Self, SchedulerWeightInversion> {
        if minimum_weight > weight {
            return Err(SchedulerWeightInversion {
                weight,
                minimum_weight,
            });
        }
        Ok(Self {
            resource,
            kind: kind.into(),
            memory_mib: None,
            priority,
            owner_id: None,
            weight,
            minimum_weight,
        })
    }
}

/// Everything the host hands a plugin entry point about this run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginRunOptions {
    /// Operation this invocation belongs to; checkpoint and emit are scoped to it.
    pub operation_id: OperationId,
    /// Plugin being called.
    pub plugin_id: PluginId,
    /// Exported function being called.
    pub entry_point: PluginEntryPoint,
    /// `context.componentId` from today's run request.
    pub component_id: Option<String>,
    /// `context.workspaceId` from today's run request.
    pub workspace_id: Option<String>,
    /// Event-count and event-buffer ceilings for this operation.
    pub event_retention: EventRetentionCeiling,
    /// Manifest memory and timeout ceilings.
    pub manifest_limits: ManifestResourceLimits,
    /// Admission request the host applies on the plugin's behalf before the call,
    /// when the plugin declares one.
    pub scheduler_request: Option<ResourceAdmissionRequest>,
}

impl PluginRunOptions {
    /// Options with the current protocol defaults and no scheduler request.
    pub fn new(
        operation_id: OperationId,
        plugin_id: PluginId,
        entry_point: PluginEntryPoint,
    ) -> Self {
        Self {
            operation_id,
            plugin_id,
            entry_point,
            component_id: None,
            workspace_id: None,
            event_retention: EventRetentionCeiling::default(),
            manifest_limits: ManifestResourceLimits::unbounded(),
            scheduler_request: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::abi_code::assert_codes_round_trip;

    fn operation_id() -> OperationId {
        OperationId::try_new("op-test").expect("test operation id")
    }

    #[test]
    fn resource_codes_round_trip_and_keep_scheduler_names() {
        assert_codes_round_trip(ResourceClass::ALL);
        assert_codes_round_trip(ResourcePriority::ALL);
        let classes: Vec<&str> = ResourceClass::ALL
            .iter()
            .map(|class| class.as_str())
            .collect();
        assert_eq!(classes, vec!["cpu", "io", "gpu"]);
        let priorities: Vec<&str> = ResourcePriority::ALL
            .iter()
            .map(|priority| priority.as_str())
            .collect();
        assert_eq!(
            priorities,
            vec!["interactive", "view", "ahead", "background"]
        );
    }

    #[test]
    fn retention_ceiling_rejects_zero_because_it_would_drop_everything() {
        assert_eq!(
            EventRetentionCeiling::try_new(0, 1024),
            Err(ZeroEventCeiling::Events)
        );
        assert_eq!(
            EventRetentionCeiling::try_new(10, 0),
            Err(ZeroEventCeiling::Bytes)
        );
        let ceiling = EventRetentionCeiling::try_new(10, 1024).expect("valid ceiling");
        assert_eq!(ceiling.max_retained_events(), 10);
        assert_eq!(ceiling.max_retained_bytes(), 1024);
        assert_eq!(
            EventRetentionCeiling::default(),
            EventRetentionCeiling::try_new(1_000, 2 * 1024 * 1024).expect("defaults")
        );
    }

    #[test]
    fn admission_weights_cannot_invert() {
        let request = ResourceAdmissionRequest::new(
            ResourceClass::Cpu,
            "hashing",
            ResourcePriority::Background,
        )
        .expect("default weights");
        assert_eq!(request.weight, DEFAULT_CAPACITY_WEIGHT);
        assert_eq!(request.minimum_weight, DEFAULT_CAPACITY_WEIGHT);
        assert_eq!(request.owner_id, None);

        assert_eq!(
            ResourceAdmissionRequest::with_weights(
                ResourceClass::Io,
                "thumbnailing",
                ResourcePriority::View,
                2,
                4
            ),
            Err(SchedulerWeightInversion {
                weight: 2,
                minimum_weight: 4
            })
        );
        let widened = ResourceAdmissionRequest::with_weights(
            ResourceClass::Gpu,
            "decode",
            ResourcePriority::Interactive,
            4,
            2,
        )
        .expect("minimum below weight is grantable");
        assert_eq!(widened.minimum_weight, 2);
    }

    #[test]
    fn run_options_default_to_the_current_protocol_numbers() {
        let options = PluginRunOptions::new(
            operation_id(),
            PluginId::try_new("enginev").expect("plugin id"),
            PluginEntryPoint::try_new("run").expect("entry point"),
        );
        assert_eq!(options.operation_id.as_str(), "op-test");
        assert_eq!(options.component_id, None);
        assert_eq!(options.manifest_limits, ManifestResourceLimits::unbounded());
        assert_eq!(
            options.event_retention,
            EventRetentionCeiling::default()
        );
        assert!(options.scheduler_request.is_none());
    }
}
