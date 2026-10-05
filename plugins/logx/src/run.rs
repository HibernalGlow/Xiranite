//! LogX input normalization and the run pipeline, ported from `packages/nodes/logx/src/core.ts`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::envelope::{LogEnvelope, LogSeverityText};
use crate::jsonl::{LogParseIssueCode, parse_log_jsonl};
use crate::query::{LogAggregate, LogQuery, LogSortOrder, aggregate_logs, query_logs};
use crate::telemetry::{
    LogxSessionSummary, LogxTelemetry, create_logx_telemetry, summarize_logx_sessions,
};

pub const LOGX_DEFAULT_RESULT_LIMIT: i64 = 500;
pub const LOGX_MINIMUM_RESULT_LIMIT: i64 = 1;
pub const LOGX_MAXIMUM_RESULT_LIMIT: i64 = 5_000;

/// `core.ts:136,138,153`: the same three progress steps the Bun node reported.
pub const LOGX_PROGRESS_READING: f64 = 15.0;
pub const LOGX_PROGRESS_QUERYING: f64 = 60.0;
pub const LOGX_PROGRESS_COMPLETED: f64 = 100.0;
pub const LOGX_PROGRESS_READING_MESSAGE: &str = "Reading rotated JSONL log files.";
pub const LOGX_PROGRESS_QUERYING_MESSAGE: &str = "Applying structured log query.";

/// ADR-0066 has no TypeScript counterpart: a cancelled plugin stops at the next checkpoint.
pub const LOGX_CANCELLED_MESSAGE: &str = "LogX run cancelled at a checkpoint.";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogxAction {
    Query,
    Sessions,
    Stats,
    Errors,
    Doctor,
}

/// What the host answers at `xiranite.checkpoint()`: pause waits inside the host, cancel is terminal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogxCheckpointDecision {
    Continue,
    Cancel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LogxCancelled;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogxInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<LogxAction>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub directory: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minimum_severity: Option<LogSeverityText>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<LogSortOrder>,
}

/// `normalizeLogxInput` output: defaults applied, blank strings dropped, limit clamped.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedLogxInput {
    pub action: LogxAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub directory: Option<String>,
    pub minimum_severity: LogSeverityText,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until: Option<String>,
    pub limit: i64,
    pub order: LogSortOrder,
}

/// One line of host-supplied JSONL: `readLogDirectory` (`packages/logging/src/node.ts:156-175`) owns
/// discovery, gzip decode and reading, so the plugin only ever sees already-decoded text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogxSourceFile {
    pub path: String,
    pub jsonl_text: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogxSource {
    pub directory: String,
    pub files: Vec<LogxSourceFile>,
}

/// `LogxReadResult` (`core.ts:20-25`); parse issues keep the file name and drop `raw` (`platform.ts:9`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogxReadResult {
    pub directory: String,
    pub events: Vec<LogEnvelope>,
    pub issues: Vec<LogxReadIssue>,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogxReadIssue {
    pub file: String,
    pub line_number: i64,
    pub code: LogParseIssueCode,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogxData {
    pub action: LogxAction,
    pub directory: String,
    pub files: Vec<String>,
    pub issues: Vec<LogxReadIssue>,
    pub matched_count: usize,
    pub returned_count: usize,
    pub events: Vec<LogEnvelope>,
    pub aggregate: LogAggregate,
    pub sessions: Vec<LogxSessionSummary>,
    pub telemetry: LogxTelemetry,
}

/// `NodeRunResultDTO` (`packages/shared/src/index.ts:363-369`); LogX never sets `stats` or `outputPath`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogxResult {
    pub success: bool,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<LogxData>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stats: Option<BTreeMap<String, f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
}

/// `NodeRunEventDTO` (`packages/shared/src/index.ts:91-98`) for the events LogX emits.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogxProgressEvent {
    #[serde(rename = "type")]
    pub event_type: LogxProgressEventType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<f64>,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogxProgressEventType {
    Progress,
    Log,
}

impl LogxResult {
    pub(crate) fn failure(message: impl Into<String>) -> Self {
        Self {
            success: false,
            message: message.into(),
            data: None,
            stats: None,
            output_path: None,
        }
    }
}

