//! A node whose behaviour is a JavaScript bundle.
//!
//! [`JsNode`] answers [`BuiltInNode`], so the registry, the gate and the scheduler treat a scripted
//! node exactly like a native Rust one: one id, one implementation, one policy declaration. The
//! registration shape is `crates/nodes/dissolvef/src/builtin.rs`'s, with the bundle standing where
//! the Rust business modules stand:
//!
//! ```text
//! static LINEDUP_SPEC: JsNodeSpec = JsNodeSpec::platform(
//!     NodeDescriptor::new("linedup", "0.1.0", 1)
//!         .with_roots(&[RootRequirement { role: "workspace", access: RootAccess::ReadWrite }])
//!         .budget(8_388_608, 1),
//!     include_str!("../bundles/linedup.js"),
//!     "run",
//!     "createRuntime",
//! );
//! static LINEDUP_NODE: JsNode = JsNode::new(&LINEDUP_SPEC);
//! static LINEDUP_RUNNABLE: &'static dyn BuiltInNode = &LINEDUP_NODE;
//!
//! xiranite_node_registry::register_node!(LINEDUP_SPEC.descriptor);
//! xiranite_node_registry::register_node!(LINEDUP_RUNNABLE);
//! ```
//!
//! Both halves must be submitted, and the host must *name* the runnable through `link_nodes!`: an
//! `rlib` object file that nothing references is not linked, and the failure mode is a silently
//! missing node (`xiranite_node_registry::NodeLink`), which is why `descriptor()` reads the same
//! `static` the policy submission does.
//!
//! ## Why the source is `&'static str`
//!
//! ADR-0074 §6 fixes distribution as one host binary carrying every linked bundle plus one engine,
//! measured at 2.8 MiB for all 44 node cores together. `include_str!` is that decision's shape: a
//! bundle a host reads off disk at run time would be a second product (and a second failure mode)
//! for no benefit. The dev harness in `src/bin/quickjs-run.rs` reads a file, because its whole job is
//! exercising a bundle that has not been linked yet.

use xiranite_node_registry::{BuiltInNode, NodeDescriptor, NodeHost, NodeRunError};

use crate::engine::{EntryPlan, Executor};

/// One scripted node's declaration, spelled once at its own definition site.
#[derive(Debug)]
pub struct JsNodeSpec {
    /// The node's identity and machine requirements; also the live-byte budget the engine is set to.
    pub descriptor: NodeDescriptor,
    /// The bundle's JavaScript text, normally `include_str!` at the registration site.
    pub bundle: &'static str,
    /// The export that runs an operation (`PlatformRunFunction` or `PureRunFunction`).
    pub run_export: &'static str,
    /// The export that builds the platform object. `None` means the node is pure, and then
    /// `pure_message` is what its result document carries.
    pub create_runtime_export: Option<&'static str>,
    /// `PureNodeSpec.message` from `packages/runtime/src/node-runner.ts:25-30`.
    pub pure_message: &'static str,
    /// The node functions a definition may name, resolved as bundle exports by the same mechanism.
    pub functions: &'static [&'static str],
}

impl JsNodeSpec {
    /// A platform node: `run(input, runtime, onEvent)` plus `createRuntime()`.
    #[must_use]
    pub const fn platform(
        descriptor: NodeDescriptor,
        bundle: &'static str,
        run_export: &'static str,
        create_runtime_export: &'static str,
    ) -> Self {
        Self {
            descriptor,
            bundle,
            run_export,
            create_runtime_export: Some(create_runtime_export),
            pure_message: "",
            functions: &[],
        }
    }

    /// A pure node: `run(input)`, wrapped with `pure_message` the way the TypeScript runner wrapped it.
    #[must_use]
    pub const fn pure(
        descriptor: NodeDescriptor,
        bundle: &'static str,
        run_export: &'static str,
        pure_message: &'static str,
    ) -> Self {
        Self {
            descriptor,
            bundle,
            run_export,
            create_runtime_export: None,
            pure_message,
            functions: &[],
        }
    }

