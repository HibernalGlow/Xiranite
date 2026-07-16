import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export interface ArcThumbInfo {
  apiVersion: number
  sourceVersion: string
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

export interface SystemThumbnailOptions {
  path: string
  maxDimension?: number
}

export interface WicImageThumbnailOptions {
  data: Uint8Array
  maxDimension?: number
}

export interface SystemThumbnail {
  rgba: Buffer
  width: number
  height: number
  premultiplied: boolean
}

export interface WindowsVolumeRoot {
  path: string
  label?: string
  driveType: "fixed" | "removable" | "network" | "optical" | "ramdisk" | "unavailable" | "unknown"
  available: boolean
}

export interface ArcThumbBinding {
  getArcThumbInfo(): ArcThumbInfo
  createArchiveThumbnail(options: ArchiveThumbnailOptions): Promise<ArchiveThumbnail>
  getCachedSystemThumbnail(options: SystemThumbnailOptions): Promise<SystemThumbnail | undefined>
  createWicImageThumbnail(options: WicImageThumbnailOptions): Promise<SystemThumbnail>
  listWindowsVolumeRoots(): Promise<WindowsVolumeRoot[]>
}

let cachedBinding: ArcThumbBinding | undefined

export function loadArcThumbBinding(): ArcThumbBinding {
  if (cachedBinding) return cachedBinding
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
  const override = process.env.XIRANITE_ARCTHUMB_NATIVE_PATH
  const bindingPath = override ?? join(packageRoot, "native", `xiranite-arcthumb.${process.platform}-${process.arch}.node`)
  if (!existsSync(bindingPath)) {
    throw new Error(`Xiranite ArcThumb native binding not found at ${bindingPath}. Run "bun run --cwd packages/arcthumb-native build:native" first.`)
  }
  cachedBinding = createRequire(import.meta.url)(bindingPath) as ArcThumbBinding
  return cachedBinding
}

export const getArcThumbInfo = (): ArcThumbInfo => loadArcThumbBinding().getArcThumbInfo()
export const createArchiveThumbnail = (options: ArchiveThumbnailOptions): Promise<ArchiveThumbnail> =>
  loadArcThumbBinding().createArchiveThumbnail(options)
export const getCachedSystemThumbnail = (options: SystemThumbnailOptions): Promise<SystemThumbnail | undefined> =>
  loadArcThumbBinding().getCachedSystemThumbnail(options)
export const createWicImageThumbnail = (options: WicImageThumbnailOptions): Promise<SystemThumbnail> =>
  loadArcThumbBinding().createWicImageThumbnail(options)
export const listWindowsVolumeRoots = (): Promise<WindowsVolumeRoot[]> => loadArcThumbBinding().listWindowsVolumeRoots()