impl LogxProgressEvent {
    pub fn progress(progress: f64, message: impl Into<String>) -> Self {
        Self {
            event_type: LogxProgressEventType::Progress,
            progress: Some(progress),
            message: message.into(),
            data: None,
        }
    }
}

pub fn normalize_logx_input(input: &LogxInput) -> NormalizedLogxInput {
    NormalizedLogxInput {
        action: input.action.unwrap_or(LogxAction::Query),
        directory: clean_option_string(input.directory.as_deref()),
        minimum_severity: input.minimum_severity.unwrap_or(LogSeverityText::Trace),
        scope: clean_option_string(input.scope.as_deref()),
        event_name: clean_option_string(input.event_name.as_deref()),
        session_id: clean_option_string(input.session_id.as_deref()),
        search: clean_option_string(input.search.as_deref()),
        since: clean_option_string(input.since.as_deref()),
        until: clean_option_string(input.until.as_deref()),
        limit: clamp_integer(
            input.limit,
            LOGX_MINIMUM_RESULT_LIMIT,
            LOGX_MAXIMUM_RESULT_LIMIT,
            LOGX_DEFAULT_RESULT_LIMIT,
        ),
        order: input.order.unwrap_or(LogSortOrder::Desc),
    }
}

/// `core.ts:85-98`: filters stay out of the query entirely when they are blank.
pub fn create_logx_query(input: &LogxInput) -> LogQuery {
    create_logx_query_with_limit(input, true)
}

pub fn create_logx_query_with_limit(input: &LogxInput, include_limit: bool) -> LogQuery {
    logx_query_from_normalized(&normalize_logx_input(input), include_limit)
}

pub(crate) fn logx_query_from_normalized(
    normalized: &NormalizedLogxInput,
    include_limit: bool,
) -> LogQuery {
    LogQuery {
        minimum_severity: Some(normalized.minimum_severity),
        scopes: normalized.scope.clone().map(|scope| vec![scope]),
        event_names: normalized.event_name.clone().map(|name| vec![name]),
        session_ids: normalized.session_id.clone().map(|id| vec![id]),
        search: normalized.search.clone(),
        since: normalized.since.clone(),
        until: normalized.until.clone(),
        order: Some(normalized.order),
        limit: include_limit.then_some(normalized.limit),
        ..LogQuery::default()
    }
}

/// The pure half of `runLogx` (`core.ts:133-158`) once the host has supplied the log source.
pub fn run_logx(
    input: &LogxInput,
    read_result: &LogxReadResult,
    on_progress: &mut dyn FnMut(&LogxProgressEvent),
) -> LogxResult {
    on_progress(&LogxProgressEvent::progress(
        LOGX_PROGRESS_READING,
        LOGX_PROGRESS_READING_MESSAGE,
    ));
    finish_logx_run(input, read_result, on_progress)
}

/// `runLogx` over host-decoded file text: the JSONL parse stays here so the plugin owns validation,
/// and each file ends with a checkpoint so the operation stays pausable and cancellable.
pub fn run_logx_from_source(
    input: &LogxInput,
    source: &LogxSource,
    on_progress: &mut dyn FnMut(&LogxProgressEvent),
    on_checkpoint: &mut dyn FnMut() -> LogxCheckpointDecision,
) -> LogxResult {
    on_progress(&LogxProgressEvent::progress(
        LOGX_PROGRESS_READING,
        LOGX_PROGRESS_READING_MESSAGE,
    ));
    match read_logx_source(source, on_checkpoint) {
        Ok(read_result) => finish_logx_run(input, &read_result, on_progress),
        Err(_) => LogxResult::failure(LOGX_CANCELLED_MESSAGE),
    }
}

pub fn read_logx_source(
    source: &LogxSource,
    on_checkpoint: &mut dyn FnMut() -> LogxCheckpointDecision,
) -> Result<LogxReadResult, LogxCancelled> {
    let mut events: Vec<LogEnvelope> = Vec::new();
    let mut issues: Vec<LogxReadIssue> = Vec::new();
    let mut files: Vec<String> = Vec::new();

    for file in &source.files {
        let parsed = parse_log_jsonl(&file.jsonl_text);
        events.extend(parsed.events);
        issues.extend(parsed.issues.into_iter().map(|issue| LogxReadIssue {
            file: file.path.clone(),
            line_number: issue.line_number,
            code: issue.code,
            message: issue.message,
        }));
        files.push(file.path.clone());
        if on_checkpoint() == LogxCheckpointDecision::Cancel {
            return Err(LogxCancelled);
        }
    }

    Ok(LogxReadResult {
        directory: source.directory.clone(),
        events,
        issues,
        files,
    })
}

