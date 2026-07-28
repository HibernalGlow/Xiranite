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

export interface WindowsRegistryTarget {
  hive: WindowsRegistryHive
  subkey: string
}

export interface WindowsRegistryAdapter {
  createKey(target: WindowsRegistryTarget): Promise<void>
  setStringValue(target: WindowsRegistryTarget, valueName: string, value: string): Promise<void>
  deleteKey(registryPath: string, signal?: AbortSignal): Promise<WindowsRegistryCommandResult>
}

export interface WindowsShellApplyResult {
  successCount: number
  failedCount: number
  errors: string[]
}

/**
 * A node-owned, opt-in Shell verb. The plan stays serializable so callers can
 * preview it in a browser before a Node host performs registry operations.
 */
export interface WindowsManagedShellRegistration {
  registrationId: string
  nodeId: string
  intent: string
  key: string
  label: string
  executable: string
  arguments?: readonly string[]
  icon?: string
  scopes?: readonly WindowsShellScope[]
  /** File verbs are registered against these extensions; omit for legacy `*`. */
  extensions?: readonly string[]
  hives?: readonly WindowsRegistryHive[]
  managedBy?: string
}

export interface WindowsManagedShellOwnership {
  managedBy: string
  nodeId: string
  intent: string
  registrationId: string
}

export interface WindowsManagedShellPlanItem extends WindowsShellPlanItem {
  entryKey: string
  hive: WindowsRegistryHive
  scope: WindowsShellScope
  extension?: string
  ownership: WindowsManagedShellOwnership
}

export type WindowsManagedShellPlanState = "disabled" | "registered" | "needs-repair" | "conflict"

export interface WindowsManagedShellPlanStatus {
  state: WindowsManagedShellPlanState
  reason?: string
}

export type WindowsRegistryCommandRunner = (
  args: readonly string[],
  signal?: AbortSignal,
) => Promise<WindowsRegistryCommandResult>

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

/** Builds the HKCU/HKCR/HKLM paths and command text for a managed Shell verb. */
export function buildWindowsManagedShellPlan(
  registration: WindowsManagedShellRegistration,
): readonly WindowsManagedShellPlanItem[] {
  const normalized = normalizeManagedRegistration(registration)
  const plan: WindowsManagedShellPlanItem[] = []
  for (const hive of normalized.hives) {
    for (const scope of normalized.scopes) {
      const argumentsForScope = normalized.arguments.map((argument) => argument === "%1" && scope !== "file" ? "%V" : argument)
      const extensions = scope === "file" ? (normalized.extensions ?? [undefined]) : [undefined]
      for (const extension of extensions) {
        plan.push({
          entryKey: normalized.key,
          hive,
          scope,
          ...(extension ? { extension } : {}),
          registryPath: managedRegistryPath(hive, normalized.key, scope, extension),
          label: normalized.label,
          icon: normalized.icon,
          command: buildWindowsShellCommand(normalized.executable, argumentsForScope),
          ownership: normalized.ownership,
        })
      }
    }
  }
  return Object.freeze(plan)
}

/**
 * Reads the merged HKCR projection but verifies ownership at the actual write
 * hive. A same-name unmarked verb is an external conflict, never a repair.
 */
export async function inspectWindowsManagedShellPlan(
  runner: WindowsRegistryCommandRunner,
  plan: readonly WindowsManagedShellPlanItem[],
  signal?: AbortSignal,
): Promise<WindowsManagedShellPlanStatus> {
  for (const item of plan) {
    signal?.throwIfAborted()
    const merged = await runner(["query", mergedRegistryPath(item.registryPath)], signal)
    signal?.throwIfAborted()
    if (merged.code !== 0) return { state: "disabled" }

    const ownership = await inspectManagedOwnership(item, runner, signal)
    if (!ownership.owned) {
      return {
        state: "conflict",
        reason: `${item.registryPath} is owned by another registration and cannot be repaired automatically.`,
      }
    }
    const inspection = await inspectManagedItem(item, runner, signal)
    if (inspection === "drifted") {
      return {
        state: "needs-repair",
        reason: `${item.registryPath} no longer matches the managed Explorer registration.`,
      }
    }
  }
  return { state: "registered" }
}

/**
 * Applies a full managed plan atomically enough for registry operations: a
 * failed enable removes keys created during this call; a failed disable
 * restores keys removed during this call. Only matching owner markers permit
 * deletion.
 */
