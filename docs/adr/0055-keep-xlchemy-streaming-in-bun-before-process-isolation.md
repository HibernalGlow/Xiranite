---
status: accepted
---

# Keep XLchemy streaming in Bun before process isolation

## Context

XLchemy stalls in the preparing phase and retains excessive memory when a directory contains thousands of images. The Go/Wails XLchemy 1.2.9 reference at commit `75f58f97c8f9e6a4fb3749fe37f958f986893707` also uses `slimg_cffi.dll` and has completed a user-observed 200,000-image, 16-thread run within an approximately 4 GiB application footprint.

The codec language boundary is not the main difference:

- Xiranite's backend already consumes directory and EFU sources through an async iterator with a fixed number of file workers and bounded result details.
- The React input workbench defeats that boundary by expanding a selected or dropped directory into as many as 10,000 paths before a run, then repeatedly splitting, sorting, aggregating, and building a tree for the full path list.
- File-size discovery repeatedly clones a growing `Map` in React state.
- Each current Bun conversion calls `dlopen`, resolves SlimG symbols, and closes the DLL for one image. The reference uses one process-wide lazy DLL handle.
- The SlimG special case creates one Bun Worker isolate per requested thread and bypasses the existing 16-file cap and RAM-optimizer branch.
- The reference frontend and Go API still materialize a complete `ExecutionPlan.Items` array. That behavior explains part of its renderer memory and is a baseline to beat, not a data model to copy.

ADR 0051 requires measured weighted admission before process isolation. No current evidence isolates Bun itself as the cause after the known full-list and per-file DLL-lifecycle defects are removed.

## Decision

Keep Bun as XLchemy's control and execution host for the first complete optimization pass. Continue using `slimg_cffi.dll` for decoding and encoding.

### Input ownership

- A selected or dropped directory remains one source root in card state and node input. React must not enumerate it.
- EFU files remain source descriptors and are opened only by the backend.
- Explicit file selections remain supported, but the rendered preview, size cache, selection model, sorting, and tree model are capped independently of the submitted source list.
- Directory and EFU discovery remains single-pass and pull-driven. At most the active worker count plus a small fixed prefetch window may be retained.
- Operation events, final details, analysis samples, errors, and history inputs remain bounded. Aggregate counts and byte totals remain exact.

### SlimG ownership

- Each long-lived Bun Worker lazily opens SlimG once and reuses the same symbol table for every file assigned to that Worker.
- A Worker processes one conversion at a time. Decoded and encoded native buffers are freed in `finally` after the output write completes.
- The SlimG pool is capped by the operation's granted thread budget and `XLCHEMY_MAX_CONCURRENT_FILES`; a large configured thread count must not create an unbounded number of Bun isolates.
- The queue is bounded. Input discovery advances only when an encoder worker asks for another source.
- Resource-scheduler memory admission remains active immediately before conversion.

### Isolation gate

Do not add a Go worker, Go DLL, Rust Node-API module, or per-file CLI process in this pass. A framework-neutral executable worker may replace the Bun SlimG adapter without changing the input or result contracts only if the optimized Bun implementation fails the large-batch acceptance suite in three consecutive warmed runs because of one of these attributable conditions:

- a Bun FFI crash, hang, or unreleased native-memory trend;
- Bun Worker isolate overhead that remains material after the list model and DLL lifecycle are fixed;
- failure to complete 10,000 of 10,000 valid images with zero conversion errors;
- total peak private memory above 4 GiB for the agreed 16-thread 1080p-or-larger corpus, or a repeatable regression against the reference on the same corpus;
- median warmed throughput more than 5% below the best valid Bun/reference baseline without a corresponding output-quality or memory advantage;
- the ADR 0051 control-plane event-loop or health-latency gate is exceeded in three consecutive unprofiled runs.

If isolation is triggered, the worker must be an independent versioned stdin/stdout executable with no Wails imports. The desktop shell owns only an adapter and packaging rule.

## Consequences

The first implementation targets the demonstrated causes without introducing another runtime or desktop-framework dependency. Directory-scale memory becomes proportional to preview and concurrency limits rather than image count. SlimG remains responsible for codec work, while Bun retains cancellation, history, configuration, and shared resource scheduling.

The decision is reversible: the bounded source iterator and versioned result contract are also the correct boundary for a future Go or Rust executable. Passing small control messages across that boundary later will not require returning to full-array planning.

Completion is not established by unit tests or a small smoke conversion. The executable gates are defined in `docs/xlchemy-large-batch-acceptance.md`.
