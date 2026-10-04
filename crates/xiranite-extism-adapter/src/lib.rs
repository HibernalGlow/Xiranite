//! The Extism adapter (ADR-0068 layer 2): installs a node's `<id>.wasm`, registers the `xiranite.*`
//! capabilities as Extism host functions, and calls the plugin's entry point.
//!
//! This is the only crate in the rewrite that may name Extism mechanisms — block handles, the
//! `extism:host/user` namespace, the manifest memory ceiling, the zero-parameter entry convention.
//! `crates/xiranite-node-runtime` and every face (the Tauri host, each node CLI, each node TUI) talk
//! to it through [`CapabilityHost`] plus JSON documents, so replacing this adapter with a WIT
//! Component Model adapter must not reshape them.

mod capabilities;
mod compiled;

pub use capabilities::{CapabilityAnswer, CapabilityHost, CapabilityRefusal, accepted_document};
pub use compiled::{AdapterError, CompiledNode, PluginSetup};

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::{CapabilityRefusal, accepted_document};

    #[test]
    fn an_accepted_answer_is_the_envelope_the_shim_decodes() {
        let document: Value =
            serde_json::from_str(&accepted_document(json!({ "exists": true }))).expect("encode");
        assert_eq!(document["ok"], Value::Bool(true));
        assert_eq!(document["data"], json!({ "exists": true }));
        assert_eq!(
            accepted_document(Value::Null),
            // `serde_json`'s default map is a `BTreeMap`, so the two keys sort; a shim decodes by
            // field name and must never compare these documents as text.
            r#"{"data":null,"ok":true}"#
        );
    }

    #[test]
    fn a_refusal_is_data_with_the_three_plugin_error_fields() {
        let refusal = CapabilityRefusal::new("permission_denied", "outside the authorized roots");
        let document: Value =
            serde_json::from_str(&refusal.to_document()).expect("a refusal must encode as JSON");
        assert_eq!(document["ok"], Value::Bool(false));
        assert_eq!(document["error"]["code"], "permission_denied");
        assert_eq!(document["error"]["message"], "outside the authorized roots");
        assert!(
            document["error"].get("details").is_none(),
            "details is optional: an absent one must not appear as null"
        );

        let detailed =
            CapabilityRefusal { code: "text_too_large".into(), message: "too big".into(), details: Some(json!({ "limit": 4 })
            ) };
        let document: Value = serde_json::from_str(&detailed.to_document()).expect("encode");
        assert_eq!(document["error"]["details"]["limit"], 4);
    }

    #[test]
    fn a_refusal_is_not_a_trap() {
        // The point of ADR-0068's envelope: one locked path fails that item, not the operation.
        let refusal = CapabilityRefusal::new("not_found", "no such path");
        let document: Value = serde_json::from_str(&refusal.to_document()).expect("encode");
        assert_eq!(document["ok"], Value::Bool(false), "the plugin reads a status field, never a wasm trap");
    }
}
