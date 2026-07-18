import { execFile } from "node:child_process"
import { promisify } from "node:util"

import type {
  ReaderExplorerContextMenuHive,
  ReaderExplorerContextMenuPlanItem,
  ReaderExplorerContextMenuPreview,
  ReaderExplorerContextMenuProvider,
  ReaderExplorerContextMenuRegistration,
  ReaderExplorerContextMenuScope,
  ReaderExplorerContextMenuStatus,
} from "../../ports/ReaderExplorerContextMenuProvider.js"

const execFileAsync = promisify(execFile)
const DEFAULT_REGISTRATION: ReaderExplorerContextMenuRegistration = {
  key: "xiranite",
  label: "Open with Xiranite",
  executable: process.execPath,
  arguments: ["inspect", "%1"],
  scopes: ["file"],
  hives: ["HKCU"],
}

export interface WindowsReaderExplorerContextMenuProviderOptions {
  platform?: NodeJS.Platform
  registration?: Partial<ReaderExplorerContextMenuRegistration>
  runReg?: (args: readonly string[], signal?: AbortSignal) => Promise<RegistryCommandResult>
}

export interface RegistryCommandResult {
  code: number
  stdout: string
  stderr: string
}

export class WindowsReaderExplorerContextMenuProvider implements ReaderExplorerContextMenuProvider {
  readonly #platform: NodeJS.Platform
  readonly #registration: ReaderExplorerContextMenuRegistration
  readonly #runReg: (args: readonly string[], signal?: AbortSignal) => Promise<RegistryCommandResult>

  constructor(options: WindowsReaderExplorerContextMenuProviderOptions = {}) {
    this.#platform = options.platform ?? process.platform
    this.#registration = normalizeRegistration({ ...DEFAULT_REGISTRATION, ...options.registration })
    this.#runReg = options.runReg ?? runReg
  }

