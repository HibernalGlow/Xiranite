import { describe, expect, it } from "vitest"

import { createBackendResourceScheduler } from "./resourceScheduler.js"

describe("createBackendResourceScheduler", () => {
  it("[backend.scheduler.hardware-budget] derives a weighted CPU budget and keeps interactive capacity", async () => {
    const scheduler = createBackendResourceScheduler({}, 12, 16 * 1_024 * 1_024 * 1_024)
    expect(scheduler.snapshot().cpu).toMatchObject({ maxWeight: 12, reservedInteractiveWeight: 2 })
    expect(scheduler.snapshot().memory).toMatchObject({ maxMiB: 9_830, reservedInteractiveMiB: 512 })
    const batch = await scheduler.acquire({
      resource: "cpu",
      kind: "xlchemy.image-convert",
      priority: "background",
      weight: 12,
      minimumWeight: 1,
    })
    expect(batch.weight).toBe(10)
    const interactive = await scheduler.acquire({
      resource: "cpu",
      kind: "neoview.image-transform",
      priority: "interactive",
      weight: 2,
    })
    expect(interactive.weight).toBe(2)
    interactive.release()
    batch.release()
  })

  it("[backend.scheduler.environment] accepts bounded runtime overrides", () => {
    const scheduler = createBackendResourceScheduler({
      XIRANITE_CPU_WEIGHT: "6",
      XIRANITE_CPU_MAX_CONCURRENT: "3",
      XIRANITE_CPU_RESERVED_INTERACTIVE_WEIGHT: "1",
      XIRANITE_CPU_RESERVED_INTERACTIVE: "1",
      XIRANITE_IO_WEIGHT: "2",
      XIRANITE_IO_MAX_CONCURRENT: "2",
      XIRANITE_MEMORY_BUDGET_MIB: "2048",
      XIRANITE_MEMORY_RESERVED_INTERACTIVE_MIB: "256",
    }, 24, 32 * 1_024 * 1_024 * 1_024)
    expect(scheduler.snapshot()).toMatchObject({
      cpu: { maxWeight: 6, reservedInteractiveWeight: 1 },
      io: { maxWeight: 2, reservedInteractiveWeight: 1 },
      memory: { maxMiB: 2_048, reservedInteractiveMiB: 256 },
    })
  })
})
