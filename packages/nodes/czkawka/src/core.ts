import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export const CZKAWKA_TOOLS = [
  "duplicate-files",
  "empty-folders",
  "big-files",
  "empty-files",
  "temporary-files",
  "similar-images",
  "similar-videos",
  "duplicate-music",
  "invalid-symlinks",
  "broken-files",
  "bad-extensions",
] as const

export type CzkawkaTool = typeof CZKAWKA_TOOLS[number]
export type CzkawkaAction = "scan" | "delete" | "move" | "save"
export type CzkawkaCheckMethod = "name" | "size" | "size-and-name" | "hash"
export type CzkawkaHashType = "crc32" | "xxh3" | "blake3"
export type CzkawkaImageHashAlgorithm = "mean" | "gradient" | "blockhash" | "vert-gradient" | "double-gradient" | "median"
export type CzkawkaImageResizeAlgorithm = "lanczos3" | "gaussian" | "catmull-rom" | "triangle" | "nearest"
export type CzkawkaVideoCropDetect = "letterbox" | "motion" | "none"
export type CzkawkaMusicCheckType = "tags" | "fingerprint"
export type CzkawkaSort = "path" | "size" | "modified"
export type CzkawkaSelectionStrategy = "all-except-first" | "all-except-newest" | "all-except-oldest" | "all-except-biggest" | "all-except-smallest"

export interface CzkawkaInput {
  action?: CzkawkaAction
  tool?: CzkawkaTool
  includedDirectories?: string[]
  includedDirectoriesReferenced?: string[]
  excludedDirectories?: string[]
  excludedItems?: string[]
  allowedExtensions?: string
  excludedExtensions?: string
  minimumFileSize?: number
  maximumFileSize?: number
  recursive?: boolean
  useCache?: boolean
  ignoreHardLinks?: boolean
  usePrehash?: boolean
  caseSensitiveNames?: boolean
  checkMethod?: CzkawkaCheckMethod
  hashType?: CzkawkaHashType
  duplicateMinimumGroupSize?: number
  numberOfFiles?: number
  biggestFirst?: boolean
  similarity?: number
  similarImagesHashSize?: number
  similarImagesHashAlgorithm?: CzkawkaImageHashAlgorithm
  similarImagesResizeAlgorithm?: CzkawkaImageResizeAlgorithm
  similarImagesIgnoreSameSize?: boolean
  similarImagesFolderThreshold?: number
  similarVideosIgnoreSameSize?: boolean
  similarVideosSkipForward?: number
  similarVideosHashDuration?: number
  similarVideosCropDetect?: CzkawkaVideoCropDetect
  musicCheckType?: CzkawkaMusicCheckType
  musicApproximateComparison?: boolean
  musicCompareTitle?: boolean
  musicCompareArtist?: boolean
  musicCompareBitrate?: boolean
  musicCompareGenre?: boolean
  musicCompareYear?: boolean
  musicCompareLength?: boolean
  musicMaximumDifference?: number
  musicMinimumFragmentDuration?: number
  musicCompareFingerprintsOnlyWithSimilarTitles?: boolean
  brokenAudio?: boolean
  brokenPdf?: boolean
  brokenArchive?: boolean
  brokenImage?: boolean
  filterText?: string
  sortBy?: CzkawkaSort
  descending?: boolean
  selectedPaths?: string[]
  destinationDirectory?: string
  outputPath?: string
  outputFormat?: "json" | "csv"
  dryRun?: boolean
}

export interface NativeDuplicateResult {
  groups: Array<{ files: Array<{ path: string; modifiedDate: number; size: number; hash: string; isReference?: boolean }> }>
  messages: string
  stopped: boolean
}
export interface NativeBasicResult {
  entries: Array<{ path: string; modifiedDate: number; size: number; secondaryPath?: string; detail?: string }>
  messages: string
  stopped: boolean
}
export interface NativeMediaResult {
  groups: Array<{ entries: Array<{ path: string; modifiedDate: number; size: number; width?: number; height?: number; similarity?: string; title?: string; artist?: string; year?: string; length?: string; genre?: string; bitrate?: number; isReference?: boolean; detail?: string; properExtension?: string }> }>
  messages: string
  stopped: boolean
}

