import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type SmartZipAction = "status" | "extract" | "extract_codepage" | "open" | "archive"

export interface SmartZipInput {
  action?: SmartZipAction
  paths?: string[]
  path?: string
  iniPath?: string
  iniText?: string
  codePage?: number
  databasePath?: string
  recordRun?: boolean
  dryRun?: boolean
}

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

export interface SmartZipCommandPlan {
  label: string
  command: string
  args: string[]
  displayArgs?: string[]
  detached?: boolean
}

export interface SmartZipTools {
  cli: string
  fileManager?: string
}

export interface SmartZipRule {
  match: string
  replacement: string
}

export interface SmartZipOperationResult {
  sourcePath: string
  outputPath?: string
  action: Exclude<SmartZipAction, "status">
  status: "completed" | "skipped" | "error"
  message: string
  command?: SmartZipCommandPlan
  commandResult?: CommandResult
  passwordUsed?: boolean
}

export interface SmartZipConfig {
  sevenZipDir: string
  passwords: string[]
  archiveExtensions: string[]
  archiveExtensionPatterns: string[]
  openArchiveExtensions: string[]
  codePages: number[]
  targetDir: string
  skipMultipart: boolean
  nestedExtraction: boolean
  nestedExtractionForMultiple: boolean
  deleteSource: boolean
  deleteSourceWhenPassword: boolean
  addDirectoryAsPassword: boolean
  excludeExtensions: string[]
  excludeNames: string[]
  renameExtensions: SmartZipRule[]
  renameNames: SmartZipRule[]
  renamePatterns: SmartZipRule[]
  deletePatterns: string[]
  archiveArgs: string
  openArchiveArgs: string
  contextMenu: boolean
  sendTo: boolean
}

export interface SmartZipDatabase {
  path: string
  enabled: boolean
  mode: "jsonl"
  defaultPath: boolean
}

export interface SmartZipData {
  config: SmartZipConfig
  database?: SmartZipDatabase
  command?: SmartZipCommandPlan
  commandResult?: CommandResult
  operations?: SmartZipOperationResult[]
  selectedPaths: string[]
  archiveCount: number
  errors: string[]
}

export interface SmartZipRuntime {
  readText: (path: string) => Promise<string>
  appendRecord: (path: string, record: unknown) => Promise<void>
  find7z: (configuredDirectory?: string) => Promise<SmartZipTools | null>
  execute: (request: SmartZipExecutionRequest, onEvent: (event: NodeRunEvent) => void) => Promise<SmartZipOperationResult[]>
}

export interface SmartZipExecutionRequest {
  action: Exclude<SmartZipAction, "status">
  paths: string[]
  config: SmartZipConfig
  tools: SmartZipTools
  codePage?: number
}

export type SmartZipResult = NodeRunResult<SmartZipData>

export const SMARTZIP_ARCHIVE_EXTENSIONS = ["zip", "7z", "rar", "tar", "gz", "bz2", "xz", "cbz", "cbr", "iso"]

export function normalizeSmartZipInput(input: SmartZipInput): Required<SmartZipInput> {
  return {
    action: input.action ?? "status",
    paths: uniqueClean([input.path, ...(input.paths ?? [])]),
    path: clean(input.path),
    iniPath: clean(input.iniPath),
    iniText: input.iniText ?? "",
    codePage: Number.isInteger(input.codePage) && Number(input.codePage) > 0 ? Number(input.codePage) : 0,
    databasePath: clean(input.databasePath),
    recordRun: input.recordRun ?? Boolean(input.databasePath),
    dryRun: input.dryRun ?? false,
  }
}

