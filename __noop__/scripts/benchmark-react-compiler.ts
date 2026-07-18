#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { chromium, type Browser } from "@playwright/test"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"
import { startBackend } from "../packages/backend/src/index"

const repoRoot = path.resolve(import.meta.dir, "..")
const modes = ["annotation", "infer"] as const
type CompilerMode = typeof modes[number]

interface Options { iterations: number; cards: number; output: string }
interface Sample {
  readyMs: number
  fcpMs: number | null
  mountCardsMs: number
  scriptDurationMs: number | null
  taskDurationMs: number | null
  layoutDurationMs: number | null
}
interface ModeResult {
  mode: CompilerMode
  buildMs: number
  samples: Sample[]
  median: Record<keyof Sample, number | null>
}
interface QaWindow {
  __xiraniteQA?: {
    hideView(view: "cards"): void
    stage(module: string, options: { view: "cards"; surface: "compact"; fresh: boolean }): void
  }
  __XIRANITE_BACKEND__?: unknown
}

const options = parseArgs(process.argv.slice(2))
const output = path.resolve(options.output)
await mkdir(output, { recursive: true })
const backend = await startBackend({ token: "react-compiler-benchmark", repository: createMemoryWorkspaceRepository() })

try {
  const results: ModeResult[] = []
  for (const mode of modes) results.push(await benchmarkMode(mode))
  const report = {
    generatedAt: new Date().toISOString(),
    environment: { platform: process.platform, bun: Bun.version, iterations: options.iterations, cardsPerInteraction: options.cards, baseline: "annotation", optimized: "infer" },
    results,
    deltas: compare(results[0], results[1]),
  }
  await writeFile(path.join(output, "results.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8")
  await writeFile(path.join(output, "report.md"), renderMarkdown(report), "utf8")
  console.log(`React Compiler benchmark report: ${path.relative(repoRoot, path.join(output, "report.md"))}`)
} finally {
  backend.close()
}

async function benchmarkMode(mode: CompilerMode): Promise<ModeResult> {
  const modeOutput = path.join(output, mode)
  const startedAt = performance.now()
  await runBun(["x", "vite", "build", "--outDir", modeOutput], mode)
  const buildMs = performance.now() - startedAt
  const port = mode === "annotation" ? 4174 : 4175
  const preview = Bun.spawn(["bun", "x", "vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort", "--outDir", modeOutput], {
    cwd: repoRoot, env: compilerEnv(mode), stdout: "ignore", stderr: "pipe",
  })
  try {
    const baseUrl = `http://127.0.0.1:${port}`
    await waitForServer(baseUrl)
    const browser = await chromium.launch({ headless: true })
    try {
      const samples: Sample[] = []
      for (let index = 0; index < options.iterations; index += 1) samples.push(await collectSample(browser, baseUrl))
      return { mode, buildMs, samples, median: summarize(samples) }
    } finally { await browser.close() }
  } finally {
    preview.kill()
    await preview.exited
  }
}

async function collectSample(browser: Browser, baseUrl: string): Promise<Sample> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const cdp = await page.context().newCDPSession(page)
  try {
    await page.addInitScript((config) => { (window as unknown as QaWindow).__XIRANITE_BACKEND__ = config }, { baseUrl: backend.url, token: backend.token })
    const startedAt = performance.now()
    await page.goto(`${baseUrl}/?workspace=ws-default`, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(() => Boolean((window as unknown as QaWindow).__xiraniteQA))
    await page.locator("main").waitFor({ state: "visible" })
    const readyMs = performance.now() - startedAt
    const before = toMetricMap(await cdp.send("Performance.getMetrics"))
    const mountCardsMs = await page.evaluate(async (cards) => {
      const qa = (window as unknown as QaWindow).__xiraniteQA
      if (!qa) throw new Error("QA controller is unavailable")
      const start = performance.now()
      qa.hideView("cards")
      for (let index = 0; index < cards; index += 1) qa.stage("scratch", { view: "cards", surface: "compact", fresh: true })
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      return performance.now() - start
    }, options.cards)
    const after = toMetricMap(await cdp.send("Performance.getMetrics"))
    const fcpMs = await page.evaluate(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null)
    return { readyMs, fcpMs, mountCardsMs, scriptDurationMs: deltaMetric(before, after, "ScriptDuration"), taskDurationMs: deltaMetric(before, after, "TaskDuration"), layoutDurationMs: deltaMetric(before, after, "LayoutDuration") }
  } finally {
    await cdp.detach()
    await page.close()
  }
}

async function runBun(args: string[], mode: CompilerMode): Promise<void> {
  const command = Bun.spawn(["bun", ...args], { cwd: repoRoot, env: compilerEnv(mode), stdout: "inherit", stderr: "inherit" })
  if (await command.exited) throw new Error(`${args.join(" ")} failed for ${mode}`)
}

function compilerEnv(mode: CompilerMode): Record<string, string | undefined> {
  return { ...process.env, XIRANITE_REACT_COMPILER_MODE: mode }
}

async function waitForServer(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await fetch(baseUrl).then((response) => response.ok).catch(() => false)) return
    await Bun.sleep(100)
  }
  throw new Error(`Timed out waiting for ${baseUrl}`)
}

