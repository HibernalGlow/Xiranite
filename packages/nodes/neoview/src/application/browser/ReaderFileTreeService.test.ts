import { describe, expect, it, vi } from "vitest"

import type { ReaderDirectoryListingProvider } from "../../ports/ReaderDirectoryListingProvider.js"
import type { ReaderFileTreeChange } from "../../ports/ReaderFileTreeWatcher.js"
import { ReaderFileTreeService } from "./ReaderFileTreeService.js"
import { CoreReaderDirectorySortPreferences } from "./ReaderDirectorySortPreferences.js"

describe("ReaderFileTreeService", () => {
  it("[neoview.folder.size-batch] measures only current-generation directories with bounded shared results", async () => {
    const measure = vi.fn(async (path: string) => {
      if (path.endsWith("broken")) throw new Error("offline volume")
      return { path, bytes: path.endsWith("large") ? 9 : 4, fileCount: 2 }
    })
    const browser = new ReaderFileTreeService({
      async read(path) {
        return { path, entries: [
          { name: "small", path: `${path}/small`, kind: "directory", readerSupported: true },
          { name: "large", path: `${path}/large`, kind: "directory", readerSupported: true },
          { name: "broken", path: `${path}/broken`, kind: "directory", readerSupported: true },
          { name: "file", path: `${path}/file.cbz`, kind: "file", readerSupported: true },
        ] }
      },
    }, undefined, undefined, { directorySizeProvider: { measure }, directorySizeConcurrency: 2 })
    const opened = await browser.open("C:/books")

    await expect(browser.directorySizes(opened.sessionId, opened.generation, ["C:/books/small", "C:/books/large", "C:/books/broken"]))
      .resolves.toEqual({
        sessionId: opened.sessionId,
        generation: opened.generation,
        results: [
          { path: "C:/books/small", status: "ok", bytes: 4, fileCount: 2 },
          { path: "C:/books/large", status: "ok", bytes: 9, fileCount: 2 },
          { path: "C:/books/broken", status: "failed", error: "offline volume" },
        ],
      })
    await expect(browser.directorySizes(opened.sessionId, opened.generation - 1, ["C:/books/small"])).rejects.toThrow("stale")
    await expect(browser.directorySizes(opened.sessionId, opened.generation, ["C:/books/file.cbz"])).rejects.toThrow("current browser listing")
    await browser[Symbol.asyncDispose]()
  })

  it("[neoview.folder.size-cancellation] cancels old directory scans when navigation changes generation", async () => {
    let scanning = false
    const browser = new ReaderFileTreeService({
      async read(path) {
        return { path, entries: [{ name: "nested", path: `${path}/nested`, kind: "directory", readerSupported: true }] }
      },
    }, undefined, undefined, {
      directorySizeProvider: {
        measure(_path, signal) {
          scanning = true
          return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }))
        },
      },
    })
    const opened = await browser.open("C:/books")
    const sizes = browser.directorySizes(opened.sessionId, opened.generation, ["C:/books/nested"])
    await vi.waitFor(() => expect(scanning).toBe(true))
    await expect(browser.navigate(opened.sessionId, { action: "path", path: "C:/other" })).resolves.toMatchObject({ generation: 2 })
    await expect(sizes).rejects.toMatchObject({ name: "AbortError" })
    await browser[Symbol.asyncDispose]()
  })

  it("[neoview.memory-pressure.file-tree] clears rebuildable tree metadata and background sizes without losing the current listing", async () => {
    let scanning = false
    const browser = new ReaderFileTreeService({
      async read(path) {
        return { path, entries: [{ name: "nested", path: `${path}/nested`, kind: "directory", readerSupported: true }] }
      },
    }, undefined, undefined, {
      directorySizeProvider: {
        measure(_path, signal) {
          scanning = true
          return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }))
        },
      },
    })
    const opened = await browser.open("C:/books")
    expect(browser.memorySnapshot()).toMatchObject({ sessions: 1, listingEntries: 1, listingPayloadBytes: expect.any(Number) })
    expect(await browser.tree(opened.sessionId)).toMatchObject({ cacheHit: false })
    expect(await browser.tree(opened.sessionId)).toMatchObject({ cacheHit: true })
    const sizes = browser.directorySizes(opened.sessionId, opened.generation, ["C:/books/nested"])
    await vi.waitFor(() => expect(scanning).toBe(true))

    expect(browser.releaseMemoryPressure()).toEqual({
      clearedTreeEntries: 1,
      cancelledDirectorySizes: 1,
      clearedRandomSeeds: 0,
      releasedListingEntries: 0,
      releasedListingPayloadBytes: 0,
    })
    expect(browser.memorySnapshot()).toMatchObject({ sessions: 1, listingEntries: 1, releasedListings: 0, randomSeeds: 0, randomSeedPayloadBytes: 0 })
    await expect(sizes).rejects.toMatchObject({ name: "AbortError" })
    await expect(browser.list(opened.sessionId)).resolves.toMatchObject({ generation: 1, total: 1, entries: [{ name: "nested" }] })
    expect(await browser.tree(opened.sessionId)).toMatchObject({ cacheHit: false })
    await browser[Symbol.asyncDispose]()
    expect(browser.memorySnapshot()).toEqual({
      sessions: 0,
      listingEntries: 0,
      listingPayloadBytes: 0,
      releasedListings: 0,
      navigationPaths: 0,
      navigationPayloadBytes: 0,
      randomSeeds: 0,
      randomSeedPayloadBytes: 0,
    })
  })

  it("[neoview.memory-pressure.file-tree-listing-budget] releases oversized idle listings and transparently reloads them", async () => {
    const read = vi.fn(async (path: string) => ({
      path,
      parentPath: "C:/",
      entries: Array.from({ length: 3 }, (_, index) => ({
        name: `book-${index}.cbz`, path: `${path}/book-${index}.cbz`, kind: "file" as const, readerSupported: true,
      })),
    }))
    const browser = new ReaderFileTreeService({ read }, undefined, undefined, { maxListingPayloadBytesUnderPressure: 0 })
    const opened = await browser.open("C:/books")

    expect(browser.releaseMemoryPressure()).toMatchObject({
      releasedListingEntries: 3,
      releasedListingPayloadBytes: expect.any(Number),
    })
    expect(browser.memorySnapshot()).toMatchObject({ listingEntries: 0, releasedListings: 1 })
    await expect(browser.list(opened.sessionId, 0, 2)).resolves.toMatchObject({
      generation: 2,
      total: 3,
      entries: [{ name: "book-0.cbz" }, { name: "book-1.cbz" }],
      nextCursor: 2,
    })
    expect(read).toHaveBeenCalledTimes(2)
    expect(browser.memorySnapshot()).toMatchObject({ listingEntries: 3, releasedListings: 0 })
    await browser[Symbol.asyncDispose]()
  })

  it("[neoview.memory-pressure.file-tree-shared-reload] shares recovery while caller cancellation remains isolated", async () => {
    let finishReload: (() => void) | undefined
    let reads = 0
    const browser = new ReaderFileTreeService({
      async read(path) {
        reads += 1
        if (reads > 1) await new Promise<void>((resolve) => { finishReload = resolve })
        return { path, entries: [{ name: "book.cbz", path: `${path}/book.cbz`, kind: "file", readerSupported: true }] }
      },
    }, undefined, undefined, { maxListingPayloadBytesUnderPressure: 0 })
    const opened = await browser.open("C:/books")
    browser.releaseMemoryPressure()
    const controller = new AbortController()
    const cancelled = browser.list(opened.sessionId, 0, 1, new Set(), controller.signal)
    const surviving = browser.list(opened.sessionId)
    await vi.waitFor(() => expect(finishReload).toBeTypeOf("function"))
    controller.abort(new DOMException("caller left", "AbortError"))
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" })
    finishReload?.()
    await expect(surviving).resolves.toMatchObject({ generation: 2, total: 1 })
    expect(reads).toBe(2)
    await browser[Symbol.asyncDispose]()
  })

  it("[neoview.memory-pressure.file-tree-navigation] keeps navigation paths usable without reloading the released directory first", async () => {
    const paths: string[] = []
    const browser = new ReaderFileTreeService({
      async read(path) {
        paths.push(path)
        return {
          path,
          parentPath: path === "C:/" ? undefined : "C:/",
          entries: [{ name: "item", path: `${path}/item`, kind: "directory", readerSupported: true }],
        }
      },
    }, undefined, undefined, { maxListingPayloadBytesUnderPressure: 0 })
    const opened = await browser.open("C:/books")
    browser.releaseMemoryPressure()

    await expect(browser.navigate(opened.sessionId, { action: "up" })).resolves.toMatchObject({ path: "C:/", generation: 2 })
    expect(paths).toEqual(["C:/books", "C:/"])
    await expect(browser.navigate(opened.sessionId, { action: "back" })).resolves.toMatchObject({ path: "C:/books", generation: 3 })
    expect(paths).toEqual(["C:/books", "C:/", "C:/books"])
    await browser[Symbol.asyncDispose]()
  })

  it("[neoview.memory-pressure.file-tree-watch-reload] lets watcher refresh supersede a released listing", async () => {
    let onChanges: ((changes: readonly ReaderFileTreeChange[]) => void) | undefined
    let name = "before.cbz"
    const browser = new ReaderFileTreeService({
      async read(path) {
        return { path, entries: [{ name, path: `${path}/${name}`, kind: "file", readerSupported: true }] }
      },
    }, undefined, undefined, {
      maxListingPayloadBytesUnderPressure: 0,
      watcher: {
        async subscribe(_path, next) {
          onChanges = next
          return { close: async () => undefined }
        },
      },
    })
    const opened = await browser.open("C:/books", undefined, "folder-main", new Set(), undefined, true)
    browser.releaseMemoryPressure()
    name = "after.cbz"
    onChanges?.([{ path: "C:/books/after.cbz", kind: "created" }])

    await expect(browser.list(opened.sessionId)).resolves.toMatchObject({ generation: 2, entries: [{ name: "after.cbz" }] })
    expect(browser.memorySnapshot()).toMatchObject({ listingEntries: 1, releasedListings: 0 })
    await browser[Symbol.asyncDispose]()
  })

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
    expect(opened.navigationEntryId).toBe(1)
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

  it("[neoview.folder.parent-suggested-selection] locates the departed child in a sorted 10K parent without returning its page eagerly", async () => {
    const parentPath = "C:/library"
    const childPath = `${parentPath}/selected-child`
    const browser = new ReaderFileTreeService({
      async read(path) {
        if (path === childPath) return { path, parentPath, entries: [] }
        return {
          path,
          parentPath: "C:/",
          entries: [
            ...Array.from({ length: 10_000 }, (_, index) => ({
              name: `item-${String(index).padStart(5, "0")}`,
              path: `${parentPath}/item-${String(index).padStart(5, "0")}`,
              kind: "directory" as const,
              readerSupported: true,
            })),
            { name: "selected-child", path: childPath, kind: "directory" as const, readerSupported: true },
          ],
        }
      },
    })
    const opened = await browser.open(childPath)
    const parent = await browser.navigate(opened.sessionId, { action: "up" })

    expect(parent).toMatchObject({
      path: parentPath,
      cursor: 0,
      total: 10_001,
      suggestedSelection: { path: childPath, index: 10_000 },
    })
    expect(parent?.entries.some((entry) => entry.path === childPath)).toBe(false)
    await expect(browser.list(opened.sessionId, 9_984, 128)).resolves.toMatchObject({
      cursor: 9_984,
      entries: expect.arrayContaining([expect.objectContaining({ path: childPath })]),
    })
    await browser[Symbol.asyncDispose]()
  })

  it("[neoview.folder.nav-history] restores distinct visits, branches, temporary sort, and a bounded history", async () => {
    const browser = new ReaderFileTreeService({
      async read(path) {
        if (path === "C:/missing") throw new Error("missing directory")
        return {
          path,
          parentPath: "C:/",
          entries: [
            { name: "book10.cbz", path: `${path}/book10.cbz`, kind: "file", readerSupported: true },
            { name: "book2.cbz", path: `${path}/book2.cbz`, kind: "file", readerSupported: true },
          ],
        }
      },
    })
    const opened = await browser.open("C:/A")
    await browser.updateSortPreference(opened.sessionId, { action: "temporary", enabled: true })
    const firstA = await browser.sort(opened.sessionId, { field: "name", order: "desc", directoriesFirst: true })
    const b = await browser.navigate(opened.sessionId, { action: "path", path: "C:/B" })
    const secondA = await browser.navigate(opened.sessionId, { action: "path", path: "C:/A" })

    expect([firstA?.navigationEntryId, b?.navigationEntryId, secondA?.navigationEntryId]).toEqual([1, 2, 3])
    expect(secondA).toMatchObject({ path: "C:/A", sortSource: "global-default", sortTemporary: false })
    await expect(browser.navigate(opened.sessionId, { action: "back" })).resolves.toMatchObject({
      navigationEntryId: 2,
      path: "C:/B",
    })
    await expect(browser.navigate(opened.sessionId, { action: "back" })).resolves.toMatchObject({
      navigationEntryId: 1,
      path: "C:/A",
      sortSource: "temporary",
      sort: { field: "name", order: "desc" },
    })
    await expect(browser.navigate(opened.sessionId, { action: "forward" })).resolves.toMatchObject({
      navigationEntryId: 2,
      canGoForward: true,
    })
    const beforeFailure = await browser.list(opened.sessionId)
    await expect(browser.navigate(opened.sessionId, { action: "path", path: "C:/missing" })).rejects.toThrow("missing directory")
    await expect(browser.list(opened.sessionId)).resolves.toMatchObject({
      navigationEntryId: beforeFailure?.navigationEntryId,
      path: beforeFailure?.path,
      canGoBack: beforeFailure?.canGoBack,
      canGoForward: beforeFailure?.canGoForward,
    })
    const branched = await browser.navigate(opened.sessionId, { action: "path", path: "C:/branch" })
    expect(branched).toMatchObject({ canGoForward: false, navigationEntryId: 4 })

    for (let index = 0; index < 70; index += 1) {
      await browser.navigate(opened.sessionId, { action: "path", path: `C:/visit-${index}` })
    }
    expect(browser.memorySnapshot().navigationPaths).toBe(50)
    await browser[Symbol.asyncDispose]()
  })

  it("[neoview.folder.refresh] refreshes the current directory without changing its visit or temporary sort", async () => {
    let names = ["book2.cbz", "book10.cbz"]
    let failRefresh = false
    const browser = new ReaderFileTreeService({
      async read(path) {
        if (failRefresh && path === "C:/B") throw new Error("refresh failed")
        return {
          path,
          parentPath: "C:/",
          entries: names.map((name) => ({ name, path: `${path}/${name}`, kind: "file" as const, readerSupported: true })),
        }
      },
    })
    const opened = await browser.open("C:/A")
    const atB = await browser.navigate(opened.sessionId, { action: "path", path: "C:/B" })
    await browser.updateSortPreference(opened.sessionId, { action: "temporary", enabled: true })
    const sorted = await browser.sort(opened.sessionId, { field: "name", order: "desc", directoriesFirst: true })
    names = ["book2.cbz", "book10.cbz", "new.cbz"]

    const refreshed = await browser.navigate(opened.sessionId, { action: "refresh" })
    expect(refreshed).toMatchObject({
      navigationEntryId: atB?.navigationEntryId,
      path: "C:/B",
      total: 3,
      canGoBack: true,
      canGoForward: false,
      sortSource: "temporary",
      sortTemporary: true,
      sort: sorted?.sort,
    })
    expect(refreshed?.entries.map((entry) => entry.name)).toEqual(["new.cbz", "book10.cbz", "book2.cbz"])

    failRefresh = true
    await expect(browser.navigate(opened.sessionId, { action: "refresh" })).rejects.toThrow("refresh failed")
    await expect(browser.list(opened.sessionId)).resolves.toMatchObject({
      navigationEntryId: atB?.navigationEntryId,
      path: "C:/B",
      total: 3,
      canGoBack: true,
      sortSource: "temporary",
    })
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
    let onChanges: ((changes: readonly ReaderFileTreeChange[]) => void) | undefined
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

  it("[neoview.folder.watch-long-poll] waits for native changes, preserves focus identity, times out, and wakes on close", async () => {
    let names = ["a.cbz"]
    let onChanges: ((changes: readonly [{ path: string; kind: "create" }]) => void) | undefined
    const browser = new ReaderFileTreeService({
      async read(path) {
        return { path, entries: names.map((name) => ({ name, path: `${path}/${name}`, kind: "file" as const, readerSupported: true })) }
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
    let settled = false
    const changed = browser.waitForChanges(opened.sessionId, opened.generation, 1_000, new Set(), "/library/a.cbz")
      .finally(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    names = ["a.cbz", "b.cbz"]
    onChanges?.([{ path: "/library/b.cbz", kind: "create" }])
    await expect(changed).resolves.toMatchObject({
      generation: 2,
      total: 2,
      suggestedSelection: { path: "/library/a.cbz", index: 0 },
    })
    await expect(browser.waitForChanges(opened.sessionId, 2, 10)).resolves.toBeNull()

    const closingWait = browser.waitForChanges(opened.sessionId, 2, 1_000)
    await Promise.resolve()
    await browser.close(opened.sessionId)
    await expect(closingWait).resolves.toBeUndefined()
  })

  it("[neoview.folder.tree-watch-stream] reports nested tree invalidations without refreshing the current-directory listing", async () => {
    let nestedNames = ["old"]
    let onChanges: ((changes: readonly ReaderFileTreeChange[]) => void) | undefined
    const browser = new ReaderFileTreeService({
      async read(path) {
        if (path === "/library/nested") {
          return { path, entries: nestedNames.map((name) => ({
            name,
            path: `${path}/${name}`,
            kind: "directory" as const,
            readerSupported: false,
          })) }
        }
        return { path, entries: [{ name: "nested", path: `${path}/nested`, kind: "directory" as const, readerSupported: false }] }
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
    await expect(browser.tree(opened.sessionId, "/library/nested")).resolves.toMatchObject({
      generation: 1,
      entries: [{ path: "/library/nested/old" }],
    })
    const treeChanges = browser.waitForTreeChanges(opened.sessionId, 0, 1_000)
    const listHeartbeat = browser.waitForChanges(opened.sessionId, opened.generation, 10)
    await Promise.resolve()

    nestedNames = ["fresh"]
    onChanges?.([{ path: "/library/nested/fresh", kind: "create" }])
    await expect(treeChanges).resolves.toMatchObject({
      revision: 1,
      generation: 2,
      paths: ["/library/nested"],
      reset: false,
    })
    await expect(listHeartbeat).resolves.toBeNull()
    await expect(browser.list(opened.sessionId)).resolves.toMatchObject({ generation: 1, total: 1 })
    await expect(browser.tree(opened.sessionId, "/library/nested")).resolves.toMatchObject({
      generation: 2,
      entries: [{ path: "/library/nested/fresh" }],
    })

    onChanges?.(Array.from({ length: 32 }, (_, index) => ({
      path: `/library/branch-${index}/new`,
      kind: "create" as const,
    })))
    await expect(browser.waitForTreeChanges(opened.sessionId, 1, 10)).resolves.toMatchObject({
      revision: 2,
      reset: false,
      paths: expect.arrayContaining(["/library/branch-0", "/library/branch-31"]),
    })
    await expect(browser.waitForTreeChanges(opened.sessionId, 0, 10)).resolves.toMatchObject({
      revision: 2,
      reset: true,
      paths: [],
    })
    await browser.close(opened.sessionId)
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
