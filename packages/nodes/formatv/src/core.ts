import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type FormatvAction = "scan" | "add_nov" | "remove_nov" | "check_duplicates"
export type FormatvOperationStatus = "pending" | "skipped" | "success" | "error"

export interface FormatvPrefixConfig {
  name: string
  prefix: string
  description?: string
}

export interface FormatvInput {
  action?: FormatvAction
  path?: string
  paths?: string[]
  recursive?: boolean
  prefixName?: string
  prefix_name?: string
  prefixes?: FormatvPrefixConfig[]
  dryRun?: boolean
  dry_run?: boolean
  reportPath?: string
  report_path?: string
}

export interface FormatvPathInfo {
  path: string
  exists: boolean
  isFile: boolean
  isDirectory: boolean
  size: number
}

export interface FormatvDirEntry {
  name: string
  path: string
  isFile: boolean
  isDirectory: boolean
}

export interface FormatvOperation {
  sourcePath: string
  targetPath: string
  action: "add_nov" | "remove_nov"
  status: FormatvOperationStatus
  reason?: string
}

export interface FormatvLargerPair {
  prefixed: string
  original: string
  prefixedSize: number
  originalSize: number
}

export interface FormatvScan {
  normalFiles: string[]
  novFiles: string[]
  prefixedFiles: Record<string, string[]>
}

export interface FormatvData {
  normalCount: number
  novCount: number
  prefixedCounts: Record<string, number>
  normalFiles: string[]
  novFiles: string[]
  prefixedFiles: Record<string, string[]>
  successCount: number
  errorCount: number
  skippedCount: number
  duplicateCount: number
  duplicates: string[]
  prefixedLarger: FormatvLargerPair[]
  operations: FormatvOperation[]
  reportPath: string
  errors: string[]
}

export interface FormatvRuntime {
  pathInfo: (path: string) => Promise<FormatvPathInfo>
  listDir: (path: string) => Promise<FormatvDirEntry[]>
  renamePath: (source: string, target: string) => Promise<void>
  writeText: (path: string, content: string) => Promise<void>
  join: (...parts: string[]) => string
  dirname: (path: string) => string
  basename: (path: string) => string
}

export type FormatvResult = NodeRunResult<FormatvData>

export const VIDEO_EXTENSIONS = [
  ".mp4",
  ".mkv",
  ".avi",
  ".mov",
  ".wmv",
  ".flv",
  ".webm",
  ".m4v",
  ".mpg",
  ".mpeg",
  ".ts",
  ".m2ts",
  ".rmvb",
  ".rm",
  ".vob",
  ".ogv",
]

export const DEFAULT_PREFIXES: FormatvPrefixConfig[] = [
  { name: "hb", prefix: "[#hb]", description: "HandBrake transcode file" },
]

export function normalizeFormatvInput(input: FormatvInput): Required<Omit<FormatvInput, "prefix_name" | "dry_run" | "report_path">> {
  const paths = [...(input.paths ?? [])]
  if (input.path) paths.unshift(input.path)
  return {
    action: input.action ?? "scan",
    path: clean(input.path),
    paths: uniqueClean(paths),
    recursive: input.recursive ?? false,
    prefixName: clean(input.prefixName ?? input.prefix_name) || "hb",
    prefixes: input.prefixes?.length ? input.prefixes : DEFAULT_PREFIXES,
    dryRun: input.dryRun ?? input.dry_run ?? false,
    reportPath: clean(input.reportPath ?? input.report_path),
  }
}

