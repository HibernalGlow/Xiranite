#!/usr/bin/env bun
/**
 * Matrix benchmark for Vite managed-dev cold start.
 *
 * Measures wall time from process spawn until the same readiness signals the
 * managed launcher uses: HEAD / and GET /src/main.tsx.
 *
 * Usage:
 *   bun scripts/benchmark-vite-cold-start.ts
 *   bun scripts/benchmark-vite-cold-start.ts --variants baseline,no-warmup,compiler-off
 *   bun scripts/benchmark-vite-cold-start.ts --port-base 5300 --timeout-ms 120000
 */
import { mkdir, rm, writeFile, readdir, stat } from "node:fs/promises"
import path from "node:path"
import { createServer } from "node:net"

const repoRoot = path.resolve(import.meta.dir, "..")
const defaultOutput = path.join(repoRoot, "artifacts", "vite-cold-start")

interface Variant {
  id: string
  description: string
  /** Environment variables applied to the Vite child. */
  env?: Record<string, string>
  /** Vite config overrides merged on top of vite.config.ts. Use null to delete a nested key. */
  override?: Record<string, unknown>
  /** Reuse the previous variant's cache directory (warm path). */
  reuseCacheFrom?: string
}

interface VariantResult {
  id: string
  description: string
  ok: boolean
  port: number
  cacheDir: string
  viteReadyMs: number | null
  headOkMs: number | null
  mainOkMs: number | null
  probeMs: number | null
  attempts: number
  depsFiles: number
  depsBytes: number
  errorSamples: string[]
  logTail: string[]
  timedOut: boolean
}

const VARIANTS: Variant[] = [
  {
    id: "baseline",
    description: "Current vite.config defaults (compiler infer + full warmup + optimizeDeps include)",
  },
  {
    id: "compiler-off",
    description: "React Compiler disabled",
    env: { XIRANITE_REACT_COMPILER_MODE: "off" },
  },
  {
    id: "no-warmup",
    description: "server.warmup disabled",
    // null is a sentinel: generated config deletes the key after merge.
    override: { server: { warmup: null } },
  },
  {
    id: "entry-warmup",
    description: "Warm only index.html + main.tsx",
    override: {
      server: {
        warmup: {
          clientFiles: ["./index.html", "./src/main.tsx"],
        },
      },
    },
  },
  {
    id: "no-optimize-include",
    description: "optimizeDeps.include emptied (still noDiscovery)",
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
    id: "optimize-disabled",
    description: "optimizeDeps.disabled = true",
    override: {
      optimizeDeps: {
        disabled: true,
      },
    },
  },
  {
    id: "lean-no-warmup",
    description: "Compiler off + warmup off (fast-path hypothesis)",
    env: { XIRANITE_REACT_COMPILER_MODE: "off" },
    override: { server: { warmup: null } },
  },
  {
    id: "baseline-warm-reuse",
    description: "Second start reusing baseline cold cache",
    reuseCacheFrom: "baseline",
  },
]

const options = parseArgs(process.argv.slice(2))
const selected = options.variants
  ? VARIANTS.filter((variant) => options.variants!.includes(variant.id))
  : VARIANTS

if (selected.length === 0) {
  console.error(`No variants selected. Available: ${VARIANTS.map((v) => v.id).join(", ")}`)
  process.exit(1)
}

await mkdir(options.output, { recursive: true })
const runId = new Date().toISOString().replace(/[:.]/g, "-")
const runDir = path.join(options.output, runId)
await mkdir(runDir, { recursive: true })

const cacheByVariant = new Map<string, string>()
const results: VariantResult[] = []

console.log(`Vite cold-start matrix (${selected.length} variants)`)
console.log(`output: ${path.relative(repoRoot, runDir)}`)
console.log("")

for (const [index, variant] of selected.entries()) {
  const port = await freePort(options.portBase + index)
  const result = await runVariant(variant, port, runDir, cacheByVariant)
  cacheByVariant.set(variant.id, result.cacheDir)
  results.push(result)
  printResult(result)
}

const report = {
  generatedAt: new Date().toISOString(),
  platform: process.platform,
  bun: Bun.version,
  timeoutMs: options.timeoutMs,
  variants: results,
  ranking: [...results]
    .filter((result) => result.ok && result.probeMs != null)
    .sort((left, right) => (left.probeMs ?? Infinity) - (right.probeMs ?? Infinity))
    .map((result) => ({ id: result.id, probeMs: result.probeMs, headOkMs: result.headOkMs, mainOkMs: result.mainOkMs })),
}

