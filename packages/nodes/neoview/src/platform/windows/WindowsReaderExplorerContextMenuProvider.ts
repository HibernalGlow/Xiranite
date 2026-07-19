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
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"

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
  resourceScheduler?: ResourceScheduler
  ownerId?: string
  runReg?: (args: readonly string[], signal?: AbortSignal) => Promise<RegistryCommandResult>
}

export interface RegistryCommandResult {
  code: number
  stdout: string
  stderr: string
}

interface ExplorerContextMenuOperation {
  readonly signal: AbortSignal
  readonly cleanupSignal: AbortSignal
  readonly done: Promise<void>
  finish(): void
}

export class WindowsReaderExplorerContextMenuProvider implements ReaderExplorerContextMenuProvider, AsyncDisposable {
  readonly #platform: NodeJS.Platform
  readonly #registration: ReaderExplorerContextMenuRegistration
  readonly #resourceScheduler?: ResourceScheduler
  readonly #ownerId: string
  readonly #runReg: (args: readonly string[], signal?: AbortSignal) => Promise<RegistryCommandResult>
  readonly #operations = new Set<ExplorerContextMenuOperationState>()
  #closed = false
  #disposePromise?: Promise<void>

  constructor(options: WindowsReaderExplorerContextMenuProviderOptions = {}) {
    this.#platform = options.platform ?? process.platform
    this.#registration = normalizeRegistration({ ...DEFAULT_REGISTRATION, ...options.registration })
    this.#resourceScheduler = options.resourceScheduler
    this.#ownerId = options.ownerId ?? "neoview:explorer-context-menu"
    this.#runReg = options.runReg ?? runReg
  }

