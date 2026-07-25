import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { prependNativeLibraryPath, resolveNativeBindingPath } from "@xiranite/native-loader"

export type SlimgFormat = "jpeg" | "jpg" | "png" | "webp" | "avif" | "jxl" | "qoi"

export interface SlimgInfo {
  apiVersion: number
  bindingVersion: string
  formats: string[]
}

export interface SlimgBatchFile {
  sourcePath: string
  outputPath: string
}

export interface SlimgBatchOptions {
  files: SlimgBatchFile[]
  format: SlimgFormat
  quality?: number
  jobs?: number
  overwrite?: boolean
  batchId?: string
}

export interface SlimgBatchFileResult {
  sourcePath: string
  outputPath: string
  success: boolean
  cancelled: boolean
  error?: string
  originalSize: number
  outputSize: number
  width?: number
  height?: number
  durationMs: number
}

export interface SlimgBatchResult {
  files: SlimgBatchFileResult[]
  total: number
  succeeded: number
  failed: number
  cancelled: number
  durationMs: number
}

export interface SlimgBatchProgress {
  total: number
  completed: number
  succeeded: number
  failed: number
  cancelled: number
}

export interface SlimgBinding {
  getSlimgInfo(): SlimgInfo
  convertBatch(options: SlimgBatchOptions): Promise<SlimgBatchResult>
  cancelSlimgBatch(batchId: string): boolean
  getSlimgBatchProgress(batchId: string): SlimgBatchProgress | undefined
}

let cachedBinding: SlimgBinding | undefined

export function loadSlimgBinding(): SlimgBinding {
  if (cachedBinding) return cachedBinding
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
  const bindingPath = resolveNativeBindingPath({
    id: "slimg",
    filename: `xiranite-slimg.${process.platform}-${process.arch}.node`,
    overrideEnv: "XIRANITE_SLIMG_NATIVE_PATH",
    workspaceRoot: resolve(packageRoot, "..", ".."),
  })
  if (!existsSync(bindingPath)) {
    throw new Error(`Xiranite slimg native binding not found at ${bindingPath}. Run "bun run --cwd packages/slimg-native build:native" first.`)
  }
  prependNativeLibraryPath(bindingPath)
  cachedBinding = createRequire(import.meta.url)(bindingPath) as SlimgBinding
  return cachedBinding
}

export const getSlimgInfo = (): SlimgInfo => loadSlimgBinding().getSlimgInfo()
export const convertBatch = (options: SlimgBatchOptions): Promise<SlimgBatchResult> =>
  loadSlimgBinding().convertBatch(options)
export const cancelSlimgBatch = (batchId: string): boolean => loadSlimgBinding().cancelSlimgBatch(batchId)
export const getSlimgBatchProgress = (batchId: string): SlimgBatchProgress | undefined =>
  loadSlimgBinding().getSlimgBatchProgress(batchId)
