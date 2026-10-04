//! The host functions a plugin may call.
//!
//! ADR-0066: "Plugins never touch the filesystem, spawn processes or reach the OS
//! directly, and file access additionally stays bounded by the Extism manifest's
//! `allowed_paths`, `allowed_hosts`, `memory` and `timeout` so permissions are
//! enforced in two layers."
//!
//! The methods are synchronous on purpose. An Extism host function is a
//! synchronous call into the host, and pause is implemented as a *wait inside that
//! call* (ADR-0066), not as an await the plugin schedules: while
//! [`HostCalls::checkpoint`] does not return, the plugin's wasm frame is simply
//! still on the call. Nothing in this trait is async, so a plugin shim on
//! `wasm32-unknown-unknown` and the host's in-process implementation share it
//! without an executor.
//!
//! Implementors are the plugin-side shim (each method forwards to the host
//! function of the same name in [`crate::host_function_names`]) and the host
//! itself (which serves the same trait directly for embedded runs and tests).

use std::fmt;

use crate::abi_code::AbiCode;
use crate::abi_code::UnknownAbiCode;
use crate::checkpoint::CheckpointOutcome;
use crate::run_events::{EventIndex, PluginRunEvent};
use crate::run_options::ResourceAdmissionRequest;
use crate::tokens::ResourceLeaseToken;
use crate::tokens::{FileHandleToken, PathToken};

/// How an open handle will be used.
///
/// ADR-0066 names `xiranite.fs.open`, `.read` and `.write` but does not decide
/// creation, truncation or append policy; that stays a host decision behind this
/// two-value mode rather than a flag set this crate invents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum FileAccessMode {
    /// Read bytes from the start of the file.
    Read,
    /// Write bytes through the host's file-operation journal.
    Write,
}

impl FileAccessMode {
    /// Every mode in wire order.
    pub const ALL: &'static [Self] = &[Self::Read, Self::Write];
}

impl AbiCode for FileAccessMode {
    fn abi_code(self) -> u8 {
        match self {
            Self::Read => 1,
            Self::Write => 2,
        }
    }

    fn try_from_abi_code(code: u8) -> Result<Self, UnknownAbiCode> {
        match code {
            1 => Ok(Self::Read),
            2 => Ok(Self::Write),
            other => Err(UnknownAbiCode::new(other)),
        }
    }
}

/// The kind of failure a host function reports, without its message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum HostCallErrorCode {
    /// The operation is cancelled or terminal, so the call was refused.
    Cancelled,
    /// The manifest's `allowed_paths` or `allowed_hosts` does not cover the call.
    PermissionDenied,
    /// The path or handle no longer exists.
    NotFound,
    /// A manifest memory or timeout ceiling, or an event-buffer ceiling, refused
    /// the call.
    BudgetExceeded,
    /// The token is not one the host minted for this operation.
    InvalidToken,
    /// Anything the host itself failed at.
    HostFailure,
}

impl HostCallErrorCode {
    /// Every code in wire order.
    pub const ALL: &'static [Self] = &[
        Self::Cancelled,
        Self::PermissionDenied,
        Self::NotFound,
        Self::BudgetExceeded,
        Self::InvalidToken,
        Self::HostFailure,
    ];

    /// Stable ABI name. These are boundary identifiers, not HTTP DTO fields: the
    /// HTTP surface keeps reporting `{ error: message }` as it does today.
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
}

impl AbiCode for HostCallErrorCode {
    fn abi_code(self) -> u8 {
        match self {
            Self::Cancelled => 1,
            Self::PermissionDenied => 2,
            Self::NotFound => 3,
            Self::BudgetExceeded => 4,
            Self::InvalidToken => 5,
            Self::HostFailure => 6,
        }
    }

    fn try_from_abi_code(code: u8) -> Result<Self, UnknownAbiCode> {
        match code {
            1 => Ok(Self::Cancelled),
            2 => Ok(Self::PermissionDenied),
            3 => Ok(Self::NotFound),
            4 => Ok(Self::BudgetExceeded),
            5 => Ok(Self::InvalidToken),
            6 => Ok(Self::HostFailure),
            other => Err(UnknownAbiCode::new(other)),
        }
    }
}

impl fmt::Display for HostCallErrorCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// A host-function call that did not succeed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostCallError {
    /// The operation is cancelled or already terminal. A plugin must treat this as
    /// the same hard stop as a cancelled checkpoint, because the host is no longer
    /// recording what it does.
    Cancelled,
    /// Refused by the manifest allow-list.
    PermissionDenied {
        /// Host-side explanation, safe to show the user.
        message: String,
    },
    /// The path or handle is gone.
    NotFound {
        /// Host-side explanation.
        message: String,
    },
    /// A ceiling refused the call.
    BudgetExceeded {
        /// Host-side explanation naming the ceiling.
        message: String,
    },
    /// A token the host does not recognize for this operation.
    InvalidToken,
    /// The host failed for a reason the plugin cannot act on.
    HostFailure {
        /// Host-side explanation.
        message: String,
    },
}

impl HostCallError {
    /// The kind, for a plugin that branches on it, and for the audit ADR-0066 asks
    /// for.
    pub const fn code(&self) -> HostCallErrorCode {
        match self {
            Self::Cancelled => HostCallErrorCode::Cancelled,
            Self::PermissionDenied { .. } => HostCallErrorCode::PermissionDenied,
            Self::NotFound { .. } => HostCallErrorCode::NotFound,
            Self::BudgetExceeded { .. } => HostCallErrorCode::BudgetExceeded,
            Self::InvalidToken => HostCallErrorCode::InvalidToken,
            Self::HostFailure { .. } => HostCallErrorCode::HostFailure,
        }
    }

