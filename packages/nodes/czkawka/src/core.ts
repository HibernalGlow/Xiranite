import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { buildCzkawkaSimilarFolders, type CzkawkaSimilarFolderStat } from "./similar-folders.js"
import { resolveCzkawkaSimilarVideoCrop } from "./similar-video-crop.js"
import { isDefaultTemporaryFileExtensions, normalizeTemporaryFileExtensions } from "./temporary-file-extensions.js"
export type { CzkawkaVideoCropDetect } from "./similar-video-crop.js"
import type { CzkawkaVideoCropDetect } from "./similar-video-crop.js"

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
  "bad-names",
] as const

export type CzkawkaTool = typeof CZKAWKA_TOOLS[number]
export type CzkawkaAction = "scan" | "delete" | "move" | "rename" | "save"
export type CzkawkaCheckMethod = "name" | "size" | "size-and-name" | "hash"
export type CzkawkaHashType = "crc32" | "xxh3" | "blake3"
export type CzkawkaImageHashAlgorithm = "mean" | "gradient" | "blockhash" | "vert-gradient" | "double-gradient" | "median"
export type CzkawkaImageResizeAlgorithm = "lanczos3" | "gaussian" | "catmull-rom" | "triangle" | "nearest"
export type CzkawkaImageGeometricInvariance = "off" | "mirror-flip" | "mirror-flip-rotate-90"
export type CzkawkaMusicCheckType = "tags" | "fingerprint"
export type CzkawkaSort = "path" | "size" | "modified"
export type CzkawkaSelectionStrategy = "all-except-first" | "all-except-newest" | "all-except-oldest" | "all-except-biggest" | "all-except-smallest"
export type CzkawkaDeleteMode = "trash" | "permanent"
export type CzkawkaConflictPolicy = "skip" | "overwrite" | "rename" | "error"
export type CzkawkaOperationStatus = "planned" | "deleted" | "trashed" | "moved" | "copied" | "renamed" | "saved" | "skipped" | "error"
export interface CzkawkaDestinationItem { path: string; destination: string }
export interface CzkawkaRenameItem { path: string; properExtension?: string; targetName?: string }
export type CzkawkaExportScope = "selected" | "visible" | "all"

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
  saveAlsoAsJson?: boolean
  deleteOutdatedCache?: boolean
  cacheFolderPath?: string
  configFolderPath?: string
  duplicateMinimalHashCacheSizeKiB?: number
  duplicateMinimalPrehashCacheSizeKiB?: number
  threadCount?: number
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
  similarImagesIgnoreSameResolution?: boolean
  similarImagesGeometricInvariance?: CzkawkaImageGeometricInvariance
  similarImagesFolderThreshold?: number
  similarVideosIgnoreSameSize?: boolean
  similarVideosIgnoreSameResolution?: boolean
  similarVideosSkipForward?: number
  similarVideosHashDuration?: number
  similarVideosLetterboxCrop?: boolean
  similarVideosWindowCount?: number
  similarVideosDurationTolerancePct?: number
  similarVideosMinMatchingWindows?: number
  similarVideosSubclipMinMatch?: number
  similarVideosCheckAudioContent?: boolean
  /** Legacy v1 field retained for one rollback window. */
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
  brokenVideoFfprobe?: boolean
  brokenVideoFfmpeg?: boolean
  brokenFont?: boolean
  brokenMarkup?: boolean
  emptyFilesSearchZeroByteContent?: boolean
  emptyFilesSearchNonPrintableContent?: boolean
  temporaryFileExtensions?: string
  filterText?: string
  sortBy?: CzkawkaSort
  descending?: boolean
  selectedPaths?: string[]
  destinationDirectory?: string
  destinationItems?: CzkawkaDestinationItem[]
  renameItems?: CzkawkaRenameItem[]
  deleteMode?: CzkawkaDeleteMode
  copyMode?: boolean
  preserveStructure?: boolean
  conflictPolicy?: CzkawkaConflictPolicy
  outputPath?: string
  outputFormat?: "json" | "csv"
  exportScope?: CzkawkaExportScope
  exportEntries?: CzkawkaEntry[]
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
  groups: Array<{ entries: Array<{ path: string; modifiedDate: number; size: number; width?: number; height?: number; fps?: number; codec?: string; similarity?: string; title?: string; artist?: string; year?: string; length?: string; genre?: string; bitrate?: number; isReference?: boolean; detail?: string; properExtension?: string }> }>
  messages: string
  stopped: boolean
}

