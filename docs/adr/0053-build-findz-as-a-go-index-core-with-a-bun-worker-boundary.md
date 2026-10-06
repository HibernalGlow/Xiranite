---
status: accepted
---

# Build Findz as a Go index core with a Bun Worker boundary

## Context

Findz needs to scan a large local ZIP/CBZ library, keep a durable incremental index, inspect selected image headers, identify size outliers, and drive a responsive GUI. The previous TypeScript implementation combines command syntax, archive parsing, state, and terminal UI. It has hand-written archive behavior, no per-library durable index, and makes every future surface responsible for part of the same core semantics.

The user explicitly prioritizes existing maintained components over recreating archive machinery. The implementation must remain Docker-free and Windows/Wails-ready, while avoiding a long-running external search service or a second user-visible application.

## Decision

Findz v2 uses one Go core in `native/findz-go`, built as a Windows `c-shared` DLL. A dedicated Bun Worker loads it through `bun:ffi`, owns `@parcel/watcher`, and is the only JavaScript caller of the versioned JSON C ABI. The React GUI talks to that Worker through the node contract. The CLI and TUI become minimal GUI-only registered shells; they no longer supply an alternate Findz implementation.

The core owns a separate SQLite database per Library at `%LOCALAPPDATA%/Xiranite/findz/indexes/<library-id>.sqlite`, using `database/sql` and `mattn/go-sqlite3`. It owns ZIP/CBZ indexing, incremental invalidation, image-analysis task state, metadata status, anomaly calculation, pagination, and parameterized query compilation. `xiranite.db` is not used for Findz's library index.

Findz reuses maintained primitives:

- `laktak/zfind` as a Go module for traversal/filter primitives, without copying upstream source and without exposing its SQL-like CLI language as Findz's API;
- Go `archive/zip` for ZIP/CBZ headers and streams, rather than a project-written ZIP parser;
- `bep/imagemeta` for applicable supplemental metadata, plus bounded header-only adapters for actual format and dimensions;
- `webtreemap-cdt@3.2.1` behind a thin UI adapter for the WizTree-like rectangle visualization.

`laktak/zfind`, `bep/imagemeta`, and `mattn/go-sqlite3` are MIT; `webtreemap-cdt@3.2.1` is Apache-2.0. On 2026-07-27 their GitHub repositories showed current 2026 activity, and the published treemap package reported a 57,692-byte unpacked size. Exact Go versions and checksums are pinned by `go.mod`/`go.sum`; forks and Git-source dependencies are not introduced.

Base scans inspect filesystem and ZIP central-directory data only. Image analysis is manually started, persisted, resumable, globally exclusive, bounded in concurrency, and limited to 512 KiB for JPEG/PNG/GIF/WebP or 4 MiB for AVIF/HEIF. JPEG XL is represented as unsupported. Base scans must not regress more than 5% over equivalent ZIP header scanning, and metadata parsing may add at most 20% over reading the same prefix.

The full protocol, schema, GUI contract, migration scope, and acceptance evidence are defined by `docs/findz-v2-design.md`.

## Alternatives considered

### Keep a Node-only implementation

Node packages can enumerate files and parse some ZIP or image formats, but using them would retain multiple hand-owned parser and lifecycle paths or add browser-oriented archive stacks to the backend. It does not give Findz a shared durable core for GUI, future shell surfaces, task recovery, and typed queries. It is rejected for v2.

### Use `ffi-rs` or a Rust Node-API addon

Rust Node-API would add a second native-language core or require translating the chosen Go/archive ecosystem into Rust. `ffi-rs` would also create a new binding layer without removing the need to define Findz's own core. The stable, small C ABI plus Bun's existing direct FFI pattern keeps the Worker boundary explicit and permits Go to remain the only Findz core.

### Wrap `fselect`, Recoll, or a generic desktop-search engine

`fselect` is useful for filesystem predicates but does not provide ZIP member indexing, durable per-library image metadata, anomaly semantics, or a task model. Recoll and similar systems introduce a separate service/database and document-search assumptions that do not fit a local archive-quality workbench. Both would still require a substantial Findz-specific layer.

### Copy or fork zfind

Copying upstream would transfer maintenance of ZIP traversal/filter behavior into Xiranite and would cause unnecessary source divergence. A module dependency behind a narrow adapter preserves upstream attribution, updates, and license boundaries while Findz retains only domain-specific indexing semantics.

### Generic ORM over SQLite

Findz needs a small, explicit schema, transactional archive replacement, predictable pagination, and explainable query plans. `database/sql` plus a small repository layer is simpler, avoids ORM runtime/bundle cost, and keeps all query semantics in the Go core.

### ECharts or the original abandoned webtreemap

ECharts is broader and materially heavier than a focused treemap layout dependency, while the original abandoned webtreemap does not meet the maintenance boundary. `webtreemap-cdt@3.2.1` is the maintained Apache-2.0 package used by Lighthouse, has a small published footprint, and exposes the rectangle/zoom/keyboard behavior Findz needs. It is still isolated so it can be replaced if evidence changes.

## Consequences

Findz's source replacement can proceed without preserving old command behavior, but all new surfaces consume one core protocol. The native artifact must be built, packaged, hash-verified, and smoke-tested as part of the usual native asset flow. The Worker must not call the DLL from arbitrary backend paths, and it must free every returned buffer.

The project takes responsibility for the Findz query AST, database schema, anomaly policy, watcher adapter, GUI interaction contract, and support/error reporting. It deliberately does not take responsibility for ZIP codec implementation, general file walking/filter parsing, image codec implementation, or treemap layout internals.

Any later addition of another archive family, nested-archive recursion, JPEG XL, automatic recompression, a different native binding, or a performance-budget exception changes this decision and requires a focused ADR update.
