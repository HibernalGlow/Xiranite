//! The host-side entropy and hex answers.
//!
//! These live with the realm because they are the answers a realm run gives: `crypto.randomUUID` and
//! `crypto.digest` must not be computed by the bundle, and the one lowercase-hex spelling is shared with
//! [`crate::digest`].

use std::hash::BuildHasher;
use std::sync::atomic::{AtomicU64, Ordering};

/// A run-scoped source of id entropy.
///
/// **This is not a CSPRNG, and nothing here may be treated as secret material.** It exists because
/// ADR-0074 §2 says a script must not reach for `Math.random()` for anything the journals record and that
/// the host must be the single supplier; the retained nodes use these values as undo-id suffixes and
/// temp-name bits. Each 8-byte block mixes a fresh `RandomState` (whose keys the OS picks at process start),
/// a process-wide counter and the wall clock, which gives uniqueness without adding an RNG dependency to the
/// workspace. Secret-grade bytes, if a node ever needs them, is a host service behind its own operation —
/// not a stronger function in this file.
pub fn fill_entropy(target: &mut [u8]) {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let mut position = 0usize;
    while position < target.len() {
        let tick = COUNTER.fetch_add(1, Ordering::Relaxed);
        let clock = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos() as u64)
            .unwrap_or_default();
        let state = std::collections::hash_map::RandomState::new();
        let word = state.hash_one((tick, clock, position, target.len())).to_le_bytes();
        let take = (target.len() - position).min(word.len());
        target[position..position + take].copy_from_slice(&word[..take]);
        position += take;
    }
}

pub fn format_uuid(bytes: &[u8; 16]) -> String {
    let mut shaped = *bytes;
    shaped[6] = (shaped[6] & 0x0f) | 0x40; // version 4
    shaped[8] = (shaped[8] & 0x3f) | 0x80; // RFC 4122 variant
    let text = hex(&shaped);
    format!(
        "{}-{}-{}-{}-{}",
        &text[0..8],
        &text[8..12],
        &text[12..16],
        &text[16..20],
        &text[20..32]
    )
}

/// The one lowercase-hex spelling in this crate: `crypto.randomBytes` answers it, and `crypto.digest`
/// encodes its hash with it.
pub fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(char::from(DIGITS[usize::from(byte >> 4)]));
        out.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    out
}
