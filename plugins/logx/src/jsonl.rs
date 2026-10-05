//! Rotated JSONL line parsing, ported from `packages/logging/src/jsonl.ts`.

use serde::{Deserialize, Serialize};

use crate::envelope::{LogEnvelope, log_envelope_constraint_violations};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LogParseIssueCode {
    InvalidJson,
    InvalidEnvelope,
}

impl LogParseIssueCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidJson => "invalid-json",
            Self::InvalidEnvelope => "invalid-envelope",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogParseIssue {
    pub line_number: i64,
    pub code: LogParseIssueCode,
    pub message: String,
    pub raw: String,
}

/// `jsonl.ts:19-32` returns either an event or an issue, never both.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLineParseResult {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event: Option<LogEnvelope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issue: Option<LogParseIssue>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogParseResult {
    pub events: Vec<LogEnvelope>,
    pub issues: Vec<LogParseIssue>,
}

pub fn serialize_log_envelope(envelope: &LogEnvelope) -> String {
    serde_json::to_string(envelope).unwrap_or_default()
}

pub fn parse_log_line(raw: &str, line_number: i64) -> LogLineParseResult {
    let value: Value = match serde_json::from_str(raw) {
        Ok(value) => value,
        Err(error) => {
            return line_issue(
                line_number,
                LogParseIssueCode::InvalidJson,
                error.to_string(),
                raw,
            );
        }
    };
    let envelope: LogEnvelope = match serde_json::from_value(value) {
        Ok(envelope) => envelope,
        Err(error) => {
            return line_issue(
                line_number,
                LogParseIssueCode::InvalidEnvelope,
                error.to_string(),
                raw,
            );
        }
    };
    let violations = log_envelope_constraint_violations(&envelope);
    if !violations.is_empty() {
        return line_issue(
            line_number,
            LogParseIssueCode::InvalidEnvelope,
            violations.join("; "),
            raw,
        );
    }
    LogLineParseResult {
        event: Some(envelope),
        issue: None,
    }
}

/// `jsonl.ts:34-46`: CRLF and lone CR become LF, blank lines are skipped, line numbers are 1-based.
pub fn parse_log_jsonl(text: &str) -> LogParseResult {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut result = LogParseResult {
        events: Vec::new(),
        issues: Vec::new(),
    };
    for (index, raw) in normalized.split('\n').enumerate() {
        if raw.trim().is_empty() {
            continue;
        }
        let parsed = parse_log_line(raw, index as i64 + 1);
        if let Some(envelope) = parsed.event {
            result.events.push(envelope);
        }
        if let Some(issue) = parsed.issue {
            result.issues.push(issue);
        }
    }
    result
}

fn line_issue(
    line_number: i64,
    code: LogParseIssueCode,
    message: String,
    raw: &str,
) -> LogLineParseResult {
    LogLineParseResult {
        event: None,
        issue: Some(LogParseIssue {
            line_number,
            code,
            message,
            raw: raw.to_string(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::envelope::LogSeverityText;
    use crate::test_fixtures::LogEnvelopeFixture;

    /// `packages/logging/src/core.test.ts:24-32`
    #[test]
    fn serializes_one_strict_envelope_per_jsonl_line() {
        let first = LogEnvelopeFixture::new(
            "event-reader.opened",
            "2026-07-23T00:00:01.000Z",
            LogSeverityText::Info,
            "reader.opened",
            "neoview.reader",
        )
        .build();
        let second = LogEnvelopeFixture::new(
            "event-reader.failed",
            "2026-07-23T00:00:01.000Z",
            LogSeverityText::Error,
            "reader.failed",
            "neoview.reader",
        )
        .with_error("Error", "failed")
        .build();
        let text = format!(
            "{}\n{}\n",
            serialize_log_envelope(&first),
            serialize_log_envelope(&second)
        );
        let result = parse_log_jsonl(&text);

        assert_eq!(result.issues, Vec::new());
        assert_eq!(
            result
                .events
                .iter()
                .map(|event| event.event_name.clone())
                .collect::<Vec<_>>(),
            vec!["reader.opened", "reader.failed"]
        );
        assert_eq!(result.events[1].severity_number, 17);
    }

    /// `packages/logging/src/core.test.ts:34-40`
    #[test]
    fn reports_legacy_text_and_malformed_envelopes_without_losing_valid_events() {
        let valid = serialize_log_envelope(&LogEnvelopeFixture::default_event().build());
        let text =
            format!("---- session legacy ----\n{valid}\n{{\"eventName\":\"missing-envelope\"}}\n");
        let result = parse_log_jsonl(&text);

        assert_eq!(result.events.len(), 1);
        assert_eq!(
            result
                .issues
                .iter()
                .map(|issue| issue.code)
                .collect::<Vec<_>>(),
            vec![
                LogParseIssueCode::InvalidJson,
                LogParseIssueCode::InvalidEnvelope
            ]
        );
        assert_eq!(
            result
                .issues
                .iter()
                .map(|issue| issue.line_number)
                .collect::<Vec<_>>(),
            vec![1, 3]
        );
    }

    #[test]
    fn skips_blank_lines_but_keeps_their_line_numbers() {
        let valid = serialize_log_envelope(&LogEnvelopeFixture::default_event().build());
        let result = parse_log_jsonl(&format!("\r\n{valid}\r"));

        assert_eq!(result.events.len(), 1);
        assert_eq!(result.issues, Vec::new());
    }
}
