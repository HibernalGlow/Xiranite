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

  it.runIf(process.platform === "win32")("[neoview.file-tree.watcher-native] receives a real Windows file event and releases the subscription", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-file-tree-watch-"))
    const file = join(root, "book.cbz")
    let resolveChange!: (path: string) => void
    let rejectChange!: (error: Error) => void
    const changed = new Promise<string>((resolve, reject) => {
      resolveChange = resolve
      rejectChange = reject
    })
    const subscription = await new PlatformFileTreeWatcher().subscribe(
      root,
      (changes) => {
        const changedFile = changes.find((change) => change.path === file && (change.kind === "create" || change.kind === "update"))
        if (changedFile) resolveChange(changedFile.path)
      },
      rejectChange,
    )
    try {
      await writeFile(file, "fixture")
      // Native subscriptions can resolve before Windows has armed the watcher.
      // A second write validates the supported update path without making the
      // integration test depend on the first event's startup timing.
      await sleep(200)
      await writeFile(file, "fixture-updated")
      await expect(withTimeout(changed, 10_000)).resolves.toBe(file)
    } finally {
      await subscription.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)
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

async function sleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
