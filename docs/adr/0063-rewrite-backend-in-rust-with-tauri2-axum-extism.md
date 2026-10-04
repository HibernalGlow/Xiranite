---
status: proposed
superseded_by: "docs/adr/0073-retire-wasm-and-register-native-nodes-through-inventory.md"  # 仅「插件执行只用 Extism」作废：节点执行层改为原生 crate 静态内置。Rust+Tokio+Axum 后端、React 19 产品层与 HTTP/Operation 协议、Tauri 2 取代 Wails/Go 全部有效。
---

# Rewrite the business backend in Rust with Tauri 2, Axum and Extism

## Context

Xiranite today is a Wails/Go desktop shell that launches a separate Bun backend process. The
measured shape of the current chain:

- 73 Go files at the repository root (~7,270 lines) plus `cmd/xiranite-native-host`, implementing
  Bun discovery, embedded-Bun preparation and extraction, backend subprocess startup, token
  generation, health waiting, a same-origin gateway (`/_xiranite/backend`), backend restart,
  Windows process containment, external node launch and node-app packaging.
- `packages/backend` (Elysia on Bun) as the HTTP business backend, with `packages/api`,
  `packages/services`, `packages/repository`, `packages/config`, `packages/contract`,
  `packages/shared`, `packages/runtime`, `packages/cli` and `packages/cli-runtime` behind it.
- 50 node directories under `packages/nodes/` (5 disabled in `xiranite.build.toml:4`), each shipping
  `core` / `platform` / `cli` / `help` / `Tui`, with React UI in `src/nodes/<id>/{entry.ts,Component.tsx}`
  and four committed generated registries from `scripts/generate-node-registries.ts`.
- A second desktop path (`desktop/deno/`, `desktop/bridge.ts`, `src/backend/adapters/wails.ts`,
  `src/backend/adapters/denoDesktop.ts`) and a Bun-dependent `desktop/node-runner-cli.ts`.

Production builds additionally ship Bun and `node_modules` inside the application, so runtime
embedding, extraction caching, version compatibility and process containment are all product
surface area.

The frontend already provides the seam this rewrite needs: `src/backend/runtime/runtime.ts`
abstracts `StorageRuntime`, `FileSystemRuntime`, `NativeFileDropRuntime`, `SubprocessRuntime`,
`EventBusRuntime`, `NodeRunnerRuntime`, `WindowRuntime` and `TrayRuntime`, and
`src/backend/client.ts` plus `src/backend/nodeRpcClient.ts` already hide the transport from the UI.
`src/store/nodeOperations.ts` and `src/components/views/NodeOperationMonitor.tsx` speak the
operation protocol, not the runtime.

## Decision

Rewrite the business backend in Rust inside one Tauri 2 core process. Keep the React product layer
and the existing HTTP/Operation protocol; replace the host and the implementation language. The
target stack is React 19 + TypeScript + Vite (Bun for development and build only, never in the
shipped product), Tauri 2 for desktop capability, Rust + Tokio + Axum for the business backend,
Extism as the only external plugin execution layer, SQLite behind a Rust repository layer, and
Rust-generated TypeScript types for the contract.

Ten binding principles:

1. React UI stays as-is. `nodeOperations` store, `NodeOperationMonitor`, workspace and component
   UI, React nodes, node config panels, history and progress UI are not redesigned.
2. The HTTP API stays. `packages/backend/src/index.ts` routes are ported, not reinvented, and the
   port is proven complete by the AST differential required in ADR-0067.
3. Operation / Pause / Resume / Cancel / History product semantics are preserved.
4. Wails, Go, Deno Desktop and the Bun backend are deleted wholesale once the Rust path covers them:
   `local_backend.go`, `bun_runtime*.go`, `local_backend_embed_*`, `desktop/deno/*`,
   `desktop/bridge.ts`, `src/backend/adapters/wails.ts`, `src/backend/adapters/denoDesktop.ts`,
   `external_node_launch_*`, `node_app_*`, `wails_browser_runtime.go`, plus Bun embedding,
   extraction caching, backend subprocess supervision and Windows process containment.
5. Extism is the only plugin execution substrate.
6. Cordis is not introduced; see Alternatives.
7. The runtime is not switched to Wasmtime for pause/resume; the checkpoint design in ADR-0066
   covers it.
8. Not every capability becomes WASM. OS APIs, FFmpeg, platform codecs, GPU and heavy native
   dependencies stay as Rust host services.
9. Tauri carries desktop capability only (tray, windows, events, dialog, single-instance, deep-link,
   updater, window-state) and never absorbs the business API. `shell`, `fs`, `store` and `localhost`
   plugins are not added by default because the backend is already Rust.
10. v1 has no runtime download-and-install third-party plugin marketplace.

