import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import type { AppNodeEntry, NodeHostApi, NodeRunEvent, NodeRunResult, NodeSchema } from "@xiranite/contract"
import { NODE_HOST_CONTRACT_VERSION } from "@xiranite/contract"
import { packageModuleLoaders } from "@/components/modules/packageModules.generated"
import { useTheme } from "@/components/use-theme"
import { hydrateLocalBackendConfig, localBackendFileUrl, localBackendUrl, type LocalBackendConfig } from "@/backend/localBackendConfig"
import { clearLocalFilesClipboard, copyLocalFilesToClipboard, listLocalFiles, pickLocalPaths, readLocalFilesFromClipboard, stageLocalFiles } from "@/backend/localFilesClient"
import { cancelNodeOperationOnLocalBackend, runNodeOnLocalBackend } from "@/backend/nodeRpcClient"
import { getNodeConfigFromBackend, getNodePresetsFromBackend, getNodeUiConfigFromBackend, saveNodeConfigToBackend, saveNodeUiConfigToBackend } from "@/backend/configRpcClient"
import { useNodeOperations } from "@/store/nodeOperations"
import { NODE_APP_HOST_CAPABILITIES, nodeAppHostHasCapability } from "./nodeAppHostContract"
import { useNodeAppState } from "./nodeAppState"

export interface NodeAppProps {
  nodeId: string
  snapshotId: string
  onHostReady?: (value: { entry: AppNodeEntry; host: NodeHostApi }) => void
}

export type NodeAppStateController = {
  data: Record<string, unknown>
  patchData: (patch: Record<string, unknown>) => void
  ready: boolean
}

export type NodeAppStateHook = (
  dataSchema: NodeSchema<Record<string, unknown>> | undefined,
  enabled: boolean,
) => NodeAppStateController

export function StandaloneNodeApp(props: NodeAppProps) {
  return <NodeAppSurface {...props} componentIdPrefix="node-app" useStateController={useNodeAppState} />
}

export function NodeAppSurface({
  nodeId,
  snapshotId,
  onHostReady,
  componentIdPrefix,
  useStateController,
}: NodeAppProps & {
  componentIdPrefix: "node-app" | "direct-node"
  useStateController: NodeAppStateHook
}) {
  const [entry, setEntry] = useState<AppNodeEntry | undefined>()
  const [error, setError] = useState<string | undefined>()
  const diagnostic = useNodeAppDiagnostic(nodeId, snapshotId)
  const closePrompt = useNodeAppClosePrompt()
  const componentId = `${componentIdPrefix}:${nodeId}:${snapshotId}`
  const nodeHost = useNodeAppHostApi(nodeId, componentId, entry?.schemas?.data, Boolean(entry), useStateController)

  useEffect(() => {
    if (diagnostic.status !== "ready" || !entry || !nodeHost.stateReady) return
    onHostReady?.({ entry, host: nodeHost.host })
  }, [diagnostic.status, entry, nodeHost.host, nodeHost.stateReady, onHostReady])

  useEffect(() => {
    let cancelled = false
    const loader = packageModuleLoaders[nodeId]
    if (!loader) {
      setError(`Node ${nodeId} is not present in this application snapshot.`)
      return
    }
    void loader().then((module) => {
      if (!cancelled) setEntry(module.default as AppNodeEntry)
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { cancelled = true }
  }, [nodeId])

  if (diagnostic.status === "failed") return <NodeAppDiagnosticScreen diagnostic={diagnostic} />
  if (error) return <Failure message={error} />
  if (diagnostic.status !== "ready") return <div className="h-screen bg-background" />
  if (!entry) return <div className="h-screen bg-background" />
  if (!nodeHost.stateReady) return <div className="h-screen bg-background" />
  const Component = entry.Component as (props: { compId: string; host: NodeHostApi }) => ReactNode
  return (
    <main className="h-screen overflow-hidden bg-background text-foreground">
      <Component compId={componentId} host={nodeHost.host} />
      {closePrompt && <NodeAppClosePrompt prompt={closePrompt} onReturn={() => closePrompt.dismiss()} />}
    </main>
  )
}

type NodeAppManifest = {
  snapshotId?: string
  source?: { commit?: string | null }
  toolchain?: { bun?: string }
  node?: { id?: string; name?: string; version?: string }
  dataContract?: { currentVersion?: number; minimumSupportedVersion?: number; maximumSupportedVersion?: number }
}

type NodeAppDiagnostic =
  | { status: "checking" }
  | { status: "ready" }
  | { status: "failed"; message: string; manifest?: NodeAppManifest; runtime?: NodeAppRuntimeStatus; retry: () => void }

type NodeAppRuntimeStatus = {
  state?: string
  consecutiveFailures?: number
  restartAttempts?: number
  recoveryExhausted?: boolean
  message?: string
  dataContract?: {
    currentVersion?: number
    minimumSupportedVersion?: number
    maximumSupportedVersion?: number
    dataPath?: string
  }
  bunVersion?: string
  bunWarning?: string
}

function useNodeAppDiagnostic(nodeId: string, snapshotId: string): NodeAppDiagnostic {
  const [attempt, setAttempt] = useState(0)
  const [diagnostic, setDiagnostic] = useState<Omit<NodeAppDiagnostic, "retry">>({ status: "checking" })
  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    let cancelled = false
    setDiagnostic({ status: "checking" })
    void checkNodeAppBackend(nodeId, snapshotId).then((next) => {
      if (!cancelled) setDiagnostic(next)
    })
    return () => { cancelled = true }
  }, [attempt, nodeId, snapshotId])

  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined
    if (typeof window === "undefined" || !window._wails) return
    void import("@wailsio/runtime").then((runtime) => {
      if (disposed) return
      unsubscribe = runtime.Events.On("node-app-backend-status", (event: unknown) => {
        const status = unwrapWailsEventData(event) as NodeAppRuntimeStatus | undefined
        if (status?.state === "ready") setAttempt((value) => value + 1)
      })
    }).catch(() => undefined)
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [])

  return diagnostic.status === "failed" ? { ...diagnostic, retry } : diagnostic
}

