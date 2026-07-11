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
