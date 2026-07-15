import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { WritableLegacyThumbnailStore } from "./WritableLegacyThumbnailStore.js"

describe("WritableLegacyThumbnailStore", () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it("[neoview.thumbnail.persist.batch] batches WebP upserts and clears a previous failure atomically", async () => {
    const path = await createFixture(roots)
    const store = await WritableLegacyThumbnailStore.open(path, { flushIntervalMs: 60_000, maxBatchSize: 2 })
    const webp = fixtureWebp(7)
    const failure = store.recordFailure({
      key: "D:/book/page-1.jpg",
      reason: "decode-error",
      lastAttempt: "2026-07-15 10:00:00",
      errorMessage: "bad source",
    })
    const first = store.put({ key: "D:/book/page-1.jpg", category: "file", bytes: webp, sourceSize: 123, generationHash: 44 })
    await Promise.all([failure, first])
    expect(await store.getFailure("D:/book/page-1.jpg")).toBeUndefined()
    expect(await store.get("D:/book/page-1.jpg", "file")).toMatchObject({
      sourceSize: 123,
      generationHash: 44,
      contentType: "image/webp",
      compressed: false,
    })
    const pending = store.put({ key: "D:/book/page-2.jpg", category: "file", bytes: fixtureWebp(8), sourceSize: 456 })
    const batch = await store.getMany(["D:/book/page-1.jpg", "D:/book/page-2.jpg", "missing", "D:/book/page-1.jpg"], "file")
    expect([...batch.keys()].sort()).toEqual(["D:/book/page-1.jpg", "D:/book/page-2.jpg"])
    expect(batch.get("D:/book/page-2.jpg")).toMatchObject({ sourceSize: 456, contentType: "image/webp" })
    await store.flush()
    await pending
    await store.close()
  })

  it("[neoview.thumbnail.failure.retry] increments bounded failure metadata and flushes pending work on close", async () => {
    const path = await createFixture(roots)
    const store = await WritableLegacyThumbnailStore.open(path, { flushIntervalMs: 60_000 })
    const firstFailure = store.recordFailure({ key: "D:/bad.cbz", reason: "archive-error", lastAttempt: "2026-07-15 10:00:00", errorMessage: "first" })
    await store.flush()
    await firstFailure
    const secondFailure = store.recordFailure({ key: "D:/bad.cbz", reason: "password-required", lastAttempt: "2026-07-15 10:01:00", errorMessage: "failed D:\\private\\book.cbz" })
    await store.flush()
    await secondFailure
    expect(await store.getFailure("D:/bad.cbz")).toEqual({
      key: "D:/bad.cbz",
      reason: "password-required",
      retryCount: 2,
      lastAttempt: "2026-07-15 10:01:00",
      errorMessage: "failed <path>",
    })
    const pending = store.put({ key: "D:/pending.jpg", category: "file", bytes: fixtureWebp(9) })
    await store.close()
    await expect(pending).resolves.toBeUndefined()

    const reopened = await WritableLegacyThumbnailStore.open(path, { flushIntervalMs: 0 })
    expect(await reopened.get("D:/pending.jpg", "file")).toMatchObject({ contentType: "image/webp" })
    await reopened.close()
  })

  it("rejects non-WebP writes before they enter the database queue", async () => {
    const path = await createFixture(roots)
    const store = await WritableLegacyThumbnailStore.open(path)
    expect(() => store.put({ key: "bad", category: "file", bytes: Uint8Array.of(1, 2, 3) })).toThrow("WebP")
    await store.close()
  })
})

async function createFixture(roots: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-thumbnail-writer-"))
  roots.push(root)
  const path = join(root, "thumbnails.db")
  const database = await openFixtureDatabase(path)
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE thumbs (key TEXT PRIMARY KEY,size INTEGER,date TEXT,ghash INTEGER,category TEXT DEFAULT 'file',value BLOB,emm_json TEXT,rating_data TEXT,ai_translation TEXT,manual_tags TEXT);
    CREATE INDEX idx_thumbs_key ON thumbs(key);
    CREATE INDEX idx_thumbs_category ON thumbs(category);
    CREATE INDEX idx_thumbs_date ON thumbs(date);
    CREATE TABLE failed_thumbnails (key TEXT PRIMARY KEY,reason TEXT NOT NULL,retry_count INTEGER DEFAULT 0,last_attempt TEXT,error_message TEXT);
    CREATE INDEX idx_failed_reason ON failed_thumbnails(reason);
    CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT);
    INSERT INTO metadata VALUES ('version','2.4');
  `)
  database.close()
  return path
}

function fixtureWebp(fill: number): Uint8Array {
  return Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, fill])
}

interface FixtureDatabase {
  exec(sql: string): void
  close(): void
}

async function openFixtureDatabase(path: string): Promise<FixtureDatabase> {
  if (process.versions.bun) {
    const moduleName = "bun:sqlite"
    const sqlite = await import(moduleName) as unknown as {
      Database: new (path: string, options: { create: boolean; strict: boolean }) => FixtureDatabase
    }
    return new sqlite.Database(path, { create: true, strict: true })
  }
  const moduleName = "node:sqlite"
  const sqlite = await import(moduleName) as typeof import("node:sqlite")
  return new sqlite.DatabaseSync(path) as unknown as FixtureDatabase
}
