import { execFile } from "node:child_process"
import { mkdir, readdir, rename, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import type { FormatvDirEntry, FormatvPathInfo, FormatvRuntime } from "./core.js"

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

async function pathInfo(path: string): Promise<FormatvPathInfo> {
  const resolved = resolve(path)
  try {
    const info = await stat(resolved)
    return { path: resolved, exists: true, isFile: info.isFile(), isDirectory: info.isDirectory(), size: info.size }
  } catch {
    return { path: resolved, exists: false, isFile: false, isDirectory: false, size: 0 }
  }
}

async function listDir(path: string): Promise<FormatvDirEntry[]> {
  const entries = await readdir(path, { withFileTypes: true })
  return entries.map((entry) => ({
    name: entry.name,
    path: join(path, entry.name),
    isFile: entry.isFile(),
    isDirectory: entry.isDirectory(),
  }))
}

async function renamePath(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  await rename(source, target)
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, "utf8")
}