async function checkNodeAppBackend(nodeId: string, snapshotId: string): Promise<Omit<NodeAppDiagnostic, "retry">> {
  const manifest = await fetch("/node-app-manifest.json", { cache: "no-store" })
    .then(async (response) => response.ok ? await response.json() as NodeAppManifest : undefined)
    .catch(() => undefined)
  try {
    const config = await hydrateLocalBackendConfig()
    if (!config) throw new Error("The bundled Bun backend did not start. Check that Bun is available on this machine.")
    const health = await requestNodeAppHealth(config)
    if (health.nodeId !== nodeId || health.snapshotId !== snapshotId) {
      throw new Error("The running backend does not match this node application snapshot.")
    }
    return { status: "ready" }
  } catch (cause) {
    const runtime = await requestNodeAppRuntimeStatus()
    return {
      status: "failed",
      manifest,
      runtime,
      message: runtime?.state === "incompatible-data-contract" && runtime.message
        ? runtime.message
        : cause instanceof Error ? cause.message : String(cause),
    }
  }
}

async function requestNodeAppHealth(config: LocalBackendConfig): Promise<{ nodeId?: string; snapshotId?: string }> {
  const response = await fetch(localBackendUrl("/health", config), {
    cache: "no-store",
    headers: config.token ? { "x-xiranite-token": config.token } : undefined,
  })
  if (!response.ok) throw new Error(`The bundled backend health check failed (${response.status}).`)
  return await response.json() as { nodeId?: string; snapshotId?: string }
}

export function NodeAppDiagnosticScreen({ diagnostic }: { diagnostic: Extract<NodeAppDiagnostic, { status: "failed" }> }) {
  const node = diagnostic.manifest?.node
  return (
    <main className="grid h-screen place-items-center bg-background p-6 text-foreground">
      <section className="w-full max-w-xl space-y-4 border border-border bg-card p-6 text-sm shadow-sm">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">{node?.name ?? "Node application"} could not start</h1>
          <p className="text-muted-foreground">{diagnostic.message}</p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-muted-foreground">
          <dt>Snapshot</dt><dd className="break-all text-foreground">{diagnostic.manifest?.snapshotId ?? "unavailable"}</dd>
          <dt>Source commit</dt><dd className="break-all text-foreground">{diagnostic.manifest?.source?.commit ?? "uncommitted source snapshot"}</dd>
          <dt>Bun at build</dt><dd className="text-foreground">{diagnostic.manifest?.toolchain?.bun ?? "unavailable"}</dd>
          {diagnostic.manifest?.dataContract && <>
            <dt>Supported data contract</dt><dd className="text-foreground">{formatDataContractRange(diagnostic.manifest.dataContract)}</dd>
          </>}
          {diagnostic.runtime && <>
            <dt>Recovery</dt><dd className="text-foreground">{formatRuntimeStatus(diagnostic.runtime)}</dd>
            {diagnostic.runtime.message && <><dt>Recovery detail</dt><dd className="text-foreground">{diagnostic.runtime.message}</dd></>}
            {diagnostic.runtime.bunWarning && <><dt>Bun compatibility</dt><dd className="text-foreground">{diagnostic.runtime.bunWarning}</dd></>}
            {diagnostic.runtime.dataContract && <>
              <dt>Current data contract</dt><dd className="text-foreground">{diagnostic.runtime.dataContract.currentVersion ?? "unavailable"}</dd>
              <dt>Data path</dt><dd className="break-all text-foreground">{diagnostic.runtime.dataContract.dataPath ?? "unavailable"}</dd>
            </>}
          </>}
        </dl>
        <div className="flex items-center justify-between gap-4">
          <code className="text-xs text-muted-foreground">bun scripts/package-node-app.ts {node?.id ?? "nodeId"}</code>
          <button type="button" className="border border-input px-3 py-1.5 text-sm" onClick={diagnostic.retry}>Retry</button>
        </div>
      </section>
    </main>
  )
}

