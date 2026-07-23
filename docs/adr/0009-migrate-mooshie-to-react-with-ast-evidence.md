---
status: superseded by ADR-0013
---

# Migrate Mooshie to React with AST evidence

Comfygure will migrate the useful Mooshie Svelte and Tauri implementation into Xiranite's React ecosystem through the existing AST-assisted migration approach: `svelte/compiler` captures component structure, OXC captures TypeScript, JavaScript, and Tauri usage, and deterministic inventories and TSX scaffolds retain source fingerprints and provenance. Generated scaffolds are reviewable migration evidence rather than production code; the final implementation is native React, does not import the generated scaffold tree, and does not depend on the Svelte runtime. A specific upstream Mooshie revision is frozen as the migration baseline; later revisions regenerate inventories and drift reports for reviewed absorption into React rather than overwriting production code. This preserves traceability and reduces mechanical rewriting while allowing Comfygure to share Xiranite's React components, state, testing, and future node-based UI integrations.
