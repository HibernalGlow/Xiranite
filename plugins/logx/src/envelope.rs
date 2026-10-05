//! The structured log envelope model, ported from `packages/logging/src/schema.ts`.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub const LOG_SCHEMA_VERSION: i64 = 1;

/// OpenTelemetry-style severity label; `schema.ts:5-12` fixes the number each label maps to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogSeverityText {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
    Fatal,
}

impl LogSeverityText {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Trace => "trace",
            Self::Debug => "debug",
            Self::Info => "info",
            Self::Warn => "warn",
            Self::Error => "error",
            Self::Fatal => "fatal",
        }
    }

    pub fn severity_number(self) -> i64 {
        match self {
            Self::Trace => 1,
            Self::Debug => 5,
            Self::Info => 9,
            Self::Warn => 13,
            Self::Error => 17,
            Self::Fatal => 21,
        }
    }
}

/// All severity numbers as `(label, number)` in ascending severity, mirroring `LOG_SEVERITY_NUMBERS`.
pub const LOG_SEVERITY_NUMBERS: [(&str, i64); 6] = [
    ("trace", 1),
    ("debug", 5),
    ("info", 9),
    ("warn", 13),
    ("error", 17),
    ("fatal", 21),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogProcessType {
    Frontend,
    Backend,
    Desktop,
    Cli,
    Test,
    Unknown,
}

impl LogProcessType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Frontend => "frontend",
            Self::Backend => "backend",
            Self::Desktop => "desktop",
            Self::Cli => "cli",
            Self::Test => "test",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogResource {
    pub service_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deployment_environment: Option<String>,
    pub process_type: LogProcessType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub process_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_runtime: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogScope {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogSession {
    pub id: String,
    pub started_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogError {
    pub name: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cause: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogTrace {
    pub trace_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub span_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_span_id: Option<String>,
}

pub type LogJsonMap = Map<String, Value>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogEnvelope {
    pub schema_version: i64,
    pub id: String,
    pub timestamp: String,
    pub observed_timestamp: String,
    pub severity_text: LogSeverityText,
    pub severity_number: i64,
    pub event_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    pub attributes: LogJsonMap,
    pub resource: LogResource,
    pub scope: LogScope,
    pub session: LogSession,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trace: Option<LogTrace>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<LogError>,
}

/// The constraints `LogEnvelopeSchema` (`schema.ts:63-78`) adds on top of field presence and types.
pub(crate) fn log_envelope_constraint_violations(envelope: &LogEnvelope) -> Vec<String> {
    let mut violations = Vec::new();
    if envelope.schema_version != LOG_SCHEMA_VERSION {
        violations.push(format!(
            "schemaVersion must be {LOG_SCHEMA_VERSION}, found {}",
            envelope.schema_version
        ));
    }
    if !(1..=24).contains(&envelope.severity_number) {
        violations.push(format!(
            "severityNumber must be between 1 and 24, found {}",
            envelope.severity_number
        ));
    }
    require_non_empty(&mut violations, "id", &envelope.id);
    require_non_empty(&mut violations, "timestamp", &envelope.timestamp);
    require_non_empty(
        &mut violations,
        "observedTimestamp",
        &envelope.observed_timestamp,
    );
    require_non_empty(&mut violations, "eventName", &envelope.event_name);
    require_non_empty(
        &mut violations,
        "resource.serviceName",
        &envelope.resource.service_name,
    );
    require_optional_non_empty(
        &mut violations,
        "resource.serviceVersion",
        &envelope.resource.service_version,
    );
    require_optional_non_empty(
        &mut violations,
        "resource.deploymentEnvironment",
        &envelope.resource.deployment_environment,
    );
    require_optional_non_empty(
        &mut violations,
        "resource.runtimeName",
        &envelope.resource.runtime_name,
    );
    require_optional_non_empty(
        &mut violations,
        "resource.runtimeVersion",
        &envelope.resource.runtime_version,
    );
    require_optional_non_empty(
        &mut violations,
        "resource.hostRuntime",
        &envelope.resource.host_runtime,
    );
    require_optional_non_empty(
        &mut violations,
        "resource.hostName",
        &envelope.resource.host_name,
    );
    require_non_empty(&mut violations, "scope.name", &envelope.scope.name);
    require_optional_non_empty(&mut violations, "scope.version", &envelope.scope.version);
    require_non_empty(&mut violations, "session.id", &envelope.session.id);
    require_non_empty(
        &mut violations,
        "session.startedAt",
        &envelope.session.started_at,
    );
    if let Some(trace) = &envelope.trace {
        require_non_empty(&mut violations, "trace.traceId", &trace.trace_id);
        require_optional_non_empty(&mut violations, "trace.spanId", &trace.span_id);
        require_optional_non_empty(&mut violations, "trace.parentSpanId", &trace.parent_span_id);
    }
    if let Some(error) = &envelope.error {
        require_non_empty(&mut violations, "error.name", &error.name);
        require_optional_non_empty(&mut violations, "error.stack", &error.stack);
    }
    violations
}

fn require_non_empty(violations: &mut Vec<String>, path: &str, value: &str) {
    if value.is_empty() {
        violations.push(format!(
            "{path} must contain at least 1 character(s), found an empty string"
        ));
    }
}

fn require_optional_non_empty(violations: &mut Vec<String>, path: &str, value: &Option<String>) {
    if let Some(value) = value {
        require_non_empty(violations, path, value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal_envelope_json() -> String {
        serde_json::to_string(&serde_json::json!({
            "schemaVersion": 1,
            "id": "event-one",
            "timestamp": "2026-07-23T00:00:01.000Z",
            "observedTimestamp": "2026-07-23T00:00:01.001Z",
            "severityText": "info",
            "severityNumber": 9,
            "eventName": "reader.opened",
            "attributes": {},
            "resource": { "serviceName": "xiranite", "processType": "frontend" },
            "scope": { "name": "neoview.reader" },
            "session": { "id": "session-test", "startedAt": "2026-07-23T00:00:00.000Z" },
        }))
        .unwrap()
    }

    #[test]
    fn severity_numbers_match_the_shared_model() {
        for (label, number) in LOG_SEVERITY_NUMBERS {
            let parsed: LogSeverityText = serde_json::from_str(&format!("\"{label}\"")).unwrap();
            assert_eq!(parsed.severity_number(), number, "{label}");
            assert_eq!(parsed.as_str(), label);
        }
    }

    #[test]
    fn a_strict_envelope_round_trips_without_optional_keys() {
        let envelope: LogEnvelope = serde_json::from_str(&minimal_envelope_json()).unwrap();
        assert_eq!(envelope.severity_text, LogSeverityText::Info);
        assert!(envelope.error.is_none());
        let serialized = serde_json::to_string(&envelope).unwrap();
        assert!(!serialized.contains("error"));
        assert!(!serialized.contains("trace"));
        assert!(serialized.contains("\"processType\":\"frontend\""));
    }

    #[test]
    fn unknown_keys_and_out_of_range_severity_are_rejected() {
        let unknown_key =
            minimal_envelope_json().replace("\"attributes\"", "\"trailing\": 1, \"attributes\"");
        let value: Value = serde_json::from_str(&unknown_key).unwrap();
        let rejected = serde_json::from_value::<LogEnvelope>(value);
        assert!(rejected.is_err());

        let out_of_range =
            minimal_envelope_json().replace("\"severityNumber\":9", "\"severityNumber\":25");
        let envelope: LogEnvelope = serde_json::from_str(&out_of_range).unwrap();
        let violations = log_envelope_constraint_violations(&envelope);
        assert_eq!(
            violations,
            vec!["severityNumber must be between 1 and 24, found 25"]
        );
    }

    #[test]
    fn empty_required_strings_are_reported_with_their_path() {
        let mut envelope: LogEnvelope = serde_json::from_str(&minimal_envelope_json()).unwrap();
        envelope.event_name = String::new();
        envelope.session.id = String::new();
        let violations = log_envelope_constraint_violations(&envelope);
        assert_eq!(violations.len(), 2);
        assert!(violations[0].starts_with("eventName must contain at least 1"));
        assert!(violations[1].starts_with("session.id must contain at least 1"));
    }
}
