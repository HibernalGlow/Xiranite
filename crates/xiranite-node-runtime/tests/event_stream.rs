//! A client that subscribes **before** the run emits must see each event exactly once.
//!
//! Why this needs its own file and its own gauge: the duplicate was produced by
//! `xiranite.operation.emit` calling `OperationManager::publish` after `push_event`, and `push_event`
//! already fans the `Event` frame out to every live listener. Every other read path —
//! `/node-operations/:id/events`, the retained window, the terminal result record — reads the retained
//! buffer, where a double send is invisible. Only a live subscription sees it, and the browser faces
//! always subscribe live, so this is the test that carries that evidence. Measured before the fix: the
//! dissolvef run's 7 progress events arrived as 14 frames with indexes `[0,0,1,1,…,6,6]`.

use std::path::Path;
use std::sync::Arc;

use serde_json::json;
use xiranite_core::filesystem::FileCapability;
use xiranite_core::{OperationManager, OperationManagerOptions, OperationStreamMessage, SubscribeOptions, SystemClock};
use xiranite_extism_adapter::CapabilityHost;
use xiranite_node_runtime::{OperationCapabilities, SERVED_CAPABILITIES};

/// The request document `xiranite.operation.emit` parses: a scoped call plus one `nodeRunEventSchema`.
fn emit_request(operation_id: &str, message: &str) -> String {
    json!({ "operationId": operation_id, "event": { "type": "log", "message": message } }).to_string()
}

fn event_indexes(frames: &[OperationStreamMessage]) -> Vec<u64> {
    frames
        .iter()
        .filter_map(|frame| match frame {
            OperationStreamMessage::Event { index, .. } => Some(index.get()),
            _ => None,
        })
        .collect()
}

#[test]
fn one_emit_delivers_exactly_one_live_event_frame_in_index_order() {
    let emit = SERVED_CAPABILITIES
        .iter()
        .find(|name| **name == "xiranite.operation.emit")
        .expect("the host must serve xiranite.operation.emit");

    let manager = OperationManager::new(OperationManagerOptions::default());
    let control = manager.start("dissolvef", None, None);
    let operation_id = control.operation_id().to_owned();
    let mut subscription = manager
        .subscribe(
            &operation_id,
            &SubscribeOptions { from_event_index: Some(0), include_snapshot: true },
        )
        .expect("a fresh operation is subscribable");

    let capabilities = OperationCapabilities::new(
        manager.clone(),
        control,
        FileCapability::new([Path::new("/")]),
        Arc::new(SystemClock),
    );

    for message in ["first", "second", "third"] {
        capabilities
            .capability(emit, &emit_request(&operation_id, message))
            .expect("an emit on a running operation is accepted");
    }

    let frames: Vec<OperationStreamMessage> = std::iter::from_fn(|| subscription.try_next()).collect();
    assert_eq!(
        event_indexes(&frames),
        vec![0, 1, 2],
        "each event must arrive once on a live subscription; frames were {frames:?}"
    );

    // The retained window is the replay path and must agree with what the live listener saw — a
    // divergence in either direction means one of the two paths is double-counting.
    let events = manager.events(&operation_id, None, None).expect("the operation exists");
    assert_eq!(events.total, 3, "the retained buffer must hold exactly the three emitted events");
}

#[test]
fn a_late_subscriber_replays_the_retained_window_once() {
    let manager = OperationManager::new(OperationManagerOptions::default());
    let control = manager.start("dissolvef", None, None);
    let operation_id = control.operation_id().to_owned();
    let capabilities = OperationCapabilities::new(
        manager.clone(),
        control,
        FileCapability::new([Path::new("/")]),
        Arc::new(SystemClock),
    );
    for message in ["first", "second"] {
        capabilities
            .capability("xiranite.operation.emit", &emit_request(&operation_id, message))
            .expect("an emit on a running operation is accepted");
    }

    // Subscribing after the fact is the other half of the contract: the retained events replay, and
    // nothing is added because no listener was attached when they were pushed.
    let mut subscription = manager
        .subscribe(&operation_id, &SubscribeOptions::default())
        .expect("a running operation is subscribable");
    let frames: Vec<OperationStreamMessage> = std::iter::from_fn(|| subscription.try_next()).collect();
    assert_eq!(event_indexes(&frames), vec![0, 1], "a late subscriber replays each retained event once");
}
