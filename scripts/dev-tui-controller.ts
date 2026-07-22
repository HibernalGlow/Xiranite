import { spawn as spawnNode } from "node:child_process"
import { closeSync, openSync } from "node:fs"
import { appendFile, mkdir, stat } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { RGBA, StyledText, TextAttributes, type TextChunk } from "@opentui/core"
import { Terminal, type IBufferCell } from "@xterm/headless"

import { readDevSession, removeDevSession, writeDevSession } from "./dev-session"
import { waitForFrontendReady } from "./frontend-readiness"

export type DevTarget = "dev" | "dev:desktop"
export type DevPhase = "stopped" | "starting" | "running" | "stopping" | "error"

export interface DevTuiSnapshot {
  target: DevTarget
  label: string
  phase: DevPhase
  pid?: number
  startedAt?: number
  output: StyledText
  message: string
}

export interface DevTuiController {
  snapshot(): DevTuiSnapshot
  subscribe(listener: () => void): () => void
  start(): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
  clearOutput(): void
  resize(columns: number, rows: number): void
  scroll(lines: number): void
}

const OUTPUT_FRAME_MS = 50
const LOG_POLL_MS = 100
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const HOST_LOG_PATH = resolve(repoRoot, ".cache", "xiranite-dev-host.log")

export class ManagedDevTuiController implements DevTuiController {
  readonly #target: DevTarget
  readonly #label: string
  readonly #args: readonly string[]
  readonly #listeners = new Set<() => void>()
  readonly #terminal = new Terminal({ allowProposedApi: true, cols: 80, rows: 16, scrollback: 2_000 })
  #launcherPid: number | null = null
  #operation: Promise<void> = Promise.resolve()
  #publishTimer: ReturnType<typeof setTimeout> | null = null
  #logTimer: ReturnType<typeof setInterval> | null = null
  #logOffset = 0
  #snapshot: DevTuiSnapshot

  constructor(target: DevTarget, label: string, args: readonly string[] = []) {
    this.#target = target
    this.#label = label
    this.#args = args
    this.#snapshot = { target, label, phase: "stopped", output: new StyledText([{ __isChunk: true, text: "暂无输出，请按 S 启动。" }]), message: "就绪" }
    this.#terminal.onWriteParsed(() => this.#scheduleOutputPublish())
  }

