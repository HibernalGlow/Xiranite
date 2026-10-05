import { describe, expect, test } from "vitest"
import type { SleeptRuntime } from "./core.js"
import { countdownSeconds, formatDuration, normalizeInput, parseTargetDatetime, runSleept } from "./core.js"

describe("sleept core", () => {
  test("formats duration", () => {
    expect(formatDuration(3661)).toBe("01:01:01")
  })

  test("computes countdown seconds", () => {
    expect(countdownSeconds({ hours: 1, minutes: 2, seconds: 3 })).toBe(3723)
  })

  test("rejects past target datetime", () => {
    expect(() => parseTargetDatetime("2020-01-01 00:00:00", new Date("2021-01-01T00:00:00"))).toThrow()
  })

  test("preserves zero maximum wait as unlimited", () => {
    expect(normalizeInput({ maxWaitSeconds: 0 }).maxWaitSeconds).toBe(0)
    expect(normalizeInput({ maxWaitSeconds: -10 }).maxWaitSeconds).toBe(0)
  })

  test("runs dry-run countdown through injected runtime", async () => {
    let powerCalled = false
    let now = new Date("2026-01-01T00:00:00")
    const runtime: SleeptRuntime = {
      now: () => now,
      sleep: async (milliseconds) => {
        now = new Date(now.getTime() + milliseconds)
      },
      getCpuPercent: () => 0,
      getNetCounters: () => ({ bytesSent: 0, bytesReceived: 0 }),
      executePowerAction: () => {
        powerCalled = true
      },
    }

    const result = await runSleept({ action: "countdown", seconds: 2, dryrun: true }, runtime)

    expect(result.success).toBe(true)
    expect(powerCalled).toBe(true)
    expect(result.data?.timerStatus).toBe("completed")
  })

  test("an unreadable CPU load ends the run instead of reaching a power action", async () => {
    // The distinction this node has to keep: `cpu` waits for an *idle* machine, so an unknown load must never
    // be read as a low one. It used to arrive as `null` because the realm had no per-cpu `times` (ADR-0079
    // gap ④); the reading now comes from the host's `os` service, so the same danger travels as a failed call
    // — and the run must not swallow it into a result that could then sleep the machine.
    let powerCalled = false
    const runtime: SleeptRuntime = {
      now: () => new Date("2026-01-01T00:00:00"),
      sleep: async () => undefined,
      getCpuPercent: () => {
        throw new Error('os.cpu.usage refused: the "cpu" service is not granted to this node')
      },
      getNetCounters: () => ({ bytesSent: 0, bytesReceived: 0 }),
      executePowerAction: () => {
        powerCalled = true
      },
    }

    await expect(runSleept({ action: "status" }, runtime)).rejects.toThrow("os.cpu.usage")
    await expect(runSleept({ action: "get_stats" }, runtime)).rejects.toThrow("os.cpu.usage")
    await expect(runSleept({ action: "cpu", cpuDuration: 1, maxWaitSeconds: 5, dryrun: true }, runtime)).rejects.toThrow("os.cpu.usage")
    expect(powerCalled, "a refusal must never become a power action").toBe(false)
  })

  test("passes hibernate through the shared power-action contract", async () => {
    let executedMode: string | undefined
    const runtime: SleeptRuntime = {
      now: () => new Date("2026-01-01T00:00:00"),
      sleep: async () => undefined,
      getCpuPercent: () => 0,
      getNetCounters: () => ({ bytesSent: 0, bytesReceived: 0 }),
      executePowerAction: (mode) => {
        executedMode = mode
      },
    }

    const result = await runSleept({ action: "countdown", seconds: 1, powerMode: "hibernate", dryrun: true }, runtime)

    expect(result.message).toBe("[dryrun] Countdown completed; simulated hibernate.")
    expect(executedMode).toBe("hibernate")
  })

  test.each(["display-sleep", "screensaver"] as const)("passes %s through the shared power-action contract", async (mode) => {
    let executedMode: string | undefined
    const runtime: SleeptRuntime = {
      now: () => new Date("2026-01-01T00:00:00"),
      sleep: async () => undefined,
      getCpuPercent: () => 0,
      getNetCounters: () => ({ bytesSent: 0, bytesReceived: 0 }),
      executePowerAction: (value) => {
        executedMode = value
      },
    }

    const result = await runSleept({ action: "countdown", seconds: 1, powerMode: mode, dryrun: true }, runtime)

    expect(result.message).toBe(`[dryrun] Countdown completed; simulated ${mode}.`)
    expect(executedMode).toBe(mode)
  })

  test("cancels countdowns before executing the power action", async () => {
    let cancelled = false
    let powerCalled = false
    const runtime: SleeptRuntime = {
      now: () => new Date("2026-01-01T00:00:00"),
      sleep: async () => {
        cancelled = true
      },
      getCpuPercent: () => 0,
      getNetCounters: () => ({ bytesSent: 0, bytesReceived: 0 }),
      executePowerAction: () => {
        powerCalled = true
      },
      isCancelled: () => cancelled,
    }

    const result = await runSleept({ action: "countdown", seconds: 5, dryrun: true }, runtime)

    expect(result.success).toBe(false)
    expect(result.message).toBe("Countdown cancelled.")
    expect(result.data?.timerStatus).toBe("cancelled")
    expect(powerCalled).toBe(false)
  })

  test("keeps a zero-limit CPU monitor running until it triggers", async () => {
    let now = new Date("2026-01-01T00:00:00")
    let powerCalled = false
    const runtime: SleeptRuntime = {
      now: () => now,
      sleep: async (milliseconds) => {
        now = new Date(now.getTime() + milliseconds)
      },
      getCpuPercent: () => 0,
      getNetCounters: () => ({ bytesSent: 0, bytesReceived: 0 }),
      executePowerAction: () => {
        powerCalled = true
      },
    }

    const result = await runSleept({
      action: "cpu",
      cpuThreshold: 10,
      cpuDuration: 1 / 60,
      maxWaitSeconds: 0,
      dryrun: true,
    }, runtime)

    expect(result.success).toBe(true)
    expect(powerCalled).toBe(true)
    expect(result.data?.timerStatus).toBe("completed")
  })
})
