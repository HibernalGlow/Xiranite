//! The one Tauri command the WebView needs: `xiranite_bootstrap`.
//!
//! The payload it returns is the loopback host's [`BootstrapPayload`], projected from the
//! [`HostChannel`] that [`xiranite_loopback_host::start_backend`] published. What lives here is only
//! the Tauri-specific part: the command *name* the WebView spells, and the managed state that carries
//! the channel into the command.
//!
//! `src/backend/tauriChannel.ts` is the consumer and its semantics are frozen: it reads
//! `window.__TAURI__.core.invoke` structurally (no `@tauri-apps/api` in the bundle, which is why
//! `tauri.conf.json` sets `app.withGlobalTauri = true`) and calls the command by the exact name below.
//! The payload's field spellings and the validator's non-empty rules are asserted in the host crate,
//! next to the type that produces them, so the command cannot drift from what the headless test proved.

use xiranite_loopback_host::{BootstrapPayload, HostChannel};

/// The command name, spelled exactly as `src/backend/tauriChannel.ts:16` requests it.
pub const BOOTSTRAP_COMMAND_NAME: &str = "xiranite_bootstrap";

/// Tauri-managed state holding the channel published at startup.
///
/// Wrapped because `HostChannel` is the host's type and Tauri's `State` is keyed by the concrete
/// type it manages: a newtype keeps the command's dependency on the host obvious and leaves
/// `HostChannel` free to be used headlessly.
#[derive(Debug, Clone)]
pub struct BootstrapState {
    channel: HostChannel,
}

impl BootstrapState {
    /// Wraps the channel [`xiranite_loopback_host::start_backend`] published.
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

    /// Tauri derives the runtime command name from the *function* name, while the WebView spells the
    /// constant; a rename on either side silently leaves the client with no channel, so both spellings
    /// are pinned to each other here.
    #[test]
    fn the_command_name_matches_the_function_the_handler_registers() {
        assert_eq!(stringify!(xiranite_bootstrap), BOOTSTRAP_COMMAND_NAME);
    }

    /// The state must hand back the exact channel the host published — re-projecting or defaulting it
    /// here is how a window host and a headless host start answering different ports.
    #[test]
    fn managed_state_hands_back_the_published_channel_untouched() {
        let channel = HostChannel::new(55_001, "0123abcd".to_owned(), "host-0-loyw3v28".to_owned());
        let state = BootstrapState::new(channel.clone());
        assert_eq!(state.channel(), &channel);
        assert_eq!(BootstrapPayload::from_channel(state.channel()).base_url, "http://127.0.0.1:55001");
    }
}
