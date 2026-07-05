import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type BandiaAction = "extract" | "compress" | "repack" | "export_efu" | "stop"
export type BandiaExtractMode = "auto" | "normal"
export type BandiaOverwriteMode = "overwrite" | "skip" | "rename"
export type BandiaArchiveFormat = "zip" | "7z"

export interface BandiaPathMapping {
  archivePath: string
  extractedPath: string
}

export interface BandiaInput {
  action?: BandiaAction
  paths?: string[]
  path?: string
  pathText?: string
  mappings?: Array<BandiaPathMapping | Record<string, unknown>>
  mappingText?: string
  deleteAfter?: boolean
  useTrash?: boolean
  overwriteMode?: BandiaOverwriteMode
  parallel?: boolean
  workers?: number
  extractMode?: BandiaExtractMode
  outputPrefix?: string
  outputDir?: string
  compressFormat?: BandiaArchiveFormat
  deleteSource?: boolean
  efuOutputPath?: string
  openInEverything?: boolean
  dryRun?: boolean
}

export interface BandiaCommandResult {
  code: number
  stdout: string
  stderr: string
  durationMs?: number
}

export interface BandiaFileStat {
  exists: boolean
  isDirectory: boolean
  size: number
  mtimeMs: number
  ctimeMs: number
}

export interface BandiaRuntime {
  findBandizip: () => Promise<string | null>
  runCommand: (command: string, args: string[], options?: { cwd?: string }) => Promise<BandiaCommandResult>
  exists: (path: string) => Promise<boolean>
  stat: (path: string) => Promise<BandiaFileStat | null>
  ensureDir: (path: string) => Promise<void>
  removePath: (path: string, options?: { trash?: boolean }) => Promise<void>
  writeText: (path: string, content: string) => Promise<void>
  openEverything?: (efuPath: string) => Promise<void>
  tempDir: () => string
  dirname: (path: string) => string
  basename: (path: string) => string
  extname: (path: string) => string
  join: (...parts: string[]) => string
  resolve: (path: string) => string
}

export interface BandiaItemResult {
  kind: "extract" | "compress" | "export"
  sourcePath: string
  archivePath?: string
  outputPath?: string
  success: boolean
  durationMs: number
  fileSize?: number
  command?: string
  error?: string
  skipped?: boolean
}

export interface BandiaData {
  action: BandiaAction
  extractedCount: number
  compressedCount: number
  failedCount: number
  totalCount: number
  exportedCount: number
  efuPath?: string
  pathMappings: BandiaPathMapping[]
  results: BandiaItemResult[]
}

export type BandiaResult = NodeRunResult<BandiaData>

export const ARCHIVE_EXTENSIONS = [".zip", ".7z", ".rar", ".tar", ".gz", ".bz2", ".xz"] as const
export const DEFAULT_OUTPUT_PREFIX = "[extract] "

let stopRequested = false

export function parseBandiaPaths(text = ""): string[] {
  const results: string[] = []
  for (const rawLine of text.split(/\r?\n|[;]/)) {
    const line = stripOuterQuotes(rawLine.trim())
    if (!line) continue
    if (isArchivePath(line)) {
      results.push(line)
      continue
    }

    const match = line.match(/(?:^|\s)([^\s"']+\.(?:zip|7z|rar|tar|gz|bz2|xz))(?:\s|$)/i)
    if (match?.[1]) results.push(stripOuterQuotes(match[1]))
  }
  return unique(results)
}

export function isArchivePath(path: string): boolean {
  return ARCHIVE_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext))
}

export function parsePathMappings(text = ""): BandiaPathMapping[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  try {
    const parsed = JSON.parse(trimmed) as unknown
    return normalizeMappings(parsed)
  } catch {
    const mappings: BandiaPathMapping[] = []
    for (const rawLine of trimmed.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line) continue
      const parts = line.includes("=>")
        ? line.split("=>")
        : line.includes("\t")
          ? line.split("\t")
          : line.split("|")
      if (parts.length < 2) continue
      mappings.push({
        archivePath: stripOuterQuotes(parts[0]?.trim() ?? ""),
        extractedPath: stripOuterQuotes(parts.slice(1).join("|").trim()),
      })
    }
    return mappings.filter((mapping) => mapping.archivePath && mapping.extractedPath)
  }
}

