import { describe, expect, test } from "vitest"
import type { RecycleuRuntime } from "./core.js"
import { normalizeRecycleuInput, runRecycleu } from "./core.js"

describe("recycleu core", () => {
  test("normalizes action and bounds", () => {
    expect(normalizeRecycleuInput({})).toEqual({ action: "status", interval: 10, maxCycles: 360, driveLetter: "" })
    expect(normalizeRecycleuInput({ interval: 0, maxCycles: 0, driveLetter: "c:" })).toEqual({ action: "status", interval: 1, maxCycles: 0, driveLetter: "C" })
    expect(normalizeRecycleuInput({ driveLetter: "C;Remove-Item" }).driveLetter).toBe("")
  })

  test("runs one clean and updates counters", async () => {
    const runtime: RecycleuRuntime = {
      now: () => new Date("2026-07-06T01:02:03"),
      sleep: async () => {},
      emptyRecycleBin: async () => ({ status: "cleaned", message: "cleaned" }),
    }

    const result = await runRecycleu({ action: "clean_now" }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.cleanCount).toBe(1)
    expect(result.data?.lastCleanTime).toBe("01:02:03")
  })

  test("rejects unsafe short auto interval", async () => {
    const runtime: RecycleuRuntime = {
      now: () => new Date(),
      sleep: async () => {},
      emptyRecycleBin: async () => ({ status: "cleaned", message: "cleaned" }),
    }

    const result = await runRecycleu({ action: "start", interval: 2 }, runtime)
    expect(result.success).toBe(false)
  })

  test("keeps zero cycles unlimited until runtime cancellation", async () => {
    let now = new Date("2026-07-06T01:02:03")
    let cleanCalls = 0
    const progressValues: number[] = []
    const runtime: RecycleuRuntime = {
      now: () => now,
      sleep: async (milliseconds) => {
        now = new Date(now.getTime() + milliseconds)
      },
      emptyRecycleBin: async () => {
        cleanCalls += 1
        return { status: "cleaned", message: "cleaned" }
      },
      isCancelled: () => cleanCalls >= 2,
    }

    const result = await runRecycleu(
      { action: "start", interval: 5, maxCycles: 0 },
      runtime,
      (event) => {
        if (event.progress !== undefined) progressValues.push(event.progress)
      },
    )

    expect(cleanCalls).toBe(2)
    expect(result.success).toBe(false)
    expect(result.data?.timerStatus).toBe("cancelled")
    expect(result.data?.cleanCount).toBe(2)
    expect(progressValues.length).toBeGreaterThan(0)
    expect(progressValues.every(Number.isFinite)).toBe(true)
  })
})
