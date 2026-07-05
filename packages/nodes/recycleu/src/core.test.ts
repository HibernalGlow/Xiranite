import { describe, expect, test } from "bun:test"
import type { RecycleuRuntime } from "./core.js"
import { normalizeRecycleuInput, runRecycleu } from "./core.js"

describe("recycleu core", () => {
  test("normalizes action and bounds", () => {
    expect(normalizeRecycleuInput({})).toEqual({ action: "status", interval: 10, maxCycles: 360 })
    expect(normalizeRecycleuInput({ interval: 0, maxCycles: 0 })).toEqual({ action: "status", interval: 1, maxCycles: 1 })
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
})
