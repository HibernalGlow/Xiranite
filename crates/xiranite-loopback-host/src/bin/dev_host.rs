//! A one-shot Xiranite backend for development: the real host, no window, finite lifetime.
//!
//! Why this exists: the browser faces (the Vite dev server, a Module Federation plugin loaded from a
//! different origin) need a channel, and after the Rust rewrite the only channel worth pointing them
//! at is this one. The old path — `scripts/dev-desktop.ts` — starts the Bun/Elysia backend, which is
//! a layer being deleted, and running the Tauri host to get a port meant needing a window server just
//! to serve HTTP. That cost is what `xiranite-loopback-host` removes: this binary links the same
//! [`xiranite_loopback_host::start_backend`] the window does, with no Tauri in its graph.
//!
//! It is a **debug-only** binary. It prints the per-instance bearer token on stdout, which
//! [`xiranite_loopback_host::HostChannel`]'s own `Debug` impl deliberately refuses to do, because a developer
//! script has to read that value out of this process's output in order to hand it to the WebView.
//! The window host and the shipped product never do that, so a release build exits before it binds.
//!
//! The lifetime is finite by default (ADR-0065's isolated-backend rule in its Rust form): pass
//! `--ttl-seconds <n>`, and the listener is confirmed closed when this process leaves.

use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;

use xiranite_loopback_host::{BackendStart, channel_document, remove_channel_file, stage_from_environment, staging_summary, start_backend, write_channel_file};

/// The default is a working session, not a daemon: long enough to drive a browser through a plugin
/// run, short enough that a forgotten process does not hold a port and a plugin directory open.
const DEFAULT_TTL_SECONDS: u64 = 300;

/// What `xiranite-dev-host` accepts, parsed once.
#[derive(Debug, PartialEq, Eq)]
struct Options {
    ttl_seconds: u64,
    channel_file: Option<PathBuf>,
}

fn main() {
    if !cfg!(debug_assertions) {
        eprintln!(
            "xiranite-dev-host prints the per-instance bearer token, so it only runs in a debug build.\n\
             use `cargo run -p xiranite-loopback-host --bin xiranite-dev-host` without --release, or run the real host."
        );
        std::process::exit(2);
    }

    let options = match parse_args(std::env::args().skip(1)) {
        Ok(options) => options,
        Err(message) => {
            eprintln!("xiranite-dev-host: {message}");
            std::process::exit(64);
        }
    };
    let ttl_seconds = options.ttl_seconds;

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
    // what a dev script drops into `window.__XIRANITE_BACKEND__` or into Vite's env.
    let line = channel_document(channel);
    let stdout = std::io::stdout();
    let mut stdout = stdout.lock();
    let _ = stdout.write_all(format!("XIRANITE_CHANNEL {line}\n").as_bytes());
    let _ = stdout.flush();

    // A terminal face that is not a child of this process cannot read its stdout, so the same document
    // can be asked for at a path. `XIRANITE_CHANNEL_FILE` (or `--channel-file`) is what makes
    // `xiranite <node> --backend auto` possible without a second discovery protocol.
    let channel_file = options.channel_file.or_else(|| std::env::var_os("XIRANITE_CHANNEL_FILE").map(PathBuf::from));
    if let Some(path) = &channel_file {
        match write_channel_file(channel, path) {
            Ok(()) => eprintln!("xiranite-dev-host: channel written to {}", path.display()),
            Err(error) => {
                eprintln!("xiranite-dev-host: the channel file could not be published: {error}");
                let _ = backend.shutdown();
                std::process::exit(73);
            }
        }
    }
    eprintln!("xiranite-dev-host: serving for {ttl_seconds}s; Ctrl-C at any time to stop early");

    std::thread::sleep(Duration::from_secs(ttl_seconds));
    // `shutdown()` waits for the host thread, so a caller that sees this process exit has also seen
    // the listener close — the same confirmation `tests/headless_host.rs` asserts on.
    if let Some(path) = &channel_file {
        // Only remove what this process wrote; a path reused from a previous session is that session's
        // business, and deleting it here would be a surprise.
        remove_channel_file(path);
    }
    match backend.shutdown() {
        Ok(_) => eprintln!("xiranite-dev-host: stopped cleanly"),
        Err(error) => {
            eprintln!("xiranite-dev-host: the loopback backend did not stop cleanly: {error}");
            std::process::exit(71);
        }
    }
}