export async function runSmartZip(
  input: SmartZipInput,
  runtime: SmartZipRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<SmartZipResult> {
  const normalized = normalizeSmartZipInput(input)
  try {
    onEvent({ type: "progress", progress: 20, message: "Loading SmartZip config." })
    const config = parseSmartZipIni(normalized.iniText || (normalized.iniPath ? await runtime.readText(normalized.iniPath) : ""))
    const selectedPaths = normalized.paths
    const database = buildSmartZipDatabase(normalized)
    if (normalized.action === "status") {
      await writeSmartZipRecordIfEnabled("status", normalized, config, selectedPaths, undefined, undefined, database, runtime)
      return success(`SmartZip status loaded: ${config.archiveExtensions.length} archive extension(s).`, {
        config,
        database,
        selectedPaths,
      })
    }
    if (!selectedPaths.length) return failure("At least one archive or directory path is required.")
    const tools = normalized.dryRun ? { cli: "7z", fileManager: "7zFM" } : await runtime.find7z(config.sevenZipDir)
    if (!tools) return failure("7-Zip was not found. Install 7-Zip or add 7z to PATH; SmartZip.exe and AutoHotkey are never required.")
    const plans = selectedPaths.map((path) => buildSmartZipCommand({ ...normalized, paths: [path], path }, tools.cli))
    const command = plans[0]
    if (normalized.dryRun) {
      await writeSmartZipRecordIfEnabled(normalized.action, normalized, config, selectedPaths, command, undefined, database, runtime)
      const operations = selectedPaths.map((sourcePath, index): SmartZipOperationResult => ({
        sourcePath,
        action: normalized.action as Exclude<SmartZipAction, "status">,
        status: "completed",
        message: "Planned",
        command: plans[index],
      }))
      return success(`SmartZip dry-run: ${plans.length} TypeScript-planned operation(s).`, { config, database, selectedPaths, command, operations })
    }
    const operations = await runtime.execute({
      action: normalized.action as Exclude<SmartZipAction, "status">,
      paths: selectedPaths,
      config,
      tools,
      codePage: normalized.action === "extract_codepage" ? (normalized.codePage || 936) : undefined,
    }, onEvent)
    const results = operations.map((operation) => operation.commandResult).filter((result): result is CommandResult => Boolean(result))
    const commandResult = combineResults(results)
    const errors = operations.filter((operation) => operation.status === "error").map((operation) => `${operation.sourcePath}: ${operation.message}`)
    await writeSmartZipRecordIfEnabled(normalized.action, normalized, config, selectedPaths, command, commandResult, database, runtime)
    return {
      success: errors.length === 0,
      message: errors.length === 0 ? `Completed ${operations.length} SmartZip workflow operation(s).` : `${errors.length} SmartZip workflow operation(s) failed.`,
      data: data({ config, database, selectedPaths, command: operations[0]?.command ?? command, commandResult, operations, errors }),
    }
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

export const runSmartzip = runSmartZip

export function parseSmartZipIni(text: string): SmartZipConfig {
  const sections = parseIni(text)
  const set = sections.set ?? {}
  const menu = sections.menu ?? {}
  return {
    sevenZipDir: set.zipDir ?? set["7zipDir"] ?? "auto",
    passwords: [...new Set([sections.temp?.lastPass ?? "", ...numberedValues(sections.password)].filter(Boolean))],
    archiveExtensions: withDefaults(numberedValues(sections.ext), ["zip", "rar", "7z", "001", "cab", "bz2", "gz", "gzip", "tar"]).map(extension),
    archiveExtensionPatterns: withDefaults(numberedValues(sections.extExp), ["^\\d+$", "zi", "7", "z"]),
    openArchiveExtensions: withDefaults(numberedValues(sections.extForOpen), ["iso", "apk", "wim", "exe"]).map(extension),
    codePages: numberedValues(sections.codepage).map(Number).filter((value) => Number.isInteger(value) && value > 0),
    targetDir: set.targetDir ?? "",
    skipMultipart: boolValue(set.partSkip, true),
    nestedExtraction: boolValue(set.nesting, true),
    nestedExtractionForMultiple: boolValue(set.nestingMuilt, false),
    deleteSource: boolValue(set.delSource, false),
    deleteSourceWhenPassword: boolValue(set.delWhenHasPass, false),
    addDirectoryAsPassword: boolValue(set.addDir2Pass, false),
    excludeExtensions: numberedValues(sections.excludeExt).map(extension),
    excludeNames: numberedValues(sections.excludeName),
    renameExtensions: ruleValues(sections.renameExt),
    renameNames: ruleValues(sections.renameName),
    renamePatterns: ruleValues(sections.renameExp),
    deletePatterns: numberedValues(sections.deleteExp),
    archiveArgs: sections["7z"]?.add ?? '.zip"',
    openArchiveArgs: sections["7z"]?.openAdd ?? '.zip" -tzip -mx=0 -aou -ad',
    contextMenu: boolValue(menu.contextMenu, true),
    sendTo: boolValue(menu.sendTo, true),
  }
}

export function buildSmartZipCommand(input: Required<SmartZipInput>, executable = "7z"): SmartZipCommandPlan {
  const source = input.paths[0] ?? input.path
  if (input.action === "open") return { label: `Smart-open ${source}`, command: "7zFM", args: [source] }
  if (input.action === "archive") return { label: `Archive ${source}`, command: executable, args: ["a", archiveOutput(source), source, "-y", "-sccUTF-8"] }
  const args = ["x", source, `-o${extractOutput(source)}`, "-y", "-sccUTF-8"]
  if (input.action === "extract_codepage") args.push(`-mcp=${input.codePage || 936}`)
  return { label: `Extract ${source}`, command: executable, args }
}

export function actionMode(action: SmartZipAction): string {
  if (action === "extract") return "x"
  if (action === "extract_codepage") return "xc"
  if (action === "open") return "o"
  if (action === "archive") return "a"
  return ""
}

function extractOutput(path: string): string {
  return path.replace(/\.(zip|7z|rar|tar|gz|bz2|xz|cbz|cbr|iso)$/i, "")
}

function archiveOutput(path: string): string {
  return `${path.replace(/[\\/]+$/g, "")}.zip`
}

function combineResults(results: CommandResult[]): CommandResult {
  return { code: results.some((result) => result.code !== 0) ? 1 : 0, stdout: results.map((result) => result.stdout).filter(Boolean).join("\n"), stderr: results.map((result) => result.stderr).filter(Boolean).join("\n") }
}

export function isArchivePath(path: string, extensions = SMARTZIP_ARCHIVE_EXTENSIONS): boolean {
  const lower = path.toLowerCase()
  return extensions.some((extension) => lower.endsWith(`.${extension.toLowerCase().replace(/^\./, "")}`))
}

export function buildSmartZipDatabase(input: Required<SmartZipInput>): SmartZipDatabase | undefined {
  const path = input.databasePath || defaultSmartZipDatabasePath(input)
  if (!path) return undefined
  return {
    path,
    enabled: input.recordRun,
    mode: "jsonl",
    defaultPath: !input.databasePath,
  }
}

export function defaultSmartZipDatabasePath(input: Pick<Required<SmartZipInput>, "paths" | "iniPath">): string {
  const base = input.paths[0] ? pathBaseFor(input.paths[0]!) : input.iniPath ? dirnameLike(input.iniPath) : ""
  return base ? joinLike(base, ".xiranite", "smartzip-runs.jsonl") : ""
}

export function buildSmartZipRunRecord(
  action: SmartZipAction,
  input: Pick<Required<SmartZipInput>, "paths" | "iniPath" | "dryRun">,
  config: SmartZipConfig,
  selectedPaths: string[],
  command: SmartZipCommandPlan | undefined,
  commandResult?: CommandResult,
): Record<string, unknown> {
  return {
    toolId: "smartzip",
    action,
    iniPath: input.iniPath || undefined,
    dryRun: input.dryRun,
    selectedPaths,
    archiveCount: selectedPaths.filter((path) => isArchivePath(path, config.archiveExtensions.length ? config.archiveExtensions : SMARTZIP_ARCHIVE_EXTENSIONS)).length,
    config: {
      sevenZipDir: config.sevenZipDir,
      archiveExtensions: config.archiveExtensions,
      passwordCount: config.passwords.length,
      contextMenu: config.contextMenu,
      sendTo: config.sendTo,
    },
    command,
    success: commandResult ? commandResult.code === 0 : true,
    code: commandResult?.code,
    stdoutLength: commandResult?.stdout.length,
    stderrLength: commandResult?.stderr.length,
    at: new Date().toISOString(),
  }
}

async function writeSmartZipRecordIfEnabled(
  action: SmartZipAction,
  input: Required<SmartZipInput>,
  config: SmartZipConfig,
  selectedPaths: string[],
  command: SmartZipCommandPlan | undefined,
  commandResult: CommandResult | undefined,
  database: SmartZipDatabase | undefined,
  runtime: Pick<SmartZipRuntime, "appendRecord">,
): Promise<void> {
  if (!database?.enabled) return
  await runtime.appendRecord(database.path, buildSmartZipRunRecord(action, input, config, selectedPaths, command, commandResult))
}

function parseIni(text: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {}
  let current = "set"
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith(";") || line.startsWith("#")) continue
    const section = /^\[([^\]]+)\]$/.exec(line)
    if (section) {
      current = section[1]!.trim()
      sections[current] ??= {}
      continue
    }
    const index = line.indexOf("=")
    if (index < 0) continue
    sections[current] ??= {}
    sections[current]![line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return sections
}

function numberedValues(section?: Record<string, string>): string[] {
  if (!section) return []
  return Object.entries(section)
    .filter(([key]) => /^\d+$/.test(key))
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, value]) => value)
}

