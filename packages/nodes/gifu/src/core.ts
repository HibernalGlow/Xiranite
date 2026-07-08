import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type GifuAction = "inspect" | "plan" | "make"
export type GifuFormat = "auto" | "gif" | "webp" | "apng" | "webm" | "mp4"
export type GifuOutputMode = "same" | "separate"

export interface GifuInput {
  action?: GifuAction
  paths?: string[]
  path?: string
  listText?: string
  configPath?: string
  configText?: string
  databasePath?: string
  recordRun?: boolean
  recursive?: boolean
  format?: GifuFormat
  outDir?: string
  outMode?: GifuOutputMode
  namePrefix?: string
  nameTemplate?: string
  durationMs?: number
  maxWorkers?: number
  extractSingle?: boolean
  overwrite?: boolean
  dryRun?: boolean
  python?: string
  moduleName?: string
  sourceRoot?: string
}

export interface GifuPathInfo {
  path: string
  exists: boolean
  isFile: boolean
  isDirectory: boolean
}

export interface GifuDirEntry {
  name: string
  path: string
  isFile: boolean
  isDirectory: boolean
}

export interface GifuArchivePlan {
  archivePath: string
  outputPath: string
  imageCount: number
  status: "ready" | "single" | "empty"
}

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

export interface GifuCommandPlan {
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
}

export interface GifuConfigSummary {
  path: string
  keys: string[]
  tables: string[]
}

export interface GifuDatabase {
  path: string
  enabled: boolean
  mode: "jsonl"
  defaultPath: boolean
}

export interface GifuData {
  archives: GifuArchivePlan[]
  config?: GifuConfigSummary
  database?: GifuDatabase
  command?: GifuCommandPlan
  commandResult?: CommandResult
  readyCount: number
  singleCount: number
  emptyCount: number
  errors: string[]
}

export interface GifuRuntime {
  readText: (path: string) => Promise<string>
  appendRecord: (path: string, record: unknown) => Promise<void>
  pathInfo: (path: string) => Promise<GifuPathInfo>
  listDir: (path: string) => Promise<GifuDirEntry[]>
  countArchiveImages: (path: string) => Promise<number>
  runCommand: (plan: GifuCommandPlan) => Promise<CommandResult>
  join: (...parts: string[]) => string
  dirname: (path: string) => string
  basename: (path: string) => string
  extname: (path: string) => string
}

export type GifuResult = NodeRunResult<GifuData>

export const GIFU_ARCHIVE_EXTENSIONS = [
  ".zip",
  ".cbz",
  ".tar",
  ".tgz",
  ".tar.gz",
  ".tar.bz2",
  ".tbz2",
  ".tar.xz",
  ".txz",
]

export function normalizeGifuInput(input: GifuInput): Required<GifuInput> {
  const paths = uniqueClean([input.path, ...(input.paths ?? []), ...parsePathList(input.listText ?? "")])
  return {
    action: input.action ?? "inspect",
    path: clean(input.path),
    paths,
    listText: input.listText ?? "",
    configPath: clean(input.configPath),
    configText: input.configText ?? "",
    databasePath: clean(input.databasePath),
    recordRun: input.recordRun ?? Boolean(input.databasePath),
    recursive: input.recursive ?? true,
    format: input.format ?? "webp",
    outDir: clean(input.outDir),
    outMode: input.outMode ?? "same",
    namePrefix: input.namePrefix ?? "",
    nameTemplate: input.nameTemplate ?? "{prefix}{stem}",
    durationMs: input.durationMs ?? 120,
    maxWorkers: input.maxWorkers ?? 0,
    extractSingle: input.extractSingle ?? true,
    overwrite: input.overwrite ?? false,
    dryRun: input.dryRun ?? false,
    python: clean(input.python) || "python",
    moduleName: clean(input.moduleName) || "gifu",
    sourceRoot: clean(input.sourceRoot),
  }
}

