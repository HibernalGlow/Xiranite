import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { promisify } from "node:util"
import type { NodeRunEvent } from "@xiranite/contract"
import type { OwithuAction, OwithuApplyResult, OwithuRegistryPlanItem, OwithuRuntime } from "./core.js"

const execFileAsync = promisify(execFile)

export function createNodeOwithuRuntime(): OwithuRuntime {
  return {
    readConfig: (path: string) => readFile(path, "utf8"),
    applyRegistryPlan,
  }
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
  let successCount = 0
  for (let index = 0; index < plan.length; index += 1) {
    const item = plan[index]
    onEvent({ type: "progress", progress: Math.round((index / Math.max(plan.length, 1)) * 100), message: `${action} ${item.registryPath}` })
    try {
      if (action === "register") await registerItem(item)
      else await deleteKey(item.registryPath)
      successCount += 1
    } catch (error) {
      errors.push(`${item.registryPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  onEvent({ type: "progress", progress: 100, message: `${action} completed.` })

  return {
    successCount,
    failedCount: errors.length,
    errors,
  }
}

async function registerItem(item: OwithuRegistryPlanItem): Promise<void> {
  await reg(["add", item.registryPath, "/ve", "/d", item.label, "/f"])
  await reg(["add", item.registryPath, "/v", "Icon", "/d", item.icon, "/f"])
  await reg(["add", `${item.registryPath}\\command`, "/ve", "/d", item.command, "/f"])
}

async function deleteKey(path: string): Promise<void> {
  await reg(["delete", path, "/f"])
}

async function reg(args: string[]): Promise<void> {
  await execFileAsync("reg.exe", args, { windowsHide: true })
}
