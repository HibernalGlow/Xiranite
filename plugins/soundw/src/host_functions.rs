//! The capability vocabulary this plugin imports, as data.
//!
//! One source of truth exists for these names — `crates/xiranite-plugin-api/src/host_function_names.rs`
//! — and this module mirrors it rather than depending on it: ADR-0063 keeps `plugins/*` as their own
//! workspace precisely so a plugin crate builds without the host crates that are still moving, and
//! `tests/manifest_contract.rs` pins all three lists (this one, `manifest.toml`, and the imports in
//! `src/plugin.rs`) against each other so a fork like the one ADR-0068 records (five capabilities,
//! eight invented names) cannot come back quietly.
//!
//! ADR-0071 closed the vocabulary at nine names and retired the whole `xiranite.fs.*` family, which
//! is why SoundW declares three: `operation.checkpoint` (ADR-0066), `operation.emit` (progress,
//! which `reportsProgress: true` promises) and `process.run` (the SoundSwitch CLI, because Extism's
//! WASI hands a guest files but no spawn — ADR-0071 §2 measured `std::process::Command` returning
//! `Unsupported`). File access, for the one path field this node has, is a WASI preopen and needs no
//! name at all.

/// The namespace every Xiranite capability lives in (`host_function_names.rs:19`).
pub const HOST_FUNCTION_NAMESPACE: &str = "xiranite";

/// `xiranite.operation.checkpoint` — ADR-0066's cooperative yield.
pub const HOST_FUNCTION_OPERATION_CHECKPOINT: &str = "xiranite.operation.checkpoint";
/// `xiranite.operation.update` — declared by the API, unused by this node.
pub const HOST_FUNCTION_OPERATION_UPDATE: &str = "xiranite.operation.update";
/// `xiranite.operation.emit` — one progress event into the operation's stream.
pub const HOST_FUNCTION_OPERATION_EMIT: &str = "xiranite.operation.emit";
/// `xiranite.process.run` — the SoundSwitch CLI invocation.
pub const HOST_FUNCTION_PROCESS_RUN: &str = "xiranite.process.run";
/// `xiranite.scheduler.acquire` — unused: one command per run has nothing to admit against.
pub const HOST_FUNCTION_SCHEDULER_ACQUIRE: &str = "xiranite.scheduler.acquire";
/// `xiranite.scheduler.release` — unused, with the same reason.
pub const HOST_FUNCTION_SCHEDULER_RELEASE: &str = "xiranite.scheduler.release";
/// `xiranite.log` — unused: the node's diagnostics are the run's `output`/`errors`, not log lines.
pub const HOST_FUNCTION_LOG: &str = "xiranite.log";
/// `xiranite.now` — unused: SoundW stamps nothing and its `core.ts` never reads a clock.
pub const HOST_FUNCTION_NOW: &str = "xiranite.now";
/// `xiranite.path_token.resolve` — unused: the node speaks path text, not tokens.
pub const HOST_FUNCTION_PATH_TOKEN_RESOLVE: &str = "xiranite.path_token.resolve";

/// The nine settled names (`host_function_names.rs:46-56`), const-asserted there and re-listed here
/// so a plugin-side test can refuse a name outside the vocabulary before a manifest ever ships it.
pub const CANONICAL_HOST_FUNCTIONS: [&str; 9] = [
    HOST_FUNCTION_OPERATION_CHECKPOINT,
    HOST_FUNCTION_OPERATION_UPDATE,
    HOST_FUNCTION_OPERATION_EMIT,
    HOST_FUNCTION_PROCESS_RUN,
    HOST_FUNCTION_SCHEDULER_ACQUIRE,
    HOST_FUNCTION_SCHEDULER_RELEASE,
    HOST_FUNCTION_LOG,
    HOST_FUNCTION_NOW,
    HOST_FUNCTION_PATH_TOKEN_RESOLVE,
];

