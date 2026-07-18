import { describe, expect, it, vi } from "vitest"

import { ReaderPreloadStatusStore } from "./ReaderPreloadStatusStore"

describe("ReaderPreloadStatusStore", () => {
  it("[neoview.preload-status-store] publishes stable session snapshots for real predecode lifecycle events", () => {
    const store = new ReaderPreloadStatusStore(4)
    const listener = vi.fn()
    const unsubscribe = store.subscribe("reader-1", listener)
    const initial = store.snapshot("reader-1")

    expect(store.snapshot("reader-1")).toBe(initial)
    store.begin("reader-1", 8)
    store.ready("reader-1", 8)
    store.begin("reader-1", 4)
    store.fail("reader-1", 4)

    expect(store.snapshot("reader-1")).toMatchObject({
      retainedLimit: 4,
      loadingCount: 0,
      readyCount: 1,
      failedCount: 1,
      entries: [
        { pageIndex: 4, status: "failed" },
        { pageIndex: 8, status: "ready" },
      ],
    })

    store.evict("reader-1", 4)
    expect(store.snapshot("reader-1").entries).toEqual([{ pageIndex: 8, status: "ready" }])
    store.clear("reader-1")
    expect(store.snapshot("reader-1").entries).toEqual([])
    expect(listener).toHaveBeenCalledTimes(6)

    unsubscribe()
    expect(store.listenerCount("reader-1")).toBe(0)
  })
})
