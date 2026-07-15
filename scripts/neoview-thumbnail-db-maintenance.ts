import { Database } from "bun:sqlite"
import { mkdir, stat, statfs } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, parse, resolve } from "node:path"

interface ThumbnailRow {
  key: string
  category: string
  date: string | null
  blob_bytes: number | null
}

interface AuditResult {
  path: string
  totalRows: number
  blankKeys: number
  emptyBlobs: number
  expiredFiles: number
  expiredFoldersPreserved: number
  invalidPaths: number
  unavailableVolumeRowsPreserved: number
  invalidPathSample: string[]
  unavailableRoots: string[]
  cutoff: string
  estimatedRowsAfterCleanup: number
  estimatedBlobMiBAfterCleanup: number
}

interface InternalAudit {
  report: AuditResult
  invalidKeys: string[]
}

interface Options {
  primary: string
  source: string
  backupDir?: string
  days: number
  execute: boolean
  vacuumSource: boolean
  allowXiraniteReaders: boolean
}

const options = parseOptions(Bun.argv.slice(2))
const sourceAudit = await auditDatabase(options.source, options.days)
const primaryAudit = await auditDatabase(options.primary, options.days)

if (!options.execute) {
  console.log(JSON.stringify({ mode: "audit", source: sourceAudit.report, primary: primaryAudit.report }, null, 2))
  process.exit(0)
}

if (!options.backupDir) throw new Error("--backup-dir is required with --execute.")
assertMaintenanceProcessesStopped(options.allowXiraniteReaders)
await executeMaintenance(options, sourceAudit, primaryAudit)

async function auditDatabase(path: string, days: number): Promise<InternalAudit> {
  const database = new Database(path, { readonly: true, strict: true })
  try {
    database.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;")
    const rows = database.query<ThumbnailRow, []>(
      "SELECT key, category, date, length(value) AS blob_bytes FROM thumbs",
    ).all()
    const cutoffDate = new Date(Date.now() - days * 86_400_000)
    const cutoff = sqliteTimestamp(cutoffDate)
    const sourcePaths = new Map<string, string[]>()
    let blankKeys = 0
    let emptyBlobs = 0
    let expiredFiles = 0
    let expiredFoldersPreserved = 0
    const invalidKeys: string[] = []

    for (const row of rows) {
      if (!row.key.trim()) {
        blankKeys += 1
        invalidKeys.push(row.key)
        continue
      }
      if (!row.blob_bytes) emptyBlobs += 1
      if (row.date && row.date < cutoff) {
        if (row.category === "folder") expiredFoldersPreserved += 1
        else if (row.category === "file") expiredFiles += 1
      }
      const sourcePath = thumbnailSourcePath(row.key)
      if (!sourcePath) {
        invalidKeys.push(row.key)
        continue
      }
      const keys = sourcePaths.get(sourcePath)
      if (keys) keys.push(row.key)
      else sourcePaths.set(sourcePath, [row.key])
    }

    const roots = new Map<string, boolean>()
    for (const sourcePath of sourcePaths.keys()) {
      const root = pathRoot(sourcePath)
      if (!roots.has(root)) roots.set(root, await pathExists(root))
    }
    const unavailableRoots = [...roots].filter(([, available]) => !available).map(([root]) => root)
    const unavailableRootSet = new Set(unavailableRoots.map(normalizeRoot))
    let unavailableVolumeRowsPreserved = 0
    const paths = [...sourcePaths.entries()]
    await mapConcurrent(paths, 64, async ([sourcePath, keys]) => {
      const root = pathRoot(sourcePath)
      if (unavailableRootSet.has(normalizeRoot(root))) {
        unavailableVolumeRowsPreserved += keys.length
        return
      }
      if (!await pathExists(sourcePath)) invalidKeys.push(...keys)
    })

    const invalidKeySet = new Set(invalidKeys)
    const deleteKeySet = new Set<string>()
    let retainedBlobBytes = 0
    for (const row of rows) {
      const shouldDelete = invalidKeySet.has(row.key)
        || !row.key.trim()
        || !row.blob_bytes
        || (row.category === "file" && Boolean(row.date && row.date < cutoff))
      if (shouldDelete) deleteKeySet.add(row.key)
      else retainedBlobBytes += row.blob_bytes ?? 0
    }

    const report: AuditResult = {
      path,
      totalRows: rows.length,
      blankKeys,
      emptyBlobs,
      expiredFiles,
      expiredFoldersPreserved,
      invalidPaths: invalidKeySet.size,
      unavailableVolumeRowsPreserved,
      invalidPathSample: [...invalidKeySet].slice(0, 20),
      unavailableRoots,
      cutoff,
      estimatedRowsAfterCleanup: rows.length - deleteKeySet.size,
      estimatedBlobMiBAfterCleanup: Number((retainedBlobBytes / 1024 / 1024).toFixed(2)),
    }
    return { report, invalidKeys: [...invalidKeySet] }
  } finally {
    database.close()
  }
}