export interface CzkawkaRuntime {
  scanDuplicates: (input: Required<CzkawkaInput>) => Promise<NativeDuplicateResult>
  scanBasic: (input: Required<CzkawkaInput>) => Promise<NativeBasicResult>
  scanMedia: (input: Required<CzkawkaInput>) => Promise<NativeMediaResult>
  removePath: (path: string) => Promise<void>
  movePath: (source: string, target: string) => Promise<void>
  writeText: (path: string, content: string) => Promise<void>
  ensureDirectory: (path: string) => Promise<void>
  join: (...parts: string[]) => string
  dirname: (path: string) => string
  basename: (path: string) => string
}

export interface CzkawkaEntry {
  id: string
  groupId: number
  path: string
  name: string
  size: number
  modifiedDate: number
  hash?: string
  secondaryPath?: string
  detail?: string
  properExtension?: string
  width?: number
  height?: number
  similarity?: string
  title?: string
  artist?: string
  year?: string
  length?: string
  genre?: string
  bitrate?: number
  isReference?: boolean
  status?: "planned" | "deleted" | "moved" | "saved" | "error"
  error?: string
}

export interface CzkawkaGroup {
  id: number
  entries: CzkawkaEntry[]
  totalBytes: number
  reclaimableBytes: number
}

export interface CzkawkaData {
  action: CzkawkaAction
  tool: CzkawkaTool
  groups: CzkawkaGroup[]
  entries: CzkawkaEntry[]
  messages: string
  stopped: boolean
  groupCount: number
  fileCount: number
  totalBytes: number
  reclaimableBytes: number
  affectedCount: number
  errorCount: number
}

export type CzkawkaResult = NodeRunResult<CzkawkaData>

const BASIC_TOOLS = new Set<CzkawkaTool>(["empty-folders", "big-files", "empty-files", "temporary-files", "invalid-symlinks"])
const MEDIA_TOOLS = new Set<CzkawkaTool>(["similar-images", "similar-videos", "duplicate-music", "broken-files", "bad-extensions"])

