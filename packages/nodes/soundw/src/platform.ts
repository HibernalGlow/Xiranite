import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { stat } from "node:fs/promises"
import type { SoundwRuntime } from "./core.js"
const exec = promisify(execFile)
export function createNodeSoundwRuntime(): SoundwRuntime { return { resolve, run } }
async function resolve(path?: string) {
  if (path) {
    try { await stat(path); return { found: true, path } } catch { return { found: false, path: "" } }
  }
  const binary = process.platform === "win32" ? "SoundSwitch.CLI.exe" : "SoundSwitch.CLI"
  try {
    const { stdout } = await exec(process.platform === "win32" ? "where.exe" : "which", [binary], { timeout: 2_000, windowsHide: true })
    return { found: true, path: stdout.split(/\r?\n/).find(Boolean)?.trim() || binary }
  } catch { return { found: false, path: "" } }
}
async function run(path: string, args: string[]) {
  try {
    const { stdout, stderr } = await exec(path, args, { timeout: 15_000, windowsHide: true })
    return { code: 0, stdout, stderr }
  } catch (error) {
    const item = error as { code?: number; stdout?: string; stderr?: string; message: string; killed?: boolean }
    return { code: item.code ?? 1, stdout: item.stdout ?? "", stderr: item.killed ? "SoundSwitch CLI did not respond within 15 seconds." : item.stderr ?? item.message }
  }
}
