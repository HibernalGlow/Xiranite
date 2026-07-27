import { afterEach, describe, expect, it, vi } from "vitest"
import { FindzLibraryWatch, coalesceFindzWatcherEvents, type FindzWatcherClient } from "./watcher-service.js"

afterEach(() => vi.useRealTimers())

describe("coalesceFindzWatcherEvents", () => {
  it("keeps one final change for each path in first-seen order", () => {
    expect(coalesceFindzWatcherEvents([
      { path: "D:/library/a.cbz", type: "create" },
      { path: "D:/library/b.cbz", type: "update" },
      { path: "D:/library/a.cbz", type: "delete" },
    ])).toEqual([
      { path: "D:/library/a.cbz", type: "delete" },
      { path: "D:/library/b.cbz", type: "update" },
    ])
  })
})

describe("FindzLibraryWatch", () => {
  it("coalesces queued events and restores healthy state after a successful flush", async () => {
    vi.useFakeTimers()
    const client = watcherClient()
    const watch = new FindzLibraryWatch("library-1", "D:/library", client)

    watch.queue([{ path: "D:/library/a.cbz", type: "create" }])
    watch.queue([
      { path: "D:/library/a.cbz", type: "update" },
      { path: "D:/library/b.cbz", type: "delete" },
    ])
    await vi.advanceTimersByTimeAsync(250)

    expect(client.applyWatcherChanges).toHaveBeenCalledWith("library-1", [
      { path: "D:/library/a.cbz", type: "update" },
      { path: "D:/library/b.cbz", type: "delete" },
    ])
    expect(client.setWatcherHealth).toHaveBeenCalledWith("library-1", "healthy")
  })

  it("marks the library degraded when native incremental work fails", async () => {
    vi.useFakeTimers()
    const client = watcherClient({ apply: async () => { throw new Error("index unavailable") } })
    const watch = new FindzLibraryWatch("library-1", "D:/library", client)

    watch.queue([{ path: "D:/library/a.cbz", type: "update" }])
    await vi.advanceTimersByTimeAsync(250)

    expect(client.setWatcherHealth).toHaveBeenCalledWith("library-1", "degraded")
  })

  it("cancels queued work and does not write health after closing", async () => {
    vi.useFakeTimers()
    let finishApply: (() => void) | undefined
    const client = watcherClient({ apply: async () => await new Promise<void>((resolve) => { finishApply = resolve }) })
    const unsubscribe = vi.fn(async () => undefined)
    const watch = new FindzLibraryWatch("library-1", "D:/library", client)
    watch.setSubscription({ unsubscribe })

    watch.queue([{ path: "D:/library/a.cbz", type: "update" }])
    await vi.advanceTimersByTimeAsync(250)
    expect(client.applyWatcherChanges).toHaveBeenCalledTimes(1)

    await watch.close()
    finishApply?.()
    await Promise.resolve()
    await Promise.resolve()
    watch.queue([{ path: "D:/library/b.cbz", type: "create" }])
    await vi.runAllTimersAsync()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(client.setWatcherHealth).not.toHaveBeenCalled()
    expect(client.applyWatcherChanges).toHaveBeenCalledTimes(1)
  })
})

function watcherClient(overrides: { apply?: FindzWatcherClient["applyWatcherChanges"] } = {}): FindzWatcherClient & {
  applyWatcherChanges: ReturnType<typeof vi.fn>
  setWatcherHealth: ReturnType<typeof vi.fn>
} {
  return {
    applyWatcherChanges: vi.fn(overrides.apply ?? (async () => undefined)),
    setWatcherHealth: vi.fn(async () => undefined),
  }
}
