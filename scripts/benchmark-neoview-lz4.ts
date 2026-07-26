#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { performance } from "node:perf_hooks"
import { parseArgs } from "node:util"

import { decodeLegacyThumbnailBlob } from "../packages/nodes/neoview/src/platform/thumbnails/ThumbnailBlobCodec"
import {
  EventLoopDelaySampler,
  ProcessResourceSampler,
  round,
  summarize,
} from "./lib/runtime-benchmark-metrics"

const MIB = 1024 * 1024
const args = parseArgs({
  options: {
    "output-mib": { type: "string", default: "16" },
    iterations: { type: "string", default: "8" },
    "baseline-ms": { type: "string", default: "500" },
    "assert-event-loop-p99-ms": { type: "string" },
    "assert-event-loop-excess-p99-ms": { type: "string" },
  },
  strict: true,
  allowPositionals: false,
})
const outputMiB = integer(args.values["output-mib"], "output-mib", 1, 256)
const iterations = integer(args.values.iterations, "iterations", 1, 1_000)
const baselineMs = integer(args.values["baseline-ms"], "baseline-ms", 100, 60_000)
const eventLoopBudget = optionalPositive(args.values["assert-event-loop-p99-ms"], "assert-event-loop-p99-ms")
const eventLoopExcessBudget = optionalPositive(args.values["assert-event-loop-excess-p99-ms"], "assert-event-loop-excess-p99-ms")

const source = repeatingThumbnailBytes(outputMiB * MIB)
const stored = await encodeLegacyLz4Block(source)
const warm = await decodeLegacyThumbnailBlob(stored, source.byteLength)
if (!equalBytes(warm.bytes, source)) throw new Error("LZ4 warmup returned different bytes.")

const baselineSampler = new EventLoopDelaySampler(2)
baselineSampler.start()
await Bun.sleep(baselineMs)
const baselineEventLoopDelayMs = await baselineSampler.stop()

const eventLoop = new EventLoopDelaySampler(2)
const processResources = new ProcessResourceSampler(5)
const durations: number[] = []
let decodedBytes = 0
eventLoop.start()
processResources.start()
for (let iteration = 0; iteration < iterations; iteration += 1) {
  const started = performance.now()
  const decoded = await decodeLegacyThumbnailBlob(stored, source.byteLength)
  durations.push(performance.now() - started)
  decodedBytes += decoded.bytes.byteLength
  await Bun.sleep(0)
}
const eventLoopDelay = await eventLoop.stop()
const bunProcess = processResources.stop()
const elapsedMs = durations.reduce((sum, value) => sum + value, 0)
const eventLoopP99ExcessMs = round(Math.max(0, eventLoopDelay.p99 - baselineEventLoopDelayMs.p99))
const report = {
  benchmark: "neoview-lz4-thumbnail-js",
  runtime: `Bun ${Bun.version}`,
  implementation: "lz4js decompressBlock on the Bun event loop",
  sample: {
    outputMiB,
    compressedMiB: round(stored.byteLength / MIB),
    iterations,
    sha256: createHash("sha256").update(source).digest("hex"),
  },
  decodeMs: summarize(durations),
  baseline: { durationMs: baselineMs, eventLoopDelayMs: baselineEventLoopDelayMs },
  eventLoopDelayMs: eventLoopDelay,
  eventLoopP99ExcessMs,
  throughputMiBPerSecond: round(decodedBytes / MIB / (elapsedMs / 1_000)),
  resources: { bunProcess },
}
if (eventLoopBudget !== undefined && report.eventLoopDelayMs.p99 > eventLoopBudget) {
  throw new Error(`LZ4 event-loop p99 ${report.eventLoopDelayMs.p99} ms > ${eventLoopBudget} ms.`)
}
if (eventLoopExcessBudget !== undefined && report.eventLoopP99ExcessMs > eventLoopExcessBudget) {
  throw new Error(`LZ4 event-loop p99 excess ${report.eventLoopP99ExcessMs} ms > ${eventLoopExcessBudget} ms.`)
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

async function encodeLegacyLz4Block(sourceBytes: Uint8Array): Promise<Uint8Array> {
  const { compressBlock, makeBuffer } = await import("lz4js")
  const compressed = new Uint8Array(sourceBytes.byteLength + Math.ceil(sourceBytes.byteLength / 255) + 32)
  const compressedBytes = compressBlock(sourceBytes, compressed, 0, sourceBytes.byteLength, makeBuffer(1 << 16))
  if (compressedBytes <= 0) throw new Error("The generated LZ4 fixture was not compressible.")
  const stored = new Uint8Array(8 + compressedBytes)
  stored.set([0x4c, 0x5a, 0x34, 0x00])
  new DataView(stored.buffer).setUint32(4, sourceBytes.byteLength, true)
  stored.set(compressed.subarray(0, compressedBytes), 8)
  return stored
}

function repeatingThumbnailBytes(length: number): Uint8Array {
  const output = new Uint8Array(length)
  const pattern = Uint8Array.from(Buffer.from("89504e470d0a1a0a4e656f566965772d7468756d626e61696c2d6c7a34", "hex"))
  for (let offset = 0; offset < output.length; offset += pattern.length) {
    output.set(pattern.subarray(0, Math.min(pattern.length, output.length - offset)), offset)
  }
  return output
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
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
