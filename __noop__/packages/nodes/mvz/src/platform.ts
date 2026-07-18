import { execFile } from "node:child_process"
import { access, mkdir } from "node:fs/promises"
import { constants } from "node:fs"
import { basename, dirname, extname, join } from "node:path"
import type { MvzCommandResult, MvzRuntime } from "./core.js"

const SEVEN_ZIP_NAMES = ["7z", "7z.exe", "7za", "7za.exe", "7zz", "7zz.exe"]

export function createNodeMvzRuntime(): MvzRuntime {
  return {
    find7z,
    runCommand,
    exists,
    ensureDir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
    dirname,
    basename,
    extname,
    join,
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
    const result = await runCommand(command[0]!, command.slice(1))
    if (result.code === 0 && result.stdout.trim()) return result.stdout.trim()
  }
  return ""
}

async function find7z(): Promise<string | null> {
  for (const name of SEVEN_ZIP_NAMES) {
    const found = await findOnPath(name)
    if (found) return found
  }

  for (const candidate of [
    "C:\\Program Files\\7-Zip\\7z.exe",
    "C:\\Program Files (x86)\\7-Zip\\7z.exe",
    join(process.env.LOCALAPPDATA ?? "", "7-Zip", "7z.exe"),
  ]) {
    if (candidate && await exists(candidate)) return candidate
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

async function findOnPath(command: string): Promise<string | null> {
  const locator = process.platform === "win32" ? "where.exe" : "which"
  const result = await runCommand(locator, [command])
  if (result.code !== 0) return null
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null
}

async function runCommand(command: string, args: string[]): Promise<MvzCommandResult> {
  const started = Date.now()
  return new Promise((resolveResult) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 1024 * 1024 * 16 }, (error, stdout, stderr) => {
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
