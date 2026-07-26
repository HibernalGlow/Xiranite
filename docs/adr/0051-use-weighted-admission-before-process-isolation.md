---
status: accepted
---

# Use weighted admission before process isolation

## Context

NeoView and XLchemy share one Bun backend but execute CPU-heavy work through different native libraries and child processes. Counting only active tasks lets one XLchemy operation consume many encoder threads while a second operation and interactive NeoView work start independently. The existing node memory guard detects actual process RSS and heap growth after work starts, but it does not provide admission control and cannot attribute shared-process growth precisely when operations overlap.

`p-queue` 9.3.1 is already available and actively maintained. It provides priority and fixed-concurrency queues, but it does not grant variable capacity units, reserve weighted capacity for interactive work, or return a reduced thread grant to an encoder. Replacing the existing scheduler with it would still require a project-owned weighted admission layer.

## Decision

Extend the existing `ResourceScheduler` contract with requested and minimum weights, an actual granted weight, and an estimated memory reservation. Keep the priority and node semantics project-owned:

- backend CPU capacity defaults to the host logical CPU count;
- background work cannot consume the interactive CPU and memory reserve;
- XLchemy acquires a background lease immediately before conversion and passes the granted CPU weight to the native encoder;
- encoder adapters must not multiply the granted weight; slimg caps its Rayon jobs at the granted total and host capacity;
- CPU, I/O, and GPU pools retain independent weighted capacity;
- estimated memory admission limits overlapping work before launch;
- the existing node memory guard remains the runtime hard stop based on observed RSS and heap growth.

The memory reservation is an estimate, not evidence of actual ownership. Until heavy JS/native work runs in a dedicated compute process, process-wide memory growth can still include other operations. Process isolation is therefore evaluated from concurrency and event-loop benchmarks rather than assumed necessary.

The benchmark evidence does not justify another Bun process for common workloads. On the test host, the steady XLchemy-only sample kept event-loop p99 and health p95 within roughly one millisecond of its idle baseline after the encoder stopped multiplying scheduler grants. A fresh Bun 1.4 audit of three identical, unprofiled XLchemy-plus-Reader passes reported event-loop p99 excesses of 4.18, 0.47, and 5.10 ms, with health p95 values of 20.88, 12.44, and 14.34 ms. A profiled diagnostic pass crossed both gates, but the crossing did not reproduce in any unprofiled pass; CPU profiling is therefore attribution evidence and not a latency-gate sample.

A Reader-only CPU profile attributed self time to zip.js codec and CRC work, while the same run measured 9.11 ms idle event-loop p99, 8.39 ms workload p99, and 13.17 ms health p95. Baseline-aware 16 MiB `lz4js` runs reported event-loop p99 excesses of 0, 0, and 12.30 ms. These JS paths are measurable hotspots, but neither produces a stable control-plane crossing and neither is migrated.

A generated, structurally valid 2048 x 2048 CLIP diagnostic did expose a real low-frequency exception: in-process CLIP-to-PSD conversion produced roughly 311-394 ms event-loop p99. A compute-process prototype reduced parent control-plane p95 to about 14 ms, but introduced per-operation cold start, cancellation supervision, memory-policy forwarding, and packaged-entry discovery. CLIP export is rarely used, and the user explicitly accepted retaining this path in-process instead of carrying that operational complexity. The prototype and its synthetic fixture were therefore removed. `benchmark:xlchemy-clip` remains available for user-owned representative files; this accepted exception must be reconsidered if CLIP usage becomes common or control-plane responsiveness during CLIP export becomes a requirement.

A restartable compute process is introduced only after the same warmed, unprofiled scenario exceeds its idle event-loop p99 by 25 ms or exceeds 50 ms health p95 in three consecutive runs, or when process-wide memory attribution produces a demonstrated false termination. One noisy or profiler-instrumented run is retained as diagnostic evidence, not an architecture trigger. The contention benchmark exposes these gates as `--assert-event-loop-excess-p99-ms` and `--assert-health-p95-ms`.

## Consequences

The single Bun process remains the stable control plane. Multiple complete backend instances are not introduced. Existing callers retain weight one, while heavy runtimes opt into weighted admission. A compute process will be added only for paths whose benchmarked event-loop delay exceeds the accepted control-plane latency gate and whose usage and operational value justify isolation. CLIP-to-PSD is the documented user-authorized exception at the time of this decision.

Focused scheduler, XLchemy core/platform, NeoView scheduler, and backend configuration tests cover weighted grants, interactive reservation, memory admission, cancellation, and encoder thread propagation.
