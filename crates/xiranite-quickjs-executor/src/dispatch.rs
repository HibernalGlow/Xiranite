//! The adapter that answers the realm's [`HostDispatch`] with this host's machine.
//!
//! This is the whole seam between the two crates. The realm parses a wire name and calls here; everything
//! that knows about granted roots, declared programs, child-process tables and host services lives on this
//! side, because that is what a Xiranite operation owns. Keeping the mapping in one file is what lets
//! `crates/quickjs-realm` be lifted into another host without dragging `xiranite-core` with it (ADR-0078).

use quickjs_host_protocol::{HostAnswer, HostDispatch, HostOperation, HostRefusal};
use xiranite_node_registry::NodeHost;

use crate::host_calls;
use crate::machine::MachineAccess;

/// One run's dispatch: the operation's host, that run's machine surface, and the programs its node
/// registered.
pub(crate) struct NodeHostDispatch<'host> {
    host: &'host mut (dyn NodeHost + 'static),
    machine: MachineAccess,
    allowed_programs: Vec<&'static str>,
}

impl<'host> NodeHostDispatch<'host> {
    /// Wraps the operation's host for one run.
    ///
    /// The seam hands a node `&mut dyn NodeHost` with the call's own lifetime, while every host arm in
    /// this crate is written against `&mut (dyn NodeHost + 'static)` — the same gap `quickjs_realm`'s
    /// `host_slot` closes for the dispatch object itself. The borrow checker already guarantees the
    /// reference the caller passed to `RealmRun::run` outlives that call, and nothing here stores it past
    /// the run, so widening it for the duration of the call is the same single, documented lie rather than
    /// a signature change in fourteen arm functions.
    pub(crate) fn new(
        host: &'host mut (dyn NodeHost + 'host),
        machine: MachineAccess,
        allowed_programs: Vec<&'static str>,
    ) -> Self {
        let erased: *mut (dyn NodeHost + 'static) =
            unsafe { std::mem::transmute::<*mut (dyn NodeHost + 'host), *mut (dyn NodeHost + 'static)>(host) };
        Self { host: unsafe { &mut *erased }, machine, allowed_programs }
    }
}

impl HostDispatch for NodeHostDispatch<'_> {
    fn execute(
        &mut self,
        operation: HostOperation,
        arguments: &str,
        payload: Option<&[u8]>,
    ) -> Result<HostAnswer, HostRefusal> {
        host_calls::execute(
            operation,
            arguments,
            payload,
            self.host,
            &self.allowed_programs,
            &self.machine,
        )
        .map_err(HostRefusal::from)
    }

    fn checkpoint(&mut self, phase: &'static str) -> Result<(), HostRefusal> {
        host_calls::checkpoint(self.host, phase).map_err(HostRefusal::from)
    }

    fn emit_event(&mut self, event_json: &str) -> Result<(), HostRefusal> {
        host_calls::emit_event(self.host, event_json).map_err(HostRefusal::from)
    }
}
