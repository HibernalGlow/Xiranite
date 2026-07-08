import { execFile } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { CommandResult, JellyPotCommandPlan, JellyPotRuntime } from "./core.js"

export function createNodeJellyPotRuntime(): JellyPotRuntime {
  return {
    readText: (path) => readFile(path, "utf8"),
    pathExists,
    runCommand,
    dirname,
    join,
  }
}

export const createNodeJellypotRuntime = createNodeJellyPotRuntime

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function runCommand(plan: JellyPotCommandPlan): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    const child = execFile(plan.command, plan.args, { windowsHide: true }, (error, stdout, stderr) => {
      const code = error && typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 0
      resolveResult({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? (error instanceof Error ? error.message : "")) })
    })
    if (plan.detached) child.unref()
  })
}
