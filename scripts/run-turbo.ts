#!/usr/bin/env bun
import { availableParallelism, freemem } from "node:os"
import { resolve } from "node:path"
import { getDisabledNodeIds } from "./lib/node-build-config.js"

const GIB = 1024 ** 3
const RESERVED_MEMORY_GIB = 8
const MEMORY_PER_TASK_GIB = 5
// TypeScript 7 native builds are individually cheap but dozens of concurrent
// compiler processes can exhaust the Windows commit limit. Keep repository-wide
// tasks sequential by default; developers with more headroom may opt in.
const requestedConcurrency = Number.parseInt(process.env.XIRANITE_TASK_CONCURRENCY ?? "1", 10)
const MAX_CONCURRENCY = Number.isFinite(requestedConcurrency) && requestedConcurrency > 0 ? requestedConcurrency : 1

const [task, ...args] = process.argv.slice(2)
if (!task) {
  console.error("Usage: bun scripts/run-turbo.ts <task> [...turbo arguments]")
  process.exit(2)
}

const freeMemoryGiB = freemem() / GIB
const memoryLimit = Math.floor(Math.max(0, freeMemoryGiB - RESERVED_MEMORY_GIB) / MEMORY_PER_TASK_GIB)
const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, availableParallelism(), memoryLimit))
const repoRoot = resolve(import.meta.dirname, "..")
const disabledNodeIds = args.some((arg) => arg.includes("packages/nodes/*"))
  ? await getDisabledNodeIds({ cwd: repoRoot })
  : []
const nodeFilters = disabledNodeIds.map((id) => `--filter=!@xiranite/node-${id}`)

console.log(`[turbo] ${freeMemoryGiB.toFixed(1)} GiB free; using ${concurrency} concurrent task${concurrency === 1 ? "" : "s"}.`)
if (disabledNodeIds.length > 0) console.log(`[turbo] Disabled nodes: ${disabledNodeIds.join(", ")}.`)

const turbo = Bun.spawn([process.execPath, "x", "turbo", "run", task, `--concurrency=${concurrency}`, ...args, ...nodeFilters], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

process.exit(await turbo.exited)
