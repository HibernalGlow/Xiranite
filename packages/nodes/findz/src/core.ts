import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type {
  FindzApiInfo,
  FindzAnalysisScope,
  FindzArchiveQuery,
  FindzArchiveRow,
  FindzGateway,
  FindzLibraryOpenParams,
  FindzLibrarySummary,
  FindzMemberRow,
  FindzPagedResult,
  FindzTask,
  FindzTreemapNode,
} from "./protocol.js"

export type FindzAction =
  | "api_info"
  | "open_library"
  | "close_library"
  | "scan"
  | "analyze"
  | "query_archives"
  | "query_members"
  | "export_rows"
  | "treemap"
  | "task"
  | "pause"
  | "resume"
  | "cancel"

export interface FindzInput {
  action?: FindzAction
  library?: FindzLibraryOpenParams
  libraryId?: string
  taskId?: string
  archiveId?: number
  text?: string
  pathPrefix?: string
  areaBy?: string
  query?: Omit<FindzArchiveQuery, "libraryId">
  analysisScope?: FindzAnalysisScope
}

export interface FindzData {
  action: FindzAction
  apiInfo?: FindzApiInfo
  library?: FindzLibrarySummary
  task?: FindzTask
  archives?: FindzPagedResult<FindzArchiveRow>
  members?: FindzPagedResult<FindzMemberRow>
  treemap?: FindzTreemapNode
}

export type FindzResult = NodeRunResult<FindzData>

/**
 * What the host injects into a Findz run: the one thing the core cannot build for itself is the answer
 * to an engine frame.
 *
 * `platform.ts` supplies it over `@xiranite/host-capabilities`' `service.invoke`, which in the desktop
 * host is the door `crates/xiranite-quickjs-executor/src/findz_operations.rs` answers by writing one
 * frame to the Go sidecar this run owns (ADR-0077). The core stays platform-free, so the same code runs
 * behind a test's in-memory gateway (`runFindzWithGateway`) and nothing here knows which transport it got.
 */
export interface FindzRuntime {
  readonly findz: FindzGateway
}

export async function runFindz(
  input: FindzInput,
  runtime?: FindzRuntime,
  onEvent?: (event: NodeRunEvent) => void,
): Promise<FindzResult> {
  const gateway = runtime?.findz
  if (gateway === undefined) {
    // A refusal, not a throw: the realm calls `run(input, runtime, onEvent)` and a missing runtime means
    // the host registered this node without its platform half, which is a configuration answer the caller
    // can act on. Inventing a transport here would put a second engine inside the core.
    return {
      success: false,
      message: "Findz needs the host runtime: no gateway was injected (service.invoke)",
      data: { action: input.action ?? "query_archives" },
    }
  }
  return await runFindzWithGateway(input, gateway, onEvent)
}

export async function runFindzWithGateway(input: FindzInput, gateway: FindzGateway, onEvent?: (event: NodeRunEvent) => void): Promise<FindzResult> {
  const action = input.action ?? "query_archives"
  try {
    onEvent?.({ type: "progress", progress: 0, message: actionMessage(action, "Starting") })
    const data = await dispatchFindzAction(action, input, gateway, onEvent)
    // "Finished", not "Queued": a scan action now returns a settled task, and reporting a finished
    // run as queued is the kind of wording that makes a progress line unreadable.
    onEvent?.({ type: "progress", progress: 100, message: actionMessage(action, "Finished") })
    return { success: true, message: actionMessage(action, "Findz"), data }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    onEvent?.({ type: "log", message })
    return { success: false, message, data: { action } }
  }
}

async function dispatchFindzAction(
  action: FindzAction,
  input: FindzInput,
  gateway: FindzGateway,
  onEvent?: (event: NodeRunEvent) => void,
): Promise<FindzData> {
  switch (action) {
    case "api_info":
      return { action, apiInfo: await gateway.call<FindzApiInfo>("api.info", {}) }
    case "open_library": {
      if (!input.library?.root) throw new Error("A Findz library root is required.")
      return { action, library: await gateway.call<FindzLibrarySummary>("library.open", input.library) }
    }
    case "close_library":
      const libraryId = await ensureLibrary(gateway, input)
      await gateway.call<void>("library.close", { libraryId })
      return { action }
    case "scan": {
      const libraryId = await ensureLibrary(gateway, input)
      const started = await gateway.call<FindzTask>("scan.start", { libraryId })
      return { action, task: await awaitFindzTask(gateway, onEvent, libraryId, started) }
    }
    case "analyze": {
      const libraryId = await ensureLibrary(gateway, input)
      const analysis = await gateway.call<FindzTask>("analysis.start", { libraryId, scope: input.analysisScope ?? { kind: "all" } })
      return { action, task: await awaitFindzTask(gateway, onEvent, libraryId, analysis) }
    }
    case "query_archives": {
      const libraryId = await ensureLibrary(gateway, input)
      return { action, archives: await gateway.call("query.archives", { libraryId, text: input.text, ...input.query, ...(input.pathPrefix ? { pathPrefix: input.pathPrefix } : {}) }) }
    }
    case "export_rows": {
      const libraryId = await ensureLibrary(gateway, input)
      return { action, archives: await gateway.call("export.rows", { libraryId, text: input.text, ...input.query, ...(input.pathPrefix ? { pathPrefix: input.pathPrefix } : {}) }) }
    }
    case "query_members": {
      const libraryId = await ensureLibrary(gateway, input)
      return { action, members: await gateway.call("query.members", { libraryId, archiveId: requiredNumber(input.archiveId, "archiveId"), text: input.text, page: input.query?.page }) }
    }
    case "treemap": {
      const libraryId = await ensureLibrary(gateway, input)
      return { action, treemap: await gateway.call("projection.treemap", { libraryId, text: input.text, rules: input.query?.rules, areaBy: input.areaBy, ...(input.pathPrefix ? { pathPrefix: input.pathPrefix } : {}) }) }
    }
    case "task": {
      const libraryId = await ensureLibrary(gateway, input)
      return { action, task: await gateway.call<FindzTask>("task.get", taskParams(input, libraryId)) }
    }
    case "pause": {
      const libraryId = await ensureLibrary(gateway, input)
      return { action, task: await gateway.call<FindzTask>("task.pause", taskParams(input, libraryId)) }
    }
    case "resume": {
      const libraryId = await ensureLibrary(gateway, input)
      return { action, task: await gateway.call<FindzTask>("task.resume", taskParams(input, libraryId)) }
    }
    case "cancel": {
      const libraryId = await ensureLibrary(gateway, input)
      return { action, task: await gateway.call<FindzTask>("task.cancel", taskParams(input, libraryId)) }
    }
  }
  return assertNever(action)
}


