//! Linedup as a built-in node (ADR-0073): the registration, the request envelope, nothing else.
//!
//! There is no `HostBridge` here, and that is the point. DissolveF needed one (`crates/nodes/dissolvef/
//! src/builtin.rs:49-139`) because its business modules call a node-local `DissolvefHost` trait that a
//! hundred green tests pin; Linedup's equivalents were `LinedupFileSystem` and `LinedupRunControl`,
//! together 283 lines of which the actual traits were about twelve. Writing the core against the shared
//! [`NodeHost`] instead — which is what `xiranite-node-registry`'s own seam docs prescribe for a native
//! node — deletes that shim instead of re-homing it, so `run_linedup` takes the host the operation was
//! started with and this module only turns bytes into a request and a result back into bytes.
//!
//! ## What the entry point keeps from `plugins/linedup/src/plugin_entry.rs`
//!
//! * The wrapped/bare request shape (`linedup_input_value_of`, `plugin_entry.rs:44-49`): the HTTP
//!   operation body is `{ "input": { … }, "context": { … } }` and `nodeRunRequestSchema.input` is
//!   optional, so both spellings still run.
//! * Blank text means an empty request, which the blank-source rule then refuses
//!   (`plugin_entry.rs:138-141`). A card that submits before any field is filled gets 请输入原文本。, as
//!   `interaction.ts` answered.
//! * The response document is `nodeRunResultSchema`'s `{ success, message, data? }` with no `events`
//!   key, because `definition.json:162` sets `reportsProgress: false`.
//!
//! ## What it drops
//!
//! * `linedup_describe`, `linedup_normalize_input`, `linedup_preview`, `linedup_result_view` and the
//!   whole entry-point/ABI-name table (`plugin_entry.rs:84-134`, `node_metadata.rs`): these were wasm
//!   exports addressed by symbol, and ADR-0073 voids that entry convention. The documents they produced
//!   are not lost — `LinedupInput::to_json`, `LinedupInput::preview_lines` and `result_view_of` are
//!   exported from this crate and a face or the definition evaluator can call them in process the moment
//!   the seam gains a node-function arm. Until then a definition that asks for `previewExport` has
//!   nothing to resolve, which is a gap to report rather than one to paper over here.
//! * `linedup_operation_id_of` (`plugin_entry.rs:154-163`): the operation id existed to scope a
//!   cross-boundary capability call. A native node is already inside the operation that started it, and
//!   `NodeHost::checkpoint` carries no id.

use crate::contract::LinedupInput;
use crate::run::run_linedup;
use serde_json::Value;
use xiranite_node_registry::{BuiltInNode, NodeDescriptor, NodeHost, NodeRunError, RootAccess, RootRequirement};

