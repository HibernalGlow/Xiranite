import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type GifuAction = "inspect" | "plan" | "make"
export type GifuFormat = "auto" | "gif" | "webp" | "wbp" | "apng" | "webm" | "mp4"
export type GifuOutputMode = "same" | "separate"
export type GifuArchiveStatus = "ready" | "single" | "empty" | "converted" | "extracted" | "skipped" | "failed"

export interface GifuInput {
  action?: GifuAction
  paths?: string[]
  path?: string
  listText?: string
  listFile?: string
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
  loop?: number
  quality?: number
  webpMethod?: number
  ffmpegThreads?: number
  webmCrf?: number
  webmCpuUsed?: number
  mp4Preset?: string
  mp4Cq?: number
  maxWorkers?: number
  extractSingle?: boolean
  overwrite?: boolean
  dryRun?: boolean
}

export type NormalizedGifuInput = Required<GifuInput>

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

export interface GifuArchiveImageEntry {
  path: string
  extension: string
  size?: number
}

export interface GifuArchivePlan {
  archivePath: string
  outputPath: string
  imageCount: number
  decodedFrames?: number
  skippedFrames?: number
  format?: Exclude<GifuFormat, "auto" | "wbp">
  encoder?: string
  status: GifuArchiveStatus
  message?: string
  error?: string
}

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

/** A browser-safe summary of the native operation shown by the GUI. */
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
  convertedCount: number
  extractedCount: number
  skippedCount: number
  failedCount: number
  errors: string[]
}

export interface GifuConversionTask {
  archivePath: string
  outputPath: string
  images: readonly GifuArchiveImageEntry[]
  format: Exclude<GifuFormat, "auto" | "wbp">
  durationMs: number
  loop: number
  quality: number
  webpMethod: number
  ffmpegThreads: number
  webmCrf: number
  webmCpuUsed: number
  mp4Preset: string
  mp4Cq: number
  extractSingle: boolean
  overwrite: boolean
}

export interface GifuConversionOutcome {
  status: "converted" | "extracted" | "skipped"
  outputPath: string
  decodedFrames: number
  skippedFrames: number
  encoder: string
  message?: string
}

export interface GifuRuntime {
  readText: (path: string) => Promise<string>
  appendRecord: (path: string, record: unknown) => Promise<void>
  pathInfo: (path: string) => Promise<GifuPathInfo>
  listDir: (path: string) => Promise<GifuDirEntry[]>
  listArchiveImages: (path: string) => Promise<GifuArchiveImageEntry[]>
  convertArchive: (task: GifuConversionTask) => Promise<GifuConversionOutcome>
  cancel?: () => void
  isCancelled?: () => boolean
  join: (...parts: string[]) => string
  dirname: (path: string) => string
  basename: (path: string) => string
  extname: (path: string) => string
  relative: (from: string, to: string) => string
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
] as const

export const GIFU_IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
  ".gif",
  ".avif",
  ".jxl",
] as const

export const defaultGifuInput: NormalizedGifuInput = {
  action: "plan",
  paths: [],
  path: "",
  listText: "",
  listFile: "",
  configPath: "",
  configText: "",
  databasePath: "",
  recordRun: false,
  recursive: true,
  format: "webp",
  outDir: "",
  outMode: "same",
  namePrefix: "[#dyna]",
  nameTemplate: "{prefix}{stem}",
  durationMs: 120,
  loop: 0,
  quality: 85,
  webpMethod: 2,
  ffmpegThreads: 0,
  webmCrf: 34,
  webmCpuUsed: 6,
  mp4Preset: "p3",
  mp4Cq: 32,
  maxWorkers: 0,
  extractSingle: true,
  overwrite: false,
  dryRun: true,
}

