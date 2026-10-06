import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { prependNativeLibraryPath } from "@xiranite/native-loader"
import type * as Generated from "../generated/binding.generated.js"
import { resolveCzkawkaBindingPath } from "./native-asset.js"

export type CzkawkaInfo = Generated.CzkawkaInfo
export type TrashCapabilities = Generated.TrashCapabilities
export type TrashItemReceipt = Generated.TrashItemReceipt
export type TrashPathResult = Generated.TrashPathResult
export type DuplicateFile = Generated.DuplicateFile
export type DuplicateScanResult = Generated.DuplicateScanResult
export type BasicEntry = Generated.BasicEntry
export type BasicScanResult = Generated.BasicScanResult
export type ExifTag = Generated.ExifTag
export type ExifEntry = Generated.ExifEntry
export type ExifScanResult = Generated.ExifScanResult
export type ExifCandidate = Generated.ExifCandidate
export type MediaEntry = Generated.MediaEntry
export type MediaGroup = Generated.MediaGroup
export type MediaScanResult = Generated.MediaScanResult
export type CzkawkaScanProgress = Generated.CzkawkaScanProgress
export type VideoOptimizerEntry = Generated.VideoOptimizerEntry
export type VideoOptimizerScanResult = Generated.VideoOptimizerScanResult
export type VideoOptimizerCandidate = Generated.VideoOptimizerCandidate
export type ExifCandidateOptions = Generated.ExifCandidateOptions

export type CzkawkaBasicTool = "big-files" | "empty-files" | "empty-folders" | "temporary-files" | "invalid-symlinks" | "bad-names"
export type CzkawkaMediaTool = "similar-images" | "similar-videos" | "duplicate-music" | "broken-files" | "bad-extensions"
export type DuplicateCheckMethod = "name" | "size" | "size-and-name" | "sizeAndName" | "hash"
export type DuplicateHashType = "crc32" | "xxh3" | "blake3"
export type ImageHashAlgorithm = "mean" | "gradient" | "blockhash" | "vert-gradient" | "double-gradient" | "median"
export type ImageResizeAlgorithm = "lanczos3" | "gaussian" | "catmull-rom" | "triangle" | "nearest"
export type ImageGeometricInvariance = "off" | "mirror-flip" | "mirror-flip-rotate-90"
export type VideoCropDetect = "letterbox" | "motion" | "none"
export type MusicCheckType = "tags" | "fingerprint"
export type VideoOptimizerMode = "transcode" | "crop"
export type VideoOptimizerCodec = "h264" | "h265" | "av1" | "vp9"
export type VideoOptimizerNoiseReduction = "none" | "hqdn3d"

export type DuplicateScanOptions = Omit<Generated.DuplicateScanOptions, "checkMethod" | "hashType"> & {
  checkMethod?: DuplicateCheckMethod
  hashType?: DuplicateHashType
}

export type BasicScanOptions = Omit<Generated.BasicScanOptions, "tool"> & {
  tool: CzkawkaBasicTool
}

export type ExifScanOptions = Generated.ExifScanOptions

export type VideoOptimizerScanOptions = Omit<Generated.VideoOptimizerScanOptions, "mode"> & {
  mode: VideoOptimizerMode
}

export type VideoOptimizerCandidateOptions = Omit<Generated.VideoOptimizerCandidateOptions, "mode" | "targetCodec" | "noiseReduction"> & {
  mode: VideoOptimizerMode
  targetCodec: VideoOptimizerCodec
  noiseReduction?: VideoOptimizerNoiseReduction
}

export type MediaScanOptions = Omit<Generated.MediaScanOptions,
  "tool" | "imageHashAlgorithm" | "imageResizeAlgorithm" | "imageGeometricInvariance" | "videoCropDetect" | "musicCheckType"
> & {
  tool: CzkawkaMediaTool
  imageHashAlgorithm?: ImageHashAlgorithm
  imageResizeAlgorithm?: ImageResizeAlgorithm
  imageGeometricInvariance?: ImageGeometricInvariance
  videoCropDetect?: VideoCropDetect
  musicCheckType?: MusicCheckType
}

type CzkawkaBindingInfo = Omit<CzkawkaInfo, "capabilities"> & {
  capabilities?: string[]
}

type GeneratedBinding = typeof import("../generated/binding.generated.js")

export type CzkawkaBinding = Omit<GeneratedBinding,
  "getCzkawkaInfo" | "cancelCzkawkaScan" | "getCzkawkaScanProgress"
> & {
  getCzkawkaInfo(): CzkawkaBindingInfo
} & Partial<Pick<GeneratedBinding, "cancelCzkawkaScan" | "getCzkawkaScanProgress">>

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

// napi-rs emits AsyncTask completions as Promise<unknown>; their object shapes stay generator-owned above.
export const getTrashCapabilities = (): TrashCapabilities => loadCzkawkaBinding().getTrashCapabilities()
export const trashPath = (path: string): Promise<TrashPathResult> => loadCzkawkaBinding().trashPath(path) as Promise<TrashPathResult>
export const listTrashItems = (): Promise<TrashItemReceipt[]> => loadCzkawkaBinding().listTrashItems() as Promise<TrashItemReceipt[]>
export const restoreTrashItem = (receipt: TrashItemReceipt): Promise<void> => loadCzkawkaBinding().restoreTrashItem(receipt) as Promise<void>
export const scanDuplicateFiles = (options: DuplicateScanOptions): Promise<DuplicateScanResult> =>
  loadCzkawkaBinding().scanDuplicateFiles(options) as Promise<DuplicateScanResult>
export const scanBasicFiles = (options: BasicScanOptions): Promise<BasicScanResult> =>
  loadCzkawkaBinding().scanBasicFiles(options) as Promise<BasicScanResult>
export const scanExifFiles = (options: ExifScanOptions): Promise<ExifScanResult> =>
  loadCzkawkaBinding().scanExifFiles(options) as Promise<ExifScanResult>
export const createExifCandidate = (options: ExifCandidateOptions): Promise<ExifCandidate> =>
  loadCzkawkaBinding().createExifCandidate(options) as Promise<ExifCandidate>
export const scanVideoOptimizer = (options: VideoOptimizerScanOptions): Promise<VideoOptimizerScanResult> =>
  loadCzkawkaBinding().scanVideoOptimizer(options) as Promise<VideoOptimizerScanResult>
export const createVideoOptimizerCandidate = (options: VideoOptimizerCandidateOptions): Promise<VideoOptimizerCandidate> =>
  loadCzkawkaBinding().createVideoOptimizerCandidate(options) as Promise<VideoOptimizerCandidate>
export const scanMediaFiles = (options: MediaScanOptions): Promise<MediaScanResult> =>
  loadCzkawkaBinding().scanMediaFiles(options) as Promise<MediaScanResult>
export const cancelCzkawkaScan = (scanId: string): boolean => loadCzkawkaBinding().cancelCzkawkaScan?.(scanId) ?? false
export const getCzkawkaScanProgress = (scanId: string): CzkawkaScanProgress | undefined => loadCzkawkaBinding().getCzkawkaScanProgress?.(scanId) ?? undefined

export {
  assertCzkawkaCompatibility,
  checkCzkawkaCompatibility,
  type CzkawkaBindingRequirement,
  type CzkawkaCompatibilityResult,
} from "./compatibility.js"
