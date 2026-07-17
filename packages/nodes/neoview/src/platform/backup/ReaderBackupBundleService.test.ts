import { createHash } from "node:crypto"
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderThumbnailDatabaseMaintenance } from "../../ports/ReaderThumbnailDatabaseMaintenance.js"
import { ReaderSettingsPortableService } from "../../application/migration/ReaderSettingsPortableService.js"
import { ReaderBackupBundleService, ReaderBackupManifestSchema } from "./ReaderBackupBundleService.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("ReaderBackupBundleService", () => {
  it("[neoview.settings.backup-bundle] atomically publishes settings, verified database snapshot and hashed manifest", async () => {
    const root = await temporaryRoot()
    const destination = join(root, "backup")
    const sourceDatabase = join(root, "source.db")
    const databaseBytes = Buffer.from("sqlite-snapshot")
    const maintenance = fakeMaintenance(async (_source, target) => {
      await writeFile(target, databaseBytes, { flag: "wx" })
      return backupReceipt(sourceDatabase, target, databaseBytes.byteLength)
    })
    const settings = new ReaderSettingsPortableService({ read: async () => ({ schema_version: 1, token: "hidden", future: true }) })
    const service = new ReaderBackupBundleService(settings, maintenance, sourceDatabase, () => 123)

    const result = await service.create(destination)
    expect(result.destinationPath).toBe(destination)
    expect((await readdir(destination)).sort()).toEqual(["manifest.json", "settings.json", "thumbnails.db"])
    const manifest = ReaderBackupManifestSchema.parse(JSON.parse(await readFile(join(destination, "manifest.json"), "utf8")))
    expect(manifest).toMatchObject({
      format: "Xiranite/NeoViewBackup",
      version: 1,
      createdAt: 123,
      settings: { omittedSensitivePaths: ["token"] },
      database: { quickCheck: "ok", compatibility: "current" },
    })
    expect(manifest.database.sha256).toBe(createHash("sha256").update(databaseBytes).digest("hex"))
    expect(await readFile(join(destination, "settings.json"), "utf8")).not.toContain("hidden")
    await expect(service.create(destination)).rejects.toThrow("already exists")
  })

  it("[neoview.settings.backup-rollback] removes staging when database backup or cancellation fails", async () => {
    const root = await temporaryRoot()
    const destination = join(root, "backup")
    const sourceDatabase = join(root, "source.db")
    const maintenance = fakeMaintenance(async () => { throw new Error("snapshot failed") })
    const settings = new ReaderSettingsPortableService({ read: async () => ({ schema_version: 1 }) })
    await expect(new ReaderBackupBundleService(settings, maintenance, sourceDatabase).create(destination)).rejects.toThrow("snapshot failed")
    await expect(stat(destination)).rejects.toMatchObject({ code: "ENOENT" })
    expect((await readdir(root)).filter((name) => name.includes("xr-staging"))).toEqual([])

    const abort = new AbortController()
    const cancelling = fakeMaintenance(async (_source, target) => {
      await writeFile(target, "partial", { flag: "wx" })
      abort.abort(new DOMException("cancelled", "AbortError"))
      abort.signal.throwIfAborted()
      return backupReceipt(sourceDatabase, target, 7)
    })
    await expect(new ReaderBackupBundleService(settings, cancelling, sourceDatabase).create(destination, abort.signal)).rejects.toMatchObject({ name: "AbortError" })
    expect((await readdir(root)).filter((name) => name.includes("xr-staging"))).toEqual([])
  })
})

function fakeMaintenance(backup: ReaderThumbnailDatabaseMaintenance["backup"]): ReaderThumbnailDatabaseMaintenance {
  return {
    backup: vi.fn(backup),
    optimize: vi.fn(),
    recover: vi.fn(),
  }
}

function backupReceipt(sourcePath: string, destinationPath: string, bytes: number) {
  return {
    sourcePath,
    destinationPath,
    bytes,
    compatibility: "current" as const,
    metadataVersion: "2.4",
    userVersion: 7,
    journalMode: "wal",
    quickCheck: "ok" as const,
  }
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-backup-"))
  roots.push(root)
  return root
}