export function normalizeGifuInput(input: GifuInput): NormalizedGifuInput {
  const format = input.format === "wbp" ? "webp" : input.format ?? defaultGifuInput.format
  const template = clean(input.nameTemplate) || defaultGifuInput.nameTemplate
  return {
    ...defaultGifuInput,
    ...defined(input),
    action: input.action ?? defaultGifuInput.action,
    path: clean(input.path),
    paths: uniqueClean([input.path, ...(input.paths ?? []), ...parsePathList(input.listText ?? "")]),
    listText: input.listText ?? "",
    listFile: clean(input.listFile),
    configPath: clean(input.configPath),
    configText: input.configText ?? "",
    databasePath: clean(input.databasePath),
    recursive: input.recursive ?? defaultGifuInput.recursive,
    format,
    outDir: clean(input.outDir),
    outMode: input.outMode ?? defaultGifuInput.outMode,
    namePrefix: input.namePrefix === undefined ? defaultGifuInput.namePrefix : input.namePrefix.trim(),
    nameTemplate: template.includes("{stem}") ? template : `${template}{stem}`,
    durationMs: finiteOr(input.durationMs, defaultGifuInput.durationMs),
    loop: finiteOr(input.loop, defaultGifuInput.loop),
    quality: finiteOr(input.quality, defaultGifuInput.quality),
    webpMethod: finiteOr(input.webpMethod, defaultGifuInput.webpMethod),
    ffmpegThreads: finiteOr(input.ffmpegThreads, defaultGifuInput.ffmpegThreads),
    webmCrf: finiteOr(input.webmCrf, defaultGifuInput.webmCrf),
    webmCpuUsed: finiteOr(input.webmCpuUsed, defaultGifuInput.webmCpuUsed),
    mp4Preset: clean(input.mp4Preset) || defaultGifuInput.mp4Preset,
    mp4Cq: finiteOr(input.mp4Cq, defaultGifuInput.mp4Cq),
    maxWorkers: finiteOr(input.maxWorkers, defaultGifuInput.maxWorkers),
    extractSingle: input.extractSingle ?? defaultGifuInput.extractSingle,
    overwrite: input.overwrite ?? defaultGifuInput.overwrite,
    dryRun: input.dryRun ?? defaultGifuInput.dryRun,
    recordRun: input.recordRun ?? Boolean(input.databasePath),
  }
}

