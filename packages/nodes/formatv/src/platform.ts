import { hostCapabilities, type ExecResult } from "@xiranite/host-capabilities"
import type { FormatvDirEntry, FormatvPathInfo, FormatvRuntime } from "./core.js"

/**
 * formatv's machine half, through the host capability surface (ADR-0079).
 *
 * Path arithmetic comes from the surface's `path` group rather than a `node:path` import: it is not a host
 * operation, but in a bundle that group is the realm implementation. The two `mkdir` calls that used to
 * sit in this file are not both reproduced — the host's `fs.writeText` creates the parent directory as part of
 * the write, while `fs.move` owns only the cross-volume fallback, so the parent ensure before a rename stays
 * explicit.
 */
const { fs, proc, os, path } = hostCapabilities
const { basename, dirname, join, resolve } = path

export function createNodeFormatvRuntime(): FormatvRuntime {
  return {
    pathInfo,
    listDir,
    renamePath,
    writeText,
    join,
    dirname,
    basename,
  }
}

export async function readClipboardText(): Promise<string> {
  const { platform } = await os.platform()

  if (platform === "win32") {
    const result = await runCommand("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "$ProgressPreference = 'SilentlyContinue'; Get-Clipboard -Raw"])
    return result.exitCode === 0 ? result.stdout.trim() : ""
  }

  if (platform === "darwin") {
    const result = await runCommand("pbpaste", [])
    return result.exitCode === 0 ? result.stdout.trim() : ""
  }

  for (const command of [["wl-paste"], ["xclip", "-selection", "clipboard", "-o"], ["xsel", "--clipboard", "--output"]]) {
    const result = await runCommand(command[0], command.slice(1))
    if (result.exitCode === 0 && result.stdout.trim()) return result.stdout.trim()
  }
  return ""
}

/**
 * `proc.exec` already reports a non-zero exit as a value. The one case it rejects is a program that could not
 * be started, which Node's `execFile` callback had answered as `code 1` — `readClipboardText` reads that as
 * "this clipboard tool is absent" and moves on, so the rejection is folded back into a result here.
 */
async function runCommand(command: string, args: string[]): Promise<ExecResult> {
  try {
    return await proc.exec(command, args)
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      truncated: false,
    }
  }
}

async function pathInfo(path: string): Promise<FormatvPathInfo> {
  const resolved = resolve(path)
  const info = await fs.stat(resolved)
  return {
    path: resolved,
    exists: info !== null,
    isFile: info?.kind === "file",
    isDirectory: info?.kind === "dir",
    size: info?.sizeBytes ?? 0,
  }
}

async function listDir(path: string): Promise<FormatvDirEntry[]> {
  return (await fs.list(path)).map((entry) => ({
    name: entry.name,
    path: entry.path,
    isFile: entry.kind === "file",
    isDirectory: entry.kind === "dir",
  }))
}

async function renamePath(source: string, target: string): Promise<void> {
  await fs.ensureDir(dirname(target))
  await fs.move(source, target)
}

async function writeText(path: string, content: string): Promise<void> {
  await fs.writeText(path, content)
}
