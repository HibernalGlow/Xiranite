//! The host-function surface this plugin uses, as data.
//!
//! This module is the single producer for the things that must agree: the `extern "C"` imports in
//! `crate::plugin`, the `host_functions` array in `manifest.toml` (pinned by
//! `tests/manifest_contract.rs`), and the request and response shapes crossing the boundary. Keeping
//! it feature-free means the agreement is checkable on a normal host target, where the wasm imports
//! themselves cannot be linked.
//!
//! **ADR-0071 closed the capability vocabulary at nine names and retired the whole `xiranite.fs.*`
//! family.** SNF therefore declares no file capability: the host enables WASI on the plugin and
//! preopens the artist/library roots the manifest authorizes, and `crate::std_file_system` reaches
//! them with `std::fs`. What is left here is the three product-semantics calls SNF makes, the entry
//! convention, and the `offset | length` packing the boundary needs to move small JSON documents.
//!
//! The names come from `xiranite_plugin_api::host_function_names`, which is the single source of
//! truth. This module used to keep its own table of capability constants, and that table drifted;
//! importing is the fix, so a rename in the API crate is a compile error here rather than a plugin
//! that traps on its first host call.

use xiranite_plugin_api::host_function_names::{
    HOST_FUNCTION_OPERATION_CHECKPOINT, HOST_FUNCTION_OPERATION_EMIT, HOST_FUNCTION_SCHEDULER_ACQUIRE,
};

/// The three capabilities SNF actually calls, out of ADR-0071's nine.
///
/// `xiranite.operation.checkpoint` is the yield, `xiranite.operation.emit` is the progress stream,
/// and `xiranite.scheduler.acquire` asks for disk admission once before the rename loop. SNF declares
/// nothing else: there is no file capability to declare any more, and the release counterpart of a
/// permit is still the host's to reclaim when the invocation returns (ADR-0066).
pub const PLUGIN_HOST_FUNCTIONS: &[&str] = &[
    HOST_FUNCTION_OPERATION_CHECKPOINT,
    HOST_FUNCTION_OPERATION_EMIT,
    HOST_FUNCTION_SCHEDULER_ACQUIRE,
];

/// What `xiranite.operation.checkpoint` answers.
///
/// Mirrors `crates/xiranite-plugin-api/src/checkpoint.rs` (codes 1/2/3) so the two
/// sides of the boundary agree without this crate depending on a serialization
/// library. ADR-0066's chain — paused operation, waiting checkpoint,
/// released on resume or cancel — only produces `Continue` and `Cancelled`;
/// `Paused` is reportable-but-nonblocking and is treated as "keep going", exactly
/// as the ABI crate documents it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckpointOutcome {
    /// Process the next item.
    Continue,
    /// The operation is paused; reported without holding the call.
    Paused,
    /// Hard stop: do not start another item.
    Cancelled,
}

impl CheckpointOutcome {
    /// The wire code, matching `AbiCode for CheckpointOutcome`.
    #[must_use]
    pub const fn abi_code(self) -> u64 {
        match self {
            Self::Continue => 1,
            Self::Paused => 2,
            Self::Cancelled => 3,
        }
    }

    #[must_use]
    pub const fn from_abi_code(code: u64) -> Self {
        match code {
            2 => Self::Paused,
            3 => Self::Cancelled,
            _ => Self::Continue,
        }
    }

    /// ADR-0066: cancellation is the one answer a plugin must obey immediately.
    #[must_use]
    pub const fn is_hard_stop(self) -> bool {
        matches!(self, Self::Cancelled)
    }
}

/// The exported plugin functions, in `crate::plugin`.
///
/// Names are `id`-prefixed because Extism resolves an exported function by name
/// inside one shared isolate pool, so a bare `run` would collide with every other
/// plugin the host ever loads. `tests/manifest_contract.rs` pins the list against
/// the declarations.
pub const PLUGIN_ENTRY_POINTS: &[&str] = &[
    "snf_run",
    "snf_normalize_input",
    "snf_node_def",
    "snf_node_help",
    "snf_plugin_descriptor",
    "snf_free",
];

