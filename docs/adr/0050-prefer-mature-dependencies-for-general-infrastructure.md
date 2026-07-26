---
status: accepted
---

# Prefer mature dependencies for general infrastructure

When adding a feature or reviewing existing implementation, Xiranite first checks whether a mature, actively maintained package or framework already provides the general-purpose capability. When the dependency has acceptable API, license, platform compatibility, runtime and bundle cost, and maintenance health, Xiranite prefers it over duplicating hand-rolled infrastructure. The replacement must have no material performance regression, or only a small regression supported by focused benchmarks.

This decision does not replace Xiranite-owned domain semantics, platform adapters, serialization and persistence contracts, or proven performance-critical paths. Those boundaries remain project-owned when an external dependency would weaken behavior, portability, observability, or performance. A dependency is not justified solely because it is popular or removes lines of code.

For each non-trivial replacement, the implementation records the important trade-offs and validation evidence in the change or its focused documentation. Future work should reuse the selected dependency and must not reintroduce equivalent general-purpose code without a new, evidence-based decision.

## Evaluation gate

- Identify the exact general-purpose capability being replaced and the project-specific behavior that must remain owned.
- Check maintenance activity, license compatibility, API stability, platform support, transitive dependencies, bundle/runtime cost, and security posture.
- Measure a relevant hot path or add focused tests when performance or lifecycle behavior could change.
- Prefer the dependency only when the evidence shows equivalent behavior and no material performance loss, or a small accepted loss with a clear maintenance/DX benefit.
- Keep adapters thin and isolate the dependency behind the existing package or platform boundary when it should not leak into shared contracts.

## Applied decision: recoverable Windows trash operations

Xiranite uses `trash-rs 5.2.6` for deletion and receipt-based restoration, and `trash-core 0.3.1` for bounded parsing and `$I`/`$R` pairing during Windows Recycle Bin enumeration. The native workspace minimum Rust version is 1.96 because every published `trash-core` release requires it. Both crates are isolated behind the CZKawka Node-API adapter; shared file-operation contracts do not depend on Rust types.

The alternatives did not meet the latency and packaging requirements. The NPM `trash` package has a maintained prebuilt Windows helper but no restore receipt API. `recycle-bin` is stale and has no restoration support. The Rust `recyclebin 0.1.1` crate shells out to PowerShell COM for listing and restoring, repeating the slow Shell enumeration path. `trash-core` is Apache-2.0, pure Rust, fuzz-tested, and directly covers the binary metadata format that Xiranite would otherwise need to maintain.

Xiranite still owns the thin Windows adapter that discovers local fixed and removable volumes, converts parsed metadata to `trash-rs::TrashItem`, and caches results. Real native smoke tests require both deletion and cold enumeration to complete within one second, then restore the exact receipt and verify file contents.
