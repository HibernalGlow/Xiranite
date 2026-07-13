import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export interface CzkawkaInfo {
  apiVersion: number
  sourceVersion: string
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

export interface CzkawkaBinding {
  getCzkawkaInfo(): CzkawkaInfo
  scanDuplicateFiles(options: DuplicateScanOptions): Promise<DuplicateScanResult>
}

let cachedBinding: CzkawkaBinding | undefined

export function loadCzkawkaBinding(): CzkawkaBinding {
  if (cachedBinding) return cachedBinding
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
  const override = process.env.XIRANITE_CZKAWKA_NATIVE_PATH
  const bindingPath = override ?? join(packageRoot, "native", `xiranite-czkawka.${process.platform}-${process.arch}.node`)
  if (!existsSync(bindingPath)) {
    throw new Error(`Xiranite Czkawka native binding not found at ${bindingPath}. Run "bun run --cwd packages/czkawka-native build:native" first.`)
  }
  cachedBinding = createRequire(import.meta.url)(bindingPath) as CzkawkaBinding
  return cachedBinding
}

export const getCzkawkaInfo = (): CzkawkaInfo => loadCzkawkaBinding().getCzkawkaInfo()
export const scanDuplicateFiles = (options: DuplicateScanOptions): Promise<DuplicateScanResult> =>
  loadCzkawkaBinding().scanDuplicateFiles(options)
