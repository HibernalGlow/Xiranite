import { serve } from "bun"
import { spawn } from "node:child_process"
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { runNodeFromMain } from "./nodeRunner.ts"

const USER_DATA_DIR = resolve(homedir(), ".xiranite")
const STORAGE_FILE = join(USER_DATA_DIR, "storage.json")
const PORT = 9117

type IpcHandler = (payload: unknown) => Promise<unknown>

const eventBusSubscribers = new Map<string, Set<(event: unknown) => void>>()
const subprocesses = new Map<number, Promise<{ exitCode: number; stdout: string; stderr: string }>>()
const componentWindows = new Map<string, {
  id: string
  componentId: string
  moduleId: string
  title?: string
  url: string
}>()

await mkdir(USER_DATA_DIR, { recursive: true })
try {
  await access(STORAGE_FILE)
} catch {
  await writeFile(STORAGE_FILE, "{}", "utf-8")
}

async function loadStorage(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(STORAGE_FILE, "utf-8")) as Record<string, string>
  } catch {
    return {}
  }
}

async function saveStorage(map: Record<string, string>): Promise<void> {
  await writeFile(STORAGE_FILE, JSON.stringify(map, null, 2), "utf-8")
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function recordPayload(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" ? payload as Record<string, unknown> : {}
}

function stringValue(payload: Record<string, unknown>, key: string, fallback = ""): string {
  const value = payload[key]
  return typeof value === "string" ? value : fallback
}

function stringArrayValue(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function numberValue(payload: Record<string, unknown>, key: string, fallback: number): number {
  const value = payload[key]
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function envValue(payload: Record<string, unknown>): Record<string, string> | undefined {
  const value = payload.env
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined

  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key] = entry
  }
  return out
}

function decodeFileContent(value: unknown): string | Uint8Array {
  if (typeof value === "string") return value
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value)) return Uint8Array.from(value)
  if (value && typeof value === "object") {
    return Uint8Array.from(Object.values(value as Record<string, number>))
  }
  return new Uint8Array(0)
}

const VITE_URL = process.env.VITE_URL ?? "http://localhost:5173"

function buildAppUrl(params?: Record<string, string>): string {
  const url = new URL(VITE_URL)
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value)
  }
  url.hash = `electbun-runtime=${PORT}`
  return url.toString()
}

function openExternalUrl(url: string): void {
  const platform = process.platform
  if (platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { windowsHide: true })
    return
  }

  const cmd = platform === "darwin" ? "open" : "xdg-open"
  const child = spawn(cmd, [url], { detached: true, stdio: "ignore" })
  child.unref()
}

