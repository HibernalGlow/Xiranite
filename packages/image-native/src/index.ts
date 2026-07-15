import {
  createArchiveThumbnail,
  createWicImageThumbnail,
  getCachedSystemThumbnail,
  getArcThumbInfo,
  loadArcThumbBinding,
} from "@xiranite/arcthumb-native"
import {
  getCzkawkaInfo,
  loadCzkawkaBinding,
  scanDuplicateFiles,
} from "@xiranite/czkawka-native"

export type {
  ArchiveThumbnail,
  ArchiveThumbnailOptions,
  ArcThumbBinding,
  ArcThumbInfo,
  SystemThumbnail,
  SystemThumbnailOptions,
  WicImageThumbnailOptions,
} from "@xiranite/arcthumb-native"
export type {
  CzkawkaBinding,
  CzkawkaInfo,
  DuplicateFile,
  DuplicateScanOptions,
  DuplicateScanResult,
} from "@xiranite/czkawka-native"
export {
  createArchiveThumbnail,
  createWicImageThumbnail,
  getCachedSystemThumbnail,
  getArcThumbInfo,
  getCzkawkaInfo,
  loadArcThumbBinding,
  loadCzkawkaBinding,
  scanDuplicateFiles,
}

export interface NativeCoreInfo {
  apiVersion: number
  czkawkaVersion: string
  arcthumbVersion: string
  archiveFormats: string[]
}

/** @deprecated Load the ArcThumb or Czkawka binding directly instead. */
export function loadNativeBinding() {
  return {
    getCoreInfo,
    createArchiveThumbnail,
    scanDuplicateFiles,
  }
}

/** @deprecated Use getArcThumbInfo() and getCzkawkaInfo() for independent versioning. */
export function getCoreInfo(): NativeCoreInfo {
  const arcthumb = getArcThumbInfo()
  const czkawka = getCzkawkaInfo()
  return {
    apiVersion: Math.max(arcthumb.apiVersion, czkawka.apiVersion),
    czkawkaVersion: czkawka.sourceVersion,
    arcthumbVersion: arcthumb.sourceVersion,
    archiveFormats: arcthumb.archiveFormats,
  }
}