  async preview(signal?: AbortSignal): Promise<ReaderExplorerContextMenuPreview> {
    signal?.throwIfAborted()
    if (this.#platform !== "win32") return unavailablePreview()
    const plan = buildPlan(this.#registration)
    return {
      available: true,
      plan,
      registryFile: renderRegistryFile(plan),
    }
  }

  async status(signal?: AbortSignal): Promise<ReaderExplorerContextMenuStatus> {
    signal?.throwIfAborted()
    if (this.#platform !== "win32") return unavailableStatus()

    const plan = buildPlan(this.#registration)
    if (!plan.length) return { available: false, enabled: false, reason: "No Explorer context-menu registration entries are configured." }

    try {
      for (const item of plan) {
        signal?.throwIfAborted()
        const result = await this.#runReg(["query", item.registryPath], signal)
        if (result.code !== 0) return { available: true, enabled: false }
      }
      return { available: true, enabled: true }
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      return unavailableStatus(errorMessage(error))
    }
  }

  async setEnabled(enabled: boolean, signal?: AbortSignal): Promise<ReaderExplorerContextMenuStatus> {
    signal?.throwIfAborted()
    if (this.#platform !== "win32") return unavailableStatus()

    const plan = buildPlan(this.#registration)
    if (!plan.length) return { available: false, enabled: false, reason: "No Explorer context-menu registration entries are configured." }

    const errors: string[] = []
    for (const item of plan) {
      signal?.throwIfAborted()
      try {
        if (enabled) await registerItem(item, this.#runReg, signal)
        else await unregisterItem(item, this.#runReg, signal)
      } catch (error) {
        if (signal?.aborted) throw signal.reason
        errors.push(`${item.registryPath}: ${errorMessage(error)}`)
      }
    }
    if (errors.length) return { available: false, enabled: false, reason: errors.join("; ") }
    return { available: true, enabled }
  }
}

export function buildReaderExplorerContextMenuPlan(
  registration: ReaderExplorerContextMenuRegistration,
): readonly ReaderExplorerContextMenuPlanItem[] {
  return buildPlan(normalizeRegistration(registration))
}

export function renderReaderExplorerContextMenuRegistryFile(
  plan: readonly ReaderExplorerContextMenuPlanItem[],
): string {
  return renderRegistryFile(plan)
}

function buildPlan(registration: ReaderExplorerContextMenuRegistration): readonly ReaderExplorerContextMenuPlanItem[] {
  const args = registration.arguments ?? ["%1"]
  const scopes = registration.scopes ?? ["file"]
  const hives = registration.hives ?? ["HKCU"]
  const icon = registration.icon ?? registration.executable
  const plan: ReaderExplorerContextMenuPlanItem[] = []
  for (const hive of hives) {
    for (const scope of scopes) {
      const scopedArgs = args.map((arg) => arg === "%1" && scope !== "file" ? "%V" : arg)
      plan.push({
        entryKey: registration.key,
        hive,
        scope,
        registryPath: registryPath(hive, registration.key, scope),
        label: registration.label,
        icon,
        command: buildCommand(registration.executable, scopedArgs),
        enabled: true,
      })
    }
  }
  return plan
}

async function registerItem(
  item: ReaderExplorerContextMenuPlanItem,
  runRegCommand: (args: readonly string[], signal?: AbortSignal) => Promise<RegistryCommandResult>,
  signal?: AbortSignal,
): Promise<void> {
  await requireSuccess(await runRegCommand(["add", item.registryPath, "/ve", "/d", item.label, "/f"], signal), item.registryPath)
  await requireSuccess(await runRegCommand(["add", item.registryPath, "/v", "Icon", "/d", item.icon, "/f"], signal), item.registryPath)
  await requireSuccess(await runRegCommand(["add", `${item.registryPath}\\command`, "/ve", "/d", item.command, "/f"], signal), item.registryPath)
}

async function unregisterItem(
  item: ReaderExplorerContextMenuPlanItem,
  runRegCommand: (args: readonly string[], signal?: AbortSignal) => Promise<RegistryCommandResult>,
  signal?: AbortSignal,
): Promise<void> {
  await requireSuccess(await runRegCommand(["delete", item.registryPath, "/f"], signal), item.registryPath)
}

function requireSuccess(result: RegistryCommandResult, path: string): void {
  if (result.code === 0) return
  const detail = result.stderr.trim() || result.stdout.trim() || `reg.exe exited with code ${result.code}`
  throw new Error(detail || `reg.exe failed for ${path}`)
}

function registryPath(hive: ReaderExplorerContextMenuHive, entryKey: string, scope: ReaderExplorerContextMenuScope): string {
  const scopedPath = scope === "file"
    ? `*\\shell\\${entryKey}`
    : scope === "directory"
      ? `Directory\\shell\\${entryKey}`
      : `Directory\\Background\\shell\\${entryKey}`
  if (hive === "HKCU") return `HKCU\\Software\\Classes\\${scopedPath}`
  if (hive === "HKLM") return `HKLM\\Software\\Classes\\${scopedPath}`
  return `HKCR\\${scopedPath}`
}

function buildCommand(executable: string, args: readonly string[]): string {
  const executablePart = executable.startsWith('"') ? executable : `"${executable}"`
  const argumentPart = args.map(quoteArgument).join(" ")
  return argumentPart ? `${executablePart} ${argumentPart}` : executablePart
}

function quoteArgument(argument: string): string {
  if (argument === "%1" || argument === "%V") return `"${argument}"`
  if ((argument.startsWith('"') && argument.endsWith('"')) || !/\s/u.test(argument)) return argument
  return `"${argument}"`
}

function renderRegistryFile(plan: readonly ReaderExplorerContextMenuPlanItem[]): string {
  const lines = ["Windows Registry Editor Version 5.00", ""]
  for (const item of plan) {
    lines.push(`[${registryFilePath(item.registryPath)}]`)
    lines.push(`@="${escapeRegistryValue(item.label)}"`)
    lines.push(`"Icon"="${escapeRegistryValue(item.icon)}"`)
    lines.push("")
    lines.push(`[${registryFilePath(`${item.registryPath}\\command`)}]`)
    lines.push(`@="${escapeRegistryValue(item.command)}"`)
    lines.push("")
  }
  return `${lines.join("\r\n")}\r\n`
}

function registryFilePath(path: string): string {
  const [hive, ...rest] = path.split("\\")
  const fullHive = hive === "HKCU"
    ? "HKEY_CURRENT_USER"
    : hive === "HKLM"
      ? "HKEY_LOCAL_MACHINE"
      : "HKEY_CLASSES_ROOT"
  return `${fullHive}\\${rest.join("\\")}`
}

function escapeRegistryValue(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')
}

function normalizeRegistration(
  registration: ReaderExplorerContextMenuRegistration,
): ReaderExplorerContextMenuRegistration {
  const key = registration.key.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(key)) throw new Error("Explorer context-menu key must be a simple registry identifier.")
  const executable = registration.executable.trim()
  if (!executable) throw new Error("Explorer context-menu executable is required.")
  const scopes = [...new Set<ReaderExplorerContextMenuScope>(registration.scopes ?? ["file"])]
  const hives = [...new Set<ReaderExplorerContextMenuHive>(registration.hives ?? ["HKCU"])]
  for (const scope of scopes) if (scope !== "file" && scope !== "directory" && scope !== "background") throw new Error(`Unsupported Explorer context-menu scope: ${scope}`)
  for (const hive of hives) if (hive !== "HKCU" && hive !== "HKCR" && hive !== "HKLM") throw new Error(`Unsupported Explorer context-menu hive: ${hive}`)
  return {
    key,
    label: registration.label?.trim() || key,
    executable,
    arguments: registration.arguments ? [...registration.arguments] : ["%1"],
    icon: registration.icon?.trim() || executable,
    scopes,
    hives,
  }
}

async function runReg(args: readonly string[], signal?: AbortSignal): Promise<RegistryCommandResult> {
  signal?.throwIfAborted()
  try {
    const result = await execFileAsync("reg.exe", [...args], { windowsHide: true, encoding: "utf8" })
    signal?.throwIfAborted()
    return { code: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    signal?.throwIfAborted()
    const typed = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
    return {
      code: typeof typed.code === "number" ? typed.code : 1,
      stdout: typed.stdout ?? "",
      stderr: typed.stderr ?? typed.message ?? String(error),
    }
  }
}

function unavailableStatus(reason = "Explorer context-menu registration is only available on Windows."): ReaderExplorerContextMenuStatus {
  return { available: false, enabled: false, reason }
}

function unavailablePreview(): ReaderExplorerContextMenuPreview {
  return { available: false, plan: [], registryFile: "", reason: "Explorer context-menu registration is only available on Windows." }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
