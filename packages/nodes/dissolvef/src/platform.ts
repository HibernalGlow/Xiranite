import { hostCapabilities } from "@xiranite/host-capabilities"
import { resolveXiraniteConfigPath } from "@xiranite/config"
import type { DissolvefDirEntry, DissolvefPathInfo, DissolvefRuntime } from "./core.js"

const { path } = hostCapabilities
const { basename, dirname, join, resolve } = path

/**
 * dissolvef's machine half, through the host capability surface (ADR-0079).
 *
 * dissolvef writes into the **parent** of the directory it dissolves, so every target path here stays
 * exactly as the plan spelled it and the parent-directory `ensureDir` before a move stays explicit: the
 * host owns the cross-volume fallback in `fs.move`, and `targetsReachable` (`core.ts:494-501`) pre-flights
 * those same parents so a refusal lands before anything moves.
 *
 * `now` and `randomId` stay synchronous because `DissolvefRuntime` declares them that way
 * (`core.ts:108-109`); `crypto.randomUUID()` in a realm is the pinned `crypto.randomUUID` host operation,
 * not a local generator, and `clock.now()`/`crypto.uuid()` are both promises.
 */
export function createNodeDissolvefRuntime(): DissolvefRuntime {
  const { fs } = hostCapabilities
  return {
    pathInfo,
    listDir,
    ensureDir: (path) => fs.ensureDir(path),
    movePath,
    deletePath,
    // `fs.readText` answers `null` for "no document" and raises a real failure, where the old
    // `try { readFile } catch { null }` swallowed every error into `null`. An absent history file is still
    // `null`, which is the case `parseDissolveHistory` branches on.
    readText: (path) => fs.readText(path),
    writeText: (path, content) => fs.writeText(path, content),
    join,
    dirname,
    basename,
    now: () => new Date(),
    randomId: () => crypto.randomUUID().slice(0, 8),
    defaultHistoryPath: () => {
      const configPath = resolveXiraniteConfigPath()
      const dataDir = dirname(configPath)
      return join(dataDir, "artifacts", "undo", "dissolvef.undo.json")
    },
  }
}

/**
 * The clipboard probe, through `proc.exec`.
 *
 * Which programs this node may run is the manifest's decision (`docs/xiranite-target-node-manifest.json`),
 * not this file's; an undeclared program is refused by the host and that refusal lands in the same
 * "nothing from this backend" answer a missing binary already gave.
 */
export async function readClipboardText(): Promise<string> {
  const { os } = hostCapabilities
  const platform = (await os.platform()).platform

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

interface CommandResult {
  code: number
  stdout: string
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  const { proc } = hostCapabilities
  try {
    const result = await proc.exec(command, args)
    // `exitCode: null` means the host killed the child; the old `execFile` callback reported that as `1` too.
    return { code: result.exitCode ?? 1, stdout: result.stdout }
  } catch {
    // A missing binary is what this probe expects on a machine without that clipboard helper: both
    // transports reject the launch, and the caller must keep walking its candidates instead of failing.
    return { code: 1, stdout: "" }
  }
}

async function pathInfo(path: string): Promise<DissolvefPathInfo> {
  const { fs } = hostCapabilities
  const resolved = resolve(path)
  const info = await fs.stat(resolved)
  return {
    path: resolved,
    exists: info !== null,
    isFile: info?.kind === "file",
    isDirectory: info?.kind === "dir",
  }
}

async function listDir(path: string): Promise<DissolvefDirEntry[]> {
  const { fs } = hostCapabilities
  return (await fs.list(path)).map((entry) => ({
    name: entry.name,
    path: entry.path,
    isFile: entry.kind === "file",
    isDirectory: entry.kind === "dir",
  }))
}

async function movePath(source: string, target: string): Promise<void> {
  const { fs } = hostCapabilities
  await fs.ensureDir(dirname(target))
  await fs.move(source, target)
}

/**
 * One delete, recursive or not, with the non-empty refusal left to the host.
 *
 * The old `rmdir`/`rm` split existed only because Node names those two ways; `fs.delete` takes the flag
 * directly and refuses a directory that still has content either way (`filesystem.rs:368-390`).
 */
async function deletePath(path: string, recursive = false): Promise<void> {
  const { fs } = hostCapabilities
  await fs.remove(path, { recursive })
}