export async function runGifu(
  input: GifuInput,
  runtime: GifuRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<GifuResult> {
  try {
    const listInput = input.listFile ? await readListFileInput(input.listFile, runtime) : {}
    const configInput = await loadGifuConfigInput(input, runtime)
    const normalized = normalizeGifuInput(mergeGifuConfigInput(mergeGifuConfigInput(configInput, listInput), input))
    const validationError = validateGifuInput(normalized)
    if (validationError) return failure(validationError)
    if (!normalized.paths.length) return failure("At least one archive, directory, or list entry is required.")

    const config = await loadGifuConfigSummary(normalized, runtime)
    onEvent({ type: "progress", progress: 10, message: "Collecting archives." })
    const archivePaths = await collectArchives(normalized.paths, normalized.recursive, runtime)
    const commonRoot = normalized.outMode === "separate" ? findCommonParent(archivePaths, runtime) : ""
    const scans: Array<{ plan: GifuArchivePlan; images: GifuArchiveImageEntry[] }> = []

    for (let index = 0; index < archivePaths.length; index += 1) {
      const archivePath = archivePaths[index]!
      const progress = archivePaths.length ? 15 + Math.round(((index + 1) / archivePaths.length) * 40) : 55
      onEvent({ type: "progress", progress, message: `Inspecting ${runtime.basename(archivePath)}.` })
      try {
        const images = await runtime.listArchiveImages(archivePath)
        const imageCount = images.length
        scans.push({
          images,
          plan: {
            archivePath,
            outputPath: buildOutputPath(archivePath, normalized, runtime, commonRoot),
            imageCount,
            format: effectiveGifuFormat(normalized.format),
            status: imageCount >= 2 ? "ready" : imageCount === 1 ? "single" : "empty",
          },
        })
      } catch (error) {
        const message = messageOf(error)
        scans.push({
          images: [],
          plan: {
            archivePath,
            outputPath: buildOutputPath(archivePath, normalized, runtime, commonRoot),
            imageCount: 0,
            format: effectiveGifuFormat(normalized.format),
            status: "failed",
            error: message,
          },
        })
      }
    }

    const command = buildGifuCommand(normalized)
    const database = buildGifuDatabase(normalized, scans.map((item) => item.plan), runtime)
    if (normalized.action !== "make" || normalized.dryRun) {
      const archives = scans.map((item) => item.plan)
      const action = normalized.action === "make" ? "plan" : normalized.action
      await writeGifuRecordIfEnabled(action, normalized, archives, command, undefined, database, runtime)
      const failed = archives.filter((item) => item.status === "failed").length
      return {
        success: failed === 0,
        message: failed ? `Gifu inspected ${archives.length} archive(s) with ${failed} failure(s).` : `Gifu planned ${archives.length} archive(s).`,
        data: data({ archives, config, database, command }),
      }
    }

    onEvent({ type: "progress", progress: 60, message: "Starting native conversion." })
    let completed = 0
    const archives = await mapConcurrent(scans, resolveMaxWorkers(normalized.maxWorkers, scans.length), async ({ plan, images }): Promise<GifuArchivePlan> => {
      if (plan.status === "failed") return plan
      if (runtime.isCancelled?.()) return { ...plan, status: "skipped", message: "Cancelled." }
      if (plan.status === "empty") return { ...plan, status: "skipped", message: "No supported image entries." }
      if (plan.status === "single" && !normalized.extractSingle) {
        return { ...plan, status: "skipped", message: "Single-image extraction is disabled." }
      }

      try {
        const outcome = await runtime.convertArchive({
          archivePath: plan.archivePath,
          outputPath: plan.outputPath,
          images,
          format: effectiveGifuFormat(normalized.format),
          durationMs: normalized.durationMs,
          loop: normalized.loop,
          quality: normalized.quality,
          webpMethod: normalized.webpMethod,
          ffmpegThreads: normalized.ffmpegThreads,
          webmCrf: normalized.webmCrf,
          webmCpuUsed: normalized.webmCpuUsed,
          mp4Preset: normalized.mp4Preset,
          mp4Cq: normalized.mp4Cq,
          extractSingle: normalized.extractSingle,
          overwrite: normalized.overwrite,
        })
        return {
          ...plan,
          outputPath: outcome.outputPath,
          status: outcome.status,
          decodedFrames: outcome.decodedFrames,
          skippedFrames: outcome.skippedFrames,
          encoder: outcome.encoder,
          message: outcome.message,
        }
      } catch (error) {
        return { ...plan, status: "failed", error: messageOf(error) }
      } finally {
        completed += 1
        const progress = 60 + Math.round((completed / Math.max(1, scans.length)) * 35)
        onEvent({ type: "progress", progress, message: `Finished ${completed}/${scans.length} archive(s).` })
      }
    })

    const summary = data({ archives, config, database, command })
    const commandResult: CommandResult = {
      code: summary.failedCount ? 1 : 0,
      stdout: `${summary.convertedCount} converted, ${summary.extractedCount} extracted, ${summary.skippedCount} skipped`,
      stderr: summary.errors.join("\n"),
    }
    summary.commandResult = commandResult
    await writeGifuRecordIfEnabled("make", normalized, archives, command, commandResult, database, runtime)
    onEvent({ type: "progress", progress: 100, message: "Native conversion finished." })
    return {
      success: summary.failedCount === 0,
      message: summary.failedCount
        ? `Gifu completed with ${summary.failedCount} failure(s).`
        : `Gifu converted ${summary.convertedCount} archive(s) and extracted ${summary.extractedCount} single image(s).`,
      data: summary,
    }
  } catch (error) {
    return failure(messageOf(error))
  }
}

export async function loadGifuConfigInput(input: GifuInput, runtime: Pick<GifuRuntime, "readText">): Promise<GifuInput> {
  const text = input.configText || (input.configPath ? await runtime.readText(input.configPath) : "")
  if (!text.trim()) return {}
  return parseGifuTomlConfig(text)
}

async function readListFileInput(path: string, runtime: Pick<GifuRuntime, "readText">): Promise<GifuInput> {
  return { paths: parsePathList(await runtime.readText(path)) }
}

export async function loadGifuConfigSummary(input: NormalizedGifuInput, runtime: Pick<GifuRuntime, "readText">): Promise<GifuConfigSummary | undefined> {
  const text = input.configText || (input.configPath ? await runtime.readText(input.configPath) : "")
  if (!text.trim()) return undefined
  const parsed = parseTomlLikeKeys(text)
  return { path: input.configPath, keys: parsed.keys, tables: parsed.tables }
}

export function mergeGifuConfigInput(config: GifuInput, input: GifuInput): GifuInput {
  const merged = { ...config }
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value
  }
  return merged
}

