import { execFile } from "node:child_process"
import { realpath } from "node:fs/promises"
import { promisify } from "node:util"

import type {
  SuperResolutionCapabilitySnapshot,
  SuperResolutionEngine,
  SuperResolutionEngineCapability,
} from "../../ports/SuperResolutionProvider.js"

const execFileAsync = promisify(execFile)

const ENGINE_COMMANDS: Readonly<Record<SuperResolutionEngine, string>> = {
  upscayl: "upscayl-bin",
  waifu2x: "waifu2x-ncnn-vulkan",
  realcugan: "realcugan-ncnn-vulkan",
}

const ENGINE_SIGNATURES: Readonly<Record<SuperResolutionEngine, RegExp>> = {
  upscayl: /upscayl|realesrgan/i,
  waifu2x: /waifu2x/i,
  realcugan: /real[ -]?cugan/i,
}

export interface SystemSuperResolutionCliProbeResult {
  version?: string
  output?: string
  daemonSupported?: boolean
}

export interface SystemSuperResolutionCliResolverOptions {
  explicitPaths?: Partial<Record<SuperResolutionEngine, string | undefined>>
  trustedCandidates?: Partial<Record<SuperResolutionEngine, readonly string[]>>
  which?: (command: string) => string | undefined | Promise<string | undefined>
  canonicalize?: (path: string) => string | Promise<string>
  probe?: (engine: SuperResolutionEngine, executablePath: string) => Promise<SystemSuperResolutionCliProbeResult>
  now?: () => number
}

export class SystemSuperResolutionCliResolver {
  readonly #explicitPaths: Partial<Record<SuperResolutionEngine, string | undefined>>
  readonly #trustedCandidates: Partial<Record<SuperResolutionEngine, readonly string[]>>
  readonly #which: NonNullable<SystemSuperResolutionCliResolverOptions["which"]>
  readonly #canonicalize: NonNullable<SystemSuperResolutionCliResolverOptions["canonicalize"]>
  readonly #probe: NonNullable<SystemSuperResolutionCliResolverOptions["probe"]>
  readonly #now: () => number
  readonly #cache = new Map<SuperResolutionEngine, Promise<SuperResolutionEngineCapability>>()

  constructor(options: SystemSuperResolutionCliResolverOptions = {}) {
    this.#explicitPaths = options.explicitPaths ?? {}
    this.#trustedCandidates = options.trustedCandidates ?? {}
    this.#which = options.which ?? defaultWhich
    this.#canonicalize = options.canonicalize ?? realpath
    this.#probe = options.probe ?? defaultProbe
    this.#now = options.now ?? Date.now
  }

  async resolve(engine: SuperResolutionEngine, options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<SuperResolutionEngineCapability> {
    options.signal?.throwIfAborted()
    if (options.refresh) this.#cache.delete(engine)
    let request = this.#cache.get(engine)
    if (!request) {
      request = this.#resolveUncached(engine)
      this.#cache.set(engine, request)
      void request.catch(() => {
        if (this.#cache.get(engine) === request) this.#cache.delete(engine)
      })
    }
    return await waitForSharedPromise(request, options.signal)
  }

  async capabilities(options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<SuperResolutionCapabilitySnapshot> {
    options.signal?.throwIfAborted()
    const engines = await Promise.all((Object.keys(ENGINE_COMMANDS) as SuperResolutionEngine[])
      .map((engine) => this.resolve(engine, options)))
    return { engines, probedAt: this.#now() }
  }

  invalidate(engine?: SuperResolutionEngine): void {
    if (engine) this.#cache.delete(engine)
    else this.#cache.clear()
  }

  async #resolveUncached(engine: SuperResolutionEngine): Promise<SuperResolutionEngineCapability> {
    const explicitPath = this.#explicitPaths[engine]?.trim()
    if (explicitPath) {
      const explicit = await this.#inspectCandidate(engine, explicitPath)
      return explicit.capability ?? unavailable(engine, `Configured executable is invalid: ${explicit.reason}`)
    }

    const failures: string[] = []
    const pathCandidate = await this.#which(ENGINE_COMMANDS[engine])
    if (pathCandidate) {
      const located = await this.#inspectCandidate(engine, pathCandidate)
      if (located.capability) return located.capability
      failures.push(`PATH candidate: ${located.reason}`)
    }

    for (const candidate of this.#trustedCandidates[engine] ?? []) {
      const located = await this.#inspectCandidate(engine, candidate)
      if (located.capability) return located.capability
      failures.push(`trusted candidate: ${located.reason}`)
    }

    return unavailable(engine, failures.length
      ? failures.join("; ")
      : `${ENGINE_COMMANDS[engine]} was not found in PATH or trusted candidates.`)
  }

  async #inspectCandidate(
    engine: SuperResolutionEngine,
    candidate: string,
  ): Promise<{ capability?: SuperResolutionEngineCapability; reason?: string }> {
    try {
      const executablePath = await this.#canonicalize(candidate)
      const probe = await this.#probe(engine, executablePath)
      return {
        capability: {
          engine,
          available: true,
          executablePath,
          version: probe.version,
          architecture: process.arch,
          daemonSupported: probe.daemonSupported,
        },
      }
    } catch (error) {
      return { reason: error instanceof Error ? error.message : String(error) }
    }
  }
}

async function defaultWhich(command: string): Promise<string | undefined> {
  const locator = process.platform === "win32" ? "where.exe" : "which"
  try {
    const { stdout } = await execFileAsync(locator, [command], {
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    })
    return stdout.split(/\r?\n/u).map((entry) => entry.trim()).find(Boolean)
  } catch {
    return undefined
  }
}

async function defaultProbe(engine: SuperResolutionEngine, executablePath: string): Promise<SystemSuperResolutionCliProbeResult> {
  let output = ""
  try {
    const result = await execFileAsync(executablePath, ["--help"], {
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    })
    output = `${result.stdout}\n${result.stderr}`
  } catch (error) {
    const details = error as { stdout?: string; stderr?: string; message?: string }
    output = `${details.stdout ?? ""}\n${details.stderr ?? ""}`
    if (!ENGINE_SIGNATURES[engine].test(output)) throw new Error(details.message ?? `Unable to probe ${engine}.`)
  }
  if (!ENGINE_SIGNATURES[engine].test(output)) throw new Error(`Executable does not identify as ${engine}.`)
  return {
    version: parseVersion(output),
    output,
    daemonSupported: detectSuperResolutionDaemonSupport(engine, output),
  }
}

function parseVersion(output: string): string | undefined {
  return output.match(/\bv?(\d+\.\d+(?:\.\d+){0,2})\b/iu)?.[1]
}

export function detectSuperResolutionDaemonSupport(engine: SuperResolutionEngine, output: string): boolean {
  return engine === "upscayl" && /(?:^|\s)(?:-d|--daemon)(?:\s|,|$)/imu.test(output)
}

function unavailable(engine: SuperResolutionEngine, reason?: string): SuperResolutionEngineCapability {
  return { engine, available: false, reason }
}

async function waitForSharedPromise<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return await promise
  signal.throwIfAborted()
  return await new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", abort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", abort)
        reject(error)
      },
    )
  })
}
