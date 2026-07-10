import { execFile } from "node:child_process"
import { access } from "node:fs/promises"
import { constants } from "node:fs"

import type { AudiovCommandPlan, AudiovCommandResult, AudiovRuntime } from "./core.js"

export function createNodeAudiovRuntime(): AudiovRuntime {
  return {
    findFfmpeg,
    runCommand,
  }
}

async function findFfmpeg(): Promise<string | null> {
  const configured = process.env.AUDIOV_FFMPEG_PATH?.trim()
  if (configured && await isFile(configured)) return configured

  const locator = process.platform === "win32" ? "where.exe" : "which"
  const result = await exec(locator, ["ffmpeg"])
  if (result.code !== 0) return null
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null
}

async function runCommand(plan: AudiovCommandPlan): Promise<AudiovCommandResult> {
  const startedAt = Date.now()
  const result = await exec(plan.command, plan.args)
  return {
    ...result,
    durationMs: Date.now() - startedAt,
  }
}

async function exec(command: string, args: string[]): Promise<Omit<AudiovCommandResult, "durationMs">> {
  return new Promise((resolveResult) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 1024 * 1024 * 32, encoding: "utf8" }, (error, stdout, stderr) => {
      const code = typeof (error as { code?: unknown } | null)?.code === "number"
        ? (error as { code: number }).code
        : error ? 1 : 0
      resolveResult({
        code,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? (error instanceof Error ? error.message : "")),
      })
    })
  })
}

async function isFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}
