import { describe, expect, it } from "bun:test"

import { EventLoopDelaySampler, ProcessResourceSampler, summarize } from "./runtime-benchmark-metrics"

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
  })
})