/// The node's registration, spelled once. Both [`BuiltInNode::descriptor`] and `register_node!` read
/// this same `static`, so the registry and the runnable node cannot disagree about the id or the policy.
///
/// Versions come from `plugins/linedup/manifest.toml:7-10`: `version = "0.1.0"` is the node's own
/// release, `backend_api = "1.0"` is the major the Plugin API vocabulary it was written against, and the
/// manifest's third version fact (`backend.runtime_version = "1.30.0"`, the Extism build) disappears
/// with wasm exactly as ADR-0073 says it should.
static DESCRIPTOR: NodeDescriptor = NodeDescriptor::new("linedup", "0.1.0", 1)
    // One writable root. `plugins/linedup/manifest.toml:43` declared `allowed_paths = []`, which was an
    // honest answer about *paths* — `definition.json` publishes no path field, so a fixed directory is
    // unknowable at authoring time — not about roles. The seam resolves a role per operation instead, and
    // the node does reach the machine whenever the request carries `sourceFile` / `filterFile` /
    // `outputFile` (`run::resolve_input_text`, `run::run_linedup`'s write arm).
    //
    // ReadWrite, not ReadOnly, because `outputFile` writes the kept lines (`cli.ts:439-442`); a read-only
    // root would refuse the guided `source.txt` + `filter.txt` -> `output.txt` flow outright. One role
    // and not two, because that convention resolves all three files against the operation's working
    // directory (`cli.ts:485-498`) rather than across roots.
    .with_roots(&[RootRequirement {
        role: "workspace",
        access: RootAccess::ReadWrite,
    }])
    // Spelled out rather than left at the default, so the claim is reviewable: no part of Linedup runs a
    // program. `packages/nodes/linedup/src` shells out exactly once — the clipboard fallback of the
    // guided CLI flow (`cli.ts:247-259` via `platform.ts:1`), which is a face effect and stays in the
    // CLI binary per ADR-0069. A `ProcessGrant` here would widen the allowlist for free.
    .with_processes(&[])
    // Not a tree walker: the node reads and writes named files and never lists a directory. The seam's
    // other seven methods are refused by the test host precisely so that a stray `list_dir` cannot enter
    // this descriptor by accident.
    .walk_tree(false)
    // `max_live_bytes` is the ceiling the node shipped with, derived and not invented:
    // `plugins/linedup/manifest.toml:26` sets `memory_max_pages = 256`, and a wasm page is 64 KiB, so
    // 256 x 65_536 = 16_777_216. The reasoning that sized it is in `plugins/linedup/src/lib.rs:44-52`:
    // one run keeps the deduplicated source, the tokens, the kept lines, the removed lines, the removal
    // details and the natural-sort keys — about six copies of the paste, roughly 13 MiB at 40 bytes per
    // line for 40 000 lines. Keeping the exact number means a native run that would have exceeded what a
    // wasm run could hold is still refused instead of quietly growing.
    //
    // `max_concurrent_items` is 1: a run is one single-threaded pass over one paste and holds no second
    // item open. The 4096-line batch (`filter_core::CHECKPOINT_LINE_BATCH`) bounds pause latency, not
    // concurrency, and must not be read as a claim that four thousand lines are in flight at once.
    .budget(16_777_216, 1);

xiranite_node_registry::register_node!(DESCRIPTOR);

/// The dispatch half of the same declaration: `DESCRIPTOR` is the policy the host reads, this is the
/// runnable the host calls. One `static` each, and both name the id spelled in `DESCRIPTOR`, so the
/// two tables cannot disagree.
///
/// Public because the host must *name* it to link this crate: an `rlib` object file carrying an
/// `inventory` submission is dropped when nothing references a symbol in it, so a dependency alone does
/// not register the node (see `xiranite_node_registry::NodeLink`).
pub static LINEDUP_RUNNABLE: &'static dyn BuiltInNode = &LinedupNode;

xiranite_node_registry::register_node!(LINEDUP_RUNNABLE);

/// The response `run` produces when a request document cannot be read at all.
///
/// `plugins/linedup/src/plugin_entry.rs:73-82` answered this with a `success: false` result document,
/// which was right for a guest that must never trap. It is not right here: `BuiltInNode::run`
/// already has a typed way to say "no result document was produced", and a failure document would tell
/// the card the filter ran and refused, when in fact the node never understood the request. The
/// blank-source case keeps its result document because that request *was* understood — see
/// `LinedupNode::run` below.
const REQUEST_UNREADABLE: &str = "invalid Linedup request document: ";

/// Linedup, ready to be run by name from inside the host binary.
pub struct LinedupNode;

impl BuiltInNode for LinedupNode {
    fn descriptor(&self) -> NodeDescriptor {
        DESCRIPTOR
    }

