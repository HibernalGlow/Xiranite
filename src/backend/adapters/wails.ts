import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type {
  EventBusRuntime,
  FileSystemRuntime,
  FsEntry,
  FsStat,
  MainWindowAction,
  NodeRunnerRuntime,
  OpenComponentWindowInput,
  RuntimeInterface,
  StorageRuntime,
  SubprocessResult,
  SubprocessRuntime,
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

export function createWailsRuntime(): RuntimeInterface {
  return {
    kind: "wails",
    storage: new WailsStorage(),
    fs: new WailsFS(),
    subprocess: new WailsSubprocess(),
    events: new WailsEventBus(),
    nodeRunner: new WailsNodeRunner(),
    windows: new WailsWindowRuntime(),
  }
}

export function detectWails(): boolean {
  return typeof window !== "undefined" && !!window._wails
}