function ruleValues(section?: Record<string, string>): SmartZipRule[] {
  return numberedValues(section).map((value) => {
    const separator = value.indexOf("<--->")
    return separator < 0
      ? { match: value, replacement: "" }
      : { match: value.slice(0, separator), replacement: value.slice(separator + 5) }
  }).filter((rule) => Boolean(rule.match))
}

function withDefaults(values: string[], defaults: string[]): string[] {
  return values.length ? values : defaults
}

function extension(value: string): string {
  return value.replace(/^\./, "").toLowerCase()
}

function boolValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return value === "1" || value.toLowerCase() === "true"
}

function pathBaseFor(path: string): string {
  return isArchivePath(path) || /\.[^\\/]+$/.test(path) ? dirnameLike(path) : path
}

function dirnameLike(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  const index = normalized.lastIndexOf("/")
  if (index > 0) return normalized.slice(0, index)
  if (index === 0) return "/"
  return "."
}

function joinLike(...parts: string[]): string {
  return parts
    .map((part, index) => {
      const value = index === 0 ? clean(part).replace(/[\\/]+$/g, "") : clean(part).replace(/^[\\/]+|[\\/]+$/g, "")
      return value === "." ? "" : value
    })
    .filter(Boolean)
    .join("/")
}

function data(partial: Partial<SmartZipData>): SmartZipData {
  const selectedPaths = partial.selectedPaths ?? []
  const config = partial.config ?? parseSmartZipIni("")
  return {
    ...partial,
    config: { ...config, passwords: config.passwords.map(() => "••••") },
    selectedPaths,
    archiveCount: selectedPaths.filter((path) => isArchivePath(path, config.archiveExtensions.length ? config.archiveExtensions : SMARTZIP_ARCHIVE_EXTENSIONS)).length,
    errors: partial.errors ?? [],
  }
}

function success(message: string, partial: Partial<SmartZipData>): SmartZipResult {
  return { success: true, message, data: data(partial) }
}

function failure(message: string): SmartZipResult {
  return { success: false, message, data: data({ errors: [message] }) }
}

function uniqueClean(values: Array<string | undefined>): string[] {
  return [...new Set(values.map(clean).filter(Boolean))]
}

function clean(value?: string): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "")
}