    /// Whether the plugin should stop processing items.
    pub const fn is_hard_stop(&self) -> bool {
        matches!(self, Self::Cancelled)
    }
}

impl fmt::Display for HostCallError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cancelled => formatter.write_str("operation cancelled"),
            Self::InvalidToken => formatter.write_str("token is not valid for this operation"),
            Self::PermissionDenied { message }
            | Self::NotFound { message }
            | Self::BudgetExceeded { message }
            | Self::HostFailure { message } => write!(formatter, "{}: {}", self.code(), message),
        }
    }
}

impl std::error::Error for HostCallError {}

/// The path a token stood for, as the host authorized it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedPath {
    /// The path text. Plugins display it; they do not open it directly, since
    /// opening still needs a token the host issued.
    pub path: String,
}

/// The host surface available to a running plugin.
pub trait HostCalls {
    /// `xiranite.operation.checkpoint` — yields at an item boundary, waits while the
    /// operation is paused, and answers
    /// [`Cancelled`](CheckpointOutcome::Cancelled) once the operation is
    /// cancelled. A batch plugin is obligated to call this per item, which is what
    /// makes it pausable at all.
    fn checkpoint(&self) -> Result<CheckpointOutcome, HostCallError>;

    /// `xiranite.operation.emit` — appends one event to the owning operation's stream and
    /// returns the index the host assigned.
    fn emit(&self, event: &PluginRunEvent) -> Result<EventIndex, HostCallError>;

    /// `xiranite.scheduler.acquire` — asks the resource scheduler for a CPU, IO or
    /// GPU permit and returns the owned permit as a token.
    ///
    /// The ADRs describe owned permits but never say how a plugin gives one back
    /// across the boundary, so this trait does not invent a release call.
    fn scheduler_acquire(
        &self,
        request: &ResourceAdmissionRequest,
    ) -> Result<ResourceLeaseToken, HostCallError>;

    /// `xiranite.fs.open` — opens an authorized path and returns a handle token.
    fn file_open(
        &self,
        path: PathToken,
        mode: FileAccessMode,
    ) -> Result<FileHandleToken, HostCallError>;

    /// `xiranite.fs.read` — reads at most `max_bytes` from a handle.
    ///
    /// The caller names the chunk size because ADR-0066's rule against byte blobs is only real if
    /// nothing can ask for "the rest" of a file in one call. The width is `u32` rather than `usize`
    /// because ADR-0068 bans machine words as boundary types. An empty vector means end of stream.
    fn file_read(
        &self,
        handle: FileHandleToken,
        offset: u64,
        max_bytes: u32,
    ) -> Result<Vec<u8>, HostCallError>;

    /// `xiranite.fs.write` — writes one bounded chunk through the host's
    /// file-operation journal.
    fn file_write(&self, handle: FileHandleToken, bytes: &[u8]) -> Result<(), HostCallError>;

    /// `xiranite.fs.move` — moves one authorized path onto another.
    fn file_move(&self, source: PathToken, destination: PathToken) -> Result<(), HostCallError>;

    /// `xiranite.fs.delete` — deletes an authorized path. The host journals the
    /// deletion so its own restore path keeps working; a plugin does not get a
    /// recovery handle from this call.
    fn file_delete(&self, path: PathToken) -> Result<(), HostCallError>;

    /// `xiranite.path_token.resolve` — the path a token stands for, for display
    /// and for result reporting.
    fn path_token_resolve(&self, token: PathToken) -> Result<ResolvedPath, HostCallError>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::abi_code::assert_codes_round_trip;

    #[test]
    fn access_mode_and_error_codes_round_trip() {
        assert_codes_round_trip(FileAccessMode::ALL);
        assert_codes_round_trip(HostCallErrorCode::ALL);
        assert_eq!(FileAccessMode::ALL.len(), 2);
    }

    #[test]
    fn error_code_matches_the_variant_that_carries_it() {
        for (error, expected) in [
            (HostCallError::Cancelled, HostCallErrorCode::Cancelled),
            (
                HostCallError::PermissionDenied {
                    message: "outside allowed_paths".to_owned(),
                },
                HostCallErrorCode::PermissionDenied,
            ),
            (
                HostCallError::NotFound {
                    message: "gone".to_owned(),
                },
                HostCallErrorCode::NotFound,
            ),
            (
                HostCallError::BudgetExceeded {
                    message: "memory limit".to_owned(),
                },
                HostCallErrorCode::BudgetExceeded,
            ),
            (HostCallError::InvalidToken, HostCallErrorCode::InvalidToken),
            (
                HostCallError::HostFailure {
                    message: "sqlite busy".to_owned(),
                },
                HostCallErrorCode::HostFailure,
            ),
        ] {
            assert_eq!(error.code(), expected, "{error}");
        }
    }

    #[test]
    fn only_cancellation_is_a_hard_stop() {
        assert!(HostCallError::Cancelled.is_hard_stop());
        assert!(!HostCallError::InvalidToken.is_hard_stop());
        assert!(
            !HostCallError::HostFailure {
                message: "transient".to_owned()
            }
            .is_hard_stop()
        );
    }

    #[test]
    fn messages_survive_the_display_and_the_code() {
        let error = HostCallError::PermissionDenied {
            message: "D:/outside is not in allowed_paths".to_owned(),
        };
        let rendered = error.to_string();
        assert!(rendered.starts_with("permission_denied:"), "{rendered}");
        assert!(rendered.contains("allowed_paths"), "{rendered}");
        assert_eq!(
            HostCallErrorCode::try_from_abi_code(error.code().abi_code()),
            Ok(HostCallErrorCode::PermissionDenied)
        );
    }
}
