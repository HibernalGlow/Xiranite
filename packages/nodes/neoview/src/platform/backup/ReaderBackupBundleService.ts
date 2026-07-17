import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
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
    format: z.literal("Xiranite/NeoViewConfig"),
    version: z.literal(1),
    omittedSensitivePaths: z.array(z.string()),
  }).strict(),
  database: BackupFileSchema.extend({
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