type NodeAppClosePromptState = {
  activeTasks?: number
  queryError?: string
  dismiss: () => void
}

function useNodeAppClosePrompt(): NodeAppClosePromptState | undefined {
  const [activeTasks, setActiveTasks] = useState<number | undefined>()
  const [closeQueryError, setCloseQueryError] = useState<string | undefined>()

  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined
    if (typeof window === "undefined" || !window._wails) return
    void import("@wailsio/runtime").then((runtime) => {
      if (disposed) return
      unsubscribe = runtime.Events.On("node-app-close-requested", (event: unknown) => {
        const data = unwrapWailsEventData(event)
        if (!isRecord(data)) return
        if (typeof data.queryError === "string" && data.queryError) {
          setActiveTasks(undefined)
          setCloseQueryError(data.queryError)
          return
        }
        if (typeof data.activeTasks !== "number" || data.activeTasks < 1) return
        setCloseQueryError(undefined)
        setActiveTasks(data.activeTasks)
      })
    }).catch(() => undefined)
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [])

  if (activeTasks === undefined && closeQueryError === undefined) return undefined
  return {
    activeTasks,
    queryError: closeQueryError,
    dismiss: () => {
      setActiveTasks(undefined)
      setCloseQueryError(undefined)
    },
  }
}

export function NodeAppClosePrompt({ prompt, onReturn }: { prompt: { activeTasks?: number; queryError?: string }; onReturn: () => void }) {
  const [actionError, setActionError] = useState<string | undefined>()
  const [submitting, setSubmitting] = useState(false)

  const run = useCallback(async (method: "NodeAppContinueInBackground" | "NodeAppCancelTasksAndQuit") => {
    setSubmitting(true)
    setActionError(undefined)
    try {
      const result = await callNodeAppHost(method)
      if (!result.supported) throw new Error(result.message)
      if (method === "NodeAppContinueInBackground") onReturn()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSubmitting(false)
    }
  }, [onReturn])

  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/50 p-6" role="presentation">
      <section className="w-full max-w-md space-y-4 border border-border bg-card p-6 text-sm shadow-lg" role="dialog" aria-modal="true" aria-labelledby="node-app-close-title">
        <div className="space-y-1">
          <h2 id="node-app-close-title" className="text-lg font-semibold">{prompt.queryError ? "Task status is unavailable" : "Tasks are still running"}</h2>
          <p className="text-muted-foreground">{prompt.queryError
            ? "The application could not confirm whether work is still active, so it will remain open until the backend recovers."
            : `${prompt.activeTasks} active task${prompt.activeTasks === 1 ? "" : "s"} will remain attached to this node application.`}</p>
        </div>
        {actionError && <p className="text-destructive">{actionError}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="border border-input px-3 py-1.5" disabled={submitting} onClick={onReturn}>Return</button>
          {!prompt.queryError && <>
            <button type="button" className="border border-input px-3 py-1.5" disabled={submitting} onClick={() => void run("NodeAppCancelTasksAndQuit")}>Cancel tasks and exit</button>
            <button type="button" className="bg-primary px-3 py-1.5 text-primary-foreground" disabled={submitting} onClick={() => void run("NodeAppContinueInBackground")}>Continue in background</button>
          </>}
        </div>
      </section>
    </div>
  )
}

async function requestNodeAppRuntimeStatus(): Promise<NodeAppRuntimeStatus | undefined> {
  if (typeof window === "undefined" || !window._wails) return undefined
  try {
    const runtime = await import("@wailsio/runtime")
    return await runtime.Call.ByName("main.XiraniteService.NodeAppRuntimeStatus") as NodeAppRuntimeStatus
  } catch {
    return undefined
  }
}

async function callNodeAppHost(method: "NodeAppContinueInBackground" | "NodeAppCancelTasksAndQuit"): Promise<{ supported: boolean; message: string }> {
  if (typeof window === "undefined" || !window._wails) throw new Error("Standalone node window controls are unavailable.")
  const runtime = await import("@wailsio/runtime")
  return await runtime.Call.ByName(`main.XiraniteService.${method}`) as { supported: boolean; message: string }
}

function unwrapWailsEventData(event: unknown): unknown {
  if (!isRecord(event)) return event
  return "data" in event ? event.data : event
}