Two structural consequences of principle 4: `restart backend` stops existing as a feature, because
backend and Tauri core become one process and a backend restart is an application restart; and the
memory-protection surface is re-implemented rather than ported, because `process.memoryUsage()` and
`heapUsed` are JavaScript runtime concepts. The replacement is Extism manifest WASM memory limits,
operation-manager event-count and event-buffer ceilings, and an optional process RSS watchdog.

The Cargo workspace is split rather than collapsed into `src-tauri`: `crates/xiranite-core`
(operation, scheduler, filesystem, config, history, repositories), `crates/xiranite-api` (Axum
routes), `crates/xiranite-plugins` (Extism host), `plugins/<id>/{manifest.json,plugin.wasm}`,
and `src-tauri` (tray, windows, file-drop, deep-link, bootstrap). `ResourceSchedulerService`
carries over as an idea, re-expressed with Tokio semaphores and owned permits across CPU-, GPU-,
disk- and network-bound classes. `WorkspaceRepository`, `RuntimeHistoryRepository`,
`NodeRunHistoryRepository` and KV keep their interface shape as Rust traits over SQLite, and the
frontend continues not to know which database is in use. Configuration stops flowing through
`React -> Node fs -> config` and is served by Rust.

The node list that actually gets rewritten is fixed by `docs/xiranite-target-node-manifest.json`
and enforced by `bun run audit:target-node-manifest`; ADR-0064 records the nodes removed because a
standalone project already covers them.

## Alternatives considered

### Replace HTTP with Tauri commands only

Rejected. It would discard a working, already-wrapped protocol layer (`nodeRpcClient.ts`), break the
web/dev-server path, and force the UI to be rewritten against a new invocation surface. The two
lines stay separate: business calls go React -> HTTP -> Axum -> Operation -> Extism -> WASM, while
window, tray, drag-drop and file-picker calls go React -> Tauri invoke/event.

### `tauri-plugin-localhost`

Rejected. It exists to serve Tauri's own frontend assets over a local server and its own
documentation warns of substantial security risk. The transport decision is in ADR-0065.

### Adopt Cordis and a plugin core (ADR-0059)

Rejected and closing. ADR-0059 staged a Phase 0 dependency-selection prototype. The Extism host
functions plus the existing code-generated node registry already cover what Xiranite needs, and
principle 5 and 6 forbid a second plugin framework. ADR-0059 is left as the assessment record; this
ADR supersedes its Phase 0 question.

### Switch to Wasmtime to get native pause/resume

Rejected. Current pause is not CPU suspension; it is `pauseOperation()` setting a phase and
`waitWhilePaused()` awaiting a promise. That maps directly onto a checkpoint host function, so the
runtime swap buys nothing (ADR-0066).

### Keep Wails, Go and the Bun backend and rewrite only the nodes

Retained as the baseline. It keeps the current Windows/Wails release gate and the Bun-dependent
runtime, and it preserves the surface this rewrite is intended to delete. Chosen rewrite is
explicitly larger to remove that layer of historical complexity in one pass.

## Consequences

The rewrite replaces the premises of the project instructions rather than working around them:
`AGENTS.md` now states Tauri 2 + Rust as the formal build, run and release target, forbids adding
capability on the Wails/Go/Deno/Bun layer that is scheduled for deletion, and forbids dual-stack or
proxy shims kept "for the old frontend". Rules that still name the old stack survive only as the
concrete command forms they encode (isolated temporary data directories, bounded TTL, serial heavy
builds, `--maxWorkers=1`) and are rewritten as the corresponding surface moves.

The rewrite lands in this repository, on the GitButler branch `xiranite-rust-rewrite`, not in a fresh
repository, and it does not keep the old frontend as a compatibility target: the Axum surface is the
protocol, and the frontend changes only its transport. Concretely that means no route is "temporarily
served by both backends" and no node is "temporarily run by both Bun and Extism".

Remaining risks: the 1000-line source gate constrains both sides of the migration; the Windows dev
machine memory budget forces serial builds across a long migration (measured on 2026-10-04: swap
5.7 GiB of 7.2 GiB used with 10 `flutter_tester` processes alive, which is a no-build condition for
this host); the Tauri WebView to local HTTP cross-origin path is new plumbing that must be proven
before business routes are ported (ADR-0065); hand-written TypeScript DTOs in `packages/contract` will
drift from Rust types until the generator required by ADR-0067 exists; and ADR-0053's Findz boundary
(Go core behind a Bun Worker with `bun:ffi`) must be re-decided because Bun leaves the product runtime.

No Rust crate is created before the AST dependency audit reports, per node, whether it can be a WASM
plugin, needs host IO functions, or must stay a Rust host service. That audit is the prerequisite
decision, not an implementation detail.
