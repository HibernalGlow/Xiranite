---
status: proposed
---

# Evaluate a DSH-style plugin architecture for Xiranite

## Context

The DeepSeek Harness reference checkout at `ref/deepseek-harness` demonstrates an architecture where everything is a plugin, powered by vendored Cordis. Its three load-bearing mechanisms are:

- **A plugin core with reversible effects.** Plugins contribute services under stable `ctx.<key>` slots, typed events through declaration merging, and registrations through `ctx.effect()` / `ctx.on()` that return disposers. Unloading a plugin unwinds every registration it made, which is what makes in-process hot replacement safe.
- **Config-driven composition.** A running instance is a plugin tree assembled from layered config rows (profiles, bundles, `cordis.patch.yml`). The tree is patchable at runtime: HMR watches the user patch file and recomposes the affected rows transactionally. Adding, removing, or overriding a plugin never requires editing product code.
- **Client-plugin UI hot reload.** Each UI is an independently built bundle (`dsh.client`, platform `web`). A watch build (`dev-web.ts`) rebuilds bundles on source change; the host webserver stat-polls them and broadcasts `rebuilt` frames; the browser half reloads one plugin per frame through `invalidate -> prefetch -> registry.delete -> drain old fiber -> refresh() -> remount`. Dependents cascade through Cordis activation epochs, so no client-side graph analysis is needed.

Xiranite already holds part of this shape:

- Node packages are plugin-shaped: each `packages/nodes/*` is an independent npm package exporting a `NodeEntry` (`core` / `platform` / `cli` / `Component`), with a published external-node contract (`docs/external-node-packages.md`).
- Registration is code-generated into `packages/runtime/src/node-runner.generated.ts` and `src/components/modules/packageModules.generated.ts`; the frontend lazy-loads node UIs through generated loaders instead of static imports.
- Dev-time hot reload exists: `XIRANITE_NODE_SOURCE_HMR` revision-based invalidation for node source, Vite HMR for the UI, and a dev supervisor that restarts the backend on backend-source change.

The gaps versus DSH are:

- Backend registrations in `packages/backend`, `packages/services`, `packages/runtime`, and `packages/api` are static composition, not reversible effects. Without disposers there is no fiber-level in-process plugin replacement; the current fallback is a whole-backend restart.
- There is no config-driven composition. Adding a node runs code generation and a rebuild; the tree cannot be assembled or patched from configuration at runtime.
- The UI is one Vite application with lazy chunks, not independent replaceable bundles. Vite HMR covers development, but a runtime-installed or runtime-replaced node UI requires a different loading path.
- There is no runtime plugin installation (no equivalent of a profile / `dsh plugin` install).

Three essential differences argue against copying DSH wholesale:

- **Host.** DSH is a pure Node web server; "everything is a plugin" covers the whole process. Xiranite is a Wails/Go desktop shell. The Go side (window, tray, taskbar, external launch, Windows integration) should remain a thin host, not a plugin surface; the plugin tree lives in the Bun backend and the React UI, consistent with the existing host/adapter boundary.
- **Runtime.** DSH targets Node 22/24 + pnpm; Xiranite runs Bun. Cordis itself is plain ESM and should run under Bun, but loader, HMR, and file-watching details need verification.
- **Domain.** DSH is an agent harness (session log, tool registry, LLM adapters). Its session/seam/agent-loop machinery is irrelevant to a desktop file-tooling product. DSH is also in developer preview with breaking changes; following its exact code is chasing a moving target.

## Decision

Adopt the DSH *principles* — a plugin core with reversible effects, config-driven composition with HMR, and independently replaceable UI bundles — rather than its code, in staged migration. Do not plugin-ize the Go shell. Keep the staged plan below as the reference path, and do not pick the plugin-core dependency before the Phase 0 verification below produces evidence.

**Phase 0 — core selection verification (prerequisite).** Build a prototype that mounts one lightweight node (e.g. `linedup`) and one heavy node (e.g. `neoview`) under Cordis running on Bun, covering: `ctx` service injection, `ctx.effect()` disposers, in-process fiber hot replacement on source change without a backend restart, and coexistence with the existing `node-module-loader` revision invalidation. Record whether the existing node test matrix and `audit:node-architecture` gates stay green. Compare against a minimal in-house core (context + typed events + effect/disposer, a few hundred lines) on the same prototype surface. The selection decision uses this evidence; per ADR-0050, prefer the maintained dependency when the evidence shows equivalent behavior and Bun compatibility.

**Phase 1 — backend plugin core.** Introduce effect semantics into `packages/runtime` / `packages/backend`: convert the generated registry from a static spec map into plugin mounting with disposers, and make service registrations in `packages/services` / `packages/api` reversible. This is the largest work item and must keep all existing audit gates green.

**Phase 2 — config-driven composition.** Add a composition file (a Cordis-style patch layer, or an extension of the `[nodes.*]` sections in `xiranite.config.toml`) that decides which nodes and backend services mount, with HMR recomposition.

**Phase 3 — UI plugin-ization.** Split workspace views and node UIs into independently built client bundles with a runtime replace path, upgrading the existing generated lazy loaders rather than replacing them.

**Phase 4 — runtime plugin installation.** Install external npm node packages into a profile at runtime.

## Alternatives considered

### Copy DSH's architecture wholesale (vendored Cordis + profile/bundle + client HMR)

Rejected for this migration: it drags in agent-harness machinery Xiranite does not need, ties the codebase to DSH's pre-release iteration, and does not address the Wails host or Bun runtime differences. The principles are portable; the code is not.

### Keep the current architecture unchanged

Retained as the baseline. Development hot reload already covers most of the DX goal; the gaps are runtime composability, per-plugin replacement granularity, and out-of-tree installation. Any of the staged phases can stop early if the cost-benefit changes.

### Build a minimal in-house plugin core

Retained as a fallback if Cordis fails Bun verification or its scope cannot be trimmed to the 20% Xiranite needs. It is fully controllable and dependency-free, but it re-implements tested effect/event/loader machinery and must be maintained and tested by Xiranite (ADR-0050 pushes toward the maintained dependency first).

## Consequences

Adopting the principles commits Xiranite to the staged work: effect-ifying backend registrations (largest effort, gated by the existing audit matrix), adding a composition file with HMR, splitting UI into replaceable bundles with a backend-to-WebView transport for hot replacement in both dev and production, and runtime plugin installation. Risks: the 1000-line source gate and the node test matrix constrain the refactor; the Windows dev-machine memory budget forces serial builds during a long migration; and the Wails WebView reload transport is new plumbing that must be verified on both dev (Vite) and production (asset middleware) paths.

No ADR decision is final on the plugin-core dependency or on starting Phase 1 until the Phase 0 prototype evidence is recorded. This document is the assessment record; the decision documents for core selection and each phase update or supersede it.