function formatRuntimeStatus(status: NodeAppRuntimeStatus): string {
  if (status.recoveryExhausted) return `Recovery exhausted after ${status.restartAttempts ?? 0} restart attempt(s).`
  if (status.state === "recovering") return `Restarting backend (${status.restartAttempts ?? 0}/2).`
  if (status.state === "degraded") return `Backend health check failed (${status.consecutiveFailures ?? 0}/2).`
  return status.state ?? "unavailable"
}

function useNodeAppHostApi(
  nodeId: string,
  componentId: string,
  dataSchema: NodeSchema<Record<string, unknown>> | undefined,
  stateEnabled: boolean,
  useStateController: NodeAppStateHook,
): { host: NodeHostApi; stateReady: boolean } {
  const { data, patchData, ready: stateReady } = useStateController(dataSchema, stateEnabled)
  const { theme } = useTheme()
  const host = useMemo(() => {
    const runner = {
      run: <TInput, TData>(id: string, input: TInput, onEvent?: (event: NodeRunEvent) => void): Promise<NodeRunResult<TData>> =>
        runNodeOnLocalBackend(id, input, onEvent, { componentId }),
      cancelCurrent: async () => {
        const operation = useNodeOperations.getState().operations.find((item) => item.nodeId === nodeId && (item.phase === "queued" || item.phase === "running"))
        if (!operation) return false
        await cancelNodeOperationOnLocalBackend(operation.operationId)
        return true
      },
    }
    const config = {
      get: <T,>() => getNodeConfigFromBackend<T>(nodeId),
      save: <T,>(value: T) => saveNodeConfigToBackend(nodeId, value),
      getPresets: <T extends Record<string, unknown> = Record<string, unknown>>() => getNodePresetsFromBackend<T>(nodeId),
      getUi: <T,>() => getNodeUiConfigFromBackend<T>(nodeId),
      saveUi: <T,>(value: T) => saveNodeUiConfigToBackend(nodeId, value),
    }
    return {
      contract: {
        name: "xiranite.node-host",
        version: NODE_HOST_CONTRACT_VERSION,
        supportedCapabilities: NODE_APP_HOST_CAPABILITIES,
        hasCapability: nodeAppHostHasCapability,
      },
      state: { getData: () => data, patchData },
      workspace: { listComponents: () => [], updateComponent: () => undefined },
      runner,
      clipboard: {
        readText: () => navigator.clipboard.readText(),
        writeText: (text: string) => navigator.clipboard.writeText(text),
        readFiles: readLocalFilesFromClipboard,
        writeFiles: copyLocalFilesToClipboard,
        clearFiles: clearLocalFilesClipboard,
      },
      downloads: {
        text: (filename: string, content: string) => {
          const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }))
          const anchor = document.createElement("a")
          anchor.href = url
          anchor.download = filename
          anchor.click()
          URL.revokeObjectURL(url)
        },
      },
      localFiles: {
        getUrl: localBackendFileUrl,
        list: listLocalFiles,
        stageFiles: stageLocalFiles,
        pickFiles: () => pickLocalPaths("files"),
        pickDirectory: async () => (await pickLocalPaths("directory"))[0],
        pickDirectories: () => pickLocalPaths("directory"),
        openPath: async (value: string) => window.open(localBackendFileUrl(value), "_blank", "noopener,noreferrer"),
        revealPath: async (value: string) => window.open(localBackendFileUrl(value), "_blank", "noopener,noreferrer"),
      },
      config,
      env: { theme: theme === "dark" ? "dark" : "light", platform: "web" },
      getData: <T,>() => data as T,
      patchData: (_compId: string, patch: Record<string, unknown>) => patchData(patch),
      listComponents: () => [],
      updateComponent: () => undefined,
      actions: { run: runner.run, cancelCurrent: runner.cancelCurrent },
      downloadText: (filename: string, content: string) => {
        const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }))
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = filename
        anchor.click()
        URL.revokeObjectURL(url)
      },
      getNodeConfig: config.get,
      saveNodeConfig: config.save,
      getNodeUiConfig: config.getUi,
      saveNodeUiConfig: config.saveUi,
      openConfigFile: async () => undefined,
    } as NodeHostApi
  }, [componentId, data, nodeId, patchData, theme])
  return { host, stateReady }
}

function formatDataContractRange(contract: NonNullable<NodeAppManifest["dataContract"]>): string {
  const minimum = contract.minimumSupportedVersion ?? "?"
  const maximum = contract.maximumSupportedVersion ?? "?"
  return minimum === maximum ? String(minimum) : `${minimum}-${maximum}`
}

function Failure({ message }: { message: string }) {
  return <div className="grid h-screen place-items-center bg-background p-6 text-sm text-destructive">{message}</div>
}
