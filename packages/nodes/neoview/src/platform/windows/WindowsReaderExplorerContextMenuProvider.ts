import { execFile } from "node:child_process"
import { promisify } from "node:util"
import {
  buildWindowsManagedShellPlan,
  inspectWindowsManagedShellPlan,
  renderWindowsManagedShellRegistryFile,
  setWindowsManagedShellPlanEnabled,
  type WindowsManagedShellPlanItem,
  type WindowsManagedShellPlanStatus,
  type WindowsRegistryCommandResult,
  type WindowsRegistryCommandRunner,
} from "@xiranite/shell-integration"

import type {
  ReaderExplorerContextMenuPlanItem,
  ReaderExplorerContextMenuPreview,
  ReaderExplorerContextMenuProvider,
  ReaderExplorerContextMenuRegistration,
  ReaderExplorerContextMenuStatus,
} from "../../ports/ReaderExplorerContextMenuProvider.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"

const execFileAsync = promisify(execFile)
const MANAGED_BY = "xiranite.shell-integration/v1"
const NODE_ID = "neoview"
const INTENT = "open"
const REGISTRATION_ID = "xiranite.neoview.open"
const LEGACY_OWITHU_ENTRY_KEY = "Xiranite.NeoView.Open"
const LEGACY_OWITHU_LABEL = "Open with NeoView"
const LEGACY_OWITHU_MIGRATION_REASON = "A broken legacy Owithu registration without a launch command will be replaced when Explorer integration is changed."
const DEFAULT_REGISTRATION: ReaderExplorerContextMenuRegistration = {
  key: "Xiranite.NeoView.Open",
  label: "Open with NeoView",
  executable: process.env.XIRANITE_DESKTOP_EXECUTABLE ?? "",
  arguments: ["--launch-node", "neoview", "--intent", "open", "--source", "explorer", "--", "%1"],
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
  runReg?: WindowsRegistryCommandRunner
}

export type RegistryCommandResult = WindowsRegistryCommandResult

interface ExplorerContextMenuOperation {
  readonly signal: AbortSignal
  readonly cleanupSignal: AbortSignal
  readonly done: Promise<void>
  finish(): void
}

/**
 * NeoView owns its desired extensions and settings. Managed-registry safety is
 * shared by @xiranite/shell-integration so future nodes use the same markers,
 * conflict rules, drift checks, and rollback behavior.
 */
export class WindowsReaderExplorerContextMenuProvider implements ReaderExplorerContextMenuProvider, AsyncDisposable {
  readonly #platform: NodeJS.Platform
  readonly #registration: ReaderExplorerContextMenuRegistration
  readonly #extensions?: () => readonly string[]
  readonly #resourceScheduler?: ResourceScheduler
  readonly #ownerId: string
  readonly #runReg: WindowsRegistryCommandRunner
  readonly #operations = new Set<ExplorerContextMenuOperationState>()
  #closed = false
  #disposePromise?: Promise<void>

