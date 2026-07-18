import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type BitvAction = "status" | "analyze" | "classify" | "report"
export type BitvTransferMode = "copy" | "move"

export interface BitvInput {
  action?: BitvAction
  paths?: string[]
  reportPath?: string
  targetPath?: string
  outputPath?: string
  recursive?: boolean
  bitrateStepMbps?: number
  maxLevels?: number
  transferMode?: BitvTransferMode
  /** Classify/report are previews unless this is explicitly false. */
  dryRun?: boolean
}

export interface BitvSourceFile {
  path: string
  basePath: string
  relativePath: string
}

export interface BitvDiscoveryResult {
  files: BitvSourceFile[]
  errors: string[]
}

export interface BitvFileStat {
  sizeBytes: number
}

export interface BitvVideoInfo {
  path: string
  relativePath: string
  filename: string
  durationSeconds: number
  bitrateBps: number
  bitrateMbps: number
  width: number
  height: number
  fps: number
  sizeBytes: number
  resolution: string
  bitrateLevel: string
}

export interface BitvStats {
  totalVideos: number
  totalSizeBytes: number
  totalDurationSeconds: number
  averageBitrateMbps: number
  bitrateDistribution: Record<string, number>
}

export interface BitvFileOperation {
  mode: BitvTransferMode
  sourcePath: string
  desiredPath: string
  targetPath: string
  bitrateLevel: string
  dryRun: boolean
  success: boolean
  error?: string
}

export interface BitvAnalysisReport {
  schemaVersion: 1
  createdAt: string
  requestedPaths: string[]
  recursive: boolean
  bitrateStepMbps: number
  maxLevels: number
  videos: BitvVideoInfo[]
  stats: BitvStats
}

export interface BitvData {
  action: BitvAction
  ffprobePath?: string
  requestedPaths: string[]
  videos: BitvVideoInfo[]
  stats: BitvStats
  operations: BitvFileOperation[]
  reportPath?: string
  dryRun: boolean
  errors: string[]
}

export interface BitvRuntime {
  findFfprobe: () => Promise<string | null>
  discoverVideos: (paths: string[], recursive: boolean) => Promise<BitvDiscoveryResult>
  statFile: (path: string) => Promise<BitvFileStat>
  runFfprobeJson: (ffprobePath: string, path: string) => Promise<unknown>
  readJson: (path: string) => Promise<unknown>
  /** Writes without overwriting an existing file and returns the actual path. */
  writeJson: (desiredPath: string, value: unknown) => Promise<string>
  resolveAvailablePath: (desiredPath: string) => Promise<string>
  /** Copies/moves without overwriting an existing file and returns the actual path. */
  transferFile: (sourcePath: string, desiredPath: string, mode: BitvTransferMode) => Promise<string>
  now: () => Date
  dirname: (path: string) => string
}

export type BitvResult = NodeRunResult<BitvData>

export const BITV_DEFAULTS = {
  recursive: true,
  bitrateStepMbps: 5,
  maxLevels: 10,
  transferMode: "copy" as BitvTransferMode,
  dryRun: true,
} as const

export const BITV_VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".avi",
  ".mkv",
  ".mov",
  ".wmv",
  ".flv",
  ".webm",
  ".m4v",
  ".mpg",
  ".mpeg",
  ".ogv",
  ".ts",
  ".mts",
  ".m2ts",
])

export interface BitrateLevel {
  label: string
  thresholdBps: number
}

export function createBitrateLevels(
  bitrateStepMbps: number = BITV_DEFAULTS.bitrateStepMbps,
  maxLevels: number = BITV_DEFAULTS.maxLevels,
): BitrateLevel[] {
  assertBitrateSettings(bitrateStepMbps, maxLevels)
  const levels = Array.from({ length: maxLevels }, (_, index) => {
    const thresholdMbps = (index + 1) * bitrateStepMbps
    return {
      label: `${formatThreshold(thresholdMbps)}Mbps`,
      thresholdBps: thresholdMbps * 1_000_000,
    }
  })
  const maximum = maxLevels * bitrateStepMbps
  levels.push({ label: `over-${formatThreshold(maximum)}Mbps`, thresholdBps: Number.POSITIVE_INFINITY })
  return levels
}

export function bitrateLevelFor(bitrateBps: number, levels: readonly BitrateLevel[]): string {
  return levels.find((level) => bitrateBps <= level.thresholdBps)?.label ?? levels.at(-1)?.label ?? "unknown"
}