    /// `linedup_run` minus the ABI: the same request document in, the same result document out.
    ///
    /// No `events` array is ever emitted, unlike the TimeU port: `definition.json:162` sets
    /// `reportsProgress: false` and `runLinedupInteraction` raised no events, so a run that called
    /// `NodeHost::emit` would be reporting progress its own published definition denies — the same kind
    /// of false claim as declaring a network host it never dials.
    fn run(&self, input: &str, host: &mut dyn NodeHost) -> Result<String, NodeRunError> {
        let request = read_request_document(input)?;
        let linedup_input = LinedupInput::from_json(request_input_of(&request));
        let result = run_linedup(&linedup_input, host);
        serde_json::to_string(&result).map_err(|error| NodeRunError {
            message: format!("Linedup result document could not be serialized: {error}"),
        })
    }
}

/// Decodes the request envelope. Blank text is the empty request; anything unparseable is a run error.
fn read_request_document(text: &str) -> Result<Value, NodeRunError> {
    if text.trim().is_empty() {
        // `interaction.ts` read an absent field as the empty one, so an absent request behaves like the
        // default request and the blank-source rule is what refuses it (`plugin_entry.rs:138-141`).
        return Ok(Value::Object(serde_json::Map::new()));
    }
    serde_json::from_str(text).map_err(|error| NodeRunError {
        message: format!("{REQUEST_UNREADABLE}{error}"),
    })
}

/// The `input` document of a request, tolerating a request that already unwrapped it.
///
/// `context` is read but not used, exactly as the plugin entry did: Linedup has no workspace or
/// component state, and its output is text the caller holds rather than a record file with an owner.
fn request_input_of(request: &Value) -> &Value {
    match request.get("input") {
        Some(input) => input,
        None => request,
    }
}

#[cfg(test)]
mod tests {
    use super::{DESCRIPTOR, LinedupNode, REQUEST_UNREADABLE};
    use crate::filter_core::filter_lines_batched;
    use crate::test_host::TestHost;
    use xiranite_node_registry::{
        BuiltInNode, NetworkAccess, NodeRegistry, NodeRunError, RootAccess, RootRequirement,
    };

    /// A whole run through the entry point, so the envelope is part of what is asserted.
    fn run(text: &str, host: &mut TestHost) -> Result<String, NodeRunError> {
        LinedupNode.run(text, host)
    }

    fn document(answer: Result<String, NodeRunError>) -> serde_json::Value {
        let text = answer.unwrap_or_else(|error| panic!("expected a result document, got {error}"));
        serde_json::from_str(&text).expect("response is JSON")
    }

    #[test]
    fn a_built_in_crate_reaches_both_registry_tables_of_the_binary_it_was_linked_into() {
        // The failure mode ADR-0073 names is a silent missing node, so the table itself is asserted
        // before the membership: an empty registry means link-time collection never ran, and every
        // "not found" below would also be green.
        let registry = NodeRegistry::builtin().expect("no duplicate id in this test binary");
        assert!(
            !registry.is_empty(),
            "an empty table means link-time collection silently failed, not that the node is absent"
        );
        let descriptor = registry
            .get("linedup")
            .unwrap_or_else(|| panic!("linedup never reached the table: {:?}", registry.ids().collect::<Vec<_>>()));
        assert_eq!(*descriptor, DESCRIPTOR);
        assert_eq!(descriptor.id, "linedup");
        assert_eq!(descriptor.node_version, "0.1.0");
        assert_eq!(descriptor.api_version, 1);
        assert_eq!(
            descriptor.requirements.network,
            NetworkAccess::Disabled,
            "the collected copy must not have lost the safest default"
        );

        // The dispatch half, asserted separately: a node that submits only its descriptor is listed in
        // the product and refuses to run, which is the partial-link shape `NodeRegistry` was extended
        // with `policy_only_ids`/`runnable_without_policy_ids` to catch.
        let runnable = registry
            .runnable("linedup")
            .unwrap_or_else(|| panic!("linedup's runnable never reached the dispatch table"));
        assert_eq!(runnable.descriptor(), DESCRIPTOR);
        assert_eq!(
            registry.policy_only_ids(),
            Vec::<&'static str>::new(),
            "every declared id in this binary must also be runnable"
        );
        assert_eq!(
            registry.runnable_without_policy_ids(),
            Vec::<&'static str>::new(),
            "and every runnable must have the policy the host enforces for it"
        );
    }