export function normalizeCzkawkaInput(input: CzkawkaInput): Required<CzkawkaInput> {
  return {
    action: input.action ?? "scan",
    tool: input.tool ?? "duplicate-files",
    includedDirectories: unique(input.includedDirectories ?? []),
    includedDirectoriesReferenced: unique(input.includedDirectoriesReferenced ?? []),
    excludedDirectories: unique(input.excludedDirectories ?? []),
    excludedItems: unique(input.excludedItems ?? []),
    allowedExtensions: clean(input.allowedExtensions),
    excludedExtensions: clean(input.excludedExtensions),
    minimumFileSize: clamp(input.minimumFileSize, 0, Number.MAX_SAFE_INTEGER, 1),
    maximumFileSize: clamp(input.maximumFileSize, 1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
    recursive: input.recursive ?? true,
    useCache: input.useCache ?? true,
    ignoreHardLinks: input.ignoreHardLinks ?? true,
    usePrehash: input.usePrehash ?? true,
    caseSensitiveNames: input.caseSensitiveNames ?? false,
    checkMethod: input.checkMethod ?? "hash",
    hashType: input.hashType ?? "blake3",
    duplicateMinimumGroupSize: clamp(input.duplicateMinimumGroupSize, 1, 10_000, 1),
    numberOfFiles: clamp(input.numberOfFiles, 1, 100_000, 50),
    biggestFirst: input.biggestFirst ?? true,
    similarity: clamp(input.similarity, 0, 40, 10),
    similarImagesHashSize: oneOf(input.similarImagesHashSize, [8, 16, 32, 64] as const, 16),
    similarImagesHashAlgorithm: oneOf(input.similarImagesHashAlgorithm, ["mean", "gradient", "blockhash", "vert-gradient", "double-gradient", "median"] as const, "mean"),
    similarImagesResizeAlgorithm: oneOf(input.similarImagesResizeAlgorithm, ["lanczos3", "gaussian", "catmull-rom", "triangle", "nearest"] as const, "lanczos3"),
    similarImagesIgnoreSameSize: input.similarImagesIgnoreSameSize ?? false,
    similarImagesFolderThreshold: clamp(input.similarImagesFolderThreshold, 1, 10_000, 2),
    similarVideosIgnoreSameSize: input.similarVideosIgnoreSameSize ?? false,
    similarVideosSkipForward: clamp(input.similarVideosSkipForward, 0, 3600, 15),
    similarVideosHashDuration: clamp(input.similarVideosHashDuration, 2, 3600, 10),
    similarVideosCropDetect: oneOf(input.similarVideosCropDetect, ["letterbox", "motion", "none"] as const, "letterbox"),
    musicCheckType: oneOf(input.musicCheckType, ["tags", "fingerprint"] as const, "tags"),
    musicApproximateComparison: input.musicApproximateComparison ?? true,
    musicCompareTitle: input.musicCompareTitle ?? true,
    musicCompareArtist: input.musicCompareArtist ?? true,
    musicCompareBitrate: input.musicCompareBitrate ?? false,
    musicCompareGenre: input.musicCompareGenre ?? false,
    musicCompareYear: input.musicCompareYear ?? false,
    musicCompareLength: input.musicCompareLength ?? false,
    musicMaximumDifference: clamp(input.musicMaximumDifference, 0, 10, 10),
    musicMinimumFragmentDuration: clamp(input.musicMinimumFragmentDuration, 0, 3600, 15),
    musicCompareFingerprintsOnlyWithSimilarTitles: input.musicCompareFingerprintsOnlyWithSimilarTitles ?? true,
    brokenAudio: input.brokenAudio ?? true,
    brokenPdf: input.brokenPdf ?? true,
    brokenArchive: input.brokenArchive ?? true,
    brokenImage: input.brokenImage ?? true,
    filterText: clean(input.filterText),
    sortBy: input.sortBy ?? "path",
    descending: input.descending ?? false,
    selectedPaths: unique(input.selectedPaths ?? []),
    destinationDirectory: clean(input.destinationDirectory),
    outputPath: clean(input.outputPath),
    outputFormat: input.outputFormat ?? "json",
    dryRun: input.dryRun ?? true,
  }
}

export async function runCzkawka(input: CzkawkaInput, runtime: CzkawkaRuntime, onEvent: (event: NodeRunEvent) => void = () => {}): Promise<CzkawkaResult> {
  const value = normalizeCzkawkaInput(input)
  try {
    if (value.action === "scan") return await scan(value, runtime, onEvent)
    if (!value.selectedPaths.length) return fail(value, "Select at least one result path.")
    if (value.action === "delete") return await mutate(value, runtime, "delete", onEvent)
    if (value.action === "move") {
      if (!value.destinationDirectory) return fail(value, "A destination directory is required.")
      return await mutate(value, runtime, "move", onEvent)
    }
    if (!value.outputPath) return fail(value, "An output path is required.")
    return await save(value, runtime, onEvent)
  } catch (error) {
    return fail(value, errorMessage(error))
  }
}

async function scan(value: Required<CzkawkaInput>, runtime: CzkawkaRuntime, onEvent: (event: NodeRunEvent) => void): Promise<CzkawkaResult> {
  if (!value.includedDirectories.length) return fail(value, "Add at least one included directory.")
  if (value.minimumFileSize > value.maximumFileSize) return fail(value, "Minimum file size cannot exceed maximum file size.")
  onEvent({ type: "progress", progress: 5, message: `Starting ${value.tool}.` })
  let groups: CzkawkaGroup[]
  let messages = ""
  let stopped = false
  if (value.tool === "duplicate-files") {
    const native = await runtime.scanDuplicates(value)
    groups = native.groups.filter((group) => group.files.length >= value.duplicateMinimumGroupSize).map((group, index) => makeGroup(index, group.files.map((entry) => ({ ...entry, name: runtime.basename(entry.path) })), runtime, true))
    messages = native.messages
    stopped = native.stopped
  } else if (BASIC_TOOLS.has(value.tool)) {
    const native = await runtime.scanBasic(value)
    groups = native.entries.length ? [makeGroup(0, native.entries.map((entry) => ({ ...entry, name: runtime.basename(entry.path) })), runtime, false)] : []
    messages = native.messages
    stopped = native.stopped
  } else if (MEDIA_TOOLS.has(value.tool)) {
    const native = await runtime.scanMedia(value)
    groups = native.groups.filter((group) => group.entries.length > 0).map((group, index) => makeGroup(index, group.entries.map((entry) => ({ ...entry, name: runtime.basename(entry.path) })), runtime, isGroupedTool(value.tool)))
    messages = native.messages
    stopped = native.stopped
  } else return fail(value, `Unsupported Czkawka tool: ${value.tool}`)

  groups = filterAndSortGroups(groups, value)
  onEvent({ type: "progress", progress: 100, message: `Finished ${value.tool}.` })
  const data = summarize(value, groups, messages, stopped)
  return { success: true, message: `Found ${data.fileCount} item(s) in ${data.groupCount} group(s).`, data }
}

function makeGroup(index: number, raw: Array<Partial<CzkawkaEntry> & { path: string; name: string; size: number; modifiedDate: number }>, runtime: Pick<CzkawkaRuntime, "basename">, reclaimable: boolean): CzkawkaGroup {
  const entries = raw.map((entry, entryIndex) => ({ ...entry, id: `${index}:${entryIndex}:${entry.path}`, groupId: index, name: entry.name || runtime.basename(entry.path) })) as CzkawkaEntry[]
  const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0)
  const references = entries.filter((entry) => entry.isReference)
  const reclaimableBytes = reclaimable && entries.length > 1
    ? references.length
      ? entries.filter((entry) => !entry.isReference).reduce((sum, entry) => sum + entry.size, 0)
      : totalBytes - Math.max(...entries.map((entry) => entry.size))
    : 0
  return { id: index, entries, totalBytes, reclaimableBytes }
}

