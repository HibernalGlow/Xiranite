import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

import type { ReaderLibraryService } from "../../application/library/ReaderLibraryService.js"
import type { ReaderStartupStateStore } from "../../ports/ReaderStartupStateStore.js"
import { ReaderHttpController } from "./ReaderHttpController.js"
import { ReaderStartupStateHttpController } from "./ReaderStartupStateHttpController.js"

describe("ReaderStartupStateHttpController", () => {
  it("[neoview.startup-state.http] returns the latest progress and independently persists the last folder", async () => {
    const store = fixtureStore()
    const listRecent = vi.fn(async () => [{
      bookId: "last-book",
      source: { kind: "archive" as const, path: "D:/books/last.cbz" },
      displayName: "Last",
      pageIndex: 2,
      pageCount: 10,
      updatedAt: 50,
    }])
    const controller = new ReaderStartupStateHttpController({ store, library: { listRecent } })

    const before = await controller.handle(request("GET"))
    await expect(before.json()).resolves.toEqual({ lastFolder: null, lastBook: expect.objectContaining({ bookId: "last-book" }) })
    expect(listRecent).toHaveBeenCalledWith({ limit: 1, offset: 0 })

    const saved = await controller.handle(request("PATCH", { lastFolder: "D:/books" }))
    await expect(saved.json()).resolves.toEqual({ lastFolder: { path: "D:/books", updatedAt: 1 } })
    const cleared = await controller.handle(request("PATCH", { lastFolder: null }))
    await expect(cleared.json()).resolves.toEqual({ lastFolder: null })
    expect(store.clearLastFolder).toHaveBeenCalledOnce()
    expect((await controller.handle(request("PATCH", { lastFolder: "" }))).status).toBe(400)
  })

  it("[neoview.startup-state.http-composition] surfaces the last book through the reader controller", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-startup-state-"))
    const bookPath = join(directory, "last.cbz")
    await writeFile(bookPath, "book")
    const store = fixtureStore()
    store.getLastFolder.mockResolvedValueOnce({ path: "D:/books", updatedAt: 2 })
    const listRecent = vi.fn(async () => [{
      bookId: "last-book",
      source: { kind: "archive" as const, path: bookPath },
      displayName: "Last",
      pageIndex: 0,
      pageCount: 1,
      updatedAt: 3,
    }])
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      libraryService: { listRecent } as unknown as ReaderLibraryService,
      startupStateStore: store,
    })
    try {
      const response = (await controller.handle(new Request("http://127.0.0.1:41000/reader/startup-state", {
        headers: { "x-xiranite-token": "reader-token" },
      })))!
      await expect(response.json()).resolves.toEqual({
        lastFolder: { path: "D:/books", updatedAt: 2 },
        lastBook: expect.objectContaining({ bookId: "last-book" }),
      })
      expect(listRecent).toHaveBeenCalledWith({ limit: 1, offset: 0 })
    } finally {
      await controller[Symbol.asyncDispose]()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("[neoview.startup-state.missing-book-http] does not offer a missing recent source for automatic restore", async () => {
    const lastBook = {
      bookId: "missing-book",
      source: { kind: "archive" as const, path: "D:/books/missing.cbz" },
      displayName: "Missing",
      pageIndex: 0,
      pageCount: 1,
      updatedAt: 3,
    }
    const check = vi.fn()
      .mockResolvedValueOnce("missing" as const)
      .mockResolvedValueOnce("unknown" as const)
    const controller = new ReaderStartupStateHttpController({
      library: { listRecent: vi.fn(async () => [lastBook]) },
      pathStatus: { check },
    })

    await expect((await controller.handle(request("GET"))).json()).resolves.toMatchObject({ lastBook: null })
    await expect((await controller.handle(request("GET"))).json()).resolves.toMatchObject({ lastBook })
    expect(check).toHaveBeenCalledWith(lastBook.source.path, expect.any(AbortSignal))
  })
})

function request(method: string, body?: unknown): Request {
  return new Request("http://127.0.0.1:41000/reader/startup-state", {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function fixtureStore(): ReaderStartupStateStore & {
  getLastFolder: ReturnType<typeof vi.fn>
  saveLastFolder: ReturnType<typeof vi.fn>
  clearLastFolder: ReturnType<typeof vi.fn>
} {
  let state: { path: string; updatedAt: number } | undefined
  return {
    getLastFolder: vi.fn(async () => state),
    saveLastFolder: vi.fn(async (path: string) => {
      if (!path.trim()) throw new Error("folder path is empty")
      state = { path, updatedAt: 1 }
      return state
    }),
    clearLastFolder: vi.fn(async () => { state = undefined }),
    close: vi.fn(async () => undefined),
    [Symbol.asyncDispose]: vi.fn(async () => undefined),
  }
}
