//! The host-backed [`TimeuRuntime`]: the Rust form of `createNodeTimeuRuntime`
//! (`platform.ts:5-21`) with the two things a sandbox cannot do for itself left as Xiranite host
//! calls (feature `wasm` only).
//!
//! ADR-0071 moved the six file operations this module used to route through `xiranite.fs.*` into
//! [`crate::std_fs_runtime`], so `stat`, listing, reading, writing, `mkdir` and `utimes` are now
//! `std::fs` calls against the WASI preopens the host grants. That is the whole file half; the two
//! calls below are what remains, and they stay host calls because they are product semantics:
//!
//! | Capability | Request | `data` |
//! | --- | --- | --- |
//! | `xiranite.now` | `{}` | `{"epochMs": number}` |
//! | `xiranite.operation.checkpoint` | nothing | a `u32` verdict code |
//!
//! The clock contract is unchanged and the plugin cannot enforce it: `xiranite.now` must answer the
//! host's wall clock in epoch milliseconds, because `platform.ts:94`'s `new Date()#toISOString()` is
//! what wrote `backedUpAt` into every record file and determinism stays testable only while the
//! plugin never reads a clock itself (`lib.rs` records the same rule for the fake runtime).
//!
//! `xiranite.operation.emit` is not reachable from here: the event stream belongs to
//! [`crate::plugin`], since a progress event is not a runtime question.

use serde_json::{Value, json};

use crate::extism_boundary;
use crate::std_fs_runtime::StdFilesystem;
use crate::timeu_model::{TimeuDirectoryEntry, TimeuPathInfo};
use crate::timeu_runtime::{TimeuCheckpointOutcome, TimeuHostError, TimeuRuntime};

/// The single host runtime instance the plugin hands to the pure core.
#[derive(Debug, Clone, Copy)]
pub struct HostTimeuRuntime {
    filesystem: StdFilesystem,
}

impl HostTimeuRuntime {
    pub fn new() -> Self {
        Self { filesystem: StdFilesystem::new() }
    }
}

impl Default for HostTimeuRuntime {
    fn default() -> Self {
        Self::new()
    }
}

fn millis_field(data: &Value, key: &str) -> Option<f64> {
    data.get(key).and_then(|value| {
        value
            .as_f64()
            .or_else(|| value.as_i64().map(|number| number as f64))
    })
}

impl TimeuRuntime for HostTimeuRuntime {
    fn path_info(&self, path: &str) -> Result<TimeuPathInfo, TimeuHostError> {
        self.filesystem.path_info(path)
    }

    fn list_directory(&self, path: &str) -> Result<Vec<TimeuDirectoryEntry>, TimeuHostError> {
        self.filesystem.list_directory(path)
    }

    fn read_text(&self, path: &str) -> Option<String> {
        self.filesystem.read_text(path)
    }

    fn write_text(&self, path: &str, content: &str) -> Result<(), TimeuHostError> {
        self.filesystem.write_text(path, content)
    }

    fn ensure_directory(&self, path: &str) -> Result<(), TimeuHostError> {
        self.filesystem.ensure_directory(path)
    }

    fn set_times(&self, path: &str, atime_ms: f64, mtime_ms: f64) -> Result<(), TimeuHostError> {
        self.filesystem.set_times(path, atime_ms, mtime_ms)
    }

    fn now_epoch_ms(&self) -> Result<f64, TimeuHostError> {
        let data = extism_boundary::call_host_json(extism_boundary::now_import(), &json!({}))?;
        millis_field(&data, "epochMs").ok_or_else(|| TimeuHostError::new("xiranite.now returned no epochMs"))
    }

    fn checkpoint(&self) -> Result<TimeuCheckpointOutcome, TimeuHostError> {
        Ok(extism_boundary::checkpoint())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_clock_reader_tolerates_both_number_shapes_the_host_may_send() {
        // `epochMs` is an integer in JSON most hosts emit and a fraction everywhere a leap second or
        // a sub-millisecond `st_mtim` leaked through; both have to read as the same instant.
        let data = json!({ "epochMs": 1_767_225_600_000_i64 });
        assert_eq!(millis_field(&data, "epochMs"), Some(1_767_225_600_000.0));
        let fractional = json!({ "epochMs": 1_767_225_600_123.5 });
        assert_eq!(millis_field(&fractional, "epochMs"), Some(1_767_225_600_123.5));
        assert_eq!(millis_field(&json!({ "epochMs": "1767225600000" }), "epochMs"), None);
        assert_eq!(millis_field(&json!({}), "epochMs"), None, "an absent field is a refusal");
    }

    #[test]
    fn host_runtime_constructs_without_a_host_for_type_checks_only() {
        // Calling a host capability here would trap outside a wasm host, so the unit test only pins
        // that the type and its `Default` exist and that the pure path helpers still answer. The file
        // half is real `std::fs` and is covered in `crate::std_fs_runtime`.
        let runtime = HostTimeuRuntime::default();
        assert!(matches!(runtime, HostTimeuRuntime { .. }));
        assert_eq!(runtime.join(&["D:/dir", "timeu-timestamps.json"]), "D:/dir/timeu-timestamps.json");
        assert_eq!(runtime.dirname("D:/dir/a.txt"), "D:/dir");
    }

    #[test]
    fn the_host_runtime_delegates_its_file_half_to_std_fs() {
        // ADR-0071: the file methods no longer cross the boundary, so a `HostTimeuRuntime` asked for a
        // path that exists on the host answers it without a capability call at all. This is the proof
        // that the delegation is real rather than a leftover host import.
        let root = tempfile::tempdir().expect("tempdir");
        let file = root.path().join("a.txt");
        std::fs::write(&file, b"payload").expect("fixture write");

        let info = HostTimeuRuntime::new()
            .path_info(&file.display().to_string())
            .expect("std::fs answers without a capability call");

        assert!(info.exists && info.is_file, "{info:?}");
    }
}
