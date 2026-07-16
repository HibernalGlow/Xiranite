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

  it("[neoview.folder.watch-http] refreshes an explicitly watched session and releases its native subscription", async () => {
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
      changes?.([{ path: addedPath, kind: "create" }])
      const refreshed = (await route.handle(new Request(
        `http://localhost/reader/browser/s/${initial.sessionId}/entries`,
      )))!
      await expect(refreshed.json()).resolves.toMatchObject({ generation: 2, total: 2, watching: true })

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

  it("[neoview.folder.emm-route] exposes EMM sort capabilities and hydrates the visible batch", async () => {
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
        [second, { emmJson: JSON.stringify({ rating: 5, tags: [] }) }],
      ]),
    })
    try {
      const opened = (await route.handle(new Request("http://localhost/reader/browser/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: directory }),
      })))!
      const body = await opened.json() as { sessionId: string; sortFields: string[]; metadataFields: string[]; entries: Array<{ name: string; rating: number }> }
      expect(body.sortFields).toContain("rating")
      expect(body.sortFields).toContain("collectTagCount")
      expect(body.metadataFields).toEqual(["rating", "collectTagCount"])
      expect(body.entries).toEqual([
        expect.objectContaining({ name: "first.cbz", rating: 2, collectTagCount: 0 }),
        expect.objectContaining({ name: "second.cbz", rating: 5, collectTagCount: 0 }),
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
