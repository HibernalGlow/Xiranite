import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { parse } from "smol-toml"

export type OwithuAction = "preview" | "register" | "unregister"
export type RegistryHive = "HKCU" | "HKCR" | "HKLM"
export type OwithuScope = "file" | "directory" | "background"

export interface OwithuInput {
  action?: OwithuAction
  path?: string
  configText?: string
  hive?: RegistryHive | ""
  onlyKey?: string
}

export interface OwithuEntry {
  key: string
  label: string
  exe: string
  args: string[]
  icon: string
  scope: OwithuScope[]
  enabled: boolean
  hives?: RegistryHive[]
}

export interface OwithuDefaults {
  enabled: boolean
  hives?: RegistryHive[]
}

export interface OwithuConfig {
  vars: Record<string, string>
  defaults: OwithuDefaults
  entries: OwithuEntry[]
}

export interface OwithuRegistryPlanItem {
  entryKey: string
  hive: RegistryHive
  scope: OwithuScope
  registryPath: string
  label: string
  icon: string
  command: string
  enabled: boolean
}

export interface OwithuApplyResult {
  successCount: number
  failedCount: number
  errors: string[]
}

export interface OwithuData {
  vars: Record<string, string>
  defaults: OwithuDefaults
  entries: OwithuEntry[]
  plan: OwithuRegistryPlanItem[]
  registeredCount: number
  unregisteredCount: number
  failedCount: number
  errors: string[]
}

export interface OwithuRuntime {
  readConfig: (path: string) => Promise<string>
  applyRegistryPlan: (
    plan: OwithuRegistryPlanItem[],
    action: Extract<OwithuAction, "register" | "unregister">,
    onEvent?: (event: NodeRunEvent) => void,
  ) => Promise<OwithuApplyResult>
}

export type OwithuResult = NodeRunResult<OwithuData>

const scopes: OwithuScope[] = ["file", "directory", "background"]
const hives: RegistryHive[] = ["HKCU", "HKCR", "HKLM"]

export function normalizeOwithuInput(input: OwithuInput): Required<OwithuInput> {
  return {
    action: input.action ?? "preview",
    path: normalizeText(input.path),
    configText: input.configText ?? "",
    hive: input.hive ?? "",
    onlyKey: normalizeText(input.onlyKey),
  }
}

export function parseOwithuConfig(content: string): OwithuConfig {
  const data = asRecord(parse(stripBom(content)))
  const vars = stringRecord(asRecord(data.vars))
  const defaultsRaw = asRecord(data.defaults)
  const defaultHives = readHiveArray(defaultsRaw.hives)
  const defaults: OwithuDefaults = {
    enabled: booleanValue(defaultsRaw.enabled, true),
    ...(defaultHives.length ? { hives: defaultHives } : {}),
  }

  const entries = arrayValue(data.entries).map((item, index) => normalizeEntry(asRecord(item), vars, defaults, index))
  return { vars, defaults, entries }
}

export function buildOwithuPlan(
  config: OwithuConfig,
  options: { action?: OwithuAction; hive?: RegistryHive | ""; onlyKey?: string } = {},
): OwithuRegistryPlanItem[] {
  const onlyKey = normalizeText(options.onlyKey).toLowerCase()
  const action = options.action ?? "preview"
  const plan: OwithuRegistryPlanItem[] = []

  for (const entry of config.entries) {
    if (onlyKey && entry.key.toLowerCase() !== onlyKey) continue
    if (action === "register" && !entry.enabled) continue

    const hivesToUse = options.hive ? [options.hive] : (entry.hives ?? config.defaults.hives ?? ["HKCU"])
    for (const hive of hivesToUse) {
      for (const scope of entry.scope) {
        const args = entry.args.map((arg) => (arg === "%1" && scope !== "file" ? "%V" : arg))
        plan.push({
          entryKey: entry.key,
          hive,
          scope,
          registryPath: registryPath(hive, entry.key, scope),
          label: entry.label,
          icon: entry.icon,
          command: buildCommand(entry.exe, args),
          enabled: entry.enabled,
        })
      }
    }
  }

  return plan
}

