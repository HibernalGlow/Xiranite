import { convertBatch, getSlimgInfo } from "@xiranite/slimg-native"
import type { SlimgBatchOptions, SlimgBatchResult } from "@xiranite/slimg-native"
import { availableParallelism } from "node:os"
import type { XlchemyToolStatus } from "./core.js"

const MAX_BATCH_FILES = 64
const BATCH_WINDOW_MS = 20

type BatchRunner = (options: SlimgBatchOptions) => Promise<SlimgBatchResult>
type PendingConversion = {
  sourcePath: string
  outputPath: string
  jobs: number
  resolve: () => void
  reject: (error: Error) => void
}

export async function probeSlimg(): Promise<XlchemyToolStatus> {
  const path = process.env.XIRANITE_SLIMG_NATIVE_PATH?.trim() || "@xiranite/slimg-native"
  try {
    const info = getSlimgInfo()
    const runnable = info.formats.includes("avif")
    return {
      id: "slimg-node",
      label: "slimg Node-API",
      purpose: "slimg native AVIF encoding",
      path,
      available: true,
      runnable,
      detail: runnable
        ? `Node-API v${info.apiVersion} loaded; bounded native batches enabled.`
        : "Node-API loaded, but AVIF encoding is unavailable.",
    }
  } catch (error) {
    return {
      id: "slimg-node",
      label: "slimg Node-API",
      purpose: "slimg native AVIF encoding",
      path,
      available: false,
      runnable: false,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

export function createSlimgConverter(runBatch: BatchRunner = convertBatch) {
  const queues = new Map<number, PendingConversion[]>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let flushing = false
  let batchSequence = 0

  const scheduleFlush = () => {
    if (timer || flushing) return
    timer = setTimeout(() => { void flush() }, BATCH_WINDOW_MS)
  }

  const flush = async () => {
    if (flushing) return
    if (timer) clearTimeout(timer)
    timer = undefined
    flushing = true
    try {
      for (const [quality, queue] of queues) {
        const pending = queue.splice(0, MAX_BATCH_FILES)
        if (!queue.length) queues.delete(quality)
        if (!pending.length) continue
        try {
          const requestedJobs = pending.reduce((total, item) => total + item.jobs, 0)
          const result = await runBatch({
            files: pending.map(({ sourcePath, outputPath }) => ({ sourcePath, outputPath })),
            format: "avif",
            quality,
            jobs: slimgWorkerJobs(requestedJobs),
            overwrite: true,
            batchId: `xlchemy-${process.pid}-${Date.now()}-${++batchSequence}`,
          })
          for (const [index, request] of pending.entries()) {
            const file = result.files[index]
            if (file?.success) request.resolve()
            else request.reject(new Error(file?.cancelled ? "slimg conversion cancelled." : file?.error || "slimg did not return a file result."))
          }
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error))
          for (const request of pending) request.reject(failure)
        }
      }
    } finally {
      flushing = false
      if (queues.size) scheduleFlush()
    }
  }

  return (sourcePath: string, outputPath: string, quality: number, jobs = 1): Promise<void> => new Promise((resolve, reject) => {
    const normalizedQuality = Math.max(0, Math.min(100, Math.round(quality)))
    const queue = queues.get(normalizedQuality) ?? []
    queue.push({ sourcePath, outputPath, jobs: Math.max(1, Math.round(jobs)), resolve, reject })
    queues.set(normalizedQuality, queue)
    scheduleFlush()
  })
}

export function slimgWorkerJobs(requestedJobs: number, logicalCpus = availableParallelism()): number {
  const requested = Math.max(1, Math.round(requestedJobs))
  return Math.min(1_024, Math.max(1, logicalCpus), requested)
}

export const convertWithSlimg = createSlimgConverter()
