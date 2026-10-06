//! The registry of statically built-in nodes (ADR-0073).
//!
//! A node declares itself once, at its own definition site, through [`inventory`]; the host collects
//! every declaration that was linked in. There is no central node list to keep in sync, which is the
//! point of moving registration into the crate graph: the previous shape had three sources of truth
//! (`docs/xiranite-target-node-manifest.json`, `xiranite.build.toml` and the `packages/nodes/`
//! directories) plus a generated registry, and `bun run audit:target-node-manifest` existed only to
//! catch them drifting apart.
//!
//! ## What this crate deliberately does not do
//!
//! It does not load code. Nodes are Rust crates linked into the host, so there is no `dlopen`, no
//! plugin ABI, and no version handshake to get wrong. Third-party delivery, if it ever comes, is a
//! separate decision that needs a C ABI plus a rustc/target check — ADR-0073 keeps that out of scope.
//!
//! It also does not define the behaviour seam (`run`). That seam has to come from the one node that
//! is already translated (`crates/nodes/dissolvef/`), not from a second guess here.
//!
//! ## Policy, not capability
//!
//! [`NodeRequirements`] is a request, not an ability. Native node code can already reach the
//! filesystem and spawn processes; that is precisely why the declaration must exist and the host must
//! enforce it — granted roots per operation, an allowlist of external programs, network permission.
//! Retiring the `xiranite.*` capability vocabulary removes the boundary *shape*, not the boundary.

// Re-exported so `register_node!` can reach `submit!` from a dependent crate.
pub use inventory;

pub mod host_seam;

pub use host_seam::{
    BuiltInNode, NodeCheckpointRequest, NodeDirEntry, NodeHost, NodeHostError, NodeHostResult,
    NodePathInfo, NodeRunError,
};

use std::collections::BTreeMap;
use std::error::Error;
use std::fmt;

/// How a node intends to use a granted root directory.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RootAccess {
    /// The node reads but never writes.
    ReadOnly,
    /// The node may create, rename, and delete inside the root.
    ReadWrite,
}

/// One root a node needs, named by role rather than by path.
///
/// Paths are user-supplied at run time (`XIRANITE_ALLOWED_DIRS` today), so a node may not hard-code
/// one. The role is the stable part: the host resolves it to the directory the current *operation*
/// was granted, which keeps authorization per operation instead of per process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RootRequirement {
    /// Stable role name, e.g. `"workspace"` or `"archive"`.
    pub role: &'static str,
    /// Read-only or read-write.
    pub access: RootAccess,
}

/// Network permission a node asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum NetworkAccess {
    /// No sockets, no HTTP. The default.
    #[default]
    Disabled,
    /// Only these hosts/origins may be reached. An empty list is not "allow none" — use
    /// [`NetworkAccess::Disabled`] for that, so a typo cannot silently widen permission.
    Hosts(&'static [&'static str]),
}

/// One external program the node may run, and whether it needs a confirmation first.
///
/// This replaces `xiranite.process.run`. The allowlist is the gate: a program not declared here is
/// refused before any `argv` inspection, which is where a node's danger confirmation belongs
/// (ADR-0069 hangs the gate on the registration, not on the argument string).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProcessGrant {
    /// The program name as the node will name it, e.g. `"ffmpeg"`.
    pub program: &'static str,
    /// Whether the host must confirm with the user before running it.
    pub confirm_before_run: bool,
}