async function executeMaintenance(options: Options, sourceAudit: InternalAudit, primaryAudit: InternalAudit): Promise<void> {
  const primary = resolve(options.primary)
  const source = resolve(options.source)
  const backupDir = resolve(options.backupDir!)
  if (primary === source) throw new Error("Primary and source databases must be different files.")
  await mkdir(backupDir, { recursive: true })
  const [primaryInfo, sourceInfo, backupVolume] = await Promise.all([stat(primary), stat(source), statfs(backupDir)])
  const requiredBackupBytes = primaryInfo.size + sourceInfo.size + 512 * 1024 * 1024
  const availableBackupBytes = backupVolume.bavail * backupVolume.bsize
  if (availableBackupBytes < requiredBackupBytes) {
    throw new Error(`Backup volume requires ${formatGiB(requiredBackupBytes)} GiB but only ${formatGiB(availableBackupBytes)} GiB is available.`)
  }

  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-")
  const sourceBackup = join(backupDir, `${basename(source)}.source-${stamp}.backup`)
  const primaryBackup = join(backupDir, `${basename(primary)}.primary-${stamp}.backup`)
  backupDatabase(source, sourceBackup)
  backupDatabase(primary, primaryBackup)

  cleanupDatabase(source, sourceAudit, options.vacuumSource)
  cleanupDatabase(primary, primaryAudit, false)

  const primaryDatabase = new Database(primary, { create: false, strict: true })
  try {
    primaryDatabase.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;")
    primaryDatabase.exec(`ATTACH DATABASE ${sqlString(source)} AS merge_source;`)
    try {
      primaryDatabase.transaction(() => {
        primaryDatabase.exec(`
          INSERT INTO main.thumbs (
            key, size, date, ghash, category, value,
            emm_json, rating_data, ai_translation, manual_tags
          )
          SELECT
            key, size, date, ghash, category, value,
            emm_json, rating_data, ai_translation, manual_tags
          FROM merge_source.thumbs
          WHERE true
          ON CONFLICT(key) DO UPDATE SET
            size = CASE WHEN excluded.date IS NOT NULL AND (thumbs.date IS NULL OR excluded.date > thumbs.date) THEN excluded.size ELSE thumbs.size END,
            date = CASE WHEN excluded.date IS NOT NULL AND (thumbs.date IS NULL OR excluded.date > thumbs.date) THEN excluded.date ELSE thumbs.date END,
            ghash = CASE WHEN excluded.date IS NOT NULL AND (thumbs.date IS NULL OR excluded.date > thumbs.date) THEN excluded.ghash ELSE thumbs.ghash END,
            category = CASE WHEN excluded.date IS NOT NULL AND (thumbs.date IS NULL OR excluded.date > thumbs.date) THEN excluded.category ELSE thumbs.category END,
            value = CASE WHEN excluded.date IS NOT NULL AND (thumbs.date IS NULL OR excluded.date > thumbs.date) THEN excluded.value ELSE thumbs.value END,
            emm_json = COALESCE(thumbs.emm_json, excluded.emm_json),
            rating_data = COALESCE(thumbs.rating_data, excluded.rating_data),
            ai_translation = COALESCE(thumbs.ai_translation, excluded.ai_translation),
            manual_tags = COALESCE(thumbs.manual_tags, excluded.manual_tags);
          DELETE FROM main.failed_thumbnails;
        `)
      })()
    } finally {
      primaryDatabase.exec("DETACH DATABASE merge_source;")
    }
    const integrity = scalarText(primaryDatabase, "PRAGMA integrity_check")
    if (integrity !== "ok") throw new Error(`Primary integrity check failed after merge: ${integrity}`)
    primaryDatabase.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA optimize;")
    const summary = primaryDatabase.query<Record<string, unknown>, []>(
      `SELECT COUNT(*) AS rows, SUM(value IS NOT NULL) AS blobs,
              ROUND(SUM(length(value)) / 1048576.0, 2) AS blob_mib,
              SUM(category = 'file') AS files, SUM(category = 'folder') AS folders
       FROM thumbs`,
    ).get() ?? {}
    console.log(JSON.stringify({
      mode: "execute",
      sourceBackup,
      primaryBackup,
      sourceCleanup: cleanupSummary(sourceAudit.report),
      primaryCleanup: cleanupSummary(primaryAudit.report),
      primary: { path: primary, ...summary },
    }, null, 2))
  } finally {
    primaryDatabase.close()
  }
}

function cleanupDatabase(path: string, audit: InternalAudit, vacuum: boolean): void {
  const database = new Database(path, { create: false, strict: true })
  try {
    database.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;")
    database.transaction(() => {
      deleteKeys(database, audit.invalidKeys)
      database.query("DELETE FROM thumbs WHERE value IS NULL OR length(value) = 0").run()
      database.query("DELETE FROM thumbs WHERE category = 'file' AND date IS NOT NULL AND date < ?1").run(audit.report.cutoff)
      database.query("DELETE FROM failed_thumbnails").run()
    })()
    const integrity = scalarText(database, "PRAGMA integrity_check")
    if (integrity !== "ok") throw new Error(`Integrity check failed after cleanup (${path}): ${integrity}`)
    database.exec("PRAGMA wal_checkpoint(TRUNCATE);")
    if (vacuum) database.exec("VACUUM;")
  } finally {
    database.close()
  }
}

