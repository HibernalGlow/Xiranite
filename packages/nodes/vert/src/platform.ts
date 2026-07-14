import { execFile } from "node:child_process"
import { access } from "node:fs/promises"
import { constants } from "node:fs"
import type { VertCapabilities, VertCommandPlan, VertCommandResult, VertRuntime } from "./core.js"

export function createNodeVertRuntime(): VertRuntime {
  return { discoverCommands, runCommand, pathExists }
}

async function discoverCommands(): Promise<VertCapabilities> {
  const [ffmpeg, magick, pandoc] = await Promise.all([
    findCommand("ffmpeg", "VERT_FFMPEG_PATH"),
    findCommand("magick", "VERT_MAGICK_PATH"),
    findCommand("pandoc", "VERT_PANDOC_PATH"),
  ])
  return { wasm: true, ...(ffmpeg ? { ffmpeg } : {}), ...(magick ? { magick } : {}), ...(pandoc ? { pandoc } : {}) }
}

async function findCommand(name: string, envName: string): Promise<string | undefined> {
  const configured = process.env[envName]?.trim()
  if (configured && await pathExists(configured)) return configured
  const locator = process.platform === "win32" ? "where.exe" : "which"
  const result = await execute(locator, [name])
  return result.code === 0 ? result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) : undefined
}

async function runCommand(plan: VertCommandPlan): Promise<VertCommandResult> {
  const startedAt = Date.now()
  const result = await execute(plan.command, plan.args)
  return { ...result, durationMs: Date.now() - startedAt }
}

async function execute(command: string, args: string[]): Promise<Omit<VertCommandResult, "durationMs">> {
  return await new Promise((resolveResult) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 1024 * 1024 * 64, encoding: "utf8" }, (error, stdout, stderr) => {
      const code = typeof (error as { code?: unknown } | null)?.code === "number" ? (error as { code: number }).code : error ? 1 : 0
      resolveResult({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? (error instanceof Error ? error.message : "")) })
    })
  })
}

async function pathExists(path: string): Promise<boolean> {
  try { await access(path, constants.F_OK); return true } catch { return false }
}

export async function readClipboardText(): Promise<string> {
  if (process.platform === "win32") {
    const result = await execute("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"])
    return result.code === 0 ? result.stdout.trim() : ""
  }
  const command = process.platform === "darwin" ? ["pbpaste"] : ["wl-paste"]
  const result = await execute(command[0]!, command.slice(1))
  return result.code === 0 ? result.stdout.trim() : ""
}