export type CzkawkaNormalizedInput = Omit<Required<CzkawkaInput>, "similarVideosCropDetect">

export interface CzkawkaRuntime {
  capabilities?: readonly string[]
  scanDuplicates: (input: CzkawkaNormalizedInput, onProgress?: (progress: CzkawkaNativeProgress) => void) => Promise<NativeDuplicateResult>
  scanBasic: (input: CzkawkaNormalizedInput, onProgress?: (progress: CzkawkaNativeProgress) => void) => Promise<NativeBasicResult>
  scanMedia: (input: CzkawkaNormalizedInput, onProgress?: (progress: CzkawkaNativeProgress) => void) => Promise<NativeMediaResult>
  pathExists: (path: string) => Promise<boolean>
  removePath: (path: string, options?: { trash?: boolean; emptyFoldersOnly?: boolean }) => Promise<void>
  copyPath: (source: string, target: string) => Promise<void>
  movePath: (source: string, target: string) => Promise<void>
  writeText: (path: string, content: string) => Promise<void>
  ensureDirectory: (path: string) => Promise<void>
  join: (...parts: string[]) => string
  dirname: (path: string) => string
  basename: (path: string) => string
  relativeDirectoryFromRoot: (path: string) => string
  isCancelled?: () => boolean
  waitWhilePaused?: () => Promise<void>
}

export interface CzkawkaRuntimeInfo {
  apiVersion: number
  sourceVersion: string
  capabilities: readonly string[]
}

export interface CzkawkaNativeProgress { stage: string; stageIndex: number; stageCount: number; entriesChecked: number; entriesTotal: number; bytesChecked: number; bytesTotal: number }

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
  fps?: number
  codec?: string
  similarity?: string
  title?: string
  artist?: string
  year?: string
  length?: string
  genre?: string
  bitrate?: number
  isReference?: boolean
  status?: CzkawkaOperationStatus
  operation?: "delete" | "trash" | "move" | "copy" | "rename" | "save"
  conflictPolicy?: CzkawkaConflictPolicy
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
  similarFolders?: CzkawkaSimilarFolderStat[]
}

export type CzkawkaResult = NodeRunResult<CzkawkaData>

const BASIC_TOOLS = new Set<CzkawkaTool>(["empty-folders", "big-files", "empty-files", "temporary-files", "invalid-symlinks", "bad-names"])
const MEDIA_TOOLS = new Set<CzkawkaTool>(["similar-images", "similar-videos", "duplicate-music", "broken-files", "bad-extensions"])

