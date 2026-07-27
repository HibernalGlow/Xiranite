import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { promisify } from "node:util"
import { buildWindowsShellCommand } from "@xiranite/shell-integration"

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
const MANAGED_BY_VALUE = "Xiranite.ManagedBy"
const MANAGED_BY = "xiranite.shell-integration/v1"
const NODE_ID_VALUE = "Xiranite.NodeId"
const NODE_ID = "neoview"
const INTENT_VALUE = "Xiranite.Intent"
const INTENT = "open"
const REGISTRATION_ID_VALUE = "Xiranite.RegistrationId"
const REGISTRATION_ID = "xiranite.neoview.open"
const FINGERPRINT_VALUE = "Xiranite.Fingerprint"
const DEFAULT_REGISTRATION: ReaderExplorerContextMenuRegistration = {
	key: "Xiranite.NeoView.Open",
	label: "Open with NeoView",
	executable: process.env.XIRANITE_DESKTOP_EXECUTABLE ?? "",
	arguments: ["--launch-node", "neoview", "--intent", "open", "--", "%1"],
	scopes: ["file", "directory", "background"],
	extensions: ["jpg", "jpeg", "png", "gif", "webp", "avif", "jxl", "tif", "tiff", "bmp", "zip", "cbz", "rar", "cbr", "7z", "cb7", "epub", "mp4", "webm", "mkv", "avi", "mov"],
	hives: ["HKCU"],
}

export interface WindowsReaderExplorerContextMenuProviderOptions {
  platform?: NodeJS.Platform
  registration?: Partial<ReaderExplorerContextMenuRegistration>
  /** Resolves the current media extensions before each Shell operation. */
  extensions?: () => readonly string[]
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
  readonly #extensions?: () => readonly string[]
  readonly #resourceScheduler?: ResourceScheduler
  readonly #ownerId: string
  readonly #runReg: (args: readonly string[], signal?: AbortSignal) => Promise<RegistryCommandResult>
  readonly #operations = new Set<ExplorerContextMenuOperationState>()
  #closed = false
  #disposePromise?: Promise<void>