  constructor(options: WindowsReaderExplorerContextMenuProviderOptions = {}) {
    this.#platform = options.platform ?? process.platform
    this.#registration = {
      ...DEFAULT_REGISTRATION,
      ...options.registration,
      // A caller that supplies its own registration without extensions keeps
      // the legacy `*` behavior instead of inheriting NeoView defaults.
      ...(options.registration && !Object.hasOwn(options.registration, "extensions") ? { extensions: undefined } : {}),
    }
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
        plan: toReaderPlan(plan),
        registryFile: renderWindowsManagedShellRegistryFile(plan),
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
      if (!plan.length) return unavailableStatus("No Explorer context-menu registration entries are configured.")
      return await this.#withLease("status", operation, async () => {
        const current = await inspectWindowsManagedShellPlan(this.#runReg, plan, operation.signal)
        if (current.state !== "conflict") return toReaderStatus(current)

        const legacyItems = await findBrokenLegacyOwithuItems(this.#runReg, plan, operation.signal)
        if (!legacyItems.length) return toReaderStatus(current)

        const remainingPlan = plan.filter((item) => !legacyItems.includes(item))
        const remaining = remainingPlan.length
          ? await inspectWindowsManagedShellPlan(this.#runReg, remainingPlan, operation.signal)
          : { state: "disabled" as const }
        if (remaining.state === "conflict") return toReaderStatus(remaining)
        return { available: true, enabled: false, state: "disabled", reason: LEGACY_OWITHU_MIGRATION_REASON }
      })
    } catch (error) {
      if (operation.signal.aborted) throw operation.signal.reason
      return unavailableStatus(errorMessage(error))
    } finally {
      operation.finish()
    }
  }

  async setEnabled(enabled: boolean, signal?: AbortSignal): Promise<ReaderExplorerContextMenuStatus> {
    const operation = this.#begin(signal)
    try {
      if (this.#platform !== "win32") return unavailableStatus()
      const plan = this.#plan()
      if (!plan.length) return unavailableStatus("No Explorer context-menu registration entries are configured.")
      return await this.#withLease("set-enabled", operation, async () => {
        const legacyItems = await findBrokenLegacyOwithuItems(this.#runReg, plan, operation.signal)
        if (legacyItems.length) await removeBrokenLegacyOwithuItems(this.#runReg, legacyItems, operation.signal)
        return toReaderStatus(await setWindowsManagedShellPlanEnabled(this.#runReg, plan, enabled, operation.signal))
      })
    } catch (error) {
      if (operation.signal.aborted) throw operation.signal.reason
      return unavailableStatus(errorMessage(error))
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

  #plan(): readonly WindowsManagedShellPlanItem[] {
    const extensions = this.#extensions?.()
    return buildWindowsManagedShellPlan({
      registrationId: REGISTRATION_ID,
      nodeId: NODE_ID,
      intent: INTENT,
      managedBy: MANAGED_BY,
      ...this.#registration,
      ...(extensions === undefined ? {} : { extensions }),
    })
  }

  async #withLease(
    operationName: "status" | "set-enabled",
    operation: ExplorerContextMenuOperation,
    execute: () => Promise<ReaderExplorerContextMenuStatus>,
  ): Promise<ReaderExplorerContextMenuStatus> {
    const lease = await this.#resourceScheduler?.acquire({
      resource: "io",
      kind: `reader.explorer-context-menu.${operationName}`,
      priority: "interactive",
      ownerId: this.#ownerId,
    }, operation.signal)
    try {
      return await execute()
    } finally {
      lease?.release()
    }
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

export function buildReaderExplorerContextMenuPlan(
  registration: ReaderExplorerContextMenuRegistration,
): readonly ReaderExplorerContextMenuPlanItem[] {
  return toReaderPlan(buildWindowsManagedShellPlan({
    registrationId: REGISTRATION_ID,
    nodeId: NODE_ID,
    intent: INTENT,
    managedBy: MANAGED_BY,
    ...registration,
  }))
}

export function renderReaderExplorerContextMenuRegistryFile(
  plan: readonly ReaderExplorerContextMenuPlanItem[],
): string {
  return renderWindowsManagedShellRegistryFile(plan.map((item) => ({
    ...item,
    ownership: { managedBy: MANAGED_BY, nodeId: NODE_ID, intent: INTENT, registrationId: REGISTRATION_ID },
  })))
}

function toReaderPlan(plan: readonly WindowsManagedShellPlanItem[]): readonly ReaderExplorerContextMenuPlanItem[] {
  return plan.map(({ ownership: _ownership, ...item }) => ({ ...item, enabled: true }))
}

function toReaderStatus(status: WindowsManagedShellPlanStatus): ReaderExplorerContextMenuStatus {
  return {
    available: true,
    enabled: status.state === "registered",
    state: status.state,
    ...(status.reason ? { reason: status.reason } : {}),
  }
}

/**
 * Owithu once wrote this NeoView verb with only its label, so Explorer showed
 * it but could not launch anything. It predates ownership markers. Treat only
 * that exact per-user, file-association shape as migratable; an executable
 * command or any marker keeps the normal no-overwrite conflict behavior.
 */
async function findBrokenLegacyOwithuItems(
  runner: WindowsRegistryCommandRunner,
  plan: readonly WindowsManagedShellPlanItem[],
  signal?: AbortSignal,
): Promise<readonly WindowsManagedShellPlanItem[]> {
  const legacyItems: WindowsManagedShellPlanItem[] = []
  for (const item of plan) {
    signal?.throwIfAborted()
    if (!isLegacyOwithuCandidate(item)) continue
    const key = await runner(["query", item.registryPath], signal)
    if (key.code !== 0) continue
    const [label, command, managedBy, nodeId, intent, registrationId] = await Promise.all([
      runner(["query", item.registryPath, "/ve"], signal),
      runner(["query", `${item.registryPath}\\command`], signal),
      runner(["query", item.registryPath, "/v", "Xiranite.ManagedBy"], signal),
      runner(["query", item.registryPath, "/v", "Xiranite.NodeId"], signal),
      runner(["query", item.registryPath, "/v", "Xiranite.Intent"], signal),
      runner(["query", item.registryPath, "/v", "Xiranite.RegistrationId"], signal),
    ])
    signal?.throwIfAborted()
    if (label.code !== 0 || !registryOutputIncludes(label, LEGACY_OWITHU_LABEL)) continue
    if (command.code === 0 || [managedBy, nodeId, intent, registrationId].some((result) => result.code === 0)) continue
    legacyItems.push(item)
  }
  return legacyItems
}

async function removeBrokenLegacyOwithuItems(
  runner: WindowsRegistryCommandRunner,
  items: readonly WindowsManagedShellPlanItem[],
  signal?: AbortSignal,
): Promise<void> {
  for (const item of items) {
    const result = await runner(["delete", item.registryPath, "/f"], signal)
    signal?.throwIfAborted()
    if (result.code !== 0) throw new Error(`Could not remove broken legacy registration at ${item.registryPath}: ${registryError(result)}`)
  }
}

function isLegacyOwithuCandidate(item: WindowsManagedShellPlanItem): boolean {
  return item.hive === "HKCU"
    && item.scope === "file"
    && item.entryKey === LEGACY_OWITHU_ENTRY_KEY
    && item.registryPath.startsWith("HKCU\\Software\\Classes\\SystemFileAssociations\\.")
}

function registryOutputIncludes(result: WindowsRegistryCommandResult, value: string): boolean {
  return `${result.stdout}\n${result.stderr}`.includes(value)
}

function registryError(result: WindowsRegistryCommandResult): string {
  return `${result.stdout}\n${result.stderr}`.trim() || `reg.exe exited with ${result.code}`
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

async function runReg(args: readonly string[], signal?: AbortSignal): Promise<WindowsRegistryCommandResult> {
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
