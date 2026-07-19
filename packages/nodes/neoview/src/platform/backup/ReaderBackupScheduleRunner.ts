import { randomUUID } from "node:crypto"
import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"

import type { ReaderBackupInspection } from "./ReaderBackupBundleService.js"
import type { ReaderBackupScheduleConfig } from "./ReaderBackupScheduleConfig.js"

const AUTO_BACKUP_PREFIX = "xiranite-neoview-auto-"
const AUTO_BACKUP_MARKER = ".xiranite-neoview-auto-backup.json"
const AUTO_BACKUP_LOCK_OWNER = "owner"
const AUTO_BACKUP_FORMAT = "Xiranite/NeoViewAutoBackup"
const AUTO_BACKUP_LOCK_STALE_AFTER_MS = 5 * 60_000

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
    if (!this.config.directory) throw new Error("Automatic Reader backup directory is unavailable.")
    const root = resolve(this.config.directory)
    await assertSafeDirectory(root)
    const lockPath = join(root, ".xiranite-neoview-auto-backup.lock")
    const lock = await tryAcquireLock(lockPath)
    if (!lock) return { status: "locked" }
    let createdDestinationPath: string | undefined
    let committed = false
    try {
      const now = (this.options.now ?? Date.now)()
      const existing = await this.#automaticBackups(root, signal)
      const latest = existing[0]
      const dueAt = latest ? latest.createdAt + this.config.intervalHours * 3_600_000 : undefined
      if (dueAt !== undefined && now < dueAt) return { status: "not-due", lastBackupAt: latest.createdAt, dueAt }

      const destinationPath = join(root, automaticBackupName(now))
      const created = await this.backup.create(destinationPath, signal)
      createdDestinationPath = resolve(created.destinationPath)
      if (createdDestinationPath !== resolve(destinationPath)) {
        throw new Error("Automatic Reader backup service returned an unexpected destination path.")
      }
      const inspected = await this.backup.inspect(created.destinationPath, signal)
      const createdAt = inspected.manifest.createdAt
      if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw new Error("Automatic Reader backup manifest has an invalid createdAt.")
      await writeAutoBackupMarker(created.destinationPath, createdAt)
      committed = true
      signal?.throwIfAborted()
      const retained = await this.#automaticBackups(root, signal)
      const pruned = await pruneBackups(retained, this.config.retainCount)
      return { status: "created", destinationPath: created.destinationPath, createdAt, pruned }
    } catch (error) {
      if (createdDestinationPath && !committed) {
        try {
          await removeIncompleteBackup(root, createdDestinationPath)
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], "Automatic Reader backup failed and its incomplete bundle could not be removed.")
        }
      }
      throw error
    } finally {
      await releaseLock(lock)
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
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) throw error
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

interface BackupLock {
  path: string
  token: string
}

async function tryAcquireLock(lockPath: string): Promise<BackupLock | undefined> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = randomUUID()
    try {
      await mkdir(lockPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      if (attempt === 0 && await reclaimStaleLock(lockPath)) continue
      return undefined
    }
    try {
      await writeFile(join(lockPath, AUTO_BACKUP_LOCK_OWNER), JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }) + "\n", { encoding: "utf8", flag: "wx" })
      return { path: lockPath, token }
    } catch (error) {
      await rm(lockPath, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }
  return undefined
}

async function releaseLock(lock: BackupLock): Promise<void> {
  try {
    const owner = await readLockOwner(lock.path)
    if (!owner || owner.token !== lock.token || owner.pid !== process.pid) return
    const releasingPath = `${lock.path}.release-${randomUUID()}`
    await rename(lock.path, releasingPath)
    await rm(releasingPath, { recursive: true, force: true }).catch(() => undefined)
  } catch {
    // Never remove a lock when ownership cannot be proven. A later run can report it as locked.
  }
}

async function reclaimStaleLock(lockPath: string): Promise<boolean> {
  const owner = await readLockOwner(lockPath)
  if (owner && isProcessAlive(owner.pid)) return false
  if (!owner) {
    try {
      const info = await stat(lockPath)
      if (Date.now() - info.mtimeMs < AUTO_BACKUP_LOCK_STALE_AFTER_MS) return false
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true
      return false
    }
  }
  const quarantine = `${lockPath}.stale-${randomUUID()}`
  try {
    await rename(lockPath, quarantine)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true
    return false
  }
  await rm(quarantine, { recursive: true, force: true }).catch(() => undefined)
  return true
}

async function readLockOwner(lockPath: string): Promise<{ pid: number; token: string } | undefined> {
  try {
    const value = JSON.parse(await readFile(join(lockPath, AUTO_BACKUP_LOCK_OWNER), "utf8")) as unknown
    if (!isRecord(value) || typeof value.pid !== "number" || !Number.isSafeInteger(value.pid) || value.pid < 1 || typeof value.token !== "string" || !value.token) {
      return undefined
    }
    return { pid: value.pid, token: value.token }
  } catch {
    return undefined
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

async function removeIncompleteBackup(root: string, path: string): Promise<void> {
  const expectedParent = resolve(root)
  const expectedPath = resolve(expectedParent, basename(path))
  if (path !== expectedPath || dirname(path) !== expectedParent) return
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isDirectory()) return
  await rm(path, { recursive: true, force: false })
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError"
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
