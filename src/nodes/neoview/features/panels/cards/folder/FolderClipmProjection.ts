import { CLIPM_FILENAME_SUFFIX_PATTERN } from "@xiranite/node-clipm/filename"

import type { ReaderDirectoryEntryDto } from "../../../../adapters/reader-http-client"

const LEGACY_CM_SUFFIX_PATTERN = /\s*\[CM-v\d+-[PN]-S\d{4}\]$/u

export function projectFolderClipmEntry(
  entry: ReaderDirectoryEntryDto,
  destinationPath: string,
): ReaderDirectoryEntryDto {
  return { ...entry, path: destinationPath, name: folderClipmPathName(destinationPath) }
}

export function predictFolderClipmPath(
  entry: Pick<ReaderDirectoryEntryDto, "kind" | "path">,
  rating: { bundleVersion: number; label: "P" | "N"; score: number; shortCode: string },
): string {
  const separatorIndex = Math.max(entry.path.lastIndexOf("/"), entry.path.lastIndexOf("\\"))
  const directory = entry.path.slice(0, separatorIndex + 1)
  const filename = entry.path.slice(separatorIndex + 1)
  const extensionIndex = entry.kind === "file" ? filename.lastIndexOf(".") : -1
  const extension = extensionIndex > 0 ? filename.slice(extensionIndex) : ""
  const stem = (extension ? filename.slice(0, extensionIndex) : filename)
    .replace(CLIPM_FILENAME_SUFFIX_PATTERN, "")
    .replace(LEGACY_CM_SUFFIX_PATTERN, "")
    .trimEnd()
  const score = Math.min(1000, Math.max(0, Math.round(rating.score))).toString().padStart(4, "0")
  return `${directory}${stem} [CM${rating.bundleVersion}${rating.label}${score}-${rating.shortCode}]${extension}`
}

export function folderClipmPathName(path: string): string {
  const normalized = path.replace(/[\\/]+$/u, "")
  return normalized.split(/[\\/]/u).at(-1) || normalized || path
}
