import { describe, expect, it } from "vitest"

import type { ReaderDirectoryListingProvider } from "../../ports/ReaderDirectoryListingProvider.js"
import { CoreReaderDirectoryBrowser } from "./ReaderDirectoryBrowser.js"

describe("CoreReaderDirectoryBrowser", () => {
  it("[neoview.browser.navigation] pages stable snapshots and maintains navigation history", async () => {
    const provider: ReaderDirectoryListingProvider = {
      async read(path) {
        return {
          path,
          parentPath: path === "C:/" ? undefined : "C:/",
          entries: Array.from({ length: 140 }, (_, index) => ({
            name: `item-${index}`,
            path: `${path}/item-${index}`,
            kind: "file" as const,
            readerSupported: true,
          })),
        }
      },
    }
    const browser = new CoreReaderDirectoryBrowser(provider)
    const opened = await browser.open("C:/books")
    expect(opened.entries).toHaveLength(128)
    expect(browser.list(opened.sessionId, opened.nextCursor, 32)?.entries).toHaveLength(12)
    const parent = await browser.navigate(opened.sessionId, { action: "up" })
    expect(parent).toMatchObject({ path: "C:/", canGoBack: true, canGoForward: false, generation: 2 })
    const back = await browser.navigate(opened.sessionId, { action: "back" })
    expect(back).toMatchObject({ path: "C:/books", canGoBack: false, canGoForward: true, generation: 3 })
    await browser[Symbol.asyncDispose]()
  })

  it("[neoview.browser.cancel] prevents an older navigation generation from replacing a newer one", async () => {
    const pending = new Map<string, (path: string) => void>()
    const provider: ReaderDirectoryListingProvider = {
      read: (path, signal) => path === "start"
        ? Promise.resolve({ path, entries: [] })
        : new Promise((resolve, reject) => {
            const abort = () => reject(signal?.reason ?? new DOMException("Aborted", "AbortError"))
            signal?.addEventListener("abort", abort, { once: true })
            pending.set(path, () => {
              signal?.removeEventListener("abort", abort)
              resolve({ path, entries: [] })
            })
          }),
    }
    const browser = new CoreReaderDirectoryBrowser(provider)
    const opened = await browser.open("start")
    const stale = browser.navigate(opened.sessionId, { action: "path", path: "slow" })
    const latest = browser.navigate(opened.sessionId, { action: "path", path: "latest" })
    pending.get("latest")?.("latest")
    await expect(latest).resolves.toMatchObject({ path: "latest", generation: 2 })
    await expect(stale).rejects.toMatchObject({ name: "AbortError" })
    await browser[Symbol.asyncDispose]()
  })
})
