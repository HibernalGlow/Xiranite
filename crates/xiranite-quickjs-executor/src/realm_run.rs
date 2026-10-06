//! One node run, assembled from the realm plus this host's registration.
//!
//! `crates/quickjs-realm` runs a bundle; it does not know what a Xiranite node *is*. This type is where the
//! two meet: it reads the ceilings and the machine requirements off the node's
//! [`NodeDescriptor`](xiranite_node_registry::NodeDescriptor), builds the run's
//! [`MachineAccess`](crate::machine::MachineAccess), and hands the realm a
//! [`NodeHostDispatch`](crate::dispatch::NodeHostDispatch) that answers the protocol with the operation's
//! host (ADR-0078).
//!
//! The call shape deliberately matches the executor crate's own before the split
//! (`new(descriptor, plan).with_files(grant).run(input, host)`), so nothing outside this file had to learn
//! the realm's types.

use quickjs_realm::{EngineLimits, EntryPlan, Executor, RealmError};
use xiranite_core::filesystem::FileCapability;
use xiranite_node_registry::{NodeDescriptor, NodeHost, NodeRunError};

use crate::dispatch::NodeHostDispatch;
use crate::host_calls;
use crate::machine::MachineAccess;

/// A node's bundle, its declared ceilings, and the grant this run may widen to.
pub struct RealmRun<'plan> {
    node_id: &'static str,
    plan: EntryPlan<'plan>,
    limits: EngineLimits,
    /// The services this node's registration declares; the machine refuses every other name.
    services: &'static [&'static str],
    /// The programs the registration allows, read off the descriptor rather than off the argv (ADR-0069).
    allowed_programs: Vec<&'static str>,
    /// The grant this run may widen to, or `None` for a seam-only run. Held as the capability and not as a
    /// [`MachineAccess`] because the child-process table belongs to *one* run: a `RealmRun` reused across
    /// runs must not carry the previous run's children into the next one.
    files: Option<FileCapability>,
}

/// The one translation from the realm's refusal into the seam's run error.
///
/// A free function rather than a `From` impl because `RealmError` and `NodeRunError` are foreign to each
/// other: neither crate may write the conversion for the other's type.
fn into_node_error(error: RealmError) -> NodeRunError {
    NodeRunError { message: error.message }
}

impl<'plan> RealmRun<'plan> {
    /// Derives the run's ceilings and machine requirements from the node's declaration.
    ///
    /// # Errors
    ///
    /// Refuses a node whose `max_live_bytes` is `0` — ADR-0073 made "not declared" mean "the host must
    /// refuse to schedule", so an undeclared ceiling is a refusal, not unlimited.
    pub fn new(descriptor: NodeDescriptor, plan: EntryPlan<'plan>) -> Result<Self, NodeRunError> {
        let mut limits = EngineLimits::from_budgets(descriptor.id, descriptor.requirements.max_live_bytes)
            .map_err(into_node_error)?;
        // A node that declared its own bound gets it; the executor's default is only for nodes that never
        // wait (`clock.sleep` is how a node waits at all, so a waiting node that said nothing would be cut
        // off in the middle of its own job by a ceiling nobody chose for it).
        if let Some(milliseconds) = descriptor.requirements.run_deadline_ms {
            limits.run_deadline = std::time::Duration::from_millis(milliseconds);
        }
        let services = descriptor.requirements.services;
        let allowed_programs = host_calls::allowed_programs(descriptor.requirements.processes);
        Ok(Self { node_id: descriptor.id, plan, limits, services, allowed_programs, files: None })
    }

    /// Hands the run the operation's granted filesystem.
    ///
    /// This is the wiring `crates/xiranite-node-runtime/src/launcher.rs` does for a real run: the grant is
    /// the *same* [`FileCapability`] the host was built over, so authorization keeps one source. Without
    /// it `fs.copy`, `fs.mkdtemp`, the link family, the byte channel and the child-process table all
    /// refuse.
    #[must_use]
    pub fn with_files(mut self, files: FileCapability) -> Self {
        self.files = Some(files);
        self
    }

    /// Whether this run can answer the widened surface, for the audit and the harness' stderr line.
    #[must_use]
    pub const fn has_grant(&self) -> bool {
        self.files.is_some()
    }

    /// Overrides the wall-clock bound, for a node the scheduler knows runs long.
    #[must_use]
    pub fn with_run_deadline(mut self, deadline: std::time::Duration) -> Self {
        self.limits.run_deadline = deadline;
        self
    }

    /// Overrides the cancel/pause re-read cadence. Tests use it to keep a cancel assertion short.
    #[must_use]
    pub fn with_host_poll_interval(mut self, interval: std::time::Duration) -> Self {
        self.limits.host_poll_interval = interval;
        self
    }

    /// The node this run belongs to, in the words the operation manager and the harness print.
    ///
    /// The seam's own `BuiltInNode::descriptor` still answers the full
    /// [`NodeDescriptor`] from [`crate::node::JsNode`]; the realm keeps only the name, because a name is
    /// all a diagnostic needs (ADR-0078).
    #[must_use]
    pub const fn node_id(&self) -> &'static str {
        self.node_id
    }

    #[must_use]
    pub const fn limits(&self) -> &EngineLimits {
        &self.limits
    }

    #[must_use]
    pub const fn plan(&self) -> &EntryPlan<'plan> {
        &self.plan
    }

    /// A fresh machine surface for one run: the grant, and a process table nobody else shares.
    fn machine(&self) -> MachineAccess {
        let machine = match &self.files {
            Some(files) => MachineAccess::granted(files.clone()),
            None => MachineAccess::seam_only(),
        };
        machine.with_services(self.services)
    }

    fn executor(&self) -> Executor<'plan> {
        Executor::new(self.node_id.to_string(), self.plan.clone(), self.limits)
    }

    /// Runs the bundle's `run` export to completion against the operation's host.
    ///
    /// # Errors
    ///
    /// The realm's refusals in the seam's words: a bundle that would not load, a missing or non-function
    /// export, a cancel, a deadline, a budget overrun. A node's own thrown error is *not* an error here —
    /// it becomes the failure document the TypeScript runner produced for the same throw.
    pub fn run(&self, input: &str, host: &mut dyn NodeHost) -> Result<String, NodeRunError> {
        let mut dispatch =
            NodeHostDispatch::new(host, self.machine(), self.allowed_programs.clone());
        self.executor().run(input, &mut dispatch).map_err(into_node_error)
    }

    /// Calls one named export the way [`xiranite_node_registry::BuiltInNode::call`] does.
    ///
    /// # Errors
    ///
    /// As [`Self::run`], plus a refusal when the bundle has no such export.
    pub fn call_function(
        &self,
        function: &str,
        input: &str,
        host: &mut dyn NodeHost,
    ) -> Result<String, NodeRunError> {
        let mut dispatch =
            NodeHostDispatch::new(host, self.machine(), self.allowed_programs.clone());
        self.executor()
            .call_function(function, input, &mut dispatch)
            .map_err(into_node_error)
    }
}
