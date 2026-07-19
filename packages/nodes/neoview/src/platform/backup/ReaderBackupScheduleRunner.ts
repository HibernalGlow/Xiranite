import { randomUUID } from "node:crypto"
import { lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

import type { ReaderBackupInspection } from "./ReaderBackupBundleService.js"
import type { ReaderBackupScheduleConfig } from "./ReaderBackupScheduleConfig.js"

const AUTO_BACKUP_PREFIX = "xiranite-neoview-auto-"
const AUTO_BACKUP_MARKER = ".xiranite-neoview-auto-backup.json"
const AUTO_BACKUP_FORMAT = "Xiranite/NeoViewAutoBackup"

export interface ReaderBackupSchedulePort {
  create(destinationPath: string, signal?: AbortSignal): Promise<{ destinationPath: string }>
  inspect(bundlePath: string, signal?: AbortSignal): Promise<ReaderBackupInspection>
}

export type ReaderBackupScheduleRunResult =
  | { status: "disabled" }
  | { status: "locked" }
  | { status: "not-due"; lastBackupAt: number; dueAt: number }
  | { status: "created"; destinationPath: string; createdAt: number; pruned: number }

interface AutomaticBackup {
  path: string
  createdAt: number
}

export class ReaderBackupScheduleRunner {
  constructor(
    private readonly config: ReaderBackupScheduleConfig,
    private readonly backup: ReaderBackupSchedulePort,
    private readonly options: { now?: () => number } = {},
  ) {}

  async runIfDue(signal?: AbortSignal): Promise<ReaderBackupScheduleRunResult> {
    signal?.throwIfAborted()
    if (!this.config.enabled) return { status: "disabled" }
    const root = this.config.directory
    if (!root) throw new Error("Automatic Reader backup directory is unavailable.")
    await assertSafeDirectory(root)
    const lockPath = join(root, ".xiranite-neoview-auto-backup.lock")
    if (!(await tryAcquireLock(lockPath))) return { status: "locked" }
    try {
      const now = (this.options.now ?? Date.now)()
      const existing = await this.#automaticBackups(root, signal)
      const latest = existing[0]
      const dueAt = latest ? latest.createdAt + this.config.intervalHours * 3_600_000 : undefined
      if (dueAt !== undefined && now < dueAt) return { status: "not-due", lastBackupAt: latest.createdAt, dueAt }

      const destinationPath = join(root, automaticBackupName(now))
      const created = await this.backup.create(destinationPath, signal)
      const inspected = await this.backup.inspect(created.destinationPath, signal)
      const createdAt = inspected.manifest.createdAt
      await writeAutoBackupMarker(created.destinationPath, createdAt)
      const retained = await this.#automaticBackups(root, signal)
      const pruned = await pruneBackups(retained, this.config.retainCount)
      return { status: "created", destinationPath: created.destinationPath, createdAt, pruned }
    } finally {
      await rm(lockPath, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async #automaticBackups(root: string, signal?: AbortSignal): Promise<AutomaticBackup[]> {
    const entries = await readdir(root, { withFileTypes: true })
    const backups: AutomaticBackup[] = []
    for (const entry of entries) {
      signal?.throwIfAborted()
      if (!entry.isDirectory() || entry.isSymbolicLink() || !entry.name.startsWith(AUTO_BACKUP_PREFIX)) continue
      const path = join(root, entry.name)
      const marker = await readAutoBackupMarker(path)
      if (!marker) continue
      try {
        const inspected = await this.backup.inspect(path, signal)
        if (inspected.manifest.createdAt !== marker.createdAt) continue
        backups.push({ path, createdAt: marker.createdAt })
      } catch {
        // Corrupt or incomplete bundles are never candidates for automatic retention deletion.
      }
    }
    return backups.sort((left, right) => right.createdAt - left.createdAt || right.path.localeCompare(left.path))
  }
}

function automaticBackupName(now: number): string {
  return `${AUTO_BACKUP_PREFIX}${new Date(now).toISOString().replace(/[:.]/gu, "-")}-${randomUUID()}`
}

async function assertSafeDirectory(directory: string): Promise<void> {
  const path = resolve(directory)
  await mkdir(path, { recursive: true })
  const info = await lstat(path)
  if (info.isSymbolicLink()) throw new Error(`Automatic Reader backup path must not be a symbolic link: ${path}`)
  if (!info.isDirectory()) throw new Error(`Automatic Reader backup path is not a directory: ${path}`)
}

async function tryAcquireLock(lockPath: string): Promise<boolean> {
  try {
    await mkdir(lockPath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false
    throw error
  }
}

async function writeAutoBackupMarker(bundlePath: string, createdAt: number): Promise<void> {
  const markerPath = join(bundlePath, AUTO_BACKUP_MARKER)
  await writeFile(markerPath, `${JSON.stringify({ format: AUTO_BACKUP_FORMAT, version: 1, createdAt })}\n`, { encoding: "utf8", flag: "wx" })
}

async function readAutoBackupMarker(bundlePath: string): Promise<{ createdAt: number } | undefined> {
  const markerPath = join(bundlePath, AUTO_BACKUP_MARKER)
  try {
    const marker = JSON.parse(await readFile(markerPath, "utf8")) as unknown
    if (
      !isRecord(marker)
      || marker.format !== AUTO_BACKUP_FORMAT
      || marker.version !== 1
      || typeof marker.createdAt !== "number"
      || !Number.isSafeInteger(marker.createdAt)
      || marker.createdAt < 0
    ) {
      return undefined
    }
    return { createdAt: marker.createdAt }
  } catch {
    return undefined
  }
}

async function pruneBackups(backups: readonly AutomaticBackup[], retainCount: number): Promise<number> {
  let pruned = 0
  for (const backup of backups.slice(retainCount)) {
    await rm(backup.path, { recursive: true, force: false })
    pruned += 1
  }
  return pruned
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
