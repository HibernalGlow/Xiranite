//! The capability surface the host serves into a running plugin.
//!
//! ADR-0068 splits the layering: plugin API vocabulary → this adapter → `plugin.wasm`. The adapter
//! knows about blocks and namespaces; it does not know what a rename plan is. So the host side is one
//! method that takes a settled capability name plus the request document, and answers with a data
//! document or a typed refusal.

use serde_json::Value;

/// Why a capability refused, in the shape ADR-0068 requires: a code, a message and optional details.
///
/// A refusal is data. If it were a wasm trap, one locked folder would abort an entire operation the
/// way a thrown `rename` used to be caught per queue item in the TypeScript (`core.ts:177-182`).
#[derive(Debug, Clone, PartialEq)]
pub struct CapabilityRefusal {
    /// The stable machine code the plugin switches on.
    pub code: String,
    /// The human-readable cause, carried into the operation's event stream.
    pub message: String,
    /// Extra structured context, `PluginError.details`.
    pub details: Option<Value>,
}

impl CapabilityRefusal {
    /// A refusal with no details.
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into(), details: None }
    }

    /// The `{ "ok": false, "error": { … } }` document the plugin reads.
    #[must_use]
    pub fn to_document(&self) -> String {
        let mut error = serde_json::Map::new();
        error.insert("code".to_string(), Value::String(self.code.clone()));
        error.insert("message".to_string(), Value::String(self.message.clone()));
        if let Some(details) = &self.details {
            error.insert("details".to_string(), details.clone());
        }
        let mut envelope = serde_json::Map::new();
        envelope.insert("ok".to_string(), Value::Bool(false));
        envelope.insert("error".to_string(), Value::Object(error));
        Value::Object(envelope).to_string()
    }
}

/// What a capability answered successfully.
#[must_use]
pub fn accepted_document(data: Value) -> String {
    let mut envelope = serde_json::Map::new();
    envelope.insert("ok".to_string(), Value::Bool(true));
    envelope.insert("data".to_string(), data);
    Value::Object(envelope).to_string()
}

/// What a capability answered.
///
/// The two variants exist because the settled vocabulary is not uniform on the wasm side: a batch
/// plugin calls `xiranite.operation.checkpoint` once per item (ADR-0066), so its three-valued answer
/// crosses as the ABI code itself rather than as a block that both sides would have to allocate and
/// free per item. Everything else answers with a data document.
#[derive(Debug, Clone, PartialEq)]
pub enum CapabilityAnswer {
    /// A JSON data document, wrapped by the adapter in `{ "ok": true, "data": … }` and returned as a
    /// block handle.
    Document(Value),
    /// A fixed-width integer, returned as the import's result value.
    Code(u64),
}

/// The host half of one plugin call.
///
/// One implementor exists per operation run: it closes over the operation's control handle, its
/// authorization grant and its event sink. It is handed to the adapter per call rather than captured
/// at compile time, which is what keeps one compiled plugin serving many operations (ADR-0068).
pub trait CapabilityHost: Send + Sync + 'static {
    /// Serves one settled capability call.
    ///
    /// `name` is the logical manifest name (`xiranite.fs.stat`), never the flattened import symbol,
    /// so an unknown capability is a programming error rather than a string mismatch inside the host.
    /// `request` is the JSON document the plugin wrote into its own block.
    ///
    /// Implementations must not block on a tokio await: this runs on the calling thread inside a wasm
    /// frame (ADR-0066 implements pause as a wait inside `xiranite.operation.checkpoint`).
    fn capability(&self, name: &str, request: &str) -> Result<CapabilityAnswer, CapabilityRefusal>;
}