function cleanupSummary(report: AuditResult): Record<string, number | string[]> {
  return {
    invalidPaths: report.invalidPaths,
    emptyBlobs: report.emptyBlobs,
    expiredFiles: report.expiredFiles,
    expiredFoldersPreserved: report.expiredFoldersPreserved,
    unavailableVolumeRowsPreserved: report.unavailableVolumeRowsPreserved,
    estimatedRowsAfterCleanup: report.estimatedRowsAfterCleanup,
    estimatedBlobMiBAfterCleanup: report.estimatedBlobMiBAfterCleanup,
    unavailableRoots: report.unavailableRoots,
  }
}

function backupDatabase(source: string, destination: string): void {
  const database = new Database(source, { create: false, strict: true })
  try {
    database.exec("PRAGMA wal_checkpoint(FULL);")
    database.exec(`VACUUM INTO ${sqlString(destination)};`)
    const backup = new Database(destination, { readonly: true, strict: true })
    try {
      const integrity = scalarText(backup, "PRAGMA integrity_check")
      if (integrity !== "ok") throw new Error(`Backup integrity check failed for ${destination}: ${integrity}`)
    } finally {
      backup.close()
    }
  } finally {
    database.close()
  }
}

function deleteKeys(database: Database, keys: readonly string[]): void {
  for (let offset = 0; offset < keys.length; offset += 400) {
    const batch = keys.slice(offset, offset + 400)
    if (!batch.length) continue
    const placeholders = batch.map((_, index) => `?${index + 1}`).join(", ")
    database.query(`DELETE FROM thumbs WHERE key IN (${placeholders})`).run(...batch)
  }
}

function thumbnailSourcePath(key: string): string | undefined {
  const trimmed = key.trim()
  if (!trimmed) return undefined
  const separator = trimmed.indexOf("::")
  const source = separator >= 0 ? trimmed.slice(0, separator) : trimmed
  return isAbsolute(source) ? resolve(source) : undefined
}

function pathRoot(path: string): string {
  const root = parse(path).root
  return root || dirname(path)
}

function normalizeRoot(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR" || code === "ENODEV") return false
    throw error
  }
}

async function mapConcurrent<T>(values: readonly T[], concurrency: number, operation: (value: T) => Promise<void>): Promise<void> {
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) await operation(values[cursor++]!)
  }))
}

function assertMaintenanceProcessesStopped(allowXiraniteReaders: boolean): void {
  if (process.platform !== "win32") return
  const result = Bun.spawnSync(["tasklist.exe", "/FO", "CSV", "/NH"], { stdout: "pipe", stderr: "pipe" })
  const tasks = result.stdout.toString().toLowerCase()
  const blocked = allowXiraniteReaders ? ["neoview.exe"] : ["neoview.exe", "xiranite.exe"]
  const active = blocked.filter((name) => tasks.includes(`"${name}"`))
  if (active.length) throw new Error(`Close these applications before database maintenance: ${active.join(", ")}`)
}

function scalarText(database: Database, sql: string): string | undefined {
  const row = database.query(sql).get() as Record<string, unknown> | null
  const value = row ? Object.values(row)[0] : undefined
  return typeof value === "string" ? value : undefined
}

function sqliteTimestamp(value: Date): string {
  return value.toISOString().slice(0, 19).replace("T", " ")
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function formatGiB(value: number): string {
  return (value / 1024 / 1024 / 1024).toFixed(2)
}

function parseOptions(args: string[]): Options {
  const values = new Map<string, string>()
  const flags = new Set<string>()
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]!
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`)
    if (key === "--execute" || key === "--vacuum-source" || key === "--allow-xiranite-readers") {
      flags.add(key)
      continue
    }
    const value = args[++index]
    if (!value) throw new Error(`${key} requires a value.`)
    values.set(key, value)
  }
  const primary = values.get("--primary")
  const source = values.get("--source")
  if (!primary || !source) throw new Error("Usage: bun scripts/neoview-thumbnail-db-maintenance.ts --primary <db> --source <db> [--days 30] [--backup-dir <dir> --execute] [--vacuum-source]")
  const days = Number(values.get("--days") ?? "30")
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) throw new Error("--days must be an integer from 1 to 3650.")
  return {
    primary,
    source,
    backupDir: values.get("--backup-dir"),
    days,
    execute: flags.has("--execute"),
    vacuumSource: flags.has("--vacuum-source"),
    allowXiraniteReaders: flags.has("--allow-xiranite-readers"),
  }
}
