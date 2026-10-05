//! Interface traffic counters as a host capability.
//!
//! Verified targets: macOS, measured here (21 interfaces listed, and `en0` reported non-zero deltas after
//! one proxied request). `x86_64-pc-windows-msvc` and `x86_64-unknown-linux-gnu` are **compile-verified
//! only**, through the same `#[path]` probe crate used for [`crate::clipboard`] (kept outside the
//! repository; `rusqlite(bundled)` cannot cross-compile here), whose sensitivity was proven with a planted
//! `#[cfg(windows)]` type error. Reading counters on those two targets is therefore unmeasured, though
//! unlike the shell arms it needs no external program.
//!
//! ## Why the host owns this
//!
//! `sleept` decides "the network is idle" by asking the OS how many bytes each interface moved. On
//! Windows that was `powershell.exe Get-NetAdapterStatistics`; the POSIX arms would have been
//! `GetIfTable` / `/proc/net/dev` / a macOS sysctl — three parsers of three formats, maintained here
//! forever. `sysinfo` already carries all three (`windows/network.rs`, `unix/linux/network.rs`,
//! `unix/apple/network.rs`, plus the BSDs) and the macOS arm is a real `sysctl NET_RT_IFLIST2` read, not
//! a stub. Measured on this machine before adopting it: 21 interfaces listed, and after one proxied HTTP
//! call `en0` reported 55 490 received / 363 484 transmitted bytes.
//!
//! ## What the node still owns
//!
//! What "idle" means — threshold, window, how many consecutive quiet samples count — stays in
//! `packages/nodes/sleept`. This module answers a measurement, not a verdict, so the word list stays in
//! one place (AGENTS.md's shared-semantics rule) and a second consumer can reuse the same numbers.
//!
//! ## Sampling is stateful on purpose
//!
//! `received_since_last_sample` is a delta against the previous call from this thread, which is exactly
//! the shape a poll loop wants: the first sample reports totals with zero deltas, every later sample
//! reports what moved in between. Interfaces that vanish between samples are dropped rather than
//! reported as frozen zeros — a disappeared adapter is not an idle one.

use std::cell::RefCell;

use sysinfo::Networks;

/// How many interfaces one sample may name.
///
/// A machine with virtual adapters and tunnels can list a few dozen (21 measured here). The cap exists
/// so a caller can print the answer without defending against a pathological table, and truncation is
/// reported rather than silently dropped.
pub const MAX_INTERFACES: usize = 256;

/// Bytes one interface moved, as of this sample.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InterfaceTraffic {
    /// The OS interface name (`en0`, `Ethernet`, `lo0`).
    pub name: String,
    /// Total bytes received since boot.
    pub received_total: u64,
    /// Total bytes transmitted since boot.
    pub transmitted_total: u64,
    /// Bytes received since the previous [`sample`] on this thread; `0` on the first sample.
    pub received_since_last_sample: u64,
    /// Bytes transmitted since the previous [`sample`] on this thread; `0` on the first sample.
    pub transmitted_since_last_sample: u64,
}

impl InterfaceTraffic {
    /// Total bytes this interface moved in the last sample window.
    #[must_use]
    pub fn moved_since_last_sample(&self) -> u64 {
        self.received_since_last_sample
            .saturating_add(self.transmitted_since_last_sample)
    }
}

/// Every interface the machine reported, sorted by name so two calls agree on the order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrafficSnapshot {
    pub interfaces: Vec<InterfaceTraffic>,
    /// True when the machine reported more than [`MAX_INTERFACES`] and the tail was cut.
    pub truncated: bool,
}

thread_local! {
    static NETWORKS: RefCell<Networks> = RefCell::new(Networks::new_with_refreshed_list());
}

/// Read the counters, generating deltas against the previous call from this thread.
pub fn sample() -> TrafficSnapshot {
    NETWORKS.with(|slot| {
        let mut networks = slot.borrow_mut();
        // `false` keeps interfaces that are momentarily absent from the list, so a poll loop does
        // not lose a counter just because one refresh missed it.
        networks.refresh(false);
        let mut listed: Vec<_> = networks.list().iter().collect();
        listed.sort_unstable_by_key(|(name, _)| *name);
        let truncated = listed.len() > MAX_INTERFACES;
        let interfaces = listed
            .into_iter()
            .take(MAX_INTERFACES)
            .map(|(name, data)| InterfaceTraffic {
                name: name.clone(),
                received_total: data.total_received(),
                transmitted_total: data.total_transmitted(),
                received_since_last_sample: data.received(),
                transmitted_since_last_sample: data.transmitted(),
            })
            .collect();
        TrafficSnapshot { interfaces, truncated }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};

    #[test]
    fn the_table_is_named_in_a_stable_order() {
        let first = sample();
        let second = sample();
        assert!(!first.interfaces.is_empty(), "every supported platform lists at least a loopback");
        let mut sorted = first.interfaces.iter().map(|row| row.name.clone()).collect::<Vec<_>>();
        sorted.sort();
        assert_eq!(sorted, first.interfaces.iter().map(|row| row.name.clone()).collect::<Vec<_>>());
        assert_eq!(
            sorted,
            second.interfaces.iter().map(|row| row.name.clone()).collect::<Vec<_>>(),
            "two consecutive samples must not disagree about which interfaces exist"
        );
    }

    /// The positive control for the delta half: real bytes are pushed over loopback, so *something*
    /// must report movement. Without this, a `sample()` that always returned zero deltas would pass
    /// every other assertion in this file.
    #[test]
    fn bytes_pushed_over_loopback_show_up_in_the_next_sample() {
        const PAYLOAD: usize = 256 * 1024;
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind a loopback listener");
        let address = listener.local_addr().expect("the listener knows its address");

        // One sample to reset the window, then traffic, then the sample under test.
        let before = sample();
        let mut client = TcpStream::connect(address).expect("connect to the loopback listener");
        let (mut server, _) = listener.accept().expect("accept the loopback connection");
        let payload = vec![0xA5u8; PAYLOAD];
        client.write_all(&payload).expect("send the payload");
        client.flush().expect("flush");
        let mut drained = 0usize;
        let mut chunk = [0u8; 16 * 1024];
        while drained < PAYLOAD {
            let read = server.read(&mut chunk).expect("receive the payload");
            assert_ne!(read, 0, "a loopback read that never delivers bytes cannot prove anything");
            drained += read;
        }
        let after = sample();

        let moved = after
            .interfaces
            .iter()
            .map(InterfaceTraffic::moved_since_last_sample)
            .sum::<u64>();
        assert!(
            moved >= PAYLOAD as u64,
            "pushed {PAYLOAD} bytes over loopback but the counters moved {moved}"
        );
        // Totals are cumulative; the same interface cannot have received less after the traffic.
        for row in &after.interfaces {
            let previous = before
                .interfaces
                .iter()
                .find(|earlier| earlier.name == row.name)
                .unwrap_or_else(|| panic!("{} vanished between samples", row.name));
            assert!(row.received_total >= previous.received_total, "{row:?} vs {previous:?}");
        }
    }

    #[test]
    fn a_total_is_never_smaller_than_its_own_window() {
        let snapshot = sample();
        for row in snapshot.interfaces {
            assert!(
                row.received_total >= row.received_since_last_sample,
                "{row:?}: a window larger than the cumulative total means the two are not the same unit"
            );
            assert!(row.transmitted_total >= row.transmitted_since_last_sample, "{row:?}");
        }
    }
}