export function filterAndSortGroups(groups: CzkawkaGroup[], input: Pick<Required<CzkawkaInput>, "filterText" | "sortBy" | "descending">): CzkawkaGroup[] {
  const needle = input.filterText.toLocaleLowerCase()
  return groups.map((group) => {
    const entries = [...group.entries]
      .filter((entry) => !needle || `${entry.path} ${entry.detail ?? ""} ${entry.artist ?? ""} ${entry.title ?? ""}`.toLocaleLowerCase().includes(needle))
      .sort((left, right) => {
        const compared = input.sortBy === "size" ? left.size - right.size : input.sortBy === "modified" ? left.modifiedDate - right.modifiedDate : left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: "base" })
        return input.descending ? -compared : compared
      })
    const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0)
    return { ...group, entries, totalBytes, reclaimableBytes: entries.length > 1 ? Math.min(group.reclaimableBytes, totalBytes - Math.max(...entries.map((entry) => entry.size))) : 0 }
  }).filter((group) => group.entries.length > 0)
}

/** Adapted from czkawka-tauri's group selection assistant. */
export function smartSelect(groups: CzkawkaGroup[], strategy: CzkawkaSelectionStrategy, current: Iterable<string> = [], keepExisting = false): string[] {
  const selection = new Set(keepExisting ? current : [])
  for (const group of groups) {
    if (group.entries.length < 2) continue
    const references = group.entries.filter((entry) => entry.isReference)
    if (references.length) {
      for (const entry of group.entries) if (!entry.isReference) selection.add(entry.path)
      continue
    }
    const sorted = [...group.entries].sort((left, right) => {
      if (strategy === "all-except-newest") return right.modifiedDate - left.modifiedDate
      if (strategy === "all-except-oldest") return left.modifiedDate - right.modifiedDate
      if (strategy === "all-except-biggest") return right.size - left.size
      if (strategy === "all-except-smallest") return left.size - right.size
      return left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: "base" })
    })
    for (const entry of sorted.slice(1)) selection.add(entry.path)
  }
  return [...selection]
}

