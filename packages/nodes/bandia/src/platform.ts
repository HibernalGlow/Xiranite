import { spawn } from "node:child_process"
import { stat } from "node:fs/promises"
import { hostCapabilities } from "@xiranite/host-capabilities"
import { executeSingleFileMutation, type FileOperationExecutor } from "@xiranite/file-operations"
import { PlatformFileMutationProvider } from "@xiranite/file-operations/platform"
import type { BandiaCommandResult, BandiaFileStat, BandiaRuntime } from "./core.js"

const { basename, dirname, extname, join, resolve } = hostCapabilities.path

const BZ_EXECUTABLE_NAMES = ["bz.exe", "bandizip", "Bandizip", "BZ.exe"]

export interface BandiaRuntimeContext {
  fileOperations?: FileOperationExecutor
}

let standaloneFileMutations: PlatformFileMutationProvider | undefined

/**
 * bandia's machine half, through the host capability surface.
 *
 * Two Node imports stay, and each is a limit of the surface rather than unfinished work: `readStat` needs a
 * creation time the host never answers, and `openEverything` launches a detached child that must not hold the
 * face open — `proc.start` hands back a pollable handle and keeps the pipe alive instead. `tempDir` is not on
 * that list: `os.tempDir()` is one of the surface's synchronous arms, so a synchronous `BandiaRuntime.tempDir`
 * is answered without reaching for `node:os`.
 */
export function createNodeBandiaRuntime(context: BandiaRuntimeContext = {}): BandiaRuntime {
  const { fs, os } = hostCapabilities
  return {
    findBandizip,
    runCommand,
    exists,
    stat: readStat,
    ensureDir: (path) => fs.ensureDir(path),
    removePath: (path, options) => removePath(path, options, context.fileOperations),
    writeText: (path, content) => fs.writeText(path, content),
    openEverything,
    tempDir: () => os.tempDir(),
    dirname,
    basename,
    extname,
    join,
    resolve,
  }
}

export async function readClipboardText(): Promise<string> {
  const { platform } = await hostCapabilities.os.platform()
  if (platform === "win32") {
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

  if (platform === "darwin") {
    const result = await runCommand("pbpaste", [])
    return result.code === 0 ? result.stdout.trim() : ""
  }

  for (const command of [["wl-paste"], ["xclip", "-selection", "clipboard", "-o"], ["xsel", "--clipboard", "--output"]]) {
    const result = await runCommand(command[0]!, command.slice(1))
    if (result.code === 0 && result.stdout.trim()) return result.stdout.trim()
  }

  return ""
}

async function findBandizip(): Promise<string | null> {
  const { env } = await hostCapabilities.os.platform()
  const configured = env.BANDIZIP_PATH
  if (configured) {
    if (await isFile(configured)) return configured
    for (const name of BZ_EXECUTABLE_NAMES) {
      const candidate = join(configured, name)
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
    join(env.LOCALAPPDATA ?? "", "Programs", "Bandizip"),
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
  return (await hostCapabilities.fs.stat(path)) !== null
}

/**
 * The one answer bandia still takes from Node: `BandiaFileStat.ctimeMs` feeds the EFU export's creation
 * time, and the host's stat answer carries only atime and mtime (see `crates/xiranite-core/src/filesystem.rs`),
 * so routing this through `fs.stat` would have to invent the field.
 */
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

async function removePath(path: string, options?: { trash?: boolean }, executor?: FileOperationExecutor): Promise<void> {
  if (!(await exists(path))) return
  const operation = { kind: options?.trash ? "trash" as const : "delete" as const, sourcePath: path }
  if (executor) {
    await executeSingleFileMutation(executor, operation)
    return
  }
  standaloneFileMutations ??= new PlatformFileMutationProvider()
  await standaloneFileMutations.execute(operation)
}

async function runCommand(command: string, args: string[], options?: { cwd?: string }): Promise<BandiaCommandResult> {
  const started = Date.now()
  const result = await hostCapabilities.proc.exec(command, args, options?.cwd ? { cwd: options.cwd } : undefined)
  return {
    // A host-killed child answers `exitCode: null`; `BandiaCommandResult.code` has no null arm and every
    // caller reads non-zero as failure, so an interrupted run reports as one.
    code: result.exitCode ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: Date.now() - started,
  }
}

async function openEverything(efuPath: string): Promise<void> {
  const { platform, env } = await hostCapabilities.os.platform()
  if (platform !== "win32") return
  const candidates = [
    join(env.PROGRAMFILES ?? "", "Everything", "Everything.exe"),
    join(env["PROGRAMFILES(X86)"] ?? "", "Everything", "Everything.exe"),
    join(env.LOCALAPPDATA ?? "", "Everything", "Everything.exe"),
  ]
  const everything = await firstExistingFile(candidates)
  if (everything) {
    // Left on Node on purpose. This is a fire-and-forget launch: `detached` + `unref` means Everything outlives
    // the call. `proc.start` cannot say that — the run that started a handle owns it (its transcript keeps the
    // face's event loop awake, and the host's process table reaps whatever is still live when the run ends).
    spawn(everything, ["-filelist", resolve(efuPath)], { detached: true, stdio: "ignore", windowsHide: true }).unref()
  }
}

async function findOnPath(command: string): Promise<string | null> {
  const { platform } = await hostCapabilities.os.platform()
  const locator = platform === "win32" ? "where.exe" : "which"
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
  return (await hostCapabilities.fs.stat(path))?.kind === "file"
}