/// The thirteen file names ADR-0071 retired. Spelled out because a port that reaches for one of
/// them believes it is asking for a capability, and the answer is `allowed_paths`.
pub const RETIRED_FILE_HOST_FUNCTIONS: [&str; 13] = [
    "xiranite.fs.open",
    "xiranite.fs.read",
    "xiranite.fs.write",
    "xiranite.fs.close",
    "xiranite.fs.read_text",
    "xiranite.fs.write_text",
    "xiranite.fs.stat",
    "xiranite.fs.list",
    "xiranite.fs.move",
    "xiranite.fs.copy",
    "xiranite.fs.delete",
    "xiranite.fs.ensure_dir",
    "xiranite.fs.set_times",
];

/// Exactly what `soundw.wasm` imports, in manifest order.
pub const SOUNDW_HOST_FUNCTIONS: [&str; 3] = [
    HOST_FUNCTION_OPERATION_CHECKPOINT,
    HOST_FUNCTION_OPERATION_EMIT,
    HOST_FUNCTION_PROCESS_RUN,
];

/// The import symbol one logical name becomes (`host_function_names.rs:75-85`): dots flatten to
/// underscores, in module `extism:host/user`. A guest declares this text in a `#[link_name]`, so
/// the rule is part of the contract and not an adapter detail.
#[must_use]
pub fn host_function_symbol(name: &str) -> Option<&'static str> {
    Some(match name {
        HOST_FUNCTION_OPERATION_CHECKPOINT => "xiranite_operation_checkpoint",
        HOST_FUNCTION_OPERATION_UPDATE => "xiranite_operation_update",
        HOST_FUNCTION_OPERATION_EMIT => "xiranite_operation_emit",
        HOST_FUNCTION_PROCESS_RUN => "xiranite_process_run",
        HOST_FUNCTION_SCHEDULER_ACQUIRE => "xiranite_scheduler_acquire",
        HOST_FUNCTION_SCHEDULER_RELEASE => "xiranite_scheduler_release",
        HOST_FUNCTION_LOG => "xiranite_log",
        HOST_FUNCTION_NOW => "xiranite_now",
        HOST_FUNCTION_PATH_TOKEN_RESOLVE => "xiranite_path_token_resolve",
        _ => return None,
    })
}

/// The command the host must register for this node (`docs/adr/0071-….md` decision 5: an allowlist,
/// with the `DangerGate` on the registration point).
///
/// `xiranite.process.run`'s `program` field resolves only against names like this one; the Windows
/// release gate registers it against `SoundSwitch.CLI.exe` and non-Windows hosts against
/// `SoundSwitch.CLI`, which are the two spellings `platform.ts:11` chose by `process.platform`. The
/// guest cannot make that choice — it has neither a PATH search nor a spawn.
pub const SOUNDW_REGISTERED_COMMAND: &str = "soundswitch-cli";
/// `platform.ts:11`, the Windows binary name.
pub const SOUNDW_CLI_BINARY_WINDOWS: &str = "SoundSwitch.CLI.exe";
/// `platform.ts:11`, the POSIX binary name.
pub const SOUNDW_CLI_BINARY_POSIX: &str = "SoundSwitch.CLI";

/// `platform.ts:19`: the CLI gets 15 seconds before it is treated as unreachable.
pub const PROCESS_TIMEOUT_MS: u64 = 15_000;
/// The same budget in the sentence `platform.ts:23` prints.
pub const PROCESS_TIMEOUT_SECONDS: u64 = 15;
/// A ceiling on what one CLI call may answer with. SoundSwitch prints short tables; 128 KiB is
/// three orders of magnitude above that, and it is what keeps one response block inside
/// [`MEMORY_MAX_PAGES`].
pub const MAX_OUTPUT_BYTES: u64 = 131_072;
/// `manifest.toml` `[backend] memory_max_pages`, and the reason [`MAX_OUTPUT_BYTES`] is bounded:
/// 64 WASM pages is 4 MiB of linear memory for a request document, one response block and a
/// handful of parsed strings.
pub const MEMORY_MAX_PAGES: u32 = 64;
/// Bytes in one WASM page, for the arithmetic a reviewer has to be able to check.
pub const WASM_PAGE_BYTES: u32 = 65_536;