/// What a node needs from the machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NodeRequirements {
    /// Root directories, by role.
    pub roots: &'static [RootRequirement],
    /// External programs the node may run.
    pub processes: &'static [ProcessGrant],
    /// Host services the node may call, by name.
    ///
    /// The service half of the same rule as [`NodeRequirements::processes`]: the allowlist is carried by
    /// the registration, so a node reaching an engine it never declared is refused before the engine
    /// sees a path. An empty list means "no host service is reachable from this node", which is why
    /// `service.invoke` answers a refusal for it rather than passing the call through.
    pub services: &'static [&'static str],
    /// Network permission.
    pub network: NetworkAccess,
    /// True when the node walks a tree instead of listing one directory.
    ///
    /// ADR-0072 measured why this is worth a flag: enumeration through the WASI shim is 3.6x to 35x
    /// slower than a native walk and grows superlinearly with directory size. Native nodes fix the
    /// cost, but the flag still tells the host which nodes need the streaming and budget path.
    pub enumerates_recursively: bool,
    /// Ceiling on bytes the node may hold live during one operation.
    ///
    /// Replacement for the wasm `memory_max_pages` ceiling (ADR-0066's two-layer enforcement). `0`
    /// means "not declared", which the host must treat as a refusal to schedule, not as unlimited.
    pub max_live_bytes: usize,
    /// Ceiling on items the node may work on at once, for the cross-operation scheduler.
    pub max_concurrent_items: usize,
    /// Wall-clock bound for one run of this node, in milliseconds; `None` takes the executor's default.
    ///
    /// Why this is a declaration and not a caller's argument: the realm now waits *on the host*
    /// (`clock.sleep`), so a node whose whole job is waiting — `sleept` counts down to a power action —
    /// would otherwise be cut by the executor's default ceiling without anyone having decided that. The
    /// registration is where a node says how long it means to run, the same place it says how many bytes
    /// it may hold. `None` is the ordinary case and means "not a waiting node".
    pub run_deadline_ms: Option<u64>,
}

impl NodeRequirements {
    /// Nothing granted anywhere: the safest thing a node can start from.
    pub const EMPTY: Self = Self {
        roots: &[],
        processes: &[],
        services: &[],
        network: NetworkAccess::Disabled,
        enumerates_recursively: false,
        max_live_bytes: 0,
        max_concurrent_items: 0,
        run_deadline_ms: None,
    };
}

/// A node's registration.
///
/// `node_version` and `api_version` stay separate because ADR-0068 required a node to be versioned
/// apart from the API it speaks. The third field those manifests carried, `runtimeVersion`, names the
/// wasm runtime and disappears with wasm.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NodeDescriptor {
    /// Stable node id; also the plugin id and the `node-definitions/<id>.json` stem.
    pub id: &'static str,
    /// The node's own version, in the same semver text the node's manifest carried. A string rather
    /// than a number because a node's version is not comparable as an integer: `0.1.0` is not
    /// "version 0", and collapsing a semver to one `u32` would either lie or silently drop the patch.
    pub node_version: &'static str,
    /// The major of the node-facing API this node is written against; a number because the host
    /// compares it against the majors it supports.
    pub api_version: u32,
    /// What it needs from the machine.
    pub requirements: NodeRequirements,
}

impl NodeDescriptor {
    /// A descriptor with the safe defaults: no roots, no processes, no network, no recursion.
    #[must_use]
    pub const fn new(
        id: &'static str,
        node_version: &'static str,
        api_version: u32,
    ) -> Self {
        Self {
            id,
            node_version,
            api_version,
            requirements: NodeRequirements::EMPTY,
        }
    }

    /// Roots the node needs.
    #[must_use]
    pub const fn with_roots(mut self, roots: &'static [RootRequirement]) -> Self {
        self.requirements.roots = roots;
        self
    }

    /// External programs the node may run.
    #[must_use]
    pub const fn with_processes(mut self, processes: &'static [ProcessGrant]) -> Self {
        self.requirements.processes = processes;
        self
    }

    /// Network permission the node needs.
    #[must_use]
    pub const fn with_network(mut self, network: NetworkAccess) -> Self {
        self.requirements.network = network;
        self
    }

    /// Host services the node may call (see [`NodeRequirements::services`]).
    #[must_use]
    pub const fn with_services(mut self, services: &'static [&'static str]) -> Self {
        self.requirements.services = services;
        self
    }

    /// Marks the node as a tree walker (see [`NodeRequirements::enumerates_recursively`]).
    #[must_use]
    pub const fn walk_tree(mut self, recursive: bool) -> Self {
        self.requirements.enumerates_recursively = recursive;
        self
    }

    /// Budget the host must enforce for this node.
    #[must_use]
    pub const fn budget(mut self, max_live_bytes: usize, max_concurrent_items: usize) -> Self {
        self.requirements.max_live_bytes = max_live_bytes;
        self.requirements.max_concurrent_items = max_concurrent_items;
        self
    }

    /// Declares how long one run of this node may take, in milliseconds.
    #[must_use]
    pub const fn run_deadline_ms(mut self, milliseconds: u64) -> Self {
        self.requirements.run_deadline_ms = Some(milliseconds);
        self
    }
}

inventory::collect!(NodeDescriptor);

