#!/usr/bin/env bun
/**
 * Memory-safe matrix for Vite managed-dev cold start.
 *
 * Design goals for low-RAM Windows machines:
 * - one variant at a time (never concurrent Vite children)
 * - hard kill process tree after each variant
 * - bounded Vite heap (default 1024 MB)
 * - cooldown between variants so the OS can reclaim memory
 * - short default timeout; prefer segmented runs over one giant matrix
 *
 * Usage:
 *   bun scripts/benchmark-vite-cold-start.ts --variants baseline
 *   bun scripts/benchmark-vite-cold-start.ts --variants baseline,no-warmup --timeout-ms 45000
 *   bun scripts/benchmark-vite-cold-start.ts --list
 */
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises"
import { createConnection, createServer } from "node:net"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "..")
const defaultOutput = path.join(repoRoot, "artifacts", "vite-cold-start")
const DEFAULT_HEAP_MB = 1024
const DEFAULT_TIMEOUT_MS = 45_000
const DEFAULT_COOLDOWN_MS = 3_000
const DEFAULT_PORT_BASE = 5300
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g")
const VITE_READY_PATTERN = /ready in\s+\d+\s*ms/i

interface Variant {
  id: string
  description: string
  env?: Record<string, string>
  /** null deletes a nested key after merge. */
  override?: Record<string, unknown>
  reuseCacheFrom?: string
  /** Use the real repo vite.config.ts (no generated wrapper). */
  nativeConfig?: boolean
}

interface VariantResult {
  id: string
  description: string
  ok: boolean
  port: number
  cacheDir: string
  viteReadyMs: number | null
  tcpOkMs: number | null
  headOkMs: number | null
  mainOkMs: number | null
  probeMs: number | null
  attempts: number
  depsFiles: number
  depsBytes: number
  childExitCode: number | null
  errorSamples: string[]
  logTail: string[]
  timedOut: boolean
  peakChildNote: string
}

const VARIANTS: Variant[] = [
  {
    id: "baseline-native",
    description: "Real vite.config.ts control (no wrapper)",
    nativeConfig: true,
  },
  {
    id: "baseline",
    description: "Current defaults via config wrapper",
  },
  {
    id: "compiler-off",
    description: "React Compiler off",
    env: { XIRANITE_REACT_COMPILER_MODE: "off" },
  },
  {
    id: "no-warmup",
    description: "server.warmup removed",
    override: { server: { warmup: null } },
  },
  {
    id: "entry-warmup",
    description: "Warm only index.html + main.tsx",
    override: {
      server: {
        warmup: { clientFiles: ["./index.html", "./src/main.tsx"] },
      },
    },
  },
  {
    id: "no-optimize-include",
    description: "optimizeDeps.include emptied",
    override: {
      optimizeDeps: {
        noDiscovery: true,
        holdUntilCrawlEnd: false,
        include: [],
        exclude: [],
      },
    },
  },
  {
    id: "lean-no-warmup",
    description: "Compiler off + warmup off",
    env: { XIRANITE_REACT_COMPILER_MODE: "off" },
    override: { server: { warmup: null } },
  },
  {
    id: "baseline-warm-reuse",
    description: "Reuse baseline cold cache (warm path)",
    reuseCacheFrom: "baseline",
  },
]

const options = parseArgs(process.argv.slice(2))
if (options.list) {
  for (const variant of VARIANTS) {
    console.log(`${variant.id.padEnd(22)} ${variant.description}`)
  }
  process.exit(0)
}

const selected = options.variants
  ? options.variants.map((id) => {
    const variant = VARIANTS.find((item) => item.id === id)
    if (!variant) throw new Error(`Unknown variant "${id}". Use --list.`)
    return variant
  })
  : [VARIANTS.find((item) => item.id === "baseline")!]

await mkdir(options.output, { recursive: true })
const runId = new Date().toISOString().replace(/[:.]/g, "-")
const runDir = path.join(options.output, runId)
await mkdir(runDir, { recursive: true })

console.log("Vite cold-start matrix (memory-safe, serial)")
console.log(`variants: ${selected.map((item) => item.id).join(", ")}`)
console.log(`timeout: ${options.timeoutMs}ms  heap: ${options.heapMb}MB  cooldown: ${options.cooldownMs}ms`)
console.log(`output: ${path.relative(repoRoot, runDir)}`)
console.log("")

// Best-effort cleanup before we start, so a previous aborted bench cannot pile on.
await killStrayBenchProcesses()
await Bun.sleep(500)

const cacheByVariant = new Map<string, string>()
const results: VariantResult[] = []

