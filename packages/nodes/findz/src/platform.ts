import { execFile } from "node:child_process"
import { access, mkdir, readFile, readdir, stat as fsStat, lstat, writeFile } from "node:fs/promises"
import { constants } from "node:fs"
import { basename, dirname, extname, join, resolve } from "node:path"
import type { FindzCommandResult, FindzDirEntry, FindzFileStat, FindzRuntime } from "./core.js"

const SEVEN_ZIP_NAMES = ["7z", "7z.exe", "7za", "7za.exe", "7zz", "7zz.exe"]

export function createNodeFindzRuntime(): FindzRuntime {
  return {
    cwd: process.cwd(),
    stat,
    readDir,
    readFile,
    writeText,
    find7z,
    runCommand,
    dirname,
    basename,
    extname,
    join,
    resolve,
  }
}

async function stat(path: string): Promise<FindzFileStat | null> {
  try {
    const info = await lstat(path)
    return {
      exists: true,
      isDirectory: info.isDirectory(),
      isFile: info.isFile(),
      isSymbolicLink: info.isSymbolicLink(),
      size: info.size,
      mtimeMs: info.mtimeMs,
      ctimeMs: info.ctimeMs,
    }
  } catch {
    return null
  }
}

async function readDir(path: string): Promise<FindzDirEntry[]> {
  const entries = await readdir(path, { withFileTypes: true })
  return Promise.all(entries.map(async (entry) => {
    const fullPath = join(path, entry.name)
    const info = await fsStat(fullPath).catch(() => null)
    return {
      name: entry.name,
      path: fullPath,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      isSymbolicLink: entry.isSymbolicLink(),
      stat: info ? {
        exists: true,
        isDirectory: info.isDirectory(),
        isFile: info.isFile(),
        isSymbolicLink: entry.isSymbolicLink(),
        size: info.size,
        mtimeMs: info.mtimeMs,
        ctimeMs: info.ctimeMs,
      } : undefined,
    }
  }))
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, "utf8")
}

async function find7z(): Promise<string | null> {
  for (const name of SEVEN_ZIP_NAMES) {
    const found = await findOnPath(name)
    if (found) return found
  }
  for (const candidate of [
    "C:\\Program Files\\7-Zip\\7z.exe",
    "C:\\Program Files (x86)\\7-Zip\\7z.exe",
    join(process.env.LOCALAPPDATA ?? "", "7-Zip", "7z.exe"),
  ]) {
    if (candidate && await exists(candidate)) return candidate
  }
  return null
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function findOnPath(command: string): Promise<string | null> {
  const locator = process.platform === "win32" ? "where.exe" : "which"
  const result = await runCommand(locator, [command])
  if (result.code !== 0) return null
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null
}

async function runCommand(command: string, args: string[]): Promise<FindzCommandResult> {
  const started = Date.now()
  return new Promise((resolveResult) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 1024 * 1024 * 32 }, (error, stdout, stderr) => {
      const code = error && typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 0
      resolveResult({
        code,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? (error instanceof Error ? error.message : "")),
        durationMs: Date.now() - started,
      })
    })
  })
}
