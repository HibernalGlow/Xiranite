//! The Xiranite desktop host: one Tauri 2 shell that starts the Rust Axum backend in-process,
//! listens on `127.0.0.1` with an ephemeral port, and hands the WebView the channel through a
//! single `xiranite_bootstrap` command (ADR-0063 principle 1, ADR-0065).
//!
//! ## Why the startup logic is in the library
//!
//! `main.rs` only assembles Tauri, because a window needs a window server. The whole channel —
//! bind, token, instance id, router, graceful shutdown — is [`start_backend`], and
//! `tests/headless_host.rs` drives that exact function to prove ADR-0065's two token positions
//! and the `/node-operations` protocol without opening one. Same code path, so the headless proof
//! is evidence about the shipped host rather than about a test-only imitation.
//!
//! ## The launcher stays an injection point
//!
//! [`BackendStart`] carries the `Arc<dyn OperationLauncher>` that `xiranite-api` needs
//! ([`xiranite_api::OperationLauncher`]); this crate never decides which launcher is used. The
//! Extism host wires the real one in `crates/xiranite-node-runtime`; [`BackendStart::placeholder`]
//! exists so the self-check host and the headless test can start a backend that answers the
//! protocol and finishes operations as `error` with an explicit message — which is
//! [`xiranite_api::NoPluginRuntime`]'s documented behaviour, not a host bug.
//!
//! ## Nothing here is platform specific
//!
//! The bind address is `Ipv4Addr::LOCALHOST` with port `0`, the port is read back from the socket,
//! and no path is assembled with a `/` literal: the self-check page is served by Tauri's own asset
//! mechanism (`build.frontendDist`), so Windows and macOS run identical code.

use std::error::Error;
use std::fmt;
use std::io;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::{Arc, OnceLock};

use tokio::net::TcpListener;
use tokio::sync::oneshot;
use xiranite_api::{ApiContext, NoPluginRuntime, OperationLauncher};
use xiranite_core::{IdGenerator, OperationManager, OperationManagerOptions, SystemClock};

pub mod bootstrap;
pub mod cors;
pub mod token;

pub use bootstrap::{BOOTSTRAP_COMMAND_NAME, BootstrapPayload, BootstrapState};
pub use token::generate_bearer_token;

/// The loopback address ADR-0065 pins. `Ipv4Addr::LOCALHOST` prints as `127.0.0.1`, which is the
/// form `src/backend/tauriChannel.ts:39` accepts; `localhost` would also pass the WebView regex but
/// can resolve to `::1` on a dual-stack host, and the backend is bound to v4 only.
const LOOPBACK_HOST: Ipv4Addr = Ipv4Addr::LOCALHOST;
/// Port `0` asks the OS for an ephemeral port, which is then read back with `local_addr()`. A fixed
/// port would make a second host instance (or a leftover process) collide instead of bootstrap.
const EPHEMERAL_PORT: u16 = 0;
/// The `instanceId` prefix. `IdGenerator` supplies `{prefix}-{counter}-{base36(now)}`, so the value
/// is unique inside a process and across restarts without inventing a second random vocabulary.
const INSTANCE_ID_PREFIX: &str = "host";

/// The three values the WebView needs to reach this host process (`ADR-0065`'s whole contract).
///
/// `token` is a per-process secret, so `Debug` redacts it: a host handle that ends up in a panic
/// message or a log line must not publish the bearer token.
#[derive(Clone, PartialEq, Eq)]
pub struct HostChannel {
    base_url: String,
    token: String,
    instance_id: String,
}

impl HostChannel {
    /// Assembles the channel for a bound socket. `port` comes from `local_addr()`, never from a
    /// constant, and `base_url` is built in the exact shape the WebView validator requires.
    #[must_use]
    pub fn new(port: u16, token: String, instance_id: String) -> Self {
        Self {
            base_url: format!("http://{LOOPBACK_HOST}:{port}"),
            token,
            instance_id,
        }
    }

    /// `baseUrl` — `http://127.0.0.1:{port}`, no trailing slash, no path.
    #[must_use]
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// The per-instance bearer token.
    #[must_use]
    pub fn token(&self) -> &str {
        &self.token
    }

    /// `instanceId` — identifies this host process so a restarted backend invalidates client state.
    #[must_use]
    pub fn instance_id(&self) -> &str {
        &self.instance_id
    }
}

impl fmt::Debug for HostChannel {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("HostChannel")
            .field("base_url", &self.base_url)
            .field("token", &"[redacted]")
            .field("instance_id", &self.instance_id)
            .finish()
    }
}

