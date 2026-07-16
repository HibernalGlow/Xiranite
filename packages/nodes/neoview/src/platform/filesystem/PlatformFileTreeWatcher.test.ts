import { describe, expect, it, vi } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

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

  it.runIf(process.platform === "win32")("[neoview.file-tree.watcher-native] receives a real Windows create event and releases the subscription", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-file-tree-watch-"))
    let resolveChange!: (path: string) => void
    let rejectChange!: (error: Error) => void
    const changed = new Promise<string>((resolve, reject) => {
      resolveChange = resolve
      rejectChange = reject
    })
    const subscription = await new PlatformFileTreeWatcher().subscribe(
      root,
      (changes) => {
        const created = changes.find((change) => change.kind === "create")
        if (created) resolveChange(created.path)
      },
      rejectChange,
    )
    try {
      const file = join(root, "book.cbz")
      await writeFile(file, "fixture")
      await expect(withTimeout(changed, 5_000)).resolves.toBe(file)
    } finally {
      await subscription.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})

function withTimeout<T>(value: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    value,
    new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Watcher event timed out after ${timeoutMs} ms.`)), timeoutMs)
      void value.then(() => clearTimeout(timer), () => clearTimeout(timer))
    }),
  ])
}
