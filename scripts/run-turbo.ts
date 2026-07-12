#!/usr/bin/env bun
import { availableParallelism, freemem } from "node:os"

const GIB = 1024 ** 3
const RESERVED_MEMORY_GIB = 8
const MEMORY_PER_TASK_GIB = 5
const MAX_CONCURRENCY = 3

const [task, ...args] = process.argv.slice(2)
if (!task) {
  console.error("Usage: bun scripts/run-turbo.ts <task> [...turbo arguments]")
  process.exit(2)
}

const freeMemoryGiB = freemem() / GIB
const memoryLimit = Math.floor(Math.max(0, freeMemoryGiB - RESERVED_MEMORY_GIB) / MEMORY_PER_TASK_GIB)
const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, availableParallelism(), memoryLimit))

console.log(`[turbo] ${freeMemoryGiB.toFixed(1)} GiB free; using ${concurrency} concurrent task${concurrency === 1 ? "" : "s"}.`)

const turbo = Bun.spawn([process.execPath, "x", "turbo", "run", task, `--concurrency=${concurrency}`, ...args], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

process.exit(await turbo.exited)