/// `xiranite.process.run`'s typed request (`docs/adr/0071-….md` decision 5, field-for-field).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SoundwProcessRunRequest {
    /// `operationId`: ADR-0068's rule that every cross-boundary call names its operation.
    pub operation_id: String,
    /// `program`: a registered command name, never a shell line.
    pub program: String,
    /// `args`: the argv `SoundwAction::cli_args` produced.
    pub args: Vec<String>,
    /// `cwdToken`: SoundW runs the CLI in the host's working directory, so this is absent.
    pub cwd_token: Option<String>,
    /// `timeoutMs`.
    pub timeout_ms: u64,
    /// `maxOutputBytes`.
    pub max_output_bytes: u64,
}

impl SoundwProcessRunRequest {
    /// The request for one run of `args`.
    #[must_use]
    pub fn new(operation_id: impl Into<String>, program: impl Into<String>, args: &[String]) -> Self {
        Self {
            operation_id: operation_id.into(),
            program: program.into(),
            args: args.to_vec(),
            cwd_token: None,
            timeout_ms: PROCESS_TIMEOUT_MS,
            max_output_bytes: MAX_OUTPUT_BYTES,
        }
    }

    /// The wire document, with the camelCase field names the adapter reads.
    #[must_use]
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "operationId": self.operation_id,
            "program": self.program,
            "args": self.args,
            "cwdToken": self.cwd_token,
            "timeoutMs": self.timeout_ms,
            "maxOutputBytes": self.max_output_bytes,
        })
    }
}

/// `xiranite.process.run`'s typed response: the host owns argv, cwd and the exit status
/// (ADR-0071 decision 5), and it also owns the console decoding `platform.ts:26-30` did with
/// `gb18030` on Windows, so the strings here are UTF-8 by contract.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SoundwProcessRunResponse {
    /// The exit status.
    pub exit_code: i32,
    /// Decoded stdout.
    pub stdout: String,
    /// Decoded stderr.
    pub stderr: String,
    /// Whether the host killed the child at `timeoutMs`, which is what `platform.ts:23`'s
    /// `item.killed` meant.
    pub timed_out: bool,
}

impl SoundwProcessRunResponse {
    /// Decodes the `result` document of an OK envelope.
    ///
    /// # Errors
    ///
    /// Reports the missing or mistyped field; the caller turns that into a `host_failure` output
    /// rather than a trap.
    pub fn from_json(value: &serde_json::Value) -> Result<Self, String> {
        let read_string = |name: &str| -> Result<String, String> {
            value
                .get(name)
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
                .ok_or_else(|| format!("xiranite.process.run result has no string `{name}`"))
        };
        let exit_code = value
            .get("exitCode")
            .and_then(serde_json::Value::as_i64)
            .ok_or_else(|| "xiranite.process.run result has no integer `exitCode`".to_owned())?;
        Ok(Self {
            exit_code: i32::try_from(exit_code).map_err(|_| format!("exitCode {exit_code} is outside i32"))?,
            stdout: read_string("stdout")?,
            stderr: read_string("stderr")?,
            timed_out: value.get("timedOut").and_then(serde_json::Value::as_bool).unwrap_or(false),
        })
    }
}

/// `xiranite.operation.checkpoint`'s request; the outcome comes back in the envelope.
#[must_use]
pub fn checkpoint_request(operation_id: &str) -> serde_json::Value {
    serde_json::json!({ "operationId": operation_id })
}

/// `xiranite.operation.emit`'s request: the operation plus one `NodeRunEvent` document.
#[must_use]
pub fn emit_request(operation_id: &str, event: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({ "operationId": operation_id, "event": event })
}