await writeFile(path.join(runDir, "results.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8")
await writeFile(path.join(runDir, "report.md"), renderMarkdown(report), "utf8")

console.log("")
console.log("Ranking (fastest probe first):")
for (const row of report.ranking) {
  console.log(`  ${String(row.probeMs).padStart(6)}ms  ${row.id}  (head=${row.headOkMs}ms mainΔ=${(row.mainOkMs ?? 0) - (row.headOkMs ?? 0)}ms)`)
}
console.log("")
console.log(`Report: ${path.relative(repoRoot, path.join(runDir, "report.md"))}`)

const failed = results.filter((result) => !result.ok)
process.exit(failed.length ? 1 : 0)

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
        `missing cache from ${variant.reuseCacheFrom}; run that variant in the same matrix`,
      ])
    }
    cacheDir = source
  } else {
    cacheDir = path.join(variantDir, "cache")
    await rm(cacheDir, { recursive: true, force: true })
    await mkdir(cacheDir, { recursive: true })
  }

  const configPath = path.join(variantDir, "vite.config.mts")
  await writeFile(configPath, buildOverrideConfig(variant.override), "utf8")

  const outPath = path.join(variantDir, "stdout.log")
  const errPath = path.join(variantDir, "stderr.log")
  const out = Bun.file(outPath).writer()
  const err = Bun.file(errPath).writer()

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
        // Keep the child focused on cold-start cost of this matrix cell.
        CI: "1",
      },
    },
  )

  const logLines: string[] = []
  let viteReadyMs: number | null = null
  const startedAt = Date.now()

  const stdoutTask = pipeAndWatch(child.stdout, out, logLines, (line) => {
    const match = line.match(/ready in\s+(\d+)\s*ms/i)
    if (match && viteReadyMs == null) viteReadyMs = Date.now() - startedAt
  })
  const stderrTask = pipeAndWatch(child.stderr, err, logLines, (line) => {
    const match = line.match(/ready in\s+(\d+)\s*ms/i)
    if (match && viteReadyMs == null) viteReadyMs = Date.now() - startedAt
  })

  const baseUrl = `http://127.0.0.1:${port}`
  const errorSamples: string[] = []
  let headOkMs: number | null = null
  let mainOkMs: number | null = null
  let attempts = 0
  let timedOut = false

  try {
    while (Date.now() - startedAt < options.timeoutMs) {
      attempts += 1
      try {
        const head = await fetch(`${baseUrl}/`, { method: "HEAD" })
        if (!head.ok) throw new Error(`HEAD / -> ${head.status}`)
        if (headOkMs == null) headOkMs = Date.now() - startedAt
        await head.body?.cancel()

        const main = await fetch(`${baseUrl}/src/main.tsx`)
        if (!main.ok) throw new Error(`GET /src/main.tsx -> ${main.status}`)
        await main.arrayBuffer()
        mainOkMs = Date.now() - startedAt
        break
      } catch (error) {
        if (errorSamples.length < 8) {
          errorSamples.push(error instanceof Error ? error.message : String(error))
        }
        await Bun.sleep(100)
      }
    }

    if (mainOkMs == null) timedOut = true
  } finally {
    child.kill()
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
    headOkMs,
    mainOkMs,
    probeMs: mainOkMs,
    attempts,
    depsFiles: deps.files,
    depsBytes: deps.bytes,
    errorSamples,
    logTail: logLines.slice(-20),
    timedOut,
  }
}