export function normalizeCzkawkaInput(input: CzkawkaInput): CzkawkaNormalizedInput {
  const destinationItems = normalizeDestinationItems(input.destinationItems)
  const renameItems = normalizeRenameItems(input.renameItems)
  const exportEntries = input.exportEntries?.map((entry) => ({ ...entry })) ?? []
  const similarVideoCrop = resolveCzkawkaSimilarVideoCrop(input)
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
    saveAlsoAsJson: input.saveAlsoAsJson ?? false,
    deleteOutdatedCache: input.deleteOutdatedCache ?? true,
    cacheFolderPath: clean(input.cacheFolderPath),
    configFolderPath: clean(input.configFolderPath),
    duplicateMinimalHashCacheSizeKiB: clamp(input.duplicateMinimalHashCacheSizeKiB, 1, 1024 * 1024, 256),
    duplicateMinimalPrehashCacheSizeKiB: clamp(input.duplicateMinimalPrehashCacheSizeKiB, 1, 1024 * 1024, 256),
    threadCount: clamp(input.threadCount, 0, 256, 0),
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
    similarImagesIgnoreSameResolution: input.similarImagesIgnoreSameResolution ?? false,
    similarImagesGeometricInvariance: oneOf(input.similarImagesGeometricInvariance, ["off", "mirror-flip", "mirror-flip-rotate-90"] as const, "off"),
    similarImagesFolderThreshold: clamp(input.similarImagesFolderThreshold, 1, 10_000, 2),
    similarVideosIgnoreSameSize: input.similarVideosIgnoreSameSize ?? false,
    similarVideosIgnoreSameResolution: input.similarVideosIgnoreSameResolution ?? false,
    similarVideosSkipForward: clamp(input.similarVideosSkipForward, 0, 300, 15),
    similarVideosHashDuration: clamp(input.similarVideosHashDuration, 2, 60, 10),
    similarVideosLetterboxCrop: similarVideoCrop.letterboxCrop,
    similarVideosWindowCount: clamp(input.similarVideosWindowCount, 1, 20, 5),
    similarVideosDurationTolerancePct: clampDecimal(input.similarVideosDurationTolerancePct, 0, 100, 20),
    similarVideosMinMatchingWindows: clampDecimal(input.similarVideosMinMatchingWindows, 0, 1, 0.6),
    similarVideosSubclipMinMatch: clampDecimal(input.similarVideosSubclipMinMatch, 0, 1, 0.5),
    similarVideosCheckAudioContent: input.similarVideosCheckAudioContent ?? false,
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
    brokenVideoFfprobe: input.brokenVideoFfprobe ?? false,
    brokenVideoFfmpeg: input.brokenVideoFfmpeg ?? false,
    brokenFont: input.brokenFont ?? false,
    brokenMarkup: input.brokenMarkup ?? false,
    emptyFilesSearchZeroByteContent: input.emptyFilesSearchZeroByteContent ?? false,
    emptyFilesSearchNonPrintableContent: input.emptyFilesSearchNonPrintableContent ?? false,
    temporaryFileExtensions: normalizeTemporaryFileExtensions(input.temporaryFileExtensions),
    filterText: clean(input.filterText),
    sortBy: input.sortBy ?? "path",
    descending: input.descending ?? false,
    selectedPaths: unique([...(input.selectedPaths ?? []), ...destinationItems.map((item) => item.path), ...renameItems.map((item) => item.path), ...exportEntries.map((entry) => entry.path)]),
    destinationDirectory: clean(input.destinationDirectory),
    destinationItems,
    renameItems,
    deleteMode: oneOf(input.deleteMode, ["trash", "permanent"] as const, "trash"),
    copyMode: input.copyMode ?? false,
    preserveStructure: input.preserveStructure ?? false,
    conflictPolicy: oneOf(input.conflictPolicy, ["skip", "overwrite", "rename", "error"] as const, "skip"),
    outputPath: clean(input.outputPath),
    outputFormat: input.outputFormat ?? "json",
    exportScope: oneOf(input.exportScope, ["selected", "visible", "all"] as const, "selected"),
    exportEntries,
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
      if (!value.destinationDirectory && !value.destinationItems.length) return fail(value, "A destination directory or per-item destinations are required.")
      return await mutate(value, runtime, "move", onEvent)
    }
    if (value.action === "rename") {
      if (!value.renameItems.length) return fail(value, "At least one path and rename target are required.")
      return await mutate(value, runtime, "rename", onEvent)
    }
    if (!value.outputPath) return fail(value, "An output path is required.")
    return await save(value, runtime, onEvent)
  } catch (error) {
    return fail(value, errorMessage(error))
  }
}

