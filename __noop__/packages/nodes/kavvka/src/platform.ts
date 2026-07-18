import { execFile } from "node:child_process"
import { cp, lstat, mkdir, readdir, rename, rm } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import type { KavvkaDirEntry, KavvkaPathInfo, KavvkaRuntime } from "./core.js"

export function createNodeKavvkaRuntime(): KavvkaRuntime {
  return {
    pathInfo,
    listDir,
    ensureDir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
    movePath,
    join,
    dirname,
    basename,
    normalize: (path) => resolve(path),
    now: () => new Date(),
  }
}

export async function readClipboardText(): Promise<string> {
  if (process.platform === "win32") {
    const result = await runCommand("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "$ProgressPreference = 'SilentlyContinue'; Get-Clipboard -Raw"])
    return result.code === 0 ? result.stdout.trim() : ""
  }

  if (process.platform === "darwin") {
    const result = await runCommand("pbpaste", [])
    return result.code === 0 ? result.stdout.trim() : ""
  }

  for (const command of [["wl-paste"], ["xclip", "-selection", "clipboard", "-o"], ["xsel", "--clipboard", "--output"]]) {
    const result = await runCommand(command[0], command.slice(1))
    if (result.code === 0 && result.stdout.trim()) return result.stdout.trim()
  }
  return ""
}

interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 1024 * 1024 * 32, encoding: "utf8" }, (error, stdout, stderr) => {
      const code = typeof (error as { code?: unknown } | null)?.code === "number" ? (error as { code: number }).code : error ? 1 : 0
      resolveResult({
        code,
        stdout: stdout ?? "",
        stderr: stderr ?? (error instanceof Error ? error.message : ""),
      })
    })
  })
}

async function pathInfo(path: string): Promise<KavvkaPathInfo> {
  const resolved = resolve(path)
  try {
    const stat = await lstat(resolved)
    return { path: resolved, exists: true, isFile: stat.isFile(), isDirectory: stat.isDirectory() }
  } catch {
    return { path: resolved, exists: false, isFile: false, isDirectory: false }
  }
}

async function listDir(path: string): Promise<KavvkaDirEntry[]> {
  const entries = await readdir(resolve(path), { withFileTypes: true })
  return entries.map((entry) => ({
    name: entry.name,
    path: join(resolve(path), entry.name),
    isDirectory: entry.isDirectory(),
    isFile: entry.isFile(),
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