export async function runGifu(
  input: GifuInput,
  runtime: GifuRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<GifuResult> {
  const configInput = await loadGifuConfigInput(input, runtime)
  const normalized = normalizeGifuInput(mergeGifuConfigInput(configInput, input))
  try {
    if (!normalized.paths.length) return failure("At least one archive, directory, or list entry is required.")
    const config = await loadGifuConfigSummary(normalized, runtime)
    onEvent({ type: "progress", progress: 15, message: "Collecting archives." })
    const archivePaths = await collectArchives(normalized.paths, normalized.recursive, runtime)
    onEvent({ type: "progress", progress: 45, message: `Inspecting ${archivePaths.length} archive(s).` })
    const archives: GifuArchivePlan[] = []
    for (const archivePath of archivePaths) {
      const imageCount = await runtime.countArchiveImages(archivePath)
      archives.push({
        archivePath,
        outputPath: buildOutputPath(archivePath, normalized, runtime),
        imageCount,
        status: imageCount >= 2 ? "ready" : imageCount === 1 ? "single" : "empty",
      })
    }
    const database = buildGifuDatabase(normalized, archives, runtime)
    if (normalized.action !== "make" || normalized.dryRun) {
      const command = buildGifuCommand(normalized)
      const action = normalized.action === "make" && normalized.dryRun ? "plan" : normalized.action
      await writeGifuRecordIfEnabled(action, normalized, archives, command, undefined, database, runtime)
      return success(`Gifu planned ${archives.length} archive(s).`, { archives, config, database, command })
    }

    onEvent({ type: "progress", progress: 70, message: "Running gifu Python module." })
    const command = buildGifuCommand(normalized)
    const commandResult = await runtime.runCommand(command)
    await writeGifuRecordIfEnabled("make", normalized, archives, command, commandResult, database, runtime)
    return {
      success: commandResult.code === 0,
      message: commandResult.code === 0 ? "Gifu conversion completed." : "Gifu conversion failed.",
      data: data({ archives, config, database, command, commandResult, errors: commandResult.code === 0 ? [] : [commandResult.stderr || commandResult.stdout] }),
    }
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

export async function loadGifuConfigInput(input: GifuInput, runtime: Pick<GifuRuntime, "readText">): Promise<GifuInput> {
  const text = input.configText || (input.configPath ? await runtime.readText(input.configPath) : "")
  if (!text.trim()) return {}
  return parseGifuTomlConfig(text)
}

export async function loadGifuConfigSummary(input: Required<GifuInput>, runtime: Pick<GifuRuntime, "readText">): Promise<GifuConfigSummary | undefined> {
  const text = input.configText || (input.configPath ? await runtime.readText(input.configPath) : "")
  if (!text.trim()) return undefined
  const parsed = parseTomlLikeKeys(text)
  return { path: input.configPath, keys: parsed.keys, tables: parsed.tables }
}

export function mergeGifuConfigInput(config: GifuInput, input: GifuInput): GifuInput {
  return {
    ...config,
    ...input,
    paths: input.paths ?? config.paths,
  }
}

export function parseGifuTomlConfig(text: string): GifuInput {
  const values = parseTomlLikeValues(text)
  return {
    path: stringValue(values.path),
    paths: arrayValue(values.paths),
    listText: stringValue(values.listText),
    recursive: booleanValue(values.recursive),
    format: enumValue(values.format, ["auto", "gif", "webp", "apng", "webm", "mp4"]),
    outDir: stringValue(values.outDir),
    outMode: enumValue(values.outMode, ["same", "separate"]),
    namePrefix: stringValue(values.namePrefix),
    nameTemplate: stringValue(values.nameTemplate),
    durationMs: numberValue(values.durationMs),
    maxWorkers: numberValue(values.maxWorkers),
    extractSingle: booleanValue(values.extractSingle),
    overwrite: booleanValue(values.overwrite),
    python: stringValue(values.python),
    moduleName: stringValue(values.moduleName),
    sourceRoot: stringValue(values.sourceRoot),
    databasePath: stringValue(values.databasePath),
    recordRun: booleanValue(values.recordRun),
  }
}

export function parseTomlLikeKeys(text: string): { keys: string[]; tables: string[] } {
  const keys = new Set<string>()
  const tables = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const table = /^\[+([^\]]+)\]+$/.exec(line)
    if (table) {
      tables.add(table[1]!.trim())
      continue
    }
    const index = line.indexOf("=")
    if (index > 0) keys.add(line.slice(0, index).trim())
  }
  return { keys: [...keys].sort(), tables: [...tables].sort() }
}

export function buildGifuDatabase(input: Required<GifuInput>, archives: GifuArchivePlan[], runtime: Pick<GifuRuntime, "dirname" | "join">): GifuDatabase | undefined {
  const path = input.databasePath || defaultGifuDatabasePath(input, archives, runtime)
  if (!path) return undefined
  return {
    path,
    enabled: input.recordRun,
    mode: "jsonl",
    defaultPath: !input.databasePath,
  }
}

export function defaultGifuDatabasePath(input: Pick<Required<GifuInput>, "paths" | "outDir">, archives: GifuArchivePlan[], runtime: Pick<GifuRuntime, "dirname" | "join">): string {
  const fallback = input.paths[0] ?? ""
  const base = input.outDir || (archives[0] ? runtime.dirname(archives[0].archivePath) : isGifuArchive(fallback) ? runtime.dirname(fallback) : fallback)
  return base ? runtime.join(base, ".xiranite", "gifu-runs.jsonl") : ""
}

export function buildGifuRunRecord(
  action: GifuAction,
  input: Pick<Required<GifuInput>, "paths" | "recursive" | "format" | "outMode" | "outDir" | "durationMs" | "maxWorkers" | "extractSingle" | "overwrite" | "dryRun">,
  archives: GifuArchivePlan[],
  command: GifuCommandPlan,
  commandResult?: CommandResult,
): Record<string, unknown> {
  return {
    toolId: "gifu",
    action,
    paths: input.paths,
    options: {
      recursive: input.recursive,
      format: input.format,
      outMode: input.outMode,
      outDir: input.outDir || undefined,
      durationMs: input.durationMs,
      maxWorkers: input.maxWorkers,
      extractSingle: input.extractSingle,
      overwrite: input.overwrite,
      dryRun: input.dryRun,
    },
    archiveCount: archives.length,
    readyCount: archives.filter((item) => item.status === "ready").length,
    singleCount: archives.filter((item) => item.status === "single").length,
    emptyCount: archives.filter((item) => item.status === "empty").length,
    command,
    success: commandResult ? commandResult.code === 0 : true,
    code: commandResult?.code,
    stdoutLength: commandResult?.stdout.length,
    stderrLength: commandResult?.stderr.length,
    at: new Date().toISOString(),
  }
}

export async function collectArchives(paths: string[], recursive: boolean, runtime: GifuRuntime): Promise<string[]> {
  const found: string[] = []
  const seen = new Set<string>()
  async function add(path: string) {
    if (seen.has(path)) return
    seen.add(path)
    found.push(path)
  }
  async function visit(path: string) {
    const info = await runtime.pathInfo(path)
    if (!info.exists) return
    if (info.isFile) {
      if (isGifuArchive(info.path)) await add(info.path)
      return
    }
    if (!info.isDirectory) return
    for (const entry of await runtime.listDir(info.path)) {
      if (entry.isFile && isGifuArchive(entry.path)) await add(entry.path)
      else if (recursive && entry.isDirectory) await visit(entry.path)
    }
  }
  for (const path of paths) await visit(path)
  return found.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
}

export function buildGifuCommand(input: Required<GifuInput>): GifuCommandPlan {
  const args = ["-m", input.moduleName, "make", ...input.paths]
  args.push("--format", input.format)
  args.push(input.recursive ? "--recursive" : "--no-recursive")
  args.push("--duration", String(input.durationMs))
  args.push("--max-workers", String(input.maxWorkers))
  args.push("--out-mode", input.outMode)
  if (input.outDir) args.push("--out-dir", input.outDir)
  if (input.namePrefix) args.push("--name-prefix", input.namePrefix)
  if (input.nameTemplate) args.push("--name-template", input.nameTemplate)
  if (input.extractSingle) args.push("--extract-single")
  else args.push("--no-extract-single")
  if (input.overwrite) args.push("--overwrite")
  const env = input.sourceRoot ? { PYTHONPATH: input.sourceRoot } : undefined
  return { command: input.python, args, ...(input.sourceRoot ? { cwd: input.sourceRoot, env } : {}) }
}

export function buildOutputPath(archivePath: string, input: Required<GifuInput>, runtime: Pick<GifuRuntime, "dirname" | "basename" | "join">): string {
  const ext = input.format === "auto" ? ".webp" : `.${input.format}`
  const parent = runtime.dirname(archivePath)
  const archive = runtime.basename(archivePath)
  const stem = stripArchiveExtension(archive)
  const outputName = sanitizeOutputStem(renderTemplate(input.nameTemplate, { prefix: input.namePrefix, stem, archive, parent: runtime.basename(parent) })) + ext
  if (input.outDir) return runtime.join(input.outDir, outputName)
  return runtime.join(parent, outputName)
}

async function writeGifuRecordIfEnabled(
  action: GifuAction,
  input: Required<GifuInput>,
  archives: GifuArchivePlan[],
  command: GifuCommandPlan,
  commandResult: CommandResult | undefined,
  database: GifuDatabase | undefined,
  runtime: Pick<GifuRuntime, "appendRecord">,
): Promise<void> {
  if (!database?.enabled) return
  await runtime.appendRecord(database.path, buildGifuRunRecord(action, input, archives, command, commandResult))
}

export function parsePathList(text: string): string[] {
  return text
    .split(/\r?\n|;/)
    .map(clean)
    .filter((line) => line && !line.startsWith("#"))
}

export function isGifuArchive(path: string): boolean {
  const lower = path.toLowerCase()
  return GIFU_ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(prefix|stem|archive|parent)\}/g, (_, key: string) => values[key] ?? "")
}

