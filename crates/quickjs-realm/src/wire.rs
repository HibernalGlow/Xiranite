//! The protocol names this crate speaks, re-exported under one path.
//!
//! `crate::wire::HostOperation` rather than `quickjs_host_protocol::HostOperation` at every site, because
//! the realm's own vocabulary is exactly this: the wire names, the two envelopes, the refusal, and the
//! run-control strings. Keeping the re-export in one file also makes the realm's dependency on the
//! protocol visible as a single edge instead of a dozen import lines.
//!
//! Nothing here is defined — it is all the protocol crate's (ADR-0078). A name this crate needs that the
//! protocol does not carry is a gap to fix in the protocol crate, never a local copy. Only the names the
//! realm actually reads are re-exported; the host-side helpers (`answer`, `required_text`, the ceilings)
//! belong to whoever implements [`HostDispatch`].

pub use quickjs_host_protocol::{
    CANCELLED_MESSAGE, HostAnswer, HostDispatch, HostOperation, HostRefusal,
    INTERRUPT_CHECKPOINT_PHASE, PROTOCOL_VERSION, PUMP_CHECKPOINT_PHASE,
    RUN_START_CHECKPOINT_PHASE, WAIT_CHECKPOINT_PHASE,
};
