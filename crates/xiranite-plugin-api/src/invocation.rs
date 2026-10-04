//! Request and response envelope for one plugin invocation.
//!
//! The envelope is the WASM-side counterpart of two things that exist today: the
//! `POST /nodes/:id/operations` body (`nodeRunRequestSchema`: an `input` plus a
//! `componentId`/`workspaceId` context) and the `{ result, events }` pair a node
//! run returns. Events are *not* in the response, because a plugin reports them
//! while it runs through `xiranite.operation.emit` — the host cannot wait for a call that
//! may be sitting in a paused checkpoint.
//!
//! The result keeps today's `success` boolean even though the response enum also
//! says how the run terminated. `finishOperation()` in
//! `packages/services/src/index.ts` writes the `error` phase whenever
//! `success == false`, so the two fields agree today; keeping both here means the
//! host can serialize the existing DTO without inventing a lossy mapping, and
//! [`PluginInvocationResponse::try_completed`] is what enforces the agreement.

use std::collections::BTreeMap;
use std::fmt;

use crate::operation_status::OperationPhase;
use crate::payload::OpaquePayload;
use crate::run_events::EventIndex;
use crate::run_options::PluginRunOptions;
use crate::tokens::PathToken;

/// Everything a plugin entry point receives for one call.
#[derive(Debug, Clone, PartialEq)]
pub struct PluginInvocationRequest {
    /// Scope, ceilings and entry point for this run.
    pub run_options: PluginRunOptions,
    /// Paths the host authorized before the call, as tokens.
    ///
    /// ADR-0066 requires paths to cross as tokens rather than as repeated
    /// strings, but does not decide how a token first reaches a plugin; handing
    /// them with the request is the smallest shape that works, and a plugin cannot
    /// mint one for a path outside the manifest's `allowed_paths` because the host
    /// rejects the token when it is used.
    pub authorized_paths: Vec<PathToken>,
    /// `nodeRunRequestSchema.input`, as the JSON bytes it already is.
    pub input: OpaquePayload,
}

impl PluginInvocationRequest {
    /// A request with no authorized paths yet.
    pub fn new(run_options: PluginRunOptions, input: OpaquePayload) -> Self {
        Self {
            run_options,
            authorized_paths: Vec::new(),
            input,
        }
    }
}

/// The value a plugin returns, mirroring `nodeRunResultSchema`.
#[derive(Debug, Clone, PartialEq)]
pub struct PluginRunResult {
    /// `success` from the existing DTO.
    pub success: bool,
    /// `message`: the line the history row and monitor show.
    pub message: String,
    /// `data`: structured result payload.
    pub data: Option<OpaquePayload>,
    /// `stats`. A `BTreeMap` rather than a hash map so a host that encodes this
    /// into a history row twice produces the same bytes twice.
    pub stats: BTreeMap<String, f64>,
    /// `outputPath`, carried as a token per ADR-0066; the host resolves it into the
    /// string the HTTP DTO publishes.
    pub output_path: Option<PathToken>,
}

impl PluginRunResult {
    /// A successful result with only a message.
    pub fn succeeded(message: impl Into<String>) -> Self {
        Self {
            success: true,
            message: message.into(),
            data: None,
            stats: BTreeMap::new(),
            output_path: None,
        }
    }

    /// A failed result with only a message.
    pub fn failed(message: impl Into<String>) -> Self {
        Self {
            success: false,
            message: message.into(),
            data: None,
            stats: BTreeMap::new(),
            output_path: None,
        }
    }
}

/// How a plugin call ended.
///
/// Each variant carries only what that ending can carry: a `Completed` call must
/// have a successful result, and a `Failed` call must have the message that today
/// becomes the `error` phase's history line.
#[derive(Debug, Clone, PartialEq)]
pub enum PluginInvocationResponse {
    /// The plugin ran to its own end and reported success.
    Completed {
        /// The successful result.
        result: PluginRunResult,
        /// Highest event index the host assigned to this call, if it emitted any.
        last_event_index: Option<EventIndex>,
    },
    /// The plugin stopped at a checkpoint that answered
    /// [`Cancelled`](crate::checkpoint::CheckpointOutcome::Cancelled).
    Cancelled {
        /// Whatever the plugin had produced; cancellation may end a run with no
        /// result at all, which is when the host writes its own cancel message.
        partial_result: Option<PluginRunResult>,
        /// Highest event index assigned to this call, if it emitted any.
        last_event_index: Option<EventIndex>,
    },
    /// The plugin reported failure, or its call ended without a result.
    Failed {
        /// The failure line, mandatory as it is in `nodeRunResultSchema.message`.
        message: String,
        /// Highest event index assigned to this call, if it emitted any.
        last_event_index: Option<EventIndex>,
    },
}

impl PluginInvocationResponse {
    /// Completes a run with a result, refusing an unsuccessful one.
    pub fn try_completed(
        result: PluginRunResult,
        last_event_index: Option<EventIndex>,
    ) -> Result<Self, CompletionContradiction> {
        if !result.success {
            return Err(CompletionContradiction::UnsuccessfulResultCannotComplete {
                message: result.message,
            });
        }
        Ok(Self::Completed {
            result,
            last_event_index,
        })
    }

