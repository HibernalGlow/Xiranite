import { describe, expect, it } from "bun:test"

import { EventLoopDelaySampler, ProcessResourceSampler, ProcessTreeSampler, summarize } from "./runtime-benchmark-metrics"

describe("runtime benchmark metrics", () => {
  it("summarizes latency percentiles deterministically", () => {
    expect(summarize([5, 1, 4, 2, 3])).toEqual({
      samples: 5,
      min: 1,
      p50: 3,
      p95: 5,
      p99: 5,
      max: 5,
      average: 3,
    })
    expect(summarize([])).toMatchObject({ samples: 0, p95: 0, max: 0 })
  })

  it("samples event-loop delay and Bun process resources", async () => {
    const eventLoop = new EventLoopDelaySampler(2)
    const processResources = new ProcessResourceSampler(5)
    eventLoop.start()
    processResources.start()
    await Bun.sleep(20)
    const eventLoopSummary = await eventLoop.stop()
    const processSummary = processResources.stop()
    expect(eventLoopSummary.samples).toBeGreaterThan(0)
    expect(eventLoopSummary.max).toBeGreaterThanOrEqual(0)
    expect(processSummary.elapsedMs).toBeGreaterThan(0)
    expect(processSummary.rssPeakMiB).toBeGreaterThan(0)
    expect(processResources.samples().length).toBeGreaterThan(1)
    expect(processResources.samples()[0]).toMatchObject({
      timestampMs: expect.any(Number),
      rssBytes: expect.any(Number),
      heapUsedBytes: expect.any(Number),
      externalBytes: expect.any(Number),
      arrayBuffersBytes: expect.any(Number),
    })
  })

  it("streams Windows process-tree samples without one-shot sampling gaps", async () => {
    if (process.platform !== "win32") return
    const sampler = new ProcessTreeSampler(process.pid, 500, { refreshTreeIntervalMs: 0 })
    let stopped = false
    sampler.start()
    try {
      await sampler.waitForFirstSample()
      await Bun.sleep(1_800)
      const summary = await sampler.stop()
      stopped = true
      const samples = sampler.samples()
      const gaps = samples.slice(1).map((sample, index) => sample.timestampMs - samples[index]!.timestampMs)
      expect(summary.available).toBe(true)
      expect(samples.length).toBeGreaterThanOrEqual(3)
      expect(Math.max(...gaps)).toBeLessThanOrEqual(1_000)
      expect(summary.peakPrivateMiB).toBeGreaterThan(0)
      expect(samples.every((sample) => sample.rootPrivateBytes > 0)).toBe(true)
    } finally {
      if (!stopped) await sampler.stop()
    }
  })
})
