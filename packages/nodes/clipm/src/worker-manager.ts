import type { EnvironmentStatus } from "./generated/contracts.js"
import {
  createClipmMcpConnection,
  type ClipmCallResult,
  type ClipmMcpConnection,
  type ClipmMcpConnectionOptions,
} from "./mcp-client.js"

export interface ClipmWorkerLease {
  readonly owner: string
  readonly pid: number | null
  callTool(name: string, args?: Record<string, unknown>): Promise<ClipmCallResult>
  release(): Promise<void>
}

export interface ClipmWorkerSnapshot {
  state: "stopped" | "starting" | "running" | "stopping" | "disposed"
  leaseCount: number
  owners: string[]
  pid: number | null
}

export interface ClipmWorkerManagerOptions extends ClipmMcpConnectionOptions {
  createConnection?(options: ClipmMcpConnectionOptions): Promise<ClipmMcpConnection>
}

export class ClipmWorkerManager {
  readonly #options: ClipmWorkerManagerOptions
  readonly #leases = new Map<symbol, string>()
  #connection: ClipmMcpConnection | undefined
  #starting: Promise<ClipmMcpConnection> | undefined
  #stopping: Promise<void> | undefined
  #disposed = false

  constructor(options: ClipmWorkerManagerOptions) {
    this.#options = options
  }

  snapshot(): ClipmWorkerSnapshot {
    return {
      state: this.#disposed ? "disposed" : this.#stopping ? "stopping" : this.#connection ? "running" : this.#starting ? "starting" : "stopped",
      leaseCount: this.#leases.size,
      owners: [...this.#leases.values()],
      pid: this.#connection?.pid ?? null,
    }
  }

  async acquire(owner: string): Promise<ClipmWorkerLease> {
    if (this.#disposed) throw new Error("ClipM worker manager is disposed.")
    if (!owner.trim()) throw new Error("ClipM worker leases require an owner.")
    const token = Symbol(owner)
    this.#leases.set(token, owner)
    let connection: ClipmMcpConnection
    try {
      connection = await this.#ensureConnection()
    } catch (error) {
      this.#leases.delete(token)
      throw error
    }
    let released = false
    return {
      owner,
      get pid() { return connection.pid },
      callTool: (name, args) => connection.callTool(name, args),
      release: async () => {
        if (released) return
        released = true
        this.#leases.delete(token)
        if (this.#leases.size === 0) await this.#stopConnection()
      },
    }
  }

  async callStructured<T extends object>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const lease = await this.acquire(`call:${name}`)
    try {
      const result = await lease.callTool(name, args)
      if ("isError" in result && result.isError) throw new Error(toolErrorMessage(result))
      if (!("structuredContent" in result) || !result.structuredContent) {
        throw new Error(`ClipM MCP tool ${name} returned no structured content.`)
      }
      return result.structuredContent as T
    } finally {
      await lease.release()
    }
  }

  health(): Promise<EnvironmentStatus> {
    return this.callStructured<EnvironmentStatus>("health")
  }

  async dispose(): Promise<void> {
    if (this.#leases.size > 0) throw new Error(`Cannot dispose ClipM worker manager with ${this.#leases.size} active lease(s).`)
    this.#disposed = true
    await this.#stopConnection()
  }

  async #ensureConnection(): Promise<ClipmMcpConnection> {
    if (this.#stopping) await this.#stopping
    if (this.#connection) return this.#connection
    this.#starting ??= (this.#options.createConnection ?? createClipmMcpConnection)(this.#options)
      .then((connection) => {
        this.#connection = connection
        return connection
      })
      .finally(() => { this.#starting = undefined })
    return await this.#starting
  }

  async #stopConnection(): Promise<void> {
    if (this.#stopping) return await this.#stopping
    const connection = this.#connection
    if (!connection) return
    this.#connection = undefined
    this.#stopping = connection.close().finally(() => { this.#stopping = undefined })
    await this.#stopping
  }
}

function toolErrorMessage(result: ClipmCallResult): string {
  const content = "content" in result ? result.content : undefined
  if (!Array.isArray(content)) return "ClipM MCP tool failed."
  const text = content.find((item): item is { type: "text"; text: string } => (
    typeof item === "object" && item !== null && item.type === "text" && typeof item.text === "string"
  ))
  return text?.text ?? "ClipM MCP tool failed."
}
