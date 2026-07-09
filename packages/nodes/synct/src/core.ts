import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type SynctAction = "scan" | "plan" | "archive"
export type SynctSourceMode = "files" | "folders"
export type SynctPlanStatus = "ready" | "unchanged" | "skipped" | "moved" | "conflict" | "error"
export type SynctFormatKey = "year" | "year_month" | "year_month_day" | "month_day" | "day" | "nested_y_m" | "nested_y_m_d" | "nested_ym_d" | "nested_y_md"

export interface SynctInput {
  action?: SynctAction
  path?: string
  paths?: string[]
  listText?: string
  sourceMode?: SynctSourceMode
  formatKey?: SynctFormatKey
  recursive?: boolean
  archiveFolder?: boolean
  fallbackToCreatedTime?: boolean
  syncFolderFileTimes?: boolean
  dryRun?: boolean
}

export interface SynctDirEntry {
  name: string
  path: string
  isFile: boolean
  isDirectory: boolean
}

export interface SynctPathInfo {
  path: string
  exists: boolean
  isFile: boolean
  isDirectory: boolean
  atimeMs: number
  mtimeMs: number
  ctimeMs: number
}

export interface SynctPlanItem {
  sourcePath: string
  targetPath: string
  sourceName: string
  targetRelative: string
  kind: "file" | "folder"
  timestamp?: string
  status: SynctPlanStatus
  reason?: string
}

export interface SynctData {
  action: SynctAction
  sourceMode: SynctSourceMode
  formatKey: SynctFormatKey
  items: SynctPlanItem[]
  scannedCount: number
  readyCount: number
  movedCount: number
  skippedCount: number
  conflictCount: number
  errorCount: number
  errors: string[]
}

export interface SynctRuntime {
  pathInfo: (path: string) => Promise<SynctPathInfo>
  listDir: (path: string) => Promise<SynctDirEntry[]>
  ensureDir: (path: string) => Promise<void>
  move: (from: string, to: string) => Promise<void>
  setTimes: (path: string, atimeMs: number, mtimeMs: number) => Promise<void>
  join: (...parts: string[]) => string
  dirname: (path: string) => string
  basename: (path: string) => string
  relative: (from: string, to: string) => string
}

export type SynctResult = NodeRunResult<SynctData>

const FORMAT_PARTS: Record<SynctFormatKey, string[]> = {
  year: ["year"],
  year_month: ["year-month"],
  year_month_day: ["year-month-day"],
  month_day: ["month-day"],
  day: ["day"],
  nested_y_m: ["year", "month"],
  nested_y_m_d: ["year", "month", "day"],
  nested_ym_d: ["year-month", "day"],
  nested_y_md: ["year", "month-day"],
}

export function normalizeSynctInput(input: SynctInput): Required<SynctInput> {
  return {
    action: input.action ?? "plan",
    path: clean(input.path),
    paths: uniqueClean([input.path, ...(input.paths ?? []), ...parseList(input.listText)]),
    listText: input.listText ?? "",
    sourceMode: input.sourceMode ?? "files",
    formatKey: input.formatKey ?? "year_month",
    recursive: input.recursive ?? false,
    archiveFolder: input.archiveFolder ?? false,
    fallbackToCreatedTime: input.fallbackToCreatedTime ?? true,
    syncFolderFileTimes: input.syncFolderFileTimes ?? true,
    dryRun: input.dryRun ?? true,
  }
}

export async function runSynct(input: SynctInput, runtime: SynctRuntime, onEvent: (event: NodeRunEvent) => void = () => {}): Promise<SynctResult> {
  const normalized = normalizeSynctInput(input)
  try {
    if (!normalized.paths.length) return failure("At least one source path is required.", normalized)
    onEvent({ type: "progress", progress: 20, message: "Scanning timestamp sources." })
    const plan = normalized.sourceMode === "folders"
      ? await buildFolderPlan(normalized, runtime)
      : await buildFilePlan(normalized, runtime)

    if (normalized.action !== "archive" || normalized.dryRun) return success(`Synct planned ${plan.length} item(s).`, data(normalized, plan))

    onEvent({ type: "progress", progress: 70, message: "Moving timestamp archive items." })
    const applied: SynctPlanItem[] = []
    for (const item of plan) {
      if (item.status !== "ready") {
        applied.push(item)
        continue
      }
      try {
        await runtime.ensureDir(runtime.dirname(item.targetPath))
        if (item.kind === "folder" && normalized.syncFolderFileTimes && item.timestamp) {
          await syncFilesUnder(item.sourcePath, Date.parse(item.timestamp), runtime)
        }
        await runtime.move(item.sourcePath, item.targetPath)
        applied.push({ ...item, status: "moved" })
      } catch (error) {
        applied.push({ ...item, status: "error", reason: errorMessage(error) })
      }
    }
    return success(`Synct moved ${applied.filter((item) => item.status === "moved").length} item(s).`, data(normalized, applied))
  } catch (error) {
    return failure(errorMessage(error), normalized)
  }
}

