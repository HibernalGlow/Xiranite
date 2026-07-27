import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import type { NodeRunEvent } from "@xiranite/contract"
import { applyWindowsShellPlan, createNodeWindowsRegistryAdapter } from "@xiranite/shell-integration"
import type { OwithuAction, OwithuApplyResult, OwithuRegistryPlanItem, OwithuRuntime } from "./core.js"

export function createNodeOwithuRuntime(): OwithuRuntime {
  return {
    readConfig: (path: string) => readFile(path, "utf8"),
    applyRegistryPlan,
  }
}

export async function readClipboardText(): Promise<string> {
  if (process.platform === "win32") {
    const result = await runCommand("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "$ProgressPreference = 'SilentlyContinue'; Get-Clipboard -Raw",
    ])
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

interface CommandResult {
  code: number
  stdout: string
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return await new Promise((resolve) => {
    execFile(command, args, { encoding: "utf8", windowsHide: true }, (error, stdout) => {
      const code = typeof (error as NodeJS.ErrnoException | null)?.code === "number" ? Number((error as NodeJS.ErrnoException).code) : error ? 1 : 0
      resolve({ code, stdout: stdout ?? "" })
    })
  })
}

async function applyRegistryPlan(
  plan: OwithuRegistryPlanItem[],
  action: Extract<OwithuAction, "register" | "unregister">,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<OwithuApplyResult> {
  if (process.platform !== "win32") {
    return {
      successCount: 0,
      failedCount: plan.length,
      errors: ["Registry operations are only available on Windows."],
    }
  }

  const errors: string[] = []
  const result = await applyWindowsShellPlan(createNodeWindowsRegistryAdapter(), plan, action, (index, item) => {
    onEvent({ type: "progress", progress: Math.round((index / Math.max(plan.length, 1)) * 100), message: `${action} ${item.registryPath}` })
  })
  errors.push(...result.errors)
  onEvent({ type: "progress", progress: 100, message: `${action} completed.` })

  return {
    successCount: result.successCount,
    failedCount: result.failedCount,
    errors,
  }
}
