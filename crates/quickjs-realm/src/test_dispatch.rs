//! A `HostDispatch` double for the realm's own unit tests.
//!
//! Deliberately op-level: the realm's job is to turn a wire name into a call on the dispatch and a refusal
//! into a thrown `Error`, so these tests assert *that*. The mapping from an operation to a host capability
//! (`fs.readText` to `read_text`, `proc.exec` to the allowlist gate) is the embedding host's code and is
//! pinned there — `crates/xiranite-quickjs-executor/src/host_calls.rs` tests and the `spikes/*-realm-probe/`
//! fixtures run against the real `NativeNodeHost`.
//!
//! Kept boring on purpose: cancel behaviour under a real operation is already pinned by
//! `crates/xiranite-native-host/tests/native_node_host.rs`, so what these tests need is a dispatch that
//! records that a call landed and can start cancelling from a chosen checkpoint.

use serde_json::json;
use quickjs_host_protocol::{HostAnswer, HostOperation, HostRefusal, answer};

use crate::wire::HostDispatch;

/// The clock answer every scripted run gets, so a test can assert on it literally.
pub(crate) const SCRIPTED_NOW: &str = "2023-11-14T22:13:20.000Z";

/// Records calls, answers from data, and starts cancelling at a chosen checkpoint.
pub(crate) struct CountingDispatch {
    /// Every call, in order, as `<wire name> <arguments>`.
    pub(crate) calls: Vec<String>,
    /// `Some(path)` makes that path's `fs.readText` answer nothing and its `fs.stat` answer missing.
    pub(crate) missing_path: Option<String>,
    /// Which checkpoint starts answering cancelled; `None` never cancels. Stated as data: a dispatch that
    /// cancels by accident makes "the run finished" unprovable.
    pub(crate) cancel_at: Option<usize>,
    checkpoints: usize,
}

impl CountingDispatch {
    #[must_use]
    pub(crate) fn new() -> Self {
        Self { calls: Vec::new(), missing_path: None, cancel_at: None, checkpoints: 0 }
    }

    fn note(&mut self, call: String) {
        self.calls.push(call);
    }
}

impl Default for CountingDispatch {
    fn default() -> Self {
        Self::new()
    }
}

impl HostDispatch for CountingDispatch {
    fn execute(
        &mut self,
        operation: HostOperation,
        arguments: &str,
        _payload: Option<&[u8]>,
    ) -> Result<HostAnswer, HostRefusal> {
        let arguments = arguments.trim();
        self.note(if arguments.is_empty() {
            operation.as_str().to_string()
        } else {
            format!("{} {arguments}", operation.as_str())
        });
        let parsed: serde_json::Value = if arguments.is_empty() {
            json!({})
        } else {
            serde_json::from_str(arguments)
                .map_err(|error| HostRefusal::failure(format!("fake cannot read arguments: {error}")))?
        };
        let path = parsed.get("path").and_then(serde_json::Value::as_str).unwrap_or_default();
        match operation {
            // The real host answers `clock.now` with a bare JSON string, not an object: `execute`
            // wraps `host.now()` straight into `answer(json!(...))`. A double that invented its own
            // envelope would let a bundle pass here and fail against the real host.
            HostOperation::ClockNow => Ok(answer(json!(SCRIPTED_NOW))),
            HostOperation::ReadText => {
                if self.missing_path.as_deref() == Some(path) {
                    return Ok(answer(json!(null)));
                }
                Ok(answer(json!({ "path": path, "content": format!("body of {path}") })))
            }
            HostOperation::WriteText => Ok(answer(json!({ "path": path, "written": true }))),
            HostOperation::Stat => Ok(answer(json!({
                "path": path,
                "exists": self.missing_path.as_deref() != Some(path),
                "isFile": !path.ends_with('/'),
                "isDirectory": path.ends_with('/'),
            }))),
            HostOperation::List => {
                if self.missing_path.as_deref() == Some(path) {
                    return Err(HostRefusal::failure(format!("permission denied: {path}")));
                }
                Ok(answer(json!({ "entries": [{ "name": "a.txt", "path": format!("{path}/a.txt"), "isFile": true, "isDirectory": false }] })))
            }
            other => Err(HostRefusal::failure(format!("the fake dispatch does not answer {other:?}"))),
        }
    }

    fn checkpoint(&mut self, phase: &'static str) -> Result<(), HostRefusal> {
        self.checkpoints += 1;
        self.note(format!("checkpoint {phase}"));
        if self.cancel_at.is_some_and(|number| self.checkpoints >= number) {
            return Err(HostRefusal::Cancelled);
        }
        Ok(())
    }

    fn emit_event(&mut self, event_json: &str) -> Result<(), HostRefusal> {
        self.note(format!("emit {event_json}"));
        Ok(())
    }
}
