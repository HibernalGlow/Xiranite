//! The machine-capability surface `run_soundw` is written against.
//!
//! `core.ts:6` declares `SoundwRuntime { resolve, run }` and injects it, which is why the node's
//! logic was always portable: only `platform.ts` knew about `node:child_process` and
//! `node:fs/promises` (the feasibility audit's two evidence rows,
//! `artifacts/node-wasm-feasibility.json` → `soundw`). This trait is that seam with ADR-0071's
//! two changes:
//!
//! - `resolve` is served by `std::fs` inside a WASI preopen when the caller supplied a path
//!   override, and by the host's command registration otherwise;
//! - `run` is one `xiranite.process.run` call, which the guest cannot replace with a spawn because
//!   Extism's WASI answers `Unsupported` for `std::process::Command` (ADR-0071 §2);
//! - `checkpoint` is new: ADR-0066 requires a plugin to yield at work boundaries, and the single
//!   side-effecting step of this node is the CLI invocation.
//!
//! Failures arrive as *data* (`SoundwProcessOutput`, `SoundwCheckpoint`), never as `Err`, exactly
//! like `platform.ts:17-25`, whose `try/catch` converts a spawn failure, a timeout and a non-zero
//! exit into the same `{ code, stdout, stderr }` triple the core then interprets. ADR-0068's rule
//! that a capability failure returns an envelope instead of trapping is what lets the port keep
//! this shape.

use crate::soundw_model::SoundwRunEvent;

/// The answer of `platform.ts:6`'s `resolve`: is the CLI there, and at what path?
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SoundwBinaryResolution {
    /// `found`.
    pub found: bool,
    /// `path`, the text the run step is invoked with. `""` when not found, as in `platform.ts:9`.
    pub path: String,
}

impl SoundwBinaryResolution {
    /// A located CLI.
    #[must_use]
    pub fn found(path: impl Into<String>) -> Self {
        Self { found: true, path: path.into() }
    }

    /// Nothing to run (`platform.ts:9,15`).
    #[must_use]
    pub const fn missing() -> Self {
        Self { found: false, path: String::new() }
    }
}

/// The answer of `platform.ts:6`'s `run`: `{ code, stdout, stderr }`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SoundwProcessOutput {
    /// Exit status. `0` means the command succeeded (`core.ts:23`).
    pub code: i32,
    /// Captured stdout, already decoded to UTF-8 by the host (see the note below).
    pub stdout: String,
    /// Captured stderr, or the timeout sentence `platform.ts:23` substitutes for a killed child.
    pub stderr: String,
}

impl SoundwProcessOutput {
    /// A completed process.
    #[must_use]
    pub fn new(code: i32, stdout: impl Into<String>, stderr: impl Into<String>) -> Self {
        Self { code, stdout: stdout.into(), stderr: stderr.into() }
    }

    /// `platform.ts:23`'s killed-child branch: exit status unknown, so `item.code ?? 1` yields `1`,
    /// and the message is the sentence the core's timeout pattern (`core.ts:24`) already matches.
    #[must_use]
    pub fn timed_out(timeout_seconds: u64) -> Self {
        Self {
            code: 1,
            stdout: String::new(),
            stderr: format!("SoundSwitch CLI did not respond within {timeout_seconds} seconds."),
        }
    }

    /// Maps a successful `xiranite.process.run` answer into the triple `core.ts:22` reads.
    ///
    /// `timedOut` is the host's word for `item.killed` (`platform.ts:23`), so it produces the same
    /// sentence and therefore the same rewrite at `core.ts:24-25`.
    #[must_use]
    pub fn from_process_response(response: &crate::host_functions::SoundwProcessRunResponse) -> Self {
        if response.timed_out {
            return Self::timed_out(crate::host_functions::PROCESS_TIMEOUT_SECONDS);
        }
        Self { code: response.exit_code, stdout: response.stdout.clone(), stderr: response.stderr.clone() }
    }

    /// Maps a capability failure into a non-zero exit, the way `platform.ts:21-24`'s `catch` mapped
    /// a spawn failure into one.
    ///
    /// `not_found` is the interesting code: with no `soundSwitchPath` override the guest had no way
    /// to know whether the CLI is installed, and the host's refusal *is* that knowledge, so the
    /// answer reuses `core.ts:11`'s sentence verbatim and the user sees the same instruction. Every
    /// other code reports the host's own message, which is what `stderr` was for.
    #[must_use]
    pub fn from_process_failure(failure: &crate::host_functions::HostFailure) -> Self {
        use crate::host_functions::HostErrorCode;
        let message = if failure.code() == HostErrorCode::NotFound {
            crate::soundw_core::NOT_INSTALLED_MESSAGE.to_owned()
        } else {
            failure.message().to_owned()
        };
        Self { code: 1, stdout: String::new(), stderr: message }
    }
}

/// What `xiranite.operation.checkpoint` answered (ADR-0066).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SoundwCheckpoint {
    /// Keep going, including the host's `Paused` report, which ADR-0066 defines as non-blocking.
    Continue,
    /// The operation is cancelled: stop before starting the side-effecting step.
    Cancelled {
        /// The message that becomes the failure result.
        message: String,
    },
}

impl SoundwCheckpoint {
    /// Whether the run must stop here.
    #[must_use]
    pub const fn is_hard_stop(&self) -> bool {
        matches!(self, Self::Cancelled { .. })
    }
}

/// The injected machine surface, the Rust reading of `SoundwRuntime` (`core.ts:6`).
pub trait SoundwRuntime {
    /// `platform.ts:7-16` `resolve`. `path_override` is the node's `soundSwitchPath` field.
    fn resolve(&self, path_override: Option<&str>) -> SoundwBinaryResolution;

