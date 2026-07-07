import { describe, expect, test } from "vitest"
import type { SleeptRuntime } from "./core.js"
import { countdownSeconds, formatDuration, parseTargetDatetime, runSleept } from "./core.js"

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
})
