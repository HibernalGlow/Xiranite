import { mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { inspectLegacyThumbnailDatabase } from "./LegacyThumbnailDatabaseInspector.js"
import { SqliteLegacyThumbnailDatabaseMaintenance } from "./SqliteLegacyThumbnailDatabaseMaintenance.js"
import { WritableLegacyThumbnailStore } from "./WritableLegacyThumbnailStore.js"

describe("SqliteLegacyThumbnailDatabaseMaintenance", () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it("[neoview.thumbnail.database-backup] snapshots committed WAL content while another connection remains open", async () => {
    const root = await temporaryRoot(roots)
    const source = join(root, "thumbnails.db")
    const destination = join(root, "backups", "thumbnails.backup.db")
    const writer = await openFixtureDatabase(source)
    writer.exec(CURRENT_SCHEMA_SQL)
    writer.exec("INSERT INTO thumbs (key, category, value) VALUES ('D:/live.jpg', 'file', X'52494646');")

    try {
      const result = await new SqliteLegacyThumbnailDatabaseMaintenance().backup(source, destination)
      expect(result).toMatchObject({ destinationPath: destination, compatibility: "current", metadataVersion: "2.4", quickCheck: "ok" })
      expect(result.bytes).toBeGreaterThan(0)
      const backup = await openFixtureDatabase(destination, false)
      expect(backup.get("SELECT key FROM thumbs")).toEqual({ key: "D:/live.jpg" })
      backup.close()
      expect((await inspectLegacyThumbnailDatabase(source)).journalMode).toBe("wal")
    } finally {
      writer.close()
    }
  })

  it("[neoview.thumbnail.database-optimize] requires a verified backup and preserves schema metadata and journal mode", async () => {
    const root = await temporaryRoot(roots)
    const source = join(root, "thumbnails.db")
    const backup = join(root, "backup.db")
    const seed = await openFixtureDatabase(source)
    seed.exec(CURRENT_SCHEMA_SQL)
    seed.exec("PRAGMA user_version = 7; INSERT INTO thumbs (key, category, value) VALUES ('D:/page.jpg', 'file', X'52494646');")
    seed.close()

    const result = await new SqliteLegacyThumbnailDatabaseMaintenance().optimize(source, { backupPath: backup, vacuum: true })
    expect(result).toMatchObject({
      optimized: true,
      vacuumed: true,
      journalModeBefore: "wal",
      journalModeAfter: "wal",
      checkpoint: { busy: 0 },
      backup: { quickCheck: "ok", metadataVersion: "2.4", userVersion: 7 },
    })
    expect(await inspectLegacyThumbnailDatabase(source)).toMatchObject({
      compatibility: "current",
      metadataVersion: "2.4",
      userVersion: 7,
      journalMode: "wal",
    })
  })

  it("rejects replacement, incompatible sources and pre-existing backup destinations", async () => {
    const root = await temporaryRoot(roots)
    const source = join(root, "thumbnails.db")
    const destination = join(root, "backup.db")
    const seed = await openFixtureDatabase(source)
    seed.exec(CURRENT_SCHEMA_SQL)
    seed.close()
    const existing = await openFixtureDatabase(destination)
    existing.exec("CREATE TABLE occupied (id INTEGER)")
    existing.close()
    const maintenance = new SqliteLegacyThumbnailDatabaseMaintenance()
    await expect(maintenance.backup(source, source)).rejects.toThrow("differ")
    await expect(maintenance.backup(source, destination)).rejects.toThrow("already exists")

    const incompatible = join(root, "incompatible.db")
    const unrelated = await openFixtureDatabase(incompatible)
    unrelated.exec("CREATE TABLE other (id INTEGER)")
    unrelated.close()
    await expect(maintenance.backup(incompatible, join(root, "unused.db"))).rejects.toThrow("incompatible")
  })

  it("[neoview.thumbnail.database-maintenance-lock] refuses optimize while an Xiranite writer is active", async () => {
    const root = await temporaryRoot(roots)
    const source = join(root, "thumbnails.db")
    const backup = join(root, "backup.db")
    const seed = await openFixtureDatabase(source)
    seed.exec(CURRENT_SCHEMA_SQL)
    seed.close()
    const writer = await WritableLegacyThumbnailStore.open(source)
    try {
      await expect(new SqliteLegacyThumbnailDatabaseMaintenance().optimize(source, { backupPath: backup, vacuum: false }))
        .rejects.toThrow("already in use")
      await expect(stat(backup)).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await writer.close()
    }

    await expect(new SqliteLegacyThumbnailDatabaseMaintenance().optimize(source, { backupPath: backup, vacuum: false }))
      .resolves.toMatchObject({ optimized: true, backup: { quickCheck: "ok" } })
  })

  it("[neoview.thumbnail.database-maintenance-lock-release] releases the lock when backup creation fails", async () => {
    const root = await temporaryRoot(roots)
    const source = join(root, "thumbnails.db")
    const backup = join(root, "occupied.db")
    const seed = await openFixtureDatabase(source)
    seed.exec(CURRENT_SCHEMA_SQL)
    seed.close()
    const occupied = await openFixtureDatabase(backup)
    occupied.exec("CREATE TABLE occupied (id INTEGER)")
    occupied.close()

    await expect(new SqliteLegacyThumbnailDatabaseMaintenance().optimize(source, { backupPath: backup, vacuum: false }))
      .rejects.toThrow("already exists")
    const writer = await WritableLegacyThumbnailStore.open(source)
    await writer.close()
  })

  it("[neoview.thumbnail.database-recovery] restores a verified backup and quarantines corrupt DB/WAL/SHM bytes", async () => {
    const root = await temporaryRoot(roots)
    const source = join(root, "thumbnails.db")
    const backup = join(root, "verified-backup.db")
    const quarantine = join(root, "thumbnails.corrupt.db")
    const corruptBytes = new TextEncoder().encode("not a sqlite database")
    const walBytes = Uint8Array.of(1, 2, 3, 4)
    const shmBytes = Uint8Array.of(5, 6, 7, 8)
    await writeFile(source, corruptBytes)
    const verified = await openFixtureDatabase(backup)
    verified.exec(CURRENT_SCHEMA_SQL)
    verified.exec("PRAGMA user_version = 9; INSERT INTO thumbs (key, category, value) VALUES ('D:/restored.jpg', 'file', X'52494646');")
    verified.close()
    const backupBytesBefore = await readFile(backup)
    let injectedSidecars = false
    const maintenance = new SqliteLegacyThumbnailDatabaseMaintenance({
      renamePath: async (from, to) => {
        if (!injectedSidecars) {
          injectedSidecars = true
          await writeFile(`${source}-wal`, walBytes)
          await writeFile(`${source}-shm`, shmBytes)
        }
        await rename(from, to)
      },
    })

    const result = await maintenance.recover(source, { backupPath: backup, quarantinePath: quarantine })
    expect(result).toMatchObject({
      recovered: true,
      sourcePath: source,
      backupPath: backup,
      quarantinedDatabasePath: quarantine,
      quarantinedWalPath: `${quarantine}-wal`,
      quarantinedShmPath: `${quarantine}-shm`,
      originalCompatibility: "incompatible",
      metadataVersion: "2.4",
      userVersion: 9,
      quickCheck: "ok",
    })
    expect(await readFile(quarantine)).toEqual(Buffer.from(corruptBytes))
    expect(await readFile(`${quarantine}-wal`)).toEqual(Buffer.from(walBytes))
    expect(await readFile(`${quarantine}-shm`)).toEqual(Buffer.from(shmBytes))
    const restored = await openFixtureDatabase(source, false)
    expect(restored.get("SELECT key FROM thumbs")).toEqual({ key: "D:/restored.jpg" })
    restored.close()
    expect(await readFile(backup)).toEqual(backupBytesBefore)
    const unchangedBackup = await openFixtureDatabase(backup, false)
    expect(unchangedBackup.get("SELECT key FROM thumbs")).toEqual({ key: "D:/restored.jpg" })
    unchangedBackup.close()
  })

  it("[neoview.thumbnail.database-recovery-rollback] restores the original database when the final swap fails", async () => {
    const root = await temporaryRoot(roots)
    const source = join(root, "thumbnails.db")
    const backup = join(root, "verified-backup.db")
    const quarantine = join(root, "thumbnails.rollback.db")
    const original = await openFixtureDatabase(source)
    original.exec(CURRENT_SCHEMA_SQL)
    original.exec("INSERT INTO thumbs (key, category, value) VALUES ('D:/original.jpg', 'file', X'52494646');")
    original.close()
    const verified = await openFixtureDatabase(backup)
    verified.exec(CURRENT_SCHEMA_SQL)
    verified.exec("INSERT INTO thumbs (key, category, value) VALUES ('D:/replacement.jpg', 'file', X'52494646');")
    verified.close()
    const maintenance = new SqliteLegacyThumbnailDatabaseMaintenance({
      renamePath: async (from, to) => {
        if (from.includes(".xr-recovery-") && to === source) throw new Error("simulated final swap failure")
        await rename(from, to)
      },
    })

    await expect(maintenance.recover(source, { backupPath: backup, quarantinePath: quarantine }))
      .rejects.toThrow("simulated final swap failure")
    const rolledBack = await openFixtureDatabase(source, false)
    expect(rolledBack.get("SELECT key FROM thumbs")).toEqual({ key: "D:/original.jpg" })
    rolledBack.close()
    await expect(stat(quarantine)).rejects.toMatchObject({ code: "ENOENT" })
    expect((await readdir(root)).some((name) => name.includes(".xr-recovery-"))).toBe(false)
    const writer = await WritableLegacyThumbnailStore.open(source)
    await writer.close()
  })

  it("[neoview.thumbnail.database-recovery-validation] rejects incompatible backups before moving the source", async () => {
    const root = await temporaryRoot(roots)
    const source = join(root, "thumbnails.db")
    const backup = join(root, "unrelated.db")
    const quarantine = join(root, "quarantine.db")
    const original = await openFixtureDatabase(source)
    original.exec(CURRENT_SCHEMA_SQL)
    original.close()
    const unrelated = await openFixtureDatabase(backup)
    unrelated.exec("CREATE TABLE unrelated (id INTEGER)")
    unrelated.close()

    await expect(new SqliteLegacyThumbnailDatabaseMaintenance().recover(source, { backupPath: backup, quarantinePath: quarantine }))
      .rejects.toThrow("cannot be backed up")
    expect((await inspectLegacyThumbnailDatabase(source)).compatibility).toBe("current")
    await expect(stat(quarantine)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("[neoview.thumbnail.database-recovery-lock] refuses recovery while an Xiranite writer owns the database", async () => {
    const root = await temporaryRoot(roots)
    const source = join(root, "thumbnails.db")
    const backup = join(root, "verified.db")
    const quarantine = join(root, "quarantine.db")
    const original = await openFixtureDatabase(source)
    original.exec(CURRENT_SCHEMA_SQL)
    original.close()
    const verified = await openFixtureDatabase(backup)
    verified.exec(CURRENT_SCHEMA_SQL)
    verified.close()
    const writer = await WritableLegacyThumbnailStore.open(source)
    try {
      await expect(new SqliteLegacyThumbnailDatabaseMaintenance().recover(source, { backupPath: backup, quarantinePath: quarantine }))
        .rejects.toThrow("already in use")
      await expect(stat(quarantine)).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await writer.close()
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
  get(sql: string): Record<string, unknown> | undefined
  close(): void
}

async function openFixtureDatabase(path: string, create = true): Promise<FixtureDatabase> {
  if (process.versions.bun) {
    const moduleName = "bun:sqlite"
    const sqlite = await import(moduleName) as unknown as {
      Database: new (path: string, options: { create: boolean; strict: boolean }) => {
        exec(sql: string): void
        query(sql: string): { get(): Record<string, unknown> | null }
        close(): void
      }
    }
    const database = new sqlite.Database(path, { create, strict: true })
    return {
      exec: (sql) => database.exec(sql),
      get: (sql) => database.query(sql).get() ?? undefined,
      close: () => database.close(),
    }
  }
  const moduleName = "node:sqlite"
  const sqlite = await import(moduleName) as typeof import("node:sqlite")
  const database = new sqlite.DatabaseSync(path, { open: true, readOnly: !create })
  return {
    exec: (sql) => database.exec(sql),
    get: (sql) => database.prepare(sql).get() as Record<string, unknown> | undefined,
    close: () => database.close(),
  }
}

async function temporaryRoot(roots: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-thumbnail-maintenance-"))
  roots.push(root)
  return root
}
