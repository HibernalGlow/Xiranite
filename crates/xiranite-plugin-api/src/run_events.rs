//! Progress and log events reported by a plugin.
//!
//! `nodeRunEventSchema` in `packages/shared/src/index.ts` is the shape the
//! operation monitor renders today: a `progress` or `log` tag, a mandatory
//! message, an optional numeric progress value, and an optional structured
//! payload. Only the structured payload is opaque here; everything else is small
//! enough to be part of the ABI's vocabulary.
//!
//! Progress values are percentages, not fractions. The current nodes emit `0` and
//! `100` (`packages/nodes/sleept/src/core.ts`, `packages/nodes/recycleu/src/core.ts`)
//! and `NodeOperationMonitor.tsx` renders `Math.round(progress)%`, so a value
//! outside `0..=100` is a plugin bug the host should surface rather than clamp.

use std::fmt;

use crate::abi_code::AbiCode;
use crate::abi_code::UnknownAbiCode;
use crate::payload::OpaquePayload;

/// The `type` discriminator of `nodeRunEventSchema`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum PluginRunEventKind {
    /// Work is advancing; carries an optional percentage.
    Progress,
    /// A plain message line.
    Log,
}

impl PluginRunEventKind {
    /// Every kind in wire order.
    pub const ALL: &'static [Self] = &[Self::Progress, Self::Log];

    /// The JSON discriminator string.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Progress => "progress",
            Self::Log => "log",
        }
    }
}

impl AbiCode for PluginRunEventKind {
    fn abi_code(self) -> u8 {
        match self {
            Self::Progress => 1,
            Self::Log => 2,
        }
    }

    fn try_from_abi_code(code: u8) -> Result<Self, UnknownAbiCode> {
        match code {
            1 => Ok(Self::Progress),
            2 => Ok(Self::Log),
            other => Err(UnknownAbiCode::new(other)),
        }
    }
}

/// A validated progress percentage in `0..=100`.
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd)]
pub struct ProgressPercent(f64);

impl ProgressPercent {
    /// Lowest reportable value.
    pub const MINIMUM: f64 = 0.0;
    /// Highest reportable value.
    pub const MAXIMUM: f64 = 100.0;

    /// Takes a percentage, rejecting non-finite and out-of-range values.
    pub fn try_new(value: f64) -> Result<Self, ProgressValueRejected> {
        if value.is_finite() && (Self::MINIMUM..=Self::MAXIMUM).contains(&value) {
            Ok(Self(value))
        } else {
            Err(ProgressValueRejected { rejected: value })
        }
    }

    /// The percentage as reported.
    pub const fn get(self) -> f64 {
        self.0
    }

    /// The integer the operation monitor renders today.
    pub fn rounded_percentage(self) -> u32 {
        self.0.round() as u32
    }
}

/// A progress value the ABI refuses to carry.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ProgressValueRejected {
    /// The value that was rejected, echoed for the plugin's own log line.
    pub rejected: f64,
}

impl fmt::Display for ProgressValueRejected {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "progress {} is outside {}..={}",
            self.rejected,
            ProgressPercent::MINIMUM,
            ProgressPercent::MAXIMUM
        )
    }
}

impl std::error::Error for ProgressValueRejected {}

/// A `progress` event.
#[derive(Debug, Clone, PartialEq)]
pub struct ProgressEvent {
    /// Human-readable line, mandatory in today's schema.
    pub message: String,
    /// Percentage complete, absent when the plugin cannot estimate.
    pub percent: Option<ProgressPercent>,
    /// `nodeRunEventSchema.data`: live previews and other structured payloads.
    pub structured_data: Option<OpaquePayload>,
}

/// A `log` event.
#[derive(Debug, Clone, PartialEq)]
pub struct LogEvent {
    /// Human-readable line.
    pub message: String,
    /// Optional structured sidecar, allowed by the same schema field.
    pub structured_data: Option<OpaquePayload>,
}

/// One event in an operation's stream, as produced by `xiranite.operation.emit`.
#[derive(Debug, Clone, PartialEq)]
pub enum PluginRunEvent {
    /// Progress kind.
    Progress(ProgressEvent),
    /// Log kind.
    Log(LogEvent),
}

