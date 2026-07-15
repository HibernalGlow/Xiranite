import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

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
})
