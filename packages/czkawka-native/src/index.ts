import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveCzkawkaBindingPath } from "./native-asset.js"

export interface CzkawkaInfo {
  apiVersion: number
  sourceVersion: string
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
  ignoreHardLinks?: boolean
  usePrehash?: boolean
  caseSensitiveNames?: boolean
  checkMethod?: "name" | "size" | "size-and-name" | "sizeAndName" | "hash"
  hashType?: "crc32" | "xxh3" | "blake3"
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
  numberOfFiles?: number
  biggestFirst?: boolean
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
  ignoreHardLinks?: boolean
  similarity?: number
  imageHashSize?: number
  imageHashAlgorithm?: "mean" | "gradient" | "blockhash" | "vert-gradient" | "double-gradient" | "median"
  imageResizeAlgorithm?: "lanczos3" | "gaussian" | "catmull-rom" | "triangle" | "nearest"
  imageIgnoreSameSize?: boolean
  videoIgnoreSameSize?: boolean
  videoSkipForward?: number
  videoHashDuration?: number
  videoCropDetect?: "letterbox" | "motion" | "none"
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
}

export interface MediaEntry {
  path: string
  size: number
  modifiedDate: number
  width?: number
  height?: number
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

export interface CzkawkaBinding {
  getCzkawkaInfo(): CzkawkaInfo
  scanDuplicateFiles(options: DuplicateScanOptions): Promise<DuplicateScanResult>
  scanBasicFiles(options: BasicScanOptions): Promise<BasicScanResult>
  scanMediaFiles(options: MediaScanOptions): Promise<MediaScanResult>
}

let cachedBinding: CzkawkaBinding | undefined

export function loadCzkawkaBinding(): CzkawkaBinding {
  if (cachedBinding) return cachedBinding
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
  const bindingPath = resolveCzkawkaBindingPath(packageRoot)
  if (!existsSync(bindingPath)) {
    throw new Error(`Xiranite Czkawka native binding not found at ${bindingPath}. Run "bun run --cwd packages/czkawka-native build:native" first.`)
  }
  if (process.platform === "win32") {
    const nativeDirectory = dirname(bindingPath)
    process.env.PATH = `${nativeDirectory};${process.env.PATH ?? ""}`
  }
  cachedBinding = createRequire(import.meta.url)(bindingPath) as CzkawkaBinding
  return cachedBinding
}

export const getCzkawkaInfo = (): CzkawkaInfo => loadCzkawkaBinding().getCzkawkaInfo()
export const scanDuplicateFiles = (options: DuplicateScanOptions): Promise<DuplicateScanResult> =>
  loadCzkawkaBinding().scanDuplicateFiles(options)
export const scanBasicFiles = (options: BasicScanOptions): Promise<BasicScanResult> =>
  loadCzkawkaBinding().scanBasicFiles(options)
export const scanMediaFiles = (options: MediaScanOptions): Promise<MediaScanResult> =>
  loadCzkawkaBinding().scanMediaFiles(options)