impl PluginRunEvent {
    /// A progress line with no percentage or structured payload.
    pub fn progress_message(message: impl Into<String>, percent: Option<ProgressPercent>) -> Self {
        Self::Progress(ProgressEvent {
            message: message.into(),
            percent,
            structured_data: None,
        })
    }

    /// A log line with no structured payload.
    pub fn log_message(message: impl Into<String>) -> Self {
        Self::Log(LogEvent {
            message: message.into(),
            structured_data: None,
        })
    }

    /// The discriminator the monitor switches on.
    pub fn kind(&self) -> PluginRunEventKind {
        match self {
            Self::Progress(_) => PluginRunEventKind::Progress,
            Self::Log(_) => PluginRunEventKind::Log,
        }
    }

    /// The message text, shared by both kinds.
    pub fn message(&self) -> &str {
        match self {
            Self::Progress(event) => &event.message,
            Self::Log(event) => &event.message,
        }
    }

    /// The percentage, present only on progress events that report one.
    pub fn percent(&self) -> Option<ProgressPercent> {
        match self {
            Self::Progress(event) => event.percent,
            Self::Log(_) => None,
        }
    }
}

/// Position of an event in its operation's stream.
///
/// The host assigns these (`NodeOperationEventDTO.index`), which is why
/// `xiranite.operation.emit` returns one: the plugin can then reference the event it just
/// reported instead of guessing from its own counter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct EventIndex(u64);

impl EventIndex {
    /// Wraps a host-assigned index.
    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    /// The index value.
    pub const fn get(self) -> u64 {
        self.0
    }

    /// The index the next emitted event will take.
    pub const fn next(self) -> Self {
        Self(self.0 + 1)
    }
}

impl fmt::Display for EventIndex {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::abi_code::assert_codes_round_trip;

    #[test]
    fn event_kind_codes_round_trip_and_keep_the_json_names() {
        assert_codes_round_trip(PluginRunEventKind::ALL);
        // nodeRunEventSchema.type is exactly this pair of strings.
        let names: Vec<&str> = PluginRunEventKind::ALL
            .iter()
            .map(|kind| kind.as_str())
            .collect();
        assert_eq!(names, vec!["progress", "log"]);
    }

    #[test]
    fn progress_percent_accepts_the_values_current_nodes_emit() {
        for value in [0.0, 25.5, 100.0] {
            let percent = ProgressPercent::try_new(value)
                .unwrap_or_else(|error| panic!("{value} rejected: {error}"));
            assert_eq!(percent.get(), value);
        }
        assert_eq!(
            ProgressPercent::try_new(100.0).expect("full").rounded_percentage(),
            100
        );
    }

    #[test]
    fn progress_percent_rejects_values_the_ui_would_have_to_clamp() {
        for value in [-0.5, 100.5, f64::NAN, f64::INFINITY] {
            assert!(
                ProgressPercent::try_new(value).is_err(),
                "{value} was accepted as a percentage"
            );
        }
        let error = ProgressPercent::try_new(f64::NAN).expect_err("NaN must be rejected");
        assert!(error.to_string().contains("NaN"), "{error}");
    }

    #[test]
    fn event_accessors_report_kind_message_and_percentage() {
        let percent = ProgressPercent::try_new(40.0).expect("in range");
        let progress = PluginRunEvent::progress_message("scanning D:/in", Some(percent));
        assert_eq!(progress.kind(), PluginRunEventKind::Progress);
        assert_eq!(progress.message(), "scanning D:/in");
        assert_eq!(progress.percent(), Some(percent));

        let log = PluginRunEvent::log_message("done");
        assert_eq!(log.kind(), PluginRunEventKind::Log);
        assert_eq!(log.percent(), None);
        assert_ne!(log, progress);
    }

    #[test]
    fn event_indices_are_monotonic_values() {
        let first = EventIndex::new(0);
        assert_eq!(first.next(), EventIndex::new(1));
        assert_eq!(first.to_string(), "0");
        assert!(first < EventIndex::new(7));
    }
}
