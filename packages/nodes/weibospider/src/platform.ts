import { spawn } from "node:child_process"
import { mkdir, stat } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import type { BrowserCookieResult, WeiboSpiderBrowser, WeiboSpiderPathInfo, WeiboSpiderRuntime } from "./core.js"
import { parseCookieString, validateCookieFields } from "./core.js"

const DEBUG_PORT = 9222
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

export function createNodeWeiboSpiderRuntime(): WeiboSpiderRuntime {
  return {
    pathInfo,
    readText: (path) => Bun.file(path).text(),
    writeText: (path, content) => Bun.write(path, content).then(() => undefined),
    ensureDir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
    fetchText,
    downloadFile,
    getBrowserCookie,
    join,
    dirname,
    basename,
    resolve,
    defaultConfigPath: () => resolve(process.cwd(), "config.json"),
    defaultOutputDir: () => resolve(process.env.OUTPUT_DIR || join(process.cwd(), "weibo")),
    now: () => new Date(),
    random: () => Math.random(),
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  }
}

async function pathInfo(path: string): Promise<WeiboSpiderPathInfo> {
  const resolved = resolve(path)
  try {
    const item = await stat(resolved)
    return {
      path: resolved,
      exists: true,
      isFile: item.isFile(),
      isDirectory: item.isDirectory(),
      size: item.size,
    }
  } catch {
    return { path: resolved, exists: false, isFile: false, isDirectory: false, size: 0 }
  }
}

async function fetchText(url: string, options: { cookie?: string; timeoutMs?: number; noRedirect?: boolean }) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000)
  try {
    const response = await fetch(url, {
      redirect: options.noRedirect ? "manual" : "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...(options.cookie ? { Cookie: options.cookie } : {}),
      },
    })
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })
    return {
      url: response.url || url,
      status: response.status,
      headers,
      text: await response.text(),
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function downloadFile(url: string, targetPath: string, options: { cookie?: string; timeoutMs?: number }): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        ...(options.cookie ? { Cookie: options.cookie } : {}),
      },
    })
    if (!response.ok) throw new Error(`download failed ${response.status}: ${url}`)
    await Bun.write(targetPath, await response.arrayBuffer())
  } finally {
    clearTimeout(timeout)
  }
}

async function getBrowserCookie(browser: WeiboSpiderBrowser): Promise<BrowserCookieResult> {
  if (browser === "firefox") {
    return { success: false, cookie: "", message: "Firefox remote debugging cookie extraction is not implemented." }
  }

  const existing = await readDebuggerCookies()
  if (existing.success) return existing

  const browserPath = await findBrowserPath(browser)
  if (!browserPath) return { success: false, cookie: "", message: `Could not find ${browser}.` }

  const userDataDir = browserUserDataDir(browser)
  if (!userDataDir) return { success: false, cookie: "", message: `Could not resolve ${browser} user data directory.` }

  const child = spawn(browserPath, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--remote-allow-origins=*",
    "--headless=new",
    `--user-data-dir=${userDataDir}`,
    "https://weibo.cn/",
  ], {
    detached: false,
    stdio: "ignore",
    windowsHide: true,
  })

  try {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await delay(250)
      const result = await readDebuggerCookies()
      if (result.success || result.cookie) return result
    }
    return { success: false, cookie: "", message: "Could not connect to the browser remote debugging port. Close the browser or start it with --remote-debugging-port=9222." }
  } finally {
    child.kill()
  }
}

async function readDebuggerCookies(): Promise<BrowserCookieResult> {
  try {
    const targets = await fetchJson<Array<Record<string, unknown>>>(`http://127.0.0.1:${DEBUG_PORT}/json`)
    const target = targets.find((item) => typeof item.webSocketDebuggerUrl === "string") ?? targets[0]
    const wsUrl = typeof target?.webSocketDebuggerUrl === "string" ? target.webSocketDebuggerUrl : ""
    if (!wsUrl) return { success: false, cookie: "", message: "No DevTools target exposes a WebSocket URL." }
    const cookies = await getAllCookies(wsUrl)
    const weiboCookies: Record<string, string> = {}
    for (const cookie of cookies) {
      const domain = String(cookie.domain ?? "")
      const name = String(cookie.name ?? "")
      const value = String(cookie.value ?? "")
      if (!name || !/weibo\.(cn|com)$/i.test(domain.replace(/^\./, ""))) continue
      weiboCookies[name] = value
    }
    const cookie = Object.entries(weiboCookies).map(([key, value]) => `${key}=${value}`).join("; ")
    if (!cookie) return { success: false, cookie: "", message: "No weibo.cn/weibo.com cookies found. Sign in to weibo.cn first." }
    const fields = validateCookieFields(cookie)
    return { success: fields.valid, cookie, message: fields.valid ? "Cookie loaded from browser." : fields.message }
  } catch (error) {
    return { success: false, cookie: "", message: error instanceof Error ? error.message : String(error) }
  }
}

async function getAllCookies(wsUrl: string): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolveCookies, rejectCookies) => {
    const ws = new WebSocket(wsUrl)
    const timer = setTimeout(() => {
      ws.close()
      rejectCookies(new Error("DevTools WebSocket timed out."))
    }, 10000)
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "Network.getAllCookies" }))
    })
    ws.addEventListener("message", (event) => {
      clearTimeout(timer)
      try {
        const payload = JSON.parse(String(event.data)) as { result?: { cookies?: Array<Record<string, unknown>> } }
        resolveCookies(payload.result?.cookies ?? [])
      } catch (error) {
        rejectCookies(error)
      } finally {
        ws.close()
      }
    })
    ws.addEventListener("error", () => {
      clearTimeout(timer)
      rejectCookies(new Error("DevTools WebSocket connection failed."))
    })
  })
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
  return await response.json() as T
}

async function findBrowserPath(browser: WeiboSpiderBrowser): Promise<string | null> {
  const candidates = browser === "edge"
    ? [
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ]
    : [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ]
  for (const candidate of candidates) {
    if ((await pathInfo(candidate)).isFile) return candidate
  }
  return null
}

function browserUserDataDir(browser: WeiboSpiderBrowser): string {
  const localAppData = process.env.LOCALAPPDATA ?? ""
  if (!localAppData) return ""
  if (browser === "edge") return join(localAppData, "Microsoft", "Edge", "User Data")
  return join(localAppData, "Google", "Chrome", "User Data")
}

function delay(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}

export function summarizeCookie(cookie: string): Record<string, boolean> {
  const fields = parseCookieString(cookie)
  return { SUB: Boolean(fields.SUB), MLOGIN: fields.MLOGIN === "1", ALF: Boolean(fields.ALF) }
}