    /// Ends a run because a checkpoint answered cancellation.
    pub fn cancelled(
        partial_result: Option<PluginRunResult>,
        last_event_index: Option<EventIndex>,
    ) -> Self {
        Self::Cancelled {
            partial_result,
            last_event_index,
        }
    }

    /// Ends a run with a failure message.
    pub fn failed(message: impl Into<String>, last_event_index: Option<EventIndex>) -> Self {
        Self::Failed {
            message: message.into(),
            last_event_index,
        }
    }

    /// The operation phase this ending writes, matching `finishOperation()` in
    /// `packages/services/src/index.ts`: success completes, failure is `error`,
    /// cancellation is `cancelled`.
    pub fn terminated_phase(&self) -> OperationPhase {
        match self {
            Self::Completed { .. } => OperationPhase::Completed,
            Self::Cancelled { .. } => OperationPhase::Cancelled,
            Self::Failed { .. } => OperationPhase::Error,
        }
    }

    /// The result if the plugin produced one.
    pub fn result(&self) -> Option<&PluginRunResult> {
        match self {
            Self::Completed { result, .. } => Some(result),
            Self::Cancelled { partial_result, .. } => partial_result.as_ref(),
            Self::Failed { .. } => None,
        }
    }

    /// The event index the host should resume counting from, if any event was
    /// emitted. `None` keeps the operation's own counter, which is what a plugin
    /// that never emitted reports.
    pub fn last_event_index(&self) -> Option<EventIndex> {
        match self {
            Self::Completed {
                last_event_index, ..
            }
            | Self::Cancelled {
                last_event_index, ..
            }
            | Self::Failed {
                last_event_index, ..
            } => *last_event_index,
        }
    }
}

/// A completion that contradicts the result it was given.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CompletionContradiction {
    /// `success == false` cannot complete an operation.
    UnsuccessfulResultCannotComplete {
        /// The message the rejected result carried, so the caller can log it.
        message: String,
    },
}

impl fmt::Display for CompletionContradiction {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsuccessfulResultCannotComplete { message } => write!(
                formatter,
                "an unsuccessful result cannot complete an operation: {message}"
            ),
        }
    }
}

impl std::error::Error for CompletionContradiction {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identifiers::{OperationId, PluginEntryPoint, PluginId};
    use crate::run_options::PluginRunOptions;

    fn request() -> PluginInvocationRequest {
        let options = PluginRunOptions::new(
            OperationId::try_new("op-1").expect("operation id"),
            PluginId::try_new("enginev").expect("plugin id"),
            PluginEntryPoint::try_new("scan").expect("entry point"),
        );
        PluginInvocationRequest::new(options, OpaquePayload::from_text(r#"{"folders":[]}"#))
    }

    #[test]
    fn request_carries_scope_input_and_no_paths_by_default() {
        let request = request();
        assert_eq!(request.run_options.operation_id.as_str(), "op-1");
        assert_eq!(request.run_options.entry_point.as_str(), "scan");
        assert!(request.authorized_paths.is_empty());
        assert_eq!(request.input.as_text(), Some(r#"{"folders":[]}"#));
    }

    #[test]
    fn completed_response_refuses_an_unsuccessful_result() {
        // finishOperation() writes `error` for success == false, so a Completed
        // variant carrying that result would put two truths on the wire.
        let failure = PluginRunResult::failed("nothing matched");
        assert_eq!(
            PluginInvocationResponse::try_completed(failure, None),
            Err(CompletionContradiction::UnsuccessfulResultCannotComplete {
                message: "nothing matched".to_owned()
            })
        );

        let success = PluginRunResult::succeeded("320 files");
        let response = PluginInvocationResponse::try_completed(success, Some(EventIndex::new(7)))
            .expect("successful result completes");
        assert_eq!(response.terminated_phase(), OperationPhase::Completed);
        assert_eq!(response.last_event_index(), Some(EventIndex::new(7)));
        assert_eq!(
            response.result().map(|result| result.message.as_str()),
            Some("320 files")
        );
    }

    #[test]
    fn each_ending_writes_the_phase_the_backend_writes_today() {
        assert_eq!(
            PluginInvocationResponse::cancelled(None, None).terminated_phase(),
            OperationPhase::Cancelled
        );
        assert_eq!(
            PluginInvocationResponse::failed("decoder crashed", None).terminated_phase(),
            OperationPhase::Error
        );
        let cancelled_with_work = PluginInvocationResponse::cancelled(
            Some(PluginRunResult::failed("stopped after 12 of 40 files")),
            Some(EventIndex::new(11)),
        );
        assert!(cancelled_with_work.result().is_some_and(|result| !result.success));
        assert_eq!(cancelled_with_work.last_event_index(), Some(EventIndex::new(11)));
        assert!(PluginInvocationResponse::failed("x", None).result().is_none());
    }

    #[test]
    fn result_defaults_are_empty_rather_than_absent() {
        let result = PluginRunResult::succeeded("done");
        assert!(result.stats.is_empty());
        assert_eq!(result.data, None);
        assert_eq!(result.output_path, None);
        assert!(result.success);
    }
}
