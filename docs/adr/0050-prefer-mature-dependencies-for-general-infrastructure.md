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