async function scan(value: CzkawkaNormalizedInput, runtime: CzkawkaRuntime, onEvent: (event: NodeRunEvent) => void): Promise<CzkawkaResult> {
  if (!value.includedDirectories.length) return fail(value, "Add at least one included directory.")
  if (value.minimumFileSize > value.maximumFileSize) return fail(value, "Minimum file size cannot exceed maximum file size.")
  const missingCapabilities = missingNativeCapabilities(value, runtime.capabilities)
  if (missingCapabilities.length) return fail(value, `Czkawka binding is missing: ${missingCapabilities.join(", ")}.`)
  await runtime.waitWhilePaused?.()
  if (runtime.isCancelled?.()) return cancelled(value)
  onEvent({ type: "progress", progress: 2, message: `Starting ${value.tool}.` })
  const onProgress = (progress: CzkawkaNativeProgress) => onEvent({ type: "progress", progress: nativeProgressPercent(progress), message: nativeProgressMessage(progress) })
  let groups: CzkawkaGroup[]
  let messages = ""
  let stopped = false
  if (value.tool === "duplicate-files") {
    const native = await runtime.scanDuplicates(value, onProgress)
    groups = native.groups.filter((group) => group.files.length >= value.duplicateMinimumGroupSize).map((group, index) => makeGroup(index, group.files.map((entry) => ({ ...entry, name: runtime.basename(entry.path) })), runtime, true))
    messages = native.messages
    stopped = native.stopped
  } else if (BASIC_TOOLS.has(value.tool)) {
    const native = await runtime.scanBasic(value, onProgress)
    groups = native.entries.length ? [makeGroup(0, native.entries.map((entry) => ({ ...entry, name: runtime.basename(entry.path) })), runtime, false)] : []
    messages = native.messages
    stopped = native.stopped
  } else if (MEDIA_TOOLS.has(value.tool)) {
    const native = await runtime.scanMedia(value, onProgress)
    groups = native.groups.filter((group) => group.entries.length > 0).map((group, index) => makeGroup(index, group.entries.map((entry) => ({ ...entry, name: runtime.basename(entry.path) })), runtime, isGroupedTool(value.tool)))
    messages = native.messages
    stopped = native.stopped
  } else return fail(value, `Unsupported Czkawka tool: ${value.tool}`)

  groups = filterAndSortGroups(groups, value)
  if (runtime.isCancelled?.() && !stopped) stopped = true
  onEvent({ type: "progress", progress: stopped ? 99 : 100, message: stopped ? `Stopped ${value.tool}.` : `Finished ${value.tool}.` })
  const data = summarize(value, groups, messages, stopped)
  return { success: !stopped, message: stopped ? `Stopped ${value.tool}; retained ${data.fileCount} partial item(s).` : `Found ${data.fileCount} item(s) in ${data.groupCount} group(s).`, data }
}

function missingNativeCapabilities(value: CzkawkaNormalizedInput, capabilities: readonly string[] | undefined): string[] {
  const required: string[] = []
  if (value.tool === "similar-images") {
    if (value.similarImagesIgnoreSameResolution) required.push("similar-images.same-resolution-exclusion")
    if (value.similarImagesGeometricInvariance !== "off") required.push("similar-images.geometric-invariance")
  }
  if (value.tool === "similar-videos") {
    if (value.similarVideosIgnoreSameResolution) required.push("similar-videos.same-resolution-exclusion")
    if (
      value.similarVideosWindowCount !== 5 ||
      value.similarVideosDurationTolerancePct !== 20 ||
      value.similarVideosMinMatchingWindows !== 0.6 ||
      value.similarVideosSubclipMinMatch !== 0.5
    ) required.push("similar-videos.similario")
    if (value.similarVideosCheckAudioContent) required.push("similar-videos.audio")
  }
  if (value.tool === "broken-files" && (
    value.brokenVideoFfprobe || value.brokenVideoFfmpeg || value.brokenFont || value.brokenMarkup
  )) required.push("broken-files.multi-checker")
  if (value.tool === "empty-files" && (
    value.emptyFilesSearchZeroByteContent || value.emptyFilesSearchNonPrintableContent
  )) required.push("empty-files.content-checkers")
  if (value.tool === "temporary-files" && !isDefaultTemporaryFileExtensions(value.temporaryFileExtensions)) {
    required.push("temporary-files.custom-extensions")
  }
  if (value.tool === "bad-names") required.push("scan.bad-names")
  if (!required.length) return []
  const available = new Set(capabilities ?? [])
  return required.filter((capability) => !available.has(capability))
}