const handlers: Record<string, IpcHandler> = {
  "storage.get": async (payload) => {
    const key = stringValue(recordPayload(payload), "key")
    const map = await loadStorage()
    return map[key] ?? null
  },
  "storage.set": async (payload) => {
    const body = recordPayload(payload)
    const key = stringValue(body, "key")
    const value = stringValue(body, "value")
    const map = await loadStorage()
    map[key] = value
    await saveStorage(map)
  },
  "storage.delete": async (payload) => {
    const key = stringValue(recordPayload(payload), "key")
    const map = await loadStorage()
    delete map[key]
    await saveStorage(map)
  },
  "storage.keys": async (payload) => {
    const prefix = stringValue(recordPayload(payload), "prefix")
    const map = await loadStorage()
    return Object.keys(map).filter((key) => key.startsWith(prefix))
  },

  "fs.exists": async (payload) => pathExists(stringValue(recordPayload(payload), "path")),
  "fs.listDir": async (payload) => {
    const path = stringValue(recordPayload(payload), "path")
    const entries = await readdir(path, { withFileTypes: true })
    const out = []
    for (const entry of entries) {
      try {
        const entryPath = join(path, entry.name)
        const entryStat = await stat(entryPath)
        out.push({
          name: entry.name,
          path: entryPath,
          isDirectory: entry.isDirectory(),
          sizeBytes: entryStat.size,
          lastModified: entryStat.mtimeMs,
        })
      } catch {
        // Skip entries that disappear during listing.
      }
    }
    return out
  },
  "fs.readFileText": async (payload) => readFile(stringValue(recordPayload(payload), "path"), "utf-8"),
  "fs.readFileBytes": async (payload) => Array.from(await readFile(stringValue(recordPayload(payload), "path"))),
  "fs.writeFile": async (payload) => {
    const body = recordPayload(payload)
    const path = stringValue(body, "path")
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, decodeFileContent(body.content))
  },
  "fs.remove": async (payload) => {
    const path = stringValue(recordPayload(payload), "path")
    await rm(path, { recursive: true, force: true })
  },
  "fs.rename": async (payload) => {
    const body = recordPayload(payload)
    const oldPath = stringValue(body, "oldPath")
    const newPath = stringValue(body, "newPath")
    await mkdir(dirname(newPath), { recursive: true })
    await rename(oldPath, newPath)
  },
  "fs.stat": async (payload) => {
    const path = stringValue(recordPayload(payload), "path")
    const fileStat = await stat(path)
    return {
      path,
      isDirectory: fileStat.isDirectory(),
      sizeBytes: fileStat.size,
      lastModified: fileStat.mtimeMs,
    }
  },

  "subprocess.spawn": async (payload) => {
    const body = recordPayload(payload)
    const cmd = stringValue(body, "cmd")
    const args = stringArrayValue(body, "args")
    const cwd = stringValue(body, "cwd") || undefined
    const stdin = stringValue(body, "stdin") || undefined
    const env = envValue(body)
    const child = spawn(cmd, args, { cwd, env: env ? { ...process.env, ...env } : undefined })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk))
    if (stdin) child.stdin?.end(stdin)

    const pid = child.pid ?? 0
    subprocesses.set(pid, new Promise((resolveWait) => {
      child.on("close", (code) => {
        resolveWait({
          exitCode: code ?? 0,
          stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
          stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        })
      })
    }))
    return { pid }
  },
  "subprocess.wait": async (payload) => {
    const pid = Number(recordPayload(payload).pid ?? 0)
    const result = await subprocesses.get(pid)
    subprocesses.delete(pid)
    return result ?? { exitCode: 0, stdout: "", stderr: "" }
  },
  "subprocess.kill": async (payload) => {
    const pid = Number(recordPayload(payload).pid ?? 0)
    try {
      process.kill(pid)
    } catch {
      // Treat already-exited processes as killed.
    }
  },

  "events.publish": async (payload) => {
    const body = recordPayload(payload)
    const topic = stringValue(body, "topic")
    eventBusSubscribers.get(topic)?.forEach((handler) => handler(body.event))
  },

  "node.run": runNodeFromMain,

  "window.capabilities": async () => ({
    supported: true,
    nativeWindowControls: false,
    frameless: false,
    componentWindows: "browser-fallback",
    message: "Bun IPC bridge is running in browser-fallback mode. Real native controls require an Electrobun window host.",
  }),
  "window.main": async (payload) => {
    const action = stringValue(recordPayload(payload), "action")
    return {
      success: false,
      supported: false,
      message: `Main window action "${action}" is not available in browser-fallback mode.`,
    }
  },
  "window.openComponent": async (payload) => {
    const body = recordPayload(payload)
    const componentId = stringValue(body, "componentId")
    const moduleId = stringValue(body, "moduleId")
    if (!componentId || !moduleId) {
      return { success: false, supported: true, message: "componentId and moduleId are required." }
    }

    const title = stringValue(body, "title") || moduleId
    const id = `component-${Date.now()}-${Math.round(Math.random() * 1000)}`
    const url = buildAppUrl({
      floatingComponent: componentId,
      moduleId,
      title,
      windowId: id,
      width: String(numberValue(body, "width", 460)),
      height: String(numberValue(body, "height", 380)),
    })
    componentWindows.set(id, { id, componentId, moduleId, title, url })
    openExternalUrl(url)
    return {
      success: true,
      supported: true,
      id,
      message: `Opened ${moduleId} component window in browser-fallback mode.`,
    }
  },
  "window.focus": async (payload) => {
    const id = stringValue(recordPayload(payload), "id")
    const record = componentWindows.get(id)
    if (record) openExternalUrl(record.url)
    return record
      ? { success: true, supported: true, id, message: "Re-opened tracked component window URL." }
      : { success: false, supported: false, id, message: "Component window is not tracked." }
  },
  "window.close": async (payload) => {
    const id = stringValue(recordPayload(payload), "id")
    const existed = componentWindows.delete(id)
    return existed
      ? { success: true, supported: false, id, message: "Component window record removed. Browser-fallback mode cannot close external windows." }
      : { success: false, supported: false, id, message: "Component window is not tracked." }
  },
}

const server = serve({
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname.startsWith("/ipc/")) {
      const channel = decodeURIComponent(url.pathname.slice("/ipc/".length))
      const payload = req.method === "POST" ? await req.json() : {}
      const handler = handlers[channel]
      if (!handler) {
        return Response.json({ error: `unknown channel: ${channel}` }, { status: 404 })
      }

      try {
        return Response.json(await handler(payload))
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
      }
    }

    if (url.pathname === "/__electbun_detect__") {
      return new Response("ok")
    }

    return new Response("not found", { status: 404 })
  },
})

console.log(`[electbun:main] IPC bridge listening on http://127.0.0.1:${PORT}/ipc/{channel}`)
console.log(`[electbun:main] userData dir: ${USER_DATA_DIR}`)
console.log(`[electbun:main] storage file: ${STORAGE_FILE}`)

async function openWebview(): Promise<void> {
  const url = buildAppUrl()
  openExternalUrl(url)
  console.log(`[electbun:main] opened ${url}`)
}

if (process.env.ELECTBUN_AUTO_OPEN !== "0") {
  setTimeout(openWebview, 800)
}

process.on("SIGINT", () => {
  server.stop?.()
  process.exit(0)
})

process.on("SIGTERM", () => {
  server.stop?.()
  process.exit(0)
})
