//! The envelope: how an answer and a refusal travel between the realm and its host.
//!
//! Two rules, and they are the whole file:
//!
//! - **Text answers are JSON, byte answers are bytes.** A buffer never rides inside a JSON document — the
//!   failure mode the wasm/base64 era recorded and ADR-0074 §4 restates. Which operations are which is
//!   part of the vocabulary ([`crate::HostOperation::takes_payload`] /
//!   [`crate::HostOperation::answers_bytes`]), not a detail of one arm.
//! - **Refusals are data.** [`HostRefusal`] is a value the realm turns into a thrown `Error`, and a cancel
//!   is a distinct variant so no script can swallow it.

use serde_json::{Map, Value};

/// One operation's answer, in the shape it crosses in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostAnswer {
    /// A JSON document, the shape every text operation answers.
    Text(String),
    /// A buffer, or `None` for "nothing is there to read". Only [`crate::HostOperation::ReadBytes`]
    /// answers this, and it becomes a `Uint8Array` (or `null`) in the realm rather than a string
    /// somewhere inside JSON.
    Bytes(Option<Vec<u8>>),
}

/// Why a call did not answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostRefusal {
    /// The host refused or the machine failed; the message is what the node would have shown.
    Failure(String),
    /// The owning operation is cancelled. Every operation can answer this and a bundle must not be able
    /// to swallow it — the run stops.
    Cancelled,
}

impl HostRefusal {
    /// A refusal in the caller's words.
    ///
    /// Embedding crates map their own error type into this one (`NodeHostError`, a capability refusal, …)
    /// instead of the protocol learning about them: the message is the node's, and that is all the realm
    /// is allowed to see.
    #[must_use]
    pub fn failure(message: impl Into<String>) -> Self {
        Self::Failure(message.into())
    }

    /// The message thrown into JS.
    #[must_use]
    pub fn message(&self) -> &str {
        match self {
            Self::Failure(message) => message,
            Self::Cancelled => crate::CANCELLED_MESSAGE,
        }
    }
}

/// A JSON document answer, serialized the one way the protocol says.
#[must_use]
pub fn answer(value: Value) -> HostAnswer {
    HostAnswer::Text(serialize(&value))
}

/// Parses a call's argument text; empty means "no arguments", and anything malformed is a refusal.
pub fn parse_arguments(raw: &str) -> Result<Value, HostRefusal> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    serde_json::from_str(trimmed)
        .map_err(|error| HostRefusal::failure(format!("host call arguments are not JSON: {error}")))
}

/// One required non-empty string field, named in the refusal.
pub fn required_text<'a>(arguments: &'a Value, key: &str) -> Result<&'a str, HostRefusal> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| HostRefusal::failure(format!("host call needs a non-empty string `{key}`")))
}

/// The `path` argument every file operation is keyed on.
pub fn required_path(arguments: &Value) -> Result<&str, HostRefusal> {
    required_text(arguments, "path")
}

#[must_use]
pub fn serialize(value: &Value) -> String {
    match serde_json::to_string(value) {
        Ok(text) => text,
        // A `Value` built by a host arm is always serializable, so this arm means a bug rather than a
        // machine condition — and it still has to answer JSON, because the shim parses.
        Err(_) => r#"{"serializeError":"the host answer could not be encoded"}"#.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_argument_text_is_an_empty_object_not_a_failure() {
        // The shim sends `""` for a call with no arguments; refusing it would make every zero-arg
        // operation (`os.tmpdir`) need a special case in the realm.
        assert_eq!(parse_arguments("   ").unwrap(), Value::Object(Map::new()));
        assert!(parse_arguments("{not json").is_err());
    }

    #[test]
    fn a_blank_field_is_refused_by_name_and_a_cancel_keeps_one_spelling() {
        let arguments: Value = serde_json::from_str(r#"{"path":"  ","content":"x"}"#).unwrap();
        let error = required_path(&arguments).expect_err("a blank path is not a path");
        assert!(error.message().contains("path"), "{error:?}");
        assert_eq!(HostRefusal::Cancelled.message(), crate::CANCELLED_MESSAGE);
    }
}