/// `offset | length` packing used for every byte argument and result, the Extism
/// convention of one `i64` per block: high 32 bits are the byte length, low 32
/// bits are the linear-memory offset.
///
/// Only valid on `wasm32`, where an offset cannot exceed 32 bits by construction.
/// A host-target build of this crate never calls it: `crate::plugin` gates the whole
/// isolate module behind `#[cfg(target_arch = "wasm32")]`, which is also why
/// `tests/core_cases.rs` runs the core against a fake filesystem instead.
#[must_use]
pub const fn pack_offset_and_length(offset: usize, length: usize) -> u64 {
    ((length as u64) << 32) | (offset as u64 & 0xFFFF_FFFF)
}

/// Inverse of [`pack_offset_and_length`].
#[must_use]
#[allow(clippy::cast_possible_truncation)]
pub const fn unpack_offset_and_length(value: u64) -> (usize, usize) {
    ((value & 0xFFFF_FFFF) as usize, (value >> 32) as usize)
}

/// One `xiranite.scheduler.acquire` request, using the field names of
/// `ResourceTaskRequest` at `packages/contract/src/index.ts:248-258`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceAdmissionRequest {
    /// `"io"`: disk-bound renames contend with the other IO work, the class named
    /// `io` on the wire at `packages/contract/src/index.ts:245`.
    pub resource: String,
    pub kind: String,
    pub priority: String,
    pub weight: u32,
    #[serde(rename = "minimumWeight")]
    pub minimum_weight: u32,
    #[serde(rename = "memoryMiB")]
    pub memory_mib: u32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use xiranite_plugin_api::host_function_names::HOST_FUNCTION_NAMES;

    #[test]
    fn every_declared_function_is_a_settled_capability_name() {
        for name in PLUGIN_HOST_FUNCTIONS {
            assert!(name.starts_with("xiranite."), "{name} left the namespace");
            assert!(
                HOST_FUNCTION_NAMES.contains(name),
                "{name} is not in the ADR-0068 vocabulary as closed by ADR-0071"
            );
        }
    }

    #[test]
    fn the_retired_file_family_never_comes_back() {
        // ADR-0071 replaced `xiranite.fs.*` with `std::fs` on a granted preopen. A tenth capability
        // name here would need an accepted ADR, and a `fs.` name would need an un-retired one.
        for name in PLUGIN_HOST_FUNCTIONS {
            assert!(!name.starts_with("xiranite.fs."), "{name} was retired by ADR-0071");
        }
        assert!(
            PLUGIN_HOST_FUNCTIONS
                .iter()
                .any(|name| *name == HOST_FUNCTION_OPERATION_CHECKPOINT),
            "ADR-0066 requires every run to checkpoint"
        );
    }

    #[test]
    fn entry_point_names_are_prefixed_and_unique() {
        let mut seen: Vec<&str> = Vec::new();
        for name in PLUGIN_ENTRY_POINTS {
            assert!(name.starts_with("snf_"), "{name} is not plugin-scoped");
            assert!(!seen.contains(name), "duplicate entry point {name}");
            seen.push(name);
        }
    }

    #[test]
    fn offset_and_length_round_trip() {
        let value = pack_offset_and_length(0x1234_5678, 0x0000_00FF);
        assert_eq!(unpack_offset_and_length(value), (0x1234_5678, 0xFF));
        assert_eq!(unpack_offset_and_length(0), (0, 0));
    }

    #[test]
    fn checkpoint_codes_match_the_abi_crate() {
        assert_eq!(CheckpointOutcome::Continue.abi_code(), 1);
        assert_eq!(CheckpointOutcome::Paused.abi_code(), 2);
        assert_eq!(CheckpointOutcome::Cancelled.abi_code(), 3);
        assert!(CheckpointOutcome::from_abi_code(3).is_hard_stop());
        assert!(!CheckpointOutcome::from_abi_code(2).is_hard_stop());
        assert!(!CheckpointOutcome::from_abi_code(0).is_hard_stop());
    }
}
