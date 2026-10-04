//! The operation wire DTOs, field-for-field as `packages/shared/src/index.ts` defines them.
//!
//! ADR-0063 principle 2 and 3 keep the HTTP contract, so these are mirrors, not
//! inventions:
//!
//! - `nodeOperationPhaseSchema` (`packages/shared/src/index.ts:153`) — the six phase
//!   strings, owned by `xiranite-plugin-api`'s `OperationPhase` and asserted against
//!   the literal list in `phase_wire`'s test.
//! - `nodeOperationSchema` (`packages/shared/src/index.ts:155-168`) —
//!   [`NodeOperationRecord`].
//! - `nodeRunEventSchema` (`packages/shared/src/index.ts:91-98`) —
//!   [`NodeRunEventRecord`].
//! - `nodeRunResultSchema` (`packages/shared/src/index.ts:100-106`) —
//!   [`NodeRunResultRecord`].
//! - `nodeOperationStreamMessageSchema` (`packages/shared/src/index.ts:193-208`) —
//!   [`OperationStreamMessage`].
//!
//! `input`/`data` are `z.unknown()` on the wire, so they travel as
//! [`OpaquePayload`] bytes (ADR-0068: JSON is an encoding, not the ABI) and are
//! emitted as raw JSON here rather than being re-serialized through a Rust model.

use std::collections::BTreeMap;

use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
// The raw_value feature re-exports it under `value`, not a public `raw` module.
use serde_json::value::RawValue;
use xiranite_plugin_api::OperationPhase;
use xiranite_plugin_api::PluginRunEvent;
use xiranite_plugin_api::PluginRunEventKind;
use xiranite_plugin_api::run_events::EventIndex;

/// Serializes an [`OpaquePayload`] as the JSON document it already holds.
mod raw_json {
    use super::*;

    pub(crate) fn serialize<S>(payload: &Option<OpaquePayload>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match payload {
            None => serializer.serialize_none(),
            Some(payload) => {
                let Some(text) = payload.as_text() else {
                    // A non-UTF-8 payload should have been a handle, not a body
                    // (ADR-0066). Reporting it as a string keeps one bad event from
                    // killing an SSE stream, and the log line keeps it observable.
                    tracing::warn!(
                        byte_len = payload.len(),
                        "xiranite-core: event payload is not valid UTF-8; emitting as a string"
                    );
                    return serializer.serialize_str(&String::from_utf8_lossy(payload.as_bytes()));
                };
                match RawValue::from_string(text.to_owned()) {
                    Ok(raw) => raw.serialize(serializer),
                    Err(error) => {
                        tracing::warn!(%error, "xiranite-core: event payload is not valid JSON; emitting as a string");
                        serializer.serialize_str(text)
                    }
                }
            }
        }
    }

    pub(crate) fn deserialize<'de, D>(deserializer: D) -> Result<Option<OpaquePayload>, D::Error>
    where
        D: Deserializer<'de>,
    {
        Option::<Box<RawValue>>::deserialize(deserializer).map(|raw| raw.map(|raw| OpaquePayload::from_text(raw.get())))
    }
}

use xiranite_plugin_api::OpaquePayload;

/// `nodeOperationPhaseSchema` as a JSON string.
mod phase_wire {
    use super::*;

    pub(crate) fn serialize<S>(phase: &OperationPhase, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(phase.as_str())
    }

    pub(crate) fn deserialize<'de, D>(deserializer: D) -> Result<OperationPhase, D::Error>
    where
        D: Deserializer<'de>,
    {
        let text = String::deserialize(deserializer)?;
        OperationPhase::try_from_wire(&text)
            .ok_or_else(|| D::Error::custom(format!("unknown node operation phase: {text}")))
    }
}

/// `nodeRunEventSchema.type` as a JSON string.
mod event_kind_wire {
    use super::*;

    pub(crate) fn serialize<S>(kind: &PluginRunEventKind, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(kind.as_str())
    }

