import { hostCapabilities } from "@xiranite/host-capabilities"
import { basename, dirname, join, resolve } from "node:path"
import { resolveXiraniteConfigPath } from "@xiranite/config"
import type { TrenameDirEntry, TrenamePathInfo, TrenameRuntime } from "./core.js"

/**
 * trename's machine half, through the host capability surface (ADR-0078).
 *
 * Two reads stay behind on purpose. `now` and `randomId` are synchronous in `TrenameRuntime`
 * (`core.ts:84-85`), so they cannot be the async `clock.now()` / `crypto.uuid()` capabilities without
 * changing that contract; `randomId` keeps `crypto.randomUUID()`, which in a realm is the pinned
 * `crypto.randomUUID` host operation and not a local generator.
 *
 * The old `pathInfo` followed a final symlink (Node's `stat`) while the host's `fs.stat` answers the link
 * itself (`filesystem.rs:257-300`, the `lstat` arm the nodes were pinned to). trename only branches on
 * `exists`/`isDirectory`, and `createdMs` has no reader — the host's `FileStat` carries no birth time, so
 * the field now answers `0` rather than a value borrowed from `atime`.
 */
export function createNodeTrenameRuntime(): TrenameRuntime {
  const { fs } = hostCapabilities
  return {
    pathInfo,
    listDir,
    // `TrenameRuntime.readText` promises a string, so the capability's `null` for "no document" has to go
    // back to being the error `readFile` raised. Its only caller (`core.ts:715-717`) checks `pathInfo`
    // first, which is why this arm never fires in a real run.
    readText: async (path) => {
      const text = await fs.readText(path)
      if (text === null) throw new Error(`Undo store could not be read: ${path}`)
      return text
    },
    writeText: (path, content) => fs.writeText(path, content),
    ensureDir: (path) => fs.ensureDir(path),
    movePath,
    join,
    dirname,
    basename,
    resolve,
    defaultUndoPath: () => defaultTrenameUndoPath(),
    now: () => new Date().toISOString(),
    randomId: () => crypto.randomUUID(),
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
  const { fs } = hostCapabilities
  const resolved = resolve(path)
  const info = await fs.stat(resolved)
  if (info === null) {
    return { path: resolved, exists: false, isFile: false, isDirectory: false, size: 0, createdMs: 0, modifiedMs: 0 }
  }
  return {
    path: resolved,
    exists: true,
    isFile: info.kind === "file",
    isDirectory: info.kind === "dir",
    size: info.sizeBytes ?? 0,
    createdMs: 0,
    modifiedMs: info.mtimeMs ?? 0,
  }
}

async function listDir(path: string): Promise<TrenameDirEntry[]> {
  const { fs } = hostCapabilities
  const resolved = resolve(path)
  const entries = await fs.list(resolved)
  const listed: TrenameDirEntry[] = []
  for (const entry of entries) {
    // Only a plain file has a size worth reporting, so the old per-entry `stat` collapses to one `fs.stat`
    // on exactly those entries.
    const info = entry.kind === "file" ? await fs.stat(entry.path) : null
    listed.push({
      name: entry.name,
      path: entry.path,
      isFile: entry.kind === "file",
      isDirectory: entry.kind === "dir",
      size: info?.sizeBytes ?? 0,
    })
  }
  return listed
}

/**
 * The rename, with the target's parent made first.
 *
 * Both transports' `fs.move` creates that parent as well (`filesystem.rs:357-360`), so the explicit
 * `ensureDir` is kept for the order the old body had: `apply` and `undo` plan into folders that may not
 * exist yet (`core.ts:454-455`, `core.ts:505-506`), and the call is idempotent.
 */
async function movePath(source: string, target: string): Promise<void> {
  const { fs } = hostCapabilities
  await fs.ensureDir(dirname(target))
  await fs.move(source, target)
}

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
    return { code: result.exitCode ?? 1, stdout: result.stdout }
  } catch {
    // A missing binary is what this probe expects on a machine without that clipboard helper: both
    // transports reject the launch, and the caller must keep walking its candidates instead of failing.
    return { code: 1, stdout: "" }
  }
}
