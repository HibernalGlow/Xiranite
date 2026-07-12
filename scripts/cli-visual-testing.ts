import { mkdir, rm, stat, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"
import serializeAddonModule from "@xterm/addon-serialize"
import unicode11AddonModule from "@xterm/addon-unicode11"
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
  env?: Record<string, string>
}

export interface CliMouseVisualCaptureOptions extends CliMouseScenarioOptions {
  nodeId: string
  artifactName: string
  viewport?: { width: number; height: number }
}

export interface CliVisualCapture {
  ansi: string
  html: string
  plainText: string
  ansiPath: string
  htmlPath: string
  pngPath: string
}

export interface CliMouseRegion {
  minX?: number
  maxX?: number
  minY?: number
  maxY?: number
}

export interface CliMouseStep {
  clickText: string
  region?: CliMouseRegion
  waitForText?: string
  waitForAbsentText?: string
}

export interface CliMouseScenarioOptions {
  cliPath: string
  args?: string[]
  cwd?: string
  columns?: number
  rows?: number
  timeoutMs?: number
  env?: Record<string, string>
  initialWaitFor: string
  steps: readonly CliMouseStep[]
}

export interface CliMouseScenarioResult {
  ansi: string
  finalScreen: string
  clicks: readonly { text: string; x: number; y: number }[]
}

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url))
const VISUAL_LOCK_DIR = resolve(REPO_ROOT, "artifacts", ".locks", "cli-visual")
const VISUAL_LOCK_STALE_MS = 120_000
const DEFAULT_COLUMNS = 100
const DEFAULT_ROWS = 24
const DEFAULT_VIEWPORT = { width: 1180, height: 420 }
const { SerializeAddon } = serializeAddonModule as typeof import("@xterm/addon-serialize")
const { Unicode11Addon } = unicode11AddonModule as typeof import("@xterm/addon-unicode11")
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
    env: options.env,
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

export async function captureCliMouseVisual(options: CliMouseVisualCaptureOptions): Promise<CliVisualCapture> {
  const columns = options.columns ?? DEFAULT_COLUMNS
  const rows = options.rows ?? DEFAULT_ROWS
  const result = await runCliMouseScenario(options)
  const html = await renderTerminalHtml(result.ansi, { columns, rows })
  const artifactRoot = resolve(REPO_ROOT, "artifacts", "cli", options.nodeId)
  const ansiPath = resolve(artifactRoot, `${options.artifactName}.ansi`)
  const htmlPath = resolve(artifactRoot, `${options.artifactName}.html`)
  const pngPath = resolve(artifactRoot, `${options.artifactName}.png`)
  await writeArtifact(ansiPath, result.ansi)
  await writeArtifact(htmlPath, html)
  await screenshotHtml(html, pngPath, options.viewport ?? DEFAULT_VIEWPORT)
  return { ansi: result.ansi, html, plainText: plainTerminalText(result.ansi), ansiPath, htmlPath, pngPath }
}

/**
 * Drives a real PTY through SGR mouse events. Text is located from xterm's
 * active screen buffer, so tests remain independent of pixel coordinates and
 * do not require a person to click the terminal.
 */