    /// `platform.ts:17-25` `run`. Implementations convert every host refusal into a
    /// [`SoundwProcessOutput`] rather than failing the call, because the node's behaviour on a
    /// refusal is a *result*, not an exception.
    fn run(&self, program: &str, args: &[String]) -> SoundwProcessOutput;

    /// ADR-0066's cooperative yield. Native implementations answer `Continue`; the host-backed one
    /// calls `xiranite.operation.checkpoint`.
    fn checkpoint(&self) -> SoundwCheckpoint {
        SoundwCheckpoint::Continue
    }
}

/// The `onEvent` callback parameter of `core.ts:8`, as a trait so the wasm shim can forward each
/// event to `xiranite.operation.emit`.
pub trait SoundwEventSink {
    /// Delivers one event.
    fn on_event(&mut self, event: SoundwRunEvent);
}

/// The default of `core.ts:8` (`onEvent = () => {}`).
pub struct NoopSoundwEventSink;

impl SoundwEventSink for NoopSoundwEventSink {
    fn on_event(&mut self, _event: SoundwRunEvent) {}
}

/// Collects events, for tests and for the `events` array of the response document.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct CollectingSoundwEventSink {
    /// Every event seen, in order.
    pub events: Vec<SoundwRunEvent>,
}

impl CollectingSoundwEventSink {
    /// An empty collector.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }
}

impl SoundwEventSink for CollectingSoundwEventSink {
    fn on_event(&mut self, event: SoundwRunEvent) {
        self.events.push(event);
    }
}

/// A runtime that never finds a CLI, for the "nothing is installed" case of a host without a
/// registration.
pub struct NoCliSoundwRuntime;

impl SoundwRuntime for NoCliSoundwRuntime {
    fn resolve(&self, _path_override: Option<&str>) -> SoundwBinaryResolution {
        SoundwBinaryResolution::missing()
    }

    fn run(&self, _program: &str, _args: &[String]) -> SoundwProcessOutput {
        SoundwProcessOutput::new(127, "", "SoundSwitch CLI is not available in this runtime.")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_timeout_output_is_the_sentence_the_core_already_matches() {
        let output = SoundwProcessOutput::timed_out(15);
        assert_eq!(output.code, 1);
        assert!(crate::js_text::matches_timeout_pattern(&output.stderr));
    }

    #[test]
    fn only_cancellation_is_a_hard_stop() {
        assert!(!SoundwCheckpoint::Continue.is_hard_stop());
        assert!(SoundwCheckpoint::Cancelled { message: "nope".to_owned() }.is_hard_stop());
    }

    #[test]
    fn the_no_cli_runtime_resolves_to_nothing() {
        // Negative control for `NoCliSoundwRuntime`: it must not report a path, and its `run` must
        // not pretend success.
        let runtime = NoCliSoundwRuntime;
        assert_eq!(runtime.resolve(Some("/somewhere/SoundSwitch.CLI.exe")), SoundwBinaryResolution::missing());
        assert_eq!(runtime.run("soundswitch-cli", &["mute".to_owned()]).code, 127);
    }

    #[test]
    fn the_default_checkpoint_is_continue() {
        assert_eq!(NoCliSoundwRuntime.checkpoint(), SoundwCheckpoint::Continue);
    }

    #[test]
    fn a_host_timeout_becomes_the_sentence_the_core_rewrites() {
        let response = crate::host_functions::SoundwProcessRunResponse {
            exit_code: 0,
            stdout: String::new(),
            stderr: String::new(),
            timed_out: true,
        };
        let output = SoundwProcessOutput::from_process_response(&response);
        assert_eq!(output, SoundwProcessOutput::timed_out(15));
        assert!(crate::js_text::matches_timeout_pattern(&output.stderr));
        // Negative control: an untimed-out answer passes through untouched.
        let normal = crate::host_functions::SoundwProcessRunResponse {
            exit_code: 3,
            stdout: "out".to_owned(),
            stderr: "err".to_owned(),
            timed_out: false,
        };
        assert_eq!(
            SoundwProcessOutput::from_process_response(&normal),
            SoundwProcessOutput::new(3, "out", "err")
        );
    }

    #[test]
    fn a_not_found_refusal_is_the_install_instruction_and_nothing_else_is() {
        use crate::host_functions::{HostErrorCode, HostFailure, PluginError};

        let not_installed = SoundwProcessOutput::from_process_failure(&HostFailure::Refusal(PluginError {
            code: HostErrorCode::NotFound,
            reported_code: None,
            message: "soundswitch-cli is not registered".to_owned(),
        }));
        assert_eq!(not_installed.code, 1);
        assert_eq!(not_installed.stdout, "");
        assert_eq!(not_installed.stderr, crate::soundw_core::NOT_INSTALLED_MESSAGE);

        // Negative control: a permission refusal keeps the host's own words, so an allowlist
        // rejection is never silently reported as "install SoundSwitch".
        let denied = SoundwProcessOutput::from_process_failure(&HostFailure::Refusal(PluginError {
            code: HostErrorCode::PermissionDenied,
            reported_code: None,
            message: "the requested program is outside the allowlist".to_owned(),
        }));
        assert_eq!(denied.stderr, "the requested program is outside the allowlist");
        assert_ne!(denied.stderr, crate::soundw_core::NOT_INSTALLED_MESSAGE);

        let malformed =
            SoundwProcessOutput::from_process_failure(&HostFailure::MalformedAnswer("no block".to_owned()));
        assert_eq!(malformed.stderr, "no block");
    }
}