// The dispatch half. Collected as a trait reference rather than a wrapper struct so a node's submission
// stays one line and the crate's own `static` is the only place its identity is spelled.
inventory::collect!(&'static dyn BuiltInNode);

/// Why a registry could not be built.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RegistryError {
    /// Two linked-in nodes claim the same id. `inventory` does not specify the order it hands
    /// registrations over, so this cannot be resolved by "keep the first one": it has to fail the
    /// start, or the same build would pick a different node on an unrelated rebuild.
    DuplicateId {
        /// The id two nodes agree on.
        id: &'static str,
    },
}

impl fmt::Display for RegistryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DuplicateId { id } => write!(formatter, "two built-in nodes register id {id:?}"),
        }
    }
}

impl Error for RegistryError {}

/// Every node linked into this host, keyed by id.
///
/// Two tables, because a node submits two things: its [`NodeDescriptor`] (policy, read by the gate and
/// the scheduler) and its `&'static dyn BuiltInNode` (the runnable, read by the host when an operation
/// starts). Keeping them separate rather than one wrapper struct is what lets `register_node!` stay a
/// one-line call per half; the cost is that a node can submit one and forget the other, so
/// [`Self::policy_only_ids`] and [`Self::runnable_without_policy_ids`] exist and the host is expected to
/// refuse to start on a non-empty answer.
#[derive(Debug)]
pub struct NodeRegistry {
    by_id: BTreeMap<&'static str, &'static NodeDescriptor>,
    runnable: BTreeMap<&'static str, RunnableView>,
}

/// A borrow of a collected runnable, kept behind a newtype so `Debug` for the registry does not need
/// `Debug` from every node's run type.
#[derive(Clone, Copy)]
struct RunnableView(&'static dyn BuiltInNode);

impl std::fmt::Debug for RunnableView {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "node({:?})", self.0.descriptor().id)
    }
}

impl NodeRegistry {
    /// Collects what `inventory` found, in both tables.
    ///
    /// # Errors
    ///
    /// [`RegistryError::DuplicateId`] when two registrations share an id.
    pub fn builtin() -> Result<Self, RegistryError> {
        Self::from_registrations(
            inventory::iter::<NodeDescriptor>,
            inventory::iter::<&'static dyn BuiltInNode>
                .into_iter()
                .copied(),
        )
    }

    /// Builds a registry from explicit lists of each half.
    ///
    /// # Errors
    ///
    /// [`RegistryError::DuplicateId`] when two entries share an id.
    pub fn from_registrations(
        descriptors: impl IntoIterator<Item = &'static NodeDescriptor>,
        runnables: impl IntoIterator<Item = &'static dyn BuiltInNode>,
    ) -> Result<Self, RegistryError> {
        let mut by_id = BTreeMap::new();
        for descriptor in descriptors {
            if by_id.insert(descriptor.id, descriptor).is_some() {
                return Err(RegistryError::DuplicateId { id: descriptor.id });
            }
        }
        let mut runnable = BTreeMap::new();
        for node in runnables {
            // The id comes from the node's own descriptor, so a node cannot claim one id in the policy
            // table and another in the dispatch table.
            let id = node.descriptor().id;
            if runnable.insert(id, RunnableView(node)).is_some() {
                return Err(RegistryError::DuplicateId { id });
            }
        }
        Ok(Self { by_id, runnable })
    }

    /// Builds a registry from policy alone, which is what the gate-side tooling and older tests use.
    ///
    /// # Errors
    ///
    /// [`RegistryError::DuplicateId`] when two entries share an id.
    pub fn from_descriptors(
        descriptors: impl IntoIterator<Item = &'static NodeDescriptor>,
    ) -> Result<Self, RegistryError> {
        Self::from_registrations(descriptors, std::iter::empty())
    }

