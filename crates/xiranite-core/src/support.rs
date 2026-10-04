//! Clocks, identifiers and the numeric vocabulary the wire protocol uses.
//!
//! Two things the TypeScript side gets from `Date.now()` and `Math.random()` and
//! that a Rust core must inject instead: a wall clock for wire timestamps and a
//! source of unique ids. Both are traits so unit tests drive time deterministically
//! the way `packages/services/src/index.ts` does with its `now` and
//! `createOperationId` options.

use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

/// Epoch milliseconds, the unit every wire timestamp in
/// `packages/shared/src/index.ts` uses (`z.number().int().nonnegative()` on
/// `createdAt`, `startedAt`, `finishedAt`, `durationMs`, `eventCount`).
///
/// `u64` rather than `i64` because the contract refuses negatives outright; the
/// SQLite columns store the same values as signed 64-bit integers and the
/// repository layer clamps on read.
pub type TimestampMs = u64;

/// A wall clock. `Debug` is a supertrait because hosts hold `Arc<dyn Clock>` inside
/// debuggable components (`IdGenerator` derives `Debug`), and a bare trait object would
/// otherwise force every holder to write its own formatter.
pub trait Clock: Send + Sync + 'static + fmt::Debug {
    /// Current epoch milliseconds.
    fn now_ms(&self) -> TimestampMs;
}

/// The system clock, matching `Date.now`.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> TimestampMs {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_millis().min(u128::from(u64::MAX)) as u64)
            .unwrap_or_default()
    }
}

/// A clock the test controls. `advance` is how a test moves time without sleeping.
#[derive(Debug, Clone)]
pub struct ManualClock(Arc<Mutex<TimestampMs>>);

impl ManualClock {
    /// Starts at `initial`.
    #[must_use]
    pub fn new(initial: TimestampMs) -> Self {
        Self(Arc::new(Mutex::new(initial)))
    }

    /// Sets the current value outright.
    pub fn set(&self, value: TimestampMs) {
        *self.0.lock().expect("manual clock state") = value;
    }

    /// Moves the clock forward by `delta`.
    pub fn advance(&self, delta: TimestampMs) {
        let mut guard = self.0.lock().expect("manual clock state");
        *guard = guard.saturating_add(delta);
    }
}

impl Default for ManualClock {
    fn default() -> Self {
        Self::new(1_700_000_000_000)
    }
}

impl Clock for ManualClock {
    fn now_ms(&self) -> TimestampMs {
        *self.0.lock().expect("manual clock state")
    }
}

const BASE36_DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";

/// `Number.prototype.toString(36)` for non-negative integers, which is what
/// `Date.now().toString(36)` and `Math.random().toString(36).slice(2)` produce in
/// `packages/services/src/index.ts:439` and `:237`.
#[must_use]
pub fn to_base36(value: u64) -> String {
    if value == 0 {
        return "0".to_owned();
    }
    let mut digits = Vec::with_capacity(14);
    let mut remaining = value;
    while remaining > 0 {
        digits.push(BASE36_DIGITS[usize::try_from(remaining % 36).expect("in range")] as char);
        remaining /= 36;
    }
    digits.reverse();
    digits.into_iter().collect()
}

/// Where an id's counter starts, so a test can predict the exact id text.
#[derive(Debug, Clone)]
pub struct IdGenerator {
    counter: Arc<AtomicU64>,
    prefix: String,
    clock: Arc<dyn Clock>,
}

impl IdGenerator {
    /// Builds a generator. `prefix` is prepended to every id.
    #[must_use]
    pub fn new(prefix: impl Into<String>, clock: Arc<dyn Clock>) -> Self {
        Self {
            counter: Arc::new(AtomicU64::new(0)),
            prefix: prefix.into(),
            clock,
        }
    }

    /// The next id: `{prefix}-{base36(counter)}-{base36(now)}`. The counter keeps
    /// ids unique within a process, the clock keeps them unique across restarts of
    /// a process that shares a database file — which is what the `Math.random()`
    /// suffix bought in TypeScript.
    #[must_use]
    pub fn next(&self) -> String {
        let counter = self.counter.fetch_add(1, Ordering::Relaxed);
        format!(
            "{}-{}-{}",
            self.prefix,
            to_base36(counter),
            to_base36(self.clock.now_ms())
        )
    }

    /// An id carrying `suffix` instead of the counter, used by the
    /// collision-exhausted fallback path in
    /// `packages/services/src/index.ts:439`.
    #[must_use]
    pub fn next_with_suffix(&self, suffix: &str) -> String {
        format!("{}-{}-{}", self.prefix, to_base36(self.clock.now_ms()), suffix)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base36_matches_the_javascript_output() {
        assert_eq!(to_base36(0), "0");
        assert_eq!(to_base36(35), "z");
        assert_eq!(to_base36(36), "10");
        // (1700000000000).toString(36) in JavaScript, checked against Bun rather than memory.
        assert_eq!(to_base36(1_700_000_000_000), "loyw3v28");
        assert_eq!(to_base36(1_577_836_800_000), "k4ujaio0");
    }

    #[test]
    fn manual_clock_is_the_only_clock_a_test_needs() {
        let clock = ManualClock::default();
        let first = clock.now_ms();
        assert_eq!(first, clock.now_ms(), "a manual clock does not move by itself");
        clock.advance(250);
        assert_eq!(clock.now_ms(), first + 250);
        clock.set(10);
        assert_eq!(clock.now_ms(), 10);
    }

    #[test]
    fn system_clock_is_within_the_manual_clock_range() {
        let now = SystemClock.now_ms();
        // 2020-01-01 in epoch ms: anything below this is a broken clock, not a
        // legitimate pre-2020 host.
        assert!(now > 1_577_836_800_000, "{now}");
    }

    #[test]
    fn ids_are_unique_and_prefixed() {
        let clock = ManualClock::new(1_700_000_000_000);
        let generator = IdGenerator::new("op", Arc::new(clock.clone()));
        let first = generator.next();
        let second = generator.next();
        assert!(first.starts_with("op-"), "{first}");
        assert_ne!(first, second, "the counter must separate two ids in one process");
        assert_eq!(
            generator.next_with_suffix("zz"),
            format!("op-{}-zz", to_base36(1_700_000_000_000))
        );
    }
}
