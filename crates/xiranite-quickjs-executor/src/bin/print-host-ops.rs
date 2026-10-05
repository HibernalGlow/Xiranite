//! `print-host-ops` — the host operation vocabulary as one JSON document.
//!
//! This exists for one consumer: `scripts/audit-quickjs-host-ops.ts`, the gate that keeps
//! `packages/quickjs-shims` in step with [`HostOperation`]. The reason it reads the *compiled* enum
//! instead of parsing `host_calls.rs` is the failure mode AGENTS.md and ADR-0067 name: string scanning
//! lies. Measured while writing this — scraping quoted `domain.ident` substrings out of `host_calls.rs`
//! yields 31 names, of which `fs.readRange` is only the negative-test fixture at `host_calls.rs:625`
//! ("an invented name must not parse") and `fs.read` is a truncation of `fs.readText`. The enum's
//! [`HostOperation::ALL`] is the set the dispatcher can actually resolve, so it is the set the shim
//! must be checked against.
//!
//! Output contract: stdout is exactly one JSON document (same rule as `quickjs-run`), so the gate can
//! pipe it; nothing else is printed.

use serde::Serialize;
use xiranite_quickjs_executor::HostOperation;

/// The shape of the emitted document, so a consumer can refuse a schema it does not understand.
const SCHEMA_VERSION: u8 = 1;

#[derive(Serialize)]
struct HostOpRow {
    /// The wire name a bundle calls (`HostOperation::as_str`).
    name: &'static str,
    /// Whether the operation takes a byte payload out of band (`__xrh.sendBytes`).
    takes_payload: bool,
    /// Whether the answer is a buffer rather than a JSON document.
    answers_bytes: bool,
}

#[derive(Serialize)]
struct HostOpInventory {
    schema_version: u8,
    ops: Vec<HostOpRow>,
}

fn main() {
    let inventory = HostOpInventory {
        schema_version: SCHEMA_VERSION,
        ops: HostOperation::ALL
            .iter()
            .copied()
            .map(|operation| HostOpRow {
                name: operation.as_str(),
                takes_payload: operation.takes_payload(),
                answers_bytes: operation.answers_bytes(),
            })
            .collect(),
    };

    let document = serde_json::to_string(&inventory).expect("host op inventory serializes");
    println!("{document}");
}
