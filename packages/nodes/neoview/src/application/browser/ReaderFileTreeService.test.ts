import { describe, expect, it, vi } from "vitest"

import type { ReaderDirectoryListingProvider } from "../../ports/ReaderDirectoryListingProvider.js"
import { ReaderFileTreeService } from "./ReaderFileTreeService.js"
import { CoreReaderDirectorySortPreferences } from "./ReaderDirectorySortPreferences.js"

describe("ReaderFileTreeService", () => {
  it("[neoview.browser.navigation] pages stable snapshots and maintains navigation history", async () => {
    const provider: ReaderDirectoryListingProvider = {
      async read(path) {
        return {
          path,
          parentPath: path === "C:/" ? undefined : "C:/",
          entries: Array.from({ length: 140 }, (_, index) => ({
            name: path === "C:/" && index === 0 ? "books" : `item-${index}`,
            path: path === "C:/" && index === 0 ? "C:/books" : `${path}/item-${index}`,
            kind: path === "C:/" && index === 0 ? "directory" as const : "file" as const,
            readerSupported: true,
          })),
        }
      },
    }
    const browser = new ReaderFileTreeService(provider)
    const opened = await browser.open("C:/books")
    expect(opened.entries).toHaveLength(128)
    expect((await browser.list(opened.sessionId, opened.nextCursor, 32))?.entries).toHaveLength(12)
    const parent = await browser.navigate(opened.sessionId, { action: "up" })
    expect(parent).toMatchObject({
      path: "C:/",
      canGoBack: true,
      canGoForward: false,
      generation: 2,
      suggestedSelection: { path: "C:/books", index: 0 },
    })
    const back = await browser.navigate(opened.sessionId, { action: "back" })
    expect(back).toMatchObject({ path: "C:/books", canGoBack: false, canGoForward: true, generation: 3 })
    await browser[Symbol.asyncDispose]()
  })

  it("[neoview.folder.emm-visible-batch] hydrates only the requested page with supported display metadata", async () => {
    const hydrate = vi.fn(async (entries) => entries.map((entry) => ({ ...entry, rating: 4.5, collectTagCount: 2 })))
    const browser = new ReaderFileTreeService({
      async read(path) {
        return {
          path,
          entries: Array.from({ length: 260 }, (_, index) => ({
            name: `book-${index}.cbz`, path: `${path}/book-${index}.cbz`, kind: "file" as const, readerSupported: true,
          })),
        }
      },
    }, { supportedFields: new Set(["rating", "collectTagCount"]), hydrate })
    const fields = new Set(["rating", "collectTagCount"] as const)
    const opened = await browser.open("C:/books", undefined, "tab", fields)
    expect(opened.metadataFields).toEqual(["rating", "collectTagCount"])
    expect(opened.entries).toHaveLength(128)
    expect(hydrate).toHaveBeenLastCalledWith(expect.any(Array), fields, undefined)
    const page = await browser.list(opened.sessionId, 256, 64, fields)
    expect(page?.entries).toHaveLength(4)
    expect(hydrate.mock.calls.at(-1)?.[0]).toHaveLength(4)
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
    const browser = new ReaderFileTreeService(provider)
    const opened = await browser.open("start")
    const stale = browser.navigate(opened.sessionId, { action: "path", path: "slow" })
    const latest = browser.navigate(opened.sessionId, { action: "path", path: "latest" })
    pending.get("latest")?.("latest")
    await expect(latest).resolves.toMatchObject({ path: "latest", generation: 2 })
    await expect(stale).rejects.toMatchObject({ name: "AbortError" })
    await browser[Symbol.asyncDispose]()
  })

  it("[neoview.folder.sort-session] sorts before paging and returns the focused entry's new sparse index", async () => {
    const provider: ReaderDirectoryListingProvider = {
      async read(path) {
        return {
          path,
          entries: [
            { name: "book10.cbz", path: `${path}/book10.cbz`, kind: "file", readerSupported: true },
            { name: "book2.cbz", path: `${path}/book2.cbz`, kind: "file", readerSupported: true },
          ],
        }
      },
    }
    const browser = new ReaderFileTreeService(provider)
    const opened = await browser.open("C:/books")
    expect(opened.entries.map((entry) => entry.name)).toEqual(["book2.cbz", "book10.cbz"])
    expect(opened.sortFields).toEqual(["name", "type", "random", "path"])
    const sorted = await browser.sort(
      opened.sessionId,
      { field: "name", order: "desc", directoriesFirst: true },
      "C:/books/book2.cbz",
    )
    expect(sorted).toMatchObject({
      generation: 2,
      sort: { field: "name", order: "desc", directoriesFirst: true },
      suggestedSelection: { path: "C:/books/book2.cbz", index: 1 },
    })
    expect(sorted?.entries.map((entry) => entry.name)).toEqual(["book10.cbz", "book2.cbz"])
    await browser[Symbol.asyncDispose]()
  })

  it("[neoview.folder.sort-preference-session] applies folder memory and temporary lock across navigation", async () => {
    const provider: ReaderDirectoryListingProvider = {
      async read(path) {
        return {
          path,
          parentPath: path === "C:/" ? undefined : "C:/",
          entries: [
            { name: "book10.cbz", path: `${path}/book10.cbz`, kind: "file", readerSupported: true },
            { name: "book2.zip", path: `${path}/book2.zip`, kind: "file", readerSupported: true },
          ],
        }
      },
    }
    const preferences = new CoreReaderDirectorySortPreferences()
    await preferences.setDefault("tab-1", "global", { field: "type", order: "desc", directoriesFirst: true })
    const browser = new ReaderFileTreeService(provider, undefined, preferences)
    const opened = await browser.open("C:/books", undefined, "tab-1")
    expect(opened).toMatchObject({ sortSource: "global-default", sort: { field: "type", order: "desc" } })
    const remembered = await browser.sort(opened.sessionId, { field: "name", order: "desc", directoriesFirst: true })
    expect(remembered).toMatchObject({ sortSource: "memory", sortTemporary: false })
    const locked = await browser.updateSortPreference(opened.sessionId, { action: "temporary", enabled: true })
    expect(locked).toMatchObject({ sortSource: "temporary", sortTemporary: true })
    const temporary = await browser.sort(opened.sessionId, { field: "random", order: "asc", directoriesFirst: true })
    expect(temporary).toMatchObject({ sortSource: "temporary", sort: { field: "random" } })
    await browser.navigate(opened.sessionId, { action: "path", path: "C:/other" })
    const returned = await browser.navigate(opened.sessionId, { action: "back" })
    expect(returned).toMatchObject({ path: "C:/books", sortSource: "temporary", sort: { field: "random" } })
    const unlocked = await browser.updateSortPreference(opened.sessionId, { action: "temporary", enabled: false })
    expect(unlocked).toMatchObject({ sortSource: "memory", sortTemporary: false, sort: { field: "name", order: "desc" } })
    await browser[Symbol.asyncDispose]()
  })

  it("[neoview.folder.file-tree-service] refreshes one watched directory generation and shares the recursive scanner", async () => {
    let names = ["a.cbz"]
    let onChanges: ((changes: readonly [{ path: string; kind: "create" }]) => void) | undefined
    let watcherCloses = 0
    const provider: ReaderDirectoryListingProvider = {
      async read(path) {
        return {
          path,
          entries: names.map((name) => ({ name, path: `${path}/${name}`, kind: "file" as const, readerSupported: true })),
        }
      },
    }
    const browser = new ReaderFileTreeService(provider, undefined, undefined, {
      watcher: {
        async subscribe(_rootPath, next) {
          onChanges = next as typeof onChanges
          let closed = false
          const close = async () => {
            if (closed) return
            closed = true
            watcherCloses += 1
          }
          return { close, [Symbol.asyncDispose]: close }
        },
      },
      scanner: {
        async *scan(rootPath) {
          yield { name: "nested.cbz", path: `${rootPath}/child/nested.cbz`, relativePath: "child/nested.cbz", depth: 1, kind: "file" as const }
        },
      },
    })
    const opened = await browser.open("/library", undefined, "folder-main", new Set(), undefined, true)
    expect(opened).toMatchObject({ generation: 1, total: 1, watching: true })
    expect(await browser.tree(opened.sessionId)).toMatchObject({ cacheHit: false })
    expect(await browser.tree(opened.sessionId)).toMatchObject({ cacheHit: true })

    names = ["a.cbz", "b.cbz"]
    onChanges?.([{ path: "/library/b.cbz", kind: "create" }])
    expect(await browser.tree(opened.sessionId)).toMatchObject({ cacheHit: false })
    const refreshed = await browser.list(opened.sessionId)
    expect(refreshed).toMatchObject({ generation: 2, total: 2, watching: true })
    expect(refreshed?.entries.map((entry) => entry.name)).toEqual(["a.cbz", "b.cbz"])

    const recursive = []
    const search = browser.search(opened.sessionId, "nested")
    for await (const event of search.events) if (event.type === "entry") recursive.push(event.entry)
    await search.close()
    expect(recursive).toEqual([{ name: "nested.cbz", path: "/library/child/nested.cbz", relativePath: "child/nested.cbz", depth: 1, kind: "file" }])
    expect(await browser.close(opened.sessionId)).toBe(true)
    expect(watcherCloses).toBe(1)
  })

  it("[neoview.folder.watch-cancellation] aborts and drains an in-flight watcher refresh before close returns", async () => {
    let reads = 0
    let onChanges: ((changes: readonly [{ path: string; kind: "update" }]) => void) | undefined
    const browser = new ReaderFileTreeService({
      read(path, signal) {
        reads += 1
        if (reads === 1) return Promise.resolve({ path, entries: [] })
        return new Promise((_resolve, reject) => {
          const abort = () => reject(signal?.reason)
          signal?.addEventListener("abort", abort, { once: true })
        })
      },
    }, undefined, undefined, {
      watcher: {
        async subscribe(_rootPath, next) {
          onChanges = next as typeof onChanges
          const close = async () => undefined
          return { close, [Symbol.asyncDispose]: close }
        },
      },
    })
    const opened = await browser.open("/library", undefined, "folder-main", new Set(), undefined, true)
    onChanges?.([{ path: "/library/a.cbz", kind: "update" }])
    const pending = browser.list(opened.sessionId)
    await vi.waitFor(() => expect(reads).toBe(2))
    const closing = browser.close(opened.sessionId)
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    await expect(closing).resolves.toBe(true)
    expect(await browser.list(opened.sessionId)).toBeUndefined()
  })

  it("[neoview.folder.search-session-close] aborts and drains active recursive search handles with the browser session", async () => {
    let scanClosed = false
    let scanWaiting = false
    const browser = new ReaderFileTreeService({
      async read(path) { return { path, entries: [] } },
    }, undefined, undefined, {
      scanner: {
        async *scan(rootPath, _options, signal) {
          try {
            yield { name: "first.cbz", path: `${rootPath}/first.cbz`, relativePath: "first.cbz", depth: 0, kind: "file" as const }
            scanWaiting = true
            await new Promise((_resolve, reject) => {
              const abort = () => reject(signal?.reason)
              signal?.addEventListener("abort", abort, { once: true })
            })
          } finally {
            scanClosed = true
          }
        },
      },
    })
    const opened = await browser.open("/library")
    const search = browser.search(opened.sessionId, "cbz")
    const iterator = search.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: "meta" } })
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: "entry" } })
    const pending = iterator.next()
    await vi.waitFor(() => expect(scanWaiting).toBe(true))
    const closing = browser.close(opened.sessionId)
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    await expect(closing).resolves.toBe(true)
    expect(scanClosed).toBe(true)
  })
})
