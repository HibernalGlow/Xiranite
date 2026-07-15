import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { createReaderHttpController } from "../../platform.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Reader data store composition", () => {
  it("[neoview.reader-data.composition] shares progress writes with the recent-books control plane", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-reader-data-composition-"))
    roots.push(root)
    const bookPath = join(root, "book")
    const databasePath = join(root, "thumbnails.db")
    await mkdir(bookPath)
    await writeFile(join(bookPath, "001.png"), pngHeader(32, 48))
    await writeFile(join(bookPath, "002.png"), pngHeader(48, 32))

    const controller = await createReaderHttpController({
      baseUrl: "http://127.0.0.1:43127",
      token: "runtime-token",
      configPath: join(root, "missing.toml"),
      legacyThumbnailDatabasePath: databasePath,
    })
    try {
      const opened = await controller.handle(jsonRequest("/reader/sessions", { path: bookPath }))
      expect(opened?.status).toBe(201)
      const session = await opened!.json() as { sessionId: string; book: { id: string } }
      const navigated = await controller.handle(jsonRequest(`/reader/s/${session.sessionId}/navigate`, { action: "goTo", pageIndex: 1 }))
      expect(navigated?.status).toBe(200)
      expect((await controller.handle(authorized(`/reader/s/${session.sessionId}`, { method: "DELETE" })))?.status).toBe(204)

      const response = await controller.handle(authorized("/reader/library/recents?limit=10"))
      expect(response?.status).toBe(200)
      await expect(response!.json()).resolves.toEqual({
        items: [expect.objectContaining({
          bookId: session.book.id,
          displayName: "book",
          pageIndex: 1,
          pageCount: 2,
        })],
      })
    } finally {
      await controller[Symbol.asyncDispose]()
    }

    const database = await openDatabase(databasePath)
    expect(database.get("SELECT COUNT(*) AS count FROM xr_reader_progress")).toEqual({ count: 1 })
    expect(database.get("SELECT COUNT(*) AS count FROM xr_reader_bookmarks")).toEqual({ count: 0 })
    database.close()
  })
})

function authorized(path: string, init: RequestInit = {}): Request {
  return new Request(`http://127.0.0.1:43127${path}`, {
    ...init,
    headers: { ...init.headers, "x-xiranite-token": "runtime-token" },
  })
}

function jsonRequest(path: string, body: unknown): Request {
  return authorized(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8)
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  bytes[24] = 8
  bytes[25] = 2
  return bytes
}

interface TestDatabase {
  get(sql: string): Record<string, unknown> | undefined
  close(): void
}

async function openDatabase(path: string): Promise<TestDatabase> {
  if (process.versions.bun) {
    const moduleName = "bun:sqlite"
    const sqlite = await import(moduleName) as unknown as {
      Database: new (path: string, options: { readonly: boolean; strict: boolean }) => {
        query(sql: string): { get(): Record<string, unknown> | null }
        close(): void
      }
    }
    const database = new sqlite.Database(path, { readonly: true, strict: true })
    return { get: (sql) => database.query(sql).get() ?? undefined, close: () => database.close() }
  }
  const moduleName = "node:sqlite"
  const sqlite = await import(moduleName) as typeof import("node:sqlite")
  const database = new sqlite.DatabaseSync(path, { readOnly: true })
  return {
    get: (sql) => database.prepare(sql).get() as Record<string, unknown> | undefined,
    close: () => database.close(),
  }
}
