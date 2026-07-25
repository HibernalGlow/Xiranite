import { execFile } from "node:child_process"
import { constants } from "node:fs"
import { access, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { executeSingleFileMutation, type FileOperationExecutor } from "@xiranite/file-operations"
import { PlatformFileMutationProvider } from "@xiranite/file-operations/platform"
import type { EngineVDirEntry, EngineVPathInfo, EngineVRuntime } from "./core.js"

export interface EngineVRuntimeContext {
  fileOperations?: FileOperationExecutor
}

let standaloneFileMutations: PlatformFileMutationProvider | undefined

export function createNodeEngineVRuntime(context: EngineVRuntimeContext = {}): EngineVRuntime {
  return {
    pathInfo,
    listDir,
    readJson: async (path) => JSON.parse(await readFile(path, "utf8")) as unknown,
    writeText: (path, content) => writeFile(path, content, "utf8").then(() => undefined),
    ensureDir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
    movePath,
    copyDir: (source, target) => cp(source, target, { recursive: true, force: false, errorOnExist: true }).then(() => undefined),
    removePath: (path, options) => removePath(path, options, context.fileOperations),
    join,
    dirname,
    basename,
    resolve,
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

async function pathInfo(path: string): Promise<EngineVPathInfo> {
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

async function listDir(path: string): Promise<EngineVDirEntry[]> {
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

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function safeStat(path: string) {
  try {
    return await stat(path)
  } catch {
    return null
  }
}

async function runCommand(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveResult) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      const code = typeof (error as { code?: unknown } | null)?.code === "number" ? (error as { code: number }).code : error ? 1 : 0
      resolveResult({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") })
    })
  })
}
