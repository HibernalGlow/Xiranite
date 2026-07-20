import { readDevSession, removeDevSession, writeDevSession } from "./dev-session"

export type DevTarget = "dev" | "dev:desktop"
export type DevPhase = "stopped" | "starting" | "running" | "stopping" | "error"

export interface DevTuiSnapshot {
  target: DevTarget
  label: string
  phase: DevPhase
  pid?: number
  startedAt?: number
  message: string
}

export interface DevTuiController {
  snapshot(): DevTuiSnapshot
  subscribe(listener: () => void): () => void
  start(): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
}

export class ManagedDevTuiController implements DevTuiController {
  readonly #target: DevTarget
  readonly #label: string
  readonly #args: readonly string[]
  readonly #listeners = new Set<() => void>()
  #child: ReturnType<typeof Bun.spawn> | null = null
  #operation: Promise<void> = Promise.resolve()
  #snapshot: DevTuiSnapshot

  constructor(target: DevTarget, label: string, args: readonly string[] = []) {
    this.#target = target
    this.#label = label
    this.#args = args
    this.#snapshot = { target, label, phase: "stopped", message: "Ready" }
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

  #enqueue(action: () => Promise<void>): Promise<void> {
    const next = this.#operation.then(action, action)
    this.#operation = next.catch(() => undefined)
    return next
  }

  async #start(): Promise<void> {
    if (this.#snapshot.phase === "running" || this.#snapshot.phase === "starting") return
    const startedAt = Date.now()
    this.#patch({ phase: "starting", startedAt, pid: undefined, message: `Starting ${this.#label}` })
    process.stdout.write(`\n\u001b[36m[dev-ui]\u001b[0m starting bun run ${this.#target}\n`)

    const env: Record<string, string | undefined> = { ...Bun.env, FORCE_COLOR: "3" }
    delete env.NO_COLOR
    const child = Bun.spawn([process.execPath, "run", this.#target, ...this.#args], {
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
      env,
    })
    this.#child = child
    await writeDevSession({ supervisorPid: child.pid, childPids: [], script: `dev-ui:${this.#target}`, startedAt })
    this.#patch({ pid: child.pid, message: `Building and starting ${this.#label}` })

    void this.#awaitSupervisor(child, startedAt)
    void child.exited.then(async (exitCode) => {
      if (this.#child !== child) return
      this.#child = null
      const session = await readDevSession()
      if (session?.supervisorPid === child.pid) await removeDevSession()
      if (this.#snapshot.phase !== "stopping") {
        process.stdout.write(`\n\u001b[36m[dev-ui]\u001b[0m process exited with code ${exitCode}\n`)
        this.#patch({ phase: exitCode === 0 ? "stopped" : "error", pid: undefined, message: `Exited with code ${exitCode}` })
      }
    })
  }

  async #awaitSupervisor(child: ReturnType<typeof Bun.spawn>, startedAt: number): Promise<void> {
    for (let attempt = 0; attempt < 240 && this.#child === child; attempt += 1) {
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
    if (!session && !this.#child) {
      this.#patch({ phase: "stopped", pid: undefined, message: "Already stopped" })
      return
    }

    this.#patch({ phase: "stopping", message: `Stopping ${this.#label}` })
    process.stdout.write("\n\u001b[36m[dev-ui]\u001b[0m requesting safe shutdown\n")
    const stop = Bun.spawn([process.execPath, "scripts/stop-dev.ts"], { stdout: "inherit", stderr: "inherit" })
    await stop.exited

    const child = this.#child
    if (child) await Promise.race([child.exited, Bun.sleep(1_000)])
    if (child?.exitCode === null) child.kill()
    this.#child = null
    this.#patch({ phase: "stopped", pid: undefined, startedAt: undefined, message: `${this.#label} stopped` })
  }

  #patch(patch: Partial<DevTuiSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of this.#listeners) listener()
  }
}
