//! The host boundary the pure core is written against.
//!
//! `TimeuRuntime` is the Rust form of the TypeScript interface at `core.ts:65-76`,
//! with the same responsibilities and the same error contract: `path_info` and
//! `read_text` never fail (they mirror `platform.ts:23-39` and `platform.ts:51-57`,
//! which swallow `stat`/`readFile` errors into "missing"), while listing, writing
//! and stamping propagate. `join`/`dirname`/`basename` became pure functions with
//! default trait methods, and `now` moved from `() => Date` to epoch milliseconds
//! because `Date` cannot exist inside a WASM isolate.
//!
//! `checkpoint` is the ADR-0066 addition: the core yields once per work item and
//! the host decides whether that yield blocks, continues or stops the operation.
//! It has a default so a pure test double does not have to implement protocol
//! plumbing it is not exercising.

use std::fmt;

use crate::timeu_model::{TimeuDirectoryEntry, TimeuPathInfo, TimeuRunEvent};

/// A host refusal. The message is display text for the operation log; the
/// TypeScript core surfaced the same class of problem as `error.message`
/// (`core.ts:136`, `core.ts:141`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimeuHostError {
    pub message: String,
}

impl TimeuHostError {
    pub fn new(message: impl Into<String>) -> Self {
        Self { message: message.into() }
    }
}

impl fmt::Display for TimeuHostError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for TimeuHostError {}

/// `xiranite.checkpoint()` verdict (ADR-0066).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TimeuCheckpointOutcome {
    /// Not paused and not cancelled: the host returned immediately.
    Continue,
    /// The host waited for a resume and the operation is still running.
    Resumed,
    /// The operation was cancelled; the plugin must stop at this boundary.
    Cancelled { message: String },
}

impl TimeuCheckpointOutcome {
    /// Whether work may continue, which is true for both non-terminal verdicts.
    pub fn may_continue(&self) -> bool {
        !matches!(self, Self::Cancelled { .. })
    }
}

/// The ported `TimeuRuntime` (`core.ts:65-76`).
pub trait TimeuRuntime {
    /// `stat` plus the host's own path normalisation. Absence is data, not an
    /// error, exactly as `platform.ts:36-38` made it.
    fn path_info(&self, path: &str) -> Result<TimeuPathInfo, TimeuHostError>;

    /// One directory level; the core recurses (`core.ts:154-161`).
    fn list_directory(&self, path: &str) -> Result<Vec<TimeuDirectoryEntry>, TimeuHostError>;

    /// `readFile` with the `platform.ts:51-57` behaviour: unreadable or missing
    /// reads as `None`, because `loadTimestampRecords` treats that as "no stored
    /// records yet" rather than as a failure.
    fn read_text(&self, path: &str) -> Option<String>;

    fn write_text(&self, path: &str, content: &str) -> Result<(), TimeuHostError>;

    fn ensure_directory(&self, path: &str) -> Result<(), TimeuHostError>;

    /// `utimes(path, new Date(atimeMs), new Date(mtimeMs))` (`platform.ts:15`).
    fn set_times(&self, path: &str, atime_ms: f64, mtime_ms: f64) -> Result<(), TimeuHostError>;

    /// `Date.now()`, the only clock the plugin may use.
    fn now_epoch_ms(&self) -> Result<f64, TimeuHostError>;

    /// Cooperative yield between work items.
    fn checkpoint(&self) -> Result<TimeuCheckpointOutcome, TimeuHostError> {
        Ok(TimeuCheckpointOutcome::Continue)
    }

    /// Pure path operations, kept on the trait so a host implementation can
    /// override them with its own platform semantics if it ever needs to.
    fn join(&self, parts: &[&str]) -> String {
        crate::path_shape::path_join(parts)
    }

    fn dirname(&self, path: &str) -> String {
        crate::path_shape::path_dirname(path)
    }

    fn basename(&self, path: &str) -> String {
        crate::path_shape::path_basename(path)
    }
}

/// `onEvent` (`core.ts:96`), the progress/log stream the operation monitor and
/// `Component.tsx:119` render.
pub trait TimeuEventSink {
    fn on_event(&mut self, event: TimeuRunEvent);
}

/// Drops every event, the equivalent of the TypeScript default argument.
pub struct NoopTimeuEventSink;

impl TimeuEventSink for NoopTimeuEventSink {
    fn on_event(&mut self, _event: TimeuRunEvent) {}
}

/// Keeps events so a test can assert the exact progress chain.
#[derive(Debug, Clone, Default)]
pub struct CollectingTimeuEventSink {
    pub events: Vec<TimeuRunEvent>,
}

impl CollectingTimeuEventSink {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn messages(&self) -> Vec<String> {
        self.events.iter().map(|event| event.message.clone()).collect()
    }
}

impl TimeuEventSink for CollectingTimeuEventSink {
    fn on_event(&mut self, event: TimeuRunEvent) {
        self.events.push(event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checkpoint_verdicts_classify_continuation() {
        assert!(TimeuCheckpointOutcome::Continue.may_continue());
        assert!(TimeuCheckpointOutcome::Resumed.may_continue());
        assert!(!TimeuCheckpointOutcome::Cancelled { message: "stop".into() }.may_continue());
    }

    #[test]
    fn host_error_display_is_the_raw_message() {
        // core.ts:141 puts exactly `error.message` into the failure result.
        let error = TimeuHostError::new("EACCES: permission denied");
        assert_eq!(error.to_string(), "EACCES: permission denied");
    }

    #[test]
    fn collecting_sink_keeps_order_and_messages() {
        let mut sink = CollectingTimeuEventSink::new();
        sink.on_event(TimeuRunEvent::progress(15.0, "first"));
        sink.on_event(TimeuRunEvent::log("second"));
        assert_eq!(sink.messages(), vec!["first".to_string(), "second".to_string()]);
        assert_eq!(sink.events[0].progress, Some(15.0));
        assert_eq!(sink.events[1].progress, None);
    }
}