/// What the caller injects into the host. The only required field is the launcher.
pub struct BackendStart {
    launcher: Arc<dyn OperationLauncher>,
    operations: Option<OperationManager>,
}

impl BackendStart {
    /// A host that runs operations through `launcher`.
    #[must_use]
    pub fn new(launcher: Arc<dyn OperationLauncher>) -> Self {
        Self { launcher, operations: None }
    }

    /// A host whose operation registry is owned by the caller — the Extism host needs this to hold
    /// one manager across the GUI, the CLI and the TUI faces (ADR-0069).
    #[must_use]
    pub fn with_operations(mut self, operations: OperationManager) -> Self {
        self.operations = Some(operations);
        self
    }

    /// The launcher placeholder: `xiranite-api`'s own `NoPluginRuntime`, spelled in exactly one
    /// place so the seam that replaces it is searchable.
    #[must_use]
    pub fn placeholder() -> Self {
        Self::new(Arc::new(NoPluginRuntime))
    }
}

/// A running loopback backend plus the means to stop it.
///
/// Dropping the handle requests shutdown, which is what keeps a test from leaving a listener and a
/// runtime thread behind; [`BackendHandle::shutdown`] does the same and additionally waits for the
/// host thread and hands the channel back.
pub struct BackendHandle {
    channel: HostChannel,
    shutdown: Option<oneshot::Sender<()>>,
    joiner: Option<std::thread::JoinHandle<()>>,
}

impl BackendHandle {
    /// The channel this host is serving — the same value `xiranite_bootstrap` returns.
    #[must_use]
    pub fn channel(&self) -> &HostChannel {
        &self.channel
    }

    /// Stops the host, waits for its thread to leave, and returns the channel it served.
    pub fn shutdown(mut self) -> Result<HostChannel, HostStartError> {
        self.request_stop();
        let joiner = self.joiner.take();
        if let Some(joiner) = joiner {
            joiner.join().map_err(|_| HostStartError::HostThreadDied)?;
        }
        Ok(self.channel.clone())
    }

    fn request_stop(&mut self) {
        if let Some(sender) = self.shutdown.take() {
            // A failed send means the host thread already returned, so the listener is gone either
            // way; `join()` is what still distinguishes a clean stop from a panic.
            let _ = sender.send(());
        }
    }
}

impl Drop for BackendHandle {
    fn drop(&mut self) {
        self.request_stop();
    }
}

impl fmt::Debug for BackendHandle {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("BackendHandle")
            .field("channel", &self.channel)
            .field("stopping", &self.shutdown.is_none())
            .field("joined", &self.joiner.is_none())
            .finish()
    }
}

/// Why the loopback channel could not be published.
#[derive(Debug)]
pub enum HostStartError {
    /// The host's Tokio runtime could not be built.
    Runtime(io::Error),
    /// `127.0.0.1:0` could not be bound.
    Bind(io::Error),
    /// The bound socket refused to report its ephemeral port.
    LocalAddress(io::Error),
    /// The OS thread hosting the backend could not be spawned.
    Spawn(io::Error),
    /// The host thread ended before publishing the channel — a panic inside the serve loop.
    HostThreadDied,
}

impl fmt::Display for HostStartError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Runtime(error) => write!(formatter, "the host Tokio runtime could not be built: {error}"),
            Self::Bind(error) => write!(formatter, "127.0.0.1:0 could not be bound: {error}"),
            Self::LocalAddress(error) => write!(formatter, "the loopback listener's ephemeral port is unreadable: {error}"),
            Self::Spawn(error) => write!(formatter, "the host backend thread could not be started: {error}"),
            Self::HostThreadDied => formatter.write_str("the host backend thread exited without publishing a channel"),
        }
    }
}

impl Error for HostStartError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Runtime(error) | Self::Bind(error) | Self::LocalAddress(error) | Self::Spawn(error) => Some(error),
            Self::HostThreadDied => None,
        }
    }
}

/// Starts the Axum backend on a dedicated OS thread and blocks only until the channel is published.
///
/// The thread owns its own multi-threaded Tokio runtime rather than borrowing a caller's, because
/// Tauri must keep the main thread for the window event loop; a `Runtime` created inside `main`
/// would either have to wrap it (which Tauri forbids on macOS) or be entered per request.
pub fn start_backend(start: BackendStart) -> Result<BackendHandle, HostStartError> {
    let (report_sender, report_receiver) = std::sync::mpsc::channel();
    let (shutdown_sender, shutdown_receiver) = oneshot::channel();

    let joiner = std::thread::Builder::new()
        .name("xiranite-host".to_owned())
        .spawn(move || run_host(start, shutdown_receiver, report_sender))
        .map_err(HostStartError::Spawn)?;

    // Receiving publishes the bind/step failures to the caller instead of leaving `main` with a
    // window that silently has no backend, and guarantees the port exists before the WebView can ask.
    let outcome = report_receiver.recv().map_err(|_| HostStartError::HostThreadDied)?;
    let channel = outcome?;
    Ok(BackendHandle {
        channel,
        shutdown: Some(shutdown_sender),
        joiner: Some(joiner),
    })
}

