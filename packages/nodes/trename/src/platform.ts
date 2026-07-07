import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { resolveXiraniteConfigPath } from "@xiranite/config"
import type { TrenameDirEntry, TrenamePathInfo, TrenameRuntime } from "./core.js"

export function createNodeTrenameRuntime(): TrenameRuntime {
  return {
    pathInfo,
    listDir,
    readText: (path) => readFile(path, "utf8"),
    writeText: (path, content) => writeFile(path, content, "utf8").then(() => undefined),
    ensureDir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
    movePath,
    join,
    dirname,
    basename,
    resolve,
    defaultUndoPath: () => defaultTrenameUndoPath(),
    now: () => new Date().toISOString(),
    randomId: () => randomUUID(),
  }
}

/**
 * Default trename undo store path: `<xiranite-data-dir>/artifacts/undo/trename.undo.json`.
 * The data dir is derived from resolveXiraniteConfigPath (XIRANITE_DATA_DIR / XIRANITE_CONFIG_PATH / system dir).
 */
export function defaultTrenameUndoPath(): string {
  const configPath = resolveXiraniteConfigPath()
  const dataDir = dirname(configPath)
  return join(dataDir, "artifacts", "undo", "trename.undo.json")
}

async function pathInfo(path: string): Promise<TrenamePathInfo> {
  const resolved = resolve(path)
  try {
    const item = await stat(resolved)
    return {
      path: resolved,
      exists: true,
      isFile: item.isFile(),
      isDirectory: item.isDirectory(),
      size: item.size,
      createdMs: item.birthtimeMs,
      modifiedMs: item.mtimeMs,
    }
  } catch {
    return { path: resolved, exists: false, isFile: false, isDirectory: false, size: 0, createdMs: 0, modifiedMs: 0 }
  }
}

async function listDir(path: string): Promise<TrenameDirEntry[]> {
  const resolved = resolve(path)
  const entries = await readdir(resolved, { withFileTypes: true })
  return Promise.all(entries.map(async (entry) => {
    const entryPath = join(resolved, entry.name)
    const item = await safeStat(entryPath)
    return {
      name: entry.name,
      path: entryPath,
      isFile: entry.isFile(),
      isDirectory: entry.isDirectory(),
      size: item?.isFile() ? item.size : 0,
    }
  }))
}

async function movePath(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  try {
    await rename(source, target)
  } catch {
    await cp(source, target, { recursive: true, force: false, errorOnExist: true })
    await rm(source, { recursive: true, force: true })
  }
}

async function safeStat(path: string) {
  try {
    return await stat(path)
  } catch {
    return null
  }
}

export async function readClipboardText(): Promise<string> {
  if (process.platform === "win32") {
    const result = await runCommand("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "$ProgressPreference = 'SilentlyContinue'; Get-Clipboard -Raw",
    ])
    return result.code === 0 ? result.stdout.trim() : ""
  }

  if (process.platform === "darwin") {
    const result = await runCommand("pbpaste", [])
    return result.code === 0 ? result.stdout.trim() : ""
  }

  for (const command of [["wl-paste"], ["xclip", "-selection", "clipboard", "-o"], ["xsel", "--clipboard", "--output"]]) {
    const result = await runCommand(command[0]!, command.slice(1))
    if (result.code === 0 && result.stdout.trim()) return result.stdout.trim()
  }

  return ""
}

interface CommandResult {
  code: number
  stdout: string
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return await new Promise((resolveResult) => {
    execFile(command, args, { encoding: "utf8", windowsHide: true }, (error, stdout) => {
      const code = typeof (error as NodeJS.ErrnoException | null)?.code === "number" ? Number((error as NodeJS.ErrnoException).code) : error ? 1 : 0
      resolveResult({ code, stdout: stdout ?? "" })
    })
  })
}
