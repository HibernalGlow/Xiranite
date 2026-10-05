//! The one place the plugin's resource ceiling is spelled as a number.
//!
//! `manifest.json` carries `memoryMaxPages`, and `tests/manifest_contract.rs`
//! pins that file to the constant below, so the ceiling has exactly one producer.
//! A page is the WebAssembly 64 KiB page, which is also the unit Extism's
//! `memory` page limit counts in.

/// Bytes in one WebAssembly page.
pub const WASM_PAGE_BYTES: u32 = 64 * 1024;

/// `manifest.json` -> `memoryMaxPages`.
///
/// Budget for the worst realistic SNF run, in the order the memory is actually
/// used:
///
/// - plan items dominate: one `SnfPlanItem` holds five owned strings
///   (`artist_path`, `source_path`, `target_path`, `source_name`, `target_name`).
///   A Windows path at a typical `D:/Library/<artist>/<n>. <name>` depth is
///   ~80 bytes, so a plan item is ~500 bytes and 20 000 items (a large library
///   with a few hundred artist folders) is ~10 MB;
/// - the `lower_case` conflict set per artist folder: bounded by the folders in
///   one artist directory, not by the library, so ~200 entries x 100 bytes;
/// - one host response staging buffer at a time (`src/host_surface.rs`), capped
///   at `HOST_RESPONSE_MAX_BYTES` = 4 MB, plus the decoded entry vec;
/// - the outgoing JSON document for the same 20 000 items: ~12 MB uncompressed,
///   but it is serialized *after* the plan vec is already counted, and the plan
///   is consumed artist-by-artist only in the rename loop.
///
/// 10 MB + 4 MB + 12 MB ≈ 26 MB would be the ceiling of the largest case, but
/// that case (20 000 numbered folders under one operation) is already beyond the
/// product's own event-buffer ceiling, and exceeding this limit is a trap the
/// host reports as an operation error rather than silent corruption. 256 pages
/// (16 MB) is therefore set as: enough for ~10 000 plan items with a 4 MB
/// staging buffer and allocator headroom, low enough that a runaway plugin
/// cannot eat the host process. Raising it is a one-line change plus a manifest
/// re-read.
pub const MEMORY_MAX_PAGES: u32 = 256;

/// `MEMORY_MAX_PAGES` expressed in bytes, for the doc above and for tests.
pub const MEMORY_MAX_BYTES: u64 = MEMORY_MAX_PAGES as u64 * WASM_PAGE_BYTES as u64;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_ceiling_is_a_multiple_of_the_wasm_page() {
        assert_eq!(MEMORY_MAX_BYTES % WASM_PAGE_BYTES as u64, 0);
        assert_eq!(MEMORY_MAX_BYTES, 16 * 1024 * 1024);
    }
}