export function parseGifuTomlConfig(text: string): GifuInput {
  const values = parseTomlLikeValues(text)
  return {
    path: stringValue(first(values, "path", "input.path")),
    paths: arrayValue(first(values, "paths", "input.paths")),
    listText: stringValue(first(values, "listText", "list_text", "input.list_text")),
    listFile: stringValue(first(values, "listFile", "list_file", "input.list_file")),
    recursive: booleanValue(first(values, "recursive", "input.recursive")),
    format: enumValue(first(values, "format", "output.format"), ["auto", "gif", "webp", "wbp", "apng", "webm", "mp4"]),
    outDir: stringValue(first(values, "outDir", "out_dir", "output.out_dir")),
    outMode: enumValue(first(values, "outMode", "out_mode", "output.out_mode"), ["same", "separate"]),
    namePrefix: stringValue(first(values, "namePrefix", "name_prefix", "naming.prefix")),
    nameTemplate: stringValue(first(values, "nameTemplate", "name_template", "naming.template")),
    durationMs: numberValue(first(values, "durationMs", "duration_ms", "output.duration_ms")),
    loop: numberValue(first(values, "loop", "output.loop")),
    quality: numberValue(first(values, "quality", "output.quality")),
    webpMethod: numberValue(first(values, "webpMethod", "webp_method", "output.webp_method")),
    ffmpegThreads: numberValue(first(values, "ffmpegThreads", "ffmpeg_threads", "video.ffmpeg_threads")),
    webmCrf: numberValue(first(values, "webmCrf", "webm_crf", "video.webm_crf")),
    webmCpuUsed: numberValue(first(values, "webmCpuUsed", "webm_cpu_used", "video.webm_cpu_used")),
    mp4Preset: stringValue(first(values, "mp4Preset", "mp4_preset", "video.mp4_preset")),
    mp4Cq: numberValue(first(values, "mp4Cq", "mp4_cq", "video.mp4_cq")),
    maxWorkers: numberValue(first(values, "maxWorkers", "max_workers", "performance.max_workers")),
    extractSingle: booleanValue(first(values, "extractSingle", "extract_single", "output.extract_single")),
    overwrite: booleanValue(first(values, "overwrite", "execution.overwrite")),
    dryRun: booleanValue(first(values, "dryRun", "dry_run", "execution.dry_run")),
    databasePath: stringValue(first(values, "databasePath", "database_path", "record.path")),
    recordRun: booleanValue(first(values, "recordRun", "record_run", "record.enabled")),
  }
}

