//! The retained event list and its two ceilings.
//!
//! ADR-0063's consequence is explicit: the JavaScript memory guard goes away and
//! its replacement is "operation-manager event-count and event-buffer ceilings".
//! The count ceiling is today's behaviour, `pushEvent()` in
//! `packages/services/src/index.ts:491-499`:
//!
//! ```text
//! state.events.push(event)
//! if (state.events.length > state.maxRetainedEvents)
//!     state.events.splice(0, state.events.length - state.maxRetainedEvents)
//! ```
//!
//! The byte ceiling is the new half, taken from
//! [`EventRetentionCeiling::max_retained_bytes`], which mirrors
//! `NODE_STREAM_MAX_PENDING_BYTES` (`packages/api/src/index.ts:459`). Both dimensions
//! come from `crates/xiranite-plugin-api/src/run_options.rs`, so the plugin's own
//! run options decide what the host retains.
//!
//! Nothing is dropped silently: [`RetainedEventBuffer::stats`] reports
//! `dropped_events` and `retained_bytes`, and `eventCount` on the wire keeps
//! counting every event ever emitted, so a client paging with `from`/`limit` can
//! still tell how much of the stream existed. The counters are host-side
//! diagnostics: `nodeOperationSchema` has no field for them and this crate does not
//! invent one.

use std::collections::VecDeque;

use xiranite_plugin_api::EventRetentionCeiling;
use xiranite_plugin_api::run_events::EventIndex;

use super::dto::{IndexedOperationEvent, NodeRunEventRecord};

/// What one operation's retained buffer is holding, and what it had to drop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetainedEventStats {
    /// Events currently retained.
    pub retained_events: u64,
    /// Bytes currently retained, counted by [`NodeRunEventRecord::retained_bytes`].
    pub retained_bytes: u64,
    /// Events removed to stay inside either ceiling. Never reset.
    pub dropped_events: u64,
    /// Events kept although they alone exceed the byte ceiling.
    ///
    /// A single oversized event is the one case where the buffer cannot honour the
    /// ceiling and stay useful: dropping it would leave an operation whose stream
    /// holds nothing at all. It is kept and counted, because a silent keep and a
    /// silent drop are the same bug.
    pub oversized_events: u64,
}

/// The newest event a drop removed, so the manager can report it.
#[derive(Debug, Clone)]
pub struct RetainedEventBuffer {
    ceiling: EventRetentionCeiling,
    events: VecDeque<IndexedOperationEvent>,
    retained_bytes: u64,
    dropped_events: u64,
    oversized_events: u64,
}

impl RetainedEventBuffer {
    /// An empty buffer under `ceiling`.
    #[must_use]
    pub const fn new(ceiling: EventRetentionCeiling) -> Self {
        Self {
            ceiling,
            events: VecDeque::new(),
            retained_bytes: 0,
            dropped_events: 0,
            oversized_events: 0,
        }
    }

    /// The ceiling in force. Only the module tests read it back; the diagnostics surface
    /// reports the stats instead, because a caller that knows the manager knows the ceiling.
    #[cfg(test)]
    #[must_use]
    pub const fn ceiling(&self) -> EventRetentionCeiling {
        self.ceiling
    }

    /// Retains `event` at the host-assigned absolute `index` and re-applies both
    /// ceilings, oldest first.
    pub fn push(&mut self, index: EventIndex, event: NodeRunEventRecord) {
        let cost = event.retained_bytes();
        self.retained_bytes = self.retained_bytes.saturating_add(cost);
        self.events.push_back(IndexedOperationEvent { index, event });
        self.enforce();
    }

    fn enforce(&mut self) {
        // Count ceiling first: `max_retained_events` is the smaller and older of
        // the two, and applying it first keeps the byte pass from dropping extra
        // events a test would then have to reason about twice.
        while u64::from(self.ceiling.max_retained_events()) < self.events.len() as u64 {
            self.drop_oldest();
        }
        while self.events.len() > 1 && self.retained_bytes > self.ceiling.max_retained_bytes() {
            self.drop_oldest();
        }
        if self.events.len() == 1 && self.retained_bytes > self.ceiling.max_retained_bytes() {
            self.oversized_events = self.oversized_events.saturating_add(1);
        }
    }

    fn drop_oldest(&mut self) {
        let Some(oldest) = self.events.pop_front() else {
            return;
        };
        self.retained_bytes = self.retained_bytes.saturating_sub(oldest.event.retained_bytes());
        self.dropped_events = self.dropped_events.saturating_add(1);
    }

    /// Counters for logs, snapshots and the ADR-0063 memory-protection replacement.
    #[must_use]
    pub fn stats(&self) -> RetainedEventStats {
        RetainedEventStats {
            retained_events: self.events.len() as u64,
            retained_bytes: self.retained_bytes,
            dropped_events: self.dropped_events,
            oversized_events: self.oversized_events,
        }
    }

