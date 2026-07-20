import { dirname } from "node:path"

import type { ViewSource } from "../../domain/book/book.js"
import type { ReaderDirectoryEntry, ReaderDirectoryListingProvider } from "../../ports/ReaderDirectoryListingProvider.js"
import type { ReaderDirectoryMetadataProvider } from "../../ports/ReaderDirectoryMetadataProvider.js"
import type { ReaderFolderPenetrationPolicy, ReaderFolderPenetrationResolver } from "../browser/ReaderFolderPenetrationResolver.js"
import {
  DEFAULT_READER_DIRECTORY_SORT,
  readerDirectoryMetadataFields,
  sortReaderDirectoryEntries,
  type ReaderDirectorySortRule,
} from "../browser/ReaderDirectorySort.js"
import { readerPathIdentity, type ReaderAdjacentBookDirection, type ReaderBookCandidatePredicate } from "./ReaderAdjacentBookService.js"

const HARD_MAXIMUM_TRAVERSAL_DEPTH = 32

export interface ReaderBookTraversalFrame {
  directoryPath: string
  currentEntryPath: string
}

export interface ReaderBookTraversalCursor {
  rootPath: string
  frames: readonly ReaderBookTraversalFrame[]
}

export interface ReaderHierarchicalBookCandidate {
  path: string
  name: string
  cursor: ReaderBookTraversalCursor
}

export interface ReaderHierarchicalBookTraversalRequest {
  source: ViewSource
  direction: ReaderAdjacentBookDirection
  cursor?: ReaderBookTraversalCursor
  sort?: ReaderDirectorySortRule
  penetration?: ReaderFolderPenetrationPolicy
  randomSeed?: string
}

export class ReaderBookTraversalBlockedError extends Error {
  constructor(
    readonly path: string,
    readonly reason: "permission" | "cycle",
  ) {
    super(`Reader book traversal stopped at ${path}: ${reason}`)
    this.name = "ReaderBookTraversalBlockedError"
  }
}

/** Traverses readable targets without treating non-penetrable directories as failures. */
export class ReaderHierarchicalBookTraversal {
  constructor(
    private readonly listingProvider: ReaderDirectoryListingProvider,
    private readonly metadataProvider: ReaderDirectoryMetadataProvider | undefined,
    private readonly isBookCandidate: ReaderBookCandidatePredicate,
    private readonly penetrationResolver: ReaderFolderPenetrationResolver,
    private readonly pathIdentity = readerPathIdentity,
  ) {}

