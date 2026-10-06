//! Why a run did not produce a result document.
//!
//! This is the realm's own error, deliberately a struct with one string rather than an enum: every arm
//! that produces it is a machine condition the *caller* cannot branch on except by showing it, and the
//! embedding host turns it into its own run-error type at its own boundary.
//!
//! The rule that shaped it (ADR-0074 §2, carried over from the Plugin API contract): a node's own thrown
//! error is **not** a `RealmError`. It becomes the failure document the TypeScript runner produced for the
//! same throw, so a script bug reads the same whichever executor ran it. What *is* a `RealmError`: a
//! bundle that would not load, a missing or non-function export, a cancelled operation, a deadline that
//! passed, a byte budget overrun.

/// A run that could not produce its result document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RealmError {
    /// Already user-facing: composed from the failed stage and the engine's or host's message.
    pub message: String,
}

impl RealmError {
    /// A refusal in the caller's words.
    #[must_use]
    pub fn new(message: impl Into<String>) -> Self {
        Self { message: message.into() }
    }
}

impl std::fmt::Display for RealmError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for RealmError {}
