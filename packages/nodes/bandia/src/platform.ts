import { execFile, spawn } from "node:child_process"
import { access, mkdir, rm, stat, writeFile } from "node:fs/promises"
import { constants } from "node:fs"
import { basename, dirname, extname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import type { BandiaCommandResult, BandiaFileStat, BandiaRuntime } from "./core.js"

const BZ_EXECUTABLE_NAMES = ["bz.exe", "bandizip", "Bandizip", "BZ.exe"]

export function createNodeBandiaRuntime(): BandiaRuntime {
  return {
    findBandizip,
    runCommand,
    exists,
    stat: readStat,
    ensureDir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
    removePath,
    writeText: (path, content) => writeFile(path, content, "utf8"),
    openEverything,
    tempDir: tmpdir,
    dirname,
    basename,
    extname,
    join,
    resolve,
  }
}

async function findBandizip(): Promise<string | null> {
  const env = process.env.BANDIZIP_PATH
  if (env) {
    if (await isFile(env)) return env
    for (const name of BZ_EXECUTABLE_NAMES) {
      const candidate = join(env, name)
      if (await isFile(candidate)) return candidate
    }
  }

  for (const name of BZ_EXECUTABLE_NAMES) {
    const fromPath = await findOnPath(name)
    if (fromPath) return fromPath
  }

  for (const root of [
    "C:\\Program Files\\Bandizip",
    "C:\\Program Files (x86)\\Bandizip",
    join(process.env.LOCALAPPDATA ?? "", "Programs", "Bandizip"),
  ]) {
    if (!root.trim()) continue
    for (const name of BZ_EXECUTABLE_NAMES) {
      const candidate = join(root, name)
      if (await isFile(candidate)) return candidate
    }
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

async function readStat(path: string): Promise<BandiaFileStat | null> {
  try {
    const item = await stat(path)
    return {
      exists: true,
      isDirectory: item.isDirectory(),
      size: item.size,
      mtimeMs: item.mtimeMs,
      ctimeMs: item.ctimeMs,
    }
  } catch {
    return null
  }
}

async function removePath(path: string, options?: { trash?: boolean }): Promise<void> {
  const item = await readStat(path)
  if (!item?.exists) return
  if ((options?.trash ?? false) && process.platform === "win32") {
    const moved = await recycleOnWindows(path, item.isDirectory)
    if (moved) return
  }
  await rm(path, { recursive: true, force: true })
}

async function runCommand(command: string, args: string[], options?: { cwd?: string }): Promise<BandiaCommandResult> {
  const started = Date.now()
  return new Promise((resolveResult) => {
    execFile(command, args, { cwd: options?.cwd, windowsHide: true, maxBuffer: 1024 * 1024 * 16 }, (error, stdout, stderr) => {
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

async function openEverything(efuPath: string): Promise<void> {
  if (process.platform !== "win32") return
  const candidates = [
    join(process.env.PROGRAMFILES ?? "", "Everything", "Everything.exe"),
    join(process.env["PROGRAMFILES(X86)"] ?? "", "Everything", "Everything.exe"),
    join(process.env.LOCALAPPDATA ?? "", "Everything", "Everything.exe"),
  ]
  const everything = await firstExistingFile(candidates)
  if (everything) {
    spawn(everything, ["-filelist", resolve(efuPath)], { detached: true, stdio: "ignore", windowsHide: true }).unref()
  }
}

async function findOnPath(command: string): Promise<string | null> {
  const locator = process.platform === "win32" ? "where.exe" : "which"
  const result = await runCommand(locator, [command])
  if (result.code !== 0) return null
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null
}

async function firstExistingFile(paths: string[]): Promise<string | null> {
  for (const path of paths) {
    if (path && await isFile(path)) return path
  }
  return null
}

async function isFile(path: string): Promise<boolean> {
  try {
    const item = await stat(path)
    return item.isFile()
  } catch {
    return false
  }
}

async function recycleOnWindows(path: string, isDirectory: boolean): Promise<boolean> {
  const method = isDirectory ? "DeleteDirectory" : "DeleteFile"
  const script = [
    "$ProgressPreference = 'SilentlyContinue'",
    "Add-Type -AssemblyName Microsoft.VisualBasic",
    `[Microsoft.VisualBasic.FileIO.FileSystem]::${method}(${quotePowerShell(path)}, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)`,
  ].join("; ")
  const shell = await runCommand("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
  return shell.code === 0
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
