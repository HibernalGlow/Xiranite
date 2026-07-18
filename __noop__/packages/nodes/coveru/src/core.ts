import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type CoveruAction = "scan" | "plan" | "extract"
export type CoveruOutputMode = "alongside" | "directory"
export type CoveruCandidateStatus = "ready" | "extracted" | "skipped" | "empty" | "unsupported" | "error"
export type CoveruSourceKind = "archive-entry" | "image-file"

export interface CoveruInput {
  action?: CoveruAction
  path?: string
  paths?: string[]
  listText?: string
  outputDir?: string
  outputMode?: CoveruOutputMode
  overwrite?: boolean
  recursive?: boolean
  dryRun?: boolean
  preferredNames?: string[]
}

export interface CoveruPathInfo {
  path: string
  exists: boolean
  isFile: boolean
  isDirectory: boolean
}

export interface CoveruDirEntry {
  name: string
  path: string
  isFile: boolean
  isDirectory: boolean
}

export interface CoveruArchiveEntry {
  name: string
  path: string
  size: number
  compressedSize: number
  method: number
}

export interface CoveruCandidate {
  sourcePath: string
  sourceEntry: string
  outputPath: string
  sourceKind: CoveruSourceKind
  extension: string
  score: number
  status: CoveruCandidateStatus
  reason?: string
}

export interface CoveruData {
  candidates: CoveruCandidate[]
  archiveCount: number
  readyCount: number
  extractedCount: number
  skippedCount: number
  errorCount: number
  unsupportedCount: number
  outputDir?: string
  errors: string[]
}

export interface CoveruRuntime {
  pathInfo: (path: string) => Promise<CoveruPathInfo>
  listDir: (path: string) => Promise<CoveruDirEntry[]>
  listArchiveEntries: (path: string) => Promise<CoveruArchiveEntry[]>
  copyFile: (source: string, target: string) => Promise<void>
  extractArchiveEntry: (archivePath: string, entryPath: string, outputPath: string) => Promise<void>
  ensureDir: (path: string) => Promise<void>
  join: (...parts: string[]) => string
  dirname: (path: string) => string
  basename: (path: string) => string
  extname: (path: string) => string
}

export type CoveruResult = NodeRunResult<CoveruData>

export const COVERU_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".avif", ".jxl", ".gif", ".bmp"]
export const COVERU_SUPPORTED_ARCHIVES = [".zip", ".cbz"]
export const COVERU_KNOWN_ARCHIVES = [".zip", ".cbz", ".rar", ".cbr", ".7z", ".cb7"]
export const DEFAULT_PREFERRED_NAMES = ["cover", "folder", "front", "000", "001", "00", "01"]

export function normalizeCoveruInput(input: CoveruInput): Required<CoveruInput> {
  return {
    action: input.action ?? "scan",
    path: clean(input.path),
    paths: uniqueClean([input.path, ...(input.paths ?? []), ...parseList(input.listText)]),
    listText: input.listText ?? "",
    outputDir: clean(input.outputDir),
    outputMode: input.outputMode ?? "alongside",
    overwrite: input.overwrite ?? false,
    recursive: input.recursive ?? true,
    dryRun: input.dryRun ?? true,
    preferredNames: uniqueClean(input.preferredNames?.length ? input.preferredNames : DEFAULT_PREFERRED_NAMES),
  }
}

