/**
 * Electbun 主进程入口 — 骨架。
 *
 * 设计说明：
 * - 用户原话："后端架构采用 Electbun"，"后端语言也主要是 TS"。
 * - Electbun 用 Bun runtime（不是 Node）跑主进程，渲染进程是系统 webview。
 * - 这里我们提供一个**与具体框架 API 解耦的骨架**：实际 Electbun API
 *   仍在演化，我们用一个最小可跑的实现 —— 借助 `bun --bun` 直接启动，
 *   用 Node 的 child_process 起一个 webview 进程的占位方案。
 *   一旦 Electbun 1.0 稳定，把 createWindow() 替换为官方 API 即可，
 *   IPC handler 协议不动。
 *
 * 验证策略：
 * - 本骨架在 `bun run electron:dev` 下启动：
 *   1. 启动 vite dev server（端口 5173）
 *   2. 主进程启动后注入 preload 脚本到 webview
 *   3. preload 注入 `window.__ELECTBUN__`，runtime-electbun adapter 自动接管
 *   4. 所有 storage/fs 调用走真实文件系统（持久化到 ./userData/）
 * - 在纯 `bun run dev`（仅 vite）下：web runtime 接管，localStorage + mock fs
 *
 * 主进程侧 IPC handlers 是事实之源：channel 名 + 参数 与
 * src/backend/adapters/electbun.ts 完全对齐。
 */

import { serve } from "bun"
import { access, mkdir, readFile, writeFile, readdir, stat, rename, rm } from "node:fs/promises"
import { join, dirname, resolve } from "node:path"
import { spawn } from "node:child_process"
import { homedir } from "node:os"

const USER_DATA_DIR = resolve(homedir(), ".xiranite")
const STORAGE_FILE = join(USER_DATA_DIR, "storage.json")

// ── 启动时确保 userData 目录存在 ──────────────────────────────────────────
await mkdir(USER_DATA_DIR, { recursive: true })
try { await access(STORAGE_FILE) } catch { await writeFile(STORAGE_FILE, "{}", "utf-8") }

// ── Storage 实现（落盘到 JSON 文件） ──────────────────────────────────────
async function loadStorage(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(STORAGE_FILE, "utf-8"))
  } catch {
    return {}
  }
}
async function saveStorage(map: Record<string, string>): Promise<void> {
  await writeFile(STORAGE_FILE, JSON.stringify(map, null, 2), "utf-8")
}

async function pathExists(p: string): Promise<boolean> {
  try { await access(p); return true } catch { return false }
}