export function parseTomlLikeKeys(text: string): { keys: string[]; tables: string[] } {
  const keys = new Set<string>()
  const tables = new Set<string>()
  let table = ""
  for (const raw of text.split(/\r?\n/)) {
    const line = stripTomlComment(raw).trim()
    if (!line) continue
    const match = /^\[([^\]]+)]$/.exec(line)
    if (match) {
      table = match[1]!.trim()
      tables.add(table)
      continue
    }
    const index = line.indexOf("=")
    if (index > 0) keys.add(table ? `${table}.${line.slice(0, index).trim()}` : line.slice(0, index).trim())
  }
  return { keys: [...keys].sort(), tables: [...tables].sort() }
}

export function validateGifuInput(input: NormalizedGifuInput): string | null {
  if (input.durationMs <= 0) return "durationMs must be greater than zero."
  if (input.loop < 0) return "loop must be greater than or equal to zero."
  if (input.quality < 1 || input.quality > 100) return "quality must be between 1 and 100."
  if (input.webpMethod < 0 || input.webpMethod > 6) return "webpMethod must be between 0 and 6."
  if (input.ffmpegThreads < 0) return "ffmpegThreads must be greater than or equal to zero."
  if (input.webmCrf < 0 || input.webmCrf > 63) return "webmCrf must be between 0 and 63."
  if (input.webmCpuUsed < 0 || input.webmCpuUsed > 8) return "webmCpuUsed must be between 0 and 8."
  if (!/^p[1-7]$/.test(input.mp4Preset)) return "mp4Preset must be p1 through p7."
  if (input.mp4Cq < 0 || input.mp4Cq > 63) return "mp4Cq must be between 0 and 63."
  if (input.maxWorkers < 0) return "maxWorkers must be greater than or equal to zero."
  return null
}

export function buildGifuDatabase(input: NormalizedGifuInput, archives: GifuArchivePlan[], runtime: Pick<GifuRuntime, "dirname" | "join">): GifuDatabase | undefined {
  const path = input.databasePath || defaultGifuDatabasePath(input, archives, runtime)
  if (!path) return undefined
  return { path, enabled: input.recordRun, mode: "jsonl", defaultPath: !input.databasePath }
}

export function defaultGifuDatabasePath(input: Pick<NormalizedGifuInput, "paths" | "outDir">, archives: GifuArchivePlan[], runtime: Pick<GifuRuntime, "dirname" | "join">): string {
  const fallback = input.paths[0] ?? ""
  const base = input.outDir || (archives[0] ? runtime.dirname(archives[0].archivePath) : isGifuArchive(fallback) ? runtime.dirname(fallback) : fallback)
  return base ? runtime.join(base, ".xiranite", "gifu-runs.jsonl") : ""
}

export function buildGifuRunRecord(
  action: GifuAction,
  input: NormalizedGifuInput,
  archives: GifuArchivePlan[],
  command: GifuCommandPlan,
  commandResult?: CommandResult,
): Record<string, unknown> {
  const summary = data({ archives })
  return {
    toolId: "gifu",
    engine: "native-ts",
    action,
    paths: input.paths,
    options: {
      recursive: input.recursive,
      format: input.format,
      outMode: input.outMode,
      outDir: input.outDir || undefined,
      durationMs: input.durationMs,
      loop: input.loop,
      quality: input.quality,
      maxWorkers: input.maxWorkers,
      extractSingle: input.extractSingle,
      overwrite: input.overwrite,
      dryRun: input.dryRun,
    },
    archiveCount: archives.length,
    readyCount: summary.readyCount,
    convertedCount: summary.convertedCount,
    extractedCount: summary.extractedCount,
    skippedCount: summary.skippedCount,
    failedCount: summary.failedCount,
    command,
    success: commandResult ? commandResult.code === 0 : summary.failedCount === 0,
    code: commandResult?.code,
    at: new Date().toISOString(),
  }
}

export async function collectArchives(paths: string[], recursive: boolean, runtime: GifuRuntime): Promise<string[]> {
  const found: string[] = []
  const seen = new Set<string>()
  async function add(path: string) {
    const key = path.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
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
    const entries = await runtime.listDir(info.path)
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
    for (const entry of entries) {
      if (entry.isFile && isGifuArchive(entry.path)) await add(entry.path)
      else if (recursive && entry.isDirectory) await visit(entry.path)
    }
  }
  for (const path of paths) await visit(path)
  return found
}

