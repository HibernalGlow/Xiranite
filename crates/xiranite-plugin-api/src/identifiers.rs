//! Identity newtypes that cross the plugin boundary.
//!
//! These mirror the string identifiers today's DTOs already carry: `nodeId`
//! becomes the plugin id, `operationId` stays the operation key the HTTP surface
//! exposes, and the entry point is the Extism exported function the host calls
//! instead of the in-process node function.

use std::fmt;

/// An identifier rejected because it was empty or whitespace-only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EmptyIdentifier;

impl fmt::Display for EmptyIdentifier {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "identifier must not be empty")
    }
}

impl std::error::Error for EmptyIdentifier {}

macro_rules! define_identifier {
    ($(#[$comment:meta])* $name:ident) => {
        $(#[$comment])*
        #[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(String);

        impl $name {
            /// Takes an identifier as it arrived from the boundary.
            pub fn try_new(value: impl Into<String>) -> Result<Self, EmptyIdentifier> {
                let value = value.into();
                if value.trim().is_empty() {
                    return Err(EmptyIdentifier);
                }
                Ok(Self(value))
            }

            /// The exact text used by the HTTP/Operation DTOs.
            pub fn as_str(&self) -> &str {
                &self.0
            }

            /// Consumes the newtype for host-side storage.
            pub fn into_string(self) -> String {
                self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(&self.0)
            }
        }
    };
}

define_identifier! {
    /// Plugin identifier; today this is the node id (`enginev`, `trename`, ...).
    PluginId
}

define_identifier! {
    /// Operation identifier used by `/node-operations/:operationId/...`.
    OperationId
}

/// The Extism exported function the host invokes for one operation.
///
/// Kept separate from [`PluginId`] because one plugin can export several entry
/// points, and because a wasm export name may not contain whitespace: the host
/// builds the import path from this value.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PluginEntryPoint(String);

impl PluginEntryPoint {
    /// Takes an entry-point name, rejecting blanks and any character that cannot
    /// appear in a wasm module link name.
    pub fn try_new(value: impl Into<String>) -> Result<Self, EntryPointNameRejected> {
        let value = value.into();
        if value.trim().is_empty() {
            return Err(EntryPointNameRejected::Blank);
        }
        if value
            .bytes()
            .any(|byte| byte.is_ascii_whitespace() || byte < 0x20)
        {
            return Err(EntryPointNameRejected::IllegalCharacter { name: value });
        }
        Ok(Self(value))
    }

    /// The export name as the host looks it up.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for PluginEntryPoint {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// An entry-point name the host could not turn into a wasm link name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EntryPointNameRejected {
    /// The name was empty or only whitespace.
    Blank,
    /// The name carries whitespace or a control byte.
    IllegalCharacter {
        /// The rejected name, echoed so the plugin author sees their own string.
        name: String,
    },
}

impl fmt::Display for EntryPointNameRejected {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Blank => formatter.write_str("entry point name must not be empty"),
            Self::IllegalCharacter { name } => {
                write!(formatter, "entry point name {name:?} cannot be a wasm link name")
            }
        }
    }
}

impl std::error::Error for EntryPointNameRejected {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiers_keep_their_exact_text() {
        let plugin = PluginId::try_new("enginev").expect("plugin id");
        assert_eq!(plugin.as_str(), "enginev");
        assert_eq!(plugin.to_string(), "enginev");
        assert_eq!(
            PluginId::try_new("  "),
            Err(EmptyIdentifier),
            "whitespace-only id should not reach the boundary"
        );
        assert_eq!(PluginId::try_new(""), Err(EmptyIdentifier));
    }

    #[test]
    fn operation_ids_are_comparable_and_stable() {
        let left = OperationId::try_new("op-abc").expect("left");
        let right = OperationId::try_new("op-abc").expect("right");
        assert_eq!(left, right);
        assert_ne!(left, OperationId::try_new("op-def").expect("other"));
    }

    #[test]
    fn entry_point_names_reject_unlinkable_strings() {
        assert_eq!(
            PluginEntryPoint::try_new("run").map(|entry| entry.to_string()),
            Ok("run".to_owned())
        );
        assert_eq!(
            PluginEntryPoint::try_new("run operation"),
            Err(EntryPointNameRejected::IllegalCharacter {
                name: "run operation".to_owned()
            })
        );
        assert_eq!(
            PluginEntryPoint::try_new("run\n"),
            Err(EntryPointNameRejected::IllegalCharacter {
                name: "run\n".to_owned()
            })
        );
        assert_eq!(PluginEntryPoint::try_new(""), Err(EntryPointNameRejected::Blank));
    }
}
