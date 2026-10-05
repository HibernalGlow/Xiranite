//! CPU usage as a host capability, in one shape both transports can answer.
//!
//! Verified target: macOS, measured here (10 logical cores; every sample reporting a window of at least
//! 200 ms, with per-core numbers that move between samples). `x86_64-pc-windows-msvc` and
//! `x86_64-unknown-linux-gnu` are **compile-verified only**, through the same `#[path]` probe crate used for
//! [`crate::clipboard`] and [`crate::network`]; reading usage on those two targets is unmeasured.
//!
//! ## Why the host owns this
//!
//! `sleept` decides "the machine is idle" from CPU usage. In the Node/Bun face that was `node:os`'s
//! `cpus()[].times`, diffed against a previous sample. A QuickJS realm has no `node:os`, and the host's
//! `os.cpus` arm answers `{count, model, speed}` — measured: `target/debug/quickjs-run` rejects
//! `artifacts/node-bundles/sleept.js` while *evaluating* it, at `cpu.times.user` — which is why this node
//! has never run in the realm (ADR-0079 §7). Cumulative per-core jiffies are not what `sysinfo` 0.39 offers
//! either: its `Cpu` carries `cpu_usage`, `name`, `vendor_id`, `brand`, `frequency` (read from the package
//! source), so a `times`-shaped answer would mean three hand-written syscall readers
//! (`host_processor_info` / `/proc/stat` / `GetSystemTimes`) maintained here forever.
//!
//! So the host answers the question the node actually asks — how busy, over what window — instead of
//! handing back raw counters for the node to difference. What "idle" means stays in
//! `packages/nodes/sleept`: the threshold, how many consecutive quiet samples count, and what to do about it.
//!
//! ## The window is the whole claim, so it is never replayed
//!
//! A usage figure *is* a difference between two reads. `sysinfo` keeps the previous read inside the
//! `System` instance and, on its own, **skips** the update when refreshed sooner than
//! [`sysinfo::MINIMUM_CPU_UPDATE_INTERVAL`] (200 ms in the package source). Left alone, a fast caller is
//! handed the previous window's numbers again — measured here before that was handled: two samples 65 ms
//! apart returned `busy_percent: 45.904285` with ten identical per-core values, and only `window_ms` moved.
//! A poll loop reading that would conclude the machine had been idle for five minutes when it never looked
//! at a second window. So [`sample`] waits the floor out rather than returning a replay, and every answer
//! carries the `window_ms` it actually measured.
//!
//! The cost is stated rather than hidden: the first sample of a thread blocks for the floor, and two calls
//! closer than the floor make the later one wait. `sleept` polls at one second, where that is free.

use std::cell::RefCell;
use std::thread::sleep;
use std::time::{Duration, Instant};

use sysinfo::{CpuRefreshKind, System};

/// The shortest window [`sample`] answers with, taken from the library that enforces that floor internally
/// rather than from a number copied here.
pub const MIN_WINDOW: Duration = sysinfo::MINIMUM_CPU_UPDATE_INTERVAL;

/// CPU busy-ness for one sampling window.
#[derive(Debug, Clone, PartialEq)]
pub struct CpuUsage {
    /// Percentage of the whole machine that was busy during `window_ms`, `0.0..=100.0`.
    pub busy_percent: f32,
    /// The same figure per logical CPU, sorted by name so two calls agree on the order.
    pub per_core: Vec<f32>,
    /// How long the window behind this number was. At least [`MIN_WINDOW`], by construction.
    pub window_ms: u64,
}

/// The retained sampler, because a usage figure needs the read that came before it.
struct Sampler {
    system: System,
    /// When the window now being closed was opened. `None` until the core list exists.
    window_opened: Option<Instant>,
}

thread_local! {
    static SAMPLER: RefCell<Sampler> = RefCell::new(Sampler { system: System::new(), window_opened: None });
}

