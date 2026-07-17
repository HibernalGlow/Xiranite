import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderBookSettingsRecord, ReaderBookSettingsStore } from "../../ports/ReaderBookSettingsStore.js"
import { ReaderHttpController, type ReaderSessionDto } from "./ReaderHttpController.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Reader book settings HTTP", () => {
  it("[neoview.book-settings.http] [neoview.book-settings.horizontal-policy] restores per-book frame overrides and exposes inherited revisioned updates", async () => {
    const directory = await createBookDirectory()
    const store = memoryStore({
      bookId: "resolved-on-read",
      overrides: { favorite: true, direction: "right-to-left", pageMode: "double", horizontalBook: false },
      revision: 1,
      updatedAt: 10,
    })
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      progressStore: false,
      bookSettingsStore: store,
      sessionOptions: {
        direction: "left-to-right",
        layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      },
    })
    try {
      const opened = (await controller.handle(jsonRequest("/reader/sessions", { path: directory })))!
      const session = await opened.json() as ReaderSessionDto
      expect(session.frame).toMatchObject({ direction: "right-to-left", layout: { pageMode: "double", treatWidePageAsSingle: false } })

      expect((await controller.handle(new Request(`http://127.0.0.1:41000/reader/s/${session.sessionId}/book-settings`)))?.status).toBe(401)
      const current = await (await controller.handle(authorized(`/reader/s/${session.sessionId}/book-settings`)))!.json()
      expect(current.settings).toMatchObject({
        schemaVersion: 1,
        revision: 1,
        overrides: { favorite: true, direction: "right-to-left", pageMode: "double", horizontalBook: false },
        effective: { favorite: true, rating: 0, direction: "right-to-left", pageMode: "double", horizontalBook: false },
      })
      expect(current.settings.inherited).toEqual(["rating"])

      const updated = (await controller.handle(jsonRequest(`/reader/s/${session.sessionId}/book-settings`, {
        expectedRevision: 1,
        patch: { rating: 5, direction: null, pageMode: null, horizontalBook: null },
      }, "PATCH")))!
      expect(updated.status).toBe(200)
      await expect(updated.json()).resolves.toMatchObject({
        settings: {
          revision: 2,
          overrides: { favorite: true, rating: 5 },
          effective: { direction: "left-to-right", pageMode: "single" },
        },
        frame: { direction: "left-to-right", layout: { pageMode: "single", treatWidePageAsSingle: true } },
      })

      const stale = (await controller.handle(jsonRequest(`/reader/s/${session.sessionId}/book-settings`, {
        expectedRevision: 1,
        patch: { favorite: false },
      }, "PATCH")))!
      expect(stale.status).toBe(409)
      await expect(stale.json()).resolves.toMatchObject({ actualRevision: 2 })
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("rejects unsupported fields and invalid values without writing", async () => {
    const directory = await createBookDirectory()
    const store = memoryStore()
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      progressStore: false,
      bookSettingsStore: store,
    })
    try {
      const session = await (await controller.handle(jsonRequest("/reader/sessions", { path: directory })))!.json() as ReaderSessionDto
      expect((await controller.handle(jsonRequest(`/reader/s/${session.sessionId}/book-settings`, {
        expectedRevision: 0,
        patch: { rating: 6 },
      }, "PATCH")))?.status).toBe(400)
      expect((await controller.handle(jsonRequest(`/reader/s/${session.sessionId}/book-settings`, {
        expectedRevision: 0,
        patch: { future: true },
      }, "PATCH")))?.status).toBe(400)
      expect(store.saveBookSettings).not.toHaveBeenCalled()
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.book-settings.http-rollback] reports persistence failure as server error and restores the confirmed frame", async () => {
    const directory = await createBookDirectory()
    const record: ReaderBookSettingsRecord = { bookId: "resolved-on-read", overrides: {}, revision: 1, updatedAt: 1 }
    const store: ReaderBookSettingsStore = {
      getBookSettings: vi.fn(async (bookId) => ({ ...record, bookId })),
      saveBookSettings: vi.fn(async () => { throw new Error("database busy") }),
    }
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      progressStore: false,
      bookSettingsStore: store,
    })
    try {
      const session = await (await controller.handle(jsonRequest("/reader/sessions", { path: directory })))!.json() as ReaderSessionDto
      const failed = (await controller.handle(jsonRequest(`/reader/s/${session.sessionId}/book-settings`, {
        expectedRevision: 1,
        patch: { direction: "right-to-left", pageMode: "double" },
      }, "PATCH")))!
      expect(failed.status).toBe(500)
      const current = await (await controller.handle(authorized(`/reader/s/${session.sessionId}`)))!.json() as ReaderSessionDto
      expect(current.frame).toMatchObject({ direction: "left-to-right", layout: { pageMode: "single" } })
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

function memoryStore(initial?: ReaderBookSettingsRecord) {
  let record = initial
  const saveBookSettings = vi.fn(async (bookId: string, overrides: Parameters<ReaderBookSettingsStore["saveBookSettings"]>[1], expectedRevision: number, updatedAt: number) => {
    const actual = record?.revision ?? 0
    if (actual !== expectedRevision) return undefined
    record = { bookId, overrides: structuredClone(overrides), revision: actual + 1, updatedAt }
    return structuredClone(record)
  })
  return {
    async getBookSettings(bookId) {
      return record ? { ...structuredClone(record), bookId } : undefined
    },
    saveBookSettings,
  }
}

async function createBookDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-book-settings-"))
  roots.push(directory)
  await Promise.all([1, 2, 3].map((index) => writeFile(join(directory, `${index}.jpg`), Uint8Array.of(index))))
  return directory
}

function jsonRequest(path: string, body: unknown, method = "POST"): Request {
  return authorized(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function authorized(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  headers.set("x-xiranite-token", "reader-token")
  return new Request(new URL(path, "http://127.0.0.1:41000"), { ...init, headers })
}
