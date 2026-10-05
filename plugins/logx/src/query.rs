//! Structured log query and aggregation, ported from `packages/logging/src/query.ts`.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::envelope::{LogEnvelope, LogJsonMap, LogProcessType, LogSeverityText};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogSortOrder {
    Asc,
    Desc,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogQuery {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minimum_severity: Option<LogSeverityText>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maximum_severity: Option<LogSeverityText>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scopes: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_names: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub process_types: Option<Vec<LogProcessType>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attributes: Option<LogJsonMap>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<LogSortOrder>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogErrorGroup {
    pub fingerprint: String,
    pub count: u32,
    pub sample: LogEnvelope,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogAggregate {
    pub total: usize,
    /// `query.ts:47-73` counts in first-seen key order; sorted keys keep the counts identical while
    /// making the serialized form independent of event order.
    pub by_severity: BTreeMap<String, u32>,
    pub by_scope: BTreeMap<String, u32>,
    pub by_event: BTreeMap<String, u32>,
    pub by_session: BTreeMap<String, u32>,
    pub errors: Vec<LogErrorGroup>,
}

pub fn query_logs(events: &[LogEnvelope], query: &LogQuery) -> Vec<LogEnvelope> {
    let search = query.search.as_deref().map(str::to_lowercase);
    let search = search.as_deref().filter(|term| !term.is_empty());
    let mut matched: Vec<LogEnvelope> = events
        .iter()
        .filter(|event| event_matches(event, query, search))
        .cloned()
        .collect();

    // `localeCompare` in query.ts:42 is a plain code-point compare here; no ICU inside the plugin.
    matched.sort_by(|left, right| {
        left.timestamp
            .cmp(&right.timestamp)
            .then_with(|| left.id.cmp(&right.id))
    });
    if query.order == Some(LogSortOrder::Desc) {
        matched.reverse();
    }
    match query.limit {
        Some(limit) => {
            let limit = usize::try_from(limit.max(0)).unwrap_or(usize::MAX);
            matched.truncate(limit);
            matched
        }
        None => matched,
    }
}

fn event_matches(event: &LogEnvelope, query: &LogQuery, search: Option<&str>) -> bool {
    if let Some(minimum) = query.minimum_severity {
        if event.severity_number < minimum.severity_number() {
            return false;
        }
    }
    if let Some(maximum) = query.maximum_severity {
        if event.severity_number > maximum.severity_number() {
            return false;
        }
    }
    if let Some(scopes) = &query.scopes {
        if !scopes.is_empty()
            && !scopes.iter().any(|scope| {
                event.scope.name == *scope || event.scope.name.starts_with(&format!("{scope}."))
            })
        {
            return false;
        }
    }
    if let Some(event_names) = &query.event_names {
        if !event_names.is_empty() && !event_names.iter().any(|name| name == &event.event_name) {
            return false;
        }
    }
    if let Some(session_ids) = &query.session_ids {
        if !session_ids.is_empty() && !session_ids.iter().any(|id| id == &event.session.id) {
            return false;
        }
    }
    if let Some(process_types) = &query.process_types {
        if !process_types.is_empty() && !process_types.contains(&event.resource.process_type) {
            return false;
        }
    }
    if let Some(since) = &query.since {
        if event.timestamp < *since {
            return false;
        }
    }
    if let Some(until) = &query.until {
        if event.timestamp > *until {
            return false;
        }
    }
    if let Some(term) = search {
        if !searchable_text(event).contains(term) {
            return false;
        }
    }
    if let Some(expected) = &query.attributes {
        if !expected
            .iter()
            .all(|(key, value)| attribute_matches(&event.attributes, key, value))
        {
            return false;
        }
    }
    true
}

/// `query.ts:39` compares `JSON.stringify` output, so an absent attribute never matches even when the
/// query value is `null`.
fn attribute_matches(attributes: &LogJsonMap, key: &str, expected: &Value) -> bool {
    match attributes.get(key) {
        Some(found) => json_text(found) == json_text(expected),
        None => false,
    }
}

pub fn aggregate_logs(events: &[LogEnvelope]) -> LogAggregate {
    let mut by_severity: BTreeMap<String, u32> = BTreeMap::new();
    let mut by_scope: BTreeMap<String, u32> = BTreeMap::new();
    let mut by_event: BTreeMap<String, u32> = BTreeMap::new();
    let mut by_session: BTreeMap<String, u32> = BTreeMap::new();
    let mut errors: Vec<LogErrorGroup> = Vec::new();
    let mut error_positions: HashMap<String, usize> = HashMap::new();

    for event in events {
        increment(&mut by_severity, event.severity_text.as_str());
        increment(&mut by_scope, &event.scope.name);
        increment(&mut by_event, &event.event_name);
        increment(&mut by_session, &event.session.id);
        if event.error.is_some() {
            let fingerprint = error_fingerprint(event);
            match error_positions.get(&fingerprint) {
                Some(position) => errors[*position].count += 1,
                None => {
                    error_positions.insert(fingerprint.clone(), errors.len());
                    errors.push(LogErrorGroup {
                        fingerprint,
                        count: 1,
                        sample: event.clone(),
                    });
                }
            }
        }
    }

    errors.sort_by(|left, right| right.count.cmp(&left.count));
    LogAggregate {
        total: events.len(),
        by_severity,
        by_scope,
        by_event,
        by_session,
        errors,
    }
}

/// `query.ts:75-79`: digits and `:line:column` frame positions are normalized so repeats collapse.
pub fn error_fingerprint(event: &LogEnvelope) -> String {
    let Some(error) = &event.error else {
        return String::new();
    };
    let top_frame = error
        .stack
        .as_deref()
        .and_then(|stack| {
            let mut lines = stack.split('\n');
            let _ = lines.next();
            lines.next().map(str::trim)
        })
        .map(replace_colon_digit_pairs)
        .unwrap_or_default();
    format!(
        "{}|{}|{}",
        error.name,
        replace_digit_runs(&error.message),
        top_frame
    )
}

fn searchable_text(event: &LogEnvelope) -> String {
    let body = event.body.as_deref().unwrap_or("");
    let error_message = event
        .error
        .as_ref()
        .map(|error| error.message.as_str())
        .unwrap_or("");
    format!(
        "{}\n{body}\n{}\n{error_message}\n{}",
        event.event_name,
        event.scope.name,
        json_text(&event.attributes)
    )
    .to_lowercase()
}

/// Maps `JSON.stringify` (`query.ts:82,89`): serde_json's default map orders object keys alphabetically,
/// so only attribute key order inside the searchable text differs from V8's insertion order.
fn json_text(value: &impl Serialize) -> String {
    serde_json::to_string(value).unwrap_or_default()
}

fn increment(counts: &mut BTreeMap<String, u32>, key: &str) {
    *counts.entry(key.to_string()).or_insert(0) += 1;
}

fn replace_digit_runs(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut in_run = false;
    for character in text.chars() {
        if character.is_ascii_digit() {
            if !in_run {
                output.push('#');
                in_run = true;
            }
        } else {
            in_run = false;
            output.push(character);
        }
    }
    output
}

/// Mirrors `text.replace(/:\d+:\d+/g, ":#: #")`: leftmost non-overlapping matches only.
fn replace_colon_digit_pairs(text: &str) -> String {
    let characters: Vec<char> = text.chars().collect();
    let mut output = String::with_capacity(text.len());
    let mut index = 0;
    while index < characters.len() {
        let mut matched_len = 0;
        if characters[index] == ':'
            && let Some(position_len) = digit_run_len(&characters, index + 1)
        {
            let line_end = index + 1 + position_len;
            if characters.get(line_end) == Some(&':')
                && let Some(column_len) = digit_run_len(&characters, line_end + 1)
            {
                matched_len = line_end + 1 + column_len - index;
            }
        }
        if matched_len > 0 {
            output.push_str(":#: #");
            index += matched_len;
        } else {
            output.push(characters[index]);
            index += 1;
        }
    }
    output
}

fn digit_run_len(characters: &[char], start: usize) -> Option<usize> {
    let mut length = 0;
    while let Some(character) = characters.get(start + length) {
        if character.is_ascii_digit() {
            length += 1;
        } else {
            break;
        }
    }
    if length > 0 { Some(length) } else { None }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::envelope::LogSeverityText;
    use crate::jsonl::parse_log_jsonl;
    use crate::test_fixtures::LogEnvelopeFixture;
    use serde_json::{Map, json};

    fn fixture_events() -> Vec<LogEnvelope> {
        vec![
            LogEnvelopeFixture::new(
                "a",
                "2026-07-23T00:00:01.000Z",
                LogSeverityText::Info,
                "reader.opened",
                "neoview.reader",
            )
            .with_attribute("bookId", json!("one"))
            .build(),
            LogEnvelopeFixture::new(
                "b",
                "2026-07-23T00:00:01.000Z",
                LogSeverityText::Error,
                "reader.failed",
                "neoview.reader",
            )
            .with_error("Error", "book 123 failed")
            .build(),
            LogEnvelopeFixture::new(
                "c",
                "2026-07-23T00:00:01.000Z",
                LogSeverityText::Error,
                "reader.failed",
                "neoview.reader",
            )
            .with_error("Error", "book 456 failed")
            .build(),
        ]
    }

    /// `packages/logging/src/core.test.ts:42-54`
    #[test]
    fn queries_structured_fields_and_aggregates_error_fingerprints() {
        let events = fixture_events();
        let query = LogQuery {
            minimum_severity: Some(LogSeverityText::Error),
            scopes: Some(vec!["neoview".to_string()]),
            search: Some("failed".to_string()),
            ..LogQuery::default()
        };
        assert_eq!(query_logs(&events, &query).len(), 2);

        let aggregate = aggregate_logs(&events);
        assert_eq!(aggregate.by_severity.get("info"), Some(&1));
        assert_eq!(aggregate.by_severity.get("error"), Some(&2));
        assert_eq!(aggregate.by_severity.len(), 2);
        assert_eq!(aggregate.errors.len(), 1);
        assert_eq!(aggregate.errors[0].count, 2);
        assert_eq!(aggregate.errors[0].fingerprint, "Error|book # failed|");
        assert_eq!(aggregate.total, 3);
    }

    #[test]
    fn scope_prefix_and_full_text_search_match_like_the_shared_query() {
        let events = vec![
            LogEnvelopeFixture::new(
                "hit",
                "2026-07-23T00:00:01.000Z",
                LogSeverityText::Warn,
                "reader.slow",
                "neoview.reader",
            )
            .with_body("Decode failed on page 3")
            .build(),
            LogEnvelopeFixture::new(
                "miss",
                "2026-07-23T00:00:02.000Z",
                LogSeverityText::Warn,
                "app.started",
                "app",
            )
            .build(),
        ];
        let query = LogQuery {
            scopes: Some(vec!["neoview".to_string()]),
            search: Some("DECODE FAILED".to_string()),
            ..LogQuery::default()
        };
        let matched = query_logs(&events, &query);
        assert_eq!(
            matched
                .iter()
                .map(|event| event.id.as_str())
                .collect::<Vec<_>>(),
            vec!["hit"]
        );
    }

    #[test]
    fn empty_filter_collections_and_blank_search_are_ignored() {
        let events = fixture_events();
        let query = LogQuery {
            scopes: Some(vec![]),
            event_names: Some(vec![]),
            session_ids: Some(vec![]),
            process_types: Some(vec![]),
            search: Some("".to_string()),
            ..LogQuery::default()
        };
        assert_eq!(query_logs(&events, &query).len(), events.len());
    }

    #[test]
    fn order_and_limit_apply_after_the_ascending_sort() {
        let events = vec![
            LogEnvelopeFixture::new(
                "a",
                "2026-07-23T00:00:01.000Z",
                LogSeverityText::Info,
                "first",
                "app",
            )
            .build(),
            LogEnvelopeFixture::new(
                "b",
                "2026-07-23T00:00:02.000Z",
                LogSeverityText::Info,
                "second",
                "app",
            )
            .build(),
            LogEnvelopeFixture::new(
                "c",
                "2026-07-23T00:00:03.000Z",
                LogSeverityText::Info,
                "third",
                "app",
            )
            .build(),
        ];
        let descending = query_logs(
            &events,
            &LogQuery {
                order: Some(LogSortOrder::Desc),
                ..LogQuery::default()
            },
        );
        assert_eq!(
            descending
                .iter()
                .map(|event| event.id.as_str())
                .collect::<Vec<_>>(),
            vec!["c", "b", "a"]
        );
        let limited = query_logs(
            &events,
            &LogQuery {
                limit: Some(2),
                ..LogQuery::default()
            },
        );
        assert_eq!(
            limited
                .iter()
                .map(|event| event.id.as_str())
                .collect::<Vec<_>>(),
            vec!["a", "b"]
        );
        let negative = query_logs(
            &events,
            &LogQuery {
                limit: Some(-3),
                ..LogQuery::default()
            },
        );
        assert!(negative.is_empty());
    }

    #[test]
    fn absent_attributes_never_match_even_against_null() {
        let events = vec![
            LogEnvelopeFixture::new(
                "a",
                "2026-07-23T00:00:01.000Z",
                LogSeverityText::Info,
                "first",
                "app",
            )
            .build(),
        ];
        let mut expected = Map::new();
        expected.insert("missing".to_string(), Value::Null);
        assert!(
            query_logs(
                &events,
                &LogQuery {
                    attributes: Some(expected),
                    ..LogQuery::default()
                }
            )
            .is_empty()
        );
    }

    #[test]
    fn error_fingerprint_normalizes_stack_positions() {
        let event = LogEnvelopeFixture::new(
            "a",
            "2026-07-23T00:00:01.000Z",
            LogSeverityText::Error,
            "reader.failed",
            "app",
        )
        .with_error("TypeError", "slot 42 empty")
        .with_error_stack(
            "Error: slot 42 empty\n    at decode (reader.ts:18:24)\n    at run (loop.ts:7:11)",
        )
        .build();
        assert_eq!(
            error_fingerprint(&event),
            "TypeError|slot # empty|at decode (reader.ts:#: #)"
        );
        assert_eq!(error_fingerprint(&LogEnvelopeFixture::default_event().build()), "");
    }

    #[test]
    fn digit_pair_replacement_keeps_single_colons_and_lone_digits() {
        assert_eq!(replace_colon_digit_pairs("a:1b:2:3"), "a:1b:#: #");
        assert_eq!(replace_colon_digit_pairs(":1:2:3"), ":#: #:3");
        assert_eq!(replace_digit_runs("a12b3c"), "a#b#c");
    }

    #[test]
    fn parsing_and_querying_compose_on_real_jsonl_text() {
        let line = r#"{"schemaVersion":1,"id":"event-x","timestamp":"2026-07-23T00:00:05.000Z","observedTimestamp":"2026-07-23T00:00:05.001Z","severityText":"error","severityNumber":17,"eventName":"reader.failed","attributes":{},"resource":{"serviceName":"xiranite","processType":"backend"},"scope":{"name":"neoview.reader"},"session":{"id":"session-test","startedAt":"2026-07-23T00:00:00.000Z"}}"#;
        let parsed = parse_log_jsonl(line);
        assert_eq!(parsed.events.len(), 1);
        let matched = query_logs(
            &parsed.events,
            &LogQuery {
                minimum_severity: Some(LogSeverityText::Fatal),
                ..LogQuery::default()
            },
        );
        assert!(matched.is_empty());
        assert_eq!(
            parsed.events[0].resource.process_type,
            LogProcessType::Backend
        );
    }
}