/** Kept as a compatibility-facing preview, now describing only native execution. */
export function buildGifuCommand(input: NormalizedGifuInput): GifuCommandPlan {
  const args = [input.action, ...input.paths, "--format", effectiveGifuFormat(input.format), input.recursive ? "--recursive" : "--no-recursive"]
  args.push("--duration", String(input.durationMs), "--out-mode", input.outMode)
  if (input.outDir) args.push("--out-dir", input.outDir)
  if (input.overwrite) args.push("--overwrite")
  if (input.dryRun) args.push("--dry-run")
  return { command: "gifu-native", args }
}

export function buildOutputPath(
  archivePath: string,
  input: NormalizedGifuInput,
  runtime: Pick<GifuRuntime, "dirname" | "basename" | "extname" | "join" | "relative">,
  commonRoot = "",
): string {
  const format = effectiveGifuFormat(input.format)
  const extension = `.${format}`
  const parent = runtime.dirname(archivePath)
  const archive = runtime.basename(archivePath)
  const stem = archive.slice(0, Math.max(0, archive.length - runtime.extname(archive).length)) || archive
  if (input.outMode === "separate") {
    let root = commonRoot || parent
    let relativeParent = runtime.relative(root, parent)
    if (isOutsideRelative(relativeParent)) {
      root = parent
      relativeParent = ""
    }
    const base = input.outDir || runtime.dirname(root)
    const directory = sanitizeOutputStem(`${input.namePrefix}${runtime.basename(root) || "output"}`)
    const outputName = `${sanitizeOutputStem(renderTemplate("{stem}", { prefix: "", stem, archive, parent: runtime.basename(parent) }))}${extension}`
    return relativeParent ? runtime.join(base, directory, relativeParent, outputName) : runtime.join(base, directory, outputName)
  }
  const outputName = `${sanitizeOutputStem(renderTemplate(input.nameTemplate, { prefix: input.namePrefix, stem, archive, parent: runtime.basename(parent) }))}${extension}`
  return runtime.join(input.outDir || parent, outputName)
}

export function findCommonParent(paths: readonly string[], runtime: Pick<GifuRuntime, "dirname" | "relative">): string {
  if (!paths.length) return ""
  let common = runtime.dirname(paths[0]!)
  for (const path of paths.slice(1)) {
    const parent = runtime.dirname(path)
    while (common && isOutsideRelative(runtime.relative(common, parent))) {
      const next = runtime.dirname(common)
      if (!next || next === common) return ""
      common = next
    }
  }
  return common
}

export function resolveMaxWorkers(requested: number, taskCount: number): number {
  if (taskCount <= 1) return Math.max(1, taskCount)
  if (requested > 0) return Math.max(1, Math.min(Math.floor(requested), taskCount))
  // Media conversions are memory-heavy. Keep auto mode bounded even on large hosts.
  return Math.max(1, Math.min(4, taskCount))
}

export function parsePathList(text: string): string[] {
  return text.split(/\r?\n|;/).map(clean).filter((line) => line && !line.startsWith("#"))
}

export function isGifuArchive(path: string): boolean {
  const lower = path.toLowerCase()
  return GIFU_ARCHIVE_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

export function isGifuImage(path: string): boolean {
  const lower = path.toLowerCase()
  return GIFU_IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

export function effectiveGifuFormat(format: GifuFormat): Exclude<GifuFormat, "auto" | "wbp"> {
  return format === "auto" || format === "wbp" ? "webp" : format
}

async function writeGifuRecordIfEnabled(
  action: GifuAction,
  input: NormalizedGifuInput,
  archives: GifuArchivePlan[],
  command: GifuCommandPlan,
  commandResult: CommandResult | undefined,
  database: GifuDatabase | undefined,
  runtime: Pick<GifuRuntime, "appendRecord">,
): Promise<void> {
  if (database?.enabled) await runtime.appendRecord(database.path, buildGifuRunRecord(action, input, archives, command, commandResult))
}

function renderTemplate(template: string, values: Record<string, string>): string {
  if (/\{(?!prefix}|stem}|archive}|parent})[^}]+}/.test(template)) return `${values.prefix}${values.stem}`
  return template.replace(/\{(prefix|stem|archive|parent)}/g, (_, key: string) => values[key] ?? "")
}