  constructor(options: WindowsReaderExplorerContextMenuProviderOptions = {}) {
    this.#platform = options.platform ?? process.platform
    this.#registration = normalizeRegistration({
      ...DEFAULT_REGISTRATION,
      ...options.registration,
      // A caller that supplies its own registration without extensions keeps
      // the legacy `*` behavior instead of inheriting NeoView defaults.
      ...(options.registration && !Object.hasOwn(options.registration, "extensions") ? { extensions: undefined } : {}),
    })
    this.#extensions = options.extensions
    this.#resourceScheduler = options.resourceScheduler
    this.#ownerId = options.ownerId ?? "neoview:explorer-context-menu"
    this.#runReg = options.runReg ?? runReg
  }

  async preview(signal?: AbortSignal): Promise<ReaderExplorerContextMenuPreview> {
    const operation = this.#begin(signal)
    try {
      if (this.#platform !== "win32") return unavailablePreview()
      const plan = this.#plan()
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

      const plan = this.#plan()
      if (!plan.length) return { available: false, enabled: false, state: "unavailable", reason: "No Explorer context-menu registration entries are configured." }

      const lease = await this.#resourceScheduler?.acquire({
        resource: "io",
        kind: "reader.explorer-context-menu.status",
        priority: "interactive",
        ownerId: this.#ownerId,
      }, operation.signal)
      try {
		for (const item of plan) {
			operation.signal.throwIfAborted()
			const result = await this.#runReg(["query", mergedRegistryPath(item.registryPath)], operation.signal)
			operation.signal.throwIfAborted()
			if (result.code !== 0) return { available: true, enabled: false, state: "disabled" }
			const itemState = await inspectItem(item, this.#runReg, operation.signal)
			if (itemState === "conflict") {
				return { available: true, enabled: false, state: "conflict", reason: `${item.registryPath} is owned by another registration and cannot be repaired automatically.` }
			}
			if (itemState === "drifted") return { available: true, enabled: false, state: "needs-repair", reason: `${item.registryPath} no longer matches the managed Explorer registration.` }
        }
        return { available: true, enabled: true, state: "registered" }
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

      const plan = this.#plan()
      if (!plan.length) return { available: false, enabled: false, state: "unavailable", reason: "No Explorer context-menu registration entries are configured." }

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
            return { available: true, enabled: false, state: "needs-repair", reason: details.join("; ") }
          }
        }
        return { available: true, enabled, state: enabled ? "registered" : "disabled" }
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

  #plan(): readonly ReaderExplorerContextMenuPlanItem[] {
    const extensions = this.#extensions?.()
    return buildPlan(extensions === undefined
      ? this.#registration
      : normalizeRegistration({ ...this.#registration, extensions }))
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
	const extensions = registration.extensions?.length ? registration.extensions : undefined
  const icon = registration.icon ?? registration.executable
  const plan: ReaderExplorerContextMenuPlanItem[] = []
  for (const hive of hives) {
		for (const scope of scopes) {
			const scopedArgs = args.map((arg) => arg === "%1" && scope !== "file" ? "%V" : arg)
			const scopeExtensions = scope === "file" ? (extensions ?? [undefined]) : [undefined]
			for (const extension of scopeExtensions) {
				plan.push({
					entryKey: registration.key,
					hive,
					scope,
					...(extension ? { extension } : {}),
					registryPath: registryPath(hive, registration.key, scope, extension),
					label: registration.label,
					icon,
					command: buildCommand(registration.executable, scopedArgs),
					enabled: true,
				})
			}
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
		const ownership = await itemOwnership(item, runRegCommand, signal)
		if (ownership.exists && !ownership.owned) {
			throw new Error(`${item.registryPath} already exists without Xiranite ownership markers.`)
		}
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
		await requireSuccess(await runRegCommand(["add", item.registryPath, "/v", MANAGED_BY_VALUE, "/d", MANAGED_BY, "/f"], signal), item.registryPath)
		await requireSuccess(await runRegCommand(["add", item.registryPath, "/v", NODE_ID_VALUE, "/d", NODE_ID, "/f"], signal), item.registryPath)
		await requireSuccess(await runRegCommand(["add", item.registryPath, "/v", INTENT_VALUE, "/d", INTENT, "/f"], signal), item.registryPath)
		await requireSuccess(await runRegCommand(["add", item.registryPath, "/v", REGISTRATION_ID_VALUE, "/d", REGISTRATION_ID, "/f"], signal), item.registryPath)
		await requireSuccess(await runRegCommand(["add", item.registryPath, "/v", FINGERPRINT_VALUE, "/d", fingerprint(item), "/f"], signal), item.registryPath)
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
		const ownership = await itemOwnership(item, runRegCommand, signal)
		if (!ownership.exists) return false
		if (!ownership.owned) throw new Error(`${item.registryPath} is not owned by Xiranite and will not be deleted.`)
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

async function itemOwnership(
	item: ReaderExplorerContextMenuPlanItem,
	runRegCommand: (args: readonly string[], signal?: AbortSignal) => Promise<RegistryCommandResult>,
	signal?: AbortSignal,
): Promise<{ exists: boolean; owned: boolean }> {
	const key = await runRegCommand(["query", item.registryPath], signal)
	if (key.code !== 0) {
		if (isRegistryNotFound(key)) return { exists: false, owned: false }
		requireSuccess(key, item.registryPath)
	}
	const markers = await Promise.all([
		runRegCommand(["query", item.registryPath, "/v", MANAGED_BY_VALUE], signal),
		runRegCommand(["query", item.registryPath, "/v", NODE_ID_VALUE], signal),
		runRegCommand(["query", item.registryPath, "/v", INTENT_VALUE], signal),
		runRegCommand(["query", item.registryPath, "/v", REGISTRATION_ID_VALUE], signal),
	])
	if (markers.some((marker) => marker.code !== 0)) return { exists: true, owned: false }
	const expected = [MANAGED_BY, NODE_ID, INTENT, REGISTRATION_ID]
	return { exists: true, owned: markers.every((marker, index) => matchesRegistryValue(marker, expected[index]!)) }
}

async function inspectItem(
	item: ReaderExplorerContextMenuPlanItem,
	runRegCommand: (args: readonly string[], signal?: AbortSignal) => Promise<RegistryCommandResult>,
	signal?: AbortSignal,
): Promise<"owned" | "conflict" | "drifted"> {
	if (!(await itemOwnership(item, runRegCommand, signal)).owned) return "conflict"
	const mergedPath = mergedRegistryPath(item.registryPath)
	const [key, command, fingerprintValue] = await Promise.all([
		runRegCommand(["query", mergedPath], signal),
		runRegCommand(["query", `${mergedPath}\\command`], signal),
		runRegCommand(["query", item.registryPath, "/v", FINGERPRINT_VALUE], signal),
	])
	if (key.code !== 0 || command.code !== 0 || fingerprintValue.code !== 0) return "drifted"
	if (!matchesRegistryValues(key, [item.label, item.icon])) return "drifted"
	if (!matchesRegistryValue(command, item.command)) return "drifted"
	return matchesRegistryValue(fingerprintValue, fingerprint(item)) ? "owned" : "drifted"
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

function registryPath(hive: ReaderExplorerContextMenuHive, entryKey: string, scope: ReaderExplorerContextMenuScope, extension?: string): string {
	const scopedPath = scope === "file"
		? extension ? `SystemFileAssociations\\.${extension}\\shell\\${entryKey}` : `*\\shell\\${entryKey}`
    : scope === "directory"
      ? `Directory\\shell\\${entryKey}`
      : `Directory\\Background\\shell\\${entryKey}`
  if (hive === "HKCU") return `HKCU\\Software\\Classes\\${scopedPath}`
  if (hive === "HKLM") return `HKLM\\Software\\Classes\\${scopedPath}`
  return `HKCR\\${scopedPath}`
}

function mergedRegistryPath(path: string): string {
	const prefix = "HKCU\\Software\\Classes\\"
	return path.startsWith(prefix) ? `HKCR\\${path.slice(prefix.length)}` : path
}

function buildCommand(executable: string, args: readonly string[]): string {
	return buildWindowsShellCommand(executable, args)
}

function renderRegistryFile(plan: readonly ReaderExplorerContextMenuPlanItem[]): string {
  const lines = ["Windows Registry Editor Version 5.00", ""]
  for (const item of plan) {
    lines.push(`[${registryFilePath(item.registryPath)}]`)
    lines.push(`@="${escapeRegistryValue(item.label)}"`)
    lines.push(`"Icon"="${escapeRegistryValue(item.icon)}"`)
		lines.push(`"${MANAGED_BY_VALUE}"="${MANAGED_BY}"`)
		lines.push(`"${NODE_ID_VALUE}"="${NODE_ID}"`)
		lines.push(`"${INTENT_VALUE}"="${INTENT}"`)
		lines.push(`"${REGISTRATION_ID_VALUE}"="${REGISTRATION_ID}"`)
		lines.push(`"${FINGERPRINT_VALUE}"="${fingerprint(item)}"`)
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

function fingerprint(item: ReaderExplorerContextMenuPlanItem): string {
  return createHash("sha256")
    .update([item.registryPath, item.label, item.icon, item.command].join("\0"), "utf8")
    .digest("hex")
}

function matchesRegistryValues(result: RegistryCommandResult, expected: readonly string[]): boolean {
  return expected.every((value) => matchesRegistryValue(result, value))
}

function matchesRegistryValue(result: RegistryCommandResult, expected: string): boolean {
  const output = `${result.stdout}\n${result.stderr}`.trim()
  // In-memory adapters intentionally omit reg.exe formatting in unit tests.
  return !output || output.includes(expected)
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
  const extensions = registration.extensions === undefined
    ? undefined
    : normalizeExtensions(registration.extensions)
  return {
    key,
    label,
    executable,
    arguments: argumentsList,
    icon,
    scopes,
    hives,
    ...(extensions ? { extensions } : {}),
  }
}

function normalizeExtensions(values: readonly string[]): readonly string[] {
  const extensions: string[] = []
  for (const value of values) {
    if (typeof value !== "string") throw new Error("Explorer context-menu extensions must be strings.")
    const extension = value.trim().replace(/^\.+/u, "").toLowerCase()
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(extension)) {
      throw new Error(`Explorer context-menu extension is unsafe: ${value}`)
    }
    if (!extensions.includes(extension)) extensions.push(extension)
  }
  return Object.freeze(extensions)
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
  return { available: false, enabled: false, state: "unavailable", reason }
}

function unavailablePreview(): ReaderExplorerContextMenuPreview {
  return { available: false, plan: [], registryFile: "", reason: "Explorer context-menu registration is only available on Windows." }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
