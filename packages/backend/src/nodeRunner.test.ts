import { describe, expect, test } from "vitest"
import { resolveNodeMemoryProtectionPolicy } from "@xiranite/services"

import { createBackendNodeMemoryProtection } from "./nodeRunner.js"

describe("backend node memory protection", () => {
  test("applies a stricter XLchemy policy and accepts environment overrides", () => {
    const defaults = createBackendNodeMemoryProtection({})
    const defaultPolicy = resolveNodeMemoryProtectionPolicy(defaults, "repacku")
    const xlchemyPolicy = resolveNodeMemoryProtectionPolicy(defaults, "xlchemy")

    expect(defaultPolicy).toMatchObject({
      maxRssGrowthBytes: 8_192 * 1024 * 1024,
      maxHeapGrowthBytes: 4_096 * 1024 * 1024,
      maxRetainedEvents: 1_000,
      sampleIntervalMs: 250,
    })
    expect(xlchemyPolicy).toMatchObject({
      maxRssGrowthBytes: 4_096 * 1024 * 1024,
      maxHeapGrowthBytes: 2_048 * 1024 * 1024,
      maxRetainedEvents: 256,
      sampleIntervalMs: 100,
    })

    const overridden = resolveNodeMemoryProtectionPolicy(createBackendNodeMemoryProtection({
      XIRANITE_XLCHEMY_MAX_RSS_GROWTH_MIB: "3072",
      XIRANITE_XLCHEMY_MAX_HEAP_GROWTH_MIB: "1536",
      XIRANITE_XLCHEMY_MAX_RETAINED_EVENTS: "128",
    }), "xlchemy")
    expect(overridden).toMatchObject({
      maxRssGrowthBytes: 3_072 * 1024 * 1024,
      maxHeapGrowthBytes: 1_536 * 1024 * 1024,
      maxRetainedEvents: 128,
    })
  })
})