export async function runCoveru(
  input: CoveruInput,
  runtime: CoveruRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<CoveruResult> {
  const normalized = normalizeCoveruInput(input)
  try {
    if (!normalized.paths.length) return failure("At least one archive, image, or directory path is required.")

    onEvent({ type: "progress", progress: 15, message: "Collecting cover inputs." })
    const inputPaths = await collectCoveruPaths(normalized.paths, normalized.recursive, runtime)

    onEvent({ type: "progress", progress: 45, message: `Planning ${inputPaths.length} path(s).` })
    const candidates: CoveruCandidate[] = []
    for (const path of inputPaths) candidates.push(await planCoverCandidate(path, normalized, runtime))

    if (normalized.action !== "extract" || normalized.dryRun) {
      return success(`CoverU planned ${candidates.length} candidate(s).`, summarize(candidates, normalized.outputDir))
    }

    onEvent({ type: "progress", progress: 70, message: "Extracting cover files." })
    const extracted: CoveruCandidate[] = []
    for (const candidate of candidates) {
      if (candidate.status !== "ready") {
        extracted.push(candidate)
        continue
      }
      try {
        await runtime.ensureDir(runtime.dirname(candidate.outputPath))
        if (candidate.sourceKind === "image-file") await runtime.copyFile(candidate.sourcePath, candidate.outputPath)
        else await runtime.extractArchiveEntry(candidate.sourcePath, candidate.sourceEntry, candidate.outputPath)
        extracted.push({ ...candidate, status: "extracted" })
      } catch (error) {
        extracted.push({ ...candidate, status: "error", reason: error instanceof Error ? error.message : String(error) })
      }
    }
    return success(`CoverU extracted ${extracted.filter((item) => item.status === "extracted").length} cover(s).`, summarize(extracted, normalized.outputDir))
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

export async function collectCoveruPaths(paths: string[], recursive: boolean, runtime: CoveruRuntime): Promise<string[]> {
  const collected: string[] = []
  for (const raw of paths) {
    const info = await runtime.pathInfo(raw)
    if (!info.exists) {
      collected.push(raw)
      continue
    }
    if (info.isFile) {
      collected.push(info.path)
      continue
    }
    if (info.isDirectory) {
      const entries = await runtime.listDir(info.path)
      for (const entry of entries) {
        if (entry.isFile && (isCoveruArchive(entry.path) || isCoveruImage(entry.path))) collected.push(entry.path)
        if (entry.isDirectory && recursive) collected.push(...await collectCoveruPaths([entry.path], recursive, runtime))
      }
    }
  }
  return [...new Set(collected)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
}

export async function planCoverCandidate(path: string, input: Required<CoveruInput>, runtime: CoveruRuntime): Promise<CoveruCandidate> {
  const info = await runtime.pathInfo(path)
  if (!info.exists) return baseCandidate(path, "", "", "archive-entry", "error", 0, "path_not_found", input, runtime)
  if (!info.isFile) return baseCandidate(info.path, "", "", "archive-entry", "skipped", 0, "not_a_file", input, runtime)
  if (isCoveruImage(info.path)) {
    const outputPath = outputFor(info.path, runtime.basename(info.path), input, runtime)
    return withExistingCheck(baseCandidate(info.path, runtime.basename(info.path), outputPath, "image-file", "ready", 70, undefined, input, runtime), input, runtime)
  }
  if (!isCoveruArchive(info.path)) return baseCandidate(info.path, "", "", "archive-entry", "skipped", 0, "not_cover_input", input, runtime)
  if (!isSupportedCoveruArchive(info.path)) return baseCandidate(info.path, "", "", "archive-entry", "unsupported", 0, "unsupported_archive", input, runtime)

  const entries = (await runtime.listArchiveEntries(info.path)).filter((entry) => isCoveruImage(entry.path))
  if (!entries.length) return baseCandidate(info.path, "", "", "archive-entry", "empty", 0, "no_image_entry", input, runtime)
  const selected = selectCoverEntry(entries, input.preferredNames, runtime)
  const outputPath = outputFor(info.path, selected.path, input, runtime)
  return withExistingCheck(baseCandidate(info.path, selected.path, outputPath, "archive-entry", "ready", scoreEntry(selected.path, input.preferredNames, runtime), undefined, input, runtime), input, runtime)
}

export function selectCoverEntry(entries: CoveruArchiveEntry[], preferredNames: string[], runtime: Pick<CoveruRuntime, "basename" | "extname">): CoveruArchiveEntry {
  return [...entries].sort((a, b) => scoreEntry(b.path, preferredNames, runtime) - scoreEntry(a.path, preferredNames, runtime) || a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }))[0]!
}

export function scoreEntry(path: string, preferredNames: string[], runtime: Pick<CoveruRuntime, "basename" | "extname">): number {
  const name = runtime.basename(path).slice(0, -runtime.extname(path).length).toLowerCase()
  const preferredIndex = preferredNames.findIndex((item) => name.includes(item.toLowerCase()))
  const preferredScore = preferredIndex >= 0 ? 100 - preferredIndex * 8 : 30
  const depthPenalty = path.split(/[\\/]/).length - 1
  return Math.max(0, preferredScore - depthPenalty * 2)
}

export function isCoveruImage(path: string): boolean {
  return COVERU_IMAGE_EXTENSIONS.includes(extensionOf(path))
}

export function isCoveruArchive(path: string): boolean {
  return COVERU_KNOWN_ARCHIVES.includes(extensionOf(path))
}

export function isSupportedCoveruArchive(path: string): boolean {
  return COVERU_SUPPORTED_ARCHIVES.includes(extensionOf(path))
}

function withExistingCheck(candidate: CoveruCandidate, input: Required<CoveruInput>, runtime: CoveruRuntime): Promise<CoveruCandidate> {
  if (input.overwrite || !candidate.outputPath) return Promise.resolve(candidate)
  return runtime.pathInfo(candidate.outputPath).then((info) => info.exists ? { ...candidate, status: "skipped", reason: "target_exists" } : candidate)
}

function baseCandidate(sourcePath: string, sourceEntry: string, outputPath: string, sourceKind: CoveruSourceKind, status: CoveruCandidateStatus, score: number, reason: string | undefined, input: Required<CoveruInput>, runtime: CoveruRuntime): CoveruCandidate {
  return {
    sourcePath,
    sourceEntry,
    outputPath,
    sourceKind,
    extension: runtime.extname(sourceEntry || sourcePath).toLowerCase(),
    score,
    status,
    reason,
  }
}

function outputFor(sourcePath: string, entryPath: string, input: Required<CoveruInput>, runtime: CoveruRuntime): string {
  const ext = runtime.extname(entryPath) || ".jpg"
  const archiveName = runtime.basename(sourcePath)
  const archiveExt = runtime.extname(archiveName)
  const stem = archiveExt ? archiveName.slice(0, -archiveExt.length) : archiveName
  const root = input.outputMode === "directory" && input.outputDir ? input.outputDir : runtime.dirname(sourcePath)
  return runtime.join(root, `${stem}${ext.toLowerCase()}`)
}

function summarize(candidates: CoveruCandidate[], outputDir?: string): CoveruData {
  const errors = candidates.filter((item) => item.status === "error").map((item) => `${item.sourcePath}: ${item.reason ?? "error"}`)
  return {
    candidates,
    archiveCount: candidates.filter((item) => item.sourceKind === "archive-entry").length,
    readyCount: candidates.filter((item) => item.status === "ready").length,
    extractedCount: candidates.filter((item) => item.status === "extracted").length,
    skippedCount: candidates.filter((item) => item.status === "skipped" || item.status === "empty").length,
    errorCount: candidates.filter((item) => item.status === "error").length,
    unsupportedCount: candidates.filter((item) => item.status === "unsupported").length,
    outputDir: outputDir || undefined,
    errors,
  }
}

function success(message: string, data: CoveruData): CoveruResult {
  return { success: data.errorCount === 0, message, data }
}

function failure(message: string): CoveruResult {
  return { success: false, message, data: summarize([{ sourcePath: "", sourceEntry: "", outputPath: "", sourceKind: "archive-entry", extension: "", score: 0, status: "error", reason: message }]) }
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

function extensionOf(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith(".tar.gz")) return ".tar.gz"
  const match = /(\.[^./\\]+)$/.exec(lower)
  return match?.[1] ?? ""
}