export function normalizeMappings(value: unknown): BandiaPathMapping[] {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { mappings?: unknown }).mappings)
      ? (value as { mappings: unknown[] }).mappings
      : []

  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null
      const record = item as Record<string, unknown>
      const archivePath = stringValue(record.archivePath) || stringValue(record.archive_path)
      const extractedPath = stringValue(record.extractedPath) || stringValue(record.extracted_path)
      return archivePath && extractedPath ? { archivePath, extractedPath } : null
    })
    .filter((item): item is BandiaPathMapping => Boolean(item))
}

export function mappingsToText(mappings: BandiaPathMapping[]): string {
  return JSON.stringify({ mappings }, null, 2)
}

export async function runBandia(input: BandiaInput, runtime: BandiaRuntime, onEvent?: (event: NodeRunEvent) => void): Promise<BandiaResult> {
  const action = input.action ?? "extract"
  if (action === "stop") {
    stopRequested = true
    return result(true, "Stop requested.", emptyData("stop"))
  }

  stopRequested = false
  if (action === "extract") return runExtract(input, runtime, onEvent)
  if (action === "compress" || action === "repack") return runCompress(action, input, runtime, onEvent)
  if (action === "export_efu") return runExportEfu(input, runtime, onEvent)
  return result(false, `Unknown action: ${String(action)}`, emptyData(action))
}

async function runExtract(input: BandiaInput, runtime: BandiaRuntime, onEvent?: (event: NodeRunEvent) => void): Promise<BandiaResult> {
  const archives = collectArchivePaths(input)
  if (!archives.length) return result(false, "No archive paths provided.", emptyData("extract"))

  const bz = input.dryRun ? "bz" : await runtime.findBandizip()
  if (!bz) return result(false, "Bandizip executable was not found. Set BANDIZIP_PATH or install Bandizip.", emptyData("extract"))

  const total = archives.length
  emit(onEvent, "progress", 0, `Preparing ${total} archive(s).`)
  const workers = input.parallel ? Math.max(1, Math.min(input.workers ?? 2, 8)) : 1
  const results = await runLimited(archives, workers, async (archive, index) => {
    if (stopRequested) return skippedExtract(archive, "Stopped by user.")
    emit(onEvent, "progress", progress(index, total), `Extracting ${index + 1}/${total}`, runtime.basename(archive))
    const item = await extractSingle(archive, bz, input, runtime)
    emit(onEvent, item.success ? "log" : "log", undefined, `${item.success ? "ok" : "fail"} ${runtime.basename(archive)}${item.error ? `: ${item.error}` : ""}`)
    emit(onEvent, "progress", progress(index + 1, total), `Extracted ${index + 1}/${total}`, runtime.basename(archive))
    return item
  })

  const ok = results.filter((item) => item.success)
  const data: BandiaData = {
    action: "extract",
    extractedCount: ok.length,
    compressedCount: 0,
    failedCount: results.length - ok.length,
    totalCount: results.length,
    exportedCount: 0,
    pathMappings: ok
      .filter((item) => item.outputPath)
      .map((item) => ({ archivePath: item.sourcePath, extractedPath: item.outputPath ?? "" })),
    results,
  }
  emit(onEvent, "progress", 100, "Extract complete.")
  return result(data.failedCount === 0, `Extract complete: ${data.extractedCount} succeeded, ${data.failedCount} failed.`, data)
}

