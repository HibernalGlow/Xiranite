import { createStore } from "@xstate/store"
import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

import {
  appendCzkawkaActivityLog,
  type CzkawkaActivityLogEntry,
  type CzkawkaActivityLogInput,
} from "./activity-log.js"
import {
  nextCzkawkaCacheRegenerationState,
  type CzkawkaCacheRegenerationState,
} from "./cache-regeneration.js"
import type { CzkawkaAction, CzkawkaData, CzkawkaInput, CzkawkaSelectionStrategy, CzkawkaTool } from "./core.js"
import type { CzkawkaFilterState } from "./filters.js"
import {
  createCzkawkaSelectionHistory,
  pushCzkawkaSelectionHistory,
  redoCzkawkaSelectionHistory,
  type CzkawkaSelectionHistory,
  undoCzkawkaSelectionHistory,
} from "./selection-assistant.js"

export type CzkawkaWorkbenchPhase = "idle" | "running" | "completed" | "stopped" | "error"
export type CzkawkaWorkbenchPanel = "source" | "results" | "analysis"

export interface CzkawkaWorkbenchState {
  running: boolean
  panel: CzkawkaWorkbenchPanel
  resultsByTool: Partial<Record<CzkawkaTool, CzkawkaData>>
  selectedPathsByTool: Partial<Record<CzkawkaTool, string[]>>
  selectionHistoriesByTool: Partial<Record<CzkawkaTool, CzkawkaSelectionHistory>>
  filterStatesByTool: Partial<Record<CzkawkaTool, CzkawkaFilterState>>
  activityLog: CzkawkaActivityLogEntry[]
  cacheRegeneration: CzkawkaCacheRegenerationState
}

export interface CzkawkaWorkbenchInitialState {
  result?: CzkawkaData | null
  filterStatesByTool?: Partial<Record<CzkawkaTool, CzkawkaFilterState>>
  activityLog?: CzkawkaActivityLogEntry[]
  cacheRegeneration?: CzkawkaCacheRegenerationState
}

export interface CzkawkaWorkbenchPersistencePatch {
  phase?: CzkawkaWorkbenchPhase
  progress?: number
  progressText?: string
  result?: CzkawkaData | null
  operation?: CzkawkaData | null
  filterStatesByTool?: Partial<Record<CzkawkaTool, CzkawkaFilterState>>
  activityLog?: CzkawkaActivityLogEntry[]
  cacheRegeneration?: CzkawkaCacheRegenerationState
}

export interface CzkawkaWorkbenchPort {
  persist(patch: CzkawkaWorkbenchPersistencePatch): void
  run?: (
    nodeId: string,
    input: CzkawkaInput,
    onEvent?: (event: NodeRunEvent) => void,
  ) => Promise<NodeRunResult<CzkawkaData>>
  cancel?: () => Promise<unknown>
}

export interface CzkawkaScanMessages {
  noRoots: string
  noRuntime: string
  cacheRegeneration: string
  starting: string
  stopping: string
}

export interface CzkawkaOperationMessages {
  description(action: CzkawkaAction, count: number): string
}

export interface CzkawkaWorkbench {
  subscribe(listener: (state: CzkawkaWorkbenchState) => void): () => void
  getState(): CzkawkaWorkbenchState
  updatePort(port: CzkawkaWorkbenchPort): void
  getResult(tool: CzkawkaTool, persisted?: CzkawkaData | null): CzkawkaData | null
  getSelectedPaths(tool: CzkawkaTool): string[]
  getFilterState(tool: CzkawkaTool): CzkawkaFilterState | undefined
  getSelectionHistory(tool: CzkawkaTool): CzkawkaSelectionHistory
  setPanel(panel: CzkawkaWorkbenchPanel): void
  setFilterState(tool: CzkawkaTool, filter: CzkawkaFilterState): void
  setSelectedPaths(tool: CzkawkaTool, paths: string[]): void
  resetSelectedPaths(tool: CzkawkaTool, paths?: string[]): void
  undoSelection(tool: CzkawkaTool): void
  redoSelection(tool: CzkawkaTool): void
  addActivityLog(tool: CzkawkaTool, input: Omit<CzkawkaActivityLogInput, "tool">): void
  clearActivityLog(): void
  executeScan(tool: CzkawkaTool, input: CzkawkaInput, messages: CzkawkaScanMessages): Promise<void>
  cancelScan(tool: CzkawkaTool, messages: Pick<CzkawkaScanMessages, "stopping">): Promise<void>
  executeOperation(
    tool: CzkawkaTool,
    action: CzkawkaAction,
    input: CzkawkaInput,
    messages: CzkawkaOperationMessages,
  ): Promise<void>
}