    /// The retained events, oldest first.
    #[must_use]
    pub fn retained(&self) -> Vec<IndexedOperationEvent> {
        self.events.iter().cloned().collect()
    }

    /// `firstRetainedIndex` in `getOperationEvents()`: the absolute index of the
    /// oldest event still held. An empty buffer reports `event_count`, which is the
    /// value TypeScript computes (`eventCount - 0`) and the only position from which
    /// a next event would continue.
    #[must_use]
    pub fn first_retained_index(&self, event_count: u64) -> u64 {
        match (self.events.front(), self.events.back()) {
            (Some(front), Some(back)) => {
                // Cross-check the invariant the paging math depends on: retained
                // indices are contiguous and `event_count` sits one past the last.
                debug_assert_eq!(
                    back.index.get() + 1,
                    event_count,
                    "retained buffer is not the tail of the stream"
                );
                front.index.get()
            }
            _ => event_count,
        }
    }

    /// The `nodeOperationEventsResponseSchema` page, mirroring
    /// `getOperationEvents()` in `packages/services/src/index.ts:292-320`.
    #[must_use]
    pub fn page(&self, event_count: u64, from: u64, limit: u64) -> EventPage {
        let first_retained = self.first_retained_index(event_count);
        let retained_from = event_count.min(from.max(first_retained));
        let offset = retained_from - first_retained;
        let end = (self.events.len() as u64).min(offset.saturating_add(limit));
        let events: Vec<IndexedOperationEvent> = self
            .events
            .iter()
            .skip(offset as usize)
            .take((end - offset) as usize)
            .cloned()
            .collect();
        let next_index = retained_from.saturating_add(events.len() as u64);
        EventPage {
            from: retained_from,
            limit,
            next: (next_index < event_count).then_some(next_index),
            total: event_count,
            events,
        }
    }
}

impl Default for RetainedEventBuffer {
    fn default() -> Self {
        Self::new(EventRetentionCeiling::default())
    }
}

/// One page of `nodeOperationEventsResponseSchema`.
#[derive(Debug, Clone, PartialEq)]
pub struct EventPage {
    /// `from`: the first index actually returned.
    pub from: u64,
    /// `limit`: the normalized limit the request used.
    pub limit: u64,
    /// `next`: the index a follow-up request should ask for, absent at the end.
    pub next: Option<u64>,
    /// `total`: `eventCount`, every event ever emitted.
    pub total: u64,
    /// `events`.
    pub events: Vec<IndexedOperationEvent>,
}

/// `normalizeEventIndex` in `packages/services/src/index.ts:614-617`: an absent or
/// non-finite index is 0, anything else is floored and clamped to non-negative.
/// Whole `u64` input needs no clamping, so this is the identity for the values Rust
/// can express.
#[must_use]
pub const fn normalize_event_index(from: Option<u64>) -> u64 {
    match from {
        Some(value) => value,
        None => 0,
    }
}

/// `normalizeEventLimit` in `packages/services/src/index.ts:619-622`: absent is 100,
/// otherwise clamped into `1..=1000` after flooring.
///
/// `DEFAULT_OPERATION_EVENT_LIMIT` and `MAX_OPERATION_EVENT_LIMIT` are the private
/// constants at `packages/services/src/index.ts:222-223`.
pub const DEFAULT_OPERATION_EVENT_LIMIT: u64 = 100;
/// Ceiling for one events request.
pub const MAX_OPERATION_EVENT_LIMIT: u64 = 1_000;

