//! The host-operation vocabulary, in one place.
//!
//! This crate is the **single source** for what a JavaScript bundle running inside an embedded QuickJS
//! may ask its host for, and for how the answer travels back. It was extracted from
//! `crates/xiranite-quickjs-executor/src/host_calls.rs` (ADR-0078) so that a second project embedding a
//! QuickJS realm answers the same names with the same shapes instead of re-deriving them.
//!
//! ## What belongs here
//!
//! - [`HostOperation`] — the closed list of wire names. A name outside it is a *call* failure, never a
//!   protocol error, because the vocabulary is what a bundle and a host agree on before either runs.
//! - [`HostAnswer`] and [`HostRefusal`] — the two-envelope rule: text answers are JSON, byte answers are
//!   bytes, and a refusal is data a script can branch on.
//! - the strings both sides must spell identically ([`CANCELLED_MESSAGE`], the four checkpoint phases) —
//!   a thrown `Error`
//!   carries, the checkpoint phase names, the ceilings.
//! - [`HostDispatch`] — the seam a realm calls. The executor implements it; the realm only ever sees it.
//!
//! ## What deliberately does not belong here
//!
//! The **answer shapes** (`fs.stat`'s keys, `proc.poll`'s report) are produced by the host arms that own
//! their own refusal wording and grant rule, so they stay in the embedding crate. Declaring them a second
//! time here would create the two-source drift this crate exists to remove, and a shape table nothing
//! reads is the kind of green-but-fake artifact AGENTS.md forbids. The protocol's own shape rule is the
//! narrow one stated above and is enforced by the arms and by the realm probes, not by a registry.
//!
//! ## The JavaScript side
//!
//! `packages/quickjs-shims/src/host.ts` declares `OPERATIONS_V1`, and
//! `bun run audit:quickjs-host-ops` compares it against this list **as compiled**: it runs
//! `print-host-ops`, which prints `HostOperation::ALL`. Reading the names out of a file instead was
//! measured to return 31 where the enum has 30 (`fs.readRange` is a negative-test fixture, `fs.read` is a
//! truncation), so the gate only trusts evaluated values.

mod control;
mod envelope;
mod operation;

pub use control::{
    CANCELLED_MESSAGE, INTERRUPT_CHECKPOINT_PHASE, MAX_PROCESS_OUTPUT_BYTES, MAX_RANDOM_BYTES,
    PUMP_CHECKPOINT_PHASE, RUN_START_CHECKPOINT_PHASE, WAIT_CHECKPOINT_PHASE,
};
pub use envelope::{
    HostAnswer, HostRefusal, answer, parse_arguments, required_path, required_text, serialize,
};
pub use operation::HostOperation;

/// The spelling every host-call error and every diagnostic uses for this protocol generation.
///
/// Named once because the shim layer and the executor are written by different hands and a drift between
/// `xrh-v1` and `xrh-v2` in an error message is the only clue an operator gets.
pub const PROTOCOL_VERSION: &str = "xrh-v1";

/// What a realm needs from whoever owns the machine it runs in.
///
/// The realm never holds a concrete host: it parses a wire name into a [`HostOperation`], calls this, and
/// turns the answer into a JavaScript value. Keeping the trait in the protocol crate is what lets the
/// engine and an embedding application depend on the same vocabulary without either depending on the
/// other's types.
pub trait HostDispatch {
    /// Runs one operation. `payload` is the buffer a `sendBytes` call handed over, `None` for every text
    /// call; an operation that does not take a payload refuses one (see [`HostOperation::takes_payload`]).
    fn execute(
        &mut self,
        operation: HostOperation,
        arguments: &str,
        payload: Option<&[u8]>,
    ) -> Result<HostAnswer, HostRefusal>;

    /// Yields at an item boundary, which is what the JS `waitWhilePaused` control asks for.
    ///
    /// `phase` is `&'static str` because it names a loop in the *host's* vocabulary, not one a script
    /// invented at run time; the agreed spellings are the `*_CHECKPOINT_PHASE` constants.
    fn checkpoint(&mut self, phase: &'static str) -> Result<(), HostRefusal>;

    /// Reports one `onEvent` line into the operation's stream.
    ///
    /// A refusal is swallowed — a dropped report is not a failed run — and only a cancel travels back to
    /// the bundle.
    fn emit_event(&mut self, event_json: &str) -> Result<(), HostRefusal>;
}