    /// Registered ids that no runnable answers. A host must not start with a non-empty answer: the
    /// node would be listed in the product and refuse to run.
    pub fn policy_only_ids(&self) -> Vec<&'static str> {
        self.by_id
            .keys()
            .copied()
            .filter(|id| !self.runnable.contains_key(*id))
            .collect()
    }

    /// Runnables whose id was never declared. Same failure in the other direction: the code is linked
    /// in, the policy the host must enforce for it is not, so the scheduler has nothing to grant.
    pub fn runnable_without_policy_ids(&self) -> Vec<&'static str> {
        self.runnable
            .keys()
            .copied()
            .filter(|id| !self.by_id.contains_key(*id))
            .collect()
    }

    /// The runnable for `id`, if a node with that id was linked in and submitted its run half.
    #[must_use]
    pub fn runnable(&self, id: &str) -> Option<&'static dyn BuiltInNode> {
        self.runnable.get(id).map(|view| view.0)
    }

    /// Anchors whose registration did not reach the registry.
    ///
    /// The host's startup check for a partial link: an anchored node is by definition loaded, so a
    /// missing entry here means the node was written without `register_node!` at all, which is the one
    /// silent-loss shape a dependency list cannot see.
    #[must_use]
    pub fn anchors_not_collected(&self, links: &[NodeLink]) -> Vec<&'static str> {
        links
            .iter()
            .map(|link| link.id())
            .filter(|id| !self.by_id.contains_key(*id))
            .collect()
    }

    /// The node functions `id` publishes, or `None` when no node with that id is linked in.
    pub fn functions_of(&self, id: &str) -> Option<&'static [&'static str]> {
        self.runnable(id).map(BuiltInNode::functions)
    }

    /// Whether `id` answers `function` by name.
    #[must_use]
    pub fn supports_function(&self, id: &str, function: &str) -> bool {
        self.functions_of(id).is_some_and(|names| names.contains(&function))
    }

    /// Call one published node function.
    ///
    /// The two failure messages are kept apart on purpose: "no node with that id" is a link problem
    /// (the node vanished from the binary, which is ADR-0073's silent-loss mode), while "that node does
    /// not publish it" is a definition naming something the port never carried over. A face that sees the
    /// second one is looking at drift, not at a broken build.
    pub fn call_function(
        &self,
        id: &str,
        function: &str,
        input: &str,
        host: &mut dyn NodeHost,
    ) -> Result<String, NodeRunError> {
        let Some(node) = self.runnable(id) else {
            return Err(NodeRunError {
                message: format!("no built-in node is linked under id {id:?}"),
            });
        };
        if !node.functions().contains(&function) {
            return Err(NodeRunError {
                message: format!(
                    "node {id:?} publishes {:?}, not {function:?}",
                    node.functions()
                ),
            });
        }
        node.call(function, input, host)
    }

    /// The descriptor for `id`, if a node with that id is built in.
    #[must_use]
    pub fn get(&self, id: &str) -> Option<&'static NodeDescriptor> {
        self.by_id.get(id).copied()
    }

    /// Whether a node with this id is built in.
    #[must_use]
    pub fn contains(&self, id: &str) -> bool {
        self.by_id.contains_key(id)
    }

    /// Ids, sorted, so a listing never depends on link order.
    pub fn ids(&self) -> impl Iterator<Item = &'static str> {
        self.by_id.keys().copied()
    }

    /// How many nodes are built in.
    #[must_use]
    pub fn len(&self) -> usize {
        self.by_id.len()
    }

    /// Whether nothing is built in, which a host should treat as a broken build rather than an empty
    /// product.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.by_id.is_empty()
    }
}

/// A node's run half, named from the crate that links it.
///
/// This exists because a registration inside an `rlib` is not enough: `inventory` puts each submission
/// in a `#[used]` static, which keeps the static inside its object file, but the linker is still free
/// to skip the whole object file when nothing in the binary names a symbol from it. Measured, not
/// theorised: the same `dissolvef` registration resolves in the crate's own unit-test binary and comes
/// back empty from an integration test that only calls `NodeRegistry::builtin()`. So the host names
/// every node it means to serve through [`link_nodes!`], and that reference is what loads the object
/// file carrying the declaration.
#[derive(Clone, Copy)]
pub struct NodeLink(pub &'static dyn BuiltInNode);

impl std::fmt::Debug for NodeLink {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "node({:?})", self.id())
    }
}

impl NodeLink {
    /// Wraps a node's exported runnable static.
    #[must_use]
    pub const fn new(node: &'static dyn BuiltInNode) -> Self {
        Self(node)
    }

    /// The id the anchored object file declares.
    #[must_use]
    pub fn id(&self) -> &'static str {
        self.0.descriptor().id
    }
}

