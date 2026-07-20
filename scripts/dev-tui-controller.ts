import { RGBA, StyledText, TextAttributes, type TextChunk } from "@opentui/core"
import { Terminal, type IBufferCell } from "@xterm/headless"

import { readDevSession, removeDevSession, writeDevSession } from "./dev-session"

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

export class ManagedDevTuiController implements DevTuiController {
  readonly #target: DevTarget
  readonly #label: string
  readonly #args: readonly string[]
  readonly #listeners = new Set<() => void>()
  readonly #terminal = new Terminal({ allowProposedApi: true, cols: 80, rows: 16, scrollback: 2_000 })
  #process: ReturnType<typeof Bun.spawn> | null = null
  #operation: Promise<void> = Promise.resolve()
  #publishTimer: ReturnType<typeof setTimeout> | null = null
  #snapshot: DevTuiSnapshot

  constructor(target: DevTarget, label: string, args: readonly string[] = []) {
    this.#target = target
    this.#label = label
    this.#args = args
    this.#snapshot = { target, label, phase: "stopped", output: new StyledText([{ __isChunk: true, text: "No output yet. Press S to start." }]), message: "Ready" }
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
    this.#writeControl(`\u001b[33m[dev-ui] Existing ${session.script} session detected. Live output is available after restart from this UI.\u001b[0m\r\n`)
    this.#patch({ phase: "running", pid: session.supervisorPid, startedAt: session.startedAt, message: `Attached to ${session.script}` })
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
    this.#process?.terminal?.resize(cols, nextRows)
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
    if (this.#snapshot.phase === "running" || this.#snapshot.phase === "starting") return
    const startedAt = Date.now()
    this.#patch({ phase: "starting", startedAt, pid: undefined, message: `Starting ${this.#label}` })
    this.#writeControl(`\r\n\u001b[36m[dev-ui]\u001b[0m starting bun run ${this.#target}\r\n`)

    const env: Record<string, string | undefined> = { ...Bun.env, FORCE_COLOR: "3", TERM: "xterm-256color" }
    delete env.NO_COLOR
    const child = Bun.spawn([process.execPath, "run", this.#target, ...this.#args], {
      cwd: process.cwd(),
      env,
      terminal: {
        name: "xterm-256color",
        cols: this.#terminal.cols,
        rows: this.#terminal.rows,
        data: (_terminal, data) => this.#terminal.write(data),
      },
    })
    this.#process = child
    void child.exited.then((exitCode) => this.#handleProcessExit(child, exitCode))

    await writeDevSession({ supervisorPid: child.pid, childPids: [], script: `dev-ui:${this.#target}`, startedAt })
    this.#patch({ pid: child.pid, message: `Building and starting ${this.#label}` })
    void this.#awaitSupervisor(child, startedAt)
  }

  async #handleProcessExit(child: ReturnType<typeof Bun.spawn>, exitCode: number): Promise<void> {
    if (this.#process !== child) return
    this.#process = null
    child.terminal?.close()
    const session = await readDevSession()
    if (session?.supervisorPid === child.pid) await removeDevSession()
    if (this.#snapshot.phase !== "stopping") {
      this.#writeControl(`\r\n\u001b[36m[dev-ui]\u001b[0m process exited with code ${exitCode}\r\n`)
      this.#patch({ phase: exitCode === 0 ? "stopped" : "error", pid: undefined, message: `Exited with code ${exitCode}` })
    }
  }

  async #awaitSupervisor(child: ReturnType<typeof Bun.spawn>, startedAt: number): Promise<void> {
    for (let attempt = 0; attempt < 240 && this.#process === child; attempt += 1) {
      await Bun.sleep(250)
      const session = await readDevSession()
      if (session && session.startedAt >= startedAt && !session.script.startsWith("dev-ui:")) {
        this.#patch({ phase: "running", pid: session.supervisorPid, startedAt: session.startedAt, message: `${this.#label} running` })
        return
      }
    }
  }

  async #stop(): Promise<void> {
    const session = await readDevSession()
    if (!session && !this.#process) {
      this.#patch({ phase: "stopped", pid: undefined, message: "Already stopped" })
      return
    }

    this.#patch({ phase: "stopping", message: `Stopping ${this.#label}` })
    this.#writeControl("\r\n\u001b[36m[dev-ui]\u001b[0m requesting safe shutdown\r\n")
    const stop = Bun.spawn([process.execPath, "scripts/stop-dev.ts"], { stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr] = await Promise.all([
      new Response(stop.stdout).text(),
      new Response(stop.stderr).text(),
      stop.exited,
    ])
    if (stdout) this.#terminal.write(stdout.replace(/\n/g, "\r\n"))
    if (stderr) this.#terminal.write(stderr.replace(/\n/g, "\r\n"))

    const child = this.#process
    if (child) {
      await Bun.sleep(250)
      if (this.#process === child) child.kill()
      child.terminal?.close()
    }
    this.#process = null
    this.#patch({ phase: "stopped", pid: undefined, startedAt: undefined, message: `${this.#label} stopped` })
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
