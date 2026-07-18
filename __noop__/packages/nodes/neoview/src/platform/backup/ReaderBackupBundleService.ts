import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, resolve } from "node:path"
import { z } from "zod"

import type { ReaderSettingsPortableService } from "../../application/migration/ReaderSettingsPortableService.js"
import type { ReaderThumbnailDatabaseMaintenance } from "../../ports/ReaderThumbnailDatabaseMaintenance.js"

export const READER_BACKUP_FORMAT = "Xiranite/NeoViewBackup" as const
export const READER_BACKUP_VERSION = 1 as const

const BackupFileSchema = z.object({
  name: z.string().min(1),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

export const ReaderBackupManifestSchema = z.object({
  format: z.literal(READER_BACKUP_FORMAT),
  version: z.literal(READER_BACKUP_VERSION),
  createdAt: z.number().int().nonnegative(),
  settings: BackupFileSchema.extend({
    name: z.literal("settings.json"),
    format: z.literal("Xiranite/NeoViewConfig"),
    version: z.literal(1),
    omittedSensitivePaths: z.array(z.string()),
  }).strict(),
  database: BackupFileSchema.extend({
    name: z.literal("thumbnails.db"),
    compatibility: z.string(),
    metadataVersion: z.string().optional(),
    userVersion: z.number().int().optional(),
    journalMode: z.string().optional(),
    quickCheck: z.literal("ok"),
  }).strict(),
}).strict()

export type ReaderBackupManifest = z.infer<typeof ReaderBackupManifestSchema>

export interface ReaderBackupBundleResult {
  destinationPath: string
  manifest: ReaderBackupManifest
}

export interface ReaderBackupInspection {
  bundlePath: string
  manifest: ReaderBackupManifest
  settings: ReturnType<ReaderSettingsPortableService["inspect"]>
  database: Awaited<ReturnType<ReaderThumbnailDatabaseMaintenance["verify"]>>
}

export interface ReaderBackupRestoreResult {
  manifest: ReaderBackupManifest
  settingsChanged: boolean
  database: Awaited<ReturnType<ReaderThumbnailDatabaseMaintenance["recover"]>>
}

export class ReaderBackupBundleService {
  constructor(
    private readonly settings: ReaderSettingsPortableService,
    private readonly database: ReaderThumbnailDatabaseMaintenance,
    private readonly databasePath: string,
    private readonly now: () => number = Date.now,
  ) {}

  async create(destinationPath: string, signal?: AbortSignal): Promise<ReaderBackupBundleResult> {
    signal?.throwIfAborted()
    if (!destinationPath.trim()) throw new Error("Reader backup destination must be a non-empty path.")
    const destination = resolve(destinationPath)
    const parent = dirname(destination)
    const staging = resolve(parent, `.${basename(destination)}.xr-staging-${randomUUID()}`)
    await assertMissing(destination)
    await mkdir(parent, { recursive: true })
    await mkdir(staging, { recursive: false })
    let published = false
    try {
      const settingsPayload = await this.settings.export()
      signal?.throwIfAborted()
      const settingsPath = resolve(staging, "settings.json")
      await writeFile(settingsPath, `${JSON.stringify(settingsPayload, null, 2)}\n`, { encoding: "utf8", flag: "wx" })

      const databasePath = resolve(staging, "thumbnails.db")
      const databaseBackup = await this.database.backup(this.databasePath, databasePath, signal)
      signal?.throwIfAborted()
      const [settingsFile, databaseFile] = await Promise.all([
        describeFile(settingsPath, "settings.json", signal),
        describeFile(databasePath, "thumbnails.db", signal),
      ])
      const manifest = ReaderBackupManifestSchema.parse({
        format: READER_BACKUP_FORMAT,
        version: READER_BACKUP_VERSION,
        createdAt: this.now(),
        settings: {
          ...settingsFile,
          format: settingsPayload.format,
          version: settingsPayload.version,
          omittedSensitivePaths: settingsPayload.omittedSensitivePaths,
        },
        database: {
          ...databaseFile,
          compatibility: databaseBackup.compatibility,
          metadataVersion: databaseBackup.metadataVersion,
          userVersion: databaseBackup.userVersion,
          journalMode: databaseBackup.journalMode,
          quickCheck: databaseBackup.quickCheck,
        },
      })
      const manifestPath = resolve(staging, "manifest.json")
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
      ReaderBackupManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")))
      signal?.throwIfAborted()
      await rename(staging, destination)
      published = true
      return { destinationPath: destination, manifest }
    } finally {
      if (!published) await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async inspect(bundlePath: string, signal?: AbortSignal): Promise<ReaderBackupInspection> {
    signal?.throwIfAborted()
    const bundle = await realpathDirectory(bundlePath)
    const manifestText = await readBounded(resolve(bundle, "manifest.json"), 1024 * 1024)
    const manifest = ReaderBackupManifestSchema.parse(JSON.parse(manifestText))
    const settingsPath = resolve(bundle, "settings.json")
    const databasePath = resolve(bundle, "thumbnails.db")
    const [settingsFile, databaseFile] = await Promise.all([
      describeFile(settingsPath, "settings.json", signal),
      describeFile(databasePath, "thumbnails.db", signal),
    ])
    assertFileMatches(manifest.settings, settingsFile)
    assertFileMatches(manifest.database, databaseFile)
    const settings = this.settings.inspect(await readBounded(settingsPath, 64 * 1024 * 1024))
    if (settings.format !== manifest.settings.format || settings.version !== manifest.settings.version) {
      throw new Error("Reader backup settings format does not match the manifest.")
    }
    if (JSON.stringify(settings.omittedSensitivePaths) !== JSON.stringify(manifest.settings.omittedSensitivePaths)) {
      throw new Error("Reader backup sensitive-field report does not match the manifest.")
    }
    const database = await this.database.verify(databasePath, signal)
    if (database.bytes !== manifest.database.bytes || database.quickCheck !== "ok") {
      throw new Error("Reader backup database verification does not match the manifest.")
    }
    return { bundlePath: bundle, manifest, settings, database }
  }

  async restore(
    bundlePath: string,
    options: { quarantinePath: string },
    signal?: AbortSignal,
  ): Promise<ReaderBackupRestoreResult> {
    if (!options.quarantinePath.trim()) throw new Error("Reader restore quarantinePath must be a non-empty path.")
    const inspected = await this.inspect(bundlePath, signal)
    const previousSettings = await this.settings.export()
    let settingsChanged = false
    try {
      const settingsResult = await this.settings.import(JSON.stringify(inspected.settings), "overwrite", true)
      settingsChanged = settingsResult.changed
      signal?.throwIfAborted()
      const database = await this.database.recover(this.databasePath, {
        backupPath: resolve(inspected.bundlePath, "thumbnails.db"),
        quarantinePath: resolve(options.quarantinePath),
      }, signal)
      return { manifest: inspected.manifest, settingsChanged, database }
    } catch (error) {
      if (!settingsChanged) throw error
      try {
        await this.settings.import(JSON.stringify(previousSettings), "overwrite", true)
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "Reader restore failed and settings rollback was incomplete.")
      }
      throw error
    }
  }
}

async function describeFile(path: string, name: string, signal?: AbortSignal): Promise<{ name: string; bytes: number; sha256: string }> {
  const digest = createHash("sha256")
  let bytes = 0
  for await (const chunk of createReadStream(path, { highWaterMark: 1024 * 1024, signal })) {
    signal?.throwIfAborted()
    const buffer = chunk as Buffer
    bytes += buffer.byteLength
    digest.update(buffer)
  }
  if (bytes < 1) throw new Error(`Reader backup file is empty: ${name}`)
  return { name, bytes, sha256: digest.digest("hex") }
}

async function assertMissing(path: string): Promise<void> {
  try {
    await stat(path)
    throw new Error(`Reader backup destination already exists: ${path}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }
}

async function realpathDirectory(path: string): Promise<string> {
  const canonical = await realpath(path)
  if (!(await stat(canonical)).isDirectory()) throw new Error(`Reader backup is not a directory: ${path}`)
  return canonical
}

async function readBounded(path: string, maximumBytes: number): Promise<string> {
  const info = await stat(path)
  if (!info.isFile() || info.size < 1 || info.size > maximumBytes) {
    throw new Error(`Reader backup file size is invalid: ${basename(path)}`)
  }
  return readFile(path, "utf8")
}

function assertFileMatches(expected: { name: string; bytes: number; sha256: string }, actual: { name: string; bytes: number; sha256: string }): void {
  if (expected.name !== actual.name || expected.bytes !== actual.bytes || expected.sha256 !== actual.sha256) {
    throw new Error(`Reader backup file does not match the manifest: ${expected.name}`)
  }
}