function stripArchiveExtension(name: string): string {
  const lower = name.toLowerCase()
  const ext = GIFU_ARCHIVE_EXTENSIONS.find((item) => lower.endsWith(item))
  return ext ? name.slice(0, -ext.length) : name.replace(/\.[^.]+$/, "")
}

function sanitizeOutputStem(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*]/g, "_").trim().replace(/^\.+|\.+$/g, "")
  return cleaned || "output"
}

function parseTomlLikeValues(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#") || line.startsWith("[")) continue
    const index = line.indexOf("=")
    if (index <= 0) continue
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return values
}

function stringValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  return value.trim().replace(/^["']|["']$/g, "")
}

function arrayValue(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [stringValue(trimmed) ?? ""].filter(Boolean)
  return trimmed
    .slice(1, -1)
    .split(",")
    .map(stringValue)
    .filter((item): item is string => Boolean(item))
}

function booleanValue(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  const normalized = stringValue(value)?.toLowerCase()
  if (normalized === "true" || normalized === "1") return true
  if (normalized === "false" || normalized === "0") return false
  return undefined
}

function numberValue(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(stringValue(value))
  return Number.isFinite(parsed) ? parsed : undefined
}

function enumValue<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  const normalized = stringValue(value)
  return allowed.find((item) => item === normalized)
}

function data(partial: Partial<GifuData>): GifuData {
  const archives = partial.archives ?? []
  return {
    archives,
    readyCount: archives.filter((item) => item.status === "ready").length,
    singleCount: archives.filter((item) => item.status === "single").length,
    emptyCount: archives.filter((item) => item.status === "empty").length,
    errors: [],
    ...partial,
  }
}

function success(message: string, partial: Partial<GifuData>): GifuResult {
  return { success: true, message, data: data(partial) }
}

function failure(message: string): GifuResult {
  return { success: false, message, data: data({ errors: [message] }) }
}

function uniqueClean(values: Array<string | undefined>): string[] {
  return [...new Set(values.map(clean).filter(Boolean))]
}

function clean(value?: string): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "")
}