    /// The node functions this bundle publishes. A definition that names anything else is drift, and
    /// [`xiranite_node_registry::NodeRegistry::call_function`] says so in those words.
    #[must_use]
    pub const fn with_functions(mut self, functions: &'static [&'static str]) -> Self {
        self.functions = functions;
        self
    }

    /// The entry plan for one run, borrowing nothing but the `static` strings.
    #[must_use]
    pub const fn plan(&self) -> EntryPlan<'static> {
        EntryPlan {
            bundle_name: self.descriptor.id,
            source: self.bundle,
            run_export: self.run_export,
            create_runtime_export: self.create_runtime_export,
            pure_message: self.pure_message,
        }
    }
}

/// A built-in node whose behaviour is a bundle run in QuickJS.
#[derive(Debug)]
pub struct JsNode {
    spec: &'static JsNodeSpec,
}

impl JsNode {
    /// Wraps a declaration. `const` so a node can build its `static` in one expression.
    #[must_use]
    pub const fn new(spec: &'static JsNodeSpec) -> Self {
        Self { spec }
    }

    #[must_use]
    pub const fn spec(&self) -> &'static JsNodeSpec {
        self.spec
    }

    /// The executor for one run, with the ceilings the node declared.
    fn executor(&self) -> Result<Executor<'static>, NodeRunError> {
        Executor::new(self.spec.descriptor, self.spec.plan())
    }
}

impl BuiltInNode for JsNode {
    fn descriptor(&self) -> NodeDescriptor {
        self.spec.descriptor
    }

    /// Runs the bundle's entry export against the operation's host.
    ///
    /// The result document is the bundle's own object for a platform node, and the
    /// `{success, message, data}` envelope the TypeScript runner built for a pure node.
    fn run(&self, input: &str, host: &mut dyn NodeHost) -> Result<String, NodeRunError> {
        self.executor()?.run(input, host)
    }

