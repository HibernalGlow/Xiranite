import { execFile } from "node:child_process"
import { appendFile, mkdir, readFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { CommandResult, PackuCommandPlan, PackuToolRuntime } from "./core.js"

export function createNodePackuToolRuntime(): PackuToolRuntime {
  return {
    readText: (path) => readFile(path, "utf8"),
    runCommand,
    appendRecord,
  }
}

async function runCommand(plan: PackuCommandPlan): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    execFile(plan.command, plan.args, {
      cwd: plan.cwd,
      env: { ...process.env, ...plan.env },
      windowsHide: true,
    }, (error, stdout, stderr) => {
      const code = error && typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 0
      resolveResult({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? (error instanceof Error ? error.message : "")) })
    })
  })
}

async function appendRecord(path: string, record: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8")
}
