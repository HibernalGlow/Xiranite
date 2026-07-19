import pMap from "p-map"

import type { ReaderLibraryService } from "./ReaderLibraryService.js"
import type { ReaderPathStatusProvider } from "../../ports/ReaderPathStatusProvider.js"

export type ReaderLibraryCleanupKind = "recents" | "bookmarks" | "both"

export interface ReaderLibraryCleanupRequest {
  kind?: ReaderLibraryCleanupKind
  scanLimit?: number
  deleteLimit?: number
  concurrency?: number
  signal?: AbortSignal
}

export interface ReaderLibraryCleanupResult {
  kind: ReaderLibraryCleanupKind
  scanned: number
  missing: number
  unknown: number
  deleted: number
  truncated: boolean
}

export class ReaderLibraryCleanupService {
  constructor(
    private readonly library: ReaderLibraryService,
    private readonly pathStatus: ReaderPathStatusProvider,
  ) {}

  async cleanupInvalid(request: ReaderLibraryCleanupRequest = {}): Promise<ReaderLibraryCleanupResult> {
    const kind = request.kind ?? "both"
    if (kind !== "recents" && kind !== "bookmarks" && kind !== "both") throw new Error("Reader library cleanup kind is invalid.")
    const scanLimit = bounded(request.scanLimit, 1, 500, 500, "scanLimit")
    const deleteLimit = bounded(request.deleteLimit, 1, 500, 500, "deleteLimit")
    const concurrency = bounded(request.concurrency, 1, 16, 8, "concurrency")
    request.signal?.throwIfAborted()
    const candidates: Array<{ type: "recent" | "bookmark"; id: string; path: string }> = []
    if (kind === "recents" || kind === "both") {
      for (const item of await this.library.listRecent({ limit: scanLimit, offset: 0 })) {
        candidates.push({ type: "recent", id: item.bookId, path: item.source.path })
      }
      request.signal?.throwIfAborted()
    }
    if (kind === "bookmarks" || kind === "both") {
      for (const item of await this.library.listBookmarks({ limit: scanLimit, offset: 0 })) {
        candidates.push({ type: "bookmark", id: item.id, path: item.source.path })
      }
      request.signal?.throwIfAborted()
    }
    const checked = await pMap(candidates, async (candidate) => {
      request.signal?.throwIfAborted()
      const status = await this.pathStatus.check(candidate.path, request.signal)
      request.signal?.throwIfAborted()
      return { candidate, status }
    }, { concurrency, stopOnError: true })
    request.signal?.throwIfAborted()
    const invalid = checked.filter((item) => item.status === "missing")
    let deleted = 0
    for (const item of invalid.slice(0, deleteLimit)) {
      request.signal?.throwIfAborted()
      const removed = item.candidate.type === "recent"
        ? await this.library.removeRecent(item.candidate.id, request.signal)
        : await this.library.removeBookmark(item.candidate.id, request.signal)
      request.signal?.throwIfAborted()
      if (removed) deleted += 1
    }
    request.signal?.throwIfAborted()
    return {
      kind,
      scanned: checked.length,
      missing: invalid.length,
      unknown: checked.filter((item) => item.status === "unknown").length,
      deleted,
      truncated: invalid.length > deleteLimit,
    }
  }
}

function bounded(value: number | undefined, minimum: number, maximum: number, fallback: number, name: string): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new Error(`Reader library cleanup ${name} must be from ${minimum} to ${maximum}.`)
  }
  return result
}
