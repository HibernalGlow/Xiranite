/**
 * Web runtime adapter — 浏览器/开发环境用。
 *
 * - storage: localStorage
 * - fs:      内存模拟（不真实操作文件系统）
 * - subprocess: 抛 NotSupported（浏览器不能起进程）
 * - events:   同进程 EventEmitter
 *
 * 这套实现保证前端在纯 web 模式下（vite dev / 普通浏览器）也能跑通
 * 端到端示例（EngineV mock 扫描）。切到 Electbun 时，runtime-electbun
 * 自动接管真实 fs。
 */

import type {
  RuntimeInterface,
  StorageRuntime,
  FileSystemRuntime,
  SubprocessRuntime,
  EventBusRuntime,
  FsEntry,
  FsStat,
  SubprocessResult,
} from "../runtime/runtime"
import type { ProgressEvent } from "../shared/types"

// ── Storage: localStorage ────────────────────────────────────────────────────
class WebStorage implements StorageRuntime {
  async get(key: string): Promise<string | null> {
    return localStorage.getItem(key)
  }
  async set(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value)
  }
  async delete(key: string): Promise<void> {
    localStorage.removeItem(key)
  }
  async keys(prefix: string): Promise<string[]> {
    const out: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(prefix)) out.push(k)
    }
    return out
  }
}

// ── FS: 内存模拟 ─────────────────────────────────────────────────────────────
class MemoryFS implements FileSystemRuntime {
  private files = new Map<string, { content: Uint8Array; mtime: number }>()
  private dirs = new Set<string>(["/"])

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path)
  }
  async listDir(dirPath: string): Promise<FsEntry[]> {
    if (!this.dirs.has(dirPath)) return []
    const out: FsEntry[] = []
    // 简化实现：扫所有路径前缀
    for (const [path, f] of this.files.entries()) {
      const dir = path.substring(0, path.lastIndexOf("/"))
      if (dir === dirPath) {
        out.push({
          name: path.substring(path.lastIndexOf("/") + 1),
          path,
          isDirectory: false,
          sizeBytes: f.content.length,
          lastModified: f.mtime,
        })
      }
    }
    for (const d of this.dirs) {
      if (d === dirPath) continue
      const parent = d.substring(0, d.lastIndexOf("/"))
      if (parent === dirPath) {
        out.push({
          name: d.substring(d.lastIndexOf("/") + 1),
          path: d,
          isDirectory: true,
          sizeBytes: 0,
          lastModified: Date.now(),
        })
      }
    }
    return out
  }
  async readFileText(path: string): Promise<string> {
    const f = this.files.get(path)
    return f ? new TextDecoder().decode(f.content) : ""
  }
  async readFileBytes(path: string): Promise<Uint8Array> {
    return this.files.get(path)?.content ?? new Uint8Array(0)
  }
  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content
    this.files.set(path, { content: bytes, mtime: Date.now() })
    // 自动建父目录
    let dir = path
    while ((dir = dir.substring(0, dir.lastIndexOf("/")))) {
      this.dirs.add(dir || "/")
      if (!dir) break
    }
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path)
    this.dirs.delete(path)
  }
  async rename(oldPath: string, newPath: string): Promise<void> {
    const f = this.files.get(oldPath)
    if (f) {
      this.files.set(newPath, f)
      this.files.delete(oldPath)
    }
  }
  async stat(path: string): Promise<FsStat> {
    const f = this.files.get(path)
    if (f) {
      return { path, isDirectory: false, sizeBytes: f.content.length, lastModified: f.mtime }
    }
    return { path, isDirectory: this.dirs.has(path), sizeBytes: 0, lastModified: Date.now() }
  }
}

// ── Subprocess: 不可用 ──────────────────────────────────────────────────────
class NoSubprocess implements SubprocessRuntime {
  async spawn(): Promise<SubprocessResult> {
    throw new Error("SubprocessRuntime not available in web runtime")
  }
}

// ── EventBus: 同进程 ────────────────────────────────────────────────────────
class MemoryEventBus implements EventBusRuntime {
  private subs = new Map<string, Set<(e: ProgressEvent) => void>>()
  async subscribe(topic: string, handler: (e: ProgressEvent) => void): Promise<() => void> {
    if (!this.subs.has(topic)) this.subs.set(topic, new Set())
    this.subs.get(topic)!.add(handler)
    return () => this.subs.get(topic)?.delete(handler)
  }
  async publish(topic: string, event: ProgressEvent): Promise<void> {
    this.subs.get(topic)?.forEach(h => h(event))
  }
}

// ── factory ─────────────────────────────────────────────────────────────────
export function createWebRuntime(): RuntimeInterface {
  return {
    kind: "web",
    storage: new WebStorage(),
    fs: new MemoryFS(),
    subprocess: new NoSubprocess(),
    events: new MemoryEventBus(),
  }
}