function buildOverrideConfig(override: Record<string, unknown> | undefined): string {
  const overrideLiteral = JSON.stringify(override ?? {}, null, 2)
  // Import the real config and shallow-merge known top-level keys. Nested
  // server/optimizeDeps are merged one level so we can turn warmup off without
  // dropping HMR/host settings from the base config.
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
  if (left && typeof left === "object" && !Array.isArray(left) && typeof right === "object" && !Array.isArray(right)) {
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
  server: mergeSection("server"),
  optimizeDeps: mergeSection("optimizeDeps"),
  plugins: resolved?.plugins,
}
`
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
    let newline = buffer.indexOf("\n")
    while (newline !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, "")
      buffer = buffer.slice(newline + 1)
      lines.push(line)
      onLine(line)
      newline = buffer.indexOf("\n")
    }
  }
  if (buffer) {
    const line = buffer.replace(/\r$/, "")
    lines.push(line)
    onLine(line)
  }
}

async function measureDeps(cacheDir: string): Promise<{ files: number; bytes: number }> {
  const depsDir = path.join(cacheDir, "deps")
  try {
    return await walkFiles(depsDir)
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
  for (let port = preferred; port < preferred + 50; port += 1) {
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

function failedResult(variant: Variant, port: number, cacheDir: string, errors: string[]): VariantResult {
  return {
    id: variant.id,
    description: variant.description,
    ok: false,
    port,
    cacheDir,
    viteReadyMs: null,
    headOkMs: null,
    mainOkMs: null,
    probeMs: null,
    attempts: 0,
    depsFiles: 0,
    depsBytes: 0,
    errorSamples: errors,
    logTail: [],
    timedOut: false,
  }
}

function printResult(result: VariantResult): void {
  const status = result.ok ? "ok" : result.timedOut ? "timeout" : "fail"
  const probe = result.probeMs == null ? "-" : `${result.probeMs}ms`
  const head = result.headOkMs == null ? "-" : `${result.headOkMs}ms`
  const vite = result.viteReadyMs == null ? "-" : `${result.viteReadyMs}ms`
  const mainDelta =
    result.mainOkMs != null && result.headOkMs != null
      ? `${result.mainOkMs - result.headOkMs}ms`
      : "-"
  console.log(
    `${result.id.padEnd(22)} ${status.padEnd(8)} probe=${probe.padStart(8)} head=${head.padStart(8)} mainΔ=${mainDelta.padStart(7)} viteReady=${vite.padStart(8)} attempts=${String(result.attempts).padStart(4)} deps=${result.depsFiles}`,
  )
  if (!result.ok && result.errorSamples[0]) {
    console.log(`  last error: ${result.errorSamples[result.errorSamples.length - 1]}`)
  }
}

function renderMarkdown(report: {
  generatedAt: string
  platform: string
  bun: string
  timeoutMs: number
  variants: VariantResult[]
  ranking: Array<{ id: string; probeMs: number | null; headOkMs: number | null; mainOkMs: number | null }>
}): string {
  const lines = [
    "# Vite cold-start matrix",
    "",
    `- generated: ${report.generatedAt}`,
    `- platform: ${report.platform}`,
    `- bun: ${report.bun}`,
    `- timeout: ${report.timeoutMs}ms`,
    "",
    "| variant | ok | probe | head | mainΔ | vite ready | attempts | deps files | deps MB |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ]
  for (const result of report.variants) {
    const mainDelta =
      result.mainOkMs != null && result.headOkMs != null
        ? String(result.mainOkMs - result.headOkMs)
        : "-"
    lines.push(
      `| ${result.id} | ${result.ok ? "yes" : "no"} | ${result.probeMs ?? "-"} | ${result.headOkMs ?? "-"} | ${mainDelta} | ${result.viteReadyMs ?? "-"} | ${result.attempts} | ${result.depsFiles} | ${(result.depsBytes / 1024 / 1024).toFixed(2)} |`,
    )
  }
  lines.push("", "## Ranking", "")
  for (const row of report.ranking) {
    lines.push(`1. **${row.id}** — probe ${row.probeMs}ms (head ${row.headOkMs}ms)`)
  }
  lines.push("", "## Notes", "")
  lines.push("- `vite ready` is when Vite prints `ready in X ms` (HTTP server listen).")
  lines.push("- `head` / `probe` match managed-dev readiness: `HEAD /` then `GET /src/main.tsx`.")
  lines.push("- If `head` ≫ `vite ready`, something after listen is blocking the event loop or queueing requests.")
  lines.push("- If `mainΔ` is large, entry transform/prebundle after HTML is the bottleneck.")
  lines.push("")
  return `${lines.join("\n")}\n`
}

function parseArgs(argv: string[]): {
  output: string
  portBase: number
  timeoutMs: number
  variants?: string[]
} {
  let output = defaultOutput
  let portBase = 5300
  let timeoutMs = 120_000
  let variants: string[] | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    if (arg === "--output") {
      output = path.resolve(argv[++index] ?? defaultOutput)
    } else if (arg === "--port-base") {
      portBase = Number(argv[++index])
    } else if (arg === "--timeout-ms") {
      timeoutMs = Number(argv[++index])
    } else if (arg === "--variants") {
      variants = String(argv[++index] ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: bun scripts/benchmark-vite-cold-start.ts [--variants a,b] [--timeout-ms 120000] [--port-base 5300] [--output dir]`)
      console.log(`Variants: ${VARIANTS.map((variant) => variant.id).join(", ")}`)
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!Number.isFinite(portBase) || portBase < 1) throw new Error("--port-base must be a positive number")
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) throw new Error("--timeout-ms must be >= 1000")
  return { output, portBase, timeoutMs, variants }
}