    pub(crate) fn deserialize<'de, D>(deserializer: D) -> Result<PluginRunEventKind, D::Error>
    where
        D: Deserializer<'de>,
    {
        let text = String::deserialize(deserializer)?;
        match text.as_str() {
            "progress" => Ok(PluginRunEventKind::Progress),
            "log" => Ok(PluginRunEventKind::Log),
            other => Err(D::Error::custom(format!(
                "unknown node run event type: {other}"
            ))),
        }
    }
}

/// `nodeOperationEventSchema.index` / the stream message's `index`.
mod event_index_wire {
    use super::*;

    pub(crate) fn serialize<S>(index: &EventIndex, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u64(index.get())
    }

    pub(crate) fn deserialize<'de, D>(deserializer: D) -> Result<EventIndex, D::Error>
    where
        D: Deserializer<'de>,
    {
        Ok(EventIndex::new(u64::deserialize(deserializer)?))
    }
}

/// One `nodeRunEventSchema` value: the progress or log line a run reported.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeRunEventRecord {
    /// `type`: `"progress"` or `"log"`.
    #[serde(rename = "type", with = "event_kind_wire")]
    pub kind: PluginRunEventKind,
    /// `progress`, a percentage as `NodeOperationMonitor.tsx` renders it; absent
    /// when the run cannot estimate.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub progress: Option<f64>,
    /// `message`: mandatory in the schema, so it stays a plain `String`.
    pub message: String,
    /// `data`: the optional structured sidecar (`z.unknown()`).
    #[serde(
        with = "raw_json",
        skip_serializing_if = "Option::is_none",
        default
    )]
    pub data: Option<OpaquePayload>,
}

impl NodeRunEventRecord {
    /// The retained-buffer cost of this event in bytes.
    ///
    /// ADR-0063 replaces the JavaScript heap guard with an event-buffer ceiling, and
    /// the ceiling needs one agreed unit. This counts what the host actually holds:
    /// the message text, the structured payload, plus one byte for the kind tag.
    /// The JSON framing that reaches the socket is not counted, because the
    /// ceiling protects the retained list, not the transport.
    #[must_use]
    pub fn retained_bytes(&self) -> u64 {
        let message = u64::try_from(self.message.len()).unwrap_or(u64::MAX);
        let data = self
            .data
            .as_ref()
            .map_or(0, |payload| u64::try_from(payload.len()).unwrap_or(u64::MAX));
        message.saturating_add(data).saturating_add(1)
    }

    /// A bare `log` event carrying only a message. The lifecycle transitions emit
    /// exactly this (`packages/services/src/index.ts:330`, `:341`, `:354`), and the
    /// Extism host's `xiranite.log` uses it for plugin-side diagnostics.
    #[must_use]
    pub fn log_line(message: impl Into<String>) -> Self {
        Self {
            kind: PluginRunEventKind::Log,
            progress: None,
            message: message.into(),
            data: None,
        }
    }

    /// From the event a plugin reported through `xiranite.operation.emit`.
    #[must_use]
    pub fn from_plugin_event(event: &PluginRunEvent) -> Self {
        match event {
            PluginRunEvent::Progress(progress) => Self {
                kind: PluginRunEventKind::Progress,
                progress: progress.percent.map(|percent| percent.get()),
                message: progress.message.clone(),
                data: progress.structured_data.clone(),
            },
            PluginRunEvent::Log(log) => Self {
                kind: PluginRunEventKind::Log,
                progress: None,
                message: log.message.clone(),
                data: log.structured_data.clone(),
            },
        }
    }
}

/// One `nodeRunResultSchema` value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeRunResultRecord {
    /// `success`.
    pub success: bool,
    /// `message`: mandatory, and the line the history row and monitor show.
    pub message: String,
    /// `data`.
    #[serde(with = "raw_json", skip_serializing_if = "Option::is_none", default)]
    pub data: Option<OpaquePayload>,
    /// `stats`: `Record<string, number>`; omitted when empty, which is what
    /// `PluginRunResult::succeeded` produces today.
    #[serde(skip_serializing_if = "BTreeMap::is_empty", default)]
    pub stats: BTreeMap<String, f64>,
    /// `outputPath`. `PluginRunResult` carries this as a
    /// [`xiranite_plugin_api::tokens::PathToken`]; the host resolves the token and
    /// passes the text here, because the HTTP DTO publishes a string
    /// (`crates/xiranite-plugin-api/src/invocation.rs:66-68`).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub output_path: Option<String>,
}

