import { execFile } from "node:child_process"
import { appendFile, mkdir, readFile, stat } from "node:fs/promises"
import { dirname } from "node:path"
import type { CommandResult, SmartZipCommandPlan, SmartZipRuntime } from "./core.js"

export function createNodeSmartZipRuntime(): SmartZipRuntime {
  return {
    readText: (path) => readFile(path, "utf8"),
    appendRecord,
    pathExists,
    runCommand,
  }
}

export const createNodeSmartzipRuntime = createNodeSmartZipRuntime

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function runCommand(plan: SmartZipCommandPlan): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    const child = execFile(plan.command, plan.args, { windowsHide: true }, (error, stdout, stderr) => {
      const code = error && typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 0
      resolveResult({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? (error instanceof Error ? error.message : "")) })
    })
    if (plan.detached) child.unref()
  })
}

async function appendRecord(path: string, record: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8")
}
