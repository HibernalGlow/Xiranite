import { describe, expect, it, vi } from "vitest"

import { ReaderSystemMonitorService, type ReaderSystemMonitorSource } from "./ReaderSystemMonitorService.js"

describe("ReaderSystemMonitorService", () => {
  it("[neoview.system-monitor.transport] returns bounded deltas and honest unavailable capabilities", async () => {
    const source = fixtureSource()
    const service = new ReaderSystemMonitorService(source)

    const first = await service.sample()
    source.cpuTimes = () => [cpu(150, 50), cpu(140, 60)]
    const second = await service.sample()

    expect(first).toMatchObject({
      schemaVersion: 1,
      sampledAtMs: 123,
      uptimeSeconds: 90,
      loadAverage: [1, 2, 3],
      memory: { totalBytes: 1_000, usedBytes: 400, freeBytes: 600, cachedBytes: null },
      disk: { available: true, totalBytes: 2_000, usedBytes: 500, freeBytes: 1_500 },
      network: { available: false, receiveBytesPerSecond: null, transmitBytesPerSecond: null },
      gpu: { available: false },
    })
    expect(second.cpu.cores.map((core) => core.usagePercent)).toEqual([50, 40])
    expect(second.cpu.averageUsagePercent).toBe(45)
  })

  it("[neoview.system-monitor.singleflight] shares concurrent sampling and recovers after failure", async () => {
    const pending = Promise.withResolvers<{ totalBytes: number; freeBytes: number }>()
    const source = fixtureSource()
    source.diskSpace = vi.fn(() => pending.promise)
    const service = new ReaderSystemMonitorService(source)

    const first = service.sample()
    const second = service.sample()
    expect(first).toBe(second)
    expect(source.diskSpace).toHaveBeenCalledOnce()
    pending.resolve({ totalBytes: 100, freeBytes: 25 })
    await expect(first).resolves.toMatchObject({ disk: { available: true } })

    source.diskSpace = vi.fn(async () => { throw new Error("offline") })
    await expect(service.sample()).resolves.toMatchObject({ disk: { available: false, totalBytes: null } })
  })
})

function fixtureSource(): ReaderSystemMonitorSource {
  return {
    now: () => 123,
    cpuTimes: () => [cpu(100, 0), cpu(100, 0)],
    uptime: () => 90,
    loadAverage: () => [1, 2, 3],
    totalMemory: () => 1_000,
    freeMemory: () => 600,
    diskSpace: async () => ({ totalBytes: 2_000, freeBytes: 1_500 }),
  }
}

function cpu(busy: number, idle: number) {
  return { user: busy, nice: 0, sys: 0, idle, irq: 0 }
}
