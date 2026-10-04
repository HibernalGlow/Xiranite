//! Opaque host-issued tokens.
//!
//! ADR-0066: "Large payloads do not cross the boundary as bytes: calls pass path
//! or handle tokens and the host streams." A token is therefore the currency of
//! the file and scheduler surface, and the numeric value only has meaning inside
//! the host's own table.
//!
//! Nothing here makes a token unforgeable — a plugin shim can build any non-zero
//! `u64`, and that is accepted, because the security boundary is the host's table
//! lookup plus the Extism manifest's `allowed_paths` and `allowed_hosts`
//! (ADR-0066 calls this two-layer enforcement). The types exist so a path string
//! and a file handle cannot be passed to the wrong function, not to enforce
//! capability safety in Rust.

use std::fmt;
use std::num::NonZeroU64;

/// Value reserved for "no token", so a zeroed boundary buffer can never decode
/// into a live handle. [`PathToken::try_from_u64`] and friends return `None` for
/// it, which is why there is no separate error type for a bad token value.
pub const RESERVED_INVALID_TOKEN_VALUE: u64 = 0;

macro_rules! define_opaque_token {
    ($(#[$comment:meta])* $name:ident) => {
        $(#[$comment])*
        ///
        /// `Debug` and `Display` redact the value: a redaction bug is a leak in
        /// every log line and error message that formats the token, so the
        /// numeric id is reachable only through [`Self::get`].
        #[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(NonZeroU64);

        impl $name {
            /// Re-presents a token the host minted. Returns `None` for
            /// [`RESERVED_INVALID_TOKEN_VALUE`].
            pub fn try_from_u64(value: u64) -> Option<Self> {
                NonZeroU64::new(value).map(Self)
            }

            /// The numeric id, for host-side table lookups. Not for formatting.
            pub fn get(self) -> u64 {
                self.0.get()
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter
                    .debug_struct(stringify!($name))
                    .field("value", &"[redacted]")
                    .finish()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(concat!(stringify!($name), "(<redacted>)"))
            }
        }
    };
}

define_opaque_token! {
    /// Stands for one filesystem path the host authorized for this operation.
    PathToken
}

define_opaque_token! {
    /// Stands for one file opened through `xiranite.fs.open`.
    FileHandleToken
}

define_opaque_token! {
    /// Stands for one admission permit granted by `xiranite.scheduler.acquire`.
    ResourceLeaseToken
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserved_value_is_never_a_token() {
        assert_eq!(PathToken::try_from_u64(RESERVED_INVALID_TOKEN_VALUE), None);
        assert_eq!(FileHandleToken::try_from_u64(0), None);
        assert_eq!(ResourceLeaseToken::try_from_u64(0), None);
        assert_eq!(PathToken::try_from_u64(1).map(PathToken::get), Some(1));
    }

    #[test]
    fn tokens_compare_by_value() {
        let left = PathToken::try_from_u64(42).expect("non-zero");
        let same = PathToken::try_from_u64(42).expect("non-zero");
        let other = PathToken::try_from_u64(43).expect("non-zero");
        assert_eq!(left, same);
        assert_ne!(left, other);
        assert!(left < other);

        let mut seen = std::collections::HashSet::new();
        assert!(seen.insert(left));
        assert!(!seen.insert(same), "equal tokens must collapse in a set");
        assert!(seen.insert(other));
    }

    #[test]
    fn formatting_never_leaks_the_token_value() {
        let token = PathToken::try_from_u64(9_876_543_210).expect("non-zero");
        let debug = format!("{token:?}");
        let display = token.to_string();
        for rendered in [debug.clone(), display.clone()] {
            assert!(!rendered.contains("9876543210"), "{rendered} leaked the id");
            assert!(rendered.contains("redacted"), "{rendered} lost the marker");
        }
        assert!(debug.starts_with("PathToken"));
        assert!(display.starts_with("PathToken"));
        assert_eq!(token.get(), 9_876_543_210, "accessor still needed for host tables");
    }

    #[test]
    fn token_kinds_are_not_interchangeable() {
        // Compile-time vocabulary check: the same numeric id in two token types
        // stays two types, so a handle cannot be passed where a path belongs.
        let path = PathToken::try_from_u64(7).expect("path");
        let handle = FileHandleToken::try_from_u64(7).expect("handle");
        assert_eq!(path.get(), handle.get());
        let paths: Vec<PathToken> = vec![path];
        let handles: Vec<FileHandleToken> = vec![handle];
        assert_eq!(paths.len() + handles.len(), 2);
    }
}
