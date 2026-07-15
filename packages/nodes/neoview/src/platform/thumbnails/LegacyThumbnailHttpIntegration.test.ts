import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { SqliteBinding } from "../sqlite/openReadonlySqlite.js"
import { createReaderHttpController } from "../../platform.js"

describe("legacy thumbnail HTTP composition", () => {
  it("[neoview.thumbnail.http-e2e] resolves a directory page through the original DB without exposing its key", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-thumbnail-http-"))
    const bookPath = join(root, "book")
    const pagePath = join(bookPath, "001.png")
    const databasePath = join(root, "thumbnails.db")
    await mkdir(bookPath)
    await writeFile(pagePath, pngHeader(32, 48))
    const writer = await openFixtureDatabase(databasePath)
    writer.exec(CURRENT_SCHEMA_SQL)
    const thumbnail = Uint8Array.from(Buffer.from("524946460400000057454250", "hex"))
    writer.run("INSERT INTO thumbs (key,category,value) VALUES (?1,'file',?2)", pagePath, thumbnail)
    writer.close()

    const controller = await createReaderHttpController({
      baseUrl: "http://127.0.0.1:41337",
      token: "thumbnail-token",
      legacyThumbnailDatabasePath: databasePath,
      configPath: join(root, "missing-config.toml"),
    })
    try {
      const opened = (await controller.handle(new Request("http://127.0.0.1:41337/reader/sessions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-xiranite-token": "thumbnail-token" },
        body: JSON.stringify({ path: bookPath }),
      })))!
      expect(opened.status).toBe(201)
      const session = await opened.json() as { visiblePages: Array<{ thumbnailUrl?: string }> }
      const thumbnailUrl = session.visiblePages[0]?.thumbnailUrl
      expect(thumbnailUrl).toBeTruthy()
      expect(thumbnailUrl).not.toContain(encodeURIComponent(pagePath))
      expect(thumbnailUrl).not.toContain("001.png")
      const response = (await controller.handle(new Request(thumbnailUrl!)))!
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe("image/webp")
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(thumbnail)
    } finally {
      await controller[Symbol.asyncDispose]()
      await rm(root, { recursive: true, force: true })
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

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  for (let offset = 0; offset < 4; offset += 1) {
    bytes[16 + offset] = (width >>> ((3 - offset) * 8)) & 0xff
    bytes[20 + offset] = (height >>> ((3 - offset) * 8)) & 0xff
  }
  return bytes
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
    return { exec: (sql) => database.exec(sql), run: (sql, ...bindings) => { database.query(sql).run(...bindings) }, close: () => database.close() }
  }
  const moduleName = "node:sqlite"
  const sqlite = await import(moduleName) as typeof import("node:sqlite")
  const database = new sqlite.DatabaseSync(path)
  return { exec: (sql) => database.exec(sql), run: (sql, ...bindings) => { database.prepare(sql).run(...bindings) }, close: () => database.close() }
}
