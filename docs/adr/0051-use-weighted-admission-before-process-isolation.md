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
- CPU, I/O, and GPU pools retain independent weighted capacity;
- estimated memory admission limits overlapping work before launch;
- the existing node memory guard remains the runtime hard stop based on observed RSS and heap growth.

The memory reservation is an estimate, not evidence of actual ownership. Until heavy JS/native work runs in a dedicated compute process, process-wide memory growth can still include other operations. Process isolation is therefore evaluated from concurrency and event-loop benchmarks rather than assumed necessary.

## Consequences

The single Bun process remains the stable control plane. Multiple complete backend instances are not introduced. Existing callers retain weight one, while heavy runtimes opt into weighted admission. A compute process will be added only for paths whose benchmarked event-loop delay exceeds the accepted control-plane latency gate.

Focused scheduler, XLchemy core/platform, NeoView scheduler, and backend configuration tests cover weighted grants, interactive reservation, memory admission, cancellation, and encoder thread propagation.
