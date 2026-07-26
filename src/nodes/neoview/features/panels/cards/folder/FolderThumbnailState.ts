import { type ReaderDirectoryEntryDto } from "../../../../adapters/reader-http-client"
import { type FolderViewMode, type FolderPreviewCount } from "./FolderBrowserState"

export function mergeThumbnailUrls(
  current: ReadonlyMap<string, string>,
  additions: readonly (readonly [string, string])[],
  maximum: number,
): ReadonlyMap<string, string> {
  if (!additions.length) return current
  const next = new Map(current)
  for (const [path, url] of additions) {
    next.delete(path)
    next.set(path, url)
  }
  while (next.size > maximum) next.delete(next.keys().next().value as string)
  return next
}
export function mergeThumbnailUrlSets(
  current: ReadonlyMap<string, readonly string[]>,
  additions: readonly (readonly [string, readonly string[]])[],
  maximum: number,
): ReadonlyMap<string, readonly string[]> {
  if (!additions.length) return current
  const next = new Map(current)
  for (const [path, urls] of additions) {
    next.delete(path)
    next.set(path, urls)
  }
  while (next.size > maximum) next.delete(next.keys().next().value as string)
  return next
}
export function thumbnailProfile(
  entry: Pick<ReaderDirectoryEntryDto, "kind">,
  _viewMode: FolderViewMode,
  previewCount: FolderPreviewCount,
  previewGridEnabled = false,
): string {
  return entry.kind === "directory" && previewGridEnabled ? `folder:${previewCount}` : `${entry.kind}:1`
}

/**
 * Reuse a restored file thumbnail even when it predates the profile sidecar.
 * Folder mosaic thumbnails remain profile-sensitive because preview count and
 * layout change their asset contents. Multi-tile profiles also require a urlSet
 * entry so single-cover visit cache is not mistaken for a finished mosaic.
 */
export function isThumbnailDemandNeeded(
  entry: Pick<ReaderDirectoryEntryDto, "kind" | "path">,
  viewMode: FolderViewMode,
  previewCount: FolderPreviewCount,
  profiles: ReadonlyMap<string, string>,
  urls: ReadonlyMap<string, string>,
  previewGridEnabled = false,
  urlSets?: ReadonlyMap<string, readonly string[]>,
): boolean {
  const expected = thumbnailProfile(entry, viewMode, previewCount, previewGridEnabled)
  const current = profiles.get(entry.path)
  if (current === expected) {
    if (entry.kind === "directory" && previewGridEnabled && previewCount > 1) {
      return !urlSets?.has(entry.path)
    }
    return false
  }
  return !(entry.kind === "file" && current === undefined && urls.has(entry.path))
}