/**
 * Makes sure the library this action addresses is open *in this run*, and returns the id the core gave it.
 *
 * ADR-0077 scopes the Findz engine to the run, so a fresh operation starts with an empty library table:
 * a `libraryId` carried over from an earlier run is not a handle to anything. The root is therefore the
 * only thing that can re-open it, and the id comes back from the engine rather than being trusted from
 * the caller — `library.open` is idempotent per (root, databasePath), so paying one extra round trip per
 * action buys "the same node answers whether it is the first click or the fifth".
 */
async function ensureLibrary(gateway: FindzGateway, input: FindzInput): Promise<string> {
  const root = input.library?.root?.trim()
  if (root) {
    const summary = await gateway.call<FindzLibrarySummary>("library.open", input.library)
    return summary.libraryId
  }
  if (input.libraryId) {
    throw new Error(
      "Findz actions need library.root: the engine lives only as long as the run, so a libraryId from an earlier run cannot be re-opened without its root."
    )
  }
  throw new Error("A Findz library root is required.")
}

/**
 * Holds the action until its task leaves running/queued, pacing itself with the engine.
 *
 * A QuickJS realm has no timers, so the node cannot sleep between reads — the wait has to be a request
 * the engine holds (ADR-0077 decision 6). This is also what makes a scan survive the run model at all:
 * `scan.start` alone answers `queued`, and if the run ends there the host terminates the sidecar mid-scan
 * and the task recovers as `paused` with only what it had committed. Measured on the 100-archive fixture
 * before this existed: `done 2 / 100`.
 *
 * The round cap is a stop-loss against an engine that never settles, not a timeout policy; the
 * operation's own deadline governs how long a run may take, and a cancelled run travels back as a
 * refusal from inside `service.invoke` rather than outliving the scan.
 */
async function awaitFindzTask(
  gateway: FindzGateway,
  onEvent: ((event: NodeRunEvent) => void) | undefined,
  libraryId: string,
  task: FindzTask,
): Promise<FindzTask> {
  let current = task
  for (let round = 0; round < 5000; round++) {
    if (current.status !== "running" && current.status !== "queued") return current
    current = await gateway.call<FindzTask>("task.wait", { libraryId, taskId: current.id, timeoutMs: 2000 })
    const total = current.totalArchives || 0
    const settled = current.status !== "running" && current.status !== "queued"
    onEvent?.({
      type: "progress",
      // The cap keeps a still-running task from ever reporting "done"; a settled one must report 100
      // rather than a 99 that reads as a scan that stopped one archive short.
      progress: settled ? (current.status === "completed" || current.status === "completed_with_warnings" ? 100 : 0) : total > 0 ? Math.min(99, Math.round((current.doneArchives / total) * 100)) : 0,
      message: `Findz ${current.kind}: ${current.doneArchives} of ${total}.`,
    })
  }
  return current
}

function taskParams(input: FindzInput, libraryId: string) {
  return { libraryId, taskId: requiredString(input.taskId, "taskId") }
}

function requiredString(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`Findz ${label} is required.`)
  return value
}

function requiredNumber(value: number | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error(`Findz ${label} is required.`)
  return value
}

function actionMessage(action: FindzAction, prefix: string): string {
  const labels: Record<FindzAction, string> = {
    api_info: "native capability check",
    open_library: "library open",
    close_library: "library close",
    scan: "ZIP scan",
    analyze: "image analysis",
    query_archives: "archive query",
    query_members: "member query",
    export_rows: "archive export",
    treemap: "treemap projection",
    task: "task status",
    pause: "task pause",
    resume: "task resume",
    cancel: "task cancel",
  }
  return `${prefix}: ${labels[action]}.`
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Findz action: ${value}`)
}

export type { FindzGateway, FindzMethod } from "./protocol.js"
