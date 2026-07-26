import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { prependNativeLibraryPath } from "@xiranite/native-loader"
import { resolveCzkawkaBindingPath } from "./native-asset.js"

export interface CzkawkaInfo {
  apiVersion: number
  sourceVersion: string
  capabilities: string[]
}

interface CzkawkaBindingInfo extends Omit<CzkawkaInfo, "capabilities"> {
  capabilities?: string[]
}

export interface TrashCapabilities {
  deleteToTrash: boolean
  list: boolean
  restore: boolean
  provider: "trash-rs"
  providerVersion: string
}

export interface TrashItemReceipt {
  id: string
  name: string
  originalParent: string
  timeDeleted: number
}

export interface TrashPathResult {
  trashed: true
  receipt?: TrashItemReceipt
}

export interface DuplicateScanOptions {
  includedDirectories: string[]
  referenceDirectories?: string[]
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
  minimalCacheFileSize?: number
  minimalPrehashCacheFileSize?: number
  ignoreHardLinks?: boolean
  usePrehash?: boolean
  caseSensitiveNames?: boolean
  checkMethod?: "name" | "size" | "size-and-name" | "sizeAndName" | "hash"
  hashType?: "crc32" | "xxh3" | "blake3"
  scanId?: string
  threadCount?: number
}

export interface DuplicateFile {
  path: string
  modifiedDate: number
  size: number
  hash: string
  isReference: boolean
}

export interface DuplicateScanResult {
  groups: Array<{ files: DuplicateFile[] }>
  messages: string
  stopped: boolean
}

export type CzkawkaBasicTool = "big-files" | "empty-files" | "empty-folders" | "temporary-files" | "invalid-symlinks"

export interface BasicScanOptions {
  tool: CzkawkaBasicTool
  includedDirectories: string[]
  referenceDirectories?: string[]
  excludedDirectories?: string[]
  excludedItems?: string[]
  allowedExtensions?: string
  excludedExtensions?: string
  recursive?: boolean
  minimumFileSize?: number
  maximumFileSize?: number
  useCache?: boolean
  saveAlsoAsJson?: boolean
  deleteOutdatedCache?: boolean
  numberOfFiles?: number
  biggestFirst?: boolean
  scanId?: string
  threadCount?: number
}

export interface BasicEntry {
  path: string
  size: number
  modifiedDate: number
  secondaryPath?: string
  detail?: string
}

export interface BasicScanResult {
  entries: BasicEntry[]
  messages: string
  stopped: boolean
}

export type CzkawkaMediaTool = "similar-images" | "similar-videos" | "duplicate-music" | "broken-files" | "bad-extensions"

export interface MediaScanOptions {
  tool: CzkawkaMediaTool
  includedDirectories: string[]
  referenceDirectories?: string[]
  excludedDirectories?: string[]
  excludedItems?: string[]
  allowedExtensions?: string
  excludedExtensions?: string
  recursive?: boolean
  minimumFileSize?: number
  maximumFileSize?: number
  useCache?: boolean
  saveAlsoAsJson?: boolean
  deleteOutdatedCache?: boolean
  ignoreHardLinks?: boolean
  similarity?: number
  imageHashSize?: number
  imageHashAlgorithm?: "mean" | "gradient" | "blockhash" | "vert-gradient" | "double-gradient" | "median"
  imageResizeAlgorithm?: "lanczos3" | "gaussian" | "catmull-rom" | "triangle" | "nearest"
  imageIgnoreSameSize?: boolean
  imageIgnoreSameResolution?: boolean
  imageGeometricInvariance?: "off" | "mirror-flip" | "mirror-flip-rotate-90"
  videoIgnoreSameSize?: boolean
  videoIgnoreSameResolution?: boolean
  videoSkipForward?: number
  videoHashDuration?: number
  videoCropDetect?: "letterbox" | "motion" | "none"
  videoWindowCount?: number
  videoDurationTolerancePct?: number
  videoMinMatchingWindows?: number
  videoSubclipMinMatch?: number
  videoCheckAudioContent?: boolean
  musicCheckType?: "tags" | "fingerprint"
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
  scanId?: string
  threadCount?: number
}

