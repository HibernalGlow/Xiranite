/**
 * The `process` object, and the realm's `process` global.
 *
 * Measured across the core+platform closures: `process.platform` (branch points such as `linedup`'s
 * `platform.ts:9/22`), `process.env` and `process.cwd()` are the three reads the nodes actually make. QuickJS
 * has no `process`, so the prelude installs this object as a realm global (see `installShimGlobals` in
 * `index.ts`); importing `node:process` returns the same object, so a bundle cannot get two divergent views.
 *
 * Deliberately absent, because inventing them would be a silent behaviour change:
 * - `process.exit` / `kill` / signal handling — an exit inside a realm must be the host's decision
 *   (cancel/quota), never a script's; these throw.
 * - `process.pid` — the realm is not a process.
 * - `process.chdir` — the working directory is the host's; moving it would silently change every relative path.
 * - `process.stdout`/`stdin`/`stderr` — a realm has no descriptors; the CLI face keeps Node's own (ADR-0074
 *   decision 5).
 *
 * The object is *built* (not eagerly evaluated at module load) so importing this module in a process without a
 * host — the build tooling, the audit — does not touch `__xrh`.
 */
import { hasHost, hostEnv, platformInfo, platformInfoOrFallback } from "./host.ts"
import { notImplemented } from "./internal.ts"

export interface ProcessShim {
  platform: string
  arch: string
  env: Record<string, string>
  cwd: () => string
  argv: string[]
  argv0: string
  execArgv: string[]
  execPath: string
  title: string
  version: string
  versions: Record<string, string>
  nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]) => void
  hrtime: (prev?: [number, number]) => [number, number]
  hrtimeBigint: (prev?: bigint) => bigint
  features: Record<string, boolean>
  exit: () => never
  abort: () => never
  kill: () => never
  chdir: () => never
}

let cached: ProcessShim | undefined

/** Reads the host once; a realm always has `__xrh` installed before the prelude runs. */
export function createProcessShim(): ProcessShim {
  if (cached !== undefined) return cached
  const info = hasHost() ? platformInfo() : platformInfoOrFallback()
  const env = hasHost() ? hostEnv() : {}
  cached = {
    platform: info.platform,
    arch: info.arch,
    env,
    cwd: () => (hasHost() ? platformInfo() : platformInfoOrFallback()).cwd,
    argv: [],
    argv0: "",
    execArgv: [],
    execPath: "",
    title: "xiranite-quickjs",
    version: "quickjs-ng",
    versions: { quickjs: "ng" },
    nextTick: (callback, ...args) => queueMicrotask(() => callback(...args)),
    hrtime: (prev) => {
      const ns = BigInt(Math.round(performanceNowNs()))
      if (!prev) return [Number(ns / 1_000_000_000n), Number(ns % 1_000_000_000n)]
      const base = BigInt(prev[0]) * 1_000_000_000n + BigInt(prev[1])
      const delta = ns >= base ? ns - base : 0n
      return [Number(delta / 1_000_000_000n), Number(delta % 1_000_000_000n)]
    },
    hrtimeBigint: (prev) => {
      const ns = BigInt(Math.round(performanceNowNs()))
      return prev ? ns - prev : ns
    },
    features: { inspector: false, cpuProfiler: false },
    exit: notImplemented("process", "exit"),
    abort: notImplemented("process", "abort"),
    kill: notImplemented("process", "kill"),
    chdir: notImplemented("process", "chdir", "the working directory is the host's"),
  }
  return cached
}

function performanceNowNs(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance
  if (typeof perf?.now === "function") return perf.now() * 1e6
  return Date.now() * 1e6
}

/** The default import is the built object; `node:process` and the global share one instance. */
export default createProcessShim()
