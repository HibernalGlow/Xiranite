import { describe, expect, it, vi } from "vitest"

import { ReaderHttpController } from "./ReaderHttpController.js"
import { DEFAULT_NEOVIEW_SYSTEM_MONITOR_CONFIG } from "../../application/config/ReaderRuntimeConfig.js"

describe("Reader system monitor HTTP", () => {
  it("[neoview.system-monitor.transport-http] protects and samples only the dedicated route", async () => {
    const sample = vi.fn(async () => snapshot())
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "system-monitor-token",
      systemMonitorService: { sample },
    })
    try {
      expect((await controller.handle(new Request("http://127.0.0.1:41000/reader/diagnostics/system")))?.status).toBe(401)
      expect(sample).not.toHaveBeenCalled()
      const response = (await controller.handle(authorized("/reader/diagnostics/system")))!
      expect(response.status).toBe(200)
      expect(response.headers.get("cache-control")).toBe("no-store")
      await expect(response.json()).resolves.toEqual(snapshot())
      expect(sample).toHaveBeenCalledOnce()
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.system-monitor.persistence-http] returns and persists bounded monitor preferences", async () => {
    const updateSystemMonitor = vi.fn(async (patch) => ({
      ...DEFAULT_NEOVIEW_SYSTEM_MONITOR_CONFIG,
      ...patch.systemMonitor,
    }))
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "system-monitor-token",
      updateSystemMonitor,
    })
    try {
      await expect((await controller.handle(authorized("/reader/config")))!.json()).resolves.toMatchObject({
        systemMonitor: DEFAULT_NEOVIEW_SYSTEM_MONITOR_CONFIG,
      })
      const updated = (await controller.handle(authorized("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ systemMonitor: { enabled: false, refreshIntervalMs: 2_000, maxSamples: 30 } }),
      })))!
      expect(updated.status).toBe(200)
      await expect(updated.json()).resolves.toMatchObject({
        systemMonitor: { enabled: false, refreshIntervalMs: 2_000, maxSamples: 30 },
      })
      expect(updateSystemMonitor).toHaveBeenCalledWith(
        { systemMonitor: { enabled: false, refreshIntervalMs: 2_000, maxSamples: 30 } },
        { performance: { monitor: { enabled: false, refresh_interval_ms: 2_000, max_samples: 30 } } },
      )
      const invalid = (await controller.handle(authorized("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ systemMonitor: { refreshIntervalMs: 750 } }),
      })))!
      expect(invalid.status).toBe(400)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

function authorized(path: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers)
  headers.set("x-xiranite-token", "system-monitor-token")
  return new Request(`http://127.0.0.1:41000${path}`, { ...init, headers })
}

function snapshot() {
  return {
    schemaVersion: 1 as const,
    sampledAtMs: 123,
    uptimeSeconds: 90,
    loadAverage: [1, 2, 3] as const,
    cpu: { averageUsagePercent: 25, cores: [{ index: 0, usagePercent: 25 }] },
    memory: { totalBytes: 100, usedBytes: 40, freeBytes: 60, cachedBytes: null },
    network: { available: false as const, reason: "unavailable", receiveBytesPerSecond: null, transmitBytesPerSecond: null },
    disk: { available: true, totalBytes: 200, usedBytes: 50, freeBytes: 150 },
    gpu: { available: false as const, reason: "unavailable" },
  }
}
