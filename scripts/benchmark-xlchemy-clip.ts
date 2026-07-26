#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { performance } from "node:perf_hooks"
import { parseArgs } from "node:util"

import { convertClipToPsd } from "../packages/nodes/xlchemy/src/clip-to-psd"
import {
  EventLoopDelaySampler,
  ProcessResourceSampler,
  round,
  summarize,
} from "./lib/runtime-benchmark-metrics"

const MIB = 1024 * 1024
const args = parseArgs({
  options: {
    source: { type: "string" },
    iterations: { type: "string", default: "1" },
    "assert-event-loop-p99-ms": { type: "string" },
  },
  strict: true,
  allowPositionals: false,
})
if (!args.values.source) throw new Error("--source must point to a real .clip file.")
const source = resolve(args.values.source)
if (!source.toLowerCase().endsWith(".clip")) throw new Error("--source must use the .clip extension.")
const sourceInfo = await stat(source)
if (!sourceInfo.isFile()) throw new Error("--source must point to a file.")
const iterations = integer(args.values.iterations, "iterations", 1, 20)
const eventLoopBudget = optionalPositive(args.values["assert-event-loop-p99-ms"], "assert-event-loop-p99-ms")
const workspace = await mkdtemp(join(tmpdir(), "xiranite-clip-benchmark-"))

try {
  const eventLoop = new EventLoopDelaySampler(2)
  const processResources = new ProcessResourceSampler(5)
  const durations: number[] = []
  let outputBytes = 0
  eventLoop.start()
  processResources.start()
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const output = join(workspace, `output-${iteration + 1}.psd`)
    const started = performance.now()
    await convertClipToPsd(source, output)
    durations.push(performance.now() - started)
    outputBytes = (await stat(output)).size
    await Bun.sleep(0)
  }
  const eventLoopDelayMs = await eventLoop.stop()
  const bunProcess = processResources.stop()
  const report = {
    benchmark: "xlchemy-clip-to-psd-js",
    runtime: `Bun ${Bun.version}`,
    source: {
      name: basename(source),
      inputMiB: round(sourceInfo.size / MIB),
      sha256: createHash("sha256").update(await readFile(source)).digest("hex"),
    },
    iterations,
    outputMiB: round(outputBytes / MIB),
    conversionMs: summarize(durations),
    eventLoopDelayMs,
    resources: { bunProcess },
  }
  if (eventLoopBudget !== undefined && eventLoopDelayMs.p99 > eventLoopBudget) {
    throw new Error(`CLIP event-loop p99 ${eventLoopDelayMs.p99} ms > ${eventLoopBudget} ms.`)
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} finally {
  await rm(workspace, { recursive: true, force: true })
}

function integer(value: string | undefined, name: string, minimum: number, maximum: number): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(`--${name} must be an integer from ${minimum} to ${maximum}.`)
  }
  return parsed
}

function optionalPositive(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new RangeError(`--${name} must be positive.`)
  return parsed
}