    #[test]
    fn the_registration_declares_exactly_what_the_node_does() {
        assert_eq!(
            DESCRIPTOR.requirements.roots,
            &[RootRequirement { role: "workspace", access: RootAccess::ReadWrite }][..],
            "the node writes kept lines to `outputFile`, so one writable role is the whole grant"
        );
        assert!(
            DESCRIPTOR.requirements.processes.is_empty(),
            "the only shell-out in this node is the CLI face's clipboard fallback"
        );
        assert_eq!(DESCRIPTOR.requirements.network, NetworkAccess::Disabled);
        assert!(
            !DESCRIPTOR.requirements.enumerates_recursively,
            "Linedup reads named files and never walks a tree"
        );
        // The arithmetic the comment claims, asserted rather than trusted.
        assert_eq!(
            DESCRIPTOR.requirements.max_live_bytes,
            256 * 64 * 1024,
            "256 pages x 64 KiB, the ceiling `manifest.toml:26` shipped with"
        );
        assert_eq!(DESCRIPTOR.requirements.max_concurrent_items, 1);
        assert_ne!(
            DESCRIPTOR.requirements.max_live_bytes, 0,
            "`0` means undeclared and the host must refuse to schedule it"
        );
    }

    #[test]
    fn a_request_document_that_is_not_json_is_a_run_error_not_a_result_document() {
        let error = LinedupNode
            .run("{not json", &mut TestHost::new())
            .expect_err("a request the node cannot read must not come back as a filtered result");
        assert!(
            error.message.starts_with(REQUEST_UNREADABLE),
            "unexpected message: {}",
            error.message
        );
        assert!(
            !error.message.starts_with('{'),
            "a run error is a message, not a smuggled result document"
        );
    }

    #[test]
    fn a_blank_request_is_the_blank_source_rule_and_not_a_run_error() {
        // The other arm of `read_request_document`: `interaction.ts` accepted an absent request, and a
        // card that submits an empty form must see the rule's copy rather than a protocol error.
        let value = document(run("", &mut TestHost::new()));
        assert_eq!(value["success"], serde_json::json!(false));
        assert_eq!(value["message"], serde_json::json!("请输入原文本。"));
        assert!(value.get("data").is_none());
    }