function nativeProgressPercent(progress: CzkawkaNativeProgress): number { const stages = Math.max(1, progress.stageCount), stage = Math.max(0, Math.min(stages - 1, progress.stageIndex)), fraction = progress.entriesTotal > 0 ? progress.entriesChecked / progress.entriesTotal : progress.bytesTotal > 0 ? progress.bytesChecked / progress.bytesTotal : 0; return Math.max(3, Math.min(98, Math.round(((stage + Math.max(0, Math.min(1, fraction))) / stages) * 95 + 3))) }
function nativeProgressMessage(progress: CzkawkaNativeProgress): string { const count = progress.entriesTotal > 0 ? ` ${progress.entriesChecked}/${progress.entriesTotal}` : progress.entriesChecked > 0 ? ` ${progress.entriesChecked}` : ""; return `${humanStage(progress.stage)}${count}` }
function humanStage(stage: string): string { return stage.replace(/([a-z0-9])([A-Z])/g, "$1 $2") }
function cancelled(value: CzkawkaNormalizedInput): CzkawkaResult { return { success: false, message: `${value.tool} scan cancelled.`, data: summarize(value, [], "Scan cancelled.", true) } }

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

async function mutate(value: CzkawkaNormalizedInput, runtime: CzkawkaRuntime, action: "delete" | "move" | "rename", onEvent: (event: NodeRunEvent) => void): Promise<CzkawkaResult> {
  const entries: CzkawkaEntry[] = []
  const claimedTargets = new Set<string>()
  const destinations = new Map(value.destinationItems.map((item) => [item.path, item.destination]))
  const renameItems = new Map(value.renameItems.map((item) => [item.path, item]))
  for (let index = 0; index < value.selectedPaths.length; index += 1) {
    const path = value.selectedPaths[index]!
    const operation: NonNullable<CzkawkaEntry["operation"]> = action === "delete" ? value.deleteMode === "trash" ? "trash" : "delete" : action === "rename" ? "rename" : value.copyMode ? "copy" : "move"
    let target = action === "move" ? operationTarget(value, runtime, path, destinations.get(path)) : undefined
    const base: CzkawkaEntry = { id: `op:${index}`, groupId: 0, path, name: runtime.basename(path), size: 0, modifiedDate: 0, properExtension: renameItems.get(path)?.properExtension, operation, conflictPolicy: action === "move" || action === "rename" ? value.conflictPolicy : undefined }
    onEvent({ type: "progress", progress: Math.round((index / value.selectedPaths.length) * 100), message: `${operation} ${runtime.basename(path)}` })
    try {
      if (action === "rename") target = renameTarget(path, renameItems.get(path), runtime)
      if (!await runtime.pathExists(path)) throw new Error("Source path no longer exists.")
      if (target === path) { entries.push({ ...base, secondaryPath: target, status: "skipped", error: "Path already uses the requested name." }); continue }
      const claimed = target ? claimedTargets.has(target.toLocaleLowerCase()) : false
      if (target && (claimed || await runtime.pathExists(target))) {
        if (claimed && value.conflictPolicy === "overwrite") throw new Error("Another selected item uses the same target path.")
        if (value.conflictPolicy === "skip") { entries.push({ ...base, secondaryPath: target, status: "skipped", error: "Target already exists." }); continue }
        if (value.conflictPolicy === "error") throw new Error("Target already exists.")
        if (value.conflictPolicy === "rename") target = await availableTarget(target, runtime, claimedTargets)
      }
      if (target) claimedTargets.add(target.toLocaleLowerCase())
      if (value.dryRun) { entries.push({ ...base, secondaryPath: target, status: "planned" }); continue }
      if (action === "delete") {
        await runtime.removePath(path, { trash: value.deleteMode === "trash", emptyFoldersOnly: value.tool === "empty-folders" })
      } else {
        await runtime.ensureDirectory(runtime.dirname(target!))
        if (value.conflictPolicy === "overwrite" && await runtime.pathExists(target!)) await runtime.removePath(target!, { trash: false })
        if (action === "move" && value.copyMode) await runtime.copyPath(path, target!)
        else await runtime.movePath(path, target!)
      }
      const status: CzkawkaOperationStatus = action === "delete" ? value.deleteMode === "trash" ? "trashed" : "deleted" : action === "rename" ? "renamed" : value.copyMode ? "copied" : "moved"
      entries.push({ ...base, secondaryPath: target, status })
    } catch (error) { entries.push({ ...base, secondaryPath: target, status: "error", error: errorMessage(error) }) }
  }
  const group = makeGroup(0, entries, runtime, false)
  const data = summarize(value, [group], "", false)
  return { success: data.errorCount === 0, message: value.dryRun ? `Planned ${data.affectedCount} operation(s); ${entries.filter((entry) => entry.status === "skipped").length} skipped.` : `Completed ${data.affectedCount} operation(s).`, data }
}

