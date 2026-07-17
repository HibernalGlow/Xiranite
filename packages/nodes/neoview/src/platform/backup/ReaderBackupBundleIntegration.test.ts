import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { createReaderBackupBundleService } from "../../platform.js"
import { readNeoviewConfig } from "../config/NeoviewConfigStore.js"
import { inspectLegacyThumbnailDatabase } from "../thumbnails/LegacyThumbnailDatabaseInspector.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Reader backup bundle integration", () => {
  it("[neoview.settings.backup-integration] snapshots the real legacy database and current TOML without changing either source", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-backup-integration-"))
    roots.push(root)
    const configPath = join(root, "xiranite.config.toml")
    const databasePath = join(root, "thumbnails.db")
    const destination = join(root, "bundle")
    await writeFile(configPath, "[nodes.neoview]\nschema_version = 1\nsecret = \"hidden\"\n", "utf8")
    const { DatabaseSync } = await import("node:sqlite")
    const database = new DatabaseSync(databasePath)
    database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE thumbs (key TEXT PRIMARY KEY,size INTEGER,date TEXT,ghash INTEGER,category TEXT DEFAULT 'file',value BLOB,emm_json TEXT,rating_data TEXT,ai_translation TEXT,manual_tags TEXT);
      CREATE INDEX idx_thumbs_key ON thumbs(key);
      CREATE INDEX idx_thumbs_category ON thumbs(category);
      CREATE INDEX idx_thumbs_date ON thumbs(date);
      CREATE TABLE failed_thumbnails (key TEXT PRIMARY KEY,reason TEXT NOT NULL,retry_count INTEGER DEFAULT 0,last_attempt TEXT,error_message TEXT);
      CREATE INDEX idx_failed_reason ON failed_thumbnails(reason);
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO metadata VALUES ('version', '2.4');
      INSERT INTO thumbs (key, category, value) VALUES ('D:/page.jpg', 'file', X'52494646');
    `)
    const configBefore = await readFile(configPath, "utf8")
    try {
      const result = await (await createReaderBackupBundleService({ configPath, thumbnailDatabasePath: databasePath })).create(destination)
      expect(result.manifest).toMatchObject({
        settings: { omittedSensitivePaths: ["secret"] },
        database: { compatibility: "current", metadataVersion: "2.4", quickCheck: "ok" },
      })
      expect(await inspectLegacyThumbnailDatabase(join(destination, "thumbnails.db"))).toMatchObject({
        compatibility: "current",
        metadataVersion: "2.4",
      })
      expect(await readFile(join(destination, "settings.json"), "utf8")).not.toContain("hidden")
      expect(await readFile(configPath, "utf8")).toBe(configBefore)
      expect((await inspectLegacyThumbnailDatabase(databasePath)).journalMode).toBe("wal")
    } finally {
      database.close()
    }
  })

  it("[neoview.settings.backup-restore-integration] restores the verified snapshot and quarantines the replaced database", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-backup-restore-integration-"))
    roots.push(root)
    const configPath = join(root, "xiranite.config.toml")
    const databasePath = join(root, "thumbnails.db")
    const destination = join(root, "bundle")
    const quarantinePath = join(root, "thumbnails.pre-restore.db")
    await writeFile(configPath, "[nodes.neoview]\nschema_version = 1\nview_mode = \"spread\"\nsecret = \"must-not-return\"\n", "utf8")
    const { DatabaseSync } = await import("node:sqlite")
    const writer = new DatabaseSync(databasePath)
    writer.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE thumbs (key TEXT PRIMARY KEY,size INTEGER,date TEXT,ghash INTEGER,category TEXT DEFAULT 'file',value BLOB,emm_json TEXT,rating_data TEXT,ai_translation TEXT,manual_tags TEXT);
      CREATE INDEX idx_thumbs_key ON thumbs(key);
      CREATE INDEX idx_thumbs_category ON thumbs(category);
      CREATE INDEX idx_thumbs_date ON thumbs(date);
      CREATE TABLE failed_thumbnails (key TEXT PRIMARY KEY,reason TEXT NOT NULL,retry_count INTEGER DEFAULT 0,last_attempt TEXT,error_message TEXT);
      CREATE INDEX idx_failed_reason ON failed_thumbnails(reason);
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO metadata VALUES ('version', '2.4');
      INSERT INTO thumbs (key, category, value) VALUES ('D:/snapshot.jpg', 'file', X'52494646');
    `)
    const service = await createReaderBackupBundleService({ configPath, thumbnailDatabasePath: databasePath })
    await service.create(destination)
    writer.close()

    await writeFile(configPath, "[nodes.neoview]\nschema_version = 99\nview_mode = \"scroll\"\nsecret = \"new-secret\"\n", "utf8")
    const changed = new DatabaseSync(databasePath)
    changed.exec("DELETE FROM thumbs; INSERT INTO thumbs (key, category, value) VALUES ('D:/changed.jpg', 'file', X'52494646');")
    changed.close()

    const restored = await service.restore(destination, { quarantinePath })
    expect(restored).toMatchObject({
      settingsChanged: true,
      database: { recovered: true, quarantinedDatabasePath: quarantinePath, quickCheck: "ok" },
    })
    expect(await readNeoviewConfig({ configPath })).toEqual({ schema_version: 1, view_mode: "spread" })
    expect(await readFile(configPath, "utf8")).not.toContain("secret")

    const current = new DatabaseSync(databasePath, { readOnly: true })
    expect(current.prepare("SELECT key FROM thumbs").get()).toEqual({ key: "D:/snapshot.jpg" })
    expect(current.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" })
    current.close()
    const quarantined = new DatabaseSync(quarantinePath, { readOnly: true })
    expect(quarantined.prepare("SELECT key FROM thumbs").get()).toEqual({ key: "D:/changed.jpg" })
    quarantined.close()
    expect(await inspectLegacyThumbnailDatabase(databasePath)).toMatchObject({ compatibility: "current", metadataVersion: "2.4" })
  })
})