    #[test]
    fn a_wrapped_request_and_a_bare_input_produce_the_same_run() {
        let input = r#"{"sourceText":"alpha\nbeta","filterText":"beta"}"#;
        let wrapped = document(run(
            &format!(r#"{{"input":{input},"context":{{"componentId":"card-1","workspaceId":"ws-1"}}}}"#),
            &mut TestHost::new(),
        ));
        let bare = document(run(input, &mut TestHost::new()));
        assert_eq!(wrapped, bare, "nodeRunRequestSchema.input is optional");
        assert_eq!(wrapped["success"], serde_json::json!(true));
        assert_eq!(wrapped["message"], serde_json::json!("Filtered 1 line(s); kept 1."));
        assert_eq!(wrapped["data"]["filteredLines"], serde_json::json!(["alpha"]));
        assert_eq!(
            wrapped["data"]["details"],
            serde_json::json!([{ "line": "beta", "matchedFilter": "beta" }])
        );
        assert!(
            wrapped.get("events").is_none(),
            "reportsProgress is false, so no event list exists in the response"
        );
    }

    #[test]
    fn a_file_flow_sends_the_read_through_the_seam_before_anything_else() {
        // The bridge-dead control: every other assertion in this file would still pass if the host were
        // never reached, because an inline `sourceText` needs no host at all.
        let mut host = TestHost::new()
            .with_file("/data/source.txt", "gamma\nbeta-one\nalpha\n")
            .with_file("/data/filter.txt", "beta\n");
        let value = document(run(
            r#"{"input":{"sourceFile":"/data/source.txt","filterFile":"/data/filter.txt","outputFile":"/data/kept.txt","sort":false}}"#,
            &mut host,
        ));
        assert_eq!(value["success"], serde_json::json!(true), "{value}");
        assert_eq!(value["data"]["filteredLines"], serde_json::json!(["gamma", "alpha"]));
        assert_eq!(
            host.contents_of("/data/kept.txt").expect("the output file was written"),
            "gamma\nalpha\n"
        );
        assert_eq!(
            host.calls.first().map(String::as_str),
            Some("read_text /data/source.txt"),
            "the first host call of a file flow must be its first read: {:?}",
            host.calls
        );
        assert!(
            host.calls.iter().any(|call| call.starts_with("write_text /data/kept.txt")),
            "the write must cross the same seam: {:?}",
            host.calls
        );
    }

    #[test]
    fn a_cancel_and_a_machine_failure_do_not_arrive_as_the_same_answer() {
        // ADR-0073 keeps exactly two arms in `NodeHostError` because a node must be able to branch on
        // them; the retired shim collapsed both into one `Cancelled` (`run_control.rs:47-59`), which is
        // the flattening this asserts against. Both are driven at the batch boundary, where the node has
        // no per-item wording to hide behind.
        let source: Vec<String> = ["keep", "drop-a", "drop-b", "drop-c"]
            .iter()
            .map(|line| (*line).to_owned())
            .collect();
        let tokens: Vec<String> = vec!["drop".to_owned()];

        let mut cancelled_host = TestHost::new().cancelling_at(1);
        let cancelled = filter_lines_batched(&source, &tokens, true, true, 2, &mut cancelled_host);
        assert_eq!(cancelled.cancelled_after, Some(2), "the cancel stops after one batch of two");
        assert_eq!(cancelled.host_failure, None);

        let mut broken_host = TestHost::new().with_failing_checkpoint();
        let broken = filter_lines_batched(&source, &tokens, true, true, 2, &mut broken_host);
        assert_eq!(broken.cancelled_after, None, "a host that broke is not an operator who pressed cancel");
        assert_eq!(
            broken.host_failure,
            Some((2, "operation row disappeared".to_owned())),
            "the host's own reason has to survive into the node"
        );

        // And the two arms reach the user as two different messages.
        let cancel_document = document(run(
            r#"{"sourceText":"keep\ndrop-a\ndrop-b\ndrop-c","filterText":"drop"}"#,
            &mut TestHost::new().cancelling_at(1),
        ));
        assert_eq!(
            cancel_document["message"],
            serde_json::json!("Linedup stopped after 4 of 4 unique line(s).")
        );
        let failure_document = document(run(
            r#"{"sourceText":"keep\ndrop-a\ndrop-b\ndrop-c","filterText":"drop"}"#,
            &mut TestHost::new().with_failing_checkpoint(),
        ));
        assert_eq!(
            failure_document["message"],
            serde_json::json!("Linedup lost the host after 4 of 4 unique line(s): operation row disappeared.")
        );
        assert_ne!(cancel_document["message"], failure_document["message"]);
    }

    #[test]
    fn a_declared_requirement_is_the_only_host_surface_the_node_uses() {
        // The descriptor says no recursion, no clock, no progress reporting. `TestHost` refuses
        // `stat`/`list_dir`/`ensure_dir`/`move_path`/`delete_path`/`now`/`emit` on those words, so a run
        // that started reaching for one of them fails loudly here instead of widening silently later.
        let mut host = TestHost::new();
        let value = document(run(r#"{"sourceText":"alpha","filterText":"zz"}"#, &mut host));
        assert_eq!(value["success"], serde_json::json!(true));
        for call in &host.calls {
            assert!(
                call.starts_with("checkpoint"),
                "a run with no path slots reached for {call:?}"
            );
        }
        assert_eq!(
            DESCRIPTOR.requirements.network,
            NetworkAccess::Disabled,
            "and the mirror claim: the node asks for no hosts"
        );
    }
}
