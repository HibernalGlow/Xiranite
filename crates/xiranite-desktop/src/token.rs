//! The per-instance bearer token (ADR-0065).
//!
//! One fresh random value per host process, never shipped in a bundle and never reused across a
//! restart — that is the whole reason the channel is published through `xiranite_bootstrap` instead
//! of being written to a config file. `getrandom` is the OS entropy source already in the graph
//! through Tauri's own tree, so this adds no new upstream dependency and no platform branch:
//! `getrandom` reads `BCryptGenRandom` on Windows, `getentropy`/`/dev/urandom` on macOS.

use getrandom::fill;

/// 32 bytes of entropy, printed as 64 lowercase hex characters.
///
/// The width matches the legacy Bun backend's token, and hex keeps the value safe to drop into a
/// query string (`?token=…`, the `EventSource`-shaped channel) without encoding rules to remember.
const TOKEN_BYTES: usize = 32;

const HEX_DIGITS: [u8; 16] = *b"0123456789abcdef";

/// Generates the bearer token for this host process.
///
/// Panics only if the platform offers no entropy source at all, which is a machine the backend must
/// not start on: a predictable loopback token would silently expose every operation to any process
/// on the host.
#[must_use]
pub fn generate_bearer_token() -> String {
    let mut entropy = [0_u8; TOKEN_BYTES];
    fill(&mut entropy).expect("the OS entropy source is required for the per-instance bearer token");
    encode_hex(&entropy)
}

/// Lowercase hex, written by hand instead of pulling in `hex`/`data-encoding` for 8 lines.
fn encode_hex(bytes: &[u8]) -> String {
    let mut text = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        text.push(char::from(HEX_DIGITS[usize::from(byte >> 4)]));
        text.push(char::from(HEX_DIGITS[usize::from(byte & 0x0f)]));
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_token_is_hex_of_the_expected_width() {
        let token = generate_bearer_token();
        assert_eq!(token.len(), TOKEN_BYTES * 2);
        assert!(
            token.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)),
            "{token}"
        );
    }

    #[test]
    fn two_hosts_never_share_a_token() {
        assert_ne!(generate_bearer_token(), generate_bearer_token());
    }

    #[test]
    fn hex_encoding_is_lowercase_and_padded() {
        assert_eq!(encode_hex(&[0x00, 0x0f, 0xff]), "000fff");
    }
}
