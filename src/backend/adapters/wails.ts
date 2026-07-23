import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type {
  EventBusRuntime,
  FileSystemRuntime,
  FsEntry,
  FsStat,
  MainWindowAction,
  NativeFileDropEvent,
  NativeFileDropRuntime,
  NodeRunnerRuntime,
  OpenComponentWindowInput,
  RuntimeInterface,
  StorageRuntime,
  SubprocessResult,
  SubprocessRuntime,
  NativeTraySpec,
  TrayActionEvent,
  TrayCapabilities,
  TrayRuntime,
  SubprocessSpawnOpts,
  WindowCapabilities,
  WindowCommandResult,
  WindowFrame,
  WindowRuntime,
} from "../runtime/runtime"
import type { ProgressEvent } from "../shared/types"

const PKG = "main.XiraniteService"

type WailsRuntime = typeof import("@wailsio/runtime")

declare global {
  interface Window {
    _wails?: unknown
  }
}

interface NodeRunBridgeResponse<TData = unknown> {
  result: NodeRunResult<TData>
  events?: NodeRunEvent[]
}

async function loadRuntime(): Promise<WailsRuntime> {
  return await import("@wailsio/runtime")
}

async function callGo<T>(method: string, ...args: unknown[]): Promise<T> {
  const runtime = await loadRuntime()
  return runtime.Call.ByName(`${PKG}.${method}`, ...args) as Promise<T>
}

function decodeBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (Array.isArray(value)) return Uint8Array.from(value)
  if (typeof value === "string") {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  }
  if (value && typeof value === "object") {
    return Uint8Array.from(Object.values(value as Record<string, number>))
  }
  return new Uint8Array(0)
}