fn finish_logx_run(
    input: &LogxInput,
    read_result: &LogxReadResult,
    on_progress: &mut dyn FnMut(&LogxProgressEvent),
) -> LogxResult {
    let normalized = normalize_logx_input(input);
    on_progress(&LogxProgressEvent::progress(
        LOGX_PROGRESS_QUERYING,
        LOGX_PROGRESS_QUERYING_MESSAGE,
    ));
    // The query runs without a limit so aggregate, sessions and telemetry see every match (`core.ts:139-151`).
    let all_matches = query_logs(
        &read_result.events,
        &logx_query_from_normalized(&normalized, false),
    );
    let events: Vec<LogEnvelope> = all_matches
        .iter()
        .take(normalized.limit.max(0) as usize)
        .cloned()
        .collect();
    let matched_count = all_matches.len();
    let issue_count = read_result.issues.len();
    let message = if issue_count > 0 {
        format!("Matched {matched_count} event(s) with {issue_count} parse issue(s).")
    } else {
        format!("Matched {matched_count} log event(s).")
    };

    on_progress(&LogxProgressEvent::progress(
        LOGX_PROGRESS_COMPLETED,
        format!("Matched {matched_count} log event(s)."),
    ));

    LogxResult {
        success: issue_count == 0,
        data: Some(LogxData {
            action: normalized.action,
            directory: read_result.directory.clone(),
            files: read_result.files.clone(),
            issues: read_result.issues.clone(),
            matched_count,
            returned_count: events.len(),
            events,
            aggregate: aggregate_logs(&all_matches),
            sessions: summarize_logx_sessions(&all_matches),
            telemetry: create_logx_telemetry(&all_matches),
        }),
        message,
        stats: None,
        output_path: None,
    }
}

