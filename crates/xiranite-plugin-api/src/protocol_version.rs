//! Protocol version constant for the plugin ABI.
//!
//! ADR-0063 and ADR-0066 define the plugin protocol but never number it, so the
//! only version this repository states for a host/plugin contract is
//! `NODE_HOST_CONTRACT_VERSION = "1.0.0"` in `packages/contract/src/index.ts`,
//! which the WebView host API advertises today. The plugin ABI keeps that value
//! and inherits its compatibility rule: the plugin declares the range it accepts
//! and the host advertises what it provides.
//!
//! The assertions at the bottom of this module are evaluated during compilation,
//! so a drift between the documented string and the numeric parts the host and
//! plugins match on is a build error rather than a runtime surprise.

/// Major version plugins must match exactly; the host function set and the
/// checkpoint model live here.
pub const PLUGIN_ABI_VERSION_MAJOR: u8 = 1;
/// Minor version: additions that a plugin can ignore.
pub const PLUGIN_ABI_VERSION_MINOR: u8 = 0;
/// Patch version: fixes with no boundary change.
pub const PLUGIN_ABI_VERSION_PATCH: u8 = 0;
/// The documented version string, carried in the same `"major.minor.patch"` form
/// as the host contract version it is anchored to.
pub const PLUGIN_ABI_VERSION: &str = "1.0.0";

/// The value copied out of `packages/contract/src/index.ts`
/// (`NODE_HOST_CONTRACT_VERSION`). ADR-0067's Rust-to-TypeScript generator is
/// meant to replace hand-copied constants like this one; until it exists this is
/// the documented anchor the compile-time check below compares against.
pub const DOCUMENTED_HOST_CONTRACT_VERSION: &str = "1.0.0";

/// Splits a `"major.minor.patch"` string into decimal parts at compile time.
///
/// Written by hand because `str::parse`, `split` and slice comparison are not
/// usable in const contexts, and this crate takes no dependencies.
const fn parse_dotted_triple(version: &str) -> (u8, u8, u8) {
    let bytes = version.as_bytes();
    let mut index = 0usize;
    let mut parts = [0u16; 3];
    let mut part_index = 0usize;
    let mut accumulator = 0u16;
    let mut digits_in_part = 0usize;

    while index < bytes.len() {
        let character = bytes[index];
        if character >= b'0' && character <= b'9' {
            accumulator = accumulator * 10 + (character - b'0') as u16;
            digits_in_part += 1;
        } else if character == b'.' {
            assert!(digits_in_part > 0, "version part has no digits");
            assert!(part_index < 2, "version has more than three parts");
            parts[part_index] = accumulator;
            part_index += 1;
            accumulator = 0;
            digits_in_part = 0;
        } else {
            panic!("version contains a character that is not a digit or a dot");
        }
        index += 1;
    }

    assert!(digits_in_part > 0, "version ends with a dot");
    assert!(part_index == 2, "version must have exactly three parts");
    parts[2] = accumulator;

    (parts[0] as u8, parts[1] as u8, parts[2] as u8)
}

const fn equal_ascii(left: &str, right: &str) -> bool {
    let left_bytes = left.as_bytes();
    let right_bytes = right.as_bytes();
    if left_bytes.len() != right_bytes.len() {
        return false;
    }
    let mut index = 0usize;
    while index < left_bytes.len() {
        if left_bytes[index] != right_bytes[index] {
            return false;
        }
        index += 1;
    }
    true
}

const PARSED_VERSION: (u8, u8, u8) = parse_dotted_triple(PLUGIN_ABI_VERSION);

const _: () = assert!(
    PARSED_VERSION.0 == PLUGIN_ABI_VERSION_MAJOR,
    "PLUGIN_ABI_VERSION does not carry PLUGIN_ABI_VERSION_MAJOR"
);

const _: () = assert!(
    PARSED_VERSION.1 == PLUGIN_ABI_VERSION_MINOR,
    "PLUGIN_ABI_VERSION does not carry PLUGIN_ABI_VERSION_MINOR"
);

const _: () = assert!(
    PARSED_VERSION.2 == PLUGIN_ABI_VERSION_PATCH,
    "PLUGIN_ABI_VERSION does not carry PLUGIN_ABI_VERSION_PATCH"
);

const _: () = assert!(
    equal_ascii(PLUGIN_ABI_VERSION, DOCUMENTED_HOST_CONTRACT_VERSION),
    "PLUGIN_ABI_VERSION drifted from the documented host contract version"
);

const _: () = assert!(
    PLUGIN_ABI_VERSION_MAJOR >= 1,
    "the plugin ABI version has no documented anchor below major 1"
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parsed_version_matches_the_declared_parts() {
        assert_eq!(
            parse_dotted_triple(PLUGIN_ABI_VERSION),
            (
                PLUGIN_ABI_VERSION_MAJOR,
                PLUGIN_ABI_VERSION_MINOR,
                PLUGIN_ABI_VERSION_PATCH
            )
        );
    }

    #[test]
    fn version_stays_anchored_to_the_documented_host_contract_version() {
        assert_eq!(PLUGIN_ABI_VERSION, DOCUMENTED_HOST_CONTRACT_VERSION);
    }

    #[test]
    #[should_panic(expected = "version must have exactly three parts")]
    fn malformed_version_string_is_rejected_by_the_parser() {
        // Guards the assertion above: a two-part constant would otherwise compile
        // into a version nobody can compare against.
        let _ = parse_dotted_triple("1.0");
    }
}