/// Names the node crates this binary links, one entry per node.
///
/// Generates a `pub const LINKED_NODES` the host can be checked against, and forces each node's object
/// file into the binary. See [`NodeLink`] for why a reference, not just a dependency, is required.
///
/// ```text
/// xiranite_node_registry::link_nodes!(dissolvef::builtin::DISSOLVEF_RUNNABLE);
/// ```
#[macro_export]
macro_rules! link_nodes {
    ($($node:path),+ $(,)?) => {
        /// Every node this binary links. Adding a node crate means adding its anchor here, and the
        /// registry then refuses the pair if the two lists disagree.
        pub const LINKED_NODES: &[$crate::NodeLink] = &[$($crate::NodeLink::new($node)),+];
    };
}

/// Registers one half of a node with the built-in registry.
///
/// A macro so a node's declaration stays one expression at its own definition site, and so nothing
/// else has to mirror it (the generated registries under `packages/*/src/*.generated.ts` are the
/// second source of truth this removes). Which table it lands in is decided by the expression's type:
/// a [`NodeDescriptor`] is policy, a `&'static dyn BuiltInNode` is the runnable, and a node submits one
/// of each.
///
/// ```text
/// static DESCRIPTOR: NodeDescriptor = NodeDescriptor::new("docs-example", "0.1.0", 1);
/// static EXAMPLE_NODE: ExampleNode = ExampleNode;
/// static EXAMPLE_RUNNABLE: &'static dyn xiranite_node_registry::BuiltInNode = &EXAMPLE_NODE;
///
/// xiranite_node_registry::register_node!(DESCRIPTOR);
/// xiranite_node_registry::register_node!(EXAMPLE_RUNNABLE);
/// ```
#[macro_export]
macro_rules! register_node {
    ($descriptor:expr) => {
        $crate::inventory::submit!($descriptor);
    };
}

#[cfg(test)]
mod tests {
    use super::{
        NetworkAccess, NodeDescriptor, NodeRegistry, ProcessGrant, RegistryError, RootAccess,
        RootRequirement,
    };

    const ALPHA_ID: &str = "registry-test.alpha";
    const BETA_ID: &str = "registry-test.beta";
    const DUPLICATE_ID: &str = "registry-test.duplicate";

    static ALPHA: NodeDescriptor =
        NodeDescriptor::new(ALPHA_ID, "3.0.0", 1).with_roots(&[RootRequirement {
            role: "workspace",
            access: RootAccess::ReadWrite,
        }]);

    static BETA: NodeDescriptor = NodeDescriptor::new(BETA_ID, "1.0.0", 1)
        .with_processes(&[ProcessGrant {
            program: "ffmpeg",
            confirm_before_run: true,
        }])
        .with_network(NetworkAccess::Hosts(&["127.0.0.1"]))
        .walk_tree(true)
        .budget(4_194_304, 16);

    // Registered for real, so the collection path is exercised rather than only the pure functions.
    super::register_node!(NodeDescriptor::new(ALPHA_ID, "3.0.0", 1));
    super::register_node!(NodeDescriptor::new(BETA_ID, "1.0.0", 1));

    // A duplicate pair, registered on purpose. Without something that *must* be refused, a green
    // duplicate test could equally mean the table was empty.
    super::register_node!(NodeDescriptor::new(DUPLICATE_ID, "1.0.0", 1));
    super::register_node!(NodeDescriptor::new(DUPLICATE_ID, "2.0.0", 1));

    #[test]
    fn linked_registrations_reach_the_inventory_table() {
        let ids: Vec<&'static str> = inventory::iter::<NodeDescriptor>
            .into_iter()
            .map(|descriptor| descriptor.id)
            .collect();
        assert!(
            ids.contains(&ALPHA_ID),
            "{ALPHA_ID} never reached the table: {ids:?}"
        );
        assert!(
            ids.contains(&BETA_ID),
            "{BETA_ID} never reached the table: {ids:?}"
        );
        assert!(
            ids.contains(&DUPLICATE_ID),
            "the positive control is missing, so the next assertion proves nothing: {ids:?}"
        );
    }

    #[test]
    fn builtin_refuses_a_duplicate_id_instead_of_picking_link_order() {
        let error = NodeRegistry::builtin()
            .expect_err("the duplicate registrations must make builtin() fail");
        assert_eq!(error, RegistryError::DuplicateId { id: DUPLICATE_ID });
    }