const EMPTY_PORT: CzkawkaWorkbenchPort = { persist: () => undefined }

export function createCzkawkaWorkbench(
  initial: CzkawkaWorkbenchInitialState = {},
  initialPort: CzkawkaWorkbenchPort = EMPTY_PORT,
): CzkawkaWorkbench {
  let port = initialPort
  const initialState: CzkawkaWorkbenchState = {
    running: false,
    panel: "source",
    resultsByTool: initial.result ? { [initial.result.tool]: initial.result } : {},
    selectedPathsByTool: {},
    selectionHistoriesByTool: {},
    filterStatesByTool: initial.filterStatesByTool ?? {},
    activityLog: initial.activityLog ?? [],
    cacheRegeneration: initial.cacheRegeneration ?? {},
  }
  const store = createStore({
    context: initialState,
    on: {
      replace: (_context, event: { next: CzkawkaWorkbenchState }) => event.next,
    },
  })

  function getState(): CzkawkaWorkbenchState {
    return store.getSnapshot().context
  }

  function replace(update: (current: CzkawkaWorkbenchState) => CzkawkaWorkbenchState): CzkawkaWorkbenchState {
    const next = update(getState())
    store.trigger.replace({ next })
    return next
  }

  function addActivityLog(tool: CzkawkaTool, input: Omit<CzkawkaActivityLogInput, "tool">): void {
    const state = replace((current) => ({
      ...current,
      activityLog: appendCzkawkaActivityLog(current.activityLog, { ...input, tool }),
    }))
    port.persist({ activityLog: state.activityLog })
  }

  function fail(tool: CzkawkaTool, kind: CzkawkaActivityLogInput["kind"], message: string, action?: CzkawkaAction): void {
    port.persist({ phase: "error", progressText: message })
    addActivityLog(tool, { kind, level: "error", message, action })
  }

  function resetSelectedPaths(tool: CzkawkaTool, paths: string[] = []): void {
    const selectedPaths = [...paths]
    replace((current) => ({
      ...current,
      selectedPathsByTool: { ...current.selectedPathsByTool, [tool]: selectedPaths },
      selectionHistoriesByTool: {
        ...current.selectionHistoriesByTool,
        [tool]: createCzkawkaSelectionHistory(selectedPaths),
      },
    }))
  }

  return {
    subscribe(listener) {
      const subscription = store.subscribe((snapshot) => listener(snapshot.context))
      return () => subscription.unsubscribe()
    },
    getState,
    updatePort(nextPort) {
      port = nextPort
    },
    getResult(tool, persisted) {
      return getState().resultsByTool[tool] ?? (persisted?.tool === tool ? persisted : null)
    },
    getSelectedPaths(tool) {
      return getState().selectedPathsByTool[tool] ?? []
    },
    getFilterState(tool) {
      return getState().filterStatesByTool[tool]
    },
    getSelectionHistory(tool) {
      const state = getState()
      return state.selectionHistoriesByTool[tool] ?? createCzkawkaSelectionHistory(state.selectedPathsByTool[tool] ?? [])
    },
    setPanel(panel) {
      replace((current) => current.panel === panel ? current : { ...current, panel })
    },
    setFilterState(tool, filter) {
      const state = replace((current) => ({
        ...current,
        filterStatesByTool: { ...current.filterStatesByTool, [tool]: filter },
      }))
      port.persist({ filterStatesByTool: state.filterStatesByTool })
    },
    setSelectedPaths(tool, paths) {
      const selectedPaths = [...paths]
      replace((current) => ({
        ...current,
        selectedPathsByTool: { ...current.selectedPathsByTool, [tool]: selectedPaths },
        selectionHistoriesByTool: {
          ...current.selectionHistoriesByTool,
          [tool]: pushCzkawkaSelectionHistory(
            current.selectionHistoriesByTool[tool] ?? createCzkawkaSelectionHistory(current.selectedPathsByTool[tool] ?? []),
            selectedPaths,
          ),
        },
      }))
    },
    resetSelectedPaths,
    undoSelection(tool) {
      replace((current) => {
        const history = undoCzkawkaSelectionHistory(
          current.selectionHistoriesByTool[tool] ?? createCzkawkaSelectionHistory(current.selectedPathsByTool[tool] ?? []),
        )
        return {
          ...current,
          selectedPathsByTool: { ...current.selectedPathsByTool, [tool]: history.present },
          selectionHistoriesByTool: { ...current.selectionHistoriesByTool, [tool]: history },
        }
      })
    },
    redoSelection(tool) {
      replace((current) => {
        const history = redoCzkawkaSelectionHistory(
          current.selectionHistoriesByTool[tool] ?? createCzkawkaSelectionHistory(current.selectedPathsByTool[tool] ?? []),
        )
        return {
          ...current,
          selectedPathsByTool: { ...current.selectedPathsByTool, [tool]: history.present },
          selectionHistoriesByTool: { ...current.selectionHistoriesByTool, [tool]: history },
        }
      })
    },
    addActivityLog,
    clearActivityLog() {
      replace((current) => ({ ...current, activityLog: [] }))
      port.persist({ activityLog: [] })
    },
    async executeScan(tool, input, messages) {
      if (getState().running) return
      if (!input.includedDirectories?.length) {
        fail(tool, "system", messages.noRoots)
        return
      }
      if (!port.run) {
        fail(tool, "system", messages.noRuntime)
        return
      }
      const cacheRegeneration = nextCzkawkaCacheRegenerationState(getState().cacheRegeneration, tool)
      if (cacheRegeneration) {
        replace((current) => ({ ...current, cacheRegeneration }))
        port.persist({ cacheRegeneration })
        addActivityLog(tool, { kind: "system", level: "warning", message: messages.cacheRegeneration })
      }
      replace((current) => ({ ...current, running: true }))
      resetSelectedPaths(tool)
      port.persist({ phase: "running", progress: 0, progressText: messages.starting, result: null })
      addActivityLog(tool, { kind: "scan", level: "info", message: messages.starting, progress: 0 })
      try {
        const response = await port.run("czkawka", input, (event) => {
          if (event.type === "progress") {
            port.persist({ progress: event.progress ?? 0, progressText: event.message })
          }
          addActivityLog(tool, {
            kind: event.type === "progress" ? "progress" : "system",
            level: "info",
            message: event.message,
            progress: event.progress,
          })
        })
        if (response.data) {
          replace((current) => ({
            ...current,
            resultsByTool: { ...current.resultsByTool, [tool]: response.data! },
            panel: "results",
          }))
        }
        const stopped = response.data?.stopped === true
        port.persist({
          phase: stopped ? "stopped" : response.success ? "completed" : "error",
          progress: response.success || stopped ? 100 : 0,
          progressText: response.message,
          result: response.data ?? null,
        })
        addActivityLog(tool, {
          kind: "scan",
          level: stopped ? "warning" : response.success ? "success" : "error",
          message: response.message,
          progress: response.success || stopped ? 100 : undefined,
        })
      } catch (error) {
        fail(tool, "scan", errorMessage(error))
      } finally {
        replace((current) => ({ ...current, running: false }))
      }
    },
    async cancelScan(tool, messages) {
      if (!getState().running || !port.cancel) return
      port.persist({ progressText: messages.stopping })
      addActivityLog(tool, { kind: "system", level: "warning", message: messages.stopping })
      await port.cancel()
    },
    async executeOperation(tool, action, input, messages) {
      if (getState().running || !port.run || !input.selectedPaths?.length) return
      const description = messages.description(action, input.selectedPaths.length)
      replace((current) => ({ ...current, running: true }))
      port.persist({ progressText: description })
      addActivityLog(tool, { kind: "operation", level: "info", action, message: description })
      try {
        const response = await port.run("czkawka", input)
        port.persist({
          progressText: response.message,
          operation: response.data ?? null,
          phase: response.success ? "completed" : "error",
        })
        addActivityLog(tool, {
          kind: "operation",
          level: response.success ? "success" : "error",
          action,
          message: response.message,
          affectedCount: response.data?.affectedCount,
          errorCount: response.data?.errorCount,
        })
        if (response.success && input.dryRun === false && action !== "save") {
          resetSelectedPaths(tool)
        }
      } catch (error) {
        fail(tool, "operation", errorMessage(error), action)
      } finally {
        replace((current) => ({ ...current, running: false }))
      }
    },
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
