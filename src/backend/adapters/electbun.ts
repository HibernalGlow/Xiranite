import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type {
  EventBusRuntime,
  FileSystemRuntime,
  FsEntry,
  FsStat,
  NodeRunnerRuntime,
  RuntimeInterface,
  StorageRuntime,
  SubprocessResult,
  SubprocessRuntime,
  SubprocessSpawnOpts,
} from "../runtime/runtime"
import type { ProgressEvent } from "../shared/types"

declare global {
  interface Window {
    __ELECTBUN__?: ElectbunBridge
  }
}

interface ElectbunBridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>
  subscribe?(topic: string, handler: (event: ProgressEvent) => void): () => void
  port?: number
}

interface NodeRunBridgeResponse<TData = unknown> {
  result: NodeRunResult<TData>
  events?: NodeRunEvent[]
}

async function httpInvoke(port: number, channel: string, payload?: unknown): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${port}/ipc/${encodeURIComponent(channel)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  })

  if (!res.ok) {
    throw new Error(`IPC ${channel} failed: ${res.status} ${await res.text()}`)
  }

  return res.json()
}

function decodeBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (Array.isArray(value)) return Uint8Array.from(value)
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

function isNodeRunBridgeResponse<TData>(value: unknown): value is NodeRunBridgeResponse<TData> {
  return !!value && typeof value === "object" && "result" in value
}

class ElectbunStorage implements StorageRuntime {
  private readonly invoke: (channel: string, payload?: unknown) => Promise<unknown>

  constructor(invoke: (channel: string, payload?: unknown) => Promise<unknown>) {
    this.invoke = invoke
  }

  async get(key: string): Promise<string | null> {
    return (await this.invoke("storage.get", { key })) as string | null
  }

  async set(key: string, value: string): Promise<void> {
    await this.invoke("storage.set", { key, value })
  }

  async delete(key: string): Promise<void> {
    await this.invoke("storage.delete", { key })
  }

  async keys(prefix: string): Promise<string[]> {
    return (await this.invoke("storage.keys", { prefix })) as string[]
  }
}

class ElectbunFS implements FileSystemRuntime {
  private readonly invoke: (channel: string, payload?: unknown) => Promise<unknown>

  constructor(invoke: (channel: string, payload?: unknown) => Promise<unknown>) {
    this.invoke = invoke
  }

  async exists(path: string): Promise<boolean> {
    return (await this.invoke("fs.exists", { path })) as boolean
  }

  async listDir(dirPath: string): Promise<FsEntry[]> {
    return (await this.invoke("fs.listDir", { path: dirPath })) as FsEntry[]
  }

  async readFileText(path: string): Promise<string> {
    return (await this.invoke("fs.readFileText", { path })) as string
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    return decodeBytes(await this.invoke("fs.readFileBytes", { path }))
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    await this.invoke("fs.writeFile", {
      path,
      content: typeof content === "string" ? content : encodeBytes(content),
    })
  }

  async remove(path: string, opts?: { permanent?: boolean }): Promise<void> {
    await this.invoke("fs.remove", { path, permanent: opts?.permanent })
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.invoke("fs.rename", { oldPath, newPath })
  }

  async stat(path: string): Promise<FsStat> {
    return (await this.invoke("fs.stat", { path })) as FsStat
  }
}

class ElectbunSubprocess implements SubprocessRuntime {
  private readonly invoke: (channel: string, payload?: unknown) => Promise<unknown>

  constructor(invoke: (channel: string, payload?: unknown) => Promise<unknown>) {
    this.invoke = invoke
  }

  async spawn(
    cmd: string,
    args: string[],
    opts: SubprocessSpawnOpts,
    handlers?: { onStdout?: (chunk: string) => void; onStderr?: (chunk: string) => void },
  ): Promise<SubprocessResult> {
    const result = await this.invoke("subprocess.spawn", {
      cmd,
      args,
      cwd: opts.cwd,
      env: opts.env,
      stdin: opts.stdin,
    })
    const pid = (result as { pid?: number }).pid ?? 0
    const waited = (await this.invoke("subprocess.wait", { pid })) as SubprocessResult
    if (waited.stdout) handlers?.onStdout?.(waited.stdout)
    if (waited.stderr) handlers?.onStderr?.(waited.stderr)
    return waited
  }

  async kill(pid: number): Promise<void> {
    await this.invoke("subprocess.kill", { pid })
  }
}

class ElectbunEventBus implements EventBusRuntime {
  private readonly localSubs = new Map<string, Set<(event: ProgressEvent) => void>>()
  private readonly invoke: (channel: string, payload?: unknown) => Promise<unknown>

  constructor(invoke: (channel: string, payload?: unknown) => Promise<unknown>) {
    this.invoke = invoke
  }

  async subscribe(topic: string, handler: (event: ProgressEvent) => void): Promise<() => void> {
    if (!this.localSubs.has(topic)) this.localSubs.set(topic, new Set())
    this.localSubs.get(topic)!.add(handler)
    return () => this.localSubs.get(topic)?.delete(handler)
  }

  async publish(topic: string, event: ProgressEvent): Promise<void> {
    await this.invoke("events.publish", { topic, event })
    this.localSubs.get(topic)?.forEach((handler) => handler(event))
  }
}

class ElectbunNodeRunner implements NodeRunnerRuntime {
  private readonly invoke: (channel: string, payload?: unknown) => Promise<unknown>

  constructor(invoke: (channel: string, payload?: unknown) => Promise<unknown>) {
    this.invoke = invoke
  }

  async runNode<TInput = unknown, TData = unknown>(
    nodeId: string,
    input: TInput,
    onEvent?: (event: NodeRunEvent) => void,
  ): Promise<NodeRunResult<TData>> {
    try {
      const response = await this.invoke("node.run", { nodeId, input })
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

export function createElectbunRuntime(): RuntimeInterface {
  const bridge = typeof window !== "undefined" ? window.__ELECTBUN__ : undefined
  const port = bridge?.port ?? 9117

  const invoke = async (channel: string, payload?: unknown): Promise<unknown> => {
    if (bridge?.invoke) return bridge.invoke(channel, payload)
    return httpInvoke(port, channel, payload)
  }

  return {
    kind: "electbun",
    storage: new ElectbunStorage(invoke),
    fs: new ElectbunFS(invoke),
    subprocess: new ElectbunSubprocess(invoke),
    events: new ElectbunEventBus(invoke),
    nodeRunner: new ElectbunNodeRunner(invoke),
  }
}

export function detectElectbun(): boolean {
  return typeof window !== "undefined" && !!window.__ELECTBUN__
}