    #[test]
    fn lookup_is_deterministic_and_carries_the_declared_policy() {
        let registry = NodeRegistry::from_descriptors([&BETA as &NodeDescriptor, &ALPHA])
            .expect("two distinct ids");
        assert_eq!(registry.len(), 2);
        assert!(!registry.is_empty());
        assert!(registry.contains(BETA_ID));
        assert_eq!(
            registry.ids().collect::<Vec<_>>(),
            vec![ALPHA_ID, BETA_ID],
            "ids must be sorted, not in argument order"
        );
        assert!(registry.get("registry-test.missing").is_none());

        let beta = registry.get(BETA_ID).expect("beta is registered");
        assert_eq!(
            beta.requirements.network,
            NetworkAccess::Hosts(&["127.0.0.1"]),
            "a declared network grant must not read as Disabled"
        );
        assert!(beta.requirements.enumerates_recursively);
        assert_eq!(beta.requirements.max_live_bytes, 4_194_304);
        assert_eq!(beta.requirements.max_concurrent_items, 16);
        assert_eq!(
            beta.requirements.processes,
            &[ProcessGrant {
                program: "ffmpeg",
                confirm_before_run: true,
            }][..],
            "the allowlist is the gate, not argv inspection"
        );

        let alpha = registry.get(ALPHA_ID).expect("alpha is registered");
        assert_eq!(alpha.node_version, "3.0.0");
        assert_eq!(
            alpha.requirements.roots,
            &[RootRequirement {
                role: "workspace",
                access: RootAccess::ReadWrite,
            }][..]
        );
        assert_eq!(
            alpha.requirements.network,
            NetworkAccess::Disabled,
            "the default must be the safest answer"
        );
    }

    #[test]
    fn explicit_duplicate_is_refused_too() {
        let error = NodeRegistry::from_descriptors([&ALPHA as &NodeDescriptor, &ALPHA])
            .expect_err("the same descriptor twice must be refused");
        assert_eq!(error, RegistryError::DuplicateId { id: ALPHA_ID });
    }

    /// A runnable that answers its id from `descriptor()`, which is how the pairing is done: nothing
    /// else names the id, so a node cannot claim one id in policy and another in dispatch.
    struct EchoNode;

    impl crate::BuiltInNode for EchoNode {
        fn descriptor(&self) -> NodeDescriptor {
            NodeDescriptor::new(ALPHA_ID, "9.9.9", 1)
        }
        fn run(
            &self,
            input: &str,
            _host: &mut dyn crate::NodeHost,
        ) -> Result<String, crate::NodeRunError> {
            Ok(input.to_string())
        }

        fn functions(&self) -> &'static [&'static str] {
            &["preview", "result_view"]
        }

