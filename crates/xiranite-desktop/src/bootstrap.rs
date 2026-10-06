//! The one Tauri command the WebView needs: `xiranite_bootstrap`.
//!
//! `src/backend/tauriChannel.ts` is the consumer and its semantics are frozen: it reads
//! `window.__TAURI__.core.invoke` structurally (no `@tauri-apps/api` in the bundle, which is why
//! `tauri.conf.json` sets `app.withGlobalTauri = true`), calls the command by the exact name below,
//! and validates the payload rather than trusting it — `baseUrl` must match
//! `^http://(127.0.0.1|localhost)(:\d+)?$`, `token` must be a non-empty string, `instanceId` must be
//! a non-empty string. A partial payload makes the client fall back to "no channel" instead of
//! half-configuring the app, so the field *spellings* here are protocol: `#[serde(rename_all =
//! "camelCase")]` is load-bearing, and a `base_url` key would fail the validator silently.
//!
//! The payload is produced by [`BootstrapPayload::from_channel`], the same function the headless
//! test asserts on, so the command cannot drift from what the test proved.

use serde::Serialize;

use crate::HostChannel;

/// The command name, spelled exactly as `src/backend/tauriChannel.ts:16` requests it.
pub const BOOTSTRAP_COMMAND_NAME: &str = "xiranite_bootstrap";

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

/// Tauri-managed state holding the channel published at startup.
///
/// Wrapped because `HostChannel` is the library's type and Tauri's `State` is keyed by the concrete
/// type it manages: a newtype keeps the command's dependency on the host obvious and leaves
/// `HostChannel` free to be used headlessly.
#[derive(Debug, Clone)]
pub struct BootstrapState {
    channel: HostChannel,
}

impl BootstrapState {
    /// Wraps the channel [`super::start_backend`] published.
    #[must_use]
    pub const fn new(channel: HostChannel) -> Self {
        Self { channel }
    }

    /// The channel this host serves.
    #[must_use]
    pub const fn channel(&self) -> &HostChannel {
        &self.channel
    }
}

/// The desktop half of ADR-0065: the port is never hardcoded, the token never ships in a bundle, and
/// a second window or a restarted host is detected through `instanceId`.
#[tauri::command]
pub fn xiranite_bootstrap(state: tauri::State<'_, BootstrapState>) -> BootstrapPayload {
    BootstrapPayload::from_channel(state.channel())
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