for (const [index, variant] of selected.entries()) {
  // Always free ports and leftover vite children between cells.
  await killStrayBenchProcesses()
  if (index > 0 && options.cooldownMs > 0) {
    console.log(`cooldown ${options.cooldownMs}ms...`)
    await Bun.sleep(options.cooldownMs)
  }

  const port = await freePort(options.portBase + index)
  console.log(`→ ${variant.id} on :${port}`)
  const result = await runVariant(variant, port, runDir, cacheByVariant)
  cacheByVariant.set(variant.id, result.cacheDir)
  results.push(result)
  printResult(result)

  // Hard stop anything left on this port before the next cell.
  await killPortProcessTree(port)
  await killStrayBenchProcesses()
}

const report = {
  generatedAt: new Date().toISOString(),
  platform: process.platform,
  bun: Bun.version,
  timeoutMs: options.timeoutMs,
  heapMb: options.heapMb,
  cooldownMs: options.cooldownMs,
  variants: results,
  ranking: [...results]
    .filter((result) => result.ok && result.probeMs != null)
    .sort((left, right) => (left.probeMs ?? Infinity) - (right.probeMs ?? Infinity))
    .map((result) => ({
      id: result.id,
      probeMs: result.probeMs,
      tcpOkMs: result.tcpOkMs,
      headOkMs: result.headOkMs,
      mainOkMs: result.mainOkMs,
    })),
}

await writeFile(path.join(runDir, "results.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8")
await writeFile(path.join(runDir, "report.md"), renderMarkdown(report), "utf8")

console.log("")
console.log("Ranking (fastest probe first):")
if (report.ranking.length === 0) console.log("  (none succeeded)")
for (const row of report.ranking) {
  const mainDelta = (row.mainOkMs ?? 0) - (row.headOkMs ?? 0)
  console.log(
    `  ${String(row.probeMs).padStart(6)}ms  ${row.id}  (tcp=${row.tcpOkMs} head=${row.headOkMs} mainΔ=${mainDelta})`,
  )
}
console.log("")
console.log(`Report: ${path.relative(repoRoot, path.join(runDir, "report.md"))}`)
process.exit(results.some((result) => !result.ok) ? 1 : 0)

async function runVariant(
  variant: Variant,
  port: number,
  runDir: string,
  cacheByVariant: Map<string, string>,
): Promise<VariantResult> {
  const variantDir = path.join(runDir, variant.id)
  await mkdir(variantDir, { recursive: true })

  let cacheDir: string
  if (variant.reuseCacheFrom) {
    const source = cacheByVariant.get(variant.reuseCacheFrom)
    if (!source) {
      return failedResult(variant, port, path.join(variantDir, "cache"), [
        `missing cache from ${variant.reuseCacheFrom}; include that variant in the same run first`,
      ])
    }
    cacheDir = source
  } else {
    cacheDir = path.join(variantDir, "cache")
    await rm(cacheDir, { recursive: true, force: true })
    await mkdir(cacheDir, { recursive: true })
  }

  const configPath = variant.nativeConfig
    ? path.join(repoRoot, "vite.config.ts")
    : path.join(variantDir, "vite.config.mts")
  if (!variant.nativeConfig) {
    await writeFile(configPath, buildOverrideConfig(variant.override), "utf8")
  }

  const outPath = path.join(variantDir, "stdout.log")
  const errPath = path.join(variantDir, "stderr.log")
  const out = Bun.file(outPath).writer()
  const err = Bun.file(errPath).writer()

  const nodeOptions = appendMaxOldSpace(process.env.NODE_OPTIONS, options.heapMb)
  const child = Bun.spawn(
    [
      "bun",
      "x",
      "vite",
      "--config",
      configPath,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ...variant.env,
        XIRANITE_VITE_CACHE_DIR: cacheDir,
        NODE_OPTIONS: nodeOptions,
        // Discourage accidental nested workers from ballooning memory.
        UV_THREADPOOL_SIZE: "2",
      },
    },
  )

  const logLines: string[] = []
  let viteReadyMs: number | null = null
  const startedAt = Date.now()
  let childExitCode: number | null = null
  void child.exited.then((code) => {
    childExitCode = code
  })

  const stdoutTask = pipeAndWatch(child.stdout, out, logLines, (line) => {
    if (isViteReadyLine(line) && viteReadyMs == null) viteReadyMs = Date.now() - startedAt
  })
  const stderrTask = pipeAndWatch(child.stderr, err, logLines, (line) => {
    if (isViteReadyLine(line) && viteReadyMs == null) viteReadyMs = Date.now() - startedAt
  })

  const baseUrl = `http://127.0.0.1:${port}`
  const errorSamples: string[] = []
  let tcpOkMs: number | null = null
  let headOkMs: number | null = null
  let mainOkMs: number | null = null
  let attempts = 0
  let timedOut = false

  try {
    while (Date.now() - startedAt < options.timeoutMs) {
      attempts += 1
      if (childExitCode != null) {
        errorSamples.push(`vite exited early with code ${childExitCode}`)
        break
      }
      try {
        if (tcpOkMs == null) {
          if (!(await canConnect(port, 200))) throw new Error("tcp-connect-failed")
          tcpOkMs = Date.now() - startedAt
        }

        // Bound each attempt so a stuck optimizer cannot hold one fetch for the
        // whole timeout window (and so we do not stack hung sockets).
        const head = await fetch(`${baseUrl}/`, {
          method: "HEAD",
          signal: AbortSignal.timeout(options.requestTimeoutMs),
        })
        if (!head.ok) throw new Error(`HEAD / -> ${head.status}`)
        if (headOkMs == null) headOkMs = Date.now() - startedAt
        await head.body?.cancel()

        const main = await fetch(`${baseUrl}/src/main.tsx`, {
          signal: AbortSignal.timeout(options.requestTimeoutMs),
        })
        if (!main.ok) throw new Error(`GET /src/main.tsx -> ${main.status}`)
        // Drain body but avoid keeping the string in memory.
        await main.arrayBuffer()
        mainOkMs = Date.now() - startedAt
        break
      } catch (error) {
        if (errorSamples.length < 6) {
          const message = error instanceof Error ? error.message : String(error)
          errorSamples.push(message.includes("TimeoutError") || message.includes("timed out")
            ? `request-timeout>${options.requestTimeoutMs}ms`
            : message)
        }
        await Bun.sleep(200)
      }
    }
    if (mainOkMs == null) timedOut = true
  } finally {
    await forceKillChild(child.pid, port)
    await Promise.race([child.exited, Bun.sleep(2_000)])
    await Promise.allSettled([stdoutTask, stderrTask])
    out.end()
    err.end()
  }

  const deps = await measureDeps(cacheDir)
  return {
    id: variant.id,
    description: variant.description,
    ok: mainOkMs != null,
    port,
    cacheDir,
    viteReadyMs,
    tcpOkMs,
    headOkMs,
    mainOkMs,
    probeMs: mainOkMs,
    attempts,
    depsFiles: deps.files,
    depsBytes: deps.bytes,
    childExitCode,
    errorSamples,
    logTail: logLines.slice(-12),
    timedOut,
    peakChildNote: `heap-cap=${options.heapMb}MB`,
  }
}

