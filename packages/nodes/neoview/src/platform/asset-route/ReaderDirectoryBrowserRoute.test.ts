import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReaderDirectoryBrowserRoute } from "./ReaderDirectoryBrowserRoute.js"
import { SqliteReaderDataStore } from "../persistence/SqliteReaderDataStore.js"
import { ReaderSearchHistoryService } from "../../application/browser/ReaderSearchHistoryService.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("ReaderDirectoryBrowserRoute", () => {
  it("[neoview.folder.penetration-describe-http] returns direct internal archive names for visible folders", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-browser-penetration-describe-"))
    directories.push(directory)
    const first = join(directory, "first")
    const second = join(directory, "second")
    await Promise.all([mkdir(first), mkdir(second)])
    await Promise.all([
      writeFile(join(first, "Book One.cbz"), "book"),
      writeFile(join(first, "notes.txt"), "notes"),
      writeFile(join(second, "Book.Two.zip"), "book"),
    ])
    const route = new ReaderDirectoryBrowserRoute()
    try {
      const opened = (await route.handle(new Request("http://localhost/reader/browser/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: directory }),
      })))!
      const page = await opened.json() as { sessionId: string }
      const response = (await route.handle(new Request(`http://localhost/reader/browser/s/${page.sessionId}/penetration/describe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paths: [first, second] }),
      })))!

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ entries: [
        { path: first, internalFiles: [{ name: "Book One", path: join(first, "Book One.cbz"), kind: "file" }] },
        { path: second, internalFiles: [{ name: "Book.Two", path: join(second, "Book.Two.zip"), kind: "file" }] },
      ] })
    } finally {
      await route[Symbol.asyncDispose]()
    }
  })

  it("[neoview.folder.penetration-http] resolves one nested folder chain through the active browser session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-browser-penetration-"))
    directories.push(directory)
    const outer = join(directory, "outer")
    const inner = join(outer, "inner")
    await mkdir(inner, { recursive: true })
    await writeFile(join(inner, "book.cbz"), "book")
    const route = new ReaderDirectoryBrowserRoute()
    try {
      const opened = (await route.handle(new Request("http://localhost/reader/browser/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: directory }),
      })))!
      const page = await opened.json() as { sessionId: string }
      const response = (await route.handle(new Request(
        `http://localhost/reader/browser/s/${page.sessionId}/penetration/resolve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: outer, policy: { maxDepth: 3 } }),
        },
      )))!
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        status: "resolved",
        originPath: outer,
        terminal: { kind: "archive", path: join(inner, "book.cbz") },
        chain: [{ path: outer }, { path: inner }],
        reason: "archive",
      })

      const missing = (await route.handle(new Request(
        "http://localhost/reader/browser/s/missing/penetration/resolve",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: outer }),
        },
      )))!
      expect(missing.status).toBe(404)
    } finally {
      await route[Symbol.asyncDispose]()
    }
  })

  it("[neoview.folder.selection-http] previews a bounded current-generation selection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-browser-selection-"))
    directories.push(directory)
    for (let index = 0; index < 5; index += 1) await writeFile(join(directory, `item-${index}.cbz`), "book")
    const route = new ReaderDirectoryBrowserRoute()
    try {
      const opened = (await route.handle(new Request("http://localhost/reader/browser/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: directory }),
      })))!
      const page = await opened.json() as { sessionId: string; generation: number; entries: Array<{ path: string }> }
      const endpoint = `http://localhost/reader/browser/s/${page.sessionId}/selection`
      const previewed = (await route.handle(new Request(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          selection: {
            generation: page.generation,
            allSelected: true,
            ranges: [],
            explicit: [{ path: page.entries[1]!.path, index: 1 }],
          },
          previewLimit: 2,
        }),
      })))!
      expect(previewed.status).toBe(200)
      await expect(previewed.json()).resolves.toMatchObject({
        sessionId: page.sessionId,
        generation: page.generation,
        total: 5,
        selectedCount: 4,
        preview: [page.entries[0]!.path, page.entries[2]!.path],
        truncated: true,
      })

      const stale = (await route.handle(new Request(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          selection: { generation: page.generation - 1, allSelected: false, ranges: [], explicit: [] },
        }),
      })))!
      expect(stale.status).toBe(409)
      await expect(stale.json()).resolves.toMatchObject({ error: expect.stringContaining("stale") })
    } finally {
      await route[Symbol.asyncDispose]()
    }
  })

  it("[neoview.folder.emm-tag-suggestions-http] exposes bounded opaque tag suggestions without opening a browser session", async () => {
    const sampleEmmTags = vi.fn(async () => [
      { category: "artist", tag: "Alice" },
      { category: "female", tag: "glasses" },
    ])
    const route = new ReaderDirectoryBrowserRoute(undefined, {
      directoryEmmAvailable: true,
      readDirectoryEmmRecords: async () => new Map(),
      sampleEmmTags,
    }, undefined, {}, undefined, undefined, undefined, undefined, undefined, {
      load: async () => ({ tags: [], mixedGender: false }),
    } as never, {
      translate: async () => new Map(),
      clear: () => false,
    } as never)
    try {
      const response = (await route.handle(new Request("http://localhost/reader/browser/emm-tags/suggestions?count=2")))!
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ tags: [
        { category: "artist", tag: "Alice", favorite: false },
        { category: "female", tag: "glasses", favorite: false },
      ] })
      expect(sampleEmmTags).toHaveBeenCalledWith(4, expect.any(AbortSignal))
      expect((await route.handle(new Request("http://localhost/reader/browser/emm-tags/suggestions?count=33")))?.status).toBe(400)
    } finally {
      await route[Symbol.asyncDispose]()
    }
  })

  it("[neoview.favorite-tags.manual-http] exposes bounded manual tag summaries without a browser session", async () => {
    const listManualTagSummaries = vi.fn(async () => [
      { namespace: "manual", tag: "favorite", count: 3 },
    ])
    const route = new ReaderDirectoryBrowserRoute(
      undefined, undefined, undefined, {}, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      { listManualTagSummaries } as never,
    )
    try {
      const response = (await route.handle(new Request("http://localhost/reader/browser/emm-tags/manual?limit=8")))!
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ tags: [{ namespace: "manual", tag: "favorite", count: 3 }] })
      expect(listManualTagSummaries).toHaveBeenCalledWith(8, expect.any(AbortSignal))
      expect((await route.handle(new Request("http://localhost/reader/browser/emm-tags/manual?limit=257")))?.status).toBe(400)
      const unavailable = new ReaderDirectoryBrowserRoute()
      try {
        expect((await unavailable.handle(new Request("http://localhost/reader/browser/emm-tags/manual")))?.status).toBe(503)
      } finally {
        await unavailable[Symbol.asyncDispose]()
      }
    } finally {
      await route[Symbol.asyncDispose]()
    }
  })

  it("[neoview.folder.tree-roots-http] exposes platform roots without opening a browser session", async () => {
    const list = vi.fn(async () => [
      { path: "C:\\", label: "System (C:)", kind: "fixed" as const, available: true },
      { path: "E:\\", label: "E:", kind: "removable" as const, available: false },
    ])
    const route = new ReaderDirectoryBrowserRoute(undefined, undefined, undefined, {}, undefined, undefined, { list })
    try {
      const response = (await route.handle(new Request("http://localhost/reader/browser/roots")))!
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ roots: [
        { path: "C:\\", label: "System (C:)", kind: "fixed", available: true },
        { path: "E:\\", label: "E:", kind: "removable", available: false },
      ] })
      expect(list).toHaveBeenCalledOnce()
    } finally {
      await route[Symbol.asyncDispose]()
    }
  })

  it("[neoview.folder.search-history-http] exposes the shared scoped history service", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-browser-history-"))
    directories.push(directory)
    const store = await SqliteReaderDataStore.open(join(directory, "thumbnails.db"))
    const route = new ReaderDirectoryBrowserRoute(
      undefined,
      undefined,
      undefined,
      {},
      undefined,
      new ReaderSearchHistoryService(store, () => 100),
    )
    try {
      const endpoint = "http://localhost/reader/browser/search-history"
      const recorded = (await route.handle(new Request(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "folder", query: "  cover  " }),
      })))!
      expect(recorded.status).toBe(201)
      await expect(recorded.json()).resolves.toEqual({ scope: "folder", query: "cover", usedAt: 100, useCount: 1 })
      await expect((await route.handle(new Request(`${endpoint}?scope=folder`)))!.json()).resolves.toEqual({
        scope: "folder",
        entries: [{ scope: "folder", query: "cover", usedAt: 100, useCount: 1 }],
      })
      await expect((await route.handle(new Request(`${endpoint}?scope=folder&query=cover`, { method: "DELETE" })))!.json())
        .resolves.toEqual({ scope: "folder", query: "cover", removed: true })
      await expect((await route.handle(new Request(`${endpoint}?scope=folder`, { method: "DELETE" })))!.json())
        .resolves.toEqual({ scope: "folder", cleared: 0 })
      expect((await route.handle(new Request(`${endpoint}?scope=invalid`)))?.status).toBe(400)
    } finally {
      await route[Symbol.asyncDispose]()
      await store.close()
    }
  })

  it("[neoview.folder.tree-http] lazily expands cached nodes and applies persisted exclusions to tree and search", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-browser-tree-"))
    directories.push(directory)
    const privatePath = join(directory, "private")
    await mkdir(join(privatePath, "nested"), { recursive: true })
    await mkdir(join(directory, "visible"), { recursive: true })
    await writeFile(join(privatePath, "nested", "hidden.cbz"), "hidden")
    await writeFile(join(directory, "visible", "shown.cbz"), "shown")
    const persist = vi.fn(async (paths: readonly string[]) => paths)
    const route = new ReaderDirectoryBrowserRoute(undefined, undefined, undefined, {
      updateExcludedPaths: persist,
    })
    try {
      const opened = (await route.handle(new Request("http://localhost/reader/browser/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: directory }),
      })))!
      const session = await opened.json() as { sessionId: string }
      const treeUrl = `http://localhost/reader/browser/s/${session.sessionId}/tree`
      await expect((await route.handle(new Request(treeUrl)))!.json()).resolves.toMatchObject({
        cacheHit: false,
        entries: [{ name: "private" }, { name: "visible" }],
      })
      await expect((await route.handle(new Request(treeUrl)))!.json()).resolves.toMatchObject({ cacheHit: true })

      const excluded = (await route.handle(new Request(`${treeUrl}/exclusions`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "exclude", path: privatePath }),
      })))!
      expect(excluded.status).toBe(200)
      expect(persist).toHaveBeenCalledWith([privatePath])
      await expect((await route.handle(new Request(treeUrl)))!.json()).resolves.toMatchObject({
        cacheHit: false,
        entries: [{ name: "visible" }],
      })

      const search = (await route.handle(new Request(
        `http://localhost/reader/browser/s/${session.sessionId}/search?q=cbz`,
      )))!
      const events = await readNdjson(search)
      expect(JSON.stringify(events)).toContain("shown.cbz")
      expect(JSON.stringify(events)).not.toContain("hidden.cbz")

      const cleared = (await route.handle(new Request(`${treeUrl}/cache`, { method: "DELETE" })))!
      await expect(cleared.json()).resolves.toMatchObject({ size: 0, excludedPaths: [privatePath] })
    } finally {
      await route[Symbol.asyncDispose]()
    }
  })

  it("[neoview.folder.tabs-duplicate-http] clones a browser session without reopening a path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-browser-clone-"))
    directories.push(directory)
    await writeFile(join(directory, "book.cbz"), "book")
    const route = new ReaderDirectoryBrowserRoute()
    try {
      const opened = (await route.handle(new Request("http://localhost/reader/browser/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: directory }),
      })))!
      const source = await opened.json() as { sessionId: string; path: string }
      const clonedResponse = (await route.handle(new Request(
        `http://localhost/reader/browser/s/${source.sessionId}/clone`,
        { method: "POST" },
      )))!
      expect(clonedResponse.status).toBe(201)
      const cloned = await clonedResponse.json() as { sessionId: string; path: string; entries: Array<{ name: string }> }
      expect(cloned).toMatchObject({ path: source.path, entries: [{ name: "book.cbz" }] })
      expect(cloned.sessionId).not.toBe(source.sessionId)

      expect((await route.handle(new Request(`http://localhost/reader/browser/s/${source.sessionId}`, { method: "DELETE" })))?.status).toBe(204)
      expect((await route.handle(new Request(`http://localhost/reader/browser/s/${cloned.sessionId}/entries`)))?.status).toBe(200)
      expect((await route.handle(new Request("http://localhost/reader/browser/s/missing/clone", { method: "POST" })))?.status).toBe(404)
    } finally {
      await route[Symbol.asyncDispose]()
    }
  })

  it("[neoview.folder.tabs-reopen-http] remembers only explicit tab closes and reopens them through a new session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-browser-reopen-"))
    directories.push(directory)
    await writeFile(join(directory, "book.cbz"), "book")
    const route = new ReaderDirectoryBrowserRoute()
    try {
      const opened = (await route.handle(new Request("http://localhost/reader/browser/sessions", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: directory }),
      })))!
      const source = await opened.json() as { sessionId: string }
      expect((await route.handle(new Request(`http://localhost/reader/browser/s/${source.sessionId}?remember=1`, { method: "DELETE" })))?.status).toBe(204)
      const reopened = (await route.handle(new Request(`http://localhost/reader/browser/s/${source.sessionId}/reopen`, { method: "POST" })))!
      expect(reopened.status).toBe(201)
      expect((await reopened.json() as { sessionId: string }).sessionId).not.toBe(source.sessionId)
      expect((await route.handle(new Request(`http://localhost/reader/browser/s/${source.sessionId}/reopen`, { method: "POST" })))?.status).toBe(404)
    } finally {
      await route[Symbol.asyncDispose]()
    }
  })

  it("[neoview.folder.search-http] [neoview.folder.search-path-http] streams glob results and validates explicit path matching", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-browser-search-"))
    directories.push(directory)
    await mkdir(join(directory, "visible"), { recursive: true })
    await mkdir(join(directory, "private"), { recursive: true })
    await writeFile(join(directory, "visible", "Book.CBZ"), "visible")
    await writeFile(join(directory, "private", "hidden.cbz"), "hidden")
    await writeFile(join(directory, "visible", "readme.txt"), "text")
    const route = new ReaderDirectoryBrowserRoute()
    try {
      const opened = (await route.handle(new Request("http://localhost/reader/browser/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: directory }),
      })))!
      const session = await opened.json() as { sessionId: string }
      const response = (await route.handle(new Request(
        `http://localhost/reader/browser/s/${session.sessionId}/search?q=${encodeURIComponent("**/*.cbz")}&mode=glob&kind=file&exclude=${encodeURIComponent("private/")}`,
      )))!
      expect(response.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8")
      const events = await readNdjson(response)
      expect(events).toEqual([
        expect.objectContaining({ type: "meta", sessionId: session.sessionId, mode: "glob" }),
        expect.objectContaining({ type: "entry", index: 0, entry: expect.objectContaining({ name: "Book.CBZ", kind: "file" }) }),
        expect.objectContaining({ type: "complete", matched: 1, truncated: false }),
      ])
      expect(JSON.stringify(events)).not.toContain("hidden.cbz")

      const nameOnly = await readNdjson((await route.handle(new Request(
        `http://localhost/reader/browser/s/${session.sessionId}/search?q=${encodeURIComponent("visible/Book")}&kind=file`,
      )))!)
      expect(nameOnly.some((event) => event.type === "entry")).toBe(false)
      const pathMatches = await readNdjson((await route.handle(new Request(
        `http://localhost/reader/browser/s/${session.sessionId}/search?q=${encodeURIComponent("visible/Book")}&kind=file&path=1`,
      )))!)
      expect(pathMatches).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "entry", entry: expect.objectContaining({ name: "Book.CBZ" }) }),
      ]))
      const invalidPath = (await route.handle(new Request(
        `http://localhost/reader/browser/s/${session.sessionId}/search?q=book&path=yes`,
      )))!
      expect(invalidPath.status).toBe(400)
    } finally {
      await route[Symbol.asyncDispose]()
    }
  })

  it("[neoview.folder.search-current-http] serves depth-zero NDJSON search from the open listing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-browser-search-current-"))
    directories.push(directory)
    await writeFile(join(directory, "Book.cbz"), "book")
    await writeFile(join(directory, "Private.cbz"), "private")
    await writeFile(join(directory, "notes.txt"), "notes")
    const scan = vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        throw new Error("recursive scanner must not run")
      },
    }))
    const route = new ReaderDirectoryBrowserRoute(undefined, undefined, undefined, {
      scanner: { scan },
    })
    try {
      const opened = (await route.handle(new Request("http://localhost/reader/browser/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: directory }),
      })))!
      const session = await opened.json() as { sessionId: string; generation: number }
      const response = (await route.handle(new Request(
        `http://localhost/reader/browser/s/${session.sessionId}/search?q=${encodeURIComponent("*.cbz")}&mode=glob&kind=file&depth=0&exclude=${encodeURIComponent("Private.cbz")}`,
      )))!

      expect(response.status).toBe(200)
      await expect(readNdjson(response)).resolves.toEqual([
        expect.objectContaining({ type: "meta", sessionId: session.sessionId, generation: session.generation }),
        expect.objectContaining({ type: "entry", index: 0, entry: expect.objectContaining({ name: "Book.cbz", depth: 0 }) }),
        { type: "complete", scanned: 2, matched: 1, truncated: false },
      ])
      expect(scan).not.toHaveBeenCalled()
    } finally {
      await route[Symbol.asyncDispose]()
    }
  })

  it("[neoview.folder.emm-search-http] streams tag-only matches through the shared metadata provider", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-browser-emm-search-"))
    directories.push(directory)
    const first = join(directory, "first.cbz")
    const second = join(directory, "second.cbz")
    await writeFile(first, "first")
    await writeFile(second, "second")
    const readDirectoryEmmRecords = vi.fn(async (paths: readonly string[]) => new Map(paths.map((path) => [path, {
      emmJson: JSON.stringify({ tags: path === first
        ? [{ namespace: "artist", tag: "Alice" }, { namespace: "female", tag: "glasses" }]
        : [{ namespace: "artist", tag: "Bob" }] }),
    }])))
    const route = new ReaderDirectoryBrowserRoute(undefined, {
      directoryEmmAvailable: true,
      readDirectoryEmmRecords,
    })
    try {
      const opened = (await route.handle(new Request("http://localhost/reader/browser/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: directory }),
      })))!
      const session = await opened.json() as { sessionId: string }
      readDirectoryEmmRecords.mockClear()
      const response = (await route.handle(new Request(
        `http://localhost/reader/browser/s/${session.sessionId}/search?depth=0&tag=${encodeURIComponent("artist:alice")}`,
      )))!

      expect(response.status).toBe(200)
      const events = await readNdjson(response)
      expect(events.filter((event) => event.type === "entry")).toEqual([
        expect.objectContaining({ entry: expect.objectContaining({ name: "first.cbz", tags: expect.arrayContaining(["artist:Alice"]) }) }),
      ])
      expect(readDirectoryEmmRecords).toHaveBeenCalledOnce()
    } finally {
      await route[Symbol.asyncDispose]()
    }
  })

  it("[neoview.folder.search-http-cancellation] aborts the shared scanner when the NDJSON consumer cancels", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-browser-search-cancel-"))
    directories.push(directory)
    let scanClosed = false
    const route = new ReaderDirectoryBrowserRoute(undefined, undefined, undefined, {
      scanner: {
        async *scan(rootPath, _options, signal) {
          try {
            yield { name: "first.cbz", path: join(rootPath, "first.cbz"), relativePath: "first.cbz", depth: 0, kind: "file" as const }
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
    try {
      const opened = (await route.handle(new Request("http://localhost/reader/browser/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: directory }),
      })))!
      const session = await opened.json() as { sessionId: string }
      const response = (await route.handle(new Request(
        `http://localhost/reader/browser/s/${session.sessionId}/search?q=cbz`,
      )))!
      const reader = response.body!.getReader()
      expect(decodeNdjsonChunk((await reader.read()).value)[0]).toMatchObject({ type: "meta" })
      expect(decodeNdjsonChunk((await reader.read()).value)[0]).toMatchObject({ type: "entry" })
      await reader.cancel("not visible")
      expect(scanClosed).toBe(true)
    } finally {
      await route[Symbol.asyncDispose]()
    }
  })

  it("[neoview.folder.watch-http] [neoview.folder.tree-watch-http] refreshes an explicitly watched session and releases its native subscription", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-browser-watch-"))
    directories.push(directory)
    await writeFile(join(directory, "a.cbz"), "a")
    let changes: ((events: readonly [{ path: string; kind: "create" }]) => void) | undefined
    const close = vi.fn(async () => undefined)
    const route = new ReaderDirectoryBrowserRoute(undefined, undefined, undefined, {
      watcher: {
        async subscribe(_path, onChanges) {
          changes = onChanges as typeof changes
          return { close, [Symbol.asyncDispose]: close }
        },
      },
    })
    try {
      const opened = (await route.handle(new Request("http://localhost/reader/browser/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: directory, watch: true }),
      })))!
      const initial = await opened.json() as { sessionId: string; generation: number; total: number; watching: boolean }
      expect(initial).toMatchObject({ generation: 1, total: 1, watching: true })

      const addedPath = join(directory, "b.cbz")
      await writeFile(addedPath, "b")
      const changeResponse = route.handle(new Request(
        `http://localhost/reader/browser/s/${initial.sessionId}/changes?after=1&wait=1000&focus=${encodeURIComponent(join(directory, "a.cbz"))}`,
      ))
      await Promise.resolve()
      changes?.([{ path: addedPath, kind: "create" }])
      const refreshed = (await changeResponse)!
      await expect(refreshed.json()).resolves.toMatchObject({
        generation: 2,
        total: 2,
        watching: true,
        suggestedSelection: { path: join(directory, "a.cbz"), index: 0 },
      })
      const heartbeat = (await route.handle(new Request(
        `http://localhost/reader/browser/s/${initial.sessionId}/changes?after=2&wait=10`,
      )))!
      expect(heartbeat.status).toBe(204)
      expect(await heartbeat.text()).toBe("")

      const nestedPath = join(directory, "nested")
      const nestedFilePath = join(nestedPath, "inside.cbz")
      await mkdir(nestedPath)
      await writeFile(nestedFilePath, "nested")
      const treeChangeResponse = route.handle(new Request(
        `http://localhost/reader/browser/s/${initial.sessionId}/tree/changes?after=1&wait=1000`,
      ))
      await Promise.resolve()
      changes?.([{ path: nestedFilePath, kind: "create" }])
      await expect((await treeChangeResponse)!.json()).resolves.toMatchObject({
        revision: 2,
        paths: [nestedPath],
        reset: false,
      })
      const nestedListHeartbeat = (await route.handle(new Request(
        `http://localhost/reader/browser/s/${initial.sessionId}/changes?after=2&wait=10`,
      )))!
      expect(nestedListHeartbeat.status).toBe(204)

      const closed = (await route.handle(new Request(
        `http://localhost/reader/browser/s/${initial.sessionId}`,
        { method: "DELETE" },
      )))!
      expect(closed.status).toBe(204)
      expect(close).toHaveBeenCalledOnce()
    } finally {
      await route[Symbol.asyncDispose]()
    }
  })

  it("[neoview.folder.open-file-location] opens a file's parent directory and returns its stable selection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-browser-file-location-"))
    directories.push(directory)
    const selectedPath = join(directory, "selected.cbz")
    await writeFile(join(directory, "before.cbz"), "before")
    await writeFile(selectedPath, "selected")
    const route = new ReaderDirectoryBrowserRoute()
    try {
      const response = (await route.handle(new Request("http://localhost/reader/browser/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: selectedPath }),
      })))!
      expect(response.status).toBe(201)
      await expect(response.json()).resolves.toMatchObject({
        path: directory,
        suggestedSelection: { path: selectedPath, index: 1 },
      })
    } finally {
      await route[Symbol.asyncDispose]()
    }
  })

  it("[neoview.browser.http] returns directories and naturally sorted reader sources", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-browser-"))
    directories.push(directory)
    await mkdir(join(directory, "nested"))
    await writeFile(join(directory, "page10.png"), "ten")
    await writeFile(join(directory, "page2.png"), "two")
    await writeFile(join(directory, "notes.txt"), "notes")
    const route = new ReaderDirectoryBrowserRoute()
    try {
      const opened = (await route.handle(new Request("http://localhost/reader/browser/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: directory }),
      })))!
      expect(opened.status).toBe(201)
      const body = await opened.json() as { sessionId: string; entries: Array<{ name: string; kind: string; readerSupported: boolean }> }
      expect(body.entries).toEqual([
        expect.objectContaining({ name: "nested", kind: "directory", readerSupported: true }),
        expect.objectContaining({ name: "notes.txt", kind: "file", readerSupported: false }),
        expect.objectContaining({ name: "page2.png", kind: "file", readerSupported: true }),
        expect.objectContaining({ name: "page10.png", kind: "file", readerSupported: true }),
      ])
      const restored = (await route.handle(new Request(`http://localhost/reader/browser/s/${body.sessionId}/navigate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "refresh", focusPath: join(directory, "page2.png") }),
      })))!
      expect(restored.status).toBe(200)
      await expect(restored.json()).resolves.toMatchObject({
        suggestedSelection: { path: join(directory, "page2.png"), index: 2 },
      })
      const invalidFocus = (await route.handle(new Request(`http://localhost/reader/browser/s/${body.sessionId}/navigate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "refresh", focusPath: "" }),
      })))!
      expect(invalidFocus.status).toBe(400)
      const sorted = (await route.handle(new Request(`http://localhost/reader/browser/s/${body.sessionId}/sort`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ field: "size", order: "desc", directoriesFirst: true, focusPath: join(directory, "page2.png") }),
      })))!
      expect(sorted.status).toBe(200)
      const sortedBody = await sorted.json() as { sort: { field: string; order: string }; sortFields: string[]; suggestedSelection: { path: string; index: number }; entries: Array<{ name: string; size?: number }> }
      expect(sortedBody.sort).toEqual({ field: "size", order: "desc", directoriesFirst: true })
      expect(sortedBody.sortFields).toEqual(["name", "date", "size", "type", "random", "path"])
      expect(sortedBody.entries.map((entry) => entry.name)).toEqual(["nested", "notes.txt", "page2.png", "page10.png"])
      expect(sortedBody.suggestedSelection).toMatchObject({ path: join(directory, "page2.png"), index: 2 })
      const locked = (await route.handle(new Request(`http://localhost/reader/browser/s/${body.sessionId}/sort/preferences`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "temporary", enabled: true, focusPath: join(directory, "page2.png") }),
      })))!
      expect(locked.status).toBe(200)
      await expect(locked.json()).resolves.toMatchObject({ sortSource: "temporary", sortTemporary: true })
      expect((await route.handle(new Request(`http://localhost/reader/browser/s/${body.sessionId}`, { method: "DELETE" })))?.status).toBe(204)
    } finally {
      await route[Symbol.asyncDispose]()
    }
  })

  it("[neoview.folder.size-http] returns generation-bound recursive sizes without delaying the initial listing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-browser-size-"))
    directories.push(directory)
    const small = join(directory, "small")
    const large = join(directory, "large")
    await mkdir(join(large, "nested"), { recursive: true })
    await mkdir(small)
    await writeFile(join(small, "a.bin"), Buffer.alloc(3))
    await writeFile(join(large, "nested", "b.bin"), Buffer.alloc(7))
    const route = new ReaderDirectoryBrowserRoute()
    try {
      const opened = (await route.handle(new Request("http://localhost/reader/browser/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: directory }),
      })))!
      const session = await opened.json() as { sessionId: string; generation: number; entries: Array<{ path: string; size?: number }> }
      expect(session.entries.every((entry) => entry.size === undefined)).toBe(true)
      const endpoint = `http://localhost/reader/browser/s/${session.sessionId}/directory-sizes`
      const sizes = (await route.handle(new Request(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ generation: session.generation, paths: [small, large] }),
      })))!
      await expect(sizes.json()).resolves.toEqual({
        sessionId: session.sessionId,
        generation: session.generation,
        results: [
          { path: small, status: "ok", bytes: 3, fileCount: 1 },
          { path: large, status: "ok", bytes: 7, fileCount: 1 },
        ],
      })
      const stale = (await route.handle(new Request(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ generation: 0, paths: [small] }),
      })))!
      expect(stale.status).toBe(409)
    } finally {
      await route[Symbol.asyncDispose]()
    }
  })

  it("[neoview.folder.sort-route-persistence] restores folder memory across browser route lifetimes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-browser-preferences-"))
    directories.push(directory)
    await writeFile(join(directory, "page10.png"), "ten")
    await writeFile(join(directory, "page2.jpg"), "two")
    const store = await SqliteReaderDataStore.open(join(directory, "reader.db"))
    const firstRoute = new ReaderDirectoryBrowserRoute(store)
    try {
      const opened = (await firstRoute.handle(new Request("http://localhost/reader/browser/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: directory, scopeId: "tab-persisted" }),
      })))!
      const session = await opened.json() as { sessionId: string }
      const sorted = (await firstRoute.handle(new Request(`http://localhost/reader/browser/s/${session.sessionId}/sort`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ field: "type", order: "desc", directoriesFirst: true }),
      })))!
      await expect(sorted.json()).resolves.toMatchObject({ sortSource: "memory", sort: { field: "type", order: "desc" } })
    } finally {
      await firstRoute[Symbol.asyncDispose]()
    }

    const secondRoute = new ReaderDirectoryBrowserRoute(store)
    try {
      const reopened = (await secondRoute.handle(new Request("http://localhost/reader/browser/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: directory, scopeId: "tab-persisted" }),
      })))!
      await expect(reopened.json()).resolves.toMatchObject({ sortSource: "memory", sort: { field: "type", order: "desc" } })
    } finally {
      await secondRoute[Symbol.asyncDispose]()
      await store.close()
    }
  })

  it("[neoview.folder.emm-route] [neoview.file-list-tag-display.http-dto] exposes EMM sort capabilities and hydrates the visible batch", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-browser-emm-"))
    directories.push(directory)
    const first = join(directory, "first.cbz")
    const second = join(directory, "second.cbz")
    await writeFile(first, "one")
    await writeFile(second, "two")
    const route = new ReaderDirectoryBrowserRoute(undefined, {
      directoryEmmAvailable: true,
      readDirectoryEmmRecords: async () => new Map([
        [first, { ratingData: JSON.stringify({ value: 2 }) }],
        [second, {
          emmJson: JSON.stringify({ rating: 5, tags: [{ namespace: "artist", tag: "alice" }, { namespace: "female", tag: "glasses" }] }),
          manualTags: JSON.stringify([{ namespace: "manual", tag: "favorite" }]),
        }],
      ]),
    }, undefined, {}, undefined, undefined, undefined, undefined, undefined, {
      load: async () => ({ tags: [{ category: "female", tag: "glasses" }], mixedGender: false }),
    } as never)
    try {
      const opened = (await route.handle(new Request("http://localhost/reader/browser/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: directory }),
      })))!
      const body = await opened.json() as {
        sessionId: string
        sortFields: string[]
        metadataFields: string[]
        entries: Array<{ name: string; rating: number; collectTagCount?: number; tags?: string[]; collectTags?: string[]; manualTags?: string[] }>
      }
      expect(body.sortFields).toContain("rating")
      expect(body.sortFields).toContain("collectTagCount")
      expect(body.metadataFields).toEqual(["rating", "collectTagCount", "tags"])
      expect(body.entries).toEqual([
        expect.objectContaining({ name: "first.cbz", rating: 2, collectTagCount: 0 }),
        expect.objectContaining({
          name: "second.cbz",
          rating: 5,
          collectTagCount: 1,
          tags: ["artist:alice", "female:glasses", "manual:favorite"],
          collectTags: ["female:glasses"],
          manualTags: ["manual:favorite"],
        }),
      ])
      const sorted = (await route.handle(new Request(`http://localhost/reader/browser/s/${body.sessionId}/sort`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ field: "rating", order: "desc", directoriesFirst: true }),
      })))!
      const sortedBody = await sorted.json() as { entries: Array<{ name: string }> }
      expect(sortedBody.entries.map((entry) => entry.name)).toEqual(["second.cbz", "first.cbz"])
    } finally {
      await route[Symbol.asyncDispose]()
    }
  })

  it("[neoview.folder.details-on-demand] hydrates expensive fields only for an explicit details page", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-browser-details-"))
    directories.push(directory)
    await writeFile(join(directory, "book.cbz"), "book")
    const mediaHydrate = vi.fn(async (entries: readonly Record<string, unknown>[]) => entries.map((entry) => ({
      ...entry,
      width: 1200,
      height: 1800,
      pageCount: 24,
    })))
    const route = new ReaderDirectoryBrowserRoute(undefined, undefined, {
      supportedFields: new Set(["dimensions", "pageCount"]),
      hydrate: mediaHydrate,
    } as never)
    try {
      const opened = (await route.handle(new Request("http://localhost/reader/browser/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: directory }),
      })))!
      const initial = await opened.json() as { sessionId: string; metadataCapabilities: string[]; entries: Array<{ width?: number }> }
      expect(initial.metadataCapabilities).toEqual(expect.arrayContaining(["dimensions", "pageCount"]))
      expect(initial.entries[0]?.width).toBeUndefined()
      expect(mediaHydrate).not.toHaveBeenCalled()

      const details = (await route.handle(new Request(
        `http://localhost/reader/browser/s/${initial.sessionId}/entries?cursor=0&limit=128&fields=date,size,dimensions,pageCount`,
      )))!
      await expect(details.json()).resolves.toMatchObject({
        metadataFields: expect.arrayContaining(["date", "size", "dimensions", "pageCount"]),
        entries: [expect.objectContaining({ width: 1200, height: 1800, pageCount: 24, size: 4 })],
      })
      expect(mediaHydrate).toHaveBeenCalledTimes(1)

      const invalid = (await route.handle(new Request(
        `http://localhost/reader/browser/s/${initial.sessionId}/entries?fields=unknown`,
      )))!
      expect(invalid.status).toBe(400)
    } finally {
      await route[Symbol.asyncDispose]()
    }
  })
})

async function readNdjson(response: Response): Promise<Array<Record<string, unknown>>> {
  return (await response.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
}

function decodeNdjsonChunk(value: Uint8Array | undefined): Array<Record<string, unknown>> {
  return new TextDecoder().decode(value).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
}
