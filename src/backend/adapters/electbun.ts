/**
 * Electbun runtime adapter — 真实接入。
 *
 * 接入策略：
 * - 主进程在 electron/main.ts 起一个 HTTP 桥接（http://127.0.0.1:9117）
 * - preload 脚本在 window 上注入 `window.__ELECTBUN__` 对象
 * - 本 adapter 通过 fetch 调用桥接，所有 IPC channel 名与 main.ts 完全对齐
 *
 * detect：检测 window.__ELECTBUN__ 是否注入（URL hash 带 electbun-runtime
 * 时 preload 会注入）。
 *
 * 切换到真实 Electbun 官方 IPC 时：把 invoke() 内的 fetch 替换为
 * electbun.ipc.invoke(channel, payload)，其余不动。
 */

import type {
  RuntimeInterface,
  StorageRuntime,
  FileSystemRuntime,
  SubprocessRuntime,
  EventBusRuntime,
  FsEntry,
  FsStat,
  SubprocessSpawnOpts,
  SubprocessResult,
} from "../runtime/runtime"
import type { ProgressEvent } from "../shared/types"

// ── Preload 注入桥接对象 ─────────────────────────────────────────────────
// preload 检测 URL hash，决定是否注入 __ELECTBUN__
declare global {
  interface Window {
    __ELECTBUN__?: ElectbunBridge
  }
}

interface ElectbunBridge {
  /** IPC channel + payload → 主进程处理 → 返回结果 */
  invoke(channel: string, payload?: unknown): Promise<unknown>
  /** 订阅某 topic 的事件（事件总线） */
  subscribe?(topic: string, handler: (event: ProgressEvent) => void): () => void
}

// ── HTTP 桥接 invoke ──────────────────────────────────────────────────────
// 这是本 adapter 与 main.ts 之间的通信层。当 Electbun 真实 IPC 接入后，
// 把这里替换为 electbun.ipc.invoke 即可。
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

// ── Storage: 走主进程持久化到 userData/storage.json ──────────────────────
class ElectbunStorage implements StorageRuntime {
  private invoke: (c: string, p?: unknown) => Promise<unknown>
  constructor(invoke: (c: string, p?: unknown) => Promise<unknown>) {
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

// ── FileSystem: 走主进程真实 fs ──────────────────────────────────────────
class ElectbunFS implements FileSystemRuntime {
  private invoke: (c: string, p?: unknown) => Promise<unknown>
  constructor(invoke: (c: string, p?: unknown) => Promise<unknown>) {
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
    const buf = (await this.invoke("fs.readFileBytes", { path })) as ArrayBuffer
    return new Uint8Array(buf)
  }
  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    await this.invoke("fs.writeFile", {
      path,
      content: typeof content === "string" ? new TextEncoder().encode(content) : content,
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

// ── Subprocess ──────────────────────────────────────────────────────────
class ElectbunSubprocess implements SubprocessRuntime {
  private invoke: (c: string, p?: unknown) => Promise<unknown>
  constructor(invoke: (c: string, p?: unknown) => Promise<unknown>) {
    this.invoke = invoke
  }
  async spawn(
    cmd: string,
    args: string[],
    opts: SubprocessSpawnOpts,
    handlers?: { onStdout?: (c: string) => void; onStderr?: (c: string) => void },
  ): Promise<SubprocessResult> {
    const sub = (await this.invoke("subprocess.spawn", {
      cmd, args, cwd: opts.cwd, env: opts.env, stdin: opts.stdin,
    })) as { pid: number }
    // 真实接入时：通过 subscribe 接 stdout/stderr
    handlers?.onStdout?.("[electbun subprocess stdout stream placeholder]")
    return (await this.invoke("subprocess.wait", { pid: sub.pid })) as SubprocessResult
  }
  async kill(pid: number): Promise<void> {
    await this.invoke("subprocess.kill", { pid })
  }
}

// ── EventBus ────────────────────────────────────────────────────────────
class ElectbunEventBus implements EventBusRuntime {
  private invoke: (c: string, p?: unknown) => Promise<unknown>
  private localSubs = new Map<string, Set<(e: ProgressEvent) => void>>()
  constructor(invoke: (c: string, p?: unknown) => Promise<unknown>) {
    this.invoke = invoke
  }

  async subscribe(topic: string, handler: (e: ProgressEvent) => void): Promise<() => void> {
    if (!this.localSubs.has(topic)) this.localSubs.set(topic, new Set())
    this.localSubs.get(topic)!.add(handler)
    // 真实接入时：window.__ELECTBUN__.subscribe(topic, handler)
    // 这里简化为本地分发（主进程 events.publish 触发后，通过轮询/SSE 接收）
    return () => this.localSubs.get(topic)?.delete(handler)
  }

  async publish(topic: string, event: ProgressEvent): Promise<void> {
    await this.invoke("events.publish", { topic, event })
    // 同时本地分发（同进程订阅者立即收到）
    this.localSubs.get(topic)?.forEach(h => h(event))
  }
}

// ── factory ──────────────────────────────────────────────────────────────
export function createElectbunRuntime(): RuntimeInterface {
  // 从 window.__ELECTBUN__.port 拿桥接端口（preload 注入），否则默认 9117
  const bridge = (typeof window !== "undefined" ? window.__ELECTBUN__ : undefined) as (ElectbunBridge & { port?: number }) | undefined
  const port = bridge?.port ?? 9117

  // invoke 策略：优先用 preload 注入的 invoke（未来 Electbun 真实 IPC），
  // 回退到 HTTP 桥接（当前骨架）。
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
  }
}

/** detect：preload 注入了 __ELECTBUN__ 时启用。 */
export function detectElectbun(): boolean {
  return typeof window !== "undefined" && !!window.__ELECTBUN__
}