impl NodeRunResultRecord {
    /// A successful result with no payload: what a run that only reports a
    /// message produces.
    #[must_use]
    pub fn succeeded(message: impl Into<String>) -> Self {
        Self {
            success: true,
            message: message.into(),
            data: None,
            stats: BTreeMap::new(),
            output_path: None,
        }
    }

    /// The failure counterpart; `cancelOperation` writes this verbatim.
    #[must_use]
    pub fn failed(message: impl Into<String>) -> Self {
        Self { success: false, ..Self::succeeded(message) }
    }

    /// Builds the wire result for a plugin result whose output token the host has
    /// already resolved. `output_path` is `None` when the plugin reported no path
    /// or the host does not recognize the token.
    #[must_use]
    pub fn from_plugin_result(
        result: &xiranite_plugin_api::invocation::PluginRunResult,
        output_path: Option<String>,
    ) -> Self {
        Self {
            success: result.success,
            message: result.message.clone(),
            data: result.data.clone(),
            stats: result.stats.clone(),
            output_path,
        }
    }
}

/// One `nodeOperationSchema` value: the record `/node-operations/:id` publishes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeOperationRecord {
    /// `operationId`.
    pub operation_id: String,
    /// `nodeId`: the plugin id in the rewritten stack.
    pub node_id: String,
    /// `componentId`.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub component_id: Option<String>,
    /// `workspaceId`.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub workspace_id: Option<String>,
    /// `phase`: one of the six `nodeOperationPhaseSchema` strings.
    #[serde(with = "phase_wire")]
    pub phase: OperationPhase,
    /// `createdAt`.
    pub created_at: u64,
    /// `updatedAt`.
    pub updated_at: u64,
    /// `startedAt`, absent until `executeOperation` runs.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub started_at: Option<u64>,
    /// `cancelledAt`, written only by `cancelOperation`.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub cancelled_at: Option<u64>,
    /// `finishedAt`, written by `finishOperation`.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub finished_at: Option<u64>,
    /// `eventCount`: every event ever emitted for this operation, including the
    /// ones the retention ceiling already dropped. This is why event paging keeps
    /// working after a cap.
    pub event_count: u64,
    /// `result`, present once the operation is terminal.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub result: Option<NodeRunResultRecord>,
}

/// `nodeOperationEventSchema`: an event plus its host-assigned index.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedOperationEvent {
    /// `index`, the absolute position in the operation's stream.
    #[serde(with = "event_index_wire")]
    pub index: EventIndex,
    /// `event`.
    pub event: NodeRunEventRecord,
}