export function isBitvVideoPath(path: string): boolean {
  const filename = basename(path).toLowerCase()
  const index = filename.lastIndexOf(".")
  return index >= 0 && BITV_VIDEO_EXTENSIONS.has(filename.slice(index))
}

export function parseBitvPaths(paths: string[] | undefined): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of paths ?? []) {
    for (const line of item.split(/\r?\n/)) {
      const path = line.trim().replace(/^['"]|['"]$/g, "")
      if (!path || seen.has(path)) continue
      seen.add(path)
      result.push(path)
    }
  }
  return result
}

export function parseFfprobeVideo(
  path: string,
  relativePath: string,
  fileStat: BitvFileStat,
  rawProbe: unknown,
  levels: readonly BitrateLevel[],
): BitvVideoInfo {
  const probe = asRecord(rawProbe)
  const streams = Array.isArray(probe?.streams) ? probe.streams.map(asRecord).filter(isRecord) : []
  const video = streams.find((stream) => stream.codec_type === "video")
  if (!video) throw new Error("ffprobe returned no video stream")

  const format = asRecord(probe?.format)
  const durationSeconds = firstPositiveNumber(format?.duration, video.duration)
  if (!(durationSeconds > 0)) throw new Error("ffprobe returned no positive duration")
  if (!(fileStat.sizeBytes >= 0) || !Number.isFinite(fileStat.sizeBytes)) throw new Error("file size is invalid")

  const width = nonNegativeInteger(video.width)
  const height = nonNegativeInteger(video.height)
  const fps = parseFrameRate(video.avg_frame_rate ?? video.r_frame_rate)
  const bitrateBps = (fileStat.sizeBytes * 8) / durationSeconds

  return {
    path,
    relativePath: safeRelativePath(relativePath, basename(path)),
    filename: basename(path),
    durationSeconds,
    bitrateBps,
    bitrateMbps: bitrateBps / 1_000_000,
    width,
    height,
    fps,
    sizeBytes: fileStat.sizeBytes,
    resolution: `${width}x${height}`,
    bitrateLevel: bitrateLevelFor(bitrateBps, levels),
  }
}

export async function runBitv(
  input: BitvInput,
  runtime: BitvRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<BitvResult> {
  const action = input.action ?? "status"
  const requestedPaths = parseBitvPaths(input.paths)
  const dryRun = input.dryRun !== false
  const base = emptyData(action, requestedPaths, dryRun)

  if (action === "status") {
    const ffprobePath = await runtime.findFfprobe()
    if (!ffprobePath) {
      return { success: false, message: "ffprobe was not found on this system.", data: base }
    }
    return {
      success: true,
      message: `ffprobe is ready: ${ffprobePath}`,
      data: { ...base, ffprobePath },
    }
  }

  const settingsError = validateBitrateSettings(input.bitrateStepMbps, input.maxLevels)
  if (settingsError) return { success: false, message: settingsError, data: base }
  const bitrateStepMbps = input.bitrateStepMbps ?? BITV_DEFAULTS.bitrateStepMbps
  const maxLevels = input.maxLevels ?? BITV_DEFAULTS.maxLevels
  const levels = createBitrateLevels(bitrateStepMbps, maxLevels)

  if (action === "report") {
    return runReportClassification(input, runtime, levels, base, onEvent)
  }

  if (requestedPaths.length === 0) {
    return { success: false, message: "Provide at least one video file or directory path.", data: base }
  }

  const ffprobePath = await runtime.findFfprobe()
  if (!ffprobePath) {
    return { success: false, message: "ffprobe was not found on this system.", data: base }
  }

  const recursive = input.recursive ?? BITV_DEFAULTS.recursive
  onEvent({ type: "progress", progress: 0, message: "Scanning video paths." })
  const discovery = await runtime.discoverVideos(requestedPaths, recursive)
  if (discovery.files.length === 0) {
    const errors = discovery.errors.length ? discovery.errors : ["No supported video files were found."]
    return {
      success: false,
      message: "No supported video files were found.",
      data: { ...base, ffprobePath, errors },
    }
  }

  const analysis = await analyzeVideos(discovery.files, ffprobePath, levels, runtime, onEvent)
  const errors = [...discovery.errors, ...analysis.errors]
  const stats = summarizeVideos(analysis.videos)

  if (action === "analyze") {
    let reportPath: string | undefined
    if (input.outputPath?.trim()) {
      const report = createAnalysisReport(
        requestedPaths,
        recursive,
        bitrateStepMbps,
        maxLevels,
        analysis.videos,
        stats,
        runtime.now(),
      )
      try {
        reportPath = await runtime.writeJson(input.outputPath.trim(), report)
      } catch (error) {
        errors.push(`Report: ${errorMessage(error)}`)
      }
    }
    const success = analysis.videos.length > 0 && errors.length === 0
    onEvent({ type: "progress", progress: 100, message: "Video analysis completed." })
    return {
      success,
      message: success
        ? `Analyzed ${analysis.videos.length} video(s).`
        : `Analyzed ${analysis.videos.length} video(s) with ${errors.length} error(s).`,
      data: {
        ...base,
        ffprobePath,
        videos: analysis.videos,
        stats,
        reportPath,
        errors,
      },
    }
  }

  const targetPath = input.targetPath?.trim()
  if (!targetPath) {
    return {
      success: false,
      message: "Classify requires a target directory.",
      data: { ...base, ffprobePath, videos: analysis.videos, stats, errors },
    }
  }

  const operations = await classifyVideos(
    analysis.videos,
    targetPath,
    input.transferMode ?? BITV_DEFAULTS.transferMode,
    dryRun,
    runtime,
    onEvent,
  )
  errors.push(...operations.flatMap((operation) => operation.error ? [operation.error] : []))
  const success = analysis.videos.length > 0 && errors.length === 0
  onEvent({ type: "progress", progress: 100, message: dryRun ? "Classification preview completed." : "Classification completed." })
  return {
    success,
    message: dryRun
      ? `Planned ${operations.length} classification operation(s); no files were changed.`
      : success
        ? `Classified ${operations.length} video(s).`
        : `Classified ${operations.filter((operation) => operation.success).length} video(s) with ${errors.length} error(s).`,
    data: { ...base, ffprobePath, videos: analysis.videos, stats, operations, errors },
  }
}

export function createAnalysisReport(
  requestedPaths: string[],
  recursive: boolean,
  bitrateStepMbps: number,
  maxLevels: number,
  videos: BitvVideoInfo[],
  stats: BitvStats,
  now: Date,
): BitvAnalysisReport {
  return {
    schemaVersion: 1,
    createdAt: now.toISOString(),
    requestedPaths: [...requestedPaths],
    recursive,
    bitrateStepMbps,
    maxLevels,
    videos: videos.map((video) => ({ ...video })),
    stats: { ...stats, bitrateDistribution: { ...stats.bitrateDistribution } },
  }
}

export function normalizeBitvReport(value: unknown, fallbackCreatedAt = new Date(0).toISOString()): BitvAnalysisReport {
  const record = asRecord(value)
  if (!record) throw new Error("Report must be a JSON object.")
  const rawVideos = Array.isArray(record.videos) ? record.videos : []
  const videos = rawVideos.map((item) => normalizeReportVideo(item)).filter((item): item is BitvVideoInfo => Boolean(item))
  if (videos.length === 0) throw new Error("Report contains no usable videos.")

  const legacyFolder = stringValue(record.folder_path)
  const requestedPaths = stringArray(record.requestedPaths)
  if (requestedPaths.length === 0 && legacyFolder) requestedPaths.push(legacyFolder)
  const bitrateStepMbps = positiveNumber(record.bitrateStepMbps) ?? BITV_DEFAULTS.bitrateStepMbps
  const maxLevels = positiveInteger(record.maxLevels) ?? BITV_DEFAULTS.maxLevels

  return {
    schemaVersion: 1,
    createdAt: stringValue(record.createdAt) || stringValue(record.timestamp) || fallbackCreatedAt,
    requestedPaths,
    recursive: typeof record.recursive === "boolean" ? record.recursive : BITV_DEFAULTS.recursive,
    bitrateStepMbps,
    maxLevels,
    videos,
    stats: summarizeVideos(videos),
  }
}

export function summarizeVideos(videos: readonly BitvVideoInfo[]): BitvStats {
  const bitrateDistribution: Record<string, number> = {}
  let totalSizeBytes = 0
  let totalDurationSeconds = 0
  let totalBitrateMbps = 0
  for (const video of videos) {
    totalSizeBytes += video.sizeBytes
    totalDurationSeconds += video.durationSeconds
    totalBitrateMbps += video.bitrateMbps
    bitrateDistribution[video.bitrateLevel] = (bitrateDistribution[video.bitrateLevel] ?? 0) + 1
  }
  return {
    totalVideos: videos.length,
    totalSizeBytes,
    totalDurationSeconds,
    averageBitrateMbps: videos.length > 0 ? totalBitrateMbps / videos.length : 0,
    bitrateDistribution,
  }
}

async function runReportClassification(
  input: BitvInput,
  runtime: BitvRuntime,
  levels: readonly BitrateLevel[],
  base: BitvData,
  onEvent: (event: NodeRunEvent) => void,
): Promise<BitvResult> {
  const reportPath = input.reportPath?.trim() || parseBitvPaths(input.paths)[0]
  if (!reportPath) return { success: false, message: "Report classification requires a JSON report path.", data: base }

  let report: BitvAnalysisReport
  try {
    report = normalizeBitvReport(await runtime.readJson(reportPath), runtime.now().toISOString())
  } catch (error) {
    return {
      success: false,
      message: `Unable to read BitV report: ${errorMessage(error)}`,
      data: { ...base, reportPath, errors: [errorMessage(error)] },
    }
  }

  // Reclassify from the stored numeric bitrate when a report came from an
  // older schema whose labels used different wording.
  const videos = report.videos.map((video) => ({
    ...video,
    bitrateLevel: video.bitrateBps > 0 ? bitrateLevelFor(video.bitrateBps, levels) : video.bitrateLevel,
  }))
  const targetPath = input.targetPath?.trim() || runtime.dirname(reportPath)
  const dryRun = input.dryRun !== false
  const operations = await classifyVideos(
    videos,
    targetPath,
    input.transferMode ?? BITV_DEFAULTS.transferMode,
    dryRun,
    runtime,
    onEvent,
  )
  const errors = operations.flatMap((operation) => operation.error ? [operation.error] : [])
  const success = operations.length > 0 && errors.length === 0
  onEvent({ type: "progress", progress: 100, message: dryRun ? "Report classification preview completed." : "Report classification completed." })
  return {
    success,
    message: dryRun
      ? `Planned ${operations.length} report classification operation(s); no files were changed.`
      : success
        ? `Classified ${operations.length} video(s) from report.`
        : `Classified ${operations.filter((operation) => operation.success).length} report video(s) with ${errors.length} error(s).`,
    data: {
      ...base,
      requestedPaths: [reportPath],
      videos,
      stats: summarizeVideos(videos),
      operations,
      reportPath,
      errors,
    },
  }
}

async function analyzeVideos(
  files: readonly BitvSourceFile[],
  ffprobePath: string,
  levels: readonly BitrateLevel[],
  runtime: BitvRuntime,
  onEvent: (event: NodeRunEvent) => void,
): Promise<{ videos: BitvVideoInfo[]; errors: string[] }> {
  const videos: BitvVideoInfo[] = []
  const errors: string[] = []
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!
    const progress = Math.round(5 + (index / files.length) * 65)
    onEvent({ type: "progress", progress, message: `Analyzing ${basename(file.path)}.` })
    try {
      const [fileStat, probe] = await Promise.all([
        runtime.statFile(file.path),
        runtime.runFfprobeJson(ffprobePath, file.path),
      ])
      videos.push(parseFfprobeVideo(file.path, file.relativePath, fileStat, probe, levels))
    } catch (error) {
      errors.push(`${file.path}: ${errorMessage(error)}`)
    }
  }
  return { videos, errors }
}

async function classifyVideos(
  videos: readonly BitvVideoInfo[],
  targetPath: string,
  mode: BitvTransferMode,
  dryRun: boolean,
  runtime: BitvRuntime,
  onEvent: (event: NodeRunEvent) => void,
): Promise<BitvFileOperation[]> {
  const operations: BitvFileOperation[] = []
  for (let index = 0; index < videos.length; index += 1) {
    const video = videos[index]!
    const desiredPath = joinPath(targetPath, safePathSegment(video.bitrateLevel), safeRelativePath(video.relativePath, video.filename))
    const progress = Math.round(72 + (index / videos.length) * 26)
    onEvent({ type: "progress", progress, message: `${dryRun ? "Planning" : mode === "move" ? "Moving" : "Copying"} ${video.filename}.` })
    try {
      const actualPath = dryRun
        ? await runtime.resolveAvailablePath(desiredPath)
        : await runtime.transferFile(video.path, desiredPath, mode)
      operations.push({
        mode,
        sourcePath: video.path,
        desiredPath,
        targetPath: actualPath,
        bitrateLevel: video.bitrateLevel,
        dryRun,
        success: true,
      })
    } catch (error) {
      const message = `${video.path}: ${errorMessage(error)}`
      operations.push({
        mode,
        sourcePath: video.path,
        desiredPath,
        targetPath: desiredPath,
        bitrateLevel: video.bitrateLevel,
        dryRun,
        success: false,
        error: message,
      })
    }
  }
  return operations
}

function normalizeReportVideo(value: unknown): BitvVideoInfo | null {
  const record = asRecord(value)
  if (!record) return null
  const info = asRecord(record.info) ?? record
  const path = stringValue(record.path) || stringValue(info.path)
  if (!path) return null

  const durationSeconds = nonNegativeNumber(info.durationSeconds ?? info.duration)
  const bitrateMbps = nonNegativeNumber(info.bitrateMbps ?? info.bitrate_mbps)
  const bitrateBps = nonNegativeNumber(info.bitrateBps ?? info.bitrate) || bitrateMbps * 1_000_000
  const sizeBytes = nonNegativeNumber(info.sizeBytes ?? info.size_bytes) || nonNegativeNumber(info.size_mb) * 1024 * 1024
  const width = nonNegativeInteger(info.width)
  const height = nonNegativeInteger(info.height)
  const fps = nonNegativeNumber(info.fps)
  const bitrateLevel = stringValue(record.bitrateLevel) || stringValue(record.bitrate_level) || "unknown"

  return {
    path,
    relativePath: safeRelativePath(stringValue(record.relativePath), basename(path)),
    filename: stringValue(info.filename) || basename(path),
    durationSeconds,
    bitrateBps,
    bitrateMbps: bitrateMbps || bitrateBps / 1_000_000,
    width,
    height,
    fps,
    sizeBytes,
    resolution: stringValue(info.resolution) || `${width}x${height}`,
    bitrateLevel,
  }
}

function emptyData(action: BitvAction, requestedPaths: string[], dryRun: boolean): BitvData {
  return {
    action,
    requestedPaths,
    videos: [],
    stats: summarizeVideos([]),
    operations: [],
    dryRun,
    errors: [],
  }
}

function validateBitrateSettings(step: number | undefined, levels: number | undefined): string | null {
  const bitrateStepMbps = step ?? BITV_DEFAULTS.bitrateStepMbps
  const maxLevels = levels ?? BITV_DEFAULTS.maxLevels
  if (!Number.isFinite(bitrateStepMbps) || bitrateStepMbps <= 0) return "Bitrate step must be greater than zero."
  if (!Number.isInteger(maxLevels) || maxLevels <= 0 || maxLevels > 1000) return "Bitrate levels must be an integer between 1 and 1000."
  return null
}

function assertBitrateSettings(step: number, levels: number): void {
  const error = validateBitrateSettings(step, levels)
  if (error) throw new RangeError(error)
}

function parseFrameRate(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : 0
  if (typeof value !== "string" || !value.trim()) return 0
  const [numeratorText, denominatorText] = value.split("/", 2)
  const numerator = Number(numeratorText)
  const denominator = denominatorText === undefined ? 1 : Number(denominatorText)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0
  const result = numerator / denominator
  return Number.isFinite(result) && result >= 0 ? result : 0
}

function firstPositiveNumber(...values: unknown[]): number {
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number) && number > 0) return number
  }
  return 0
}

function positiveNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function positiveInteger(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : undefined
}

function nonNegativeNumber(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

function nonNegativeInteger(value: unknown): number {
  return Math.floor(nonNegativeNumber(value))
}

function safePathSegment(value: string): string {
  const invalid = new Set(["<", ">", ":", '"', "/", "\\", "|", "?", "*"])
  const sanitized = Array.from(value, (character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || invalid.has(character) ? "_" : character
  }).join("")
  return sanitized.replace(/[. ]+$/g, "") || "unknown"
}

function safeRelativePath(value: string, fallback: string): string {
  const parts = value.split(/[\\/]+/).filter((part) => part && part !== "." && part !== "..")
  return (parts.length ? parts : [fallback]).map(safePathSegment).join("/")
}

function joinPath(...parts: string[]): string {
  const first = parts.find(Boolean) ?? ""
  const separator = first.includes("\\") && !first.includes("/") ? "\\" : "/"
  const joined = parts
    .filter(Boolean)
    .map((part, index) => index === 0 ? part.replace(/[\\/]+$/g, "") : part.replace(/^[\\/]+|[\\/]+$/g, ""))
    .filter(Boolean)
    .join(separator)
  return first === "/" ? `/${joined}` : joined
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function formatThreshold(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)))
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : []
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function isRecord(value: Record<string, unknown> | null): value is Record<string, unknown> {
  return value !== null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