  async preview(signal?: AbortSignal): Promise<ReaderExplorerContextMenuPreview> {
    const operation = this.#begin(signal)
    try {
      if (this.#platform !== "win32") return unavailablePreview()
      const plan = buildPlan(this.#registration)
      return {
        available: true,
        plan,
        registryFile: renderRegistryFile(plan),
      }
    } finally {
      operation.finish()
    }
  }

  async status(signal?: AbortSignal): Promise<ReaderExplorerContextMenuStatus> {
    const operation = this.#begin(signal)
    try {
      if (this.#platform !== "win32") return unavailableStatus()

      const plan = buildPlan(this.#registration)
      if (!plan.length) return { available: false, enabled: false, reason: "No Explorer context-menu registration entries are configured." }

      const lease = await this.#resourceScheduler?.acquire({
        resource: "io",
        kind: "reader.explorer-context-menu.status",
        priority: "interactive",
        ownerId: this.#ownerId,
      }, operation.signal)
      try {
        for (const item of plan) {
          operation.signal.throwIfAborted()
          const result = await this.#runReg(["query", item.registryPath], operation.signal)
          operation.signal.throwIfAborted()
          if (result.code !== 0) return { available: true, enabled: false }
        }
        return { available: true, enabled: true }
      } catch (error) {
        if (operation.signal.aborted) throw operation.signal.reason
        return unavailableStatus(errorMessage(error))
      } finally {
        lease?.release()
      }
    } finally {
      operation.finish()
    }
  }

  async setEnabled(enabled: boolean, signal?: AbortSignal): Promise<ReaderExplorerContextMenuStatus> {
    const operation = this.#begin(signal)
    try {
      if (this.#platform !== "win32") return unavailableStatus()

      const plan = buildPlan(this.#registration)
      if (!plan.length) return { available: false, enabled: false, reason: "No Explorer context-menu registration entries are configured." }

      const lease = await this.#resourceScheduler?.acquire({
        resource: "io",
        kind: "reader.explorer-context-menu.set-enabled",
        priority: "interactive",
        ownerId: this.#ownerId,
      }, operation.signal)
      try {
        const changed: ReaderExplorerContextMenuPlanItem[] = []
        for (const item of plan) {
          try {
            operation.signal.throwIfAborted()
            if (enabled) {
              await registerItem(item, this.#runReg, operation.signal)
            } else {
              const removed = await unregisterItem(item, this.#runReg, operation.signal)
              if (removed) changed.push(item)
            }
            if (enabled) changed.push(item)
          } catch (error) {
            const rollbackItems = enabled
              ? changed.concat(error instanceof RegistryMutationError && error.mutated ? item : [])
              : changed.concat(error instanceof RegistryMutationError && error.mutated ? item : [])
            const rollbackErrors = await rollback(
              enabled ? "disable" : "enable",
              rollbackItems,
              this.#runReg,
              operation.cleanupSignal,
            )
            if (operation.signal.aborted) throw operation.signal.reason
            const details = [`${item.registryPath}: ${errorMessage(error)}`, ...rollbackErrors]
            return { available: false, enabled: false, reason: details.join("; ") }
          }
        }
        return { available: true, enabled }
      } catch (error) {
        if (operation.signal.aborted) throw operation.signal.reason
        return unavailableStatus(errorMessage(error))
      } finally {
        lease?.release()
      }
    } finally {
      operation.finish()
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise
    this.#closed = true
    for (const operation of this.#operations) {
      operation.controller.abort(new DOMException("Explorer context-menu provider disposed.", "AbortError"))
    }
    this.#disposePromise = Promise.all([...this.#operations].map((operation) => operation.done)).then(() => undefined)
    await this.#disposePromise
  }

  #begin(signal?: AbortSignal): ExplorerContextMenuOperation {
    if (this.#closed) throw new Error("Explorer context-menu provider is disposed.")
    signal?.throwIfAborted()
    const controller = new AbortController()
    const cleanupController = new AbortController()
    const done = deferred<void>()
    const onAbort = () => controller.abort(signal!.reason)
    signal?.addEventListener("abort", onAbort, { once: true })
    const operation: ExplorerContextMenuOperationState = {
      controller: cleanupController,
      signal: combineSignals(controller.signal, cleanupController.signal),
      cleanupSignal: cleanupController.signal,
      done: done.promise,
      finish: () => {
        if (operation.finished) return
        operation.finished = true
        signal?.removeEventListener("abort", onAbort)
        this.#operations.delete(operation)
        done.resolve(undefined)
      },
      finished: false,
    }
    this.#operations.add(operation)
    return operation
  }
}

interface ExplorerContextMenuOperationState extends ExplorerContextMenuOperation {
  readonly controller: AbortController
  readonly signal: AbortSignal
  readonly cleanupSignal: AbortSignal
  finished: boolean
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolver) => { resolve = resolver })
  return { promise, resolve }
}

function combineSignals(first: AbortSignal, second: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any([first, second])
  const controller = new AbortController()
  const abort = (signal: AbortSignal) => controller.abort(signal.reason)
  if (first.aborted) abort(first)
  else if (second.aborted) abort(second)
  else {
    first.addEventListener("abort", () => abort(first), { once: true })
    second.addEventListener("abort", () => abort(second), { once: true })
  }
  return controller.signal
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
  let mutated = false
  try {
    const labelResult = await runRegCommand(["add", item.registryPath, "/ve", "/d", item.label, "/f"], signal)
    signal?.throwIfAborted()
    await requireSuccess(labelResult, item.registryPath)
    mutated = true
    const iconResult = await runRegCommand(["add", item.registryPath, "/v", "Icon", "/d", item.icon, "/f"], signal)
    signal?.throwIfAborted()
    await requireSuccess(iconResult, item.registryPath)
    const commandResult = await runRegCommand(["add", `${item.registryPath}\\command`, "/ve", "/d", item.command, "/f"], signal)
    signal?.throwIfAborted()
    await requireSuccess(commandResult, item.registryPath)
  } catch (error) {
    throw new RegistryMutationError(errorMessage(error), mutated)
  }
}

async function unregisterItem(
  item: ReaderExplorerContextMenuPlanItem,
  runRegCommand: (args: readonly string[], signal?: AbortSignal) => Promise<RegistryCommandResult>,
  signal?: AbortSignal,
): Promise<boolean> {
  let mutated = false
  try {
    const result = await runRegCommand(["delete", item.registryPath, "/f"], signal)
    signal?.throwIfAborted()
    if (result.code === 0) {
      mutated = true
      return true
    }
    if (isRegistryNotFound(result)) return false
    requireSuccess(result, item.registryPath)
    return false
  } catch (error) {
    throw new RegistryMutationError(errorMessage(error), mutated)
  }
}

async function rollback(
  direction: "disable" | "enable",
  items: readonly ReaderExplorerContextMenuPlanItem[],
  runRegCommand: (args: readonly string[], signal?: AbortSignal) => Promise<RegistryCommandResult>,
  signal: AbortSignal,
): Promise<string[]> {
  const errors: string[] = []
  const uniqueItems = [...new Map(items.map((item) => [item.registryPath, item])).values()]
  for (const item of uniqueItems.reverse()) {
    try {
      if (direction === "disable") await unregisterItem(item, runRegCommand, signal)
      else await registerItem(item, runRegCommand, signal)
    } catch (error) {
      errors.push(`Rollback ${direction} failed for ${item.registryPath}: ${errorMessage(error)}`)
    }
  }
  return errors
}

class RegistryMutationError extends Error {
  constructor(message: string, readonly mutated: boolean) {
    super(message)
    this.name = "RegistryMutationError"
  }
}

function requireSuccess(result: RegistryCommandResult, path: string): void {
  if (result.code === 0) return
  const detail = result.stderr.trim() || result.stdout.trim() || `reg.exe exited with code ${result.code}`
  throw new Error(detail || `reg.exe failed for ${path}`)
}

function isRegistryNotFound(result: RegistryCommandResult): boolean {
  if (result.code === 0) return false
  const output = `${result.stderr}\n${result.stdout}`
  return /not found|unable to find|cannot find|specified registry key or value/iu.test(output)
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
  const executablePart = quoteCommandLineArgument(executable)
  const argumentPart = args.map(quoteCommandLineArgument).join(" ")
  return argumentPart ? `${executablePart} ${argumentPart}` : executablePart
}

function quoteCommandLineArgument(argument: string): string {
  if (!argument.length) return '""'
  if (argument === "%1" || argument === "%V") return `"${argument}"`
  if (!/[\s"]/u.test(argument)) return argument
  let output = '"'
  let backslashes = 0
  for (const character of argument) {
    if (character === "\\") {
      backslashes += 1
      continue
    }
    if (character === '"') {
      output += "\\".repeat(backslashes * 2 + 1)
      output += '"'
      backslashes = 0
      continue
    }
    output += "\\".repeat(backslashes)
    output += character
    backslashes = 0
  }
  output += "\\".repeat(backslashes * 2)
  return `${output}"`
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
  if (hive !== "HKCU" && hive !== "HKLM" && hive !== "HKCR") throw new Error("Unsupported registry hive in Explorer context-menu plan.")
  if (!rest.length || /[\[\]\r\n\0]/u.test(path)) throw new Error("Unsafe registry path in Explorer context-menu plan.")
  const fullHive = hive === "HKCU"
    ? "HKEY_CURRENT_USER"
    : hive === "HKLM"
      ? "HKEY_LOCAL_MACHINE"
      : "HKEY_CLASSES_ROOT"
  return `${fullHive}\\${rest.join("\\")}`
}

function escapeRegistryValue(value: string): string {
  assertSafeText(value, "Registry value")
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')
}

function normalizeRegistration(
  registration: ReaderExplorerContextMenuRegistration,
): ReaderExplorerContextMenuRegistration {
  const key = registration.key.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(key)) throw new Error("Explorer context-menu key must be a simple registry identifier.")
  const executable = normalizeExecutable(registration.executable)
  if (!executable) throw new Error("Explorer context-menu executable is required.")
  const scopes = [...new Set<ReaderExplorerContextMenuScope>(registration.scopes ?? ["file"])]
  const hives = [...new Set<ReaderExplorerContextMenuHive>(registration.hives ?? ["HKCU"])]
  for (const scope of scopes) if (scope !== "file" && scope !== "directory" && scope !== "background") throw new Error(`Unsupported Explorer context-menu scope: ${scope}`)
  for (const hive of hives) if (hive !== "HKCU" && hive !== "HKCR" && hive !== "HKLM") throw new Error(`Unsupported Explorer context-menu hive: ${hive}`)
  const label = registration.label?.trim() || key
  const icon = registration.icon?.trim() || executable
  assertSafeText(label, "Explorer context-menu label")
  assertSafeText(icon, "Explorer context-menu icon")
  const argumentsList = registration.arguments ? [...registration.arguments] : ["%1"]
  for (const argument of argumentsList) {
    if (typeof argument !== "string") throw new Error("Explorer context-menu arguments must be strings.")
    assertSafeText(argument, "Explorer context-menu argument")
  }
  return {
    key,
    label,
    executable,
    arguments: argumentsList,
    icon,
    scopes,
    hives,
  }
}

function normalizeExecutable(value: string): string {
  if (typeof value !== "string") throw new Error("Explorer context-menu executable is required.")
  const executable = value.trim()
  if (!executable) return ""
  const unquoted = executable.startsWith('"') && executable.endsWith('"')
    ? executable.slice(1, -1).trim()
    : executable
  if (!unquoted || unquoted.includes('"')) throw new Error("Explorer context-menu executable must be a single path without embedded quotes.")
  assertSafeText(unquoted, "Explorer context-menu executable")
  return unquoted
}

function assertSafeText(value: string, name: string): void {
  if (/\p{Cc}/u.test(value)) throw new Error(`${name} contains unsupported control characters.`)
}

async function runReg(args: readonly string[], signal?: AbortSignal): Promise<RegistryCommandResult> {
  signal?.throwIfAborted()
  try {
    const result = await execFileAsync("reg.exe", [...args], { windowsHide: true, encoding: "utf8", signal })
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
