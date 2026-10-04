//! The operation phase machine.
//!
//! `packages/shared/src/index.ts` (`nodeOperationPhaseSchema`) fixes the six
//! phases the HTTP surface and the operation monitor already speak, and ADR-0063
//! principle 3 says they are preserved rather than reinvented. ADR-0066's
//! `Running | Paused | Cancelled | Completed` is the same machine narrowed to what
//! a running plugin call can observe; the extra `queued` and `error` states stay
//! because the backend already reports them.

use std::fmt;

use crate::abi_code::AbiCode;
use crate::abi_code::UnknownAbiCode;

/// Observable state of one node operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum OperationPhase {
    /// Accepted by the operation manager, not yet executing.
    Queued,
    /// The plugin call is running.
    Running,
    /// Pause requested; a pending checkpoint is waiting to be released.
    Paused,
    /// Finished with a successful result.
    Completed,
    /// Finished with a failure result, including a memory-protection violation.
    Error,
    /// Cancelled by the user or by the host.
    Cancelled,
}

impl OperationPhase {
    /// Every phase in wire order.
    pub const ALL: &'static [Self] = &[
        Self::Queued,
        Self::Running,
        Self::Paused,
        Self::Completed,
        Self::Error,
        Self::Cancelled,
    ];

    /// The JSON string used by `nodeOperationPhaseSchema`; these spellings are the
    /// protocol, not this crate's preference.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Completed => "completed",
            Self::Error => "error",
            Self::Cancelled => "cancelled",
        }
    }

    /// Decodes a wire phase name.
    pub fn try_from_wire(value: &str) -> Option<Self> {
        Self::ALL.iter().copied().find(|phase| phase.as_str() == value)
    }

    /// Mirrors `isTerminalPhase()` in `packages/services/src/index.ts`: a terminal
    /// operation accepts no further events and no further checkpoint release.
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Error | Self::Cancelled)
    }

    /// Whether the operation is still one the user can pause or resume.
    pub const fn is_active(self) -> bool {
        matches!(self, Self::Queued | Self::Running | Self::Paused)
    }
}

impl AbiCode for OperationPhase {
    fn abi_code(self) -> u8 {
        match self {
            Self::Queued => 1,
            Self::Running => 2,
            Self::Paused => 3,
            Self::Completed => 4,
            Self::Error => 5,
            Self::Cancelled => 6,
        }
    }

    fn try_from_abi_code(code: u8) -> Result<Self, UnknownAbiCode> {
        let index = usize::from(code)
            .checked_sub(1)
            .ok_or(UnknownAbiCode::new(code))?;
        OperationPhase::ALL.get(index).copied().ok_or(UnknownAbiCode::new(code))
    }
}

impl fmt::Display for OperationPhase {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// The phase names ADR-0066 states for the plugin-facing machine, in its order.
pub const ADR_0066_PLUGIN_VISIBLE_PHASES: [&str; 4] =
    ["running", "paused", "cancelled", "completed"];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::abi_code::assert_codes_round_trip;

    #[test]
    fn phase_codes_round_trip() {
        assert_codes_round_trip(OperationPhase::ALL);
        let codes: Vec<u8> = OperationPhase::ALL.iter().map(|phase| phase.abi_code()).collect();
        assert_eq!(codes, vec![1, 2, 3, 4, 5, 6]);
    }

    #[test]
    fn wire_names_match_the_existing_dto_enum() {
        // nodeOperationPhaseSchema from packages/shared/src/index.ts, verbatim.
        let dto_phases = [
            "queued",
            "running",
            "paused",
            "completed",
            "error",
            "cancelled",
        ];
        let abi_phases: Vec<&str> = OperationPhase::ALL.iter().map(|p| p.as_str()).collect();
        assert_eq!(abi_phases, dto_phases);
        for name in dto_phases {
            let phase = OperationPhase::try_from_wire(name)
                .unwrap_or_else(|| panic!("{name} is not decodable"));
            assert_eq!(phase.as_str(), name);
        }
        assert_eq!(OperationPhase::try_from_wire("done"), None);
        assert_eq!(OperationPhase::try_from_wire("Cancelled"), None);
    }

    #[test]
    fn adr_0066_states_a_subset_of_the_http_machine() {
        for name in ADR_0066_PLUGIN_VISIBLE_PHASES {
            let phase = OperationPhase::try_from_wire(name)
                .unwrap_or_else(|| panic!("ADR-0066 phase {name} is missing"));
            assert_ne!(phase, OperationPhase::Queued);
        }
        assert!(OperationPhase::Completed.is_terminal());
        assert!(OperationPhase::Cancelled.is_terminal());
        assert!(!OperationPhase::Paused.is_terminal());
        assert!(OperationPhase::Paused.is_active());
        assert!(!OperationPhase::Error.is_active());
    }

    #[test]
    fn phase_formats_as_its_wire_name() {
        assert_eq!(OperationPhase::Paused.to_string(), "paused");
    }
}