function renameTarget(source: string, item: CzkawkaRenameItem | undefined, runtime: Pick<CzkawkaRuntime, "basename" | "dirname" | "join">): string {
  const targetName = clean(item?.targetName)
  if (targetName) {
    if (!isValidTargetName(targetName)) throw new Error("Invalid target name.")
    return runtime.join(runtime.dirname(source), targetName)
  }
  const properExtension = clean(item?.properExtension).replace(/^\.+/, "")
  if (!properExtension || /[\\/:*?"<>|]/.test(properExtension)) throw new Error("Invalid proper extension.")
  const filename = runtime.basename(source)
  const dot = filename.lastIndexOf(".")
  const stem = dot > 0 ? filename.slice(0, dot) : filename
  return runtime.join(runtime.dirname(source), `${stem}.${properExtension}`)
}

function isValidTargetName(value: string): boolean {
  return value !== "." && value !== ".." && !/[\\/:*?"<>|\u0000-\u001F]/.test(value)
}

function operationTarget(value: CzkawkaNormalizedInput, runtime: CzkawkaRuntime, source: string, itemDestination?: string): string {
  if (itemDestination) return runtime.join(itemDestination, runtime.basename(source))
  const relativeDirectory = value.preserveStructure ? runtime.relativeDirectoryFromRoot(source) : ""
  return relativeDirectory ? runtime.join(value.destinationDirectory, relativeDirectory, runtime.basename(source)) : runtime.join(value.destinationDirectory, runtime.basename(source))
}

async function availableTarget(target: string, runtime: CzkawkaRuntime, claimedTargets: ReadonlySet<string>): Promise<string> {
  const directory = runtime.dirname(target)
  const filename = runtime.basename(target)
  const dot = filename.lastIndexOf(".")
  const stem = dot > 0 ? filename.slice(0, dot) : filename
  const extension = dot > 0 ? filename.slice(dot) : ""
  for (let suffix = 1; suffix < 100_000; suffix += 1) {
    const candidate = runtime.join(directory, `${stem} (${suffix})${extension}`)
    if (!claimedTargets.has(candidate.toLocaleLowerCase()) && !await runtime.pathExists(candidate)) return candidate
  }
  throw new Error(`No available target name for ${target}.`)
}

async function save(value: CzkawkaNormalizedInput, runtime: CzkawkaRuntime, onEvent: (event: NodeRunEvent) => void): Promise<CzkawkaResult> {
  const sourceRows = value.exportEntries.length ? value.exportEntries : value.selectedPaths.map((path, index) => ({ id: `save:${index}`, groupId: 0, path, name: runtime.basename(path), size: 0, modifiedDate: 0 }))
  const rows: CzkawkaEntry[] = sourceRows.map((entry, index) => ({ ...entry, id: entry.id || `save:${index}`, status: "saved", operation: "save" }))
  const content = value.outputFormat === "csv" ? exportCsv(rows) : `${JSON.stringify({ tool: value.tool, scope: value.exportScope, entries: rows }, null, 2)}\n`
  onEvent({ type: "progress", progress: 50, message: `Writing ${runtime.basename(value.outputPath)}.` })
  if (!value.dryRun) { await runtime.ensureDirectory(runtime.dirname(value.outputPath)); await runtime.writeText(value.outputPath, content) }
  const data = summarize(value, [makeGroup(0, rows, runtime, false)], "", false)
  return { success: true, message: value.dryRun ? `Planned export of ${rows.length} path(s).` : `Saved ${rows.length} path(s).`, data }
}

function summarize(value: CzkawkaNormalizedInput, groups: CzkawkaGroup[], messages: string, stopped: boolean): CzkawkaData {
  const entries = groups.flatMap((group) => group.entries)
  return { action: value.action, tool: value.tool, groups, entries, messages, stopped, groupCount: groups.length, fileCount: entries.length, totalBytes: groups.reduce((sum, group) => sum + group.totalBytes, 0), reclaimableBytes: groups.reduce((sum, group) => sum + group.reclaimableBytes, 0), affectedCount: entries.filter((entry) => ["deleted", "trashed", "moved", "copied", "renamed", "saved", "planned"].includes(entry.status ?? "")).length, errorCount: entries.filter((entry) => entry.status === "error").length, similarFolders: value.action === "scan" && value.tool === "similar-images" ? buildCzkawkaSimilarFolders(groups, value.similarImagesFolderThreshold) : undefined }
}

function isGroupedTool(tool: CzkawkaTool): boolean { return ["duplicate-files", "similar-images", "similar-videos", "duplicate-music"].includes(tool) }
function fail(value: CzkawkaNormalizedInput, message: string): CzkawkaResult { return { success: false, message, data: summarize(value, [], message, false) } }
function unique(values: string[]): string[] { return [...new Set(values.map(clean).filter(Boolean))] }
function normalizeDestinationItems(items: CzkawkaDestinationItem[] | undefined): CzkawkaDestinationItem[] { const result = new Map<string, string>(); for (const item of items ?? []) { const path = clean(item.path), destination = clean(item.destination); if (path && destination) result.set(path, destination) } return [...result].map(([path, destination]) => ({ path, destination })) }
function normalizeRenameItems(items: CzkawkaRenameItem[] | undefined): CzkawkaRenameItem[] { const result = new Map<string, CzkawkaRenameItem>(); for (const item of items ?? []) { const path = clean(item.path), properExtension = clean(item.properExtension).replace(/^\.+/, ""), targetName = clean(item.targetName); if (!path || (!properExtension && !targetName)) continue; result.set(path, { path, ...(targetName ? { targetName } : { properExtension }) }) } return [...result.values()] }
function clean(value: unknown): string { return String(value ?? "").trim() }
function clamp(value: unknown, min: number, max: number, fallback: number): number { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback }
function clampDecimal(value: unknown, min: number, max: number, fallback: number): number { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback }
function oneOf<const Values extends readonly (string | number)[]>(value: unknown, values: Values, fallback: Values[number]): Values[number] { return values.includes(value as Values[number]) ? value as Values[number] : fallback }
function csv(value: string): string { return `"${value.replaceAll('"', '""')}"` }
const EXPORT_FIELDS = ["groupId", "path", "name", "size", "modifiedDate", "hash", "secondaryPath", "detail", "properExtension", "width", "height", "fps", "codec", "similarity", "title", "artist", "year", "length", "genre", "bitrate", "isReference", "status", "operation", "conflictPolicy", "error"] as const satisfies readonly (keyof CzkawkaEntry)[]
function exportCsv(entries: CzkawkaEntry[]): string { return `${EXPORT_FIELDS.join(",")}\n${entries.map((entry) => EXPORT_FIELDS.map((field) => csv(String(entry[field] ?? ""))).join(",")).join("\n")}\n` }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
