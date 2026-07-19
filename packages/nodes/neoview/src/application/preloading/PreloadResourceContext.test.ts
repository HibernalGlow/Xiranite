import { describe, expect, it } from "vitest"

import { deriveReaderPreloadResourceContext } from "./PreloadResourceContext.js"

describe("deriveReaderPreloadResourceContext", () => {
  it("[neoview.preload.resource-context] uses the worst current pool wait and existing pressure level", () => {
    expect(deriveReaderPreloadResourceContext({
      scheduler: {
        cpu: { oldestQueuedWaitMs: 12 },
        io: { oldestQueuedWaitMs: 45 },
        gpu: { oldestQueuedWaitMs: 3 },
      },
      memoryPressure: { level: "elevated" },
    })).toEqual({ queueWaitMs: 45, memoryPressure: "elevated" })
  })

  it("[neoview.preload.resource-context-shared-scheduler] uses truthful fallback shared-queue wait without inventing resource pools", () => {
    expect(deriveReaderPreloadResourceContext({
      sharedScheduler: { oldestQueuedWaitMs: 275 },
      memoryPressure: { level: "normal" },
    })).toEqual({ queueWaitMs: 275, memoryPressure: "normal" })
  })

  it("[neoview.preload.resource-context-compat] tolerates old or malformed optional diagnostics without unsafe admission values", () => {
    expect(deriveReaderPreloadResourceContext({ scheduler: { cpu: {} } })).toEqual({ queueWaitMs: 0, memoryPressure: "normal" })
    expect(deriveReaderPreloadResourceContext({
      scheduler: { cpu: { oldestQueuedWaitMs: Number.NaN }, io: { oldestQueuedWaitMs: 90_000 } },
      memoryPressure: { level: "unknown" },
    })).toEqual({ queueWaitMs: 60_000, memoryPressure: "normal" })
  })
})
