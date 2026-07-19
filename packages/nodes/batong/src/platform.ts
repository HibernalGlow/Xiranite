import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { BatongCommandPlan, BatongCommandResult, BatongRuntime } from "./core.js"

const execFileAsync = promisify(execFile)

export function createNodeBatongRuntime(): BatongRuntime {
  return { findCommand, runCommand }
}

export async function findCommand(): Promise<string | undefined> {
  const configured = process.env.BATON_PATH?.trim()
  if (configured) return configured
  const locator = process.platform === "win32" ? "where.exe" : "which"
  const result = await execute(locator, ["baton"])
  return result.code === 0 ? result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) : undefined
}

async function runCommand(plan: BatongCommandPlan): Promise<BatongCommandResult> {
  const startedAt = Date.now()
  const result = await execute(plan.command, plan.args)
  return { ...result, durationMs: Date.now() - startedAt }
}

async function execute(command: string, args: string[]): Promise<Omit<BatongCommandResult, "durationMs">> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 64,
      encoding: "utf8",
    })
    return { code: 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") }
  } catch (error) {
    const commandError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
    return {
      code: typeof commandError.code === "number" ? commandError.code : 1,
      stdout: String(commandError.stdout ?? ""),
      stderr: String(commandError.stderr ?? commandError.message ?? ""),
    }
  }
}
