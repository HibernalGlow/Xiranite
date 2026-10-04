//! Opaque boundary payloads.
//!
//! This crate deliberately has no serialization dependency, so it cannot promise
//! a JSON encoding. What it does promise is smaller and is the part both sides
//! need: the bytes crossing the boundary are the *same JSON documents* the
//! TypeScript contract already defines, carried as bytes rather than as a Rust
//! type tree.
//!
//! Concretely, an [`OpaquePayload`] holds:
//!
//! - `nodeRunRequestSchema.input` for a plugin invocation input,
//! - `nodeRunEventSchema.data` for a structured progress event,
//! - `nodeRunResultSchema.data` and `nodeRunResultSchema.stats` for a result,
//!
//! all from `packages/shared/src/index.ts`. Encoding and decoding those documents
//! belongs to `crates/xiranite-plugins` (host) and to each plugin's shim, where
//! serde can be a dependency without burdening every plugin's link size.
//!
//! Payloads stay byte-oriented because ADR-0063 principle 9 and ADR-0066 both
//! refuse to make Extism an expensive serialization layer: anything bulk goes
//! through a path or handle token instead, so what is left in here is small
//! structured metadata.

use std::fmt;
use std::str;

/// A boundary payload this crate does not interpret.
#[derive(Clone, PartialEq, Eq, Default, Hash)]
pub struct OpaquePayload(Vec<u8>);

impl OpaquePayload {
    /// No payload. Distinguished from `Some(empty)` only by the caller's intent.
    pub fn empty() -> Self {
        Self(Vec::new())
    }

    /// Takes bytes exactly as they arrived; no validation, no decoding.
    pub fn from_bytes(bytes: impl Into<Vec<u8>>) -> Self {
        Self(bytes.into())
    }

    /// UTF-8 text payload, the common case for a JSON document.
    pub fn from_text(text: &str) -> Self {
        Self(text.as_bytes().to_vec())
    }

    /// Borrows the raw bytes for a shim that encodes them itself.
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }

    /// Gives ownership of the bytes to a shim that consumes them.
    pub fn into_bytes(self) -> Vec<u8> {
        self.0
    }

    /// Decodes as UTF-8 without copying, or reports the payload as non-text —
    /// which is the signal that it should have been a token, not a payload.
    pub fn as_text(&self) -> Option<&str> {
        str::from_utf8(&self.0).ok()
    }

    /// Byte length, the unit the event-buffer ceilings are counted in.
    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// Whether the payload carries nothing.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl fmt::Debug for OpaquePayload {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Never the bytes: payloads reach history rows, monitors and panic
        // reports, and an encoded input can hold user paths and text.
        formatter
            .debug_struct("OpaquePayload")
            .field("byte_len", &self.0.len())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_round_trips_bytes() {
        let payload = OpaquePayload::from_text(r#"{"folders":["D:/in"]}"#);
        assert_eq!(payload.as_text(), Some(r#"{"folders":["D:/in"]}"#));
        assert_eq!(payload.len(), r#"{"folders":["D:/in"]}"#.len());
        assert_eq!(
            OpaquePayload::from_bytes(payload.clone().into_bytes()),
            payload
        );
    }

    #[test]
    fn non_utf8_payload_is_visible_without_being_decoded() {
        let payload = OpaquePayload::from_bytes([0xff, 0xfe]);
        assert_eq!(payload.as_text(), None);
        assert_eq!(payload.as_bytes(), &[0xff, 0xfe]);
    }

    #[test]
    fn debug_reports_only_the_size() {
        let payload = OpaquePayload::from_text("D:/private/inbox/report.txt");
        let rendered = format!("{payload:?}");
        assert!(rendered.starts_with("OpaquePayload"), "{rendered}");
        assert!(rendered.contains("byte_len"), "{rendered}");
        assert!(!rendered.contains("private"), "{rendered} leaked the payload");
        assert!(OpaquePayload::empty().is_empty());
    }
}
