import { createHash, randomBytes } from "node:crypto"

import type { ReaderPage } from "../../domain/page/page.js"
import { compareNaturalPath } from "../../domain/sorting/natural-sort.js"

export const READER_PAGE_SORT_MODES = [
  "fileName",
  "fileNameDescending",
  "fileSize",
  "fileSizeDescending",
  "timeStamp",
  "timeStampDescending",
  "entry",
  "entryDescending",
  "random",
] as const

export const READER_MEDIA_PRIORITY_MODES = ["none", "videoFirst", "imageFirst"] as const

export type ReaderPageSortMode = typeof READER_PAGE_SORT_MODES[number]
export type ReaderMediaPriorityMode = typeof READER_MEDIA_PRIORITY_MODES[number]

export interface ReaderPageOrder {
  sortMode: ReaderPageSortMode
  mediaPriority: ReaderMediaPriorityMode
  randomSeed?: string
}

export type ReaderPageOrderPatch = Partial<ReaderPageOrder>

export const DEFAULT_READER_PAGE_ORDER: ReaderPageOrder = {
  sortMode: "fileName",
  mediaPriority: "none",
}

export function normalizeReaderPageOrder(
  patch: ReaderPageOrderPatch = {},
  current: ReaderPageOrder = DEFAULT_READER_PAGE_ORDER,
): ReaderPageOrder {
  const sortMode = patch.sortMode ?? current.sortMode
  const mediaPriority = patch.mediaPriority ?? current.mediaPriority
  if (!READER_PAGE_SORT_MODES.includes(sortMode)) throw new TypeError(`Invalid reader page sort mode: ${sortMode}`)
  if (!READER_MEDIA_PRIORITY_MODES.includes(mediaPriority)) throw new TypeError(`Invalid reader media priority mode: ${mediaPriority}`)
  const requestedSeed = patch.randomSeed ?? (sortMode === "random" ? current.randomSeed : undefined)
  if (requestedSeed !== undefined && (!requestedSeed.length || requestedSeed.length > 128)) {
    throw new RangeError("Reader random sort seed must contain from 1 to 128 characters.")
  }
  return {
    sortMode,
    mediaPriority,
    ...(sortMode === "random" ? { randomSeed: requestedSeed ?? randomBytes(16).toString("hex") } : {}),
  }
}

/**
 * Builds one shallow permutation of the existing page references. Page content,
 * media DTOs and decode state remain owned by the ReaderBook.
 */
export function orderReaderPages(pages: readonly ReaderPage[], order: ReaderPageOrder): readonly ReaderPage[] {
  const output = [...pages]
  const compare = pageComparator(order.sortMode, output, order.randomSeed)
  output.sort((left, right) => mediaPriority(left, right, order.mediaPriority) || compare(left, right))
  return output
}

function pageComparator(
  mode: ReaderPageSortMode,
  pages: readonly ReaderPage[],
  randomSeed?: string,
): (left: ReaderPage, right: ReaderPage) => number {
  if (mode === "random") {
    const ranks = new Map(pages.map((page) => [page.id, randomRank(randomSeed!, page.id)]))
    return (left, right) => ranks.get(left.id)!.localeCompare(ranks.get(right.id)!) || entryAscending(left, right)
  }
  const descending = mode.endsWith("Descending")
  const ascending = mode.startsWith("fileName")
    ? nameAscending
    : mode.startsWith("fileSize")
      ? sizeAscending
      : mode.startsWith("timeStamp")
        ? timestampAscending
        : entryAscending
  return descending ? (left, right) => ascending(right, left) : ascending
}

function nameAscending(left: ReaderPage, right: ReaderPage): number {
  return compareNaturalPath(left.name, right.name) || left.index - right.index
}

function sizeAscending(left: ReaderPage, right: ReaderPage): number {
  return (left.byteLength ?? 0) - (right.byteLength ?? 0) || nameAscending(left, right)
}

function timestampAscending(left: ReaderPage, right: ReaderPage): number {
  return (left.timestamps?.modifiedAtMs ?? Number.NEGATIVE_INFINITY)
    - (right.timestamps?.modifiedAtMs ?? Number.NEGATIVE_INFINITY)
    || nameAscending(left, right)
}

function entryAscending(left: ReaderPage, right: ReaderPage): number {
  return left.index - right.index || compareNaturalPath(left.name, right.name)
}

function mediaPriority(left: ReaderPage, right: ReaderPage, mode: ReaderMediaPriorityMode): number {
  if (mode === "none") return 0
  const leftVideo = left.mediaKind === "video"
  const rightVideo = right.mediaKind === "video"
  if (leftVideo === rightVideo) return 0
  return mode === "videoFirst" ? (leftVideo ? -1 : 1) : (leftVideo ? 1 : -1)
}

function randomRank(seed: string, pageId: string): string {
  return createHash("sha256").update(seed).update("\0").update(pageId).digest("hex")
}
