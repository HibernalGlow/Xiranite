import { describe, expect, test } from "vitest"
import { DEFAULT_NODE_MEMORY_PROTECTION_SETTINGS } from "@xiranite/shared"
import { resolveNodeMemoryProtectionPolicy } from "@xiranite/services"

import { createBackendNodeMemoryProtection, createBackendNodeMemoryProtectionController } from "./nodeRunner.js"

describe("backend node memory protection", () => {
  test("applies per-node policy overrides and accepts environment overrides", () => {
    const defaults = createBackendNodeMemoryProtection({})
    const defaultPolicy = resolveNodeMemoryProtectionPolicy(defaults, "repacku")

    expect(defaultPolicy).toMatchObject({
      maxRssGrowthBytes: 8_192 * 1024 * 1024,
      maxHeapGrowthBytes: 4_096 * 1024 * 1024,
      maxRetainedEvents: 1_000,
      sampleIntervalMs: 250,
    })

    const withOverride = {
      defaultPolicy: DEFAULT_NODE_MEMORY_PROTECTION_SETTINGS.defaultPolicy,
      nodePolicies: {
        "synthetic-heavy": {
          maxRssGrowthMiB: 16_384,
          maxHeapGrowthMiB: 2_048,
          maxRetainedEvents: 256,
          sampleIntervalMs: 100,
        },
      },
    }
    expect(resolveNodeMemoryProtectionPolicy(withOverride, "synthetic-heavy")).toMatchObject({
      maxRssGrowthBytes: 16_384 * 1024 * 1024,
      maxHeapGrowthBytes: 2_048 * 1024 * 1024,
      maxRetainedEvents: 256,
      sampleIntervalMs: 100,
    })
    expect(resolveNodeMemoryProtectionPolicy(withOverride, "repacku")).toMatchObject(defaultPolicy)

    const overridden = createBackendNodeMemoryProtection({
      XIRANITE_NODE_MAX_RSS_GROWTH_MIB: "3072",
      XIRANITE_NODE_MAX_HEAP_GROWTH_MIB: "1536",
      XIRANITE_NODE_MAX_RETAINED_EVENTS: "128",
    })
    expect(resolveNodeMemoryProtectionPolicy(overridden, "repacku")).toMatchObject({
      maxRssGrowthBytes: 3_072 * 1024 * 1024,
      maxHeapGrowthBytes: 1_536 * 1024 * 1024,
      maxRetainedEvents: 128,
      sampleIntervalMs: 250,
    })
  })

  test("hot-applies user settings while preserving memory sampling", () => {
    const readMemoryUsage = () => ({ rssBytes: 100, heapUsedBytes: 50 })
    const controller = createBackendNodeMemoryProtectionController({}, { readMemoryUsage })
    const applied = controller.applySettings({
      defaultPolicy: {
        maxRssGrowthMiB: 3_072,
        maxHeapGrowthMiB: 1_536,
        maxRetainedEvents: 640,
        sampleIntervalMs: 175,
      },
      nodePolicies: {
        "synthetic-heavy": {
          maxRssGrowthMiB: 1_024,
          maxHeapGrowthMiB: 768,
          maxRetainedEvents: 128,
          sampleIntervalMs: 75,
        },
      },
    })

    expect(controller.options.readMemoryUsage).toBe(readMemoryUsage)
    expect(resolveNodeMemoryProtectionPolicy(controller.options, "example")).toMatchObject({
      maxRssGrowthBytes: 3_072 * 1024 * 1024,
      maxHeapGrowthBytes: 1_536 * 1024 * 1024,
      maxRetainedEvents: 640,
      sampleIntervalMs: 175,
    })
    expect(resolveNodeMemoryProtectionPolicy(controller.options, "synthetic-heavy")).toMatchObject({
      maxRssGrowthBytes: 1_024 * 1024 * 1024,
      maxHeapGrowthBytes: 768 * 1024 * 1024,
      maxRetainedEvents: 128,
      sampleIntervalMs: 75,
    })

    applied.defaultPolicy.maxRssGrowthMiB = 1
    expect(controller.getSettings().defaultPolicy.maxRssGrowthMiB).toBe(3_072)
  })
})