/// Reads the two flags this binary owns: `--ttl-seconds <n>` and `--channel-file <path>` (also
/// accepted as `--channel-file=<path>`).
///
/// One parser owns every argument, which is the fix for the shape this file had before: `--channel-file`
/// was read out of the raw argv *after* the TTL parser had already rejected any argument that was not
/// `--ttl-seconds`, so the documented flag could never be passed and the file was only ever reachable
/// through the environment variable. An argument list is not something two functions get to interpret
/// differently.
///
/// A zero or unparsable TTL is rejected rather than rounded: `--ttl-seconds 0` would otherwise mean
/// "bind, print, exit", which looks like a failing port test instead of what it is.
fn parse_args(mut args: impl Iterator<Item = String>) -> Result<Options, String> {
    let mut ttl = DEFAULT_TTL_SECONDS;
    let mut channel_file: Option<PathBuf> = None;
    while let Some(arg) = args.next() {
        if arg == "--ttl-seconds" {
            let value = args.next().ok_or_else(|| "--ttl-seconds needs a value".to_string())?;
            ttl = value
                .parse::<u64>()
                .map_err(|_| format!("--ttl-seconds is not a non-negative integer: {value}"))?;
            if ttl == 0 {
                return Err("--ttl-seconds must be at least 1".to_string());
            }
        } else if arg == "--channel-file" {
            let value = args.next().ok_or_else(|| "--channel-file needs a value".to_string())?;
            channel_file = Some(PathBuf::from(value));
        } else if let Some(value) = arg.strip_prefix("--channel-file=") {
            channel_file = Some(PathBuf::from(value));
        } else {
            return Err(format!("unexpected argument {arg}"));
        }
    }
    Ok(Options { ttl_seconds: ttl, channel_file })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(argv: &[&str]) -> Result<Options, String> {
        parse_args(argv.iter().map(|arg| (*arg).to_owned()))
    }

    /// The flag that was unreachable before must now parse, in both accepted spellings, and must not
    /// disturb the TTL default.
    #[test]
    fn the_channel_file_flag_is_accepted_in_both_forms() {
        let spaced = parse(&["--channel-file", "/tmp/chan.json"]).expect("--channel-file <path> must parse");
        assert_eq!(spaced.channel_file.as_deref(), Some(std::path::Path::new("/tmp/chan.json")));
        assert_eq!(spaced.ttl_seconds, DEFAULT_TTL_SECONDS);

        let inline = parse(&["--channel-file=/tmp/chan.json"]).expect("--channel-file=<path> must parse");
        assert_eq!(inline.channel_file.as_deref(), Some(std::path::Path::new("/tmp/chan.json")));
    }

    /// Both flags together, in either order — a dev script passes both, and the TTL must survive the
    /// channel path being read (and vice versa).
    #[test]
    fn both_flags_parse_together_in_any_order() {
        let one = parse(&["--ttl-seconds", "45", "--channel-file", "/tmp/a.json"]).expect("must parse");
        assert_eq!((one.ttl_seconds, one.channel_file.as_deref()), (45, Some(std::path::Path::new("/tmp/a.json"))));
        let two = parse(&["--channel-file", "/tmp/a.json", "--ttl-seconds", "45"]).expect("order must not matter");
        assert_eq!((two.ttl_seconds, two.channel_file.as_deref()), (45, Some(std::path::Path::new("/tmp/a.json"))));
    }

    /// Falsification for the "silently ignore an unknown flag" failure mode: a typo must be refused,
    /// because a host that ignores `--channel-flle` serves a port nobody can find.
    #[test]
    fn unknown_arguments_are_refused_with_the_offending_spelling() {
        let error = parse(&["--ttl"]).expect_err("an unknown flag must not parse");
        assert!(error.contains("--ttl"), "{error}");
        assert!(parse(&["--channel-file"]).is_err(), "a flag with no value must be refused");
        assert_eq!(parse(&["--ttl-seconds", "0"]).err(), Some("--ttl-seconds must be at least 1".to_owned()));
        assert!(parse(&["--ttl-seconds", "abc"]).is_err(), "an unparsable TTL must be refused");
    }

    /// No arguments is a valid working session at the documented default.
    #[test]
    fn no_arguments_yields_the_default_session() {
        let options = parse(&[]).expect("no arguments must parse");
        assert_eq!(options.ttl_seconds, DEFAULT_TTL_SECONDS);
        assert_eq!(options.channel_file, None);
    }
}