export async function runOwithu(
  input: OwithuInput,
  runtime: OwithuRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<OwithuResult> {
  const normalized = normalizeOwithuInput(input)
  if (!normalized.configText && !normalized.path) return failure("Config path or pasted TOML content is required.")

  let content = normalized.configText
  if (!content) {
    onEvent({ type: "progress", progress: 20, message: `Loading ${normalized.path}` })
    content = await runtime.readConfig(normalized.path)
  }

  let config: OwithuConfig
  try {
    config = parseOwithuConfig(content)
  } catch (error) {
    return failure(`Config parse failed: ${errorMessage(error)}`)
  }

  const plan = buildOwithuPlan(config, {
    action: normalized.action,
    hive: normalized.hive,
    onlyKey: normalized.onlyKey,
  })

  if (normalized.action === "preview") {
    onEvent({ type: "progress", progress: 100, message: `Loaded ${config.entries.length} entries.` })
    return success(`Found ${config.entries.length} entries and ${plan.length} registry operations.`, {
      vars: config.vars,
      defaults: config.defaults,
      entries: config.entries,
      plan,
    })
  }

  onEvent({ type: "progress", progress: 40, message: `${normalized.action} ${plan.length} registry key(s).` })
  const applied = await runtime.applyRegistryPlan(plan, normalized.action, onEvent)
  const registeredCount = normalized.action === "register" ? applied.successCount : 0
  const unregisteredCount = normalized.action === "unregister" ? applied.successCount : 0
  const ok = applied.failedCount === 0

  return {
    success: ok,
    message: `${normalized.action} completed: ${applied.successCount} success, ${applied.failedCount} failed.`,
    data: data({
      vars: config.vars,
      defaults: config.defaults,
      entries: config.entries,
      plan,
      registeredCount,
      unregisteredCount,
      failedCount: applied.failedCount,
      errors: applied.errors,
    }),
  }
}

export function buildCommand(exe: string, args: string[]): string {
  const exePart = exe.startsWith("\"") ? exe : `"${exe}"`
  const argPart = args.map(quoteArg).join(" ")
  return argPart ? `${exePart} ${argPart}` : exePart
}

export function registryPath(hive: RegistryHive, entryKey: string, scope: OwithuScope): string {
  const scopedPath =
    scope === "file"
      ? `*\\shell\\${entryKey}`
      : scope === "directory"
        ? `Directory\\shell\\${entryKey}`
        : `Directory\\Background\\shell\\${entryKey}`

  if (hive === "HKCU") return `HKCU\\Software\\Classes\\${scopedPath}`
  if (hive === "HKLM") return `HKLM\\Software\\Classes\\${scopedPath}`
  return `HKCR\\${scopedPath}`
}

function normalizeEntry(raw: Record<string, unknown>, vars: Record<string, string>, defaults: OwithuDefaults, index: number): OwithuEntry {
  const key = stringValue(raw.key)
  if (!key) throw new Error(`entries[${index}].key is required`)
  const exeTemplate = stringValue(raw.exe)
  if (!exeTemplate) throw new Error(`entries[${index}].exe is required`)

  const label = stringValue(raw.label) || key
  const exe = normalizeWindowsPath(formatTemplate(exeTemplate, vars))
  const icon = normalizeWindowsPath(formatTemplate(stringValue(raw.icon) || exeTemplate, vars))
  const entryScopes = readScopeArray(raw.scope)
  const entryHives = readHiveArray(raw.hives)

  return {
    key,
    label,
    exe,
    args: readStringArray(raw.args).map((arg) => formatTemplate(arg, vars)),
    icon,
    scope: entryScopes.length ? entryScopes : ["file"],
    enabled: booleanValue(raw.enabled, defaults.enabled),
    ...(entryHives.length ? { hives: entryHives } : {}),
  }
}

function readScopeArray(value: unknown): OwithuScope[] {
  const out: OwithuScope[] = []
  for (const item of readStringArray(value)) {
    if (item === "all") {
      out.push(...scopes)
      continue
    }
    if (!isScope(item)) throw new Error(`Unsupported scope: ${item}`)
    out.push(item)
  }
  return [...new Set(out)]
}

function readHiveArray(value: unknown): RegistryHive[] {
  const out: RegistryHive[] = []
  for (const item of readStringArray(value)) {
    const hive = item.toUpperCase()
    if (!isHive(hive)) throw new Error(`Unsupported hive: ${item}`)
    out.push(hive)
  }
  return [...new Set(out)]
}

function quoteArg(arg: string): string {
  if (arg === "%1" || arg === "%V") return `"${arg}"`
  if ((arg.startsWith("\"") && arg.endsWith("\"")) || !/\s/.test(arg)) return arg
  return `"${arg}"`
}

function formatTemplate(value: string, vars: Record<string, string>): string {
  return value.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key: string) => vars[key] ?? match)
}

function normalizeWindowsPath(value: string): string {
  return value.replace(/\//g, "\\")
}

function normalizeText(value?: string): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "")
}

function data(partial: Partial<OwithuData>): OwithuData {
  return {
    vars: {},
    defaults: { enabled: true },
    entries: [],
    plan: [],
    registeredCount: 0,
    unregisteredCount: 0,
    failedCount: 0,
    errors: [],
    ...partial,
  }
}

function success(message: string, partial: Partial<OwithuData>): OwithuResult {
  return { success: true, message, data: data(partial) }
}

function failure(message: string): OwithuResult {
  return { success: false, message, data: data({ errors: [message] }) }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringRecord(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, String(val)]))
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item).trim()).filter(Boolean)
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function isScope(value: string): value is OwithuScope {
  return scopes.includes(value as OwithuScope)
}

function isHive(value: string): value is RegistryHive {
  return hives.includes(value as RegistryHive)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value
}