async function extractSingle(archive: string, bz: string, input: BandiaInput, runtime: BandiaRuntime): Promise<BandiaItemResult> {
  const stat = await runtime.stat(archive)
  if (!stat?.exists) return failedExtract(archive, "Archive does not exist.")
  if (stat.isDirectory) return failedExtract(archive, "Archive path is a directory.")

  const overwrite = overwriteFlag(input.overwriteMode ?? "overwrite")
  const mode = input.extractMode ?? "auto"
  const outputPath = mode === "auto"
    ? await getAutoOutputPath(archive, bz, runtime)
    : runtime.join(runtime.dirname(archive), `${input.outputPrefix ?? DEFAULT_OUTPUT_PREFIX}${archiveStem(archive, runtime)}`)
  const args = mode === "auto"
    ? ["x", "-y", overwrite, "-target:auto", archive]
    : ["x", "-y", overwrite, `-o:${outputPath}`, archive]

  if (mode === "normal") await runtime.ensureDir(outputPath)
  if (input.dryRun) {
    return {
      kind: "extract",
      sourcePath: archive,
      outputPath,
      success: true,
      durationMs: 0,
      fileSize: stat.size,
      command: formatCommand(bz, args),
      skipped: true,
    }
  }

  const executed = await runtime.runCommand(bz, args)
  if (executed.code !== 0) {
    return failedExtract(archive, shortError(executed), executed.durationMs, stat.size, formatCommand(bz, args), outputPath)
  }

  if (input.deleteAfter ?? true) {
    try {
      await runtime.removePath(archive, { trash: input.useTrash ?? true })
    } catch {
      // Keep extraction successful; deletion is a follow-up cleanup failure in the original tool too.
    }
  }

  return {
    kind: "extract",
    sourcePath: archive,
    outputPath,
    success: true,
    durationMs: executed.durationMs ?? 0,
    fileSize: stat.size,
    command: formatCommand(bz, args),
  }
}

async function getAutoOutputPath(archive: string, bz: string, runtime: BandiaRuntime): Promise<string> {
  const fallback = runtime.join(runtime.dirname(archive), archiveStem(archive, runtime))
  const listed = await runtime.runCommand(bz, ["l", archive])
  if (listed.code !== 0) return fallback

  const roots = new Set<string>()
  for (const rawLine of listed.stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("-") || /^date\s+/i.test(line) || /^attr\s+/i.test(line)) continue
    const parts = line.split(/\s+/)
    if (parts.length < 5) continue
    const itemPath = parts.slice(4).join(" ")
    const root = itemPath.split(/[\\/]/)[0]
    if (root) roots.add(root)
  }
  return roots.size === 1 ? runtime.join(runtime.dirname(archive), [...roots][0] ?? archiveStem(archive, runtime)) : fallback
}

async function runCompress(action: "compress" | "repack", input: BandiaInput, runtime: BandiaRuntime, onEvent?: (event: NodeRunEvent) => void): Promise<BandiaResult> {
  const mappings = await collectMappings(input, runtime)
  if (!mappings.length) return result(false, "No valid path mappings or source paths provided.", emptyData(action))

  const bz = input.dryRun ? "bz" : await runtime.findBandizip()
  if (!bz) return result(false, "Bandizip executable was not found. Set BANDIZIP_PATH or install Bandizip.", emptyData(action))

  const total = mappings.length
  emit(onEvent, "progress", 0, `Preparing ${total} mapping(s).`)
  const results: BandiaItemResult[] = []

  for (let index = 0; index < mappings.length; index += 1) {
    if (stopRequested) {
      results.push(skippedCompress(mappings[index]!, "Stopped by user."))
      continue
    }
    const mapping = mappings[index]!
    emit(onEvent, "progress", progress(index, total), `Compressing ${index + 1}/${total}`, runtime.basename(mapping.extractedPath))
    results.push(await compressSingle(mapping, bz, input, runtime))
    emit(onEvent, "progress", progress(index + 1, total), `Compressed ${index + 1}/${total}`, runtime.basename(mapping.extractedPath))
  }

  const compressed = results.filter((item) => item.success).length
  const data: BandiaData = {
    action,
    extractedCount: 0,
    compressedCount: compressed,
    failedCount: results.length - compressed,
    totalCount: results.length,
    exportedCount: 0,
    pathMappings: mappings,
    results,
  }
  emit(onEvent, "progress", 100, "Compress complete.")
  return result(data.failedCount === 0, `${action === "repack" ? "Repack" : "Compress"} complete: ${data.compressedCount} succeeded, ${data.failedCount} failed.`, data)
}