export interface MediaEntry {
  path: string
  size: number
  modifiedDate: number
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
  isReference: boolean
  detail?: string
  properExtension?: string
}

export interface MediaGroup {
  entries: MediaEntry[]
}

export interface MediaScanResult {
  groups: MediaGroup[]
  messages: string
  stopped: boolean
}

export interface CzkawkaScanProgress {
  stage: string
  stageIndex: number
  stageCount: number
  entriesChecked: number
  entriesTotal: number
  bytesChecked: number
  bytesTotal: number
}

export interface CzkawkaBinding {
  getCzkawkaInfo(): CzkawkaBindingInfo
  getTrashCapabilities(): TrashCapabilities
  trashPath(path: string): Promise<TrashPathResult>
  listTrashItems(): Promise<TrashItemReceipt[]>
  restoreTrashItem(receipt: TrashItemReceipt): Promise<void>
  scanDuplicateFiles(options: DuplicateScanOptions): Promise<DuplicateScanResult>
  scanBasicFiles(options: BasicScanOptions): Promise<BasicScanResult>
  scanMediaFiles(options: MediaScanOptions): Promise<MediaScanResult>
  cancelCzkawkaScan?(scanId: string): boolean
  getCzkawkaScanProgress?(scanId: string): CzkawkaScanProgress | undefined
}

let cachedBinding: CzkawkaBinding | undefined

export function loadCzkawkaBinding(): CzkawkaBinding {
  if (cachedBinding) return cachedBinding
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
  const bindingPath = resolveCzkawkaBindingPath(packageRoot)
  if (!existsSync(bindingPath)) {
    throw new Error(`Xiranite Czkawka native binding not found at ${bindingPath}. Run "bun run --cwd packages/czkawka-native build:native" first.`)
  }
  prependNativeLibraryPath(bindingPath)
  cachedBinding = createRequire(import.meta.url)(bindingPath) as CzkawkaBinding
  return cachedBinding
}

export const getCzkawkaInfo = (): CzkawkaInfo => {
  const info = loadCzkawkaBinding().getCzkawkaInfo()
  return { ...info, capabilities: info.capabilities ?? [] }
}
export const getTrashCapabilities = (): TrashCapabilities => loadCzkawkaBinding().getTrashCapabilities()
export const trashPath = (path: string): Promise<TrashPathResult> => loadCzkawkaBinding().trashPath(path)
export const listTrashItems = (): Promise<TrashItemReceipt[]> => loadCzkawkaBinding().listTrashItems()
export const restoreTrashItem = (receipt: TrashItemReceipt): Promise<void> => loadCzkawkaBinding().restoreTrashItem(receipt)
export const scanDuplicateFiles = (options: DuplicateScanOptions): Promise<DuplicateScanResult> =>
  loadCzkawkaBinding().scanDuplicateFiles(options)
export const scanBasicFiles = (options: BasicScanOptions): Promise<BasicScanResult> =>
  loadCzkawkaBinding().scanBasicFiles(options)
export const scanMediaFiles = (options: MediaScanOptions): Promise<MediaScanResult> =>
  loadCzkawkaBinding().scanMediaFiles(options)
export const cancelCzkawkaScan = (scanId: string): boolean => loadCzkawkaBinding().cancelCzkawkaScan?.(scanId) ?? false
export const getCzkawkaScanProgress = (scanId: string): CzkawkaScanProgress | undefined => loadCzkawkaBinding().getCzkawkaScanProgress?.(scanId) ?? undefined

export {
  assertCzkawkaCompatibility,
  checkCzkawkaCompatibility,
  type CzkawkaBindingRequirement,
  type CzkawkaCompatibilityResult,
} from "./compatibility.js"
