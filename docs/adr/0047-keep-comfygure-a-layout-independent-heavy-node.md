---
status: accepted
---

# Keep Comfygure a layout-independent heavy node

Comfygure remains an Xiranite node rather than a standalone application, route, or independent workspace. Its Fixed UI is a heavy node projection: it may provide dense task-focused controls and virtualized data views, but it must stay within the host node's geometry, lifecycle, ownership, and resource limits. Any host-provided floating or maximize behavior remains an explicit node-window preference, not an alternate application surface.

The Comfygure Program, compiler, Run Coordinator, persistence contracts, and UI state interfaces are layout-independent. A later Fixed UI redesign or optional Canvas UI may replace presentation components without changing the Program format, Compiler Recipes, Target Adapter, or Run Records. No current three-column workbench layout is architectural or persistent state.