/// One `nodeOperationStreamMessageSchema` value: the SSE frame body.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum OperationStreamMessage {
    /// `{ type: "operation", operation }`.
    Operation {
        /// The record, as `emitOperation()` writes it.
        operation: NodeOperationRecord,
    },
    /// `{ type: "event", index, event }`.
    Event {
        /// The host-assigned index.
        #[serde(with = "event_index_wire")]
        index: EventIndex,
        /// The event body.
        event: NodeRunEventRecord,
    },
    /// `{ type: "result", operation, result }`.
    Result {
        /// The terminal record.
        operation: NodeOperationRecord,
        /// The result that ended the run.
        result: NodeRunResultRecord,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record() -> NodeOperationRecord {
        NodeOperationRecord {
            operation_id: "op-1".to_owned(),
            node_id: "enginev".to_owned(),
            component_id: None,
            workspace_id: Some("ws-1".to_owned()),
            phase: OperationPhase::Running,
            created_at: 10,
            updated_at: 20,
            started_at: Some(15),
            cancelled_at: None,
            finished_at: None,
            event_count: 3,
            result: None,
        }
    }

    /// `OperationPhase` itself has no serde impl (`crates/xiranite-plugin-api`
    /// carries no serialization dependency on purpose), so the wire test goes
    /// through the same `with` module the record field uses.
    #[derive(Serialize, Deserialize, PartialEq, Debug)]
    struct PhaseHolder(#[serde(with = "phase_wire")] OperationPhase);

    #[test]
    fn phase_strings_are_the_ones_the_zod_enum_accepts() {
        // nodeOperationPhaseSchema at packages/shared/src/index.ts:153, verbatim.
        let dto = ["queued", "running", "paused", "completed", "error", "cancelled"];
        let mut decoded = Vec::new();
        for name in dto {
            let json = format!("\"{name}\"");
            let holder: PhaseHolder =
                serde_json::from_str(&json).unwrap_or_else(|error| panic!("{json}: {error}"));
            let phase = holder.0;
            decoded.push(phase);
            assert_eq!(
                serde_json::to_value(holder).expect("encode"),
                serde_json::Value::String(name.to_owned()),
                "phase re-encodes differently from the wire name"
            );
        }
        assert_eq!(decoded, OperationPhase::ALL.to_vec());
        assert!(
            serde_json::from_str::<PhaseHolder>("\"done\"").is_err(),
            "a phase the DTO enum does not list must not decode"
        );
    }

    #[test]
    fn operation_record_uses_the_dto_field_names_and_omits_absent_optionals() {
        let encoded = serde_json::to_value(record()).expect("encode");
        assert_eq!(encoded["operationId"], "op-1");
        assert_eq!(encoded["nodeId"], "enginev");
        assert_eq!(encoded["workspaceId"], "ws-1");
        assert_eq!(encoded["phase"], "running");
        assert_eq!(encoded["createdAt"], 10);
        assert_eq!(encoded["updatedAt"], 20);
        assert_eq!(encoded["startedAt"], 15);
        assert_eq!(encoded["eventCount"], 3);
        for absent in ["componentId", "cancelledAt", "finishedAt", "result"] {
            assert!(
                encoded.get(absent).is_none(),
                "{absent} serialized although the state does not have it"
            );
        }
        // `zod` would reject an unknown phase, so the round trip must survive the
        // six names the HTTP surface already publishes.
        let text = serde_json::to_string(&record()).expect("encode text");
        assert_eq!(serde_json::from_str::<NodeOperationRecord>(&text).expect("decode"), record());
    }

    #[test]
    fn event_record_carries_type_progress_message_and_raw_data() {
        let event = NodeRunEventRecord {
            kind: PluginRunEventKind::Progress,
            progress: Some(25.5),
            message: "scanning 12 of 48".to_owned(),
            data: Some(OpaquePayload::from_text(r#"{"rows":[{"path":"D:/a"}]}"#)),
        };
        let encoded = serde_json::to_value(&event).expect("encode");
        assert_eq!(encoded["type"], "progress");
        assert_eq!(encoded["progress"], 25.5);
        assert_eq!(encoded["message"], "scanning 12 of 48");
        // `data` is `z.unknown()`: the JSON document passes through unquoted.
        assert_eq!(encoded["data"]["rows"][0]["path"], "D:/a");
        let text = serde_json::to_string(&event).expect("encode text");
        assert_eq!(serde_json::from_str::<NodeRunEventRecord>(&text).expect("decode"), event);
    }

    #[test]
    fn event_record_from_plugin_event_keeps_the_wire_shape() {
        let percent = xiranite_plugin_api::run_events::ProgressPercent::try_new(100.0).expect("in range");
        let event = NodeRunEventRecord::from_plugin_event(&PluginRunEvent::progress_message(
            "done",
            Some(percent),
        ));
        assert_eq!(event.kind, PluginRunEventKind::Progress);
        assert_eq!(event.progress, Some(100.0));
        assert_eq!(event.data, None);

        let log = NodeRunEventRecord::from_plugin_event(&PluginRunEvent::log_message("one line"));
        assert_eq!(log.kind, PluginRunEventKind::Log);
        assert_eq!(log.progress, None, "nodeRunEventSchema only carries progress for progress events");
    }

    #[test]
    fn retained_bytes_counts_message_payload_and_the_kind_tag() {
        let bare = NodeRunEventRecord {
            kind: PluginRunEventKind::Log,
            progress: None,
            message: "abc".to_owned(),
            data: None,
        };
        assert_eq!(bare.retained_bytes(), 4);
        let with_payload = NodeRunEventRecord {
            data: Some(OpaquePayload::from_text("{}")),
            ..bare.clone()
        };
        assert_eq!(with_payload.retained_bytes(), 6);
    }

    #[test]
    fn non_json_payload_is_still_emitted_and_never_lost() {
        let event = NodeRunEventRecord {
            kind: PluginRunEventKind::Log,
            progress: None,
            message: "binary".to_owned(),
            data: Some(OpaquePayload::from_text("{not json")),
        };
        let encoded = serde_json::to_value(&event).expect("encode");
        assert_eq!(encoded["data"], "{not json", "an invalid payload must not vanish");
    }

    #[test]
    fn result_record_omits_empty_stats_and_carries_the_resolved_output_path() {
        let mut stats = BTreeMap::new();
        stats.insert("files".to_owned(), 320.0);
        let result = NodeRunResultRecord {
            success: true,
            message: "320 files".to_owned(),
            data: None,
            stats: stats.clone(),
            output_path: Some("D:/out/report.json".to_owned()),
        };
        let encoded = serde_json::to_value(&result).expect("encode");
        assert_eq!(encoded["success"], true);
        // stats is Record<string, number>, so an integer arrives as f64 here while the
        // TypeScript side writes 320; zod accepts either, and the assertion says so.
        assert_eq!(encoded["stats"]["files"], serde_json::json!(320.0));
        assert_eq!(encoded["outputPath"], "D:/out/report.json");
        assert!(encoded.get("data").is_none());

        let empty = NodeRunResultRecord {
            stats: BTreeMap::new(),
            output_path: None,
            data: None,
            ..result
        };
        let encoded = serde_json::to_value(&empty).expect("encode");
        assert!(encoded.get("stats").is_none() && encoded.get("outputPath").is_none());
    }

    #[test]
    fn stream_messages_use_the_discriminated_union_shapes_of_the_schema() {
        // nodeOperationStreamMessageSchema at packages/shared/src/index.ts:193-208.
        let operation = OperationStreamMessage::Operation { operation: record() };
        let encoded = serde_json::to_value(&operation).expect("encode");
        assert_eq!(encoded["type"], "operation");
        assert_eq!(encoded["operation"]["operationId"], "op-1");
        assert!(encoded.get("event").is_none());

        let event = OperationStreamMessage::Event {
            index: EventIndex::new(7),
            event: NodeRunEventRecord::from_plugin_event(&PluginRunEvent::log_message("hello")),
        };
        let encoded = serde_json::to_value(&event).expect("encode");
        assert_eq!(encoded["type"], "event");
        assert_eq!(encoded["index"], 7);
        assert_eq!(encoded["event"]["message"], "hello");

        let result = OperationStreamMessage::Result {
            operation: record(),
            result: NodeRunResultRecord {
                success: false,
                message: "stopped".to_owned(),
                data: None,
                stats: BTreeMap::new(),
                output_path: None,
            },
        };
        let encoded = serde_json::to_value(&result).expect("encode");
        assert_eq!(encoded["type"], "result");
        assert_eq!(encoded["result"]["message"], "stopped");
        assert_eq!(serde_json::from_value::<OperationStreamMessage>(encoded).expect("decode"), result);
    }

    #[test]
    fn unknown_event_type_is_rejected_not_silently_mapped() {
        let error = serde_json::from_str::<NodeRunEventRecord>(
            r#"{"type":"trace","message":"x"}"#,
        )
        .expect_err("nodeRunEventSchema has exactly two types");
        assert!(error.to_string().contains("unknown node run event type"), "{error}");
    }
}
