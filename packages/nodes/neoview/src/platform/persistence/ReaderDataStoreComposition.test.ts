import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { createReaderFileTreeController, createReaderHeadlessController, createReaderHttpController } from "../../platform.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Reader data store composition", () => {
  it("[neoview.reader-data.composition] [neoview.folder.search-history-composition] shares one Reader database across control planes", async () => {
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
      const history = await controller.handle(authorized("/reader/browser/search-history", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "folder", query: "book" }),
      }))
      expect(history?.status).toBe(201)
    } finally {
      await controller[Symbol.asyncDispose]()
    }

    const database = await openDatabase(databasePath)
    expect(database.get("SELECT COUNT(*) AS count FROM xr_reader_progress")).toEqual({ count: 1 })
    expect(database.get("SELECT COUNT(*) AS count FROM xr_reader_bookmarks")).toEqual({ count: 0 })
    expect(database.get("SELECT scope_id, query, use_count FROM xr_reader_search_history")).toEqual({
      scope_id: "folder", query: "book", use_count: 1,
    })
    database.close()
  })

  it("[neoview.media-progress.composition] shares the Reader SQLite store with runtime video progress", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-reader-media-composition-"))
    roots.push(root)
    const videoPath = join(root, "clip.mp4")
    const databasePath = join(root, "thumbnails.db")
    await writeFile(videoPath, Uint8Array.of(0, 1, 2, 3))

    const controller = await createReaderHttpController({
      baseUrl: "http://127.0.0.1:43127",
      token: "runtime-token",
      configPath: join(root, "missing.toml"),
      legacyThumbnailDatabasePath: databasePath,
    })
    let bookId = ""
    try {
      const opened = await controller.handle(jsonRequest("/reader/sessions", { path: videoPath }))
      expect(opened?.status).toBe(201)
      const session = await opened!.json() as { sessionId: string; book: { id: string } }
      bookId = session.book.id
      const progress = await controller.handle(authorized(`/reader/s/${session.sessionId}/media-progress`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ position: 45.5, duration: 90, completed: false, flush: true }),
      }))
      expect(progress?.status).toBe(200)
      expect(await progress!.json()).toMatchObject({ durable: true, progress: { position: 45.5, duration: 90 } })
    } finally {
      await controller[Symbol.asyncDispose]()
    }

    const database = await openDatabase(databasePath)
    expect(database.get(`SELECT position, duration, completed FROM xr_reader_media_progress WHERE book_id = '${bookId}'`))
      .toEqual({ position: 45.5, duration: 90, completed: 0 })
    database.close()
  })

  it("[neoview.book-settings.headless-composition] injects the shared SQLite settings service into headless clients", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-reader-book-settings-headless-"))
    roots.push(root)
    const bookPath = join(root, "book")
    const databasePath = join(root, "thumbnails.db")
    await mkdir(bookPath)
    await writeFile(join(bookPath, "001.png"), pngHeader(32, 48))

    const controller = await createReaderHeadlessController({
      configPath: join(root, "missing.toml"),
      legacyThumbnailDatabasePath: databasePath,
    })
    let bookId = ""
    try {
      await controller.open({ path: bookPath })
      const current = await controller.getBookSettings()
      bookId = current.bookId
      expect(current).toMatchObject({ revision: 0, effective: { pageMode: "single", direction: "left-to-right" } })
      const updated = await controller.updateBookSettings(0, { favorite: true, pageMode: "double" })
      expect(updated).toMatchObject({
        settings: { revision: 1, overrides: { favorite: true, pageMode: "double" } },
        reader: { frame: { layout: { pageMode: "double" } } },
      })
    } finally {
      await controller[Symbol.asyncDispose]()
    }

    const database = await openDatabase(databasePath)
    expect(database.get(`SELECT revision, favorite, page_mode FROM xr_reader_book_settings WHERE book_id = '${bookId}'`))
      .toEqual({ revision: 1, favorite: 1, page_mode: "double" })
    database.close()
  })

  it("[neoview.folder.emm-headless-composition] lazily shares one legacy database for tag search, suggestions and history", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-reader-folder-emm-headless-"))
    roots.push(root)
    const databasePath = join(root, "thumbnails.db")
    const bookPath = join(root, "Alice.cbz")
    await writeFile(bookPath, Uint8Array.of(1, 2, 3))
    const seed = await openDatabase(databasePath)
    seed.exec(`
      CREATE TABLE thumbs (key TEXT PRIMARY KEY, emm_json TEXT, rating_data TEXT, manual_tags TEXT);
      INSERT INTO thumbs (key, emm_json) VALUES (${sqlString(bookPath)},
        '{"tags":[{"namespace":"artist","tag":"Alice"}]}');
    `)
    seed.close()

    const controller = await createReaderFileTreeController({
      configPath: join(root, "missing.toml"),
      legacyThumbnailDatabasePath: databasePath,
    })
    try {
      const opened = await controller.open({ path: root })
      expect(opened.metadataCapabilities).toContain("tags")
      const search = controller.search("", { maximumDepth: 0, includeTags: ["artist:alice"] })
      const events = []
      for await (const event of search.events) events.push(event)
      await search.close()
      expect(events).toContainEqual(expect.objectContaining({ type: "entry", entry: expect.objectContaining({ path: bookPath }) }))
      await expect(controller.suggestEmmTags(4)).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ category: "artist", tag: "Alice", favorite: false }),
      ]))
      await expect(controller.recordSearchHistory("folder", "alice")).resolves.toMatchObject({ query: "alice" })
    } finally {
      await controller[Symbol.asyncDispose]()
    }

    const verified = await openDatabase(databasePath)
    expect(verified.get("SELECT query, use_count FROM xr_reader_search_history WHERE scope_id = 'folder'"))
      .toEqual({ query: "alice", use_count: 1 })
    verified.close()
  })

  it("[neoview.folder.emm-headless-disabled] keeps ordinary browsing available without opening Reader SQLite", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-reader-folder-emm-disabled-"))
    roots.push(root)
    await writeFile(join(root, "book.cbz"), Uint8Array.of(1))
    const controller = await createReaderFileTreeController({
      configPath: join(root, "missing.toml"),
      legacyThumbnailDatabasePath: false,
      searchHistoryStore: false,
    })
    try {
      const opened = await controller.open({ path: root })
      expect(opened.metadataCapabilities).toEqual(expect.arrayContaining(["date", "size"]))
      expect(opened.metadataCapabilities).not.toContain("tags")
      expect(() => controller.search("", { maximumDepth: 0, includeTags: ["artist:alice"] })).toThrow("unavailable")
      await expect(controller.suggestEmmTags()).rejects.toThrow("unavailable")
    } finally {
      await controller[Symbol.asyncDispose]()
    }
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
  exec(sql: string): void
  close(): void
}

async function openDatabase(path: string): Promise<TestDatabase> {
  if (process.versions.bun) {
    const moduleName = "bun:sqlite"
    const sqlite = await import(moduleName) as unknown as {
      Database: new (path: string, options: { readonly: boolean; strict: boolean }) => {
        query(sql: string): { get(): Record<string, unknown> | null }
        exec(sql: string): void
        close(): void
      }
    }
    const database = new sqlite.Database(path, { readonly: false, strict: true })
    return { get: (sql) => database.query(sql).get() ?? undefined, exec: (sql) => database.exec(sql), close: () => database.close() }
  }
  const moduleName = "node:sqlite"
  const sqlite = await import(moduleName) as typeof import("node:sqlite")
  const database = new sqlite.DatabaseSync(path, { readOnly: false })
  return {
    get: (sql) => database.prepare(sql).get() as Record<string, unknown> | undefined,
    exec: (sql) => database.exec(sql),
    close: () => database.close(),
  }
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}