/// `core.ts:173-176`: trim, then treat an empty result as absent.
fn clean_option_string(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// `core.ts:178-181`: non-finite values fall back, everything else truncates toward zero and clamps.
fn clamp_integer(value: Option<f64>, minimum: i64, maximum: i64, fallback: i64) -> i64 {
    match value {
        Some(value) if value.is_finite() => {
            let truncated = value.trunc();
            truncated.min(maximum as f64).max(minimum as f64) as i64
        }
        _ => fallback,
    }
}

#[cfg(test)]
mod tests {
    // Progress percentages and rates are dyadic rationals, so exact equality is the
    // strongest assertion available here.
    #![allow(clippy::float_cmp)]

    use super::*;
    use crate::envelope::LogProcessType;
    use crate::jsonl::serialize_log_envelope;
    use crate::test_fixtures::LogEnvelopeFixture;
    use serde_json::json;

    fn input_json(value: Value) -> LogxInput {
        serde_json::from_value(value).unwrap()
    }

    fn fixture_source() -> LogxSource {
        let events = LogEnvelopeFixture::logx_test_events();
        let text = events
            .iter()
            .map(serialize_log_envelope)
            .collect::<Vec<_>>()
            .join("\n");
        LogxSource {
            directory: "D:/logs".to_string(),
            files: vec![LogxSourceFile {
                path: "D:/logs/current.jsonl".to_string(),
                jsonl_text: text,
            }],
        }
    }

    /// `packages/nodes/logx/src/core.test.ts:13-20`
    #[test]
    fn uses_the_shared_structured_query_and_aggregate_model() {
        let input = input_json(
            json!({ "minimumSeverity": "warn", "scope": "neoview", "search": "decode" }),
        );
        let mut progress: Vec<LogxProgressEvent> = Vec::new();
        let result = run_logx_from_source(
            &input,
            &fixture_source(),
            &mut |event| progress.push(event.clone()),
            &mut || LogxCheckpointDecision::Continue,
        );

        assert!(result.success);
        let data = result.data.as_ref().expect("data");
        assert_eq!(data.action, LogxAction::Query);
        assert_eq!(data.directory, "D:/logs");
        assert_eq!(data.files, vec!["D:/logs/current.jsonl".to_string()]);
        assert!(data.issues.is_empty());
        assert_eq!(
            data.events
                .iter()
                .map(|event| event.id.as_str())
                .collect::<Vec<_>>(),
            vec!["two"]
        );
        assert_eq!(data.matched_count, 1);
        assert_eq!(data.returned_count, 1);
        assert_eq!(data.aggregate.by_severity.get("error"), Some(&1));
        assert_eq!(data.aggregate.by_severity.len(), 1);
        assert_eq!(data.sessions[0].event_count, 1);
        assert_eq!(data.sessions[0].error_count, 1);
        assert_eq!(data.sessions[0].process_types, vec!["backend".to_string()]);
        assert_eq!(data.telemetry.events_per_second, 1.0);
        assert!(data.telemetry.storm_intensity > 0.0 && data.telemetry.storm_intensity < 1.0);
        assert_eq!(result.message, "Matched 1 log event(s).");

        let reported: Vec<(f64, String)> = progress
            .iter()
            .map(|event| (event.progress.unwrap_or_default(), event.message.clone()))
            .collect();
        assert_eq!(
            reported,
            vec![
                (
                    LOGX_PROGRESS_READING,
                    LOGX_PROGRESS_READING_MESSAGE.to_string()
                ),
                (
                    LOGX_PROGRESS_QUERYING,
                    LOGX_PROGRESS_QUERYING_MESSAGE.to_string()
                ),
                (
                    LOGX_PROGRESS_COMPLETED,
                    "Matched 1 log event(s).".to_string()
                ),
            ]
        );
    }

    #[test]
    fn parse_issues_keep_the_file_and_turn_the_result_unsuccessful() {
        let mut source = fixture_source();
        source.files.push(LogxSourceFile {
            path: "D:/logs/legacy.jsonl".to_string(),
            jsonl_text: "---- session legacy ----\n".to_string(),
        });
        let input = input_json(json!({}));
        let result = run_logx(
            &input,
            &read_logx_source(&source, &mut || LogxCheckpointDecision::Continue).unwrap(),
            &mut |_| {},
        );

        assert!(!result.success);
        let data = result.data.as_ref().expect("data");
        assert_eq!(data.issues.len(), 1);
        assert_eq!(data.issues[0].file, "D:/logs/legacy.jsonl");
        assert_eq!(data.issues[0].code, LogParseIssueCode::InvalidJson);
        assert_eq!(result.message, "Matched 2 event(s) with 1 parse issue(s).");
    }

    #[test]
    fn cancellation_at_a_checkpoint_stops_the_run() {
        let mut source = fixture_source();
        source.files.push(LogxSourceFile {
            path: "D:/logs/second.jsonl".to_string(),
            jsonl_text: String::new(),
        });
        let mut checkpoints = 0;
        let result =
            run_logx_from_source(&input_json(json!({})), &source, &mut |_| {}, &mut || {
                checkpoints += 1;
                LogxCheckpointDecision::Cancel
            });

        assert_eq!(checkpoints, 1);
        assert!(!result.success);
        assert_eq!(result.message, LOGX_CANCELLED_MESSAGE);
        assert!(result.data.is_none());
    }

    #[test]
    fn normalization_applies_defaults_trims_blanks_and_clamps_the_limit() {
        let defaults = normalize_logx_input(&input_json(json!({})));
        assert_eq!(defaults.action, LogxAction::Query);
        assert_eq!(defaults.minimum_severity, LogSeverityText::Trace);
        assert_eq!(defaults.order, LogSortOrder::Desc);
        assert_eq!(defaults.limit, LOGX_DEFAULT_RESULT_LIMIT);
        assert_eq!(defaults.directory, None);
        assert_eq!(defaults.scope, None);

        let trimmed = normalize_logx_input(&input_json(json!({
            "action": "doctor",
            "directory": "  D:/logs  ",
            "scope": "   ",
            "minimumSeverity": "warn",
            "order": "asc",
            "limit": 1234.9,
        })));
        assert_eq!(trimmed.action, LogxAction::Doctor);
        assert_eq!(trimmed.directory.as_deref(), Some("D:/logs"));
        assert_eq!(trimmed.scope, None);
        assert_eq!(trimmed.minimum_severity, LogSeverityText::Warn);
        assert_eq!(trimmed.order, LogSortOrder::Asc);
        assert_eq!(trimmed.limit, 1234);

        let serialized = serde_json::to_value(&trimmed).unwrap();
        assert!(
            serialized.get("scope").is_none(),
            "blank filters stay out of the payload"
        );
    }

    #[test]
    fn limit_clamping_matches_the_typescript_helper() {
        let cases: Vec<(Option<f64>, i64)> = vec![
            (None, LOGX_DEFAULT_RESULT_LIMIT),
            (Some(0.0), LOGX_MINIMUM_RESULT_LIMIT),
            (Some(-5.0), LOGX_MINIMUM_RESULT_LIMIT),
            (Some(0.9), LOGX_MINIMUM_RESULT_LIMIT),
            (Some(5000.0), LOGX_MAXIMUM_RESULT_LIMIT),
            (Some(9_999.0), LOGX_MAXIMUM_RESULT_LIMIT),
            (Some(f64::NAN), LOGX_DEFAULT_RESULT_LIMIT),
            (Some(f64::INFINITY), LOGX_DEFAULT_RESULT_LIMIT),
            (Some(f64::NEG_INFINITY), LOGX_DEFAULT_RESULT_LIMIT),
        ];
        for (value, expected) in cases {
            let input = LogxInput {
                limit: value,
                ..LogxInput::default()
            };
            assert_eq!(
                normalize_logx_input(&input).limit,
                expected,
                "limit {value:?}"
            );
        }
    }

    #[test]
    fn blank_filters_are_omitted_from_the_query() {
        let query = create_logx_query(&input_json(json!({
            "minimumSeverity": "info",
            "scope": " neoview ",
            "eventName": "reader.failed",
            "sessionId": "",
            "search": "decode",
            "since": "2026-07-23T00:00:00Z",
            "until": "  ",
            "limit": 10,
            "order": "asc",
        })));
        assert_eq!(query.minimum_severity, Some(LogSeverityText::Info));
        assert_eq!(query.scopes, Some(vec!["neoview".to_string()]));
        assert_eq!(query.event_names, Some(vec!["reader.failed".to_string()]));
        assert_eq!(query.session_ids, None);
        assert_eq!(query.search.as_deref(), Some("decode"));
        assert_eq!(query.since.as_deref(), Some("2026-07-23T00:00:00Z"));
        assert_eq!(query.until, None);
        assert_eq!(query.order, Some(LogSortOrder::Asc));
        assert_eq!(query.limit, Some(10));

        let without_limit =
            create_logx_query_with_limit(&input_json(json!({ "limit": 10 })), false);
        assert_eq!(without_limit.limit, None);
        assert_eq!(without_limit.minimum_severity, Some(LogSeverityText::Trace));
        assert_eq!(without_limit.order, Some(LogSortOrder::Desc));
    }

    #[test]
    fn returned_events_are_limited_while_the_aggregate_is_not() {
        let events: Vec<LogEnvelope> = (0..5)
            .map(|index| {
                LogEnvelopeFixture::new(
                    &format!("event-{index}"),
                    &format!("2026-07-23T00:00:0{index}.000Z"),
                    LogSeverityText::Info,
                    "app.tick",
                    "app",
                )
                .with_process_type(LogProcessType::Backend)
                .build()
            })
            .collect();
        let read_result = LogxReadResult {
            directory: "D:/logs".to_string(),
            events,
            issues: Vec::new(),
            files: vec!["D:/logs/current.jsonl".to_string()],
        };
        let input = input_json(json!({ "limit": 2, "order": "asc" }));
        let result = run_logx(&input, &read_result, &mut |_| {});
        let data = result.data.as_ref().expect("data");

        assert_eq!(data.returned_count, 2);
        assert_eq!(data.matched_count, 5);
        assert_eq!(data.aggregate.total, 5);
        assert_eq!(
            data.telemetry
                .anomaly_cells
                .iter()
                .map(|cell| cell.event_count)
                .sum::<u64>(),
            5
        );
    }

    #[test]
    fn an_unreadable_input_falls_back_like_the_typescript_catch() {
        let malformed =
            serde_json::from_value::<LogxInput>(json!({ "minimumSeverity": "verbose" }));
        assert!(malformed.is_err());
        let result = LogxResult::failure("unknown variant `verbose`");
        assert!(!result.success);
        assert!(result.data.is_none());
    }
}