function encodeBytes(value: Uint8Array): number[] {
  return Array.from(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseJSON<T>(value: unknown): T {
  return typeof value === "string" ? JSON.parse(value) as T : value as T
}

function normalizeEvent(value: unknown): ProgressEvent {
  const data = value && typeof value === "object" && "data" in value
    ? (value as { data: unknown }).data
    : value
  return parseJSON<ProgressEvent>(data)
}

function isNodeRunBridgeResponse<TData>(value: unknown): value is NodeRunBridgeResponse<TData> {
  return !!value && typeof value === "object" && "result" in value
}

class WailsStorage implements StorageRuntime {
  async get(key: string): Promise<string | null> {
    return await callGo<string | null>("StorageGet", key)
  }

  async set(key: string, value: string): Promise<void> {
    await callGo<void>("StorageSet", key, value)
  }

  async delete(key: string): Promise<void> {
    await callGo<void>("StorageDelete", key)
  }

  async keys(prefix: string): Promise<string[]> {
    return await callGo<string[]>("StorageKeys", prefix)
  }
}

class WailsFS implements FileSystemRuntime {
  async exists(path: string): Promise<boolean> {
    return await callGo<boolean>("FsExists", path)
  }

  async listDir(dirPath: string): Promise<FsEntry[]> {
    return await callGo<FsEntry[]>("FsListDir", dirPath)
  }

  async readFileText(path: string): Promise<string> {
    return await callGo<string>("FsReadFileText", path)
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    return decodeBytes(await callGo<unknown>("FsReadFileBytes", path))
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    if (typeof content === "string") {
      await callGo<void>("FsWriteFileText", path, content)
      return
    }
    await callGo<void>("FsWriteFileBytes", path, encodeBytes(content))
  }

  async remove(path: string, opts?: { permanent?: boolean }): Promise<void> {
    await callGo<void>("FsRemove", path, opts?.permanent ?? false)
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await callGo<void>("FsRename", oldPath, newPath)
  }

  async stat(path: string): Promise<FsStat> {
    return await callGo<FsStat>("FsStat", path)
  }
}

class WailsSubprocess implements SubprocessRuntime {
  async spawn(
    cmd: string,
    args: string[],
    opts: SubprocessSpawnOpts,
    handlers?: { onStdout?: (chunk: string) => void; onStderr?: (chunk: string) => void },
  ): Promise<SubprocessResult> {
    const result = parseJSON<SubprocessResult>(await callGo<string>("SubprocessSpawn", JSON.stringify({
      cmd,
      args,
      cwd: opts.cwd,
      env: opts.env,
      stdin: opts.stdin,
    })))
    if (result.stdout) handlers?.onStdout?.(result.stdout)
    if (result.stderr) handlers?.onStderr?.(result.stderr)
    return result
  }
}

class WailsEventBus implements EventBusRuntime {
  private readonly localSubs = new Map<string, Set<(event: ProgressEvent) => void>>()

  async subscribe(topic: string, handler: (event: ProgressEvent) => void): Promise<() => void> {
    if (!this.localSubs.has(topic)) this.localSubs.set(topic, new Set())
    this.localSubs.get(topic)!.add(handler)

    const runtime = await loadRuntime()
    const unsubscribe = runtime.Events.On(`xiranite:event:${topic}`, (event: unknown) => {
      handler(normalizeEvent(event))
    })

    return () => {
      this.localSubs.get(topic)?.delete(handler)
      unsubscribe()
    }
  }

  async publish(topic: string, event: ProgressEvent): Promise<void> {
    await callGo<void>("EventsPublish", topic, JSON.stringify(event))
    this.localSubs.get(topic)?.forEach((handler) => handler(event))
  }
}

class WailsFileDropRuntime implements NativeFileDropRuntime {
  async subscribe(handler: (event: NativeFileDropEvent) => void): Promise<() => void> {
    const runtime = await loadRuntime()
    return runtime.Events.On("files-dropped", (event: unknown) => {
      const payload = unwrapEventData(event)
      if (!payload || typeof payload !== "object") return
      const rawFiles = (payload as { files?: unknown }).files
      const details = (payload as { details?: unknown }).details
      const files = Array.isArray(rawFiles)
        ? rawFiles.filter((path): path is string => typeof path === "string" && path.length > 0)
        : []
      const attributes = details && typeof details === "object" ? (details as { attributes?: unknown }).attributes : undefined
      const localTarget = attributes && typeof attributes === "object"
        ? (attributes as Record<string, unknown>)["data-local-file-drop-target"]
        : undefined
      const targetId = typeof localTarget === "string"
        ? localTarget
        : details && typeof details === "object" && typeof (details as { id?: unknown }).id === "string"
          ? (details as { id: string }).id
          : undefined
      if (files.length) handler({ files, targetId })
    })
  }
}

function unwrapEventData(event: unknown): unknown {
  return event && typeof event === "object" && "data" in event
    ? (event as { data: unknown }).data
    : event
}

class WailsNodeRunner implements NodeRunnerRuntime {
  async runNode<TInput = unknown, TData = unknown>(
    nodeId: string,
    input: TInput,
    onEvent?: (event: NodeRunEvent) => void,
  ): Promise<NodeRunResult<TData>> {
    try {
      const raw = await callGo<string>("NodeRun", nodeId, JSON.stringify(input ?? null))
      const response = parseJSON<unknown>(raw)
      if (isNodeRunBridgeResponse<TData>(response)) {
        response.events?.forEach((event) => onEvent?.(event))
        return response.result
      }
      return response as NodeRunResult<TData>
    } catch (error) {
      const message = `Node runner failed: ${errorMessage(error)}`
      onEvent?.({ type: "log", message })
      return { success: false, message }
    }
  }
}

class WailsWindowRuntime implements WindowRuntime {
  async getCapabilities(): Promise<WindowCapabilities> {
    return await callGo<WindowCapabilities>("WindowCapabilities")
  }

  async controlMain(action: MainWindowAction): Promise<WindowCommandResult> {
    const runtime = await loadRuntime()
    if (action === "minimize") {
      await runtime.Window.Minimise()
      return { success: true, supported: true, message: "Window minimised.", state: "minimized" }
    }
    if (action === "maximize") {
      await runtime.Window.ToggleMaximise()
      const isMaximised = await runtime.Window.IsMaximised()
      return {
        success: true,
        supported: true,
        message: isMaximised ? "Window maximised." : "Window restored.",
        state: isMaximised ? "maximized" : "normal",
      }
    }
    if (action === "toggle-fullscreen") {
      await runtime.Window.ToggleFullscreen()
      const isFullscreen = await runtime.Window.IsFullscreen()
      return {
        success: true,
        supported: true,
        message: isFullscreen ? "Window entered fullscreen." : "Window exited fullscreen.",
        state: isFullscreen ? "fullscreen" : "normal",
      }
    }
    if (action === "restore") {
      await runtime.Window.Restore()
      return { success: true, supported: true, message: "Window restored.", state: "normal" }
    }
    await runtime.Window.Close()
    return { success: true, supported: true, message: "Window closed.", state: "closed" }
  }

  async openComponent(input: OpenComponentWindowInput): Promise<WindowCommandResult> {
    return await callGo<WindowCommandResult>("WindowOpenComponent", JSON.stringify(input))
  }

  async focus(id: string): Promise<WindowCommandResult> {
    return await callGo<WindowCommandResult>("WindowFocus", id)
  }

  async close(id: string): Promise<WindowCommandResult> {
    return await callGo<WindowCommandResult>("WindowClose", id)
  }

  async getFrame(id?: string): Promise<WindowFrame | null> {
    return await callGo<WindowFrame | null>("WindowGetFrame", id ?? "")
  }

  async setFrame(frame: WindowFrame, id?: string): Promise<WindowCommandResult> {
    return await callGo<WindowCommandResult>("WindowSetFrame", id ?? "", JSON.stringify(frame))
  }
}

class WailsTrayRuntime implements TrayRuntime {
  async getCapabilities(): Promise<TrayCapabilities> {
    return await callGo<TrayCapabilities>("TrayCapabilities")
  }

  async setMainEnabled(enabled: boolean): Promise<void> {
    await callGo<void>("TraySetMainEnabled", enabled)
  }

  async sync(specs: NativeTraySpec[]): Promise<void> {
    const resolved = await Promise.all(specs.map(async (spec) => ({
      ...spec,
      icon: undefined,
      iconDataUrl: spec.icon ? await resolveImageDataUrl(spec.icon) : undefined,
    })))
    await callGo<void>("TraySync", JSON.stringify(resolved))
  }

  async subscribe(handler: (event: TrayActionEvent) => void): Promise<() => void> {
    const runtime = await loadRuntime()
    return runtime.Events.On("tray-action", (event: unknown) => {
      const payload = unwrapEventData(event)
      if (!payload || typeof payload !== "object") return
      const trayId = (payload as { trayId?: unknown }).trayId
      const itemId = (payload as { itemId?: unknown }).itemId
      if (typeof trayId === "string" && typeof itemId === "string") handler({ trayId, itemId })
    })
  }
}

async function resolveImageDataUrl(source: string): Promise<string> {
  if (source.startsWith("data:")) return source
  const response = await fetch(source)
  if (!response.ok) throw new Error(`Unable to load tray icon: ${response.status}`)
  const blob = await response.blob()
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("Unable to decode tray icon."))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}

export function createWailsRuntime(): RuntimeInterface {
  return {
    kind: "wails",
    storage: new WailsStorage(),
    fs: new WailsFS(),
    fileDrops: new WailsFileDropRuntime(),
    subprocess: new WailsSubprocess(),
    events: new WailsEventBus(),
    nodeRunner: new WailsNodeRunner(),
    windows: new WailsWindowRuntime(),
    trays: new WailsTrayRuntime(),
  }
}

export function detectWails(): boolean {
  return typeof window !== "undefined" && !!window._wails
}
