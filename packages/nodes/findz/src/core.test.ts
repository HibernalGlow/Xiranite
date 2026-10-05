import { describe, expect, it } from "vitest"
import { runFindzWithGateway } from "./core.js"
import type { FindzGateway } from "./protocol.js"

/**
 * These tests pin the ADR-0077 shape: the engine lives only as long as the run, so an action has to
 * re-open its library and must address it with the id the **engine** returns, never with an id the
 * caller remembers from a previous run.
 */
describe("runFindzWithGateway", () => {
  it("re-opens the library in this run and queries by the id the engine answered", async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const gateway: FindzGateway = {
      async call(method, params) {
        calls.push({ method, params })
        if (method === "library.open") return { libraryId: "library-from-core" } as never
        return { items: [], total: 0 } as never
      },
    }

    // The caller brings a stale id on purpose: it must not reach the engine.
    const result = await runFindzWithGateway(
      {
        action: "query_archives",
        library: { root: "/library" },
        libraryId: "library-stale",
        text: "cover",
        query: { sortBy: "size", sortDesc: true },
      },
      gateway,
    )

    expect(result).toMatchObject({ success: true, data: { action: "query_archives", archives: { total: 0 } } })
    expect(calls).toEqual([
      { method: "library.open", params: { root: "/library" } },
      { method: "query.archives", params: { libraryId: "library-from-core", text: "cover", sortBy: "size", sortDesc: true } },
    ])
  })

  it("refuses an id-only action by naming what the caller has to add, without touching the engine", async () => {
    const gateway: FindzGateway = { call: async () => { throw new Error("should not be called") } }

    const result = await runFindzWithGateway({ action: "scan", libraryId: "library-stale" }, gateway)

    expect(result.success).toBe(false)
    expect(result.message).toContain("library.root")
  })

  it("starts a scan against the freshly opened library", async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const gateway: FindzGateway = {
      async call(method, params) {
        calls.push({ method, params })
        if (method === "library.open") return { libraryId: "library-from-core" } as never
        if (method === "scan.start") return { id: "task-1", kind: "scan", status: "running", totalArchives: 1, doneArchives: 0 } as never
        return { id: "task-1", kind: "scan", status: "completed", totalArchives: 1, doneArchives: 1 } as never
      },
    }

    const result = await runFindzWithGateway({ action: "scan", library: { root: "/library" } }, gateway)

    expect(result).toMatchObject({ success: true, data: { action: "scan", task: { id: "task-1", status: "completed" } } })
    expect(calls.map((call) => call.method)).toEqual(["library.open", "scan.start", "task.wait"])
    expect(calls[0].params).toEqual({ root: "/library" })
    expect(calls[1].params).toEqual({ libraryId: "library-from-core" })
  })

  it("routes task cancellation through the same re-open, so the fifth click works like the first", async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const gateway: FindzGateway = {
      async call(method, params) {
        calls.push({ method, params })
        if (method === "library.open") return { libraryId: "library-from-core" } as never
        return { id: "task-7", libraryId: "library-from-core", kind: "analysis", status: "cancelled" } as never
      },
    }

    const result = await runFindzWithGateway(
      { action: "cancel", library: { root: "/library" }, libraryId: "library-stale", taskId: "task-7" },
      gateway,
    )

    expect(result).toMatchObject({ success: true, data: { action: "cancel", task: { id: "task-7", status: "cancelled" } } })
    expect(calls).toEqual([
      { method: "library.open", params: { root: "/library" } },
      { method: "task.cancel", params: { libraryId: "library-from-core", taskId: "task-7" } },
    ])
  })

  it("holds the scan until the engine reports a terminal task, and says so as it goes", async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const progress: number[] = []
    const stages = [
      { id: "task-1", libraryId: "library-from-core", kind: "scan", status: "running", totalArchives: 2, doneArchives: 0, message: "Scanning." },
      { id: "task-1", libraryId: "library-from-core", kind: "scan", status: "running", totalArchives: 2, doneArchives: 1, message: "Scanning." },
      { id: "task-1", libraryId: "library-from-core", kind: "scan", status: "completed", totalArchives: 2, doneArchives: 2, message: "Scanned." },
    ] as const
    let stage = 0
    const gateway: FindzGateway = {
      async call(method, params) {
        calls.push({ method, params })
        if (method === "library.open") return { libraryId: "library-from-core" } as never
        if (method === "scan.start") return stages[0] as never
        const next = stages[Math.min(++stage, stages.length - 1)]
        return next as never
      },
    }

    const result = await runFindzWithGateway(
      { action: "scan", library: { root: "/library" } },
      gateway,
      (event) => {
        if (event.type === "progress" && typeof event.progress === "number") progress.push(event.progress)
      },
    )

    expect(result).toMatchObject({ success: true, data: { action: "scan", task: { id: "task-1", status: "completed", doneArchives: 2 } } })
    expect(calls.map((call) => call.method)).toEqual(["library.open", "scan.start", "task.wait", "task.wait"])
    expect(calls[2].params).toMatchObject({ libraryId: "library-from-core", taskId: "task-1", timeoutMs: 2000 })
    // 0 = the action started, 50 = the engine's first held frame, 100 = settled task,
    // 100 = the action's own completion event. The point is the middle: the caller sees movement
    // while the run holds the frame, instead of one silent block.
    expect(progress).toEqual([0, 50, 100, 100])
  })

  it("does not wait at all when the task is already terminal", async () => {
    const calls: string[] = []
    const gateway: FindzGateway = {
      async call(method) {
        calls.push(method)
        if (method === "library.open") return { libraryId: "library-from-core" } as never
        return { id: "task-9", libraryId: "library-from-core", kind: "scan", status: "paused", totalArchives: 0, doneArchives: 0, message: "Recovered after the native worker stopped." } as never
      },
    }

    const result = await runFindzWithGateway({ action: "scan", library: { root: "/library" } }, gateway)

    expect(result).toMatchObject({ success: true, data: { action: "scan", task: { status: "paused" } } })
    // The positive control for the test above: the waiter answers once and stops, so a paused task
    // from an earlier run cannot make this run spin forever.
    expect(calls).toEqual(["library.open", "scan.start"])
  })

  it("stops waiting at the round cap when the engine never settles", async () => {
    let waits = 0
    const gateway: FindzGateway = {
      async call(method) {
        if (method === "library.open") return { libraryId: "library-from-core" } as never
        if (method === "task.wait") waits++
        return { id: "task-forever", kind: "scan", status: "running", totalArchives: 10, doneArchives: 1 } as never
      },
    }

    const result = await runFindzWithGateway({ action: "scan", library: { root: "/library" } }, gateway)

    // A scan that never ends is the engine's problem to answer, not the node's to sit in: the action
    // still returns its last observed task rather than hanging the run.
    expect(waits).toBe(5000)
    expect(result).toMatchObject({ success: true, data: { action: "scan", task: { status: "running", doneArchives: 1 } } })
  })
})