/// The codes `crates/xiranite-plugin-api/src/host_calls.rs:96-105` publishes for a refused
/// capability call, so a plugin can branch on them without parsing prose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostErrorCode {
    /// The operation is cancelled or terminal.
    Cancelled,
    /// `allowed_paths` or the command allowlist refused the call.
    PermissionDenied,
    /// The path or the registered command is not there.
    NotFound,
    /// A memory, timeout or event-buffer ceiling refused the call.
    BudgetExceeded,
    /// A token the host did not mint for this operation.
    InvalidToken,
    /// Anything else the host failed at.
    HostFailure,
}

impl HostErrorCode {
    /// The wire spelling.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Cancelled => "cancelled",
            Self::PermissionDenied => "permission_denied",
            Self::NotFound => "not_found",
            Self::BudgetExceeded => "budget_exceeded",
            Self::InvalidToken => "invalid_token",
            Self::HostFailure => "host_failure",
        }
    }

    /// A code text, kept as the code itself when a host answers with something new so an
    /// unrecognised refusal is not silently downgraded.
    #[must_use]
    pub fn parse(value: &str) -> (Self, Option<String>) {
        let known = match value {
            "cancelled" => Self::Cancelled,
            "permission_denied" => Self::PermissionDenied,
            "not_found" => Self::NotFound,
            "budget_exceeded" => Self::BudgetExceeded,
            "invalid_token" => Self::InvalidToken,
            _ => Self::HostFailure,
        };
        (known, (value != known.as_str()).then(|| value.to_owned()))
    }
}

/// ADR-0068's `PluginError { code, message, details? }`, the refusal half of every envelope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginError {
    /// The stable code, when the host used one of the six.
    pub code: HostErrorCode,
    /// The host's own code text, kept verbatim when it is not one of the six.
    pub reported_code: Option<String>,
    /// Display text, safe to show the user.
    pub message: String,
}

impl PluginError {
    /// Decodes the `error` object of a refusal envelope.
    ///
    /// # Errors
    ///
    /// Only when the object has no `code` string at all, which is a malformed host answer rather
    /// than a refusal.
    pub fn from_json(value: &serde_json::Value) -> Result<Self, String> {
        let code = value
            .get("code")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| "host refusal has no string `code`".to_owned())?;
        let message = value.get("message").and_then(serde_json::Value::as_str).unwrap_or_default();
        let (parsed_code, reported) = HostErrorCode::parse(code);
        Ok(Self { code: parsed_code, reported_code: reported, message: message.to_owned() })
    }

    /// The default sentence for a host that refused without explaining.
    #[must_use]
    pub fn unnamed_host_failure() -> Self {
        Self { code: HostErrorCode::HostFailure, reported_code: None, message: "host call failed".to_owned() }
    }
}

/// One capability answer: `{"ok":true,"result":…}` or
/// `{"ok":false,"error":{"code","message","details"}}` (ADR-0068: a capability failure is an
/// envelope, not a trap).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostResponse<Result> {
    /// The capability succeeded.
    Ok(Result),
    /// The capability refused, with the reason attached.
    Err(PluginError),
}

impl HostResponse<serde_json::Value> {
    /// Decodes an envelope document, keeping the result as a value for the caller to type.
    ///
    /// # Errors
    ///
    /// Reports an envelope that is not a Xiranite envelope at all (`ok` absent), which is the
    /// adapter's failure rather than the capability's.
    pub fn decode(document: &str) -> Result<Self, String> {
        let value: serde_json::Value =
            serde_json::from_str(document).map_err(|error| format!("host answer was not JSON: {error}"))?;
        let ok = value
            .get("ok")
            .and_then(serde_json::Value::as_bool)
            .ok_or_else(|| "host answer has no boolean `ok`".to_owned())?;
        if ok {
            return Ok(Self::Ok(value.get("result").cloned().unwrap_or(serde_json::Value::Null)));
        }
        let error = value.get("error").cloned().unwrap_or(serde_json::Value::Null);
        let refusal = if error.is_object() {
            PluginError::from_json(&error)?
        } else if let Some(text) = error.as_str() {
            // Tolerates the flat `{ ok: false, error: "text" }` shape the earlier ported plugins
            // answer with, so a host mid-migration still reports a refusal instead of a decode bug.
            let (code, reported) = HostErrorCode::parse("host_failure");
            PluginError { code, reported_code: reported, message: text.to_owned() }
        } else {
            PluginError::unnamed_host_failure()
        };
        Ok(Self::Err(refusal))
    }
}

