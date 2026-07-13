import { createRequire } from "node:module"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export interface NativeCoreInfo {
  apiVersion: number
  czkawkaVersion: string
  arcthumbVersion: string
  archiveFormats: string[]
}

export interface ArchiveThumbnailOptions {
  path: string
  maxDimension?: number
  format?: "png" | "jpeg" | "jpg" | "webp"
  quality?: number
  sortOrder?: "natural" | "alphabetical"
  coverMode?: "ignore" | "prefer" | "only"
}

export interface ArchiveThumbnail {
  data: Buffer
  width: number
  height: number
  sourceName: string
  contentKind: string
  mimeType: string
}

export interface DuplicateScanOptions {
  includedDirectories: string[]
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
}

export interface DuplicateScanResult {
  groups: Array<{ files: DuplicateFile[] }>
  messages: string
  stopped: boolean
}

interface NativeBinding {
  getCoreInfo(): NativeCoreInfo
  createArchiveThumbnail(options: ArchiveThumbnailOptions): Promise<ArchiveThumbnail>
  scanDuplicateFiles(options: DuplicateScanOptions): Promise<DuplicateScanResult>
}

let cachedBinding: NativeBinding | undefined

export function loadNativeBinding(): NativeBinding {
  if (cachedBinding) return cachedBinding
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
  const override = process.env.XIRANITE_IMAGE_NATIVE_PATH
  const bindingPath = override ?? join(packageRoot, "native", `xiranite-image-native.${process.platform}-${process.arch}.node`)
  if (!existsSync(bindingPath)) {
    throw new Error(`Xiranite image native binding not found at ${bindingPath}. Run \"bun --cwd packages/image-native run build:native\" first.`)
  }
  cachedBinding = createRequire(import.meta.url)(bindingPath) as NativeBinding
  return cachedBinding
}

export const getCoreInfo = (): NativeCoreInfo => loadNativeBinding().getCoreInfo()
export const createArchiveThumbnail = (options: ArchiveThumbnailOptions): Promise<ArchiveThumbnail> =>
  loadNativeBinding().createArchiveThumbnail(options)
export const scanDuplicateFiles = (options: DuplicateScanOptions): Promise<DuplicateScanResult> =>
  loadNativeBinding().scanDuplicateFiles(options)