export async function buildFilePlan(input: Required<SynctInput>, runtime: SynctRuntime): Promise<SynctPlanItem[]> {
  const items: SynctPlanItem[] = []
  for (const source of input.paths) {
    const info = await runtime.pathInfo(source)
    if (!info.exists) {
      items.push(skipped(source, runtime.basename(source), "path_missing"))
      continue
    }
    const files = info.isFile ? [{ path: source, name: runtime.basename(source), info }] : await collectFiles(source, input.recursive, runtime)
    const baseDst = destinationBase(source, info.isFile ? runtime.dirname(source) : source, input, runtime)
    for (const file of files) {
      const timestamp = extractTimestamp(file.name) ?? (input.fallbackToCreatedTime ? new Date(file.info.ctimeMs) : null)
      if (!timestamp) {
        items.push(skipped(file.path, file.name, "timestamp_missing", "file"))
        continue
      }
      items.push(await planMove(file.path, file.name, "file", timestamp, baseDst, input.formatKey, runtime))
    }
  }
  return items
}

export async function buildFolderPlan(input: Required<SynctInput>, runtime: SynctRuntime): Promise<SynctPlanItem[]> {
  const items: SynctPlanItem[] = []
  for (const source of input.paths) {
    const info = await runtime.pathInfo(source)
    if (!info.exists || !info.isDirectory) {
      items.push(skipped(source, runtime.basename(source), "path_not_directory", "folder"))
      continue
    }
    const entries = await runtime.listDir(source)
    const folders = entries.filter((entry) => entry.isDirectory)
    const baseDst = destinationBase(source, source, input, runtime)
    for (const folder of folders) {
      const folderInfo = await runtime.pathInfo(folder.path)
      const timestamp = extractTimestamp(folder.name) ?? (input.fallbackToCreatedTime ? new Date(folderInfo.ctimeMs) : null)
      if (!timestamp) {
        items.push(skipped(folder.path, folder.name, "timestamp_missing", "folder"))
        continue
      }
      items.push(await planMove(folder.path, folder.name, "folder", timestamp, baseDst, input.formatKey, runtime))
    }
  }
  return items
}

async function planMove(
  sourcePath: string,
  sourceName: string,
  kind: "file" | "folder",
  timestamp: Date,
  baseDst: string,
  formatKey: SynctFormatKey,
  runtime: SynctRuntime,
): Promise<SynctPlanItem> {
  const targetDir = buildDateDirectory(baseDst, timestamp, formatKey, runtime)
  const targetPath = runtime.join(targetDir, sourceName)
  const targetRelative = runtime.relative(baseDst, targetPath)
  if (normalizePath(sourcePath) === normalizePath(targetPath)) return { sourcePath, targetPath, sourceName, targetRelative, kind, timestamp: timestamp.toISOString(), status: "unchanged" }
  const targetInfo = await runtime.pathInfo(targetPath)
  if (targetInfo.exists) return { sourcePath, targetPath, sourceName, targetRelative, kind, timestamp: timestamp.toISOString(), status: "conflict", reason: "target_exists" }
  return { sourcePath, targetPath, sourceName, targetRelative, kind, timestamp: timestamp.toISOString(), status: "ready" }
}