fn run_host(
    start: BackendStart,
    shutdown_receiver: oneshot::Receiver<()>,
    report_sender: std::sync::mpsc::Sender<Result<HostChannel, HostStartError>>,
) {
    let runtime = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
        Ok(runtime) => runtime,
        Err(error) => {
            let _ = report_sender.send(Err(HostStartError::Runtime(error)));
            return;
        }
    };
    runtime.block_on(serve_loopback(start, shutdown_receiver, report_sender));
}

async fn serve_loopback(
    start: BackendStart,
    shutdown_receiver: oneshot::Receiver<()>,
    report_sender: std::sync::mpsc::Sender<Result<HostChannel, HostStartError>>,
) {
    let listener = match TcpListener::bind(SocketAddr::from((LOOPBACK_HOST, EPHEMERAL_PORT))).await {
        Ok(listener) => listener,
        Err(error) => {
            let _ = report_sender.send(Err(HostStartError::Bind(error)));
            return;
        }
    };
    let port = match listener.local_addr() {
        Ok(address) => address.port(),
        Err(error) => {
            let _ = report_sender.send(Err(HostStartError::LocalAddress(error)));
            return;
        }
    };

    let channel = HostChannel::new(port, generate_bearer_token(), host_instance_id());
    let operations = start
        .operations
        .unwrap_or_else(|| OperationManager::new(OperationManagerOptions::default()));
    let context = Arc::new(ApiContext::new(
        operations,
        channel.token().to_owned(),
        channel.instance_id().to_owned(),
        start.launcher,
    ));
    // The CORS half of the loopback contract is the shell's, because it is the shell that knows
    // which WebView origin is loading the bundle; see `cors`' module documentation.
    let app = xiranite_api::router(context).layer(axum::middleware::from_fn(cors::webview_cors));
    let _ = report_sender.send(Ok(channel));

    if let Err(error) = axum::serve(listener, app)
        .with_graceful_shutdown(wait_for_shutdown(shutdown_receiver))
        .await
    {
        eprintln!("xiranite-desktop: the loopback backend stopped with an error: {error}");
    }
}

/// Resolves once the handle asks for a stop *or* the handle is dropped without one: a closed
/// `oneshot` sender means the same thing as a received `()` — nobody is keeping this host alive.
async fn wait_for_shutdown(signal: oneshot::Receiver<()>) {
    // `Receiver` is itself the future; tokio removed `recv()` in favour of awaiting it directly.
    let _ = signal.await;
}

/// The process-wide id source behind [`host_instance_id`].
///
/// One generator per process, because its counter is what separates two ids inside the same
/// millisecond: a fresh `IdGenerator` per call restarts at zero, and a test process (or a CLI that
/// hosts several backends, ADR-0069) would then hand two host instances the same `instanceId` — the
/// one value the WebView uses to notice that the backend it cached is gone.
static INSTANCE_IDS: OnceLock<IdGenerator> = OnceLock::new();

/// `instanceId` for this host process, from `xiranite-core`'s own id vocabulary rather than a
/// second random string the WebView would have no way to reason about.
#[must_use]
pub fn host_instance_id() -> String {
    INSTANCE_IDS
        .get_or_init(|| IdGenerator::new(INSTANCE_ID_PREFIX, Arc::new(SystemClock)))
        .next()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_channel_is_a_loopback_origin_without_a_trailing_slash() {
        let channel = HostChannel::new(55_001, "t".to_owned(), "host-0-abc".to_owned());
        assert_eq!(channel.base_url(), "http://127.0.0.1:55001");
        assert_eq!(channel.token(), "t");
        assert_eq!(channel.instance_id(), "host-0-abc");
    }

    #[test]
    fn debug_never_prints_the_bearer_token() {
        let channel = HostChannel::new(55_001, "super-secret".to_owned(), "host-0-abc".to_owned());
        let text = format!("{channel:?}");
        assert!(!text.contains("super-secret"), "{text}");
        assert!(text.contains("redacted"), "{text}");
    }

    #[test]
    fn instance_ids_are_unique_and_prefixed() {
        let first = host_instance_id();
        let second = host_instance_id();
        assert!(first.starts_with("host-"), "{first}");
        assert_ne!(first, second, "each host process mints its own id");
    }
}
