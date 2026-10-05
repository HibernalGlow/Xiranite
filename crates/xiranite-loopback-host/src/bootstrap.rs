//! The channel document a client is handed at start-up.
//!
//! `src/backend/tauriChannel.ts` is the WebView consumer and its semantics are frozen: it reads
//! `window.__TAURI__.core.invoke` structurally (no `@tauri-apps/api` in the bundle, which is why
//! `tauri.conf.json` sets `app.withGlobalTauri = true`), calls the `xiranite_bootstrap` command by
//! name, and validates the payload rather than trusting it — `baseUrl` must match
//! `^http://(127.0.0.1|localhost)(:\d+)?$`, `token` must be a non-empty string, `instanceId` must be
//! a non-empty string. A partial payload makes the client fall back to "no channel" instead of
//! half-configuring the app, so the field *spellings* here are protocol: `#[serde(rename_all =
//! "camelCase")]` is load-bearing, and a `base_url` key would fail the validator silently.
//!
//! This type is the host's because the same triple is published three ways: as the Tauri command's
//! return value (`crates/xiranite-desktop/src/bootstrap.rs` holds that wrapper and the command name),
//! as the `XIRANITE_CHANNEL` line `xiranite-dev-host` prints, and as a channel file. [`super::channel_document`]
//! and this projection are those two spellings of one contract, kept in the same crate so they cannot
//! drift.

use serde::Serialize;

use crate::HostChannel;

/// The `{ baseUrl, token, instanceId }` triple for *this* host process.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapPayload {
    /// `http://127.0.0.1:{port}` with the port the OS actually handed the listener.
    pub base_url: String,
    /// The per-instance bearer token (ADR-0065).
    pub token: String,
    /// Identifies the host process, so a restarted backend invalidates cached client state.
    pub instance_id: String,
}

impl BootstrapPayload {
    /// Projects the host channel onto the wire shape the WebView validator expects.
    #[must_use]
    pub fn from_channel(channel: &HostChannel) -> Self {
        Self {
            base_url: channel.base_url().to_owned(),
            token: channel.token().to_owned(),
            instance_id: channel.instance_id().to_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::HostChannel;

    fn channel() -> HostChannel {
        HostChannel::new(55_001, "0123abcd".to_owned(), "host-0-loyw3v28".to_owned())
    }

    /// The key spellings are the WebView's contract; snake_case would validate as `undefined` and
    /// the client would report "no usable loopback channel" with nothing to point at.
    #[test]
    fn the_payload_serializes_with_the_webviews_field_names() {
        let value = serde_json::to_value(BootstrapPayload::from_channel(&channel())).unwrap();
        assert_eq!(value["baseUrl"], "http://127.0.0.1:55001");
        assert_eq!(value["token"], "0123abcd");
        assert_eq!(value["instanceId"], "host-0-loyw3v28");
        assert!(value.get("base_url").is_none(), "camelCase is the protocol");
        assert_eq!(value.as_object().map(|object| object.len()), Some(3));
    }

    #[test]
    fn every_field_the_validator_requires_is_populated() {
        let payload = BootstrapPayload::from_channel(&channel());
        assert!(!payload.token.is_empty());
        assert!(!payload.instance_id.is_empty());
        assert_eq!(payload.base_url, channel().base_url());
    }

    /// The channel file and the bootstrap payload are two spellings of one contract, so a key added on
    /// one side has to show up on the other; this pins the three names they share.
    #[test]
    fn the_channel_document_uses_the_payload_key_spellings() {
        let document = crate::channel_document(&channel());
        let payload = serde_json::to_value(BootstrapPayload::from_channel(&channel())).unwrap();
        for key in ["baseUrl", "token", "instanceId"] {
            assert_eq!(document[key], payload[key], "{key} must be spelled identically");
        }
        assert_eq!(payload.as_object().map(|object| object.len()), document.as_object().map(|object| object.len()));
    }
}