function buildOverrideConfig(override: Record<string, unknown> | undefined): string {
  const overrideLiteral = JSON.stringify(override ?? {}, null, 2)
  return `import base from ${JSON.stringify(path.join(repoRoot, "vite.config.ts"))}

const override = ${overrideLiteral} as Record<string, unknown>
const resolved = typeof base === "function"
  ? await base({ command: "serve", mode: "development" })
  : base

function mergeSection(key: string) {
  const left = resolved?.[key]
  const right = override[key]
  if (right === undefined) return left
  if (right === null) return undefined
  if (
    left && typeof left === "object" && !Array.isArray(left)
    && typeof right === "object" && right && !Array.isArray(right)
  ) {
    const merged = { ...left, ...right }
    for (const [nestedKey, nestedValue] of Object.entries(right)) {
      if (nestedValue === null) delete merged[nestedKey]
    }
    return merged
  }
  return right
}

export default {
  ...resolved,
  ...override,
  root: ${JSON.stringify(repoRoot)},
  server: mergeSection("server"),
  optimizeDeps: mergeSection("optimizeDeps"),
  plugins: resolved?.plugins,
}
`
}

async function canConnect(port: number, timeoutMs: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port })
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      socket.removeAllListeners()
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once("connect", () => finish(true))
    socket.once("timeout", () => finish(false))
    socket.once("error", () => finish(false))
  })
}

function isViteReadyLine(line: string): boolean {
  return VITE_READY_PATTERN.test(line.replace(ANSI_ESCAPE_PATTERN, ""))
}

async function pipeAndWatch(
  stream: ReadableStream<Uint8Array> | null | undefined,
  writer: { write(data: string | Uint8Array): number | Promise<number> },
  lines: string[],
  onLine: (line: string) => void,
): Promise<void> {
  if (!stream) return
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    writer.write(value)
    buffer += decoder.decode(value, { stream: true })
    // Cap retained log lines to keep the parent process light.
    let newline = buffer.indexOf("\n")
    while (newline !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, "")
      buffer = buffer.slice(newline + 1)
      lines.push(line)
      if (lines.length > 40) lines.splice(0, lines.length - 40)
      onLine(line)
      newline = buffer.indexOf("\n")
    }
  }
}