export async function runCliMouseScenario(options: CliMouseScenarioOptions): Promise<CliMouseScenarioResult> {
  const columns = options.columns ?? DEFAULT_COLUMNS
  const rows = options.rows ?? DEFAULT_ROWS
  const timeoutMs = options.timeoutMs ?? 5_000
  const screen = new Terminal({ allowProposedApi: true, cols: columns, rows })
  screen.loadAddon(new Unicode11Addon())
  screen.unicode.activeVersion = "11"
  let ansi = ""
  let exited = false
  let finalScreen = ""
  let visualAnsi = ""
  const clicks: { text: string; x: number; y: number }[] = []
  const env = {
    ...process.env,
    ...options.env,
    FORCE_COLOR: "1",
    XIRANITE_FORCE_COLOR: "1",
    XIRANITE_CLI_COLUMNS: String(columns),
  }
  delete env.NO_COLOR
  const pty = spawnPty(bunExecutable(), [options.cliPath, ...(options.args ?? [])], {
    cols: columns,
    rows,
    cwd: options.cwd ?? REPO_ROOT,
    env,
  })
  pty.onData((data) => {
    ansi += data
    screen.write(data)
  })
  pty.onExit(() => {
    exited = true
  })

  try {
    await waitForOutput(() => terminalScreenText(screen).includes(options.initialWaitFor), timeoutMs)
    await waitForOutput(() => ansi.includes("\u001b[?1006h"), timeoutMs)
    await waitForOutputStability(() => ansi, 75, timeoutMs)

    for (const step of options.steps) {
      const point = findTerminalText(screen, step.clickText, step.region)
      if (!point) {
        throw new Error(`Could not find clickable text ${JSON.stringify(step.clickText)} in terminal screen:\n${terminalScreenText(screen)}`)
      }
      clicks.push({ text: step.clickText, x: point.x, y: point.y })
      safeTerminalWrite(pty, sgrMouseClick(point.x + 1, point.y + 1))
      try {
        if (step.waitForText) {
          await waitForOutput(() => terminalScreenText(screen).includes(step.waitForText!), timeoutMs)
        }
        if (step.waitForAbsentText) {
          await waitForOutput(() => !terminalScreenText(screen).includes(step.waitForAbsentText!), timeoutMs)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Mouse step ${JSON.stringify(step.clickText)} at ${point.x + 1},${point.y + 1} failed: ${message}\n${terminalScreenText(screen)}`)
      }
      await waitForOutputStability(() => ansi, 50, timeoutMs)
    }

    finalScreen = terminalScreenText(screen)
    visualAnsi = ansi
  } finally {
    if (!exited) safeTerminalWrite(pty, "\u0003")
    try {
      await waitForOutput(() => exited, Math.min(timeoutMs, 2_000))
    } catch {
      // The process is terminated below if it does not honor Ctrl+C.
    }
    if (!exited) safeTerminalKill(pty)
    await waitForOutputStability(() => ansi, 100, 500)
    screen.dispose()
  }
  return { ansi: visualAnsi || ansi, finalScreen, clicks }
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
  env?: Record<string, string>
}): Promise<string> {
  let ansi = ""
  let exited = false
  const env = {
    ...process.env,
    ...options.env,
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
    try {
      await waitForOutput(() => matchesOutput(ansi, options.waitForText), options.timeoutMs)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`CLI visual wait for ${String(options.waitForText)} failed: ${message}\n${plainTerminalText(ansi)}`)
    }
    await waitForOutputStability(() => ansi, 125, options.timeoutMs)
    // Capture the live alternate-screen frame before sending the close input.
    // Returning the post-exit stream would correctly restore the user's main
    // screen, but it would also produce a blank visual artifact.
    const visualAnsi = ansi
    if (!exited && options.closeInput && !safeTerminalWrite(terminal, options.closeInput)) exited = true
    if (!exited) await waitForExit(terminal, options.timeoutMs)
    return visualAnsi
  } finally {
    if (!exited) safeTerminalKill(terminal)
  }
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
  terminal.loadAddon(new Unicode11Addon())
  terminal.unicode.activeVersion = "11"
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
        font-family: "Cascadia Mono", "Consolas", "NSimSun", "Noto Sans Mono CJK SC", monospace !important;
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

function sgrMouseClick(x: number, y: number): string {
  return `\u001b[<0;${x};${y}M\u001b[<0;${x};${y}m`
}

function terminalScreenText(terminal: InstanceType<typeof Terminal>): string {
  const buffer = terminal.buffer.active
  const lines: string[] = []
  for (let row = 0; row < terminal.rows; row += 1) {
    lines.push(buffer.getLine(row)?.translateToString(true) ?? "")
  }
  return lines.join("\n")
}

function findTerminalText(
  terminal: InstanceType<typeof Terminal>,
  needle: string,
  region: CliMouseRegion = {},
): { x: number; y: number } | undefined {
  const minY = Math.max(0, region.minY ?? 0)
  const maxY = Math.min(terminal.rows - 1, region.maxY ?? terminal.rows - 1)
  for (let y = minY; y <= maxY; y += 1) {
    const line = terminal.buffer.active.getLine(y)
    if (!line) continue
    let logical = ""
    const columns: number[] = []
    for (let x = 0; x < terminal.cols; x += 1) {
      const cell = line.getCell(x)
      if (!cell || cell.getWidth() === 0) continue
      const chars = cell.getChars() || " "
      for (const char of chars) {
        logical += char
        columns.push(x)
      }
    }
    let from = 0
    while (from <= logical.length - needle.length) {
      const index = logical.indexOf(needle, from)
      if (index < 0) break
      const startX = columns[index] ?? 0
      const endX = columns[index + needle.length - 1] ?? startX
      const centerX = Math.floor((startX + endX) / 2)
      if (centerX >= (region.minX ?? 0) && centerX <= (region.maxX ?? terminal.cols - 1)) {
        return { x: centerX, y }
      }
      from = index + needle.length
    }
  }
  return undefined
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

async function waitForOutputStability(read: () => string, stableMs: number, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  let previous = read()
  let stableSince = Date.now()
  while (Date.now() - stableSince < stableMs) {
    if (Date.now() - startedAt > timeoutMs) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 25))
    const current = read()
    if (current !== previous) {
      previous = current
      stableSince = Date.now()
    }
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
