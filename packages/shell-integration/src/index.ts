import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export type WindowsShellScope = "file" | "directory" | "background"
export type WindowsRegistryHive = "HKCU" | "HKCR" | "HKLM"

export interface WindowsShellPlanItem {
  registryPath: string
  label: string
  icon: string
  command: string
}

export interface WindowsRegistryCommandResult {
  code: number
  stdout: string
  stderr: string
}

export interface WindowsRegistryAdapter {
  run(args: readonly string[], signal?: AbortSignal): Promise<WindowsRegistryCommandResult>
}

export interface WindowsShellApplyResult {
  successCount: number
  failedCount: number
  errors: string[]
}

/** Quotes argv without involving cmd.exe. Explorer placeholders stay quoted. */
export function buildWindowsShellCommand(executable: string, args: readonly string[]): string {
  const normalizedExecutable = normalizeExecutable(executable)
  const argumentsText = args.map(quoteWindowsCommandArgument).join(" ")
  return argumentsText ? `${quoteWindowsCommandArgument(normalizedExecutable)} ${argumentsText}` : quoteWindowsCommandArgument(normalizedExecutable)
}

export function legacyWindowsShellRegistryPath(hive: WindowsRegistryHive, entryKey: string, scope: WindowsShellScope): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(entryKey)) throw new Error("Shell entry key must be a simple registry identifier.")
  const path = scope === "file"
    ? `*\\shell\\${entryKey}`
    : scope === "directory"
      ? `Directory\\shell\\${entryKey}`
      : `Directory\\Background\\shell\\${entryKey}`
  if (hive === "HKCU") return `HKCU\\Software\\Classes\\${path}`
  if (hive === "HKLM") return `HKLM\\Software\\Classes\\${path}`
  return `HKCR\\${path}`
}

/** Applies an explicit legacy plan such as Owithu's user-authored TOML entry. */
export async function applyWindowsShellPlan(
  adapter: WindowsRegistryAdapter,
  plan: readonly WindowsShellPlanItem[],
  action: "register" | "unregister",
  onProgress?: (index: number, item: WindowsShellPlanItem) => void,
): Promise<WindowsShellApplyResult> {
  const errors: string[] = []
  let successCount = 0
  for (const [index, item] of plan.entries()) {
    onProgress?.(index, item)
    try {
      if (action === "register") await writeWindowsShellPlanItem(adapter, item)
      else await deleteWindowsShellPlanItem(adapter, item)
      successCount += 1
    } catch (cause) {
      errors.push(`${item.registryPath}: ${messageOf(cause)}`)
    }
  }
  return { successCount, failedCount: errors.length, errors }
}

export function createNodeWindowsRegistryAdapter(): WindowsRegistryAdapter {
  return {
    async run(args, signal) {
      try {
        const result = await execFileAsync("reg.exe", [...args], { windowsHide: true, encoding: "utf8", signal })
        return { code: 0, stdout: result.stdout, stderr: result.stderr }
      } catch (cause) {
        const error = cause as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
        return { code: typeof error.code === "number" ? error.code : 1, stdout: error.stdout ?? "", stderr: error.stderr ?? error.message }
      }
    },
  }
}

export function quoteWindowsCommandArgument(value: string): string {
  if (!value.length) return '""'
  if (value === "%1" || value === "%V") return `"${value}"`
  if (!/[\s"]/u.test(value)) return value
  let result = '"'
  let backslashes = 0
  for (const character of value) {
    if (character === "\\") {
      backslashes += 1
      continue
    }
    if (character === '"') {
      result += "\\".repeat(backslashes * 2 + 1)
      result += '"'
      backslashes = 0
      continue
    }
    result += "\\".repeat(backslashes)
    result += character
    backslashes = 0
  }
  result += "\\".repeat(backslashes * 2)
  return `${result}"`
}

async function writeWindowsShellPlanItem(adapter: WindowsRegistryAdapter, item: WindowsShellPlanItem): Promise<void> {
  assertSafePlanItem(item)
  await requireRegistrySuccess(await adapter.run(["add", item.registryPath, "/ve", "/d", item.label, "/f"]), item.registryPath)
  await requireRegistrySuccess(await adapter.run(["add", item.registryPath, "/v", "Icon", "/d", item.icon, "/f"]), item.registryPath)
  await requireRegistrySuccess(await adapter.run(["add", `${item.registryPath}\\command`, "/ve", "/d", item.command, "/f"]), item.registryPath)
}

async function deleteWindowsShellPlanItem(adapter: WindowsRegistryAdapter, item: WindowsShellPlanItem): Promise<void> {
  const result = await adapter.run(["delete", item.registryPath, "/f"])
  if (result.code === 0 || isRegistryNotFound(result)) return
  requireRegistrySuccess(result, item.registryPath)
}

function normalizeExecutable(value: string): string {
  const normalized = value.trim().replace(/^"|"$/gu, "")
  if (!normalized || normalized.includes('"') || /\p{Cc}/u.test(normalized)) throw new Error("Shell executable must be one path without control characters or embedded quotes.")
  return normalized
}

function assertSafePlanItem(item: WindowsShellPlanItem): void {
  if (!item.registryPath || /[\r\n\0]/u.test(item.registryPath)) throw new Error("Shell registry path is unsafe.")
  for (const value of [item.label, item.icon, item.command]) {
    if (!value || /\p{Cc}/u.test(value)) throw new Error("Shell registry values must not contain control characters.")
  }
}

function requireRegistrySuccess(result: WindowsRegistryCommandResult, path: string): void {
  if (result.code === 0) return
  throw new Error(result.stderr.trim() || result.stdout.trim() || `reg.exe failed for ${path}`)
}

function isRegistryNotFound(result: WindowsRegistryCommandResult): boolean {
  return /not found|unable to find|cannot find|specified registry key or value/iu.test(`${result.stdout}\n${result.stderr}`)
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