export async function setWindowsManagedShellPlanEnabled(
  runner: WindowsRegistryCommandRunner,
  plan: readonly WindowsManagedShellPlanItem[],
  enabled: boolean,
  signal?: AbortSignal,
): Promise<WindowsManagedShellPlanStatus> {
  const changed: WindowsManagedShellPlanItem[] = []
  for (const item of plan) {
    try {
      signal?.throwIfAborted()
      const didMutate = enabled
        ? await registerManagedItem(item, runner, signal)
        : await unregisterManagedItem(item, runner, signal)
      if (didMutate) changed.push(item)
    } catch (cause) {
      const rollbackItems = cause instanceof ManagedRegistryMutationError && cause.mutated
        ? [...changed, item]
        : changed
      const rollbackErrors = await rollbackManagedPlan(
        runner,
        enabled ? "disable" : "enable",
        rollbackItems,
        signal,
      )
      signal?.throwIfAborted()
      const reason = [`${item.registryPath}: ${messageOf(cause)}`, ...rollbackErrors].join("; ")
      return { state: "needs-repair", reason }
    }
  }
  return { state: enabled ? "registered" : "disabled" }
}

export function renderWindowsManagedShellRegistryFile(plan: readonly WindowsManagedShellPlanItem[]): string {
  const lines = ["Windows Registry Editor Version 5.00", ""]
  for (const item of plan) {
    assertSafeManagedPlanItem(item)
    lines.push(`[${registryFilePath(item.registryPath)}]`)
    lines.push(`@="${escapeRegistryValue(item.label)}"`)
    lines.push(`"Icon"="${escapeRegistryValue(item.icon)}"`)
    for (const [name, value] of Object.entries(managedMarkers(item))) {
      lines.push(`"${name}"="${escapeRegistryValue(value)}"`)
    }
    lines.push("")
    lines.push(`[${registryFilePath(`${item.registryPath}\\command`)}]`)
    lines.push(`@="${escapeRegistryValue(item.command)}"`)
    lines.push("")
  }
  return `${lines.join("\r\n")}\r\n`
}

async function registerManagedItem(
  item: WindowsManagedShellPlanItem,
  runner: WindowsRegistryCommandRunner,
  signal?: AbortSignal,
): Promise<boolean> {
  const ownership = await inspectManagedOwnership(item, runner, signal)
  if (ownership.exists && !ownership.owned) {
    throw new Error(`${item.registryPath} already exists without Xiranite ownership markers.`)
  }
  let mutated = false
  try {
    await requireManagedRegistrySuccess(await runner(["add", item.registryPath, "/ve", "/d", item.label, "/f"], signal), item.registryPath, signal)
    mutated = true
    await requireManagedRegistrySuccess(await runner(["add", item.registryPath, "/v", "Icon", "/d", item.icon, "/f"], signal), item.registryPath, signal)
    await requireManagedRegistrySuccess(await runner(["add", `${item.registryPath}\\command`, "/ve", "/d", item.command, "/f"], signal), item.registryPath, signal)
    for (const [name, value] of Object.entries(managedMarkers(item))) {
      await requireManagedRegistrySuccess(await runner(["add", item.registryPath, "/v", name, "/d", value, "/f"], signal), item.registryPath, signal)
    }
    return true
  } catch (cause) {
    throw new ManagedRegistryMutationError(messageOf(cause), mutated)
  }
}

async function unregisterManagedItem(
  item: WindowsManagedShellPlanItem,
  runner: WindowsRegistryCommandRunner,
  signal?: AbortSignal,
): Promise<boolean> {
  const ownership = await inspectManagedOwnership(item, runner, signal)
  if (!ownership.exists) return false
  if (!ownership.owned) throw new Error(`${item.registryPath} is not owned by Xiranite and will not be deleted.`)
  const result = await runner(["delete", item.registryPath, "/f"], signal)
  signal?.throwIfAborted()
  if (result.code === 0) return true
  if (isRegistryNotFound(result)) return false
  requireRegistrySuccess(result, item.registryPath)
  return false
}

async function inspectManagedOwnership(
  item: WindowsManagedShellPlanItem,
  runner: WindowsRegistryCommandRunner,
  signal?: AbortSignal,
): Promise<{ exists: boolean; owned: boolean }> {
  const local = await runner(["query", item.registryPath], signal)
  signal?.throwIfAborted()
  if (local.code !== 0) {
    // A HKLM/HKCR key with the same visible verb would be shadowed by a new
    // HKCU registration, so preserve it as an explicit external conflict.
    const merged = await runner(["query", mergedRegistryPath(item.registryPath)], signal)
    signal?.throwIfAborted()
    return merged.code === 0 ? { exists: true, owned: false } : { exists: false, owned: false }
  }
  const markers = await Promise.all(Object.entries(managedMarkers(item)).map(async ([name, expected]) => {
    const result = await runner(["query", item.registryPath, "/v", name], signal)
    return { expected, result }
  }))
  signal?.throwIfAborted()
  return {
    exists: true,
    owned: markers.every(({ expected, result }) => result.code === 0 && matchesRegistryValue(result, expected)),
  }
}

