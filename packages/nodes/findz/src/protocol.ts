/**
 * The one contract between the findz core and whatever answers the Findz engine.
 *
 * `core.ts` is written against this interface, never against a transport: the Node/Bun face resolves
 * `@xiranite/findz-native` to the shared library (`callFindz` over `bun:ffi`), while the desktop host's
 * QuickJS realm resolves the same specifier to `packages/quickjs-shims/src/findz-service.ts`, which
 * sends the frame to the Go sidecar through `service.invoke` (ADR-0077).
 *
 * The method names are `native/findz-go/protocol.go`'s capability list verbatim. Two of that list are
 * deliberately absent here: `watcher.apply_changes` and `watcher.set_health` are fed by the host's own
 * watch service, and `crates/xiranite-quickjs-executor/src/findz_operations.rs` refuses them when a
 * node asks (ADR-0077 decision 5), because the Go core acts on any path inside the granted root — a
 * fabricated `delete` would drop index rows for archives that are still on disk.
 */
export type FindzMethod =
  | "api.info"
  | "library.open"
  | "library.close"
  | "scan.start"
  | "scan.reconcile"
  | "analysis.start"
  | "task.get"
  | "task.wait"
  | "task.pause"
  | "task.resume"
  | "task.cancel"
  | "query.archives"
  | "query.members"
  | "export.rows"
  | "projection.treemap"

export interface FindzGateway {
  call<T>(method: FindzMethod, params: unknown): Promise<T>
}

/**
 * The wire types, forwarded rather than restated.
 *
 * They stay defined in `packages/findz-native/src/protocol.ts` (one vocabulary, per AGENTS.md's "定义不许
 * 漂移"), and the GUI keeps importing them from there. What changed is which file *names* the specifier:
 * `core.ts` and `platform.ts` are the two files the host's feasibility analyzer treats as the node's
 * surface, and after this forwarding they name only `@xiranite/host-capabilities` — the realm door — plus
 * this relative path. That is a real structural claim, not a way of hiding one: the built core bundle
 * must contain no native specifier and no `bun:ffi`, which `bun run audit:node-bundles` and the bundle
 * scan in `docs/migration/findz-go-sidecar-roadmap.md` §8.5 check. `import type` compiles to nothing, and
 * the analyzer counts specifiers rather than emitted bytes, so without this file the core would keep a
 * `no-host-free-answer` grant it no longer uses and the node would stay unregistered.
 */
export type {
  FindzAnalysisScope,
  FindzApiInfo,
  FindzArchiveQuery,
  FindzArchiveRow,
  FindzError,
  FindzLibraryOpenParams,
  FindzLibrarySummary,
  FindzMemberRow,
  FindzPagedResult,
  FindzResponse,
  FindzRuleTree,
  FindzTask,
  FindzTreemapNode,
} from "@xiranite/findz-native"