  snapshot(): DevTuiSnapshot { return this.#snapshot }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async detectExistingSession(): Promise<void> {
    const session = await readDevSession()
    if (!session) return

    if (!(await isProcessAlive(session.supervisorPid))) {
      await removeDevSession(session.supervisorPid)
      this.#writeControl("\u001b[33m[开发控制台] 发现已失效的会话记录，已清除。请按 S 重新启动。\u001b[0m\r\n")
      this.#patch({ phase: "stopped", pid: undefined, startedAt: undefined, message: "就绪" })
      return
    }

    this.#startLogTail()
    this.#writeControl(`\u001b[33m[开发控制台] 已发现${sessionLabel(session.script)}（进程号 ${session.supervisorPid}）。\u001b[0m\r\n`)
    if (session.frontendUrl) {
      this.#writeControl(`\u001b[36m[开发控制台]\u001b[0m 前端地址 ${session.frontendUrl}\r\n`)
      const reachable = await isFrontendReachable(session.frontendUrl)
      if (!reachable) {
        this.#writeControl("\u001b[31m[开发控制台] 前端端口当前不可访问。请按 R 重启宿主。\u001b[0m\r\n")
        this.#patch({
          phase: "error",
          pid: session.supervisorPid,
          startedAt: session.startedAt,
          message: `前端不可达 · ${session.frontendUrl}`,
        })
        return
      }
      this.#writeControl(`\u001b[32m[开发控制台] 前端可访问\u001b[0m ${session.frontendUrl}\r\n`)
    }

    this.#patch({
      phase: "running",
      pid: session.supervisorPid,
      startedAt: session.startedAt,
      message: session.frontendUrl
        ? `已连接${sessionLabel(session.script)} · ${session.frontendUrl}`
        : `已连接${sessionLabel(session.script)}`,
    })
  }

  start(): Promise<void> { return this.#enqueue(() => this.#start()) }
  stop(): Promise<void> { return this.#enqueue(() => this.#stop()) }
  restart(): Promise<void> { return this.#enqueue(async () => { await this.#stop(); await this.#start() }) }

  clearOutput(): void {
    this.#terminal.clear()
    this.#publishOutput()
  }

  resize(columns: number, rows: number): void {
    const cols = Math.max(20, Math.floor(columns))
    const nextRows = Math.max(4, Math.floor(rows))
    if (cols === this.#terminal.cols && nextRows === this.#terminal.rows) return
    this.#terminal.resize(cols, nextRows)
    this.#publishOutput()
  }

  scroll(lines: number): void {
    this.#terminal.scrollLines(lines)
    this.#publishOutput()
  }

  #enqueue(action: () => Promise<void>): Promise<void> {
    const next = this.#operation.then(action, action)
    this.#operation = next.catch(() => undefined)
    return next
  }

  async #start(): Promise<void> {
    if (this.#snapshot.phase === "starting") return

    // Recover from stale "running" so S can start again after a dead host.
    if (this.#snapshot.phase === "running") {
      const session = await readDevSession()
      if (session && await isProcessAlive(session.supervisorPid)) {
        if (session.frontendUrl && await isFrontendReachable(session.frontendUrl)) {
          this.#writeControl("\u001b[33m[开发控制台] 宿主已在运行。若网页异常请按 R 重启。\u001b[0m\r\n")
          return
        }
        this.#writeControl("\u001b[33m[开发控制台] 宿主进程在但前端不可达，改为重启。\u001b[0m\r\n")
        await this.#stop()
      } else {
        if (session) await removeDevSession(session.supervisorPid)
        this.#patch({ phase: "stopped", pid: undefined, startedAt: undefined })
      }
    }

    const startedAt = Date.now()
    this.#patch({ phase: "starting", startedAt, pid: undefined, message: `正在启动${this.#label}` })
    this.#writeControl(`\r\n\u001b[36m[开发控制台]\u001b[0m 正在启动${this.#label}（独立进程，与 xr 相同）\r\n`)

    await mkdir(dirname(HOST_LOG_PATH), { recursive: true })
    await appendFile(
      HOST_LOG_PATH,
      `\n\n===== ${new Date().toISOString()} start ${this.#target} =====\n`,
      "utf8",
    )
    try {
      this.#logOffset = (await stat(HOST_LOG_PATH)).size
    } catch {
      this.#logOffset = 0
    }

    // Detached host: same launch as `xr` / `bun run dev`, not a child of the
    // OpenTUI process tree. Piped/PTY children under the TUI previously left
    // Vite logging "ready" while the document port stayed dead on Windows.
    const logFd = openSync(HOST_LOG_PATH, "a")
    let launcherPid: number
    try {
      const child = spawnNode(process.execPath, ["run", this.#target, ...this.#args], {
        cwd: process.cwd(),
        env: process.env,
        detached: true,
        stdio: ["ignore", logFd, logFd],
        windowsHide: true,
        shell: false,
      })
      if (child.pid === undefined) throw new Error("未能启动开发宿主进程。")
      launcherPid = child.pid
      child.unref()
    } finally {
      closeSync(logFd)
    }

    this.#launcherPid = launcherPid
    this.#startLogTail()

    // Temporary session so stop-dev can kill the launcher during generate/build.
    await writeDevSession({
      supervisorPid: launcherPid,
      childPids: [],
      script: `dev-ui:${this.#target}`,
      startedAt,
    })
    this.#patch({ pid: launcherPid, message: `正在构建并启动${this.#label}` })
    void this.#awaitHostReady(launcherPid, startedAt)
  }

  async #awaitHostReady(launcherPid: number, startedAt: number): Promise<void> {
    for (let attempt = 0; attempt < 360; attempt += 1) {
      if (this.#snapshot.phase === "stopping" || this.#snapshot.phase === "stopped") return

      const session = await readDevSession()
      if (session && session.startedAt >= startedAt && !session.script.startsWith("dev-ui:")) {
        await removeDevSession(launcherPid)
        const frontendUrl = session.frontendUrl
        this.#patch({
          phase: "running",
          pid: session.supervisorPid,
          startedAt: session.startedAt,
          message: frontendUrl ? `${this.#label}启动中 · ${frontendUrl}` : `${this.#label}启动中`,
        })
        if (!frontendUrl) {
          this.#writeControl("\u001b[33m[开发控制台] 宿主已启动，但未记录前端地址。\u001b[0m\r\n")
          return
        }

        this.#writeControl(`\r\n\u001b[36m[开发控制台]\u001b[0m 前端地址 ${frontendUrl}\r\n`)
        this.#writeControl("\u001b[36m[开发控制台]\u001b[0m 正在探测文档服务是否可打开…\r\n")
        try {
          // listen profile = index.html is servable. Full shell/module graph still
          // compiles on first browser visit; waiting for it here only delays open.
          await waitForFrontendReady(frontendUrl, {
            profile: "listen",
            attempts: 300,
            delayMs: 100,
            stabilityDelayMs: 150,
          })
          if (this.#snapshot.phase === "stopping" || this.#snapshot.phase === "stopped") return
          this.#writeControl(`\u001b[32m[开发控制台] 前端已可打开\u001b[0m ${frontendUrl}\r\n`)
          this.#writeControl("\u001b[32m[开发控制台] 请打开上述地址；首屏模块会在浏览器里继续按需编译。\u001b[0m\r\n")
          this.#patch({ message: `${this.#label}可打开 · ${frontendUrl}` })
        } catch (error) {
          if (this.#snapshot.phase === "stopping" || this.#snapshot.phase === "stopped") return
          this.#writeControl(`\u001b[31m[开发控制台] 前端未就绪\u001b[0m ${error instanceof Error ? error.message : String(error)}\r\n`)
          this.#writeControl("\u001b[33m[开发控制台] 日志看起来正常时，仍可能是端口未真正监听；请按 R 重启。\u001b[0m\r\n")
          this.#patch({ phase: "error", message: `前端未就绪 · ${frontendUrl}` })
        }
        return
      }

      if (!(await isProcessAlive(launcherPid)) && this.#launcherPid === launcherPid) {
        // Launcher may exit after handing off on some shells; keep waiting for session.
      }

      await Bun.sleep(250)
    }

    this.#writeControl("\r\n\u001b[33m[开发控制台] 等待开发宿主超时；请查看日志输出或按 R 重试。\u001b[0m\r\n")
    this.#patch({ phase: "error", message: "启动超时" })
  }

  async #stop(): Promise<void> {
    const session = await readDevSession()
    if (!session && this.#launcherPid === null && this.#snapshot.phase === "stopped") {
      this.#patch({ phase: "stopped", pid: undefined, message: "已经停止" })
      return
    }

    this.#patch({ phase: "stopping", message: `正在停止${this.#label}` })
    this.#writeControl("\r\n\u001b[36m[开发控制台]\u001b[0m 正在请求安全退出\r\n")

    const stop = Bun.spawn([process.execPath, "scripts/stop-dev.ts"], { stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr] = await Promise.all([
      new Response(stop.stdout).text(),
      new Response(stop.stderr).text(),
      stop.exited,
    ])
    if (stdout) this.#terminal.write(stdout.replace(/\n/g, "\r\n"))
    if (stderr) this.#terminal.write(stderr.replace(/\n/g, "\r\n"))

    if (this.#launcherPid !== null && await isProcessAlive(this.#launcherPid)) {
      await terminateProcessTree(this.#launcherPid)
    }
    this.#launcherPid = null
    this.#stopLogTail()
    if (session) await removeDevSession(session.supervisorPid)
    this.#patch({ phase: "stopped", pid: undefined, startedAt: undefined, message: `${this.#label}已停止` })
  }

  #startLogTail(): void {
    if (this.#logTimer) return
    this.#logTimer = setInterval(() => { void this.#pollLog() }, LOG_POLL_MS)
    this.#logTimer.unref?.()
  }

  #stopLogTail(): void {
    if (!this.#logTimer) return
    clearInterval(this.#logTimer)
    this.#logTimer = null
  }

  async #pollLog(): Promise<void> {
    try {
      const size = (await stat(HOST_LOG_PATH)).size
      if (size < this.#logOffset) this.#logOffset = 0
      if (size === this.#logOffset) return
      const chunk = await Bun.file(HOST_LOG_PATH).slice(this.#logOffset, size).text()
      this.#logOffset = size
      if (chunk) this.#terminal.write(chunk.replace(/\n/g, "\r\n"))
    } catch {
      // Log file may not exist yet.
    }
  }

  #writeControl(text: string): void { this.#terminal.write(text) }

  #scheduleOutputPublish(): void {
    if (this.#publishTimer) return
    this.#publishTimer = setTimeout(() => {
      this.#publishTimer = null
      this.#publishOutput()
    }, OUTPUT_FRAME_MS)
  }

  #publishOutput(): void { this.#patch({ output: terminalViewportToStyledText(this.#terminal) }) }

  #patch(patch: Partial<DevTuiSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of this.#listeners) listener()
  }
}

export function terminalViewportToStyledText(terminal: Terminal): StyledText {
  const buffer = terminal.buffer.active
  const chunks: TextChunk[] = []
  const reusableCell = buffer.getNullCell()
  for (let row = 0; row < terminal.rows; row += 1) {
    const line = buffer.getLine(buffer.viewportY + row)
    if (!line) {
      chunks.push(textChunk("\n"))
      continue
    }
    const rowChunks: TextChunk[] = []
    let previousStyleKey: string | undefined
    for (let column = 0; column < terminal.cols; column += 1) {
      const cell = line.getCell(column, reusableCell)
      if (!cell || cell.getWidth() === 0) continue
      const text = cell.getChars() || " "
      const attributes = cellAttributes(cell)
      const styleKey = `${cell.getFgColorMode()}:${cell.getFgColor()}:${cell.getBgColorMode()}:${cell.getBgColor()}:${attributes}`
      const previous = rowChunks.at(-1)
      if (previous && previousStyleKey === styleKey) previous.text += text
      else {
        rowChunks.push({ __isChunk: true, text, fg: cellColor(cell, "fg"), bg: cellColor(cell, "bg"), attributes })
        previousStyleKey = styleKey
      }
    }
    trimTrailingSpaces(rowChunks)
    chunks.push(...rowChunks, textChunk(row === terminal.rows - 1 ? "" : "\n"))
  }
  return new StyledText(chunks)
}

async function isFrontendReachable(frontendUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/", frontendUrl), { method: "HEAD" })
    await response.body?.cancel()
    return response.ok
  } catch {
    return false
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function terminateProcessTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    const taskkill = Bun.spawn(["taskkill", "/PID", String(pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
    })
    await taskkill.exited
    return
  }
  try { process.kill(pid, "SIGTERM") } catch { /* already gone */ }
}

function cellAttributes(cell: IBufferCell): number {
  return (cell.isBold() ? TextAttributes.BOLD : 0)
    | (cell.isDim() ? TextAttributes.DIM : 0)
    | (cell.isItalic() ? TextAttributes.ITALIC : 0)
    | (cell.isUnderline() ? TextAttributes.UNDERLINE : 0)
    | (cell.isBlink() ? TextAttributes.BLINK : 0)
    | (cell.isInverse() ? TextAttributes.INVERSE : 0)
    | (cell.isInvisible() ? TextAttributes.HIDDEN : 0)
    | (cell.isStrikethrough() ? TextAttributes.STRIKETHROUGH : 0)
}

function cellColor(cell: IBufferCell, channel: "fg" | "bg"): RGBA | undefined {
  const isDefault = channel === "fg" ? cell.isFgDefault() : cell.isBgDefault()
  if (isDefault) return undefined
  const value = channel === "fg" ? cell.getFgColor() : cell.getBgColor()
  const isRgb = channel === "fg" ? cell.isFgRGB() : cell.isBgRGB()
  if (isRgb) return RGBA.fromInts((value >> 16) & 255, (value >> 8) & 255, value & 255)
  return RGBA.fromIndex(value)
}

function trimTrailingSpaces(chunks: TextChunk[]): void {
  while (chunks.length) {
    const last = chunks.at(-1)!
    const trimmed = last.text.replace(/ +$/, "")
    if (trimmed) { last.text = trimmed; return }
    chunks.pop()
  }
}

function textChunk(text: string): TextChunk { return { __isChunk: true, text } }

function sessionLabel(script: string): string {
  if (script.includes("desktop")) return "桌面开发宿主"
  return "浏览器开发宿主"
}
