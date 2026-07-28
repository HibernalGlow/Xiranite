import { copyFile, mkdir, readdir, rename, stat, unlink } from "node:fs/promises"
import path from "node:path"

// Deploys freshly built exes into the scoop "current" directory.
// Before overwriting, the existing exe is moved into backup/ with a
// timestamp suffix so repeated installs keep a rollback history.
const SOURCE_DIR = "build/wails"
const TARGET_DIR = "D:/scoop/apps/xiranite/current"
const BACKUP_DIR = path.join(TARGET_DIR, "backup")
const EXECUTABLES = ["Xiranite.exe", "xiranite-native-host.exe"]
const MAX_BACKUPS_PER_EXE = 10

const timestamp = formatTimestamp(new Date())
let failed = false

for (const exe of EXECUTABLES) {
  const source = path.join(SOURCE_DIR, exe)
  const target = path.join(TARGET_DIR, exe)

  if (!(await fileExists(source))) {
    console.error(`[scoop-install] Missing build artifact: ${source} (run wails:build first)`)
    failed = true
    continue
  }

  await backupExisting(target, exe)
  await copyFile(source, target)
  console.log(`[scoop-install] Installed ${exe} -> ${target}`)
}

process.exit(failed ? 1 : 0)

async function backupExisting(target: string, exe: string): Promise<void> {
  if (!(await fileExists(target))) return
  await mkdir(BACKUP_DIR, { recursive: true })

  const parsed = path.parse(exe)
  const backupName = `${parsed.name}.${timestamp}${parsed.ext}.bak`
  const backupPath = path.join(BACKUP_DIR, backupName)

  // Move instead of copy: the running exe file lock on Windows blocks
  // overwrite-in-place, but rename usually succeeds and frees the name.
  await rename(target, backupPath)
  console.log(`[scoop-install] Backed up previous ${exe} -> ${backupPath}`)

  await pruneBackups(parsed.name, parsed.ext)
}

async function pruneBackups(baseName: string, ext: string): Promise<void> {
  const entries = await readdir(BACKUP_DIR)
  const pattern = new RegExp(`^${escapeRegExp(baseName)}\\.\\d{8}-\\d{6}${escapeRegExp(ext)}\\.bak$`)
  const backups = entries.filter((name) => pattern.test(name)).sort()

  const excess = backups.length - MAX_BACKUPS_PER_EXE
  for (let index = 0; index < excess; index += 1) {
    const stale = path.join(BACKUP_DIR, backups[index])
    await unlink(stale)
    console.log(`[scoop-install] Pruned old backup ${stale}`)
  }
}

function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `${day}-${time}`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}
