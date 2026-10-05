//! The `SoundwRuntime` that talks to the host, compiled only for feature `wasm` on wasm32.
//!
//! `platform.ts` is this file's counterpart: `resolve` (`platform.ts:7-16`) and `run`
//! (`platform.ts:17-25`), with the same total answer shape — a triple of exit code, stdout and
//! stderr, never a thrown error — because `core.ts:22-32` interprets a failed command rather than
//! catching one. What changed is *who* answers:
//!
//! | TypeScript | Here |
//! | --- | --- |
//! | `stat(path)` on the override (`platform.ts:9`) | `std::fs::metadata` inside the read-only preopen (`crate::cli_locator`) |
//! | `which`/`where.exe` to find the CLI (`platform.ts:11-15`) | the host's registration of [`SOUNDW_REGISTERED_COMMAND`]; the guest reports it as the program and the refusal, if any, is the answer |
//! | `execFile(path, args, { timeout: 15_000 })` (`platform.ts:19`) | one `xiranite.process.run` with `timeoutMs: 15000` |
//! | `TextDecoder("gb18030")` on Windows (`platform.ts:26-30`) | the host, before it answers: the response strings are UTF-8 by contract |
//!
//! The operation identity comes from the request document (ADR-0068: plugin lifecycle is not
//! operation lifecycle, so every capability call carries `operationId`), which is why the runtime is
//! constructed per run instead of being a unit struct.

use crate::cli_locator::{SoundwCliProbe, probe_cli_override};
use crate::extism_boundary;
use crate::host_functions::{
    HostCheckpointOutcome, SOUNDW_REGISTERED_COMMAND, SoundwProcessRunRequest,
    SoundwProcessRunResponse, checkpoint_request,
};
use crate::soundw_runtime::{SoundwBinaryResolution, SoundwCheckpoint, SoundwProcessOutput, SoundwRuntime};

/// The host-backed runtime for one operation.
pub struct HostSoundwRuntime {
    operation_id: String,
}

impl HostSoundwRuntime {
    /// Binds the runtime to the operation whose id the request carried.
    #[must_use]
    pub fn new(operation_id: impl Into<String>) -> Self {
        Self { operation_id: operation_id.into() }
    }

    /// The operation id every capability call carries.
    #[must_use]
    pub fn operation_id(&self) -> &str {
        &self.operation_id
    }
}

impl SoundwRuntime for HostSoundwRuntime {
    fn resolve(&self, path_override: Option<&str>) -> SoundwBinaryResolution {
        match probe_cli_override(path_override) {
            SoundwCliProbe::Located(resolution) => resolution,
            // `platform.ts:9`'s answer for a path that is not there, which WASI also gives for a
            // path outside the preopen: nothing to run.
            SoundwCliProbe::Absent => SoundwBinaryResolution::missing(),
            // No override: the registration decides, so the program text is the registered name and
            // a `not_found` refusal becomes `core.ts:11`'s sentence in `run`.
            SoundwCliProbe::NotProbed => SoundwBinaryResolution::found(SOUNDW_REGISTERED_COMMAND),
        }
    }

    fn run(&self, program: &str, args: &[String]) -> SoundwProcessOutput {
        let request = SoundwProcessRunRequest::new(self.operation_id.as_str(), program, args);
        match extism_boundary::call_process_run(&request.to_json()) {
            Ok(document) => match SoundwProcessRunResponse::from_json(&document) {
                Ok(response) => SoundwProcessOutput::from_process_response(&response),
                Err(detail) => SoundwProcessOutput::new(1, "", detail),
            },
            Err(failure) => SoundwProcessOutput::from_process_failure(&failure),
        }
    }

    fn checkpoint(&self) -> SoundwCheckpoint {
        let request = checkpoint_request(self.operation_id.as_str());
        match extism_boundary::checkpoint(&request) {
            Ok(document) if HostCheckpointOutcome::from_json(&document) == HostCheckpointOutcome::Cancelled => {
                // ADR-0066: cancellation is the one answer a plugin obeys immediately. The message
                // is the plugin's own because the checkpoint contract carries no text, and the
                // operation's cancellation reason stays in the host's event stream.
                SoundwCheckpoint::Cancelled { message: CANCELLED_MESSAGE.to_owned() }
            }
            // `Continue`, `Paused`, a refusal and an unreadable answer all mean "keep working": a
            // checkpoint is not the place where a plugin learns the CLI is missing.
            _ => SoundwCheckpoint::Continue,
        }
    }
}

/// The sentence a cancelled checkpoint produces (`core.ts` had no counterpart: the Bun host could
/// kill the process instead of being asked).
pub const CANCELLED_MESSAGE: &str = "Operation cancelled.";