/// Any way a capability call can come back without an answer the plugin can use.
///
/// Two very different things, kept distinct because the user sees them differently: a *refusal* is
/// the host declining a legitimate request (the CLI is not registered, the path is outside
/// `allowed_paths`), and its message is already written for the user; a *malformed answer* is the
/// adapter or a host bug, and reporting it as if the operation had declined would be a lie.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostFailure {
    /// The host refused the call, with ADR-0068's `PluginError` attached.
    Refusal(PluginError),
    /// The host answered with no block, or with bytes that are not a Xiranite envelope.
    MalformedAnswer(String),
}

impl HostFailure {
    /// The stable code, when there is one.
    #[must_use]
    pub fn code(&self) -> HostErrorCode {
        match self {
            Self::Refusal(error) => error.code,
            Self::MalformedAnswer(_) => HostErrorCode::HostFailure,
        }
    }

    /// The text to show or log.
    #[must_use]
    pub fn message(&self) -> &str {
        match self {
            Self::Refusal(error) => &error.message,
            Self::MalformedAnswer(text) => text,
        }
    }
}

impl std::fmt::Display for HostFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.message())
    }
}

impl std::error::Error for HostFailure {}

/// `xiranite.operation.checkpoint`'s outcome, in the two spellings the Plugin API publishes:
/// `CheckpointOutcome::as_str`'s text (`checkpoint.rs:44-49`) and `AbiCode`'s number
/// (`checkpoint.rs:53-70`, where 1 is Continue, 2 Paused and 3 Cancelled).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostCheckpointOutcome {
    /// Keep going, including the non-blocking `Paused` report.
    Continue,
    /// Stop now (ADR-0066).
    Cancelled,
}

