import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderSystemMonitorConfigDto, ReaderSystemMonitorSnapshotDto } from "../../../adapters/reader-http-client"
import SystemMonitorCard, { formatSystemMonitorBytes, formatSystemMonitorUptime } from "./SystemMonitorCard"

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.useRealTimers()
})

describe("SystemMonitorCard", () => {
  it("[neoview.system-monitor.performance] performs zero work while the Card is inactive", () => {
    const client = { config: vi.fn(), systemMonitorSnapshot: vi.fn() } as unknown as ReaderHttpClient
    render(<SystemMonitorCard {...props(client, false)} />)
    expect(client.config).not.toHaveBeenCalled()
    expect(client.systemMonitorSnapshot).not.toHaveBeenCalled()
  })

  it("[neoview.system-monitor.lifecycle] samples immediately, never overlaps, and aborts on deactivation", async () => {
    vi.useFakeTimers()
    const first = Promise.withResolvers<ReaderSystemMonitorSnapshotDto>()
    const second = Promise.withResolvers<ReaderSystemMonitorSnapshotDto>()
    const signals: AbortSignal[] = []
    const client = {
      config: vi.fn(async () => ({ systemMonitor: config({ enabled: true, refreshIntervalMs: 500 }) } as never)),
      systemMonitorSnapshot: vi.fn((signal?: AbortSignal) => {
        if (signal) signals.push(signal)
        return signals.length === 1 ? first.promise : second.promise
      }),
      updateSystemMonitor: vi.fn(),
    } as unknown as ReaderHttpClient
    const view = render(<SystemMonitorCard {...props(client)} />)

    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(client.systemMonitorSnapshot).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(client.systemMonitorSnapshot).toHaveBeenCalledTimes(1)

    first.resolve(snapshot())
    await act(async () => { await first.promise; await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByText("4 核")).toBeTruthy()
    expect(vi.getTimerCount()).toBe(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(client.systemMonitorSnapshot).toHaveBeenCalledTimes(2)

    view.rerender(<SystemMonitorCard {...props(client, false)} />)
    expect(signals[1]?.aborted).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(client.systemMonitorSnapshot).toHaveBeenCalledTimes(2)
  })

  it("[neoview.system-monitor.toggle] persists start, interval and stop without sampling while paused", async () => {
    let current = config({ enabled: false })
    const client = {
      config: vi.fn(async () => ({ systemMonitor: current } as never)),
      systemMonitorSnapshot: vi.fn(async () => snapshot()),
      updateSystemMonitor: vi.fn(async ({ systemMonitor }: { systemMonitor: Partial<ReaderSystemMonitorConfigDto> }) => {
        current = { ...current, ...systemMonitor }
        return current
      }),
    } as unknown as ReaderHttpClient
    render(<SystemMonitorCard {...props(client)} />)

    expect(await screen.findByRole("button", { name: "开始监控" })).toBeTruthy()
    expect(client.systemMonitorSnapshot).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole("combobox", { name: "刷新间隔" }), { target: { value: "2000" } })
    await waitFor(() => expect(client.updateSystemMonitor).toHaveBeenCalledWith({ systemMonitor: { refreshIntervalMs: 2_000 } }))
    fireEvent.click(screen.getByRole("button", { name: "开始监控" }))
    await waitFor(() => expect(client.systemMonitorSnapshot).toHaveBeenCalledOnce())
    expect(await screen.findByRole("button", { name: "停止监控" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "停止监控" }))
    await waitFor(() => expect(client.updateSystemMonitor).toHaveBeenLastCalledWith({ systemMonitor: { enabled: false } }))
    const pausedCount = vi.mocked(client.systemMonitorSnapshot!).mock.calls.length
    fireEvent.click(screen.getByRole("button", { name: "刷新" }))
    await waitFor(() => expect(client.systemMonitorSnapshot).toHaveBeenCalledTimes(pausedCount + 1))
  })

  it("[neoview.system-monitor.states] recovers from an error and keeps resettable bounded history", async () => {
    vi.useFakeTimers()
    const client = {
      config: vi.fn(async () => ({ systemMonitor: config({ enabled: true, refreshIntervalMs: 500, maxSamples: 10 }) } as never)),
      systemMonitorSnapshot: vi.fn()
        .mockRejectedValueOnce(new Error("采样失败"))
        .mockResolvedValueOnce(snapshot())
        .mockResolvedValueOnce({ ...snapshot(), sampledAtMs: 2_000, cpu: { ...snapshot().cpu, averageUsagePercent: 55 } }),
      updateSystemMonitor: vi.fn(),
    } as unknown as ReaderHttpClient
    render(<SystemMonitorCard {...props(client)} />)

    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByRole("alert").textContent).toContain("采样失败")
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(screen.getByRole("progressbar", { name: /平均使用率/ })).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(500); await Promise.resolve() })
    const reset = screen.getByRole("button", { name: "重置历史" })
    expect(reset.hasAttribute("disabled")).toBe(false)
    fireEvent.click(reset)
    expect(screen.getByText("至少需要两个样本才能显示趋势。")).toBeTruthy()
  })

  it("[neoview.system-monitor.format] sanitizes uptime and 1024-based byte boundaries", () => {
    expect(formatSystemMonitorUptime(90_061)).toBe("1天 1小时")
    expect(formatSystemMonitorUptime(Number.NaN)).toBe("0分钟")
    expect(formatSystemMonitorBytes(1_024)).toBe("1.0 KB")
    expect(formatSystemMonitorBytes(-10)).toBe("0 B")
    expect(formatSystemMonitorBytes(null)).toBe("不可用")
  })

  it("[neoview.system-monitor.legacy-preferences] imports legacy defaults once without overriding canonical settings", async () => {
    localStorage.setItem("neoview-monitor-isMonitoring", "false")
    localStorage.setItem("neoview-monitor-refreshInterval", "2000")
    const updateSystemMonitor = vi.fn(async ({ systemMonitor }: { systemMonitor: Partial<ReaderSystemMonitorConfigDto> }) => config(systemMonitor))
    const client = {
      config: vi.fn(async () => ({ systemMonitor: config() } as never)),
      updateSystemMonitor,
      systemMonitorSnapshot: vi.fn(),
    } as unknown as ReaderHttpClient
    render(<SystemMonitorCard {...props(client)} />)

    expect(await screen.findByRole("button", { name: "开始监控" })).toBeTruthy()
    expect(updateSystemMonitor).toHaveBeenCalledWith({ systemMonitor: { enabled: false, refreshIntervalMs: 2_000 } }, expect.any(AbortSignal))
    expect(localStorage.getItem("neoview-monitor-isMonitoring")).toBeNull()
    expect(localStorage.getItem("xiranite-neoview-monitor-imported-v1")).toBe("1")
  })
})

function props(client: ReaderHttpClient, panelActive = true) {
  return { client, panelActive, disabled: false, onGoTo: vi.fn() }
}

function config(patch: Partial<ReaderSystemMonitorConfigDto> = {}): ReaderSystemMonitorConfigDto {
  return { enabled: true, refreshIntervalMs: 1_000, maxSamples: 60, ...patch }
}

function snapshot(): ReaderSystemMonitorSnapshotDto {
  return {
    schemaVersion: 1,
    sampledAtMs: 1_234,
    uptimeSeconds: 3_661,
    loadAverage: [1, 2, 3],
    cpu: { averageUsagePercent: 25, cores: Array.from({ length: 4 }, (_, index) => ({ index, usagePercent: 20 + index })) },
    memory: { totalBytes: 1_024, usedBytes: 512, freeBytes: 512, cachedBytes: null },
    network: { available: false, reason: "不可用", receiveBytesPerSecond: null, transmitBytesPerSecond: null },
    disk: { available: true, totalBytes: 2_048, usedBytes: 1_024, freeBytes: 1_024 },
    gpu: { available: false, reason: "需要后端支持" },
  }
}
