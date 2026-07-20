import { readDevSession, removeDevSession, writeDevSession } from "./dev-session"

export type DevTarget = "dev" | "dev:desktop"
export type DevPhase = "stopped" | "starting" | "running" | "stopping" | "error"

export interface DevTuiSnapshot {
  target: DevTarget
  label: string
  phase: DevPhase
  pid?: number
  startedAt?: number
  lines: readonly string[]
  droppedLines: number
  message: string
}

export interface DevTuiController {
  snapshot(): DevTuiSnapshot
  subscribe(listener: () => void): () => void
  start(): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
  clearLogs(): void
}

const MAX_LOG_LINES = 600
const LOG_FLUSH_MS = 100
const ANSI_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g

export class ManagedDevTuiController implements DevTuiController {
  readonly #target: DevTarget
  readonly #label: string
  readonly #args: readonly string[]
  readonly #listeners = new Set<() => void>()
  #child: ReturnType<typeof Bun.spawn> | null = null
  #operation: Promise<void> = Promise.resolve()
  #pendingLines: string[] = []
  #flushTimer: ReturnType<typeof setTimeout> | null = null
  #snapshot: DevTuiSnapshot

  constructor(target: DevTarget, label: string, args: readonly string[] = []) {
    this.#target = target
    this.#label = label
    this.#args = args
    this.#snapshot = { target, label, phase: "stopped", lines: [], droppedLines: 0, message: "Ready" }
  }

  snapshot(): DevTuiSnapshot { return this.#snapshot }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async detectExistingSession(): Promise<void> {
    const session = await readDevSession()
    if (!session) return
    this.#patch({ phase: "running", pid: session.supervisorPid, startedAt: session.startedAt, message: `Attached to ${session.script}` })
  }

  start(): Promise<void> { return this.#enqueue(() => this.#start()) }
  stop(): Promise<void> { return this.#enqueue(() => this.#stop()) }
  restart(): Promise<void> { return this.#enqueue(async () => { await this.#stop(); await this.#start() }) }

  clearLogs(): void {
    this.#pendingLines = []
    this.#patch({ lines: [], droppedLines: 0 })
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
    this.#append(`[dev-ui] starting bun run ${this.#target}`)

    const child = Bun.spawn([process.execPath, "run", this.#target, ...this.#args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...Bun.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    })
    this.#child = child
    await writeDevSession({ supervisorPid: child.pid, childPids: [], script: `dev-ui:${this.#target}`, startedAt })
    this.#patch({ pid: child.pid, message: `Building and starting ${this.#label}` })

    void this.#readOutput(child.stdout)
    void this.#readOutput(child.stderr)
    void child.exited.then(async (exitCode) => {
      if (this.#child !== child) return
      this.#child = null
      const session = await readDevSession()
      if (session?.supervisorPid === child.pid) await removeDevSession()
      if (this.#snapshot.phase !== "stopping") {
        this.#append(`[dev-ui] process exited with code ${exitCode}`)
        this.#patch({ phase: exitCode === 0 ? "stopped" : "error", pid: undefined, message: `Exited with code ${exitCode}` })
      }
    })
  }

  async #stop(): Promise<void> {
    const session = await readDevSession()
    if (!session && !this.#child) {
      this.#patch({ phase: "stopped", pid: undefined, message: "Already stopped" })
      return
    }

    this.#patch({ phase: "stopping", message: `Stopping ${this.#label}` })
    this.#append("[dev-ui] requesting safe shutdown")
    const stop = Bun.spawn([process.execPath, "scripts/stop-dev.ts"], { stdout: "pipe", stderr: "pipe" })
    await Promise.all([this.#readOutput(stop.stdout), this.#readOutput(stop.stderr), stop.exited])

    const child = this.#child
    if (child) await Promise.race([child.exited, Bun.sleep(1_000)])
    if (child?.exitCode === null) child.kill()
    this.#child = null
    this.#patch({ phase: "stopped", pid: undefined, startedAt: undefined, message: `${this.#label} stopped` })
  }

  async #readOutput(stream: ReadableStream<Uint8Array> | number | undefined): Promise<void> {
    if (!stream || typeof stream === "number") return
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let remainder = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunks = `${remainder}${decoder.decode(value, { stream: true })}`.split(/\r?\n/)
      remainder = chunks.pop() ?? ""
      for (const line of chunks) this.#append(line)
    }
    const tail = `${remainder}${decoder.decode()}`
    if (tail) this.#append(tail)
  }

  #append(rawLine: string): void {
    const line = rawLine.replace(ANSI_PATTERN, "").replace(/\r/g, "").trimEnd()
    if (!line) return
    if (this.#snapshot.phase === "starting" && (line.includes("[xiranite-backend]") || line.includes("[xiranite-frontend]"))) {
      this.#patch({ phase: "running", message: `${this.#label} running` })
    }
    this.#pendingLines.push(line)
    if (this.#flushTimer) return
    this.#flushTimer = setTimeout(() => this.#flushLogs(), LOG_FLUSH_MS)
  }

  #flushLogs(): void {
    this.#flushTimer = null
    if (!this.#pendingLines.length) return
    const combined = [...this.#snapshot.lines, ...this.#pendingLines]
    this.#pendingLines = []
    const dropped = Math.max(0, combined.length - MAX_LOG_LINES)
    this.#patch({ lines: combined.slice(-MAX_LOG_LINES), droppedLines: this.#snapshot.droppedLines + dropped })
  }

  #patch(patch: Partial<DevTuiSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of this.#listeners) listener()
  }
}