  async resolve(
    request: ReaderHierarchicalBookTraversalRequest,
    signal?: AbortSignal,
  ): Promise<ReaderHierarchicalBookCandidate | undefined> {
    signal?.throwIfAborted()
    if (request.source.kind === "image") return undefined
    const sort = request.sort ?? DEFAULT_READER_DIRECTORY_SORT
    const cursor = normalizeCursor(request.cursor, request.source.path)
    const frames = cursor.frames.map((frame) => ({ ...frame }))
    const visited = new Set<string>()

    for (let frameIndex = frames.length - 1; frameIndex >= 0; frameIndex -= 1) {
      signal?.throwIfAborted()
      const frame = frames[frameIndex]!
      const entries = await this.#entries(frame.directoryPath, sort, request.randomSeed, signal)
      const currentIndex = entries.findIndex((entry) => this.pathIdentity(entry.path) === this.pathIdentity(frame.currentEntryPath))
      const start = request.direction === "next"
        ? (currentIndex < 0 ? 0 : currentIndex + 1)
        : (currentIndex < 0 ? entries.length - 1 : currentIndex - 1)
      const parentFrames = frames.slice(0, frameIndex)
      const candidate = await this.#scan(
        entries,
        start,
        request.direction,
        parentFrames,
        frame.directoryPath,
        cursor.rootPath,
        sort,
        request.penetration,
        request.randomSeed,
        visited,
        frameIndex,
        signal,
      )
      if (candidate) return candidate
    }
    return undefined
  }

  async #scan(
    entries: readonly ReaderDirectoryEntry[],
    start: number,
    direction: ReaderAdjacentBookDirection,
    parentFrames: readonly ReaderBookTraversalFrame[],
    directoryPath: string,
    rootPath: string,
    sort: ReaderDirectorySortRule,
    penetration: ReaderFolderPenetrationPolicy | undefined,
    randomSeed: string | undefined,
    visited: Set<string>,
    depth: number,
    signal?: AbortSignal,
  ): Promise<ReaderHierarchicalBookCandidate | undefined> {
    const step = direction === "next" ? 1 : -1
    for (let index = start; index >= 0 && index < entries.length; index += step) {
      signal?.throwIfAborted()
      const entry = entries[index]!
      const frame = { directoryPath, currentEntryPath: entry.path }
      const candidateFrames = [...parentFrames, frame]
      if (entry.kind !== "directory") {
        if (entry.kind === "file" && this.isBookCandidate(entry)) {
          return { path: entry.path, name: entry.name, cursor: { rootPath, frames: candidateFrames } }
        }
        continue
      }

      const resolution = await this.penetrationResolver.resolve(entry.path, penetration, signal)
      if (resolution.status === "resolved" && resolution.terminal) {
        return { path: resolution.terminal.path, name: entry.name, cursor: { rootPath, frames: candidateFrames } }
      }
      if (resolution.status === "empty") continue
      if (resolution.status === "blocked" && (resolution.reason === "permission" || resolution.reason === "cycle")) {
        throw new ReaderBookTraversalBlockedError(entry.path, resolution.reason)
      }
      if (depth >= HARD_MAXIMUM_TRAVERSAL_DEPTH) throw new ReaderBookTraversalBlockedError(entry.path, "cycle")

      const canonicalPath = this.pathIdentity(
        this.listingProvider.canonicalize
          ? await this.listingProvider.canonicalize(entry.path, signal)
          : entry.path,
      )
      if (visited.has(canonicalPath)) throw new ReaderBookTraversalBlockedError(entry.path, "cycle")
      visited.add(canonicalPath)
      try {
        const nested = await this.#entries(entry.path, sort, randomSeed, signal)
        const nestedStart = direction === "next" ? 0 : nested.length - 1
        const candidate = await this.#scan(
          nested,
          nestedStart,
          direction,
          candidateFrames,
          entry.path,
          rootPath,
          sort,
          penetration,
          randomSeed,
          visited,
          depth + 1,
          signal,
        )
        if (candidate) return candidate
      } finally {
        visited.delete(canonicalPath)
      }
    }
    return undefined
  }

  async #entries(
    path: string,
    sort: ReaderDirectorySortRule,
    randomSeed: string | undefined,
    signal?: AbortSignal,
  ): Promise<readonly ReaderDirectoryEntry[]> {
    const listing = await this.listingProvider.read(path, signal)
    signal?.throwIfAborted()
    let entries = listing.entries
    const requestedFields = readerDirectoryMetadataFields(sort.field)
    if (requestedFields.size && this.metadataProvider) {
      const supported = new Set([...requestedFields].filter((field) => this.metadataProvider!.supportedFields.has(field)))
      if (supported.size) entries = await this.metadataProvider.hydrate(entries, supported, signal)
    }
    signal?.throwIfAborted()
    return sortReaderDirectoryEntries(entries, sort, randomSeed ?? listing.path)
  }
}

function normalizeCursor(cursor: ReaderBookTraversalCursor | undefined, sourcePath: string): ReaderBookTraversalCursor {
  if (cursor?.frames.length) {
    return {
      rootPath: cursor.rootPath,
      frames: cursor.frames.map((frame) => ({ ...frame })),
    }
  }
  const rootPath = dirname(sourcePath)
  return { rootPath, frames: [{ directoryPath: rootPath, currentEntryPath: sourcePath }] }
}