export async function runFormatv(
  input: FormatvInput,
  runtime: FormatvRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<FormatvResult> {
  const normalized = normalizeFormatvInput(input)
  try {
    if (!normalized.paths.length) return failure("At least one path is required.")
    onEvent({ type: "progress", progress: 10, message: "Collecting video files." })
    const scan = await scanFormatv(normalized.paths, normalized.recursive, normalized.prefixes, runtime)
    if (normalized.action === "scan") {
      return success(`Scan completed: ${scan.normalFiles.length} normal, ${scan.novFiles.length} .nov.`, scanData(scan))
    }
    if (normalized.action === "add_nov") {
      return await executeRenamePlan(buildAddNovPlan(scan, runtime), scan, normalized.dryRun, runtime, onEvent)
    }
    if (normalized.action === "remove_nov") {
      return await executeRenamePlan(buildRemoveNovPlan(scan, runtime), scan, normalized.dryRun, runtime, onEvent)
    }
    return await checkDuplicates(scan, normalized, runtime, onEvent)
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

export async function scanFormatv(
  paths: string[],
  recursive: boolean,
  prefixes: FormatvPrefixConfig[],
  runtime: FormatvRuntime,
): Promise<FormatvScan> {
  const result: FormatvScan = {
    normalFiles: [],
    novFiles: [],
    prefixedFiles: Object.fromEntries(prefixes.map((prefix) => [prefix.name, []])),
  }

  async function visit(path: string) {
    const info = await runtime.pathInfo(path)
    if (!info.exists) return
    if (info.isFile) {
      classifyFile(info.path, prefixes, result)
      return
    }
    if (!info.isDirectory) return
    for (const entry of await runtime.listDir(info.path)) {
      if (entry.isFile) classifyFile(entry.path, prefixes, result)
      else if (entry.isDirectory && recursive) await visit(entry.path)
    }
  }

  for (const path of paths) await visit(path)
  result.normalFiles = sortUnique(result.normalFiles)
  result.novFiles = sortUnique(result.novFiles)
  for (const key of Object.keys(result.prefixedFiles)) result.prefixedFiles[key] = sortUnique(result.prefixedFiles[key])
  return result
}

export function classifyFile(path: string, prefixes: FormatvPrefixConfig[], result: FormatvScan): void {
  const name = basenameCompat(path)
  if (isNovVideoFile(name)) {
    result.novFiles.push(path)
    return
  }
  if (!isVideoFile(name)) return
  const prefix = prefixes.find((item) => name.startsWith(item.prefix))
  if (prefix) {
    if (!result.prefixedFiles[prefix.name]) result.prefixedFiles[prefix.name] = []
    result.prefixedFiles[prefix.name].push(path)
    return
  }
  result.normalFiles.push(path)
}

export function buildAddNovPlan(scan: FormatvScan, runtime: Pick<FormatvRuntime, "pathInfo">): Promise<FormatvOperation[]> {
  return buildRenamePlan(scan.normalFiles, (file) => `${file}.nov`, "add_nov", runtime)
}

export function buildRemoveNovPlan(scan: FormatvScan, runtime: Pick<FormatvRuntime, "pathInfo">): Promise<FormatvOperation[]> {
  return buildRenamePlan(scan.novFiles, (file) => file.replace(/\.nov$/i, ""), "remove_nov", runtime)
}

export function isVideoFile(name: string): boolean {
  const lower = name.toLowerCase()
  return VIDEO_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

export function isNovVideoFile(name: string): boolean {
  const lower = name.toLowerCase()
  if (!lower.endsWith(".nov")) return false
  return isVideoFile(name.slice(0, -4))
}

export function stripPrefixName(fileName: string, prefix: string): string {
  return fileName.startsWith(prefix) ? fileName.slice(prefix.length).trimStart() : fileName
}

async function buildRenamePlan(
  files: string[],
  targetFor: (file: string) => string,
  action: "add_nov" | "remove_nov",
  runtime: Pick<FormatvRuntime, "pathInfo">,
): Promise<FormatvOperation[]> {
  const plan: FormatvOperation[] = []
  for (const file of files) {
    const targetPath = targetFor(file)
    const targetInfo = await runtime.pathInfo(targetPath)
    plan.push({
      sourcePath: file,
      targetPath,
      action,
      status: targetInfo.exists ? "skipped" : "pending",
      ...(targetInfo.exists ? { reason: "target_exists" } : {}),
    })
  }
  return plan
}

async function executeRenamePlan(
  planPromise: Promise<FormatvOperation[]>,
  scan: FormatvScan,
  dryRun: boolean,
  runtime: FormatvRuntime,
  onEvent: (event: NodeRunEvent) => void,
): Promise<FormatvResult> {
  const plan = await planPromise
  const pending = plan.filter((item) => item.status === "pending")
  const completed: FormatvOperation[] = []
  if (!dryRun) {
    for (let index = 0; index < pending.length; index += 1) {
      const item = pending[index]
      onEvent({ type: "progress", progress: 20 + Math.round((index / Math.max(pending.length, 1)) * 75), message: item.sourcePath })
      try {
        await runtime.renamePath(item.sourcePath, item.targetPath)
        completed.push({ ...item, status: "success" })
      } catch (error) {
        completed.push({ ...item, status: "error", reason: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  onEvent({ type: "progress", progress: 100, message: "FormatV completed." })
  const operations = dryRun ? plan : plan.map((item) => completed.find((done) => done.sourcePath === item.sourcePath) ?? item)
  const successCount = operations.filter((item) => item.status === "success").length
  const skippedCount = operations.filter((item) => item.status === "skipped").length
  const errorCount = operations.filter((item) => item.status === "error").length
  const verb = plan[0]?.action === "remove_nov" ? "Remove .nov" : "Add .nov"
  return {
    success: errorCount === 0,
    message: `${verb} completed: ${dryRun ? pending.length : successCount} ${dryRun ? "planned" : "success"}, ${skippedCount} skipped, ${errorCount} error(s).`,
    data: data({
      ...scanData(scan),
      successCount,
      skippedCount,
      errorCount,
      operations,
      errors: operations.filter((item) => item.status === "error").map((item) => `${item.sourcePath}: ${item.reason}`),
    }),
  }
}

async function checkDuplicates(
  scan: FormatvScan,
  input: ReturnType<typeof normalizeFormatvInput>,
  runtime: FormatvRuntime,
  onEvent: (event: NodeRunEvent) => void,
): Promise<FormatvResult> {
  const prefix = input.prefixes.find((item) => item.name === input.prefixName) ?? input.prefixes[0] ?? DEFAULT_PREFIXES[0]
  const prefixedFiles = scan.prefixedFiles[prefix.name] ?? []
  const duplicates: string[] = []
  const prefixedLarger: FormatvLargerPair[] = []
  for (let index = 0; index < prefixedFiles.length; index += 1) {
    const prefixed = prefixedFiles[index]
    onEvent({ type: "progress", progress: 20 + Math.round((index / Math.max(prefixedFiles.length, 1)) * 70), message: prefixed })
    const original = runtime.join(runtime.dirname(prefixed), stripPrefixName(runtime.basename(prefixed), prefix.prefix))
    const prefixedInfo = await runtime.pathInfo(prefixed)
    const originalInfo = await runtime.pathInfo(original)
    if (!originalInfo.exists || !originalInfo.isFile) continue
    duplicates.push(originalInfo.path)
    if (prefixedInfo.size > originalInfo.size) {
      prefixedLarger.push({
        prefixed: prefixedInfo.path,
        original: originalInfo.path,
        prefixedSize: prefixedInfo.size,
        originalSize: originalInfo.size,
      })
    }
  }
  const reportPath = input.reportPath || (input.paths[0] ? runtime.join(input.paths[0], `formatv-${prefix.name}-duplicates.json`) : "")
  if (reportPath && !input.dryRun) {
    await runtime.writeText(reportPath, `${JSON.stringify({ prefix, duplicates, prefixedLarger }, null, 2)}\n`)
  }
  onEvent({ type: "progress", progress: 100, message: "Duplicate check completed." })
  return success(`Duplicate check completed: ${duplicates.length} duplicate(s).`, {
    ...scanData(scan),
    duplicateCount: duplicates.length,
    duplicates,
    prefixedLarger,
    reportPath: input.dryRun ? "" : reportPath,
  })
}

function scanData(scan: FormatvScan): Partial<FormatvData> {
  const prefixedCounts = Object.fromEntries(Object.entries(scan.prefixedFiles).map(([key, files]) => [key, files.length]))
  return {
    normalCount: scan.normalFiles.length,
    novCount: scan.novFiles.length,
    prefixedCounts,
    normalFiles: scan.normalFiles,
    novFiles: scan.novFiles,
    prefixedFiles: scan.prefixedFiles,
  }
}

function data(partial: Partial<FormatvData>): FormatvData {
  return {
    normalCount: 0,
    novCount: 0,
    prefixedCounts: {},
    normalFiles: [],
    novFiles: [],
    prefixedFiles: {},
    successCount: 0,
    errorCount: 0,
    skippedCount: 0,
    duplicateCount: 0,
    duplicates: [],
    prefixedLarger: [],
    operations: [],
    reportPath: "",
    errors: [],
    ...partial,
  }
}

function success(message: string, partial: Partial<FormatvData>): FormatvResult {
  return { success: true, message, data: data(partial) }
}

function failure(message: string): FormatvResult {
  return { success: false, message, data: data({ errors: [message], errorCount: 1 }) }
}

function sortUnique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
}

function basenameCompat(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  return normalized.slice(normalized.lastIndexOf("/") + 1)
}

function uniqueClean(values: string[]): string[] {
  return [...new Set(values.map(clean).filter(Boolean))]
}

function clean(value?: string): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "")
}