function toMetricMap(result: { metrics: Array<{ name: string; value: number }> }): Map<string, number> {
  return new Map(result.metrics.map((metric) => [metric.name, metric.value]))
}

function deltaMetric(before: Map<string, number>, after: Map<string, number>, name: string): number | null {
  const start = before.get(name); const end = after.get(name)
  return start === undefined || end === undefined ? null : (end - start) * 1_000
}

function summarize(samples: Sample[]): Record<keyof Sample, number | null> {
  const keys: Array<keyof Sample> = ["readyMs", "fcpMs", "mountCardsMs", "scriptDurationMs", "taskDurationMs", "layoutDurationMs"]
  return Object.fromEntries(keys.map((key) => [key, median(samples.map((sample) => sample[key]))])) as Record<keyof Sample, number | null>
}

function median(values: Array<number | null>): number | null {
  const sorted = values.filter((value): value is number => value !== null).sort((left, right) => left - right)
  if (!sorted.length) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function compare(baseline: ModeResult | undefined, optimized: ModeResult | undefined) {
  if (!baseline || !optimized) return {}
  return Object.fromEntries((Object.keys(baseline.median) as Array<keyof Sample>).map((metric) => {
    const before = baseline.median[metric]; const after = optimized.median[metric]
    return [metric, { before, after, percentChange: before && after !== null ? ((after - before) / before) * 100 : null }]
  }))
}

function renderMarkdown(report: { environment: { iterations: number; cardsPerInteraction: number }; results: ModeResult[]; deltas: ReturnType<typeof compare> }): string {
  const lines = ["# React Compiler benchmark", "", `- Iterations per mode: ${report.environment.iterations}`, `- Fixed interaction: mount ${report.environment.cardsPerInteraction} Scratch cards, then wait for two animation frames.`, "- Negative percentages are improvements (less time).", "", "| Metric (median ms) | annotation baseline | infer | Change |", "| --- | ---: | ---: | ---: |"]
  for (const [metric, delta] of Object.entries(report.deltas)) {
    const values = delta as { before: number | null; after: number | null; percentChange: number | null }
    lines.push(`| ${metric} | ${format(values.before)} | ${format(values.after)} | ${formatPercent(values.percentChange)} |`)
  }
  lines.push("", "## Build time", "", "| Mode | Build time (ms) |", "| --- | ---: |")
  for (const result of report.results) lines.push(`| ${result.mode} | ${format(result.buildMs)} |`)
  return `${lines.join("\n")}\n`
}

function format(value: number | null): string { return value === null ? "n/a" : value.toFixed(2) }
function formatPercent(value: number | null): string { return value === null ? "n/a" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` }

function parseArgs(args: string[]): Options {
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d+Z$/, "Z")
  const parsed: Options = { iterations: 7, cards: 24, output: path.join(repoRoot, "artifacts", "react-compiler-benchmark", stamp) }
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]; const value = args[index + 1]
    if (flag === "--iterations" && value) { parsed.iterations = positive(value, flag); index += 1 }
    else if (flag === "--cards" && value) { parsed.cards = positive(value, flag); index += 1 }
    else if (flag === "--output" && value) { parsed.output = value; index += 1 }
    else if (flag === "--help" || flag === "-h") { console.log("Usage: bun run benchmark:react-compiler -- [--iterations 7] [--cards 24] [--output artifacts/react-compiler-benchmark/run]"); process.exit(0) }
    else throw new Error(`Unknown or incomplete option: ${flag}`)
  }
  return parsed
}

function positive(value: string, flag: string): number {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) throw new Error(`${flag} must be a positive integer`)
  return number
}
