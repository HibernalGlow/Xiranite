import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { SqliteBinding } from "../sqlite/openReadonlySqlite.js"
import { ReadonlyLegacyThumbnailStore } from "./ReadonlyLegacyThumbnailStore.js"

describe("ReadonlyLegacyThumbnailStore", () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it("[neoview.thumbnail.read] reads raw/compressed records and bounded batches from the live WAL database", async () => {
    const root = await temporaryRoot(roots)
    const path = join(root, "thumbnails.db")
    const writer = await openFixtureDatabase(path)
    writer.exec(CURRENT_SCHEMA_SQL)
    const rawWebp = Uint8Array.from(Buffer.from("524946460400000057454250", "hex"))
    const png = Uint8Array.from(Buffer.from("89504e470d0a1a0a0102030405060708", "hex"))
    const compressed = Uint8Array.from(Buffer.from("10000000f00189504e470d0a1a0a0102030405060708", "hex"))
    const storedPng = new Uint8Array(4 + compressed.byteLength)
    storedPng.set([0x4c, 0x5a, 0x34, 0x00])
    storedPng.set(compressed, 4)
    writer.run("INSERT INTO thumbs (key,size,date,ghash,category,value) VALUES (?1,?2,?3,?4,?5,?6)", "D:/one.webp", 100, "2026-01-01 00:00:00", 11, "file", rawWebp)
    writer.run("INSERT INTO thumbs (key,size,date,ghash,category,value) VALUES (?1,?2,?3,?4,?5,?6)", "D:/two.png", 200, "2026-01-02 00:00:00", 22, "file", storedPng)
    writer.run("INSERT INTO thumbs (key,size,date,ghash,category,value) VALUES (?1,?2,?3,?4,?5,?6)", "D:/folder", 0, "2026-01-03 00:00:00", 0, "folder", rawWebp)

    const store = await ReadonlyLegacyThumbnailStore.open(path, { decodeConcurrency: 2 })
    try {
      expect(store.report.compatibility).toBe("current")
      expect(await store.get("D:/one.webp", "file")).toMatchObject({
        key: "D:/one.webp",
        category: "file",
        sourceSize: 100,
        generationHash: 11,
        compressed: false,
        contentType: "image/webp",
      })
      const compressedRecord = await store.get("D:/two.png", "file")
      expect(compressedRecord).toMatchObject({ compressed: true, contentType: "image/png" })
      expect(compressedRecord?.bytes).toEqual(png)
      expect(await store.get("D:/folder", "file")).toBeUndefined()

      const batch = await store.getMany(["D:/two.png", "missing", "D:/one.webp", "D:/one.webp"], "file")
      expect([...batch.keys()].sort()).toEqual(["D:/one.webp", "D:/two.png"])
      expect(batch.get("D:/two.png")?.bytes).toEqual(png)
    } finally {
      store.close()
      writer.close()
    }
    await expect(store.get("D:/one.webp", "file")).rejects.toThrow("closed")
  })

  it("enforces blob, key and batch limits before returning data", async () => {
    const root = await temporaryRoot(roots)
    const path = join(root, "limits.db")
    const writer = await openFixtureDatabase(path)
    writer.exec(CURRENT_SCHEMA_SQL)
    writer.run("INSERT INTO thumbs (key,category,value) VALUES (?1,'file',?2)", "large", new Uint8Array(32))
    writer.close()
    const store = await ReadonlyLegacyThumbnailStore.open(path, { maxThumbnailBytes: 16 })
    try {
      await expect(store.get("large", "file")).rejects.toThrow("exceeds")
      await expect(store.get("", "file")).rejects.toThrow("Thumbnail key")
      await expect(store.getMany(Array.from({ length: 513 }, (_, index) => String(index)), "file")).rejects.toThrow("512")
    } finally {
      store.close()
    }
  })
})

const CURRENT_SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE thumbs (key TEXT PRIMARY KEY,size INTEGER,date TEXT,ghash INTEGER,category TEXT DEFAULT 'file',value BLOB,emm_json TEXT,rating_data TEXT,ai_translation TEXT,manual_tags TEXT);
  CREATE INDEX idx_thumbs_key ON thumbs(key);
  CREATE INDEX idx_thumbs_category ON thumbs(category);
  CREATE INDEX idx_thumbs_date ON thumbs(date);
  CREATE TABLE failed_thumbnails (key TEXT PRIMARY KEY,reason TEXT NOT NULL,retry_count INTEGER DEFAULT 0,last_attempt TEXT,error_message TEXT);
  CREATE INDEX idx_failed_reason ON failed_thumbnails(reason);
  CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT);
  INSERT INTO metadata VALUES ('version','2.4');
`

interface FixtureDatabase {
  exec(sql: string): void
  run(sql: string, ...bindings: SqliteBinding[]): void
  close(): void
}

async function openFixtureDatabase(path: string): Promise<FixtureDatabase> {
  if (process.versions.bun) {
    const moduleName = "bun:sqlite"
    const sqlite = await import(moduleName) as unknown as {
      Database: new (path: string, options: { create: boolean; strict: boolean }) => {
        exec(sql: string): void
        query(sql: string): { run(...bindings: SqliteBinding[]): unknown }
        close(): void
      }
    }
    const database = new sqlite.Database(path, { create: true, strict: true })
    return {
      exec: (sql) => database.exec(sql),
      run: (sql, ...bindings) => { database.query(sql).run(...bindings) },
      close: () => database.close(),
    }
  }
  const moduleName = "node:sqlite"
  const sqlite = await import(moduleName) as typeof import("node:sqlite")
  const database = new sqlite.DatabaseSync(path)
  return {
    exec: (sql) => database.exec(sql),
    run: (sql, ...bindings) => { database.prepare(sql).run(...bindings) },
    close: () => database.close(),
  }
}

async function temporaryRoot(roots: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-thumbnail-store-"))
  roots.push(root)
  return root
}
