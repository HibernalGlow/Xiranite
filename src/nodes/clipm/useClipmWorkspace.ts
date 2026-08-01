import { useCallback, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { ClipmData, ClipmInput } from "@xiranite/node-clipm/core"
import { clipmResultPatch } from "./workspace-state"
import type { ClipmCardState, ClipmWorkspaceView } from "./types"

type ClipmHost = NodeComponentProps<ClipmCardState>["host"]

export interface ClipmWorkspaceController {
  data: ClipmCardState
  running: boolean
  patch(next: Partial<ClipmCardState>): void
  selectView(view: ClipmWorkspaceView): void
  pickDirectory(): Promise<void>
  run(input: ClipmInput): Promise<NodeRunResult<ClipmData> | undefined>
  cancel(): Promise<void>
  refreshCorrections(): Promise<void>
  refreshModels(): Promise<void>
}

export function useClipmWorkspace(compId: string, host: ClipmHost): ClipmWorkspaceController {
  const data = getHostData(host, compId)
  const dataRef = useRef(data)
  dataRef.current = data
  const busyRef = useRef(false)
  const [running, setRunning] = useState(false)

  const patch = useCallback((next: Partial<ClipmCardState>) => {
    dataRef.current = { ...dataRef.current, ...next }
    if (host.state?.patchData) host.state.patchData(next)
    else host.patchData(compId, next)
  }, [compId, host])

  const appendLog = useCallback((message: string) => {
    patch({ logs: [...(dataRef.current.logs ?? []), message].slice(-200) })
  }, [patch])

  const run = useCallback(async (input: ClipmInput): Promise<NodeRunResult<ClipmData> | undefined> => {
    if (busyRef.current) return undefined
    const invoke = host.runner?.run ?? host.actions?.run
    if (!invoke) {
      patch({ phase: "error", progressText: "当前宿主没有本地节点运行能力。" })
      return undefined
    }
    busyRef.current = true
    setRunning(true)
    patch({
      busyAction: input.action ?? "score",
      phase: "running",
      progress: 0,
      progressText: "正在连接 ClipM worker",
    })
    try {
      const response = await invoke<ClipmInput, ClipmData>("clipm", input, (event: NodeRunEvent) => {
        if (event.type === "progress") patch({ progress: event.progress ?? 0, progressText: event.message })
        appendLog(`[${event.progress ?? 0}%] ${event.message}`)
      }) as NodeRunResult<ClipmData>
      patch({
        ...(response.data ? clipmResultPatch(response.data) : {}),
        busyAction: null,
        phase: response.success ? "completed" : "error",
        progress: response.success ? 100 : dataRef.current.progress,
        progressText: response.message,
      })
      appendLog(response.message)
      return response
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      patch({ busyAction: null, phase: "error", progressText: message })
      appendLog(message)
      return { success: false, message }
    } finally {
      busyRef.current = false
      setRunning(false)
    }
  }, [appendLog, host, patch])

  const refreshCorrections = useCallback(async () => {
    await run({
      action: "review-list",
      reviewStatus: dataRef.current.reviewStatus ?? "pending",
      reviewLimit: 200,
    })
  }, [run])

  const refreshModels = useCallback(async () => {
    await run({ action: "env-status" })
    await run({ action: "model-list", includeFailed: true })
  }, [run])

  return {
    data,
    running,
    patch,
    selectView(view) {
      patch({ activeView: view })
      if (view === "corrections" && !dataRef.current.reviewItems) void refreshCorrections()
      if (view === "models" && (!dataRef.current.modelsResult || !dataRef.current.environmentStatus)) void refreshModels()
    },
    async pickDirectory() {
      const path = await host.localFiles?.pickDirectory?.()
      if (path) patch({ path })
    },
    run,
    async cancel() {
      const cancel = host.runner?.cancelCurrent ?? host.actions?.cancelCurrent
      await cancel?.()
    },
    refreshCorrections,
    refreshModels,
  }
}

function getHostData(host: ClipmHost, compId: string): ClipmCardState {
  return host.state?.getData?.() ?? host.getData<ClipmCardState>(compId) ?? {}
}