async function compressSingle(mapping: BandiaPathMapping, bz: string, input: BandiaInput, runtime: BandiaRuntime): Promise<BandiaItemResult> {
  const stat = await runtime.stat(mapping.extractedPath)
  if (!stat?.exists) return failedCompress(mapping, "Source path does not exist.")

  const archivePath = ensureArchiveExtension(mapping.archivePath, input.compressFormat ?? "zip", runtime)
  await runtime.ensureDir(runtime.dirname(archivePath))
  const args = ["a", "-y", runtime.basename(archivePath), runtime.basename(mapping.extractedPath)]

  if (input.dryRun) {
    return {
      kind: "compress",
      sourcePath: mapping.extractedPath,
      archivePath,
      success: true,
      durationMs: 0,
      fileSize: stat.size,
      command: formatCommand(bz, args),
      skipped: true,
    }
  }

  const executed = await runtime.runCommand(bz, args, { cwd: runtime.dirname(mapping.extractedPath) })
  if (executed.code !== 0) {
    return failedCompress(mapping, shortError(executed), executed.durationMs, formatCommand(bz, args), archivePath)
  }

  if (input.deleteSource ?? true) {
    await runtime.removePath(mapping.extractedPath, { trash: true })
  }

  return {
    kind: "compress",
    sourcePath: mapping.extractedPath,
    archivePath,
    success: true,
    durationMs: executed.durationMs ?? 0,
    fileSize: stat.size,
    command: formatCommand(bz, args),
  }
}

async function runExportEfu(input: BandiaInput, runtime: BandiaRuntime, onEvent?: (event: NodeRunEvent) => void): Promise<BandiaResult> {
  const candidates = normalizeMappings(input.mappings).map((mapping) => mapping.extractedPath)
  if (input.mappingText) candidates.push(...parsePathMappings(input.mappingText).map((mapping) => mapping.extractedPath))
  candidates.push(...collectRawPaths(input))

  const paths = unique(candidates)
  const rows: string[] = [csvRow(["Filename", "Size", "Date Modified", "Date Created", "Attributes"])]
  let exported = 0

  for (const item of paths) {
    const stat = await runtime.stat(item)
    if (!stat?.exists) continue
    rows.push(csvRow([
      runtime.resolve(item),
      stat.isDirectory ? "0" : String(stat.size),
      toFileTime(stat.mtimeMs),
      toFileTime(stat.ctimeMs),
      stat.isDirectory ? "16" : "32",
    ]))
    exported += 1
  }

  if (!exported) return result(false, "No existing paths were available for EFU export.", emptyData("export_efu"))

  const efuPath = input.efuOutputPath || runtime.join(runtime.tempDir(), "bandia_export.efu")
  emit(onEvent, "progress", 50, `Writing ${exported} EFU row(s).`)
  await runtime.writeText(efuPath, `\ufeff${rows.join("\r\n")}\r\n`)
  if (input.openInEverything ?? false) await runtime.openEverything?.(efuPath)

  const data: BandiaData = {
    action: "export_efu",
    extractedCount: 0,
    compressedCount: 0,
    failedCount: 0,
    totalCount: exported,
    exportedCount: exported,
    efuPath,
    pathMappings: [],
    results: paths.map((path) => ({ kind: "export", sourcePath: path, outputPath: efuPath, success: true, durationMs: 0 })),
  }
  emit(onEvent, "progress", 100, "EFU export complete.")
  return result(true, `Exported ${exported} path(s) to ${efuPath}.`, data)
}

function collectArchivePaths(input: BandiaInput): string[] {
  return unique([
    ...(input.paths ?? []),
    ...(input.path ? [input.path] : []),
    ...parseBandiaPaths(input.pathText),
  ].map((item) => stripOuterQuotes(item.trim())).filter(isArchivePath))
}

function collectRawPaths(input: BandiaInput): string[] {
  return unique([
    ...(input.paths ?? []),
    ...(input.path ? [input.path] : []),
    ...(input.pathText ?? "").split(/\r?\n|[;]/),
  ].map((item) => stripOuterQuotes(item.trim())).filter(Boolean))
}

async function collectMappings(input: BandiaInput, runtime: BandiaRuntime): Promise<BandiaPathMapping[]> {
  const explicit = [
    ...normalizeMappings(input.mappings),
    ...parsePathMappings(input.mappingText),
  ]
  if (explicit.length) return uniqueMappings(explicit)

  const sources = unique([...(input.paths ?? []), ...(input.path ? [input.path] : []), ...parseBandiaPaths(input.pathText)])
  const format = input.compressFormat ?? "zip"
  return sources.map((source) => {
    const archiveName = `${runtime.basename(source)}.${format}`
    const archivePath = input.outputDir ? runtime.join(input.outputDir, archiveName) : runtime.join(runtime.dirname(source), archiveName)
    return { archivePath, extractedPath: source }
  })
}