    fn functions(&self) -> &'static [&'static str] {
        self.spec.functions
    }

    /// Dispatches a named node function to the bundle export of the same name.
    ///
    /// The name is checked against `functions()` by the registry before it gets here, so reaching
    /// this method with an unpublished name means a face called the node directly; it is still
    /// refused rather than resolved dynamically, because a definition pointing at nothing must not
    /// start a JavaScript run to find that out.
    fn call(
        &self,
        function: &str,
        input: &str,
        host: &mut dyn NodeHost,
    ) -> Result<String, NodeRunError> {
        if !self.spec.functions.contains(&function) {
            return Err(NodeRunError {
                message: format!(
                    "node {:?} publishes {:?}, not {function:?}",
                    self.spec.descriptor.id,
                    self.spec.functions
                ),
            });
        }
        self.executor()?.call_function(function, input, host)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::EngineLimits;
    use crate::test_host::CountingHost;
    use xiranite_node_registry::NodeRegistry;

    /// The smallest honest bundle: a pure node that echoes one field of its request document.
    static ECHO_BUNDLE: &str = r#"
export function run(input) {
  return { path: input.path, items: (input.names || []).length };
}
"#;

    static ECHO_SPEC: JsNodeSpec = JsNodeSpec::pure(
        NodeDescriptor::new("quickjs-node-test.echo", "0.1.0", 1).budget(1_048_576, 1),
        ECHO_BUNDLE,
        "run",
        "echo completed",
    );

    static ECHO_NODE: JsNode = JsNode::new(&ECHO_SPEC);

    static ECHO_RUNNABLE: &'static dyn BuiltInNode = &ECHO_NODE;

    // Submitted for real, so the collection path is exercised and not merely described.
    xiranite_node_registry::register_node!(ECHO_SPEC.descriptor);
    xiranite_node_registry::register_node!(ECHO_RUNNABLE);

    #[test]
    fn a_scripted_node_reaches_the_registry_of_the_binary_it_was_linked_into() {
        let registry = NodeRegistry::builtin().expect("one id per node in this test binary");
        assert!(
            !registry.is_empty(),
            "an empty table means link-time collection silently failed, not that the node is absent"
        );
        let descriptor = registry
            .get("quickjs-node-test.echo")
            .unwrap_or_else(|| panic!("the spec never reached the table: {:?}", registry.ids().collect::<Vec<_>>()));
        assert_eq!(descriptor.requirements.max_live_bytes, 1_048_576);
        assert!(
            !registry.policy_only_ids().contains(&"quickjs-node-test.echo"),
            "declared but not runnable is the half-registration this pair exists to catch: {:?}",
            registry.policy_only_ids()
        );
        assert!(
            !registry.runnable_without_policy_ids().contains(&"quickjs-node-test.echo"),
            "a runnable with no declared policy leaves the scheduler with nothing to grant"
        );
        let runnable = registry.runnable("quickjs-node-test.echo").expect("reachable by id");
        assert_eq!(runnable.descriptor().id, "quickjs-node-test.echo");
        assert_eq!(runnable.descriptor(), ECHO_SPEC.descriptor);
    }

    #[test]
    fn running_it_through_the_registry_answers_the_envelope_the_runner_built() {
        let registry = NodeRegistry::builtin().expect("no duplicate id");
        let mut host = CountingHost::new();
        let answer = registry
            .runnable("quickjs-node-test.echo")
            .expect("runnable")
            .run(r#"{"path":"/work","names":["a","b"]}"#, &mut host)
            .expect("a pure run answers a document");
        let document: serde_json::Value = serde_json::from_str(&answer).expect("document is JSON");
        assert_eq!(document["success"], true);
        assert_eq!(document["message"], "echo completed");
        assert_eq!(document["data"]["path"], "/work");
        assert_eq!(document["data"]["items"], 2);
    }

    #[test]
    fn an_unpublished_node_function_is_refused_before_any_javascript_runs() {
        let mut host = CountingHost::new();
        let error = ECHO_NODE
            .call("preview", "{}", &mut host)
            .expect_err("the spec publishes no functions, so nothing may be called");
        assert!(error.message.contains("publishes"), "{}", error.message);
        assert!(host.calls.is_empty(), "a refusal must not have started an engine run");
    }

    #[test]
    fn a_node_with_no_declared_budget_is_refused_rather_than_unlimited() {
        static UNBUDGETED: JsNodeSpec = JsNodeSpec::pure(
            NodeDescriptor::new("quickjs-node-test.unbudgeted", "0.1.0", 1),
            ECHO_BUNDLE,
            "run",
            "never runs",
        );
        let mut host = CountingHost::new();
        let error = JsNode::new(&UNBUDGETED)
            .run("{}", &mut host)
            .expect_err("max_live_bytes = 0 is a refusal to schedule (ADR-0073)");
        assert!(error.message.contains("refuses to schedule"), "{}", error.message);
        assert!(
            EngineLimits::from_descriptor(&UNBUDGETED.descriptor).is_err(),
            "the refusal must come from the limits, so every entry point shares it"
        );
    }

    #[test]
    fn the_derived_stack_ceiling_tracks_the_nodes_own_budget_within_its_clamp() {
        // A derivation nobody can read is the same as a hardcoded number, so both ends are asserted.
        assert_eq!(EngineLimits::stack_from_budget(1_048_576), EngineLimits::MIN_STACK_BYTES);
        assert_eq!(EngineLimits::stack_from_budget(8_388_608), 1_048_576);
        assert_eq!(EngineLimits::stack_from_budget(16_777_216), 2_097_152.min(EngineLimits::MAX_STACK_BYTES));
        assert_eq!(EngineLimits::stack_from_budget(1_073_741_824), EngineLimits::MAX_STACK_BYTES);
        let limits = EngineLimits::from_descriptor(&ECHO_SPEC.descriptor).expect("budgeted");
        assert_eq!(limits.memory_limit_bytes, 1_048_576);
        assert_eq!(limits.max_stack_bytes, EngineLimits::MIN_STACK_BYTES);
    }
}
