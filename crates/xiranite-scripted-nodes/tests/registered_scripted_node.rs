//! The registration is only worth anything if a scripted node is reachable and runnable **through the
//! registry**, on the same path a native node takes. These tests fail in the ways that would otherwise be
//! silent: the inventory not collecting, the pair declared-but-not-runnable, and a "pure" node that quietly
//! reached a host service.

use std::panic::{catch_unwind, AssertUnwindSafe};

use xiranite_node_registry::{
    NodeCheckpointRequest, NodeDirEntry, NodeHost, NodeHostResult, NodePathInfo, NodeRegistry,
};
use xiranite_plugin_api::checkpoint::CheckpointOutcome;
use xiranite_plugin_api::run_events::PluginRunEvent;
use xiranite_scripted_nodes::{SCRIPTED_NODE_IDS, UNREGISTERED_BUNDLES, registered_count, unregistered_count};

/// A host that refuses to be used. `linedup` is measured as `pure-logic` in the retained-node manifest, so
/// any call here means the manifest's claim, or this test's premise, is false.
struct RefusingHost {
    /// Counts the run-control arm so the test can say the run actually went through the pump.
    checkpoints: u32,
}

impl NodeHost for RefusingHost {
    fn stat(&mut self, path: &str) -> NodeHostResult<NodePathInfo> {
        panic!("a pure node reached the host for stat({path:?})");
    }
    fn list_dir(&mut self, path: &str) -> NodeHostResult<Vec<NodeDirEntry>> {
        panic!("a pure node reached the host for list_dir({path:?})");
    }
    fn ensure_dir(&mut self, path: &str) -> NodeHostResult<()> {
        panic!("a pure node reached the host for ensure_dir({path:?})");
    }
    fn move_path(&mut self, source: &str, target: &str) -> NodeHostResult<()> {
        panic!("a pure node reached the host for move_path({source:?} -> {target:?})");
    }
    fn delete_path(&mut self, path: &str, recursive: bool) -> NodeHostResult<()> {
        panic!("a pure node reached the host for delete_path({path:?}, recursive={recursive})");
    }
    fn read_text(&mut self, path: &str) -> NodeHostResult<Option<String>> {
        panic!("a pure node reached the host for read_text({path:?})");
    }
    fn write_text(&mut self, path: &str, content: &str) -> NodeHostResult<()> {
        panic!("a pure node reached the host for write_text({path:?}, {} bytes)", content.len());
    }
    fn now(&mut self) -> NodeHostResult<String> {
        panic!("a pure node reached the host for now()");
    }
    fn emit(&mut self, _event: &PluginRunEvent) -> NodeHostResult<()> {
        panic!("a pure node reached the host to emit an event");
    }
    /// Measured: even a pure node's run enters the checkpoint arm, because that is how the pump checks
    /// cancel/pause. It is the environment services above that a `pure-logic` node must never touch, so
    /// this one answers and counts instead of refusing.
    fn checkpoint(&mut self, _request: &NodeCheckpointRequest) -> NodeHostResult<CheckpointOutcome> {
        self.checkpoints += 1;
        Ok(CheckpointOutcome::Continue)
    }
}

#[test]
fn a_scripted_node_is_reachable_and_runnable_through_the_registry() {
    let registry = NodeRegistry::builtin().expect("one id per node in this binary");
    assert!(
        registry.runnable("linedup").is_some(),
        "the scripted node never reached the table; ids here are {:?}",
        registry.ids().collect::<Vec<_>>()
    );
    assert!(
        !registry.policy_only_ids().contains(&"linedup"),
        "declared without a runnable is the half-registration this pair exists to catch"
    );

    let node = registry.runnable("linedup").expect("reachable by id");
    let request = r#"{"sourceLines":["alpha","beta","gamma","beta"],"filterLines":["beta"],"caseSensitive":false,"sort":true}"#;
    let mut host = RefusingHost { checkpoints: 0 };
    let outcome = catch_unwind(AssertUnwindSafe(|| node.run(request, &mut host)));
    let document = match outcome {
        Ok(Ok(document)) => document,
        Ok(Err(error)) => panic!("the scripted run failed: {}", error.message),
        Err(panic) => panic!(
            "a node the manifest measures as pure-logic reached the host: {}",
            panic
                .downcast_ref::<String>()
                .cloned()
                .unwrap_or_else(|| String::from("a panic without a message"))
        ),
    };

    let value: serde_json::Value = serde_json::from_str(&document).expect("the answer is a document");
    assert_eq!(value["success"], true, "{value}");
    // The message comes from the generated runner table, so the scripted answer and the TypeScript
    // runner's answer stay one string rather than two that drift.
    assert_eq!(value["message"], "Filtered lines.", "{value}");
    assert_eq!(value["data"]["keptCount"], 2, "{value}");
    assert_eq!(value["data"]["removedCount"], 1, "{value}");
    assert!(
        host.checkpoints >= 1,
        "the run never reached the pump's run-control arm, so this document came from somewhere unexpected"
    );
}

#[test]
fn every_embedded_bundle_is_either_registered_or_explained() {
    assert_eq!(
        registered_count() + unregistered_count(),
        SCRIPTED_NODE_IDS.len() + UNREGISTERED_BUNDLES.len(),
        "the counters and the tables disagree"
    );
    for (id, reason) in UNREGISTERED_BUNDLES {
        assert!(
            !reason.trim().is_empty(),
            "{id} is unregistered without a reason, which is how a gap starts looking finished"
        );
        assert!(
            !SCRIPTED_NODE_IDS.contains(id),
            "{id} appears both as served and as refused"
        );
    }
    // The count assertion is the visible part of the missing-policy finding: it is a canary that forces a
    // re-read whenever the embedded set changes size. It moved 24 → 28 when eight nodes got a declared
    // live-byte ceiling (docs/xiranite-target-node-manifest.json) and embed registered them; today 18 are
    // served and 10 are refused with a reason in `UNREGISTERED_BUNDLES` (the refusals are grant questions,
    // not build failures). If a future run registers more, this line moves again.
    assert_eq!(
        UNREGISTERED_BUNDLES.len() + SCRIPTED_NODE_IDS.len(),
        28,
        "the embedded set changed size without this test being retargeted"
    );
}
