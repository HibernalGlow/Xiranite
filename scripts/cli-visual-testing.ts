import { mkdir, rm, stat, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"
import serializeAddonModule from "@xterm/addon-serialize"
import xtermHeadlessModule from "@xterm/headless"
import { spawn as spawnPty } from "node-pty"

export interface CliVisualCaptureOptions {
  nodeId: string
  cliPath: string
  args?: string[]
  artifactName: string
  waitForText: string | RegExp | ((ansi: string) => boolean)
  cwd?: string
  columns?: number
  rows?: number
  timeoutMs?: number
  viewport?: {
    width: number
    height: number
  }
  closeInput?: string
}

export interface CliVisualCapture {
  ansi: string
  html: string
  plainText: string
  ansiPath: string
  htmlPath: string
  pngPath: string
}

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url))
const VISUAL_LOCK_DIR = resolve(REPO_ROOT, "artifacts", ".locks", "cli-visual")
const VISUAL_LOCK_STALE_MS = 120_000
const DEFAULT_COLUMNS = 100
const DEFAULT_ROWS = 24
const DEFAULT_VIEWPORT = { width: 1180, height: 420 }
const { SerializeAddon } = serializeAddonModule as typeof import("@xterm/addon-serialize")
const { Terminal } = xtermHeadlessModule as typeof import("@xterm/headless")

export async function captureCliVisual(options: CliVisualCaptureOptions): Promise<CliVisualCapture> {
  const columns = options.columns ?? DEFAULT_COLUMNS
  const rows = options.rows ?? DEFAULT_ROWS
  const viewport = options.viewport ?? DEFAULT_VIEWPORT
  const ansi = await captureCliAnsi({
    cliPath: options.cliPath,
    args: options.args ?? [],
    cwd: options.cwd ?? REPO_ROOT,
    columns,
    rows,
    timeoutMs: options.timeoutMs ?? 5_000,
    waitForText: options.waitForText,
    closeInput: options.closeInput ?? "\u0003",
  })
  const html = await renderTerminalHtml(ansi, { columns, rows })
  const artifactRoot = resolve(REPO_ROOT, "artifacts", "cli", options.nodeId)
  const ansiPath = resolve(artifactRoot, `${options.artifactName}.ansi`)
  const htmlPath = resolve(artifactRoot, `${options.artifactName}.html`)
  const pngPath = resolve(artifactRoot, `${options.artifactName}.png`)

  await writeArtifact(ansiPath, ansi)
  await writeArtifact(htmlPath, html)
  await screenshotHtml(html, pngPath, viewport)

  return {
    ansi,
    html,
    plainText: plainTerminalText(ansi),
    ansiPath,
    htmlPath,
    pngPath,
  }
}

export function plainTerminalText(ansi: string): string {
  return ansi
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "")
}

export async function expectCliVisualArtifacts(capture: CliVisualCapture, minPngBytes = 8_000): Promise<void> {
  const ansi = await stat(capture.ansiPath)
  const html = await stat(capture.htmlPath)
  const png = await stat(capture.pngPath)
  if (ansi.size <= 100) throw new Error(`ANSI artifact is too small: ${capture.ansiPath}`)
  if (html.size <= 100) throw new Error(`HTML artifact is too small: ${capture.htmlPath}`)
  if (png.size <= minPngBytes) throw new Error(`PNG artifact is too small: ${capture.pngPath}`)
}

async function captureCliAnsi(options: {
  cliPath: string
  args: string[]
  cwd: string
  columns: number
  rows: number
  timeoutMs: number
  waitForText: CliVisualCaptureOptions["waitForText"]
  closeInput: string
}): Promise<string> {
  let ansi = ""
  let exited = false
  const env = {
    ...process.env,
    FORCE_COLOR: "1",
    XIRANITE_FORCE_COLOR: "1",
    XIRANITE_CLI_COLUMNS: String(options.columns),
  }
  delete env.NO_COLOR

  const terminal = spawnPty(bunExecutable(), [options.cliPath, ...options.args], {
    cols: options.columns,
    rows: options.rows,
    cwd: options.cwd,
    env,
  })

  terminal.onData((data) => {
    ansi += data
  })
  terminal.onExit(() => {
    exited = true
  })

  try {
    await waitForOutput(() => matchesOutput(ansi, options.waitForText), options.timeoutMs)
    if (!exited && options.closeInput && !safeTerminalWrite(terminal, options.closeInput)) exited = true
    if (!exited) await waitForExit(terminal, options.timeoutMs)
  } finally {
    if (!exited) safeTerminalKill(terminal)
  }

  return ansi
}

