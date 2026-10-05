import { hostCapabilities } from "@xiranite/host-capabilities"
import type { MvzCommandResult, MvzRuntime } from "./core.js"

const { path } = hostCapabilities
const { basename, dirname, extname, join } = path

const SEVEN_ZIP_NAMES = ["7z", "7z.exe", "7za", "7za.exe", "7zz", "7zz.exe"]

/**
 * mvz's machine half, through the host capability surface.
 *
 * 7-Zip is driven entirely through `proc.exec`, so a non-zero exit stays a value (`MvzCommandResult.code`)
 * rather than an exception — that is the host's rule as much as the node's. The 16 MiB `maxBuffer` the old
 * `execFile` call allowed is the host's 1 MiB per stream now.
 */
export function createNodeMvzRuntime(): MvzRuntime {
  const { fs } = hostCapabilities
  return {
    find7z,
    runCommand,
    exists,
    ensureDir: (path) => fs.ensureDir(path),
    dirname,
    basename,
    extname,
    join,
  }
}

export async function readClipboardText(): Promise<string> {
  const { platform } = await hostCapabilities.os.platform()
  if (platform === "win32") {
    const result = await runCommand("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "$ProgressPreference = 'SilentlyContinue'; Get-Clipboard -Raw"])
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

async function find7z(): Promise<string | null> {
  for (const name of SEVEN_ZIP_NAMES) {
    const found = await findOnPath(name)
    if (found) return found
  }

  const { env } = await hostCapabilities.os.platform()
  for (const candidate of [
    "C:\\Program Files\\7-Zip\\7z.exe",
    "C:\\Program Files (x86)\\7-Zip\\7z.exe",
    join(env.LOCALAPPDATA ?? "", "7-Zip", "7z.exe"),
  ]) {
    if (candidate && await exists(candidate)) return candidate
  }
  return null
}

async function exists(path: string): Promise<boolean> {
  return (await hostCapabilities.fs.stat(path)) !== null
}

async function findOnPath(command: string): Promise<string | null> {
  const { platform } = await hostCapabilities.os.platform()
  const locator = platform === "win32" ? "where.exe" : "which"
  const result = await runCommand(locator, [command])
  if (result.code !== 0) return null
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null
}

async function runCommand(command: string, args: string[]): Promise<MvzCommandResult> {
  const started = Date.now()
  const result = await hostCapabilities.proc.exec(command, args)
  return {
    // A host-killed child answers `exitCode: null`, and `MvzCommandResult.code` has no null arm.
    code: result.exitCode ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: Date.now() - started,
  }
}