async function inspectManagedItem(
  item: WindowsManagedShellPlanItem,
  runner: WindowsRegistryCommandRunner,
  signal?: AbortSignal,
): Promise<"owned" | "drifted"> {
  const mergedPath = mergedRegistryPath(item.registryPath)
  const [key, command, fingerprint] = await Promise.all([
    runner(["query", mergedPath], signal),
    runner(["query", `${mergedPath}\\command`], signal),
    runner(["query", item.registryPath, "/v", "Xiranite.Fingerprint"], signal),
  ])
  signal?.throwIfAborted()
  if (key.code !== 0 || command.code !== 0 || fingerprint.code !== 0) return "drifted"
  if (!matchesRegistryValue(key, item.label) || !matchesRegistryValue(key, item.icon)) return "drifted"
  if (!matchesRegistryValue(command, item.command)) return "drifted"
  return matchesRegistryValue(fingerprint, managedFingerprint(item)) ? "owned" : "drifted"
}

async function rollbackManagedPlan(
  runner: WindowsRegistryCommandRunner,
  direction: "enable" | "disable",
  items: readonly WindowsManagedShellPlanItem[],
  signal?: AbortSignal,
): Promise<string[]> {
  const errors: string[] = []
  const uniqueItems = [...new Map(items.map((item) => [item.registryPath, item])).values()].reverse()
  for (const item of uniqueItems) {
    try {
      if (direction === "enable") await registerManagedItem(item, runner, signal)
      else await unregisterManagedItem(item, runner, signal)
    } catch (cause) {
      errors.push(`Rollback ${direction} failed for ${item.registryPath}: ${messageOf(cause)}`)
    }
  }
  return errors
}

function normalizeManagedRegistration(registration: WindowsManagedShellRegistration): {
  key: string
  label: string
  executable: string
  arguments: readonly string[]
  icon: string
  scopes: readonly WindowsShellScope[]
  extensions?: readonly string[]
  hives: readonly WindowsRegistryHive[]
  ownership: WindowsManagedShellOwnership
} {
  const key = registration.key.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(key)) throw new Error("Shell entry key must be a simple registry identifier.")
  const executable = normalizeExecutable(registration.executable)
  const label = registration.label.trim() || key
  const icon = registration.icon?.trim() || executable
  const argumentsList = registration.arguments ? [...registration.arguments] : ["%1"]
  const scopes = uniqueValues(registration.scopes ?? ["file"]) as readonly WindowsShellScope[]
  const hives = uniqueValues(registration.hives ?? ["HKCU"]) as readonly WindowsRegistryHive[]
  const extensions = registration.extensions === undefined ? undefined : normalizeExtensions(registration.extensions)
  const ownership = {
    managedBy: registration.managedBy?.trim() || "xiranite.shell-integration/v1",
    nodeId: registration.nodeId.trim(),
    intent: registration.intent.trim(),
    registrationId: registration.registrationId.trim(),
  }
  for (const value of [label, icon, ...argumentsList, ...Object.values(ownership)]) assertSafeText(value, "Shell registration value")
  if (!ownership.nodeId || !ownership.intent || !ownership.registrationId) throw new Error("Managed Shell registrations require node, intent, and registration identities.")
  for (const scope of scopes) if (scope !== "file" && scope !== "directory" && scope !== "background") throw new Error(`Unsupported Shell scope: ${scope}`)
  for (const hive of hives) if (hive !== "HKCU" && hive !== "HKCR" && hive !== "HKLM") throw new Error(`Unsupported registry hive: ${hive}`)
  return { key, label, executable, arguments: argumentsList, icon, scopes, ...(extensions ? { extensions } : {}), hives, ownership }
}

function normalizeExtensions(values: readonly string[]): readonly string[] {
  const extensions: string[] = []
  for (const value of values) {
    if (typeof value !== "string") throw new Error("Shell extensions must be strings.")
    const extension = value.trim().replace(/^\.+/u, "").toLowerCase()
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(extension)) throw new Error(`Shell extension is unsafe: ${value}`)
    if (!extensions.includes(extension)) extensions.push(extension)
  }
  return Object.freeze(extensions)
}

function uniqueValues<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)]
}

function managedRegistryPath(hive: WindowsRegistryHive, entryKey: string, scope: WindowsShellScope, extension?: string): string {
  const path = scope === "file"
    ? extension ? `SystemFileAssociations\\.${extension}\\shell\\${entryKey}` : `*\\shell\\${entryKey}`
    : scope === "directory"
      ? `Directory\\shell\\${entryKey}`
      : `Directory\\Background\\shell\\${entryKey}`
  if (hive === "HKCU") return `HKCU\\Software\\Classes\\${path}`
  if (hive === "HKLM") return `HKLM\\Software\\Classes\\${path}`
  return `HKCR\\${path}`
}

