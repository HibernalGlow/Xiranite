//! Session summaries and the 16-bucket storm/anomaly map, ported from `packages/nodes/logx/src/core.ts`.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::envelope::{LogEnvelope, LogSeverityText};
use crate::timestamp::parse_epoch_milliseconds;

/// `core.ts:114` fixes the anomaly map at 16 cells.
pub const LOGX_ANOMALY_CELL_COUNT: usize = 16;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogxSessionSummary {
    pub id: String,
    pub started_at: String,
    pub event_count: u64,
    pub error_count: u64,
    pub process_types: Vec<String>,
    pub scopes: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogxAnomalyCell {
    pub index: usize,
    pub event_count: u64,
    pub weighted_score: f64,
    pub intensity: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogxTelemetry {
    pub duration_ms: i64,
    pub events_per_second: f64,
    pub storm_intensity: f64,
    pub anomaly_cells: Vec<LogxAnomalyCell>,
}

struct SessionAccumulator {
    id: String,
    started_at: String,
    event_count: u64,
    error_count: u64,
    process_types: HashSet<String>,
    scopes: HashSet<String>,
}

/// `core.ts:100-111`: sessions keep first-seen order while their label sets are de-duplicated and sorted.
pub fn summarize_logx_sessions(events: &[LogEnvelope]) -> Vec<LogxSessionSummary> {
    let mut accumulators: Vec<SessionAccumulator> = Vec::new();
    let mut positions: HashMap<&str, usize> = HashMap::new();

    for event in events {
        let position = match positions.get(event.session.id.as_str()) {
            Some(position) => *position,
            None => {
                accumulators.push(SessionAccumulator {
                    id: event.session.id.clone(),
                    started_at: event.session.started_at.clone(),
                    event_count: 0,
                    error_count: 0,
                    process_types: HashSet::new(),
                    scopes: HashSet::new(),
                });
                positions.insert(event.session.id.as_str(), accumulators.len() - 1);
                accumulators.len() - 1
            }
        };
        let row = &mut accumulators[position];
        row.event_count += 1;
        if event.error.is_some()
            || event.severity_number >= LogSeverityText::Error.severity_number()
        {
            row.error_count += 1;
        }
        row.process_types
            .insert(event.resource.process_type.as_str().to_string());
        row.scopes.insert(event.scope.name.clone());
    }

    let mut summaries: Vec<LogxSessionSummary> = accumulators
        .into_iter()
        .map(|row| {
            let mut process_types: Vec<String> = row.process_types.into_iter().collect();
            let mut scopes: Vec<String> = row.scopes.into_iter().collect();
            process_types.sort();
            scopes.sort();
            LogxSessionSummary {
                id: row.id,
                started_at: row.started_at,
                event_count: row.event_count,
                error_count: row.error_count,
                process_types,
                scopes,
            }
        })
        .collect();
    summaries.sort_by(|left, right| right.started_at.cmp(&left.started_at));
    summaries
}

/// `core.ts:113-131`: spread the severity-weighted event count over 16 buckets covering the observed span.
pub fn create_logx_telemetry(events: &[LogEnvelope]) -> LogxTelemetry {
    let empty_cells = default_anomaly_cells();
    if events.is_empty() {
        return LogxTelemetry {
            duration_ms: 0,
            events_per_second: 0.0,
            storm_intensity: 0.0,
            anomaly_cells: empty_cells,
        };
    }

    let timed: Vec<(i64, LogSeverityText)> = events
        .iter()
        .filter_map(|event| {
            parse_epoch_milliseconds(&event.timestamp).map(|time| (time, event.severity_text))
        })
        .collect();
    if timed.is_empty() {
        // `core.ts:117` reports the raw count as the rate when no timestamp parsed.
        return LogxTelemetry {
            duration_ms: 0,
            events_per_second: events.len() as f64,
            storm_intensity: storm_intensity(events.len() as f64),
            anomaly_cells: empty_cells,
        };
    }

    let start = timed.iter().map(|(time, _)| *time).min().unwrap_or(0);
    let end = timed.iter().map(|(time, _)| *time).max().unwrap_or(0);
    let duration_ms = (end - start).max(0);
    let bucket_span = duration_ms.max(1) as f64;
    let mut cells: Vec<LogxAnomalyCell> = default_anomaly_cells();
    for (time, severity) in &timed {
        let scaled = ((*time - start) as f64 / bucket_span) * LOGX_ANOMALY_CELL_COUNT as f64;
        let index = scaled.floor().max(0.0) as usize;
        let index = index.min(LOGX_ANOMALY_CELL_COUNT - 1);
        cells[index].event_count += 1;
        cells[index].weighted_score += severity_weight(*severity);
    }

    let peak_score = cells
        .iter()
        .map(|cell| cell.weighted_score)
        .fold(1.0_f64, f64::max);
    for cell in &mut cells {
        cell.intensity = cell.weighted_score / peak_score;
    }

    let events_per_second = events.len() as f64 / (duration_ms as f64 / 1_000.0).max(1.0);
    LogxTelemetry {
        duration_ms,
        events_per_second,
        storm_intensity: storm_intensity(events_per_second),
        anomaly_cells: cells,
    }
}

fn default_anomaly_cells() -> Vec<LogxAnomalyCell> {
    (0..LOGX_ANOMALY_CELL_COUNT)
        .map(|index| LogxAnomalyCell {
            index,
            event_count: 0,
            weighted_score: 0.0,
            intensity: 0.0,
        })
        .collect()
}

/// `core.ts:160-167`.
pub(crate) fn severity_weight(severity: LogSeverityText) -> f64 {
    match severity {
        LogSeverityText::Fatal => 8.0,
        LogSeverityText::Error => 5.0,
        LogSeverityText::Warn => 2.0,
        LogSeverityText::Info => 0.5,
        LogSeverityText::Debug => 0.25,
        LogSeverityText::Trace => 0.1,
    }
}

/// `core.ts:169-171`: three decades of events per second saturate the storm gauge.
pub(crate) fn storm_intensity(events_per_second: f64) -> f64 {
    ((events_per_second + 1.0).log10() / 3.0).min(1.0)
}

#[cfg(test)]
mod tests {
    // Every expected float here is a dyadic rational (0.5, 1.0, 2.0), so exact equality is the strongest
    // assertion available and rounding tolerance would only weaken it.
    #![allow(clippy::float_cmp)]

    use super::*;
    use crate::envelope::LogProcessType;
    use crate::test_fixtures::LogEnvelopeFixture;

    /// `packages/nodes/logx/src/core.test.ts:22-24`
    #[test]
    fn summarizes_session_resources_without_duplicating_values() {
        let events = vec![
            LogEnvelopeFixture::new(
                "one",
                "2026-07-23T00:00:01.000Z",
                LogSeverityText::Info,
                "app.started",
                "app",
            )
            .build(),
            LogEnvelopeFixture::new(
                "two",
                "2026-07-23T00:00:02.000Z",
                LogSeverityText::Error,
                "reader.failed",
                "neoview.reader",
            )
            .with_process_type(LogProcessType::Backend)
            .with_error("DecodeError", "decode failed")
            .build(),
        ];
        let sessions = summarize_logx_sessions(&events);

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].event_count, 2);
        assert_eq!(sessions[0].error_count, 1);
        assert_eq!(
            sessions[0].process_types,
            vec!["backend".to_string(), "frontend".to_string()]
        );
        assert_eq!(
            sessions[0].scopes,
            vec!["app".to_string(), "neoview.reader".to_string()]
        );
    }

    #[test]
    fn newest_session_starts_first() {
        let events = vec![
            LogEnvelopeFixture::new(
                "old",
                "2026-07-23T00:00:01.000Z",
                LogSeverityText::Info,
                "app.started",
                "app",
            )
            .with_session("session-old", "2026-07-21T00:00:00.000Z")
            .build(),
            LogEnvelopeFixture::new(
                "new",
                "2026-07-23T00:00:02.000Z",
                LogSeverityText::Info,
                "app.started",
                "app",
            )
            .with_session("session-new", "2026-07-22T00:00:00.000Z")
            .build(),
        ];
        assert_eq!(
            summarize_logx_sessions(&events)
                .iter()
                .map(|session| session.id.as_str())
                .collect::<Vec<_>>(),
            vec!["session-new", "session-old"]
        );
    }

    /// `packages/nodes/logx/src/core.test.ts:26-32`
    #[test]
    fn builds_a_normalized_16_bucket_anomaly_map() {
        let events = vec![
            LogEnvelopeFixture::new(
                "one",
                "2026-07-23T00:00:01.000Z",
                LogSeverityText::Info,
                "app.started",
                "app",
            )
            .build(),
            LogEnvelopeFixture::new(
                "two",
                "2026-07-23T00:00:02.000Z",
                LogSeverityText::Error,
                "reader.failed",
                "neoview.reader",
            )
            .with_error("DecodeError", "decode failed")
            .build(),
        ];
        let telemetry = create_logx_telemetry(&events);

        assert_eq!(telemetry.duration_ms, 1_000);
        assert_eq!(telemetry.events_per_second, 2.0);
        assert_eq!(telemetry.anomaly_cells.len(), LOGX_ANOMALY_CELL_COUNT);
        assert_eq!(telemetry.anomaly_cells[15].event_count, 1);
        assert_eq!(telemetry.anomaly_cells[15].intensity, 1.0);
        assert_eq!(telemetry.anomaly_cells[0].event_count, 1);
        assert_eq!(telemetry.anomaly_cells[0].weighted_score, 0.5);
        assert_eq!(telemetry.anomaly_cells[0].intensity, 0.1);
        assert_eq!(telemetry.anomaly_cells[8].event_count, 0);
    }

    #[test]
    fn a_single_event_gives_a_one_second_floor_rate() {
        let events = vec![
            LogEnvelopeFixture::new(
                "one",
                "2026-07-23T00:00:02.000Z",
                LogSeverityText::Error,
                "reader.failed",
                "app",
            )
            .build(),
        ];
        let telemetry = create_logx_telemetry(&events);
        assert_eq!(telemetry.duration_ms, 0);
        assert_eq!(telemetry.events_per_second, 1.0);
        assert_eq!(telemetry.anomaly_cells[0].event_count, 1);
    }

    #[test]
    fn empty_and_unparseable_timestamp_inputs_keep_the_shared_zero_shape() {
        let empty = create_logx_telemetry(&[]);
        assert_eq!(empty.duration_ms, 0);
        assert_eq!(empty.events_per_second, 0.0);
        assert_eq!(empty.storm_intensity, 0.0);
        assert!(empty.anomaly_cells.iter().all(|cell| cell.event_count == 0));

        let unparseable = vec![
            LogEnvelopeFixture::new(
                "one",
                "not a timestamp",
                LogSeverityText::Warn,
                "app.started",
                "app",
            )
            .build(),
        ];
        let telemetry = create_logx_telemetry(&unparseable);
        assert_eq!(telemetry.duration_ms, 0);
        assert_eq!(telemetry.events_per_second, 1.0);
        assert_eq!(telemetry.storm_intensity, storm_intensity(1.0));
        assert!(
            telemetry
                .anomaly_cells
                .iter()
                .all(|cell| cell.event_count == 0)
        );
    }

    #[test]
    fn severity_weights_and_storm_gauge_match_the_typescript_curve() {
        assert_eq!(severity_weight(LogSeverityText::Fatal), 8.0);
        assert_eq!(severity_weight(LogSeverityText::Error), 5.0);
        assert_eq!(severity_weight(LogSeverityText::Warn), 2.0);
        assert_eq!(severity_weight(LogSeverityText::Info), 0.5);
        assert_eq!(severity_weight(LogSeverityText::Debug), 0.25);
        assert_eq!(severity_weight(LogSeverityText::Trace), 0.1);
        assert!((storm_intensity(99.0) - 2.0 / 3.0).abs() < 1e-12);
        assert!((storm_intensity(999.0) - 1.0).abs() < 1e-12);
        assert_eq!(storm_intensity(100_000.0), 1.0);
        assert_eq!(storm_intensity(0.0), 0.0);
    }
}
