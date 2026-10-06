//! The strings and ceilings both sides of the boundary must spell identically.
//!
//! These are protocol facts rather than implementation details: a bundle distinguishes a cancel from a
//! refusal by comparing the thrown message to [`CANCELLED_MESSAGE`], an operator reads a checkpoint phase
//! out of the operation log, and the byte ceilings are the numbers the shim layer's README quotes. Each
//! one therefore has exactly one spelling, here, and both engines' tests read it from this file.

/// The message a bundle sees when the owning operation was cancelled mid-call.
pub const CANCELLED_MESSAGE: &str = "operation cancelled";

/// The phase name the pump's own boundary checkpoints report.
pub const PUMP_CHECKPOINT_PHASE: &str = "quickjs-pump";

/// The phase name the engine's interrupt handler reports when it re-reads the operation mid-JS.
///
/// A separate spelling because the two arms answer different questions: the pump's read is a run yielding
/// on purpose, this one is the host reaching CPU-bound JavaScript.
pub const INTERRUPT_CHECKPOINT_PHASE: &str = "quickjs-interrupt";

/// The phase a `waitWhilePaused` release reports.
pub const WAIT_CHECKPOINT_PHASE: &str = "wait-while-paused";

/// The phase the boundary read before the bundle runs reports.
///
/// It is a different string from [`PUMP_CHECKPOINT_PHASE`] on purpose: an operator comparing two
/// executors' logs has to be able to tell "the executor refused to start a run" apart from "a run
/// yielded mid-work".
pub const RUN_START_CHECKPOINT_PHASE: &str = "quickjs-run-start";

/// The ceiling on captured `proc.exec` output, per stream.
///
/// A node that shells out to a tool with a 200 MiB log must not be able to hold that log in the engine's
/// heap. A transcript is also not data the node plans on, so the cap sits below the host's own single
/// document ceiling rather than at it.
pub const MAX_PROCESS_OUTPUT_BYTES: usize = 1024 * 1024;

/// The largest `crypto.randomBytes` answer, in bytes.
pub const MAX_RANDOM_BYTES: usize = 64;
