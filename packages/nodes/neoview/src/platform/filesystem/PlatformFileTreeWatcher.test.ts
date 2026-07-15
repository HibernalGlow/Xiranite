import { describe, expect, it, vi } from "vitest"

import { PlatformFileTreeWatcher } from "./PlatformFileTreeWatcher.js"

describe("PlatformFileTreeWatcher", () => {
  it("[neoview.file-tree.watcher] lazily maps native batches and unsubscribes once", async () => {
    const unsubscribe = vi.fn(async () => undefined)
    let callback: ((error: Error | null, events: Array<{ path: string; type: "create" | "update" | "delete" }>) => void) | undefined
    const subscribe = vi.fn(async (_root: string, next: typeof callback) => {
      callback = next
      return { unsubscribe }
    })
    const changes = vi.fn()
    const watcher = new PlatformFileTreeWatcher(async () => ({ subscribe }) as never)
    const subscription = await watcher.subscribe("D:/library", changes)
    expect(subscribe).toHaveBeenCalledWith("D:/library", expect.any(Function))
    callback?.(null, [{ path: "D:/library/book.cbz", type: "create" }])
    expect(changes).toHaveBeenCalledWith([{ path: "D:/library/book.cbz", kind: "create" }])
    await subscription.close()
    await subscription[Symbol.asyncDispose]()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
