//! Stable numeric tags for the ABI's fieldless enums.
//!
//! The plugin boundary needs a tag a shim can write without a serialization
//! dependency, so every ABI enum maps to a `u8`. The mapping is assigned here and
//! never reused: a new variant takes the next number, and removing a variant is a
//! protocol-version bump rather than a renumber.

use std::fmt;

/// Never a valid variant. Keeping `0` unassigned means a zeroed or truncated
/// boundary buffer fails to decode instead of silently becoming the first
/// variant of an enum.
pub const RESERVED_UNASSIGNED_CODE: u8 = 0;

/// An ABI enum with a stable numeric tag for the WASM boundary.
///
/// Implementations must also expose `pub const ALL: &'static [Self]` so tests can
/// enumerate the whole value set; the trait cannot require that because a trait
/// cannot name the implementing type's const array.
pub trait AbiCode: Sized + Copy + PartialEq + fmt::Debug {
    /// The tag written across the boundary.
    fn abi_code(self) -> u8;

    /// Decodes a tag, rejecting `RESERVED_UNASSIGNED_CODE` and unknown values.
    fn try_from_abi_code(code: u8) -> Result<Self, UnknownAbiCode>;
}

/// A boundary tag that does not belong to the enum being decoded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnknownAbiCode {
    /// The offending tag as it arrived.
    pub code: u8,
}

impl UnknownAbiCode {
    /// Wraps a rejected tag.
    pub const fn new(code: u8) -> Self {
        Self { code }
    }
}

impl fmt::Display for UnknownAbiCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "unassigned ABI code {}", self.code)
    }
}

impl std::error::Error for UnknownAbiCode {}

#[cfg(test)]
pub(crate) fn assert_codes_round_trip<T: AbiCode>(variants: &[T]) {
    let mut seen: Vec<u8> = Vec::new();
    for variant in variants {
        let code = variant.abi_code();
        assert_ne!(
            code,
            RESERVED_UNASSIGNED_CODE,
            "{} variant took the reserved unassigned code",
            std::any::type_name::<T>()
        );
        assert!(
            !seen.contains(&code),
            "duplicate ABI code {} in {}",
            code,
            std::any::type_name::<T>()
        );
        seen.push(code);
        assert_eq!(
            T::try_from_abi_code(code).unwrap_or_else(|error| panic!(
                "code {} did not decode in {}: {}",
                code,
                std::any::type_name::<T>(),
                error
            )),
            *variant,
            "code {} did not round-trip in {}",
            code,
            std::any::type_name::<T>()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::operation_status::OperationPhase;

    #[test]
    fn reserved_code_is_rejected_by_every_abi_enum() {
        for phase in OperationPhase::ALL {
            assert_eq!(
                OperationPhase::try_from_abi_code(RESERVED_UNASSIGNED_CODE),
                Err(UnknownAbiCode::new(RESERVED_UNASSIGNED_CODE)),
                "{phase:?} accepted the reserved code"
            );
        }
    }

    #[test]
    fn unknown_code_reports_the_value_it_rejected() {
        assert_eq!(
            OperationPhase::try_from_abi_code(200),
            Err(UnknownAbiCode::new(200))
        );
        let error = UnknownAbiCode::new(200);
        assert!(error.to_string().contains("200"));
    }
}
