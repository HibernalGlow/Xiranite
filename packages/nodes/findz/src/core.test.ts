import { describe, expect, it } from "vitest"
import { runFindzWithGateway } from "./core.js"
import type { FindzWorkerGateway } from "./worker-protocol.js"

describe("runFindzWithGateway", () => {
  it("routes a structured archive query to the Worker boundary", async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const gateway: FindzWorkerGateway = {
      async call(method, params) {
        calls.push({ method, params })
        return { items: [], total: 0 } as never
      },
    }

    const result = await runFindzWithGateway({ action: "query_archives", libraryId: "library-a", text: "cover", query: { sortBy: "size", sortDesc: true } }, gateway)

    expect(result).toMatchObject({ success: true, data: { action: "query_archives", archives: { total: 0 } } })
    expect(calls).toEqual([{ method: "query.archives", params: { libraryId: "library-a", text: "cover", sortBy: "size", sortDesc: true } }])
  })

  it("returns a structured error without invoking the Worker when a library id is absent", async () => {
    const gateway: FindzWorkerGateway = { call: async () => { throw new Error("should not be called") } }

    const result = await runFindzWithGateway({ action: "scan" }, gateway)

    expect(result.success).toBe(false)
    expect(result.message).toContain("libraryId is required")
  })

  it("routes task cancellation through the Worker boundary", async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const gateway: FindzWorkerGateway = {
      async call(method, params) {
        calls.push({ method, params })
        return { id: "task-7", libraryId: "library-a", kind: "analysis", status: "cancelled" } as never
      },
    }

    const result = await runFindzWithGateway({ action: "cancel", libraryId: "library-a", taskId: "task-7" }, gateway)

    expect(result).toMatchObject({ success: true, data: { action: "cancel", task: { id: "task-7", status: "cancelled" } } })
    expect(calls).toEqual([{ method: "task.cancel", params: { libraryId: "library-a", taskId: "task-7" } }])
  })
})
