import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { ClipmData, ClipmInput } from "@xiranite/node-clipm/core"
import type { ClipmNodeConfig } from "@xiranite/node-clipm/platform"
import { refreshNodeOperationEventsOnLocalBackend } from "@/backend/nodeRpcClient"
import { isTerminalPhase, useNodeOperations } from "@/store/nodeOperations"
import { clipmResultPatch, mergeScoreProgress, scoreProgressWork } from "./workspace-state"
import type { ClipmCardState, ClipmWorkspaceView } from "./types"

type ClipmHost = NodeComponentProps<ClipmCardState, ClipmNodeConfig>["host"]

export interface ClipmEnvironmentConfigState {
  loading: boolean
  value?: ClipmNodeConfig
  path?: string
  error?: string
}

export interface ClipmWorkspaceController {
  data: ClipmCardState
  running: boolean
  environmentConfig: ClipmEnvironmentConfigState
  patch(next: Partial<ClipmCardState>): void
  selectView(view: ClipmWorkspaceView): void
  pickDirectory(): Promise<void>
  pickEnvironmentDirectory(): Promise<string | undefined>
  configureEnvironment(runtimeRoot: string, device: "cuda" | "cpu"): Promise<boolean>
  migrateEnvironment(runtimeRoot: string): Promise<boolean>
  updateConfig(patch: Partial<ClipmNodeConfig>): Promise<boolean>
  run(input: ClipmInput): Promise<NodeRunResult<ClipmData> | undefined>
  cancel(): Promise<void>
  refreshCorrections(): Promise<void>
  refreshModels(): Promise<void>
}