export function extractTimestamp(name: string): Date | null {
  const base = name.replace(/\.[^.\s]+$/, "")
  const patterns = [
    /(?<year>20\d{2}|19\d{2})[-_.]?(?<month>0[1-9]|1[0-2])[-_.]?(?<day>0[1-9]|[12]\d|3[01])/,
    /(?<year>20\d{2}|19\d{2})[-_.]?(?<month>0[1-9]|1[0-2])/,
    /(?<year>\d{2})[-_.]?(?<month>0[1-9]|1[0-2])[-_.]?(?<day>0[1-9]|[12]\d|3[01])/,
    /(?<year>\d{2})[-_.]?(?<month>0[1-9]|1[0-2])/,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(base)
    if (!match?.groups) continue
    const year = Number(match.groups.year.length === 2 ? `20${match.groups.year}` : match.groups.year)
    const month = Number(match.groups.month)
    const day = Number(match.groups.day ?? 1)
    if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) return new Date(Date.UTC(year, month - 1, day))
  }
  return null
}

export function buildDateDirectory(baseDst: string, date: Date, formatKey: SynctFormatKey, runtime: Pick<SynctRuntime, "join">): string {
  const parts = FORMAT_PARTS[formatKey].map((part) => formatDatePart(date, part))
  return runtime.join(baseDst, ...parts)
}

function formatDatePart(date: Date, part: string): string {
  const year = String(date.getUTCFullYear())
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  const day = String(date.getUTCDate()).padStart(2, "0")
  if (part === "year") return year
  if (part === "month") return month
  if (part === "day") return day
  if (part === "year-month") return `${year}-${month}`
  if (part === "year-month-day") return `${year}-${month}-${day}`
  if (part === "month-day") return `${month}-${day}`
  return year
}

async function collectFiles(directory: string, recursive: boolean, runtime: SynctRuntime): Promise<Array<{ path: string; name: string; info: SynctPathInfo }>> {
  const files: Array<{ path: string; name: string; info: SynctPathInfo }> = []
  const entries = await runtime.listDir(directory)
  for (const entry of entries) {
    if (entry.isFile) files.push({ path: entry.path, name: entry.name, info: await runtime.pathInfo(entry.path) })
    if (recursive && entry.isDirectory) files.push(...await collectFiles(entry.path, recursive, runtime))
  }
  return files
}

async function syncFilesUnder(directory: string, timestampMs: number, runtime: SynctRuntime): Promise<void> {
  const entries = await runtime.listDir(directory)
  for (const entry of entries) {
    if (entry.isFile) await runtime.setTimes(entry.path, timestampMs, timestampMs)
    if (entry.isDirectory) await syncFilesUnder(entry.path, timestampMs, runtime)
  }
}

function destinationBase(originalPath: string, directory: string, input: Required<SynctInput>, runtime: Pick<SynctRuntime, "join">): string {
  return input.archiveFolder ? runtime.join(directory, "archive") : directory || originalPath
}

function data(input: Required<SynctInput>, items: SynctPlanItem[]): SynctData {
  const errors = items.filter((item) => item.reason && (item.status === "error" || item.status === "conflict")).map((item) => `${item.sourcePath}: ${item.reason}`)
  return {
    action: input.action,
    sourceMode: input.sourceMode,
    formatKey: input.formatKey,
    items,
    scannedCount: items.length,
    readyCount: items.filter((item) => item.status === "ready").length,
    movedCount: items.filter((item) => item.status === "moved").length,
    skippedCount: items.filter((item) => item.status === "skipped").length,
    conflictCount: items.filter((item) => item.status === "conflict").length,
    errorCount: items.filter((item) => item.status === "error").length,
    errors,
  }
}

function success(message: string, data: SynctData): SynctResult {
  return { success: data.errorCount === 0, message, data }
}

function failure(message: string, input: Required<SynctInput>): SynctResult {
  return { success: false, message, data: data(input, [{ sourcePath: "", targetPath: "", sourceName: "", targetRelative: "", kind: "file", status: "error", reason: message }]) }
}

function skipped(sourcePath: string, sourceName: string, reason: string, kind: "file" | "folder" = "folder"): SynctPlanItem {
  return { sourcePath, targetPath: sourcePath, sourceName, targetRelative: sourceName, kind, status: "skipped", reason }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase()
}

function parseList(value: unknown): string[] {
  return String(value ?? "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)
}

function uniqueClean(values: Array<string | undefined>): string[] {
  return [...new Set(values.map(clean).filter(Boolean) as string[])]
}

function clean(value: unknown): string {
  return String(value ?? "").trim()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
