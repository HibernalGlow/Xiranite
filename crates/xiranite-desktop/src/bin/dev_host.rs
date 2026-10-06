//! A one-shot Xiranite backend for development: the real host, no window, finite lifetime.
//!
//! Why this exists: the browser faces (the Vite dev server, a Module Federation plugin loaded from a
//! different origin) need a channel, and after the Rust rewrite the only channel worth pointing them
//! at is this one. The old path — `scripts/dev-desktop.ts` — starts the Bun/Elysia backend, which is
//! a layer being deleted, and running the Tauri host to get a port means needing a window server just
//! to serve HTTP.
//!
//! It is a **debug-only** binary. It prints the per-instance bearer token on stdout, which
//! `xiranite_desktop::HostChannel`'s own `Debug` impl deliberately refuses to do, because a developer
//! script has to read that value out of this process's output in order to hand it to the WebView.
//! `main.rs` and the shipped product never do that, so `--help`-style output aside, a release build
//! exits before it binds.
//!
//! The lifetime is finite by default (ADR-0065's isolated-backend rule in its Rust form): pass
//! `--ttl-seconds <n>`, and the listener is confirmed closed when this process leaves.

use std::io::Write;
use std::time::Duration;

use xiranite_desktop::{BackendStart, stage_from_environment, staging_summary, start_backend};

/// The default is a working session, not a daemon: long enough to drive a browser through a plugin
/// run, short enough that a forgotten process does not hold a port and a plugin directory open.
const DEFAULT_TTL_SECONDS: u64 = 300;

fn main() {
    if !cfg!(debug_assertions) {
        eprintln!(
            "xiranite-dev-host prints the per-instance bearer token, so it only runs in a debug build.\n\
             use `cargo run -p xiranite-desktop --bin xiranite-dev-host` without --release, or run the real host."
        );
        std::process::exit(2);
    }

    let ttl_seconds = match parse_ttl(std::env::args().skip(1)) {
        Ok(seconds) => seconds,
        Err(message) => {
            eprintln!("xiranite-dev-host: {message}");
            std::process::exit(64);
        }
    };

    let staged = match stage_from_environment() {
        Ok(staged) => staged,
        Err(error) => {
            eprintln!("xiranite-dev-host: {error}");
            std::process::exit(78);
        }
    };
    eprintln!("xiranite-dev-host: {}", staging_summary(&staged));

    let backend = match start_backend(BackendStart::new(staged.launcher)) {
        Ok(backend) => backend,
        Err(error) => {
            eprintln!("xiranite-dev-host: the loopback backend did not start: {error}");
            std::process::exit(70);
        }
    };
    let channel = backend.channel();

    // One JSON line, so a caller can read it with a line scan instead of a regex over prose. The
    // field spellings match `LocalBackendConfig` (`src/backend/localBackendConfig.ts:8-12`), which is
    // what a dev script drops into `window.__XIRANITE_BACKEND__` or into Vite's env. Building it here
    // rather than as a `HostChannel` method keeps `token()` the only way to obtain the secret, and
    // that way is exercised nowhere else in this crate: `Debug` stays redacted for every other host.
    let line = serde_json::json!({
        "baseUrl": channel.base_url(),
        "token": channel.token(),
        "instanceId": channel.instance_id(),
    });
    let stdout = std::io::stdout();
    let mut stdout = stdout.lock();
    let _ = stdout.write_all(format!("XIRANITE_CHANNEL {line}\n").as_bytes());
    let _ = stdout.flush();
    eprintln!("xiranite-dev-host: serving for {ttl_seconds}s; Ctrl-C at any time to stop early");

    std::thread::sleep(Duration::from_secs(ttl_seconds));
    // `shutdown()` waits for the host thread, so a caller that sees this process exit has also seen
    // the listener close — the same confirmation `headless_host.rs` asserts on.
    match backend.shutdown() {
        Ok(_) => eprintln!("xiranite-dev-host: stopped cleanly"),
        Err(error) => {
            eprintln!("xiranite-dev-host: the loopback backend did not stop cleanly: {error}");
            std::process::exit(71);
        }
    }
}

/// Reads `--ttl-seconds <n>`, defaulting to [`DEFAULT_TTL_SECONDS`].
///
/// A zero or unparsable value is rejected rather than rounded: `--ttl-seconds 0` would otherwise mean
/// "bind, print, exit", which looks like a failing port test instead of what it is.
fn parse_ttl(mut args: impl Iterator<Item = String>) -> Result<u64, String> {
    let mut ttl = DEFAULT_TTL_SECONDS;
    while let Some(arg) = args.next() {
        if arg == "--ttl-seconds" {
            let value = args.next().ok_or_else(|| "--ttl-seconds needs a value".to_string())?;
            ttl = value
                .parse::<u64>()
                .map_err(|_| format!("--ttl-seconds is not a non-negative integer: {value}"))?;
            if ttl == 0 {
                return Err("--ttl-seconds must be at least 1".to_string());
            }
        } else {
            return Err(format!("unexpected argument {arg}"));
        }
    }
    Ok(ttl)
}