async function renderTerminalHtml(ansi: string, options: { columns: number; rows: number }): Promise<string> {
  const terminal = new Terminal({
    allowProposedApi: true,
    cols: options.columns,
    rows: options.rows,
    theme: {
      background: "#101014",
      foreground: "#d7dae0",
      cursor: "#f8fafc",
    },
  })
  const serializer = new SerializeAddon()
  terminal.loadAddon(serializer)
  await new Promise<void>((resolveWrite) => terminal.write(ansi, resolveWrite))
  const serialized = serializer.serializeAsHTML()
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html,
      body {
        margin: 0;
        min-width: 1180px;
        min-height: 420px;
        background: #101014;
      }

      body {
        padding: 18px;
        box-sizing: border-box;
      }

      pre {
        margin: 0;
        white-space: pre;
        overflow: hidden;
      }

      pre,
      pre * {
        background: #101014 !important;
        color: #d7dae0;
        font-family: "Cascadia Mono", "Consolas", "Noto Sans Mono CJK SC", "Microsoft YaHei UI", monospace !important;
        font-size: 13px !important;
        line-height: 1.35 !important;
        letter-spacing: 0 !important;
      }
    </style>
  </head>
  <body>
    <main aria-label="CLI terminal capture">
      ${serialized}
    </main>
  </body>
</html>`
}

async function screenshotHtml(html: string, path: string, viewport: { width: number; height: number }): Promise<void> {
  await withCliVisualLock(async () => {
    await mkdir(dirname(path), { recursive: true })
    let lastError: unknown
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await screenshotHtmlOnce(html, path, viewport)
        return
      } catch (error) {
        lastError = error
        if (attempt < 2) await sleep(250)
      }
    }
    throw lastError
  })
}

async function screenshotHtmlOnce(html: string, path: string, viewport: { width: number; height: number }): Promise<void> {
  const browser = await chromium.launch({ args: ["--disable-gpu"] })
  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
    await page.setContent(html, { waitUntil: "load" })
    await page.screenshot({ path, timeout: 5_000 })
  } finally {
    await browser.close()
  }
}

async function writeArtifact(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, "utf8")
}

async function withCliVisualLock<T>(task: () => Promise<T>): Promise<T> {
  const release = await acquireCliVisualLock()
  try {
    return await task()
  } finally {
    await release()
  }
}

async function acquireCliVisualLock(): Promise<() => Promise<void>> {
  await mkdir(dirname(VISUAL_LOCK_DIR), { recursive: true })

  while (true) {
    try {
      await mkdir(VISUAL_LOCK_DIR)
      await writeFile(resolve(VISUAL_LOCK_DIR, "owner.txt"), `${process.pid}:${Date.now()}`, "utf8")
      return async () => {
        await rm(VISUAL_LOCK_DIR, { recursive: true, force: true })
      }
    } catch (error) {
      if (!isExistingLockError(error)) throw error
      await removeStaleCliVisualLock()
      await sleep(50)
    }
  }
}

async function removeStaleCliVisualLock(): Promise<void> {
  try {
    const info = await stat(VISUAL_LOCK_DIR)
    if (Date.now() - info.mtimeMs > VISUAL_LOCK_STALE_MS) {
      await rm(VISUAL_LOCK_DIR, { recursive: true, force: true })
    }
  } catch {
    // Lock disappeared between mkdir attempts.
  }
}

function isExistingLockError(error: unknown): boolean {
  return (error as { code?: unknown }).code === "EEXIST"
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function bunExecutable(): string {
  const npmExecPath = process.env.npm_execpath
  if (npmExecPath && /bun(?:\.exe)?$/i.test(npmExecPath)) return npmExecPath
  return process.platform === "win32" ? "bun.exe" : "bun"
}

function matchesOutput(ansi: string, matcher: CliVisualCaptureOptions["waitForText"]): boolean {
  if (typeof matcher === "string") return ansi.includes(matcher) || plainTerminalText(ansi).includes(matcher)
  if (matcher instanceof RegExp) {
    matcher.lastIndex = 0
    const rawMatches = matcher.test(ansi)
    matcher.lastIndex = 0
    return rawMatches || matcher.test(plainTerminalText(ansi))
  }
  return matcher(ansi)
}

function safeTerminalWrite(terminal: ReturnType<typeof spawnPty>, input: string): boolean {
  try {
    terminal.write(input)
    return true
  } catch (error) {
    if (isClosedPtyError(error)) return false
    throw error
  }
}

function safeTerminalKill(terminal: ReturnType<typeof spawnPty>): void {
  try {
    terminal.kill()
  } catch (error) {
    if (!isClosedPtyError(error)) throw error
  }
}

function isClosedPtyError(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown }
  const code = typeof candidate?.code === "string" ? candidate.code : ""
  const message = typeof candidate?.message === "string" ? candidate.message : String(error)
  return code === "ERR_SOCKET_CLOSED" || /closed|AttachConsole failed/i.test(message)
}

async function waitForOutput(condition: () => boolean, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for CLI visual output.")
    await new Promise((resolveWait) => setTimeout(resolveWait, 25))
  }
}

async function waitForExit(terminal: ReturnType<typeof spawnPty>, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolveExit) => {
    const timeout = setTimeout(resolveExit, timeoutMs)
    terminal.onExit(() => {
      clearTimeout(timeout)
      resolveExit()
    })
  })
}
