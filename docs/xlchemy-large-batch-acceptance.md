# XLchemy large-batch acceptance

This document is the delivery gate for the XLchemy loading, memory, and SlimG conversion repair. Small fixtures and mocked conversions are development checks only.

## Fixed scenarios

### 10,000-image conversion

Use exactly 10,000 independently decodable local source images. Every image must be at least 1920 x 1080. Record a corpus manifest before the run containing:

- normalized source path and byte size;
- format reported by an independent decoder;
- width and height;
- a content hash or an explicitly documented hard-link relationship;
- total bytes and format distribution;
- min, median, p95, and max dimensions and source sizes.

Run AVIF through the SlimG DLL with 16 requested threads, one fixed quality, one output policy, no source deletion, and no competing reference conversion or build/test workload. Preserve the exact normalized node input with the report.

The run passes only when:

- the isolated backend accepts the directory source without receiving 10,000 paths from React;
- conversion begins before complete directory enumeration is materialized in frontend state;
- all 10,000 inputs reach a terminal status and all 10,000 expected outputs are converted successfully;
- errors, missing outputs, zero-byte outputs, and unexpected skipped files are all zero;
- every output is fully decoded by an independent decoder, not merely checked for existence or magic bytes;
- decoded output dimensions match the corresponding source dimensions;
- source size, modification time, and hash are unchanged;
- reported aggregate input/output counts and bytes match the verifier;
- no SlimG Worker, test backend, listener, or benchmark child process remains after cleanup.

### 200,000-source preparation

Exercise both a directory source containing 200,000 entries and an EFU source containing 200,000 records. The files may be hard links to a smaller valid-image corpus because this scenario measures discovery and preparation, not codec throughput.

The run passes only when:

- React card state retains source descriptors and a bounded preview rather than 200,000 path rows;
- selecting the source does not enter an indefinite preparing state;
- backend discovery is single-pass and starts yielding before the complete source is known;
- preview rows, selected rows, file-size records, result details, errors, events, and history payloads remain at their documented limits;
- cancellation during discovery returns promptly and leaves no operation or listener running;
- memory reaches a bounded plateau rather than growing linearly with discovered count.

## Measurements

Sample at least once per second from operation acceptance until every child has exited. Record timestamped values for:

- wall-clock elapsed time and images per second;
- completed, converted, skipped, and error counts;
- CPU time or process CPU utilization;
- private bytes and working set for the Bun backend;
- private bytes and working set for the desktop host and WebView children when the rendered application is measured;
- aggregate private bytes and working set for the full process tree;
- Bun heap statistics when available;
- active SlimG workers and the requested/granted concurrency;
- time to first discovered image, first conversion, final discovery, and final conversion.

Record peak values and the end-of-run retained values. A lower peak obtained by reducing concurrency is not an improvement unless throughput remains within the performance gate.

## Comparison protocol

Use the same machine, corpus, destination volume, quality, thread count, warm/cold classification, and source-cache policy. Heavy runs are serial. Record tool, Xiranite commit, SlimG DLL hash/version, Bun version, and reference commit/tag.

Run one cold diagnostic and at least three warmed measurements when runtime is practical. Compare warmed medians. A throughput difference inside 5% is treated as noise unless repeated evidence shows otherwise. The optimized implementation must not trade a meaningful throughput regression for a cosmetic memory reduction.

The primary memory gate is no more than 4 GiB aggregate private bytes for the fixed 16-thread conversion corpus. The target is materially below that reference ceiling, and the report must separate renderer/list memory from the Bun/SlimG conversion process.

## Evidence artifacts

Store machine-readable artifacts outside source-control unless they are compact summaries:

- corpus manifest and summary;
- normalized run configuration;
- timestamped process samples;
- backend event log;
- output-verification results;
- process-cleanup audit;
- final before/after comparison report with command lines and commit hashes.

Do not claim completion from a subset, a generated low-resolution corpus, a mocked DLL, a single-file probe, or output existence checks.
