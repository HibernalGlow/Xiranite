import { describe, expect, test, vi } from "vitest"
import type { SlimgBatchOptions, SlimgBatchResult } from "@xiranite/slimg-native"
import { createSlimgConverter, slimgWorkerJobs } from "./slimg.js"

describe("slimg Node-API batching", () => {
  test("coalesces concurrent files and preserves the CPU job budget", async () => {
    const calls: SlimgBatchOptions[] = []
    const converter = createSlimgConverter(async (options) => {
      calls.push(options)
      return successfulResult(options)
    })

    await Promise.all([
      converter("/images/a.png", "/images/a.avif", 60, 2),
      converter("/images/b.png", "/images/b.avif", 60, 3),
      converter("/images/c.png", "/images/c.avif", 60, 1),
    ])

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ format: "avif", quality: 60, jobs: 6, overwrite: true })
    expect(calls[0]?.files).toEqual([
      { sourcePath: "/images/a.png", outputPath: "/images/a.avif" },
      { sourcePath: "/images/b.png", outputPath: "/images/b.avif" },
      { sourcePath: "/images/c.png", outputPath: "/images/c.avif" },
    ])
  })

  test("does not exceed the globally granted CPU budget or host capacity", () => {
    expect(slimgWorkerJobs(15, 16)).toBe(15)
    expect(slimgWorkerJobs(64, 16)).toBe(16)
    expect(slimgWorkerJobs(1, 16)).toBe(1)
  })

  test("rejects only the failed file in a native batch", async () => {
    const converter = createSlimgConverter(async (options) => {
      const result = successfulResult(options)
      result.files[1] = { ...result.files[1]!, success: false, error: "decode failed" }
      result.succeeded = 1
      result.failed = 1
      return result
    })

    const results = await Promise.allSettled([
      converter("/images/a.png", "/images/a.avif", 60),
      converter("/images/b.png", "/images/b.avif", 60),
    ])

    expect(results[0]?.status).toBe("fulfilled")
    expect(results[1]).toMatchObject({ status: "rejected", reason: new Error("decode failed") })
  })

  test("coalesces workers that reach the native queue a few milliseconds apart", async () => {
    vi.useFakeTimers()
    try {
      const calls: SlimgBatchOptions[] = []
      const converter = createSlimgConverter(async (options) => {
        calls.push(options)
        return successfulResult(options)
      })

      const first = converter("/images/a.png", "/images/a.avif", 60)
      await vi.advanceTimersByTimeAsync(10)
      const second = converter("/images/b.png", "/images/b.avif", 60)
      await vi.advanceTimersByTimeAsync(10)
      await Promise.all([first, second])

      expect(calls).toHaveLength(1)
      expect(calls[0]?.files).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

function successfulResult(options: SlimgBatchOptions): SlimgBatchResult {
  return {
    files: options.files.map((file) => ({
      ...file,
      success: true,
      cancelled: false,
      originalSize: 100,
      outputSize: 50,
      width: 1,
      height: 1,
      durationMs: 1,
    })),
    total: options.files.length,
    succeeded: options.files.length,
    failed: 0,
    cancelled: 0,
    durationMs: 1,
  }
}
