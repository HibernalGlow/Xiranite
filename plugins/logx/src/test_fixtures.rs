//! Test-only envelope construction, mirroring `createLogEnvelope` (`packages/logging/src/schema.ts:102-120`).
//!
//! `createLogEnvelope` fills `id`, `timestamp` and `observedTimestamp` from the clock and `crypto.randomUUID`;
//! those defaults stay on the host, so every fixture passes them explicitly.

use crate::envelope::{
    LogEnvelope, LogError, LogJsonMap, LogProcessType, LogResource, LogScope, LogSession,
    LogSeverityText,
};
use serde_json::Value;

const FIXTURE_SESSION_ID: &str = "session-test";
const FIXTURE_SESSION_STARTED_AT: &str = "2026-07-23T00:00:00.000Z";

pub(crate) struct LogEnvelopeFixture {
    id: String,
    timestamp: String,
    severity_text: LogSeverityText,
    event_name: String,
    scope_name: String,
    body: Option<String>,
    attributes: LogJsonMap,
    process_type: LogProcessType,
    session_id: String,
    session_started_at: String,
    error: Option<LogError>,
}

impl LogEnvelopeFixture {
    pub(crate) fn new(
        id: &str,
        timestamp: &str,
        severity_text: LogSeverityText,
        event_name: &str,
        scope_name: &str,
    ) -> Self {
        Self {
            id: id.to_string(),
            timestamp: timestamp.to_string(),
            severity_text,
            event_name: event_name.to_string(),
            scope_name: scope_name.to_string(),
            body: None,
            attributes: LogJsonMap::new(),
            process_type: LogProcessType::Frontend,
            session_id: FIXTURE_SESSION_ID.to_string(),
            session_started_at: FIXTURE_SESSION_STARTED_AT.to_string(),
            error: None,
        }
    }

    /// The default event of `packages/logging/src/core.test.ts:9-21`.
    pub(crate) fn default_event() -> Self {
        Self::new(
            "event-reader.opened",
            "2026-07-23T00:00:01.000Z",
            LogSeverityText::Info,
            "reader.opened",
            "neoview.reader",
        )
    }

    /// The two events of `packages/nodes/logx/src/core.test.ts:6-9`.
    pub(crate) fn logx_test_events() -> Vec<LogEnvelope> {
        vec![
            Self::new(
                "one",
                "2026-07-23T00:00:01.000Z",
                LogSeverityText::Info,
                "app.started",
                "app",
            )
            .build(),
            Self::new(
                "two",
                "2026-07-23T00:00:02.000Z",
                LogSeverityText::Error,
                "reader.failed",
                "neoview.reader",
            )
            .with_body("decode failed")
            .with_process_type(LogProcessType::Backend)
            .with_error("DecodeError", "decode failed")
            .build(),
        ]
    }

    pub(crate) fn with_process_type(mut self, process_type: LogProcessType) -> Self {
        self.process_type = process_type;
        self
    }

    pub(crate) fn with_body(mut self, body: &str) -> Self {
        self.body = Some(body.to_string());
        self
    }

    pub(crate) fn with_attribute(mut self, key: &str, value: Value) -> Self {
        self.attributes.insert(key.to_string(), value);
        self
    }

    pub(crate) fn with_session(mut self, id: &str, started_at: &str) -> Self {
        self.session_id = id.to_string();
        self.session_started_at = started_at.to_string();
        self
    }

    pub(crate) fn with_error(mut self, name: &str, message: &str) -> Self {
        self.error = Some(LogError {
            name: name.to_string(),
            message: message.to_string(),
            stack: None,
            cause: None,
        });
        self
    }

    pub(crate) fn with_error_stack(mut self, stack: &str) -> Self {
        match &mut self.error {
            Some(error) => error.stack = Some(stack.to_string()),
            None => {
                self.error = Some(LogError {
                    name: "Error".to_string(),
                    message: String::new(),
                    stack: Some(stack.to_string()),
                    cause: None,
                });
            }
        }
        self
    }

    pub(crate) fn build(self) -> LogEnvelope {
        LogEnvelope {
            schema_version: crate::envelope::LOG_SCHEMA_VERSION,
            id: self.id,
            timestamp: self.timestamp.clone(),
            observed_timestamp: self.timestamp,
            severity_text: self.severity_text,
            severity_number: self.severity_text.severity_number(),
            event_name: self.event_name,
            body: self.body,
            attributes: self.attributes,
            resource: LogResource {
                service_name: "xiranite".to_string(),
                service_version: None,
                deployment_environment: None,
                process_type: self.process_type,
                process_id: None,
                runtime_name: None,
                runtime_version: None,
                host_runtime: None,
                host_name: None,
            },
            scope: LogScope {
                name: self.scope_name,
                version: None,
            },
            session: LogSession {
                id: self.session_id,
                started_at: self.session_started_at,
            },
            trace: None,
            error: self.error,
        }
    }
}