async function measureDeps(cacheDir: string): Promise<{ files: number; bytes: number }> {
  try {
    return await walkFiles(path.join(cacheDir, "deps"))
  } catch {
    return { files: 0, bytes: 0 }
  }
}

async function walkFiles(root: string): Promise<{ files: number; bytes: number }> {
  let files = 0
  let bytes = 0
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()!
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      files += 1
      bytes += (await stat(fullPath)).size
    }
  }
  return { files, bytes }
}

async function freePort(preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + 40; port += 1) {
    const available = await new Promise<boolean>((resolve) => {
      const server = createServer()
      server.once("error", () => resolve(false))
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(true))
      })
    })
    if (available) return port
  }
  throw new Error(`No free port near ${preferred}`)
}

async function forceKillChild(pid: number | undefined, port: number): Promise<void> {
  if (pid && pid > 0) {
    if (process.platform === "win32") {
      await Bun.$`taskkill /PID ${pid} /T /F`.quiet().nothrow()
    } else {
      try {
        process.kill(-pid, "SIGKILL")
      } catch {
        try {
          process.kill(pid, "SIGKILL")
        } catch {
          // already gone
        }
      }
    }
  }
  await killPortProcessTree(port)
}

async function killPortProcessTree(port: number): Promise<void> {
  if (process.platform !== "win32") return
  // PowerShell-free path: netstat + taskkill, cheap and bounded. Match only
  // the listening local endpoint; established client rows can contain the
  // target as their remote port and belong to this benchmark process.
  const listed = await Bun.$`cmd /c netstat -ano`.quiet().nothrow()
  if (listed.exitCode !== 0) return
  const text = listed.stdout.toString()
  const pids = new Set<number>()
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 5 || parts[0]?.toUpperCase() !== "TCP") continue
    const localEndpoint = parts[1] ?? ""
    const state = parts[3]?.toUpperCase()
    if (!localEndpoint.endsWith(`:${port}`) || state !== "LISTENING") continue
    const pid = Number(parts[4])
    if (Number.isInteger(pid) && pid > 0) pids.add(pid)
  }
  for (const pid of pids) {
    await Bun.$`taskkill /PID ${pid} /T /F`.quiet().nothrow()
  }
}

async function killStrayBenchProcesses(): Promise<void> {
  // Port-scoped only — never WMI/process-name scans (too heavy, easy to overkill).
  for (let port = options.portBase; port < options.portBase + 40; port += 1) {
    await killPortProcessTree(port)
  }
}

function appendMaxOldSpace(existing: string | undefined, heapMb: number): string {
  const cleaned = (existing ?? "").replace(/(?:^|\s)--max-old-space-size(?:=|\s+)\d+/g, "").trim()
  return `${cleaned} --max-old-space-size=${heapMb}`.trim()
}

function failedResult(variant: Variant, port: number, cacheDir: string, errors: string[]): VariantResult {
  return {
    id: variant.id,
    description: variant.description,
    ok: false,
    port,
    cacheDir,
    viteReadyMs: null,
    tcpOkMs: null,
    headOkMs: null,
    mainOkMs: null,
    probeMs: null,
    attempts: 0,
    depsFiles: 0,
    depsBytes: 0,
    childExitCode: null,
    errorSamples: errors,
    logTail: [],
    timedOut: false,
    peakChildNote: "",
  }
}

function printResult(result: VariantResult): void {
  const status = result.ok ? "ok" : result.timedOut ? "timeout" : "fail"
  const fmt = (value: number | null) => (value == null ? "-" : `${value}ms`)
  const mainDelta =
    result.mainOkMs != null && result.headOkMs != null
      ? `${result.mainOkMs - result.headOkMs}ms`
      : "-"
  console.log(
    `${result.id.padEnd(22)} ${status.padEnd(8)} probe=${fmt(result.probeMs).padStart(8)} tcp=${fmt(result.tcpOkMs).padStart(8)} head=${fmt(result.headOkMs).padStart(8)} mainΔ=${mainDelta.padStart(7)} viteReady=${fmt(result.viteReadyMs).padStart(8)} attempts=${String(result.attempts).padStart(4)} deps=${result.depsFiles}`,
  )
  if (!result.ok && result.errorSamples.length) {
    console.log(`  last error: ${result.errorSamples[result.errorSamples.length - 1]}`)
  }
}

