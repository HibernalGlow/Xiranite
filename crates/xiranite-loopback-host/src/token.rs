//! The per-instance bearer token (ADR-0065).
//!
//! One fresh random value per host process, never shipped in a bundle and never reused across a
//! restart — that is the whole reason the channel is published through `xiranite_bootstrap` instead
//! of being written to a config file. `getrandom` is a direct dependency of this crate: the host used
//! to borrow it through Tauri's own tree, and a graph that pulls in a windowing stack just to read the
//! OS entropy source is the thing this crate exists to avoid. It still adds no platform branch:
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
