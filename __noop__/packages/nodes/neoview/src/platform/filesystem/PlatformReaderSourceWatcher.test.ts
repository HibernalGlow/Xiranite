import { describe, expect, it, vi } from "vitest"

import type { ReaderFileTreeWatcher } from "../../ports/ReaderFileTreeWatcher.js"
import { PlatformReaderSourceWatcher } from "./PlatformReaderSourceWatcher.js"

describe("PlatformReaderSourceWatcher", () => {
  it("[neoview.control.source-watch-filter] watches a file parent and discards sibling paths", async () => {
    let publish: Parameters<ReaderFileTreeWatcher["subscribe"]>[1] | undefined
    const close = vi.fn(async () => undefined)
    const watcher: ReaderFileTreeWatcher = {
      subscribe: vi.fn(async (_root, onChanges) => {
        publish = onChanges
        return { close, [Symbol.asyncDispose]: close }
      }),
    }
    const sourceWatcher = new PlatformReaderSourceWatcher(watcher as never)
    const changes = vi.fn()
    const subscription = await sourceWatcher.subscribe({ kind: "archive", path: "D:/books/demo.cbz" }, changes)

    publish!([
      { path: "D:/books/other.cbz", kind: "update" },
      { path: "D:/books/demo.cbz", kind: "update" },
    ])
    expect(watcher.subscribe).toHaveBeenCalledWith(expect.stringMatching(/[\\/]books$/), expect.any(Function), expect.any(Function))
    expect(changes).toHaveBeenCalledWith([{ kind: "update" }])
    await subscription.close()
    expect(close).toHaveBeenCalledOnce()
  })
})