function renderMarkdown(report: {
  generatedAt: string
  platform: string
  bun: string
  timeoutMs: number
  heapMb: number
  cooldownMs: number
  variants: VariantResult[]
  ranking: Array<{ id: string; probeMs: number | null; tcpOkMs?: number | null; headOkMs: number | null; mainOkMs: number | null }>
}): string {
  const lines = [
    "# Vite cold-start matrix",
    "",
    `- generated: ${report.generatedAt}`,
    `- platform: ${report.platform}`,
    `- bun: ${report.bun}`,
    `- timeout: ${report.timeoutMs}ms`,
    `- heap cap: ${report.heapMb}MB / child`,
    `- cooldown: ${report.cooldownMs}ms`,
    "",
    "| variant | ok | probe | tcp | head | mainΔ | vite ready | attempts | deps files | deps MB |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ]
  for (const result of report.variants) {
    const mainDelta =
      result.mainOkMs != null && result.headOkMs != null
        ? String(result.mainOkMs - result.headOkMs)
        : "-"
    lines.push(
      `| ${result.id} | ${result.ok ? "yes" : "no"} | ${result.probeMs ?? "-"} | ${result.tcpOkMs ?? "-"} | ${result.headOkMs ?? "-"} | ${mainDelta} | ${result.viteReadyMs ?? "-"} | ${result.attempts} | ${result.depsFiles} | ${(result.depsBytes / 1024 / 1024).toFixed(2)} |`,
    )
  }
  lines.push("", "## Ranking", "")
  if (!report.ranking.length) lines.push("_No successful variants._")
  for (const row of report.ranking) {
    lines.push(`1. **${row.id}** — probe ${row.probeMs}ms (tcp ${row.tcpOkMs ?? "-"}, head ${row.headOkMs}ms)`)
  }
  lines.push(
    "",
    "## Notes",
    "",
    "- Serial only: one Vite child at a time, process tree killed after each cell.",
    "- `vite ready` = printed listen time; `tcp` = first accept; `head`/`probe` = managed readiness paths.",
    "- Prefer segmented runs on low-RAM machines, e.g. `--variants baseline` then `--variants no-warmup`.",
    "",
  )
  return `${lines.join("\n")}\n`
}

function parseArgs(argv: string[]): {
  output: string
  portBase: number
  timeoutMs: number
  requestTimeoutMs: number
  heapMb: number
  cooldownMs: number
  variants?: string[]
  list: boolean
} {
  let output = defaultOutput
  let portBase = DEFAULT_PORT_BASE
  let timeoutMs = DEFAULT_TIMEOUT_MS
  // Default: one long-lived request may wait for optimizeDeps; do not multi-fetch.
  let requestTimeoutMs = DEFAULT_TIMEOUT_MS
  let heapMb = DEFAULT_HEAP_MB
  let cooldownMs = DEFAULT_COOLDOWN_MS
  let variants: string[] | undefined
  let list = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    if (arg === "--output") output = path.resolve(argv[++index] ?? defaultOutput)
    else if (arg === "--port-base") portBase = Number(argv[++index])
    else if (arg === "--timeout-ms") timeoutMs = Number(argv[++index])
    else if (arg === "--request-timeout-ms") requestTimeoutMs = Number(argv[++index])
    else if (arg === "--heap-mb") heapMb = Number(argv[++index])
    else if (arg === "--cooldown-ms") cooldownMs = Number(argv[++index])
    else if (arg === "--variants") {
      variants = String(argv[++index] ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    } else if (arg === "--list") list = true
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  bun scripts/benchmark-vite-cold-start.ts --variants baseline
  bun scripts/benchmark-vite-cold-start.ts --variants baseline,no-warmup --timeout-ms 45000 --heap-mb 1024
  bun scripts/benchmark-vite-cold-start.ts --list

Defaults are memory-safe:
  - one variant if --variants omitted
  - serial only, kill by port after each cell
  - 45s overall timeout; per-request timeout follows it unless overridden
  - 1024MB heap cap, 3s cooldown`)
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!Number.isFinite(portBase) || portBase < 1) throw new Error("--port-base must be positive")
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) throw new Error("--timeout-ms must be >= 1000")
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 500) throw new Error("--request-timeout-ms must be >= 500")
  if (!Number.isFinite(heapMb) || heapMb < 512) throw new Error("--heap-mb must be >= 512")
  if (!Number.isFinite(cooldownMs) || cooldownMs < 0) throw new Error("--cooldown-ms must be >= 0")
  return { output, portBase, timeoutMs, requestTimeoutMs, heapMb, cooldownMs, variants, list }
}