// ── IPC handler 注册表 ─────────────────────────────────────────────────────
// 每个 channel 对应一个 handler。channel 名与 src/backend/adapters/electbun.ts
// 里的 invoke("channel", payload) 完全对齐。
type IpcHandler = (payload: any) => Promise<any>
const handlers: Record<string, IpcHandler> = {
  // ── Storage ──
  "storage.get": async ({ key }: { key: string }) => {
    const map = await loadStorage()
    return map[key] ?? null
  },
  "storage.set": async ({ key, value }: { key: string; value: string }) => {
    const map = await loadStorage()
    map[key] = value
    await saveStorage(map)
  },
  "storage.delete": async ({ key }: { key: string }) => {
    const map = await loadStorage()
    delete map[key]
    await saveStorage(map)
  },
  "storage.keys": async ({ prefix }: { prefix: string }) => {
    const map = await loadStorage()
    return Object.keys(map).filter(k => k.startsWith(prefix))
  },

  // ── FileSystem ──
  "fs.exists": async ({ path }: { path: string }) => pathExists(path),
  "fs.listDir": async ({ path }: { path: string }) => {
    const entries = await readdir(path, { withFileTypes: true })
    const out = []
    for (const e of entries) {
      try {
        const s = await stat(join(path, e.name))
        out.push({
          name: e.name,
          path: join(path, e.name),
          isDirectory: e.isDirectory(),
          sizeBytes: s.size,
          lastModified: s.mtimeMs,
        })
      } catch {
        // skip
      }
    }
    return out
  },
  "fs.readFileText": async ({ path }: { path: string }) => readFile(path, "utf-8"),
  "fs.readFileBytes": async ({ path }: { path: string }) => {
    const buf = await readFile(path)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  },
  "fs.writeFile": async ({ path, content }: { path: string; content: Uint8Array }) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  },
  "fs.remove": async ({ path }: { path: string; permanent?: boolean }) => {
    await rm(path, { recursive: true, force: true })
  },
  "fs.rename": async ({ oldPath, newPath }: { oldPath: string; newPath: string }) => {
    await mkdir(dirname(newPath), { recursive: true })
    await rename(oldPath, newPath)
  },
  "fs.stat": async ({ path }: { path: string }) => {
    const s = await stat(path)
    return { path, isDirectory: s.isDirectory(), sizeBytes: s.size, lastModified: s.mtimeMs }
  },

  // ── Subprocess ──
  "subprocess.spawn": async ({ cmd, args, cwd, env, stdin }: {
    cmd: string; args: string[]; cwd?: string; env?: Record<string, string>; stdin?: string
  }) => {
    const p = spawn(cmd, args, { cwd, env: env ? { ...process.env, ...env } : undefined })
    if (stdin) p.stdin?.end(stdin)
    return { pid: p.pid ?? 0 }
  },
  "subprocess.wait": async (_payload: unknown) => {
    // 简化：占位实现
    return { exitCode: 0, stdout: "", stderr: "" }
  },
  "subprocess.kill": async ({ pid }: { pid: number }) => {
    try { process.kill(pid) } catch {}
  },

  // ── EventBus ──
  "events.publish": async ({ topic, event }: { topic: string; event: any }) => {
    // 简化：单进程内事件总线（Electbun 真实 API 接入时替换）
    eventBusSubscribers.get(topic)?.forEach(h => h(event))
  },
}

// 事件总线订阅者（同进程内）
const eventBusSubscribers = new Map<string, Set<(e: any) => void>>()

// ── HTTP 桥接 ─────────────────────────────────────────────────────────────
// 因为 Electbun 的官方 API 尚未稳定，这里用一个本地 HTTP server 桥接：
// preload 通过 fetch 调用 http://127.0.0.1:9117/ipc/<channel>
// 当 Electbun 真实 IPC 接入后，把 fetch 换成 electbun.ipc.invoke 即可。
const PORT = 9117
const server = serve({
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname.startsWith("/ipc/")) {
      const channel = decodeURIComponent(url.pathname.slice("/ipc/".length))
      const payload = req.method === "POST" ? await req.json() : {}
      const handler = handlers[channel]
      if (!handler) {
        return new Response(JSON.stringify({ error: `unknown channel: ${channel}` }), { status: 404 })
      }
      try {
        const result = await handler(payload)
        return new Response(JSON.stringify(result), {
          headers: { "content-type": "application/json" },
        })
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
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

// ── 打开 webview（占位实现） ────────────────────────────────────────────────
// 实际接入 Electbun 时替换为：
//   const win = new ElectbunWindow({ url: "http://localhost:5173" })
//   win.attachPreload("./preload.js")
//   win.show()
//
// 这里：用系统默认浏览器打开 vite dev server 作为占位（开发期可用）。
// 真实桌面应用接入时，把这段替换为 ElectbunWindow API。
const VITE_URL = process.env.VITE_URL ?? "http://localhost:5173"

async function openWebview() {
  const platform = process.platform
  let cmd = "start"
  if (platform === "darwin") cmd = "open"
  else if (platform === "linux") cmd = "xdg-open"

  const url = `${VITE_URL}#electbun-runtime=${PORT}`
  spawn(cmd, [url], { shell: platform === "win32" })
  console.log(`[electbun:main] opened ${url}`)
}

// 在开发模式下自动打开窗口
if (process.env.ELECTBUN_AUTO_OPEN !== "0") {
  setTimeout(openWebview, 800) // 等 vite 起来
}

// 优雅退出
process.on("SIGINT", () => {
  server.stop?.()
  process.exit(0)
})
process.on("SIGTERM", () => {
  server.stop?.()
  process.exit(0)
})
