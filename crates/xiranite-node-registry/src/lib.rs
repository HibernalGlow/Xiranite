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
}

impl NodeRequirements {
    /// Nothing granted anywhere: the safest thing a node can start from.
    pub const EMPTY: Self = Self {
        roots: &[],
        processes: &[],
        network: NetworkAccess::Disabled,
        enumerates_recursively: false,
        max_live_bytes: 0,
        max_concurrent_items: 0,
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
    /// The node's own version.
    pub node_version: u32,
    /// The node-facing API version it is written against.
    pub api_version: u32,
    /// What it needs from the machine.
    pub requirements: NodeRequirements,
}

impl NodeDescriptor {
    /// A descriptor with the safe defaults: no roots, no processes, no network, no recursion.
    #[must_use]
    pub const fn new(id: &'static str, node_version: u32, api_version: u32) -> Self {
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
}

inventory::collect!(NodeDescriptor);

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
#[derive(Debug)]
pub struct NodeRegistry {
    by_id: BTreeMap<&'static str, &'static NodeDescriptor>,
}

impl NodeRegistry {
    /// Collects what `inventory` found.
    ///
    /// # Errors
    ///
    /// [`RegistryError::DuplicateId`] when two registrations share an id.
    pub fn builtin() -> Result<Self, RegistryError> {
        Self::from_descriptors(inventory::iter::<NodeDescriptor>)
    }

    /// Builds a registry from an explicit list, which is what tests and tooling use.
    ///
    /// # Errors
    ///
    /// [`RegistryError::DuplicateId`] when two entries share an id.
    pub fn from_descriptors(
        descriptors: impl IntoIterator<Item = &'static NodeDescriptor>,
    ) -> Result<Self, RegistryError> {
        let mut by_id = BTreeMap::new();
        for descriptor in descriptors {
            if by_id.insert(descriptor.id, descriptor).is_some() {
                return Err(RegistryError::DuplicateId { id: descriptor.id });
            }
        }
        Ok(Self { by_id })
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

/// Registers a node with the built-in registry.
///
/// A macro so a node's declaration stays one expression at its own definition site, and so nothing
/// else has to mirror it (the generated registries under `packages/*/src/*.generated.ts` are the
/// second source of truth this removes).
///
/// ```text
/// xiranite_node_registry::register_node!(xiranite_node_registry::NodeDescriptor::new(
///     "docs-example",
///     1,
///     1
/// ));
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
        NodeDescriptor::new(ALPHA_ID, 3, 1).with_roots(&[RootRequirement {
            role: "workspace",
            access: RootAccess::ReadWrite,
        }]);

    static BETA: NodeDescriptor = NodeDescriptor::new(BETA_ID, 1, 1)
        .with_processes(&[ProcessGrant {
            program: "ffmpeg",
            confirm_before_run: true,
        }])
        .with_network(NetworkAccess::Hosts(&["127.0.0.1"]))
        .walk_tree(true)
        .budget(4_194_304, 16);

    // Registered for real, so the collection path is exercised rather than only the pure functions.
    super::register_node!(NodeDescriptor::new(ALPHA_ID, 3, 1));
    super::register_node!(NodeDescriptor::new(BETA_ID, 1, 1));

    // A duplicate pair, registered on purpose. Without something that *must* be refused, a green
    // duplicate test could equally mean the table was empty.
    super::register_node!(NodeDescriptor::new(DUPLICATE_ID, 1, 1));
    super::register_node!(NodeDescriptor::new(DUPLICATE_ID, 2, 1));

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
        assert_eq!(alpha.node_version, 3);
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

    #[test]
    fn an_empty_registry_is_reported_as_empty_not_as_success() {
        let registry = NodeRegistry::from_descriptors(std::iter::empty::<&NodeDescriptor>())
            .expect("no entries is a valid empty list");
        assert!(registry.is_empty());
        assert_eq!(registry.len(), 0);
    }
}
