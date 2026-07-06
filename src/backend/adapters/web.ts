import type {
  EventBusRuntime,
  FileSystemRuntime,
  FsEntry,
  FsStat,
  MainWindowDragInput,
  NodeRunnerRuntime,
  OpenComponentWindowInput,
  RuntimeInterface,
  StorageRuntime,
  SubprocessResult,
  SubprocessRuntime,
  WindowCapabilities,
  WindowCommandResult,
  WindowFrame,
  WindowRuntime,
} from "../runtime/runtime"
import type { ProgressEvent } from "../shared/types"

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
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(prefix)) out.push(key)
    }
    return out
  }
}

class MemoryFS implements FileSystemRuntime {
  private files = new Map<string, { content: Uint8Array; mtime: number }>()
  private dirs = new Set<string>(["/"])

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path)
  }

  async listDir(dirPath: string): Promise<FsEntry[]> {
    if (!this.dirs.has(dirPath)) return []

    const out: FsEntry[] = []
    for (const [path, file] of this.files.entries()) {
      const dir = path.substring(0, path.lastIndexOf("/"))
      if (dir === dirPath) {
        out.push({
          name: path.substring(path.lastIndexOf("/") + 1),
          path,
          isDirectory: false,
          sizeBytes: file.content.length,
          lastModified: file.mtime,
        })
      }
    }

    for (const dir of this.dirs) {
      if (dir === dirPath) continue
      const parent = dir.substring(0, dir.lastIndexOf("/"))
      if (parent === dirPath) {
        out.push({
          name: dir.substring(dir.lastIndexOf("/") + 1),
          path: dir,
          isDirectory: true,
          sizeBytes: 0,
          lastModified: Date.now(),
        })
      }
    }

    return out
  }

  async readFileText(path: string): Promise<string> {
    const file = this.files.get(path)
    return file ? new TextDecoder().decode(file.content) : ""
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    return this.files.get(path)?.content ?? new Uint8Array(0)
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content
    this.files.set(path, { content: bytes, mtime: Date.now() })

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
    const file = this.files.get(oldPath)
    if (!file) return
    this.files.set(newPath, file)
    this.files.delete(oldPath)
  }

  async stat(path: string): Promise<FsStat> {
    const file = this.files.get(path)
    if (file) {
      return { path, isDirectory: false, sizeBytes: file.content.length, lastModified: file.mtime }
    }
    return { path, isDirectory: this.dirs.has(path), sizeBytes: 0, lastModified: Date.now() }
  }
}

class NoSubprocess implements SubprocessRuntime {
  async spawn(): Promise<SubprocessResult> {
    throw new Error("SubprocessRuntime is not available in web runtime")
  }
}

class MemoryEventBus implements EventBusRuntime {
  private subs = new Map<string, Set<(event: ProgressEvent) => void>>()

  async subscribe(topic: string, handler: (event: ProgressEvent) => void): Promise<() => void> {
    if (!this.subs.has(topic)) this.subs.set(topic, new Set())
    this.subs.get(topic)!.add(handler)
    return () => this.subs.get(topic)?.delete(handler)
  }

  async publish(topic: string, event: ProgressEvent): Promise<void> {
    this.subs.get(topic)?.forEach((handler) => handler(event))
  }
}

class WebNodeRunner implements NodeRunnerRuntime {
  async runNode<TInput = unknown, TData = unknown>(
    nodeId: string,
    _input: TInput,
  ): Promise<import("@xiranite/contract").NodeRunResult<TData>> {
    return {
      success: false,
      message: `Node runner for "${nodeId}" is not available in web runtime.`,
    }
  }
}

class WebWindowRuntime implements WindowRuntime {
  async getCapabilities(): Promise<WindowCapabilities> {
    return {
      supported: true,
      nativeWindowControls: false,
      frameless: false,
      componentWindows: "browser-popup",
      message: "Browser runtime can open component popups, but cannot control native windows.",
    }
  }

  async controlMain(): Promise<WindowCommandResult> {
    return {
      success: false,
      supported: false,
      message: "Native main-window controls are not available in web runtime.",
    }
  }

  async restoreMainForDrag(_input: MainWindowDragInput): Promise<WindowCommandResult> {
    return {
      success: false,
      supported: false,
      message: "Browser runtime cannot restore native windows for title-bar drag.",
    }
  }

  async openComponent(input: OpenComponentWindowInput): Promise<WindowCommandResult> {
    const url = new URL(window.location.href)
    url.searchParams.set("floatingComponent", input.componentId)
    url.searchParams.set("moduleId", input.moduleId)
    url.searchParams.set("windowId", input.componentId)
    if (input.title) url.searchParams.set("title", input.title)

    const popup = window.open(
      url.toString(),
      `xiranite-component-${input.componentId}`,
      `popup,width=${input.width ?? 460},height=${input.height ?? 380}`,
    )

    return popup
      ? {
          success: true,
          supported: true,
          id: input.componentId,
          message: "Opened component in a browser popup.",
        }
      : {
          success: false,
          supported: true,
          message: "Browser blocked the component popup.",
        }
  }

  async focus(id: string): Promise<WindowCommandResult> {
    return {
      success: false,
      supported: false,
      id,
      message: "Browser runtime does not track component popup focus.",
    }
  }

  async close(id: string): Promise<WindowCommandResult> {
    return {
      success: false,
      supported: false,
      id,
      message: "Browser runtime does not track component popup close.",
    }
  }

  async getFrame(): Promise<WindowFrame | null> {
    return null
  }

  async setFrame(_frame: WindowFrame, id?: string): Promise<WindowCommandResult> {
    return {
      success: false,
      supported: false,
      id,
      message: "Browser runtime cannot resize native windows.",
    }
  }
}

export function createWebRuntime(): RuntimeInterface {
  return {
    kind: "web",
    storage: new WebStorage(),
    fs: new MemoryFS(),
    subprocess: new NoSubprocess(),
    events: new MemoryEventBus(),
    nodeRunner: new WebNodeRunner(),
    windows: new WebWindowRuntime(),
  }
}
