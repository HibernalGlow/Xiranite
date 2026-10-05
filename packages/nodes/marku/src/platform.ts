import { hostCapabilities } from "@xiranite/host-capabilities"
import { resolveXiraniteConfigPath } from "@xiranite/config"
import type { MarkuDirEntry, MarkuPathInfo, MarkuRuntime } from "./core.js"

const { path } = hostCapabilities
const { basename, dirname, join, resolve } = path

/**
 * marku's machine half, through the host capability surface (ADR-0079).
 *
 * The clipboard probe is `proc.exec` now: a non-zero exit is a value rather than a throw there, which is
 * what `runCommand` already modelled, and a program that is not installed at all is what keeps the Linux
 * candidate loop walking.
 *
 * `readText` no longer turns every failure into `null` the way the old `try { readFile } catch { null }`
 * did: in both transports "no document" is the `null` answer and a real failure is an error, which is what
 * the host's `fs.readText` arm does (`filesystem.rs:394-412`). `writeText` keeps creating the parent
 * directory because both transports do what `mkdir(dirname)` + `writeFile` did.
 */
export function createNodeMarkuRuntime(): MarkuRuntime {
  const { fs } = hostCapabilities
  return {
    pathInfo,
    listDir: async (path) =>
      (await fs.list(path)).map((entry): MarkuDirEntry => ({
        name: entry.name,
        path: entry.path,
        isFile: entry.kind === "file",
        isDirectory: entry.kind === "dir",
      })),
    readText: (path) => fs.readText(path),
    writeText: (path, content) => fs.writeText(path, content),
    join,
    dirname,
    basename,
    // `MarkuRuntime` asks for a synchronous `Date` and a synchronous id (`core.ts:104-105`), so neither of
    // these can be the async `clock.now()` / `crypto.uuid()` capabilities without changing that contract.
    now: () => new Date(),
    randomId: () => crypto.randomUUID().slice(0, 8),
    defaultHistoryPath: () => defaultMarkuHistoryPath(),
  }
}

/**
 * Resolve the default marku undo history JSON path.
 *
 * Lives under the Xiranite data directory (derived from the resolved
 * xiranite.config.toml location) at `artifacts/undo/marku.undo.json`.
 * The `--historyPath` CLI flag and the `[nodes.marku].history_path` TOML
 * field both take precedence over this default.
 */
export function defaultMarkuHistoryPath(): string {
  const configPath = resolveXiraniteConfigPath()
  const dataDir = dirname(configPath)
  return join(dataDir, "artifacts", "undo", "marku.undo.json")
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
    // `exitCode: null` means the host killed the child; the old callback reported that as `1` too.
    return { code: result.exitCode ?? 1, stdout: result.stdout }
  } catch {
    // A missing binary is what this probe expects on a machine without that clipboard tool: both
    // transports reject the launch, and the caller must keep walking its candidates instead of failing.
    return { code: 1, stdout: "" }
  }
}

async function pathInfo(path: string): Promise<MarkuPathInfo> {
  const { fs } = hostCapabilities
  const resolved = resolve(path)
  const info = await fs.stat(resolved)
  return { path: resolved, exists: info !== null, isFile: info?.kind === "file", isDirectory: info?.kind === "dir" }
}