function emptyData(action: BandiaAction): BandiaData {
  return { action, extractedCount: 0, compressedCount: 0, failedCount: 0, totalCount: 0, exportedCount: 0, pathMappings: [], results: [] }
}

function result(success: boolean, message: string, data: BandiaData): BandiaResult {
  return { success, message, data }
}

function emit(onEvent: ((event: NodeRunEvent) => void) | undefined, type: NodeRunEvent["type"], progressValue: number | undefined, message: string, currentFile?: string): void {
  onEvent?.({ type, progress: progressValue, message: currentFile ? `${message}|${currentFile}` : message })
}

function progress(done: number, total: number): number {
  return Math.min(100, Math.max(0, Math.round((done / Math.max(total, 1)) * 100)))
}

async function runLimited<T, R>(items: T[], workers: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await task(items[index]!, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, worker))
  return results
}

function overwriteFlag(mode: BandiaOverwriteMode): string {
  if (mode === "skip") return "-aos"
  if (mode === "rename") return "-aou"
  return "-aoa"
}

function ensureArchiveExtension(path: string, format: BandiaArchiveFormat, runtime: BandiaRuntime): string {
  return isArchivePath(path) ? path : `${path}.${format || runtime.extname(path).slice(1) || "zip"}`
}

function archiveStem(path: string, runtime: BandiaRuntime): string {
  const name = runtime.basename(path)
  const ext = runtime.extname(name)
  return ext ? name.slice(0, -ext.length) : name
}

function failedExtract(path: string, error: string, durationMs = 0, fileSize = 0, command?: string, outputPath?: string): BandiaItemResult {
  return { kind: "extract", sourcePath: path, outputPath, success: false, durationMs, fileSize, command, error }
}

function skippedExtract(path: string, error: string): BandiaItemResult {
  return { kind: "extract", sourcePath: path, success: false, durationMs: 0, error, skipped: true }
}

function failedCompress(mapping: BandiaPathMapping, error: string, durationMs = 0, command?: string, archivePath = mapping.archivePath): BandiaItemResult {
  return { kind: "compress", sourcePath: mapping.extractedPath, archivePath, success: false, durationMs, command, error }
}

function skippedCompress(mapping: BandiaPathMapping, error: string): BandiaItemResult {
  return { kind: "compress", sourcePath: mapping.extractedPath, archivePath: mapping.archivePath, success: false, durationMs: 0, error, skipped: true }
}

function stripOuterQuotes(value: string): string {
  let resultValue = value.trim()
  while (resultValue.length >= 2 && isQuote(resultValue[0]!) && isQuote(resultValue[resultValue.length - 1]!)) {
    resultValue = resultValue.slice(1, -1).trim()
  }
  if (resultValue && isQuote(resultValue[0]!)) resultValue = resultValue.slice(1).trim()
  if (resultValue && isQuote(resultValue[resultValue.length - 1]!)) resultValue = resultValue.slice(0, -1).trim()
  return resultValue
}

function isQuote(value: string): boolean {
  return value === "\"" || value === "'"
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter((value) => value && !seen.has(value) && Boolean(seen.add(value)))
}

function uniqueMappings(values: BandiaPathMapping[]): BandiaPathMapping[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = `${value.archivePath}\0${value.extractedPath}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function shortError(resultValue: BandiaCommandResult): string {
  const message = (resultValue.stderr || resultValue.stdout || `exit code ${resultValue.code}`).trim()
  return message.length > 500 ? `...${message.slice(-497)}` : message
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map((part) => /\s/.test(part) ? `"${part.replace(/"/g, "\\\"")}"` : part).join(" ")
}

function csvRow(values: string[]): string {
  return values.map((value) => `"${value.replace(/"/g, "\"\"")}"`).join(",")
}

function toFileTime(milliseconds: number): string {
  return (BigInt(Math.round(milliseconds)) * 10000n + 116444736000000000n).toString()
}