impl HostCheckpointOutcome {
    /// Reads one out of a checkpoint answer, defaulting to `Continue` for an answer that names
    /// nothing: ADR-0066's plugin-side obligation is to keep working when the host has no reason to
    /// stop it, and a malformed outcome must not cancel a run on its own.
    #[must_use]
    pub fn from_json(value: &serde_json::Value) -> Self {
        if let Some(text) = value.get("outcome").and_then(serde_json::Value::as_str) {
            return if text == "cancelled" { Self::Cancelled } else { Self::Continue };
        }
        match value.get("code").and_then(serde_json::Value::as_u64) {
            Some(3) => Self::Cancelled,
            _ => Self::Continue,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_declared_three_are_canonical_names() {
        for name in SOUNDW_HOST_FUNCTIONS {
            assert!(CANONICAL_HOST_FUNCTIONS.contains(&name), "{name} left the vocabulary");
            assert!(name.starts_with(&format!("{HOST_FUNCTION_NAMESPACE}.")), "{name}");
        }
        assert!(CANONICAL_HOST_FUNCTIONS.contains(&HOST_FUNCTION_OPERATION_CHECKPOINT));
    }

    #[test]
    fn no_declared_name_is_a_retired_file_capability() {
        // ADR-0071: file IO is a preopen. This is the assertion that keeps this node honest about it.
        for name in SOUNDW_HOST_FUNCTIONS {
            assert!(
                !RETIRED_FILE_HOST_FUNCTIONS.contains(&name),
                "{name} was retired by ADR-0071; declare allowed_paths instead"
            );
            assert!(!name.starts_with("xiranite.fs."), "{name} is a file capability");
        }
    }

    #[test]
    fn symbols_are_the_dots_flattened_and_only_for_settled_names() {
        for name in CANONICAL_HOST_FUNCTIONS {
            let symbol = host_function_symbol(name).expect("settled name has a symbol");
            assert_eq!(symbol, name.replace('.', "_"), "{name}");
        }
        assert_eq!(host_function_symbol("xiranite.fs.stat"), None);
        assert_eq!(host_function_symbol("xiranite_process_run"), None, "a symbol is not a logical name");
    }

    #[test]
    fn the_process_request_carries_the_allowlist_shape() {
        let request =
            SoundwProcessRunRequest::new("op-1", SOUNDW_REGISTERED_COMMAND, &["mute".to_owned(), "--toggle".to_owned()]);
        let document = request.to_json();
        assert_eq!(
            document,
            serde_json::json!({
                "operationId": "op-1",
                "program": "soundswitch-cli",
                "args": ["mute", "--toggle"],
                "cwdToken": null,
                "timeoutMs": 15_000u64,
                "maxOutputBytes": 131_072u64,
            })
        );
        assert_eq!(request.cwd_token, None, "SoundW never sets a working directory");
    }

    #[test]
    fn a_process_response_needs_its_three_fields_and_an_exit_code() {
        let parsed = SoundwProcessRunResponse::from_json(
            &serde_json::json!({ "exitCode": 0, "stdout": "ok", "stderr": "", "timedOut": false }),
        )
        .expect("documented shape");
        assert_eq!(parsed.exit_code, 0);
        assert!(!parsed.timed_out);

        // Negative control: a `result` that is not the contract is reported, not guessed.
        let refused = SoundwProcessRunResponse::from_json(&serde_json::json!({ "stdout": "ok" }))
            .expect_err("missing exitCode");
        assert!(refused.contains("exitCode"), "{refused}");
    }

    #[test]
    fn an_envelope_distinguishes_success_refusal_and_garbage() {
        let ok = HostResponse::decode(r#"{"ok":true,"result":{"exitCode":1,"stdout":"a","stderr":"b"}}"#)
            .expect("envelope");
        assert!(matches!(ok, HostResponse::Ok(_)));

        let refused = HostResponse::decode(
            r#"{"ok":false,"error":{"code":"not_found","message":"SoundSwitch.CLI.exe is not registered"}}"#,
        )
        .expect("envelope");
        let HostResponse::Err(error) = refused else { panic!("expected a refusal") };
        assert_eq!(error.code, HostErrorCode::NotFound);
        assert_eq!(error.reported_code, None);
        assert!(error.message.contains("not registered"));

        let flat = HostResponse::decode(r#"{"ok":false,"error":"EPERM"}"#).expect("legacy envelope");
        let HostResponse::Err(error) = flat else { panic!("expected a refusal") };
        assert_eq!(error.message, "EPERM");

        assert!(HostResponse::decode("{}").is_err(), "an answer without `ok` is a decode failure");
        assert!(HostResponse::decode("not json").is_err());
    }

    #[test]
    fn an_unknown_host_code_is_kept_and_still_classified() {
        let (code, reported) = HostErrorCode::parse("process_start_failed");
        assert_eq!(code, HostErrorCode::HostFailure);
        assert_eq!(reported.as_deref(), Some("process_start_failed"));
        assert_eq!(HostErrorCode::parse("cancelled"), (HostErrorCode::Cancelled, None));
    }

    #[test]
    fn the_memory_ceiling_and_the_output_ceiling_agree() {
        let memory_bytes = u64::from(MEMORY_MAX_PAGES) * u64::from(WASM_PAGE_BYTES);
        assert!(MAX_OUTPUT_BYTES * 4 < memory_bytes, "one response block plus its JSON copy must fit");
    }
}