#[must_use]
pub const fn normalize_event_limit(limit: Option<u64>) -> u64 {
    match limit {
        Some(value) => {
            if value < 1 {
                1
            } else if value > MAX_OPERATION_EVENT_LIMIT {
                MAX_OPERATION_EVENT_LIMIT
            } else {
                value
            }
        }
        None => DEFAULT_OPERATION_EVENT_LIMIT,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use xiranite_plugin_api::PluginRunEvent;

    fn event(message: &str) -> NodeRunEventRecord {
        NodeRunEventRecord::from_plugin_event(&PluginRunEvent::log_message(message))
    }

    fn ceiling(events: u32, bytes: u64) -> EventRetentionCeiling {
        EventRetentionCeiling::try_new(events, bytes).expect("non-zero ceiling")
    }

    #[test]
    fn the_count_ceiling_drops_the_oldest_events_and_counts_them() {
        // pushEvent(): splice(0, length - maxRetainedEvents).
        let mut buffer = RetainedEventBuffer::new(ceiling(3, 1_000_000));
        for index in 0..5 {
            buffer.push(EventIndex::new(index), event(&format!("e{index}")));
        }
        let stats = buffer.stats();
        assert_eq!(stats.retained_events, 3);
        assert_eq!(stats.dropped_events, 2, "two events left the buffer, so two must be counted");
        assert_eq!(stats.oversized_events, 0);
        let retained = buffer.retained();
        assert_eq!(
            retained.iter().map(|item| item.event.message.as_str()).collect::<Vec<_>>(),
            vec!["e2", "e3", "e4"]
        );
        assert_eq!(
            retained.iter().map(|item| item.index.get()).collect::<Vec<_>>(),
            vec![2, 3, 4],
            "absolute indexes survive a drop"
        );
    }

    #[test]
    fn the_byte_ceiling_drops_by_bytes_not_by_count() {
        // "abc" costs 4 bytes (message + kind tag), so a 9-byte budget keeps two.
        let mut buffer = RetainedEventBuffer::new(ceiling(50, 9));
        for index in 0..4 {
            buffer.push(EventIndex::new(index), event("abc"));
        }
        let stats = buffer.stats();
        assert_eq!(stats.retained_bytes, 8);
        assert_eq!(stats.retained_events, 2);
        assert_eq!(stats.dropped_events, 2);
    }

    #[test]
    fn a_single_event_bigger_than_the_budget_is_kept_and_reported() {
        let mut buffer = RetainedEventBuffer::new(ceiling(10, 8));
        let huge = NodeRunEventRecord {
            data: Some(xiranite_plugin_api::OpaquePayload::from_text(
                &"{}".repeat(64),
            )),
            ..event("abc")
        };
        let huge_cost = huge.retained_bytes();
        buffer.push(EventIndex::new(0), event("older"));
        buffer.push(EventIndex::new(1), huge.clone());

        let stats = buffer.stats();
        assert_eq!(stats.retained_events, 1, "the newest event is never dropped");
        assert_eq!(stats.retained_bytes, huge_cost);
        assert_eq!(stats.dropped_events, 1, "the older event was still displaced");
        assert_eq!(stats.oversized_events, 1, "and the over-budget keep is counted");
        assert_eq!(buffer.retained()[0].event, huge);
    }

    #[test]
    fn an_empty_buffer_pages_from_the_end_of_the_stream() {
        let buffer = RetainedEventBuffer::default();
        assert_eq!(buffer.first_retained_index(7), 7);
        let page = buffer.page(7, 0, 100);
        assert!(page.events.is_empty());
        assert_eq!(page.from, 7);
        assert_eq!(page.total, 7);
        assert_eq!(page.next, None);
    }

    #[test]
    fn paging_clamps_from_to_the_first_retained_index_like_the_backend() {
        // getOperationEvents(): retainedFrom = min(eventCount, max(from, firstRetained)).
        let mut buffer = RetainedEventBuffer::new(ceiling(2, 1_000_000));
        for index in 0..5 {
            buffer.push(EventIndex::new(index), event(&format!("e{index}")));
        }
        assert_eq!(buffer.stats().retained_events, 2);

        let page = buffer.page(5, 0, 10);
        assert_eq!(page.from, 3, "a request for dropped events starts at the first retained one");
        assert_eq!(page.events.iter().map(|item| item.index.get()).collect::<Vec<_>>(), vec![3, 4]);
        assert_eq!(page.next, None, "the page reached eventCount");
        assert_eq!(page.total, 5, "total counts the dropped events too");

        let first = buffer.page(5, 3, 1);
        assert_eq!(first.from, 3);
        assert_eq!(first.events.len(), 1);
        assert_eq!(first.next, Some(4), "a short page says where to continue");

        let beyond = buffer.page(5, 4, 1);
        assert_eq!(beyond.from, 4);
        assert_eq!(beyond.events.len(), 1);
        assert_eq!(beyond.next, None);
    }

    #[test]
    fn limit_and_index_normalization_match_the_typescript_helpers() {
        assert_eq!(normalize_event_limit(None), 100);
        assert_eq!(normalize_event_limit(Some(0)), 1);
        assert_eq!(normalize_event_limit(Some(7)), 7);
        assert_eq!(normalize_event_limit(Some(10_000)), 1_000);
        assert_eq!(normalize_event_index(None), 0);
        assert_eq!(normalize_event_index(Some(0)), 0);
        assert_eq!(normalize_event_index(Some(12)), 12);
    }

    #[test]
    fn the_default_ceiling_is_the_number_the_protocol_ships_with() {
        let buffer = RetainedEventBuffer::default();
        assert_eq!(
            buffer.ceiling(),
            EventRetentionCeiling::try_new(1_000, 2 * 1024 * 1024).expect("defaults")
        );
    }
}
