import { stat } from "node:fs/promises"
import { hostCapabilities } from "@xiranite/host-capabilities"
import { executeSingleFileMutation, type FileOperationExecutor } from "@xiranite/file-operations"
import { PlatformFileMutationProvider } from "@xiranite/file-operations/platform"
import type { EngineVDirEntry, EngineVPathInfo, EngineVRuntime } from "./core.js"

const { basename, dirname, join, resolve } = hostCapabilities.path

export interface EngineVRuntimeContext {
  fileOperations?: FileOperationExecutor
}

let standaloneFileMutations: PlatformFileMutationProvider | undefined

/**
 * enginev's machine half, through the host capability surface.
 *
 * `pathInfo` is the one call still taken from Node: `EngineVPathInfo.createdMs` comes from the file's birth
 * time, which the host's stat answer does not carry (only atime and mtime), and `core.ts` writes it straight
 * into the wallpaper record. Everything else — listing, moving, copying, deleting, the clipboard probe — is
 * a capability call.
 */
export function createNodeEngineVRuntime(context: EngineVRuntimeContext = {}): EngineVRuntime {
  const { fs } = hostCapabilities
  return {
    pathInfo,
    listDir,
    readJson: async (path) => JSON.parse(await readTextOrThrow(path)) as unknown,
    writeText: (path, content) => fs.writeText(path, content),
    ensureDir: (path) => fs.ensureDir(path),
    movePath,
    copyDir: (source, target) => fs.copy(source, target, { recursive: true, force: false }),
    removePath: (path, options) => removePath(path, options, context.fileOperations),
    join,
    dirname,
    basename,
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
  const { fs } = hostCapabilities
  const resolved = resolve(path)
  const entries = await fs.list(resolved)
  return Promise.all(entries.map(async (entry) => {
    const info = await fs.stat(entry.path)
    return {
      name: entry.name,
      path: entry.path,
      isFile: entry.kind === "file",
      isDirectory: entry.kind === "dir",
      size: info?.kind === "file" ? (info.sizeBytes ?? 0) : 0,
    }
  }))
}

async function movePath(source: string, target: string): Promise<void> {
  const { fs } = hostCapabilities
  // Explicit, and stays explicit: the host's `fs.move` owns the cross-volume fallback, not the destination's
  // parent directory, which the previous implementation created before the rename.
  await fs.ensureDir(dirname(target))
  await fs.move(source, target)
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
  return (await hostCapabilities.fs.stat(path)) !== null
}

/**
 * `fs.readText` answers `null` for an absent document; this adapter's reader threw, and `core.ts` still
 * reports a missing project file through that rejection, so the throw is kept here rather than widened
 * into the runtime interface.
 */
async function readTextOrThrow(path: string): Promise<string> {
  const text = await hostCapabilities.fs.readText(path)
  if (text === null) throw new Error(`ENOENT: no such file or directory, open '${path}'`)
  return text
}

async function runCommand(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await hostCapabilities.proc.exec(command, args)
  return { code: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr }
}