export function useClipmWorkspace(compId: string, host: ClipmHost): ClipmWorkspaceController {
  const data = getHostData(host, compId)
  const dataRef = useRef(data)
  dataRef.current = data
  const operations = useNodeOperations((state) => state.operations)
  const componentOperations = useMemo(
    () => operations
      .filter((operation) => operation.nodeId === "clipm" && operation.componentId === compId)
      .sort((left, right) => right.createdAt - left.createdAt),
    [compId, operations],
  )
  const activeOperationKey = componentOperations
    .filter((operation) => !isTerminalPhase(operation.phase))
    .map((operation) => operation.operationId)
    .join("|")
  const [pendingRuns, setPendingRuns] = useState(0)
  const pendingRunsRef = useRef(0)
  const [running, setRunning] = useState(false)
  const [environmentConfig, setEnvironmentConfig] = useState<ClipmEnvironmentConfigState>({ loading: true })
  const syncedOperationRef = useRef("")

  const patch = useCallback((next: Partial<ClipmCardState>) => {
    dataRef.current = { ...dataRef.current, ...next }
    if (host.state?.patchData) host.state.patchData(next)
    else host.patchData(compId, next)
  }, [compId, host])

  useEffect(() => {
    setRunning(pendingRuns > 0 || componentOperations.some((operation) => !isTerminalPhase(operation.phase)))
  }, [componentOperations, pendingRuns])

  useEffect(() => {
    let active = true
    const read = host.config?.get ?? host.getNodeConfig
    if (!read) {
      setEnvironmentConfig({ loading: false })
      return
    }
    void read<ClipmNodeConfig>().then(({ config, path }) => {
      if (active) setEnvironmentConfig({ loading: false, value: config, path })
    }, (error) => {
      if (active) setEnvironmentConfig({ loading: false, error: error instanceof Error ? error.message : String(error) })
    })
    return () => { active = false }
  }, [host])

  // The stream is the fast path. Polling the operation journal is the recovery
  // path for WebView/Wails transports that buffer NDJSON until the worker exits.
  useEffect(() => {
    if (!activeOperationKey) return
    let mounted = true
    const refresh = async () => {
      const ids = useNodeOperations.getState().operations
        .filter((operation) => operation.nodeId === "clipm" && operation.componentId === compId && !isTerminalPhase(operation.phase))
        .map((operation) => operation.operationId)
      await Promise.allSettled(ids.map((operationId) => refreshNodeOperationEventsOnLocalBackend(operationId)))
      if (!mounted) return
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 750)
    return () => {
      mounted = false
      window.clearInterval(timer)
    }
  }, [activeOperationKey, compId])

  useEffect(() => {
    const latest = componentOperations[0]
    if (!latest) return
    const activeOperations = componentOperations.filter((operation) => !isTerminalPhase(operation.phase))
    const displayOperation = activeOperations[0] ?? latest
    const signature = componentOperations
      .map((operation) => `${operation.operationId}:${operation.phase}:${operation.eventCount}:${operation.updatedAt}`)
      .join("|")
    if (signature === syncedOperationRef.current) return
    syncedOperationRef.current = signature

    let scoreResult = dataRef.current.scoreResult
    for (const operation of [...componentOperations].reverse()) {
      for (const event of operation.events) {
        const work = scoreProgressWork(event.data)
        if (work) scoreResult = mergeScoreProgress(scoreResult, work)
      }
    }
    const messages = componentOperations
      .flatMap((operation) => operation.events.map((event) => `[${event.progress ?? 0}%] ${event.message}`))
      .slice(-200)
    const terminal = activeOperations.length === 0 && isTerminalPhase(displayOperation.phase)
    const next: Partial<ClipmCardState> = {
      ...(scoreResult !== dataRef.current.scoreResult ? { scoreResult } : {}),
      phase: activeOperations.length ? "running" : terminal ? displayOperation.phase === "completed" ? "completed" : "error" : "running",
      progress: displayOperation.lastProgress ?? dataRef.current.progress,
      progressText: displayOperation.lastMessage ?? dataRef.current.progressText,
      ...(messages.length ? { logs: messages } : {}),
      ...(terminal && pendingRunsRef.current === 0
        ? { busyAction: null }
        : {}),
    }
    patch(next)
  }, [componentOperations, patch])

  const appendLog = useCallback((message: string) => {
    patch({ logs: [...(dataRef.current.logs ?? []), message].slice(-200) })
  }, [patch])

  const run = useCallback(async (input: ClipmInput): Promise<NodeRunResult<ClipmData> | undefined> => {
    const invoke = host.runner?.run ?? host.actions?.run
    if (!invoke) {
      patch({ phase: "error", progressText: "当前宿主没有本地节点运行能力。" })
      return undefined
    }
    pendingRunsRef.current += 1
    setPendingRuns((count) => count + 1)
    patch({
      busyAction: input.action ?? "score",
      phase: "running",
      progress: 0,
      progressText: "正在连接 ClipM worker",
    })
    try {
      const response = await invoke<ClipmInput, ClipmData>("clipm", input, (event: NodeRunEvent) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          const work = input.action === "score" ? scoreProgressWork(event.data) : undefined
          if (work) patch({ scoreResult: mergeScoreProgress(dataRef.current.scoreResult, work) })
        }
        appendLog(`[${event.progress ?? 0}%] ${event.message}`)
      }) as NodeRunResult<ClipmData>
      const otherWorkIsActive = pendingRunsRef.current > 1 || useNodeOperations.getState().operations.some(
        (operation) => operation.nodeId === "clipm" && operation.componentId === compId && !isTerminalPhase(operation.phase),
      )
      patch({
        ...(response.data ? clipmResultPatch(response.data, dataRef.current.scoreResult) : {}),
        ...(otherWorkIsActive ? {} : {
          busyAction: null,
          phase: response.success ? "completed" : "error",
          progress: response.success ? 100 : dataRef.current.progress,
        }),
        progressText: response.message,
      })
      appendLog(response.message)
      return response
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const otherWorkIsActive = pendingRunsRef.current > 1 || useNodeOperations.getState().operations.some(
        (operation) => operation.nodeId === "clipm" && operation.componentId === compId && !isTerminalPhase(operation.phase),
      )
      patch({ ...(otherWorkIsActive ? {} : { busyAction: null, phase: "error" }), progressText: message })
      appendLog(message)
      return { success: false, message }
    } finally {
      pendingRunsRef.current = Math.max(0, pendingRunsRef.current - 1)
      setPendingRuns((count) => Math.max(0, count - 1))
    }
  }, [appendLog, compId, host, patch])

  const refreshCorrections = useCallback(async () => {
    const feedback = await run({
      action: "feedback-list",
      includeUndone: true,
      feedbackLimit: 100,
    })
    if (!feedback?.success) return
    const reviews = await run({
      action: "review-list",
      reviewStatus: dataRef.current.reviewStatus ?? "pending",
      reviewLimit: 200,
    })
    if (!reviews?.success) return
    await run({ action: "recovery-status", recoveryLimit: 25 })
  }, [run])

  const refreshModels = useCallback(async () => {
    await run({ action: "env-status" })
    await run({ action: "model-list", includeFailed: true })
  }, [run])

  useEffect(() => {
    if (
      !environmentConfig.loading
      && environmentConfig.value?.runtime_root
      && data.activeView === "models"
      && !data.environmentStatus
      && !running
    ) void refreshModels()
  }, [data.activeView, data.environmentStatus, environmentConfig.loading, environmentConfig.value?.runtime_root, refreshModels, running])

  const saveEnvironmentConfig = useCallback(async (patchValue: Partial<ClipmNodeConfig>) => {
    const save = host.config?.save ?? host.saveNodeConfig
    if (!save) throw new Error("当前宿主不支持保存 ClipM 节点配置。")
    const next = { ...(environmentConfig.value ?? {}), ...patchValue }
    await save<ClipmNodeConfig>(next)
    setEnvironmentConfig((current) => ({ ...current, loading: false, value: next, error: undefined }))
  }, [environmentConfig.value, host])

  return {
    data,
    running,
    environmentConfig,
    patch,
    selectView(view) {
      patch({ activeView: view })
      if (view === "corrections" && (!dataRef.current.feedbackEvents || !dataRef.current.reviewItems || !dataRef.current.recoveryStatus)) void refreshCorrections()
      if (view === "models" && environmentConfig.value?.runtime_root && (!dataRef.current.modelsResult || !dataRef.current.environmentStatus)) void refreshModels()
    },
    async pickDirectory() {
      const path = await host.localFiles?.pickDirectory?.()
      if (path) patch({ path })
    },
    pickEnvironmentDirectory: async () => await host.localFiles?.pickDirectory?.(),
    async configureEnvironment(runtimeRoot, device) {
      const response = await run({ action: "env-configure", targetRuntimeRoot: runtimeRoot, device })
      if (!response?.success) return false
      setEnvironmentConfig((current) => ({
        ...current,
        value: { ...(current.value ?? {}), runtime_root: runtimeRoot, device },
      }))
      await run({ action: "model-list", includeFailed: true })
      return true
    },
    async migrateEnvironment(runtimeRoot) {
      const response = await run({ action: "env-migrate", targetRuntimeRoot: runtimeRoot })
      if (!response?.success) return false
      setEnvironmentConfig((current) => ({
        ...current,
        value: { ...(current.value ?? {}), runtime_root: runtimeRoot },
      }))
      await refreshModels()
      return true
    },
    async updateConfig(configPatch) {
      try {
        await saveEnvironmentConfig(configPatch)
        return true
      } catch (error) {
        patch({ phase: "error", progressText: error instanceof Error ? error.message : String(error) })
        return false
      }
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
