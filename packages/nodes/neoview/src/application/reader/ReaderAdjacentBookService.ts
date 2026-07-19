import { dirname } from "node:path"

import type { ViewSource } from "../../domain/book/book.js"
import type { ReaderDirectoryEntry, ReaderDirectoryListingProvider } from "../../ports/ReaderDirectoryListingProvider.js"
import type { ReaderDirectoryMetadataProvider } from "../../ports/ReaderDirectoryMetadataProvider.js"
import {
  DEFAULT_READER_DIRECTORY_SORT,
  readerDirectoryMetadataFields,
  sortReaderDirectoryEntries,
  type ReaderDirectorySortRule,
} from "../browser/ReaderDirectorySort.js"

export type ReaderAdjacentBookDirection = "next" | "previous"

export interface ReaderAdjacentBookCandidate {
  path: string
  name: string
  index: number
  total: number
}

export interface ReaderAdjacentBookRequest {
  source: ViewSource
  direction: ReaderAdjacentBookDirection
  sort?: ReaderDirectorySortRule
  randomSeed?: string
}

export type ReaderBookCandidatePredicate = (entry: ReaderDirectoryEntry) => boolean
export type ReaderPathIdentity = (path: string) => string

export function readerPathIdentity(path: string, platform: NodeJS.Platform = process.platform): string {
  const normalized = path.replaceAll("\\", "/")
  return platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized
}

/** Resolves sibling books without coupling Reader navigation to a GUI browser cache. */
export class ReaderAdjacentBookService {
  constructor(
    private readonly listingProvider: ReaderDirectoryListingProvider,
    private readonly metadataProvider: ReaderDirectoryMetadataProvider | undefined,
    private readonly isBookCandidate: ReaderBookCandidatePredicate,
    private readonly pathIdentity: ReaderPathIdentity = readerPathIdentity,
  ) {}

  async resolve(request: ReaderAdjacentBookRequest, signal?: AbortSignal): Promise<ReaderAdjacentBookCandidate | undefined> {
    signal?.throwIfAborted()
    if (request.source.kind === "image") return undefined
    const sort = request.sort ?? DEFAULT_READER_DIRECTORY_SORT
    const listing = await this.listingProvider.read(dirname(request.source.path), signal)
    signal?.throwIfAborted()
    let candidates = listing.entries.filter(this.isBookCandidate)
    const requestedFields = readerDirectoryMetadataFields(sort.field)
    if (requestedFields.size && this.metadataProvider) {
      const supported = new Set([...requestedFields].filter((field) => this.metadataProvider!.supportedFields.has(field)))
      if (supported.size) candidates = [...await this.metadataProvider.hydrate(candidates, supported, signal)]
    }
    signal?.throwIfAborted()
    const sorted = sortReaderDirectoryEntries(candidates, sort, request.randomSeed)
    if (!sorted.length) return undefined
    const currentIdentity = this.pathIdentity(request.source.path)
    let currentIndex = sorted.findIndex((entry) => this.pathIdentity(entry.path) === currentIdentity)
    if (currentIndex < 0) currentIndex = request.direction === "next" ? -1 : sorted.length
    const targetIndex = request.direction === "next" ? currentIndex + 1 : currentIndex - 1
    const target = sorted[targetIndex]
    return target ? { path: target.path, name: target.name, index: targetIndex, total: sorted.length } : undefined
  }
}