        fn call(
            &self,
            function: &str,
            input: &str,
            _host: &mut dyn crate::NodeHost,
        ) -> Result<String, crate::NodeRunError> {
            Ok(format!("{function}:{input}"))
        }
    }

    static ECHO: &dyn crate::BuiltInNode = &EchoNode;

    #[test]
    fn a_node_declared_and_runnable_resolves_by_id_through_one_table_pair() {
        let registry =
            NodeRegistry::from_registrations([&ALPHA as &NodeDescriptor], [ECHO]).expect("one of each");
        assert_eq!(
            registry.runnable(ALPHA_ID).expect("the runnable is reachable by id").descriptor().id,
            ALPHA_ID
        );
        assert!(registry.policy_only_ids().is_empty(), "declared and not runnable: {:?}", registry.policy_only_ids());
        assert!(registry.runnable_without_policy_ids().is_empty());
    }

    #[test]
    fn a_half_registration_stays_visible_instead_of_resolving_to_the_wrong_thing() {
        let declared_only =
            NodeRegistry::from_descriptors([&ALPHA as &NodeDescriptor]).expect("policy alone parses");
        assert_eq!(
            declared_only.policy_only_ids(),
            vec![ALPHA_ID],
            "a host that starts on this table would list a node it cannot run"
        );
        assert!(declared_only.runnable(ALPHA_ID).is_none());

        let orphan = NodeRegistry::from_registrations(std::iter::empty(), [ECHO]).expect("runnable alone parses");
        assert_eq!(
            orphan.runnable_without_policy_ids(),
            vec![ALPHA_ID],
            "the linked-in code has no declared grants, so the scheduler has nothing to hand it"
        );

        let duplicate = NodeRegistry::from_registrations(std::iter::empty(), [ECHO, ECHO])
            .expect_err("two runnables claiming one id is the same link-order accident");
        assert_eq!(duplicate, RegistryError::DuplicateId { id: ALPHA_ID });

        let nothing_collected =
            NodeRegistry::from_descriptors(std::iter::empty::<&NodeDescriptor>()).expect("empty policy");
        assert_eq!(
            nothing_collected.anchors_not_collected(&[crate::NodeLink::new(ECHO)]),
            vec![ALPHA_ID],
            "an anchor with no collected descriptor is how a forgotten `register_node!` looks"
        );
    }

    /// A host that answers neutrally, for the tests that only care about dispatch and never let a node
    /// touch a machine.
    struct NoHost;

    impl crate::NodeHost for NoHost {
        fn stat(&mut self, path: &str) -> crate::NodeHostResult<crate::NodePathInfo> {
            Ok(crate::NodePathInfo::missing(path))
        }
        fn list_dir(&mut self, _path: &str) -> crate::NodeHostResult<Vec<crate::NodeDirEntry>> {
            Ok(Vec::new())
        }
        fn ensure_dir(&mut self, _path: &str) -> crate::NodeHostResult<()> {
            Ok(())
        }
        fn move_path(&mut self, _source: &str, _target: &str) -> crate::NodeHostResult<()> {
            Ok(())
        }
        fn delete_path(&mut self, _path: &str, _recursive: bool) -> crate::NodeHostResult<()> {
            Ok(())
        }
        fn read_text(&mut self, _path: &str) -> crate::NodeHostResult<Option<String>> {
            Ok(None)
        }
        fn write_text(&mut self, _path: &str, _content: &str) -> crate::NodeHostResult<()> {
            Ok(())
        }
        fn now(&mut self) -> crate::NodeHostResult<String> {
            Ok("1970-01-01T00:00:00.000Z".to_string())
        }
        fn emit(&mut self, _event: &xiranite_plugin_api::run_events::PluginRunEvent) -> crate::NodeHostResult<()> {
            Ok(())
        }
        fn checkpoint(
            &mut self,
            _request: &crate::NodeCheckpointRequest,
        ) -> crate::NodeHostResult<xiranite_plugin_api::checkpoint::CheckpointOutcome> {
            Ok(xiranite_plugin_api::checkpoint::CheckpointOutcome::Continue)
        }
    }

    #[test]
    fn a_definition_named_node_function_resolves_through_the_registry_by_name() {
        let registry =
            NodeRegistry::from_registrations([&ALPHA as &NodeDescriptor], [ECHO]).expect("one of each");
        assert_eq!(
            registry.functions_of(ALPHA_ID).expect("alpha has a runnable"),
            &["preview", "result_view"][..],
            "the published list is what a definition is checked against"
        );
        assert!(registry.supports_function(ALPHA_ID, "preview"));
        assert!(
            !registry.supports_function(ALPHA_ID, "is_dangerous"),
            "an unpublished name must not read as supported just because the node exists"
        );
        assert_eq!(
            registry
                .call_function(ALPHA_ID, "preview", "rows", &mut NoHost)
                .expect("published, so callable"),
            "preview:rows"
        );

        // The two failure arms stay distinguishable: drift versus a broken link.
        let drift = registry
            .call_function(ALPHA_ID, "result_export", "x", &mut NoHost)
            .expect_err("a definition naming an unported function is drift");
        assert!(
            drift.message.contains("does not publish") || drift.message.contains("publishes"),
            "unexpected drift message: {drift}"
        );
        let missing_node = registry
            .call_function("registry-test.nope", "preview", "x", &mut NoHost)
            .expect_err("no such node is a link problem, not a drift problem");
        assert!(
            missing_node.message.contains("no built-in node"),
            "unexpected link message: {missing_node}"
        );
    }

    #[test]
    fn registrations_without_a_run_half_are_reported_for_this_binary() {        // ALPHA/BETA/DUPLICATE are submitted as policy and never as a runnable, so the accessor is not
        // vacuous here. This is the shape a forgotten `register_node!(RUNNABLE)` leaves behind.
        let registry = NodeRegistry::from_descriptors([&ALPHA as &NodeDescriptor, &BETA])
            .expect("two distinct ids");
        assert_eq!(registry.policy_only_ids(), vec![ALPHA_ID, BETA_ID]);
    }

    #[test]
    fn an_empty_registry_is_reported_as_empty_not_as_success() {
        let registry = NodeRegistry::from_descriptors(std::iter::empty::<&NodeDescriptor>())
            .expect("no entries is a valid empty list");
        assert!(registry.is_empty());
        assert_eq!(registry.len(), 0);
    }
}