function sanitizeOutputStem(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*]/g, "_").trim().replace(/^\.+|\.+$/g, "")
  return cleaned || "output"
}

function parseTomlLikeValues(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  let table = ""
  for (const raw of text.split(/\r?\n/)) {
    const line = stripTomlComment(raw).trim()
    if (!line) continue
    const tableMatch = /^\[([^\]]+)]$/.exec(line)
    if (tableMatch) {
      table = tableMatch[1]!.trim()
      continue
    }
    const index = line.indexOf("=")
    if (index <= 0) continue
    const key = line.slice(0, index).trim()
    values[key] = line.slice(index + 1).trim()
    if (table) values[`${table}.${key}`] = values[key]!
  }
  return values
}

function stripTomlComment(value: string): string {
  let quote = ""
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!
    if ((char === '"' || char === "'") && value[index - 1] !== "\\") quote = quote === char ? "" : quote || char
    if (char === "#" && !quote) return value.slice(0, index)
  }
  return value
}

function first(values: Record<string, string>, ...keys: string[]): string | undefined {
  for (const key of keys) if (values[key] !== undefined) return values[key]
  return undefined
}

function stringValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  return value.trim().replace(/^(["'])|(["'])$/g, "")
}

function arrayValue(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [stringValue(trimmed) ?? ""].filter(Boolean)
  return trimmed.slice(1, -1).split(",").map(stringValue).filter((item): item is string => Boolean(item))
}

function booleanValue(value: string | undefined): boolean | undefined {
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
  const normalized = stringValue(value)?.toLowerCase()
  return allowed.find((item) => item === normalized)
}

function data(partial: Partial<GifuData>): GifuData {
  const archives = partial.archives ?? []
  const errors = archives.flatMap((item) => item.error ? [`${item.archivePath}: ${item.error}`] : [])
  return {
    archives,
    readyCount: archives.filter((item) => item.status === "ready").length,
    singleCount: archives.filter((item) => item.status === "single").length,
    emptyCount: archives.filter((item) => item.status === "empty").length,
    convertedCount: archives.filter((item) => item.status === "converted").length,
    extractedCount: archives.filter((item) => item.status === "extracted").length,
    skippedCount: archives.filter((item) => item.status === "skipped").length,
    failedCount: archives.filter((item) => item.status === "failed").length,
    errors,
    ...partial,
  }
}

function failure(message: string): GifuResult {
  return { success: false, message, data: data({ archives: [], errors: [message] }) }
}

function clean(value: unknown): string {
  const text = String(value ?? "").trim()
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) return text.slice(1, -1).trim()
  return text
}

function uniqueClean(values: unknown[]): string[] {
  return [...new Set(values.map(clean).filter(Boolean))]
}

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback
}

function defined(input: GifuInput): Partial<NormalizedGifuInput> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) if (value !== undefined) result[key] = value
  return result as Partial<NormalizedGifuInput>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isOutsideRelative(value: string): boolean {
  return value === ".." || value.startsWith(`..\\`) || value.startsWith("../") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/")
}

async function mapConcurrent<T, R>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = Array.from({ length: items.length }) as R[]
  let next = 0
  const runners = Array.from({ length: Math.min(Math.max(1, limit), Math.max(1, items.length)) }, async () => {
    while (true) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await worker(items[index]!, index)
    }
  })
  await Promise.all(runners)
  return results
}