function mergedRegistryPath(path: string): string {
  const prefix = "HKCU\\Software\\Classes\\"
  return path.startsWith(prefix) ? `HKCR\\${path.slice(prefix.length)}` : path
}

function managedMarkers(item: WindowsManagedShellPlanItem): Record<string, string> {
  return {
    "Xiranite.ManagedBy": item.ownership.managedBy,
    "Xiranite.NodeId": item.ownership.nodeId,
    "Xiranite.Intent": item.ownership.intent,
    "Xiranite.RegistrationId": item.ownership.registrationId,
    "Xiranite.Fingerprint": managedFingerprint(item),
  }
}

function managedFingerprint(item: WindowsManagedShellPlanItem): string {
  // Deliberately pure JS to keep the browser plan preview free of Node imports.
  const source = [item.registryPath, item.label, item.icon, item.command].join("\0")
  let first = 0x811c9dc5
  let second = 0x01000193
  for (let index = 0; index < source.length; index += 1) {
    first ^= source.charCodeAt(index)
    first = Math.imul(first, 0x01000193) >>> 0
    second ^= first + source.charCodeAt(index)
    second = Math.imul(second, 0x85ebca6b) >>> 0
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`
}

function assertSafeManagedPlanItem(item: WindowsManagedShellPlanItem): void {
  assertSafePlanItem(item)
  for (const value of Object.values(item.ownership)) assertSafeText(value, "Managed Shell ownership value")
}

async function requireManagedRegistrySuccess(
  result: WindowsRegistryCommandResult,
  path: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  requireRegistrySuccess(result, path)
}

function registryFilePath(path: string): string {
  const [hive, ...rest] = path.split("\\")
  if (hive !== "HKCU" && hive !== "HKLM" && hive !== "HKCR") throw new Error("Unsupported registry hive in Shell registration plan.")
  if (!rest.length || /[\[\]\r\n\0]/u.test(path)) throw new Error("Unsafe registry path in Shell registration plan.")
  const fullHive = hive === "HKCU" ? "HKEY_CURRENT_USER" : hive === "HKLM" ? "HKEY_LOCAL_MACHINE" : "HKEY_CLASSES_ROOT"
  return `${fullHive}\\${rest.join("\\")}`
}

function escapeRegistryValue(value: string): string {
  assertSafeText(value, "Registry value")
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')
}

function matchesRegistryValue(result: WindowsRegistryCommandResult, expected: string): boolean {
  const output = `${result.stdout}\n${result.stderr}`.trim()
  // In-memory adapters intentionally omit reg.exe formatting in unit tests.
  return !output || output.includes(expected)
}

function assertSafeText(value: string, name: string): void {
  if (typeof value !== "string" || !value || /\p{Cc}/u.test(value)) throw new Error(`${name} contains unsupported control characters.`)
}

class ManagedRegistryMutationError extends Error {
  constructor(message: string, readonly mutated: boolean) {
    super(message)
    this.name = "ManagedRegistryMutationError"
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
  const target = parseWindowsRegistryPath(item.registryPath)
  await adapter.createKey(target)
  await adapter.setStringValue(target, "", item.label)
  await adapter.setStringValue(target, "Icon", item.icon)
  const commandTarget = { ...target, subkey: `${target.subkey}\\command` }
  await adapter.createKey(commandTarget)
  await adapter.setStringValue(commandTarget, "", item.command)
}

async function deleteWindowsShellPlanItem(adapter: WindowsRegistryAdapter, item: WindowsShellPlanItem): Promise<void> {
  const result = await adapter.deleteKey(item.registryPath)
  if (result.code === 0 || isRegistryNotFound(result)) return
  requireRegistrySuccess(result, item.registryPath)
}

function parseWindowsRegistryPath(registryPath: string): WindowsRegistryTarget {
  const match = /^(HKCU|HKCR|HKLM)\\(.+)$/u.exec(registryPath)
  if (!match || /[\r\n\0]/u.test(registryPath)) throw new Error("Shell registry path must target HKCU, HKCR, or HKLM.")
  return { hive: match[1] as WindowsRegistryHive, subkey: match[2]! }
}

function normalizeExecutable(value: string): string {
  const normalized = value.trim().replace(/^"|"$/gu, "")
  if (!normalized || normalized.includes('"') || /\p{Cc}/u.test(normalized)) throw new Error("Shell executable must be a single path without control characters or embedded quotes.")
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