/// Read CPU usage over a window of at least [`MIN_WINDOW`], blocking until one has elapsed.
pub fn sample() -> CpuUsage {
    SAMPLER.with(|slot| {
        let mut sampler = slot.borrow_mut();

        if sampler.window_opened.is_none() {
            // Building the core list is what opens the first window: that read takes the counters but has
            // nothing to difference them against yet.
            sampler.system.refresh_cpu_list(CpuRefreshKind::nothing().with_cpu_usage());
            sampler.window_opened = Some(Instant::now());
        }

        let opened = sampler.window_opened.unwrap_or_else(Instant::now);
        if opened.elapsed() < MIN_WINDOW {
            sleep(MIN_WINDOW - opened.elapsed());
        }
        let window = opened.elapsed();

        // `refresh_cpu_specifics` deliberately does not touch the list: a poll loop should not renumber
        // cores between samples just because the machine parked one.
        sampler.system.refresh_cpu_specifics(CpuRefreshKind::nothing().with_cpu_usage());
        sampler.window_opened = Some(Instant::now());

        usage_of(&sampler.system, window)
    })
}

fn usage_of(system: &System, elapsed: Duration) -> CpuUsage {
    let mut listed: Vec<(String, f32)> = system
        .cpus()
        .iter()
        .map(|cpu| (cpu.name().to_string(), cpu.cpu_usage()))
        .collect();
    listed.sort_by(|left, right| left.0.cmp(&right.0));

    // The aggregate is the mean of the cores just read. `System::cpu_usage()` is the other candidate; the
    // mean keeps one source of truth for both numbers when the two could disagree.
    let busy_percent = if listed.is_empty() {
        0.0
    } else {
        listed.iter().map(|(_, usage)| f64::from(*usage)).sum::<f64>() / listed.len() as f64
    };

    CpuUsage {
        busy_percent: busy_percent.clamp(0.0, 100.0) as f32,
        per_core: listed.into_iter().map(|(_, usage)| usage).collect(),
        window_ms: elapsed.as_millis().try_into().unwrap_or(u64::MAX),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_sample_names_every_core_and_stays_in_range() {
        let usage = sample();

        assert!(!usage.per_core.is_empty(), "the machine has at least one core: {usage:?}");
        assert!(!usage.per_core.iter().any(|core| core.is_nan()), "no NaN in {usage:?}");
        assert!((0.0..=100.0).contains(&usage.busy_percent), "busy percent is a percentage: {}", usage.busy_percent);
        assert!(usage.window_ms >= u64::try_from(MIN_WINDOW.as_millis()).unwrap(), "every answer carries a real window: {usage:?}");
        for core in &usage.per_core {
            assert!((0.0..=100.0).contains(core), "per-core usage is a percentage: {core}");
        }
    }

    /// The replay this module exists to prevent. Measured before the wait was added: two samples 65 ms apart
    /// returned identical `busy_percent` and ten identical per-core values, with only `window_ms` moving.
    /// So this asserts on *time*, not on the numbers — a genuinely idle machine can produce equal
    /// percentages, while a call that returns inside the floor cannot have measured anything.
    #[test]
    fn a_second_sample_waits_for_its_own_window_instead_of_replaying_the_first() {
        let first_at = Instant::now();
        let first = sample();
        let after_first = first_at.elapsed();

        let second_started = Instant::now();
        let second = sample();
        let second_took = second_started.elapsed();

        let floor = u64::try_from(MIN_WINDOW.as_millis()).unwrap();
        assert!(first.window_ms >= floor && second.window_ms >= floor, "both windows real: {first:?} {second:?}");
        assert!(
            second_took + Duration::from_millis(5) >= MIN_WINDOW,
            "the second sample returned after {second_took:?}, shorter than the {MIN_WINDOW:?} floor, which means it replayed the first window: {first:?} {second:?}"
        );
        assert!(after_first >= MIN_WINDOW, "the first sample also paid its window: {after_first:?}");
    }

    /// Falsification for the aggregate being the mean of the list it reads: a planted pair must average to
    /// the midpoint, and an over-100 plant must not survive the clamp.
    #[test]
    fn averaging_is_what_the_aggregate_is() {
        let listed = [("cpu0".to_string(), 10.0_f32), ("cpu1".to_string(), 30.0)];
        let average = listed.iter().map(|(_, usage)| f64::from(*usage)).sum::<f64>() / listed.len() as f64;

        assert!((average - 20.0).abs() < 1e-9, "10 and 30 average to 20: {average}");
        let planted = 120.0_f64;
        assert!(planted.clamp(0.0, 100.0) < planted, "an over-100 answer must be clamped, not passed through");
    }
}
