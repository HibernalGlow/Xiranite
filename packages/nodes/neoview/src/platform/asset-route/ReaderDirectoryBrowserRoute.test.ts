import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReaderDirectoryBrowserRoute } from "./ReaderDirectoryBrowserRoute.js"
import { SqliteReaderDataStore } from "../persistence/SqliteReaderDataStore.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("ReaderDirectoryBrowserRoute", () => {
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