async function mutate(value: Required<CzkawkaInput>, runtime: CzkawkaRuntime, action: "delete" | "move", onEvent: (event: NodeRunEvent) => void): Promise<CzkawkaResult> {
  const entries: CzkawkaEntry[] = []
  for (let index = 0; index < value.selectedPaths.length; index += 1) {
    const path = value.selectedPaths[index]!
    const target = action === "move" ? runtime.join(value.destinationDirectory, runtime.basename(path)) : undefined
    onEvent({ type: "progress", progress: Math.round((index / value.selectedPaths.length) * 100), message: `${action} ${runtime.basename(path)}` })
    if (value.dryRun) { entries.push({ id: `op:${index}`, groupId: 0, path, name: runtime.basename(path), size: 0, modifiedDate: 0, secondaryPath: target, status: "planned" }); continue }
    try {
      if (action === "delete") await runtime.removePath(path)
      else { await runtime.ensureDirectory(value.destinationDirectory); await runtime.movePath(path, target!) }
      entries.push({ id: `op:${index}`, groupId: 0, path, name: runtime.basename(path), size: 0, modifiedDate: 0, secondaryPath: target, status: action === "delete" ? "deleted" : "moved" })
    } catch (error) { entries.push({ id: `op:${index}`, groupId: 0, path, name: runtime.basename(path), size: 0, modifiedDate: 0, secondaryPath: target, status: "error", error: errorMessage(error) }) }
  }
  const group = makeGroup(0, entries, runtime, false)
  const data = summarize(value, [group], "", false)
  return { success: data.errorCount === 0, message: value.dryRun ? `Planned ${entries.length} ${action} operation(s).` : `${action === "delete" ? "Deleted" : "Moved"} ${data.affectedCount} item(s).`, data }
}

async function save(value: Required<CzkawkaInput>, runtime: CzkawkaRuntime, onEvent: (event: NodeRunEvent) => void): Promise<CzkawkaResult> {
  const rows = value.selectedPaths.map((path, index) => ({ id: `save:${index}`, groupId: 0, path, name: runtime.basename(path), size: 0, modifiedDate: 0, status: "saved" as const }))
  const content = value.outputFormat === "csv" ? `path\n${rows.map((row) => csv(row.path)).join("\n")}\n` : `${JSON.stringify(rows.map((row) => row.path), null, 2)}\n`
  onEvent({ type: "progress", progress: 50, message: `Writing ${runtime.basename(value.outputPath)}.` })
  if (!value.dryRun) { await runtime.ensureDirectory(runtime.dirname(value.outputPath)); await runtime.writeText(value.outputPath, content) }
  const data = summarize(value, [makeGroup(0, rows, runtime, false)], "", false)
  return { success: true, message: value.dryRun ? `Planned export of ${rows.length} path(s).` : `Saved ${rows.length} path(s).`, data }
}

function summarize(value: Required<CzkawkaInput>, groups: CzkawkaGroup[], messages: string, stopped: boolean): CzkawkaData {
  const entries = groups.flatMap((group) => group.entries)
  return { action: value.action, tool: value.tool, groups, entries, messages, stopped, groupCount: groups.length, fileCount: entries.length, totalBytes: groups.reduce((sum, group) => sum + group.totalBytes, 0), reclaimableBytes: groups.reduce((sum, group) => sum + group.reclaimableBytes, 0), affectedCount: entries.filter((entry) => ["deleted", "moved", "saved", "planned"].includes(entry.status ?? "")).length, errorCount: entries.filter((entry) => entry.status === "error").length }
}

function isGroupedTool(tool: CzkawkaTool): boolean { return ["duplicate-files", "similar-images", "similar-videos", "duplicate-music"].includes(tool) }
function fail(value: Required<CzkawkaInput>, message: string): CzkawkaResult { return { success: false, message, data: summarize(value, [], message, false) } }
function unique(values: string[]): string[] { return [...new Set(values.map(clean).filter(Boolean))] }
function clean(value: unknown): string { return String(value ?? "").trim() }
function clamp(value: unknown, min: number, max: number, fallback: number): number { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback }
function oneOf<const Values extends readonly (string | number)[]>(value: unknown, values: Values, fallback: Values[number]): Values[number] { return values.includes(value as Values[number]) ? value as Values[number] : fallback }
function csv(value: string): string { return `"${value.replaceAll('"', '""')}"` }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
