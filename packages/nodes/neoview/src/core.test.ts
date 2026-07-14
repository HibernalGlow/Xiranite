import { describe, expect, it, vi } from "vitest"
import { runNeoview } from "./core.js"

describe("runNeoview", () => {
  it("reports migration state without pretending the reader execution path is complete", async () => {
    const onEvent = vi.fn()
    const result = await runNeoview({}, {
      migrationStatus: async () => ({
        sourceRevision: "revision",
        featureCount: 30,
        pendingFeatures: 30,
        readerCoreReady: true,
      }),
    }, onEvent)
    expect(result).toMatchObject({ success: true, data: { migration: { pendingFeatures: 30 } } })
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "log" }))
  })
})
