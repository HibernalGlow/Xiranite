import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { createReaderHttpController } from "../../platform.js"
import { inspectLegacyThumbnailDatabase } from "../thumbnails/LegacyThumbnailDatabaseInspector.js"
import type { ReaderSessionDto } from "./ReaderHttpController.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Reader book settings migration integration", () => {
  it("[neoview.book-settings.legacy-http] imports path-keyed localStorage without exposing paths and restores it on open", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-book-settings-migration-"))
    roots.push(root)
    const databasePath = join(root, "thumbnails.db")
    const configPath = join(root, "xiranite.config.toml")
    const bookPath = join(root, "book")
    await writeFile(configPath, "[nodes.neoview]\nschema_version = 1\n", "utf8")
    await mkdir(bookPath)
    await writeFile(join(bookPath, "1.jpg"), Uint8Array.of(1))
    const { DatabaseSync } = await import("node:sqlite")
    const seed = new DatabaseSync(databasePath)
    seed.exec(CURRENT_SCHEMA_SQL)
    seed.close()

    const controller = await createReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      configPath,
      legacyThumbnailDatabasePath: databasePath,
      useDefaultLegacyProgressStore: true,
    })
    const content = JSON.stringify({
      [bookPath]: {
        favorite: true,
        rating: 5,
        readingDirection: "right-to-left",
        doublePageView: true,
        horizontalBook: false,
      },
    })
    try {
      expect((await controller.handle(jsonRequest("/reader/book-settings/migration/inspect", { content }, false)))?.status).toBe(401)
      const inspected = (await controller.handle(jsonRequest("/reader/book-settings/migration/inspect", { content })))!
      const inspectedText = await inspected.text()
      expect(JSON.parse(inspectedText)).toEqual({
        report: {
          totalEntries: 1,
          validEntries: 1,
          invalidEntries: 0,
          invalidFields: 0,
          unknownFields: 0,
        },
      })
      expect(inspectedText).not.toContain(bookPath)

      expect(
        (
          await controller.handle(
            jsonRequest("/reader/book-settings/migration/import", {
              content,
              strategy: "merge",
              confirmed: false,
            }),
          )
        )?.status,
      ).toBe(400)
      const imported = (await controller.handle(
        jsonRequest("/reader/book-settings/migration/import", {
          content,
          strategy: "merge",
          confirmed: true,
        }),
      ))!
      const importedText = await imported.text()
      expect(JSON.parse(importedText)).toMatchObject({
        result: {
          applied: { inserted: 1, updated: 0, unchanged: 0 },
          unresolvedSources: 0,
          duplicateIdentities: 0,
        },
      })
      expect(importedText).not.toContain(bookPath)

      const opened = (await controller.handle(jsonRequest("/reader/sessions", { path: bookPath })))!
      const session = (await opened.json()) as ReaderSessionDto
      expect(session.frame).toMatchObject({
        direction: "right-to-left",
        layout: { pageMode: "double", treatWidePageAsSingle: false },
      })
      const settings = await (await controller.handle(authorized(`/reader/s/${session.sessionId}/book-settings`)))!.json()
      expect(settings).toMatchObject({
        settings: {
          overrides: {
            favorite: true,
            rating: 5,
            direction: "right-to-left",
            pageMode: "double",
            horizontalBook: false,
          },
        },
      })
    } finally {
      await controller[Symbol.asyncDispose]()
    }
    await expect(inspectLegacyThumbnailDatabase(databasePath)).resolves.toMatchObject({
      compatibility: "current",
      metadataVersion: "2.4",
      userVersion: 7,
      journalMode: "wal",
    })
  })
})

function jsonRequest(path: string, body: unknown, authorizedRequest = true): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  }
  if (authorizedRequest) headers["x-xiranite-token"] = "reader-token"
  return new Request(new URL(path, "http://127.0.0.1:41000"), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
}

function authorized(path: string): Request {
  return new Request(new URL(path, "http://127.0.0.1:41000"), {
    headers: { "x-xiranite-token": "reader-token" },
  })
}

const CURRENT_SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA user_version = 7;
  CREATE TABLE thumbs (key TEXT PRIMARY KEY,size INTEGER,date TEXT,ghash INTEGER,category TEXT DEFAULT 'file',value BLOB,emm_json TEXT,rating_data TEXT,ai_translation TEXT,manual_tags TEXT);
  CREATE INDEX idx_thumbs_key ON thumbs(key);
  CREATE INDEX idx_thumbs_category ON thumbs(category);
  CREATE INDEX idx_thumbs_date ON thumbs(date);
  CREATE TABLE failed_thumbnails (key TEXT PRIMARY KEY,reason TEXT NOT NULL,retry_count INTEGER DEFAULT 0,last_attempt TEXT,error_message TEXT);
  CREATE INDEX idx_failed_reason ON failed_thumbnails(reason);
  CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT);
  INSERT INTO metadata VALUES ('version','2.4');
`
