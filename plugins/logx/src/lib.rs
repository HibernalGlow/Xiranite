//! LogX domain core: structured JSONL log parsing, querying, aggregation, session summaries and the
//! storm/telemetry map, ported from `packages/nodes/logx` (plus the shared `@xiranite/logging` pure model
//! it leans on) so the node's business logic can run inside an Extism WASM plugin.
//!
//! Machine capability stays with the host: directory discovery, gzip decode and path permissions never
//! appear here. The plugin receives decoded JSONL text, parses and validates it, then runs the same query
//! and aggregate pipeline the Bun node ran.

mod envelope;
mod jsonl;
mod query;
mod run;
mod telemetry;
mod timestamp;

#[cfg(test)]
mod test_fixtures;

#[cfg(feature = "wasm")]
mod plugin;

pub use envelope::{
    LOG_SCHEMA_VERSION, LOG_SEVERITY_NUMBERS, LogEnvelope, LogError, LogJsonMap, LogProcessType,
    LogResource, LogScope, LogSession, LogSeverityText, LogTrace,
};
pub use jsonl::{
    LogLineParseResult, LogParseIssue, LogParseIssueCode, LogParseResult, parse_log_jsonl,
    parse_log_line, serialize_log_envelope,
};
pub use query::{
    LogAggregate, LogErrorGroup, LogQuery, LogSortOrder, aggregate_logs, error_fingerprint,
    query_logs,
};
pub use run::{
    LOGX_CANCELLED_MESSAGE, LOGX_DEFAULT_RESULT_LIMIT, LOGX_MAXIMUM_RESULT_LIMIT,
    LOGX_MINIMUM_RESULT_LIMIT, LOGX_PROGRESS_COMPLETED, LOGX_PROGRESS_QUERYING,
    LOGX_PROGRESS_QUERYING_MESSAGE, LOGX_PROGRESS_READING, LOGX_PROGRESS_READING_MESSAGE,
    LogxAction, LogxCancelled, LogxCheckpointDecision, LogxData, LogxInput, LogxProgressEvent,
    LogxProgressEventType, LogxReadIssue, LogxReadResult, LogxResult, LogxSource, LogxSourceFile,
    NormalizedLogxInput, create_logx_query, create_logx_query_with_limit, normalize_logx_input,
    read_logx_source, run_logx, run_logx_from_source,
};
pub use telemetry::{
    LOGX_ANOMALY_CELL_COUNT, LogxAnomalyCell, LogxSessionSummary, LogxTelemetry,
    create_logx_telemetry, summarize_logx_sessions,
};
pub use timestamp::parse_epoch_milliseconds;
