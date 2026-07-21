import { readdir, stat } from "node:fs/promises"
import { basename, join } from "node:path"

import { pageMediaType, type ReaderMediaTypeResolver } from "../../domain/page/media.js"
import { compareNaturalPath } from "../../domain/sorting/natural-sort.js"
import type { ResourcePriority, ResourceScheduler } from "../../ports/ResourceScheduler.js"
import type {
  ReaderFolderRepresentativeManifest,
  ReaderThumbnailStore,
} from "../../ports/ReaderThumbnailStore.js"

interface DirectoryEntryLike {
  name: string
  isFile(): boolean
  isDirectory(): boolean
}

interface FileStatsLike {
  size: number
  mtimeMs: number
  isFile(): boolean
  isDirectory(): boolean
}

export interface FolderRepresentativeIndexOptions {
  maxEntries?: number
  readDirectory?: (path: string) => Promise<readonly DirectoryEntryLike[]>
  statPath?: (path: string) => Promise<FileStatsLike>
  mediaFormats?: ReaderMediaTypeResolver
  resourceScheduler?: ResourceScheduler
  manifestStore?: Pick<ReaderThumbnailStore, "getFolderRepresentativeManifest" | "putFolderRepresentativeManifest">
}

interface RepresentativeEntry {
  directoryModifiedAtMs: number
  sources?: readonly RepresentativeSource[]
  version?: string
}

interface RepresentativeSource { name: string; size: number; modifiedAtMs: number }

interface RepresentativeFlight {
  controller: AbortController
  promise: Promise<RepresentativeEntry>
  waiters: number
  settled: boolean
}

const DEFAULT_MAX_ENTRIES = 2_048
const MAX_SCAN_DIRECTORIES = 96
const MAX_ENTRIES_PER_DIRECTORY = 768
const MAX_SCAN_DEPTH = 8
const SCAN_BUDGET_MS = 120
const REPRESENTATIVE_SELECTION_REVISION_BASE = 9_000_000_000_000_000
const REPRESENTATIVE_SELECTION_REVISION = 3
const READER_CONTAINER_EXTENSIONS = new Set(["zip", "cbz", "rar", "cbr", "7z", "cb7", "pdf"])
const POSTER_STEMS = new Set(["cover", "default", "folder", "front", "poster", "series", "thumb", "thumbnail"])

export interface FolderRepresentativeSelection {
  version?: string
  paths: readonly string[]
}

export class FolderRepresentativeIndex {
  readonly #maxEntries: number
  readonly #readDirectory: (path: string) => Promise<readonly DirectoryEntryLike[]>
  readonly #statPath: (path: string) => Promise<FileStatsLike>
  readonly #cache = new Map<string, RepresentativeEntry>()
  readonly #flights = new Map<string, RepresentativeFlight>()
  readonly #revisions = new Map<string, number>()
  readonly #mediaFormats?: ReaderMediaTypeResolver
  readonly #resourceScheduler?: ResourceScheduler
  readonly #manifestStore?: FolderRepresentativeIndexOptions["manifestStore"]

  constructor(options: FolderRepresentativeIndexOptions = {}) {
    this.#maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    if (!Number.isSafeInteger(this.#maxEntries) || this.#maxEntries < 1 || this.#maxEntries > 100_000) {
      throw new RangeError("Folder representative maxEntries must be an integer from 1 to 100000.")
    }
    this.#readDirectory = options.readDirectory ?? defaultReadDirectory
    this.#statPath = options.statPath ?? stat
    this.#mediaFormats = options.mediaFormats
    this.#resourceScheduler = options.resourceScheduler
    this.#manifestStore = options.manifestStore
  }

  describe(
    path: string,
    directoryModifiedAtMs: number,
    signal?: AbortSignal,
    count = 1,
    priority: ResourcePriority = "view",
  ): Promise<string | undefined> {
    return this.resolve(path, directoryModifiedAtMs, signal, count, priority).then((selection) => selection.version)
  }

  async resolve(
    path: string,
    directoryModifiedAtMs: number,
    signal?: AbortSignal,
    count = 1,
    priority: ResourcePriority = "view",
  ): Promise<FolderRepresentativeSelection> {
    if (!path) return Promise.reject(new Error("Folder representative path cannot be empty."))
    if (!Number.isSafeInteger(directoryModifiedAtMs) || directoryModifiedAtMs < 0) {
      return Promise.reject(new RangeError("Folder representative directory mtime must be a non-negative integer."))
    }
    if (!Number.isSafeInteger(count) || count < 1 || count > 16) {
      return Promise.reject(new RangeError("Folder representative count must be an integer from 1 to 16."))
    }
    signal?.throwIfAborted()
    const selectionRevision = representativeSelectionRevision(this.#mediaFormats?.revision)
    const cacheKey = `${path}\0${count}\0${selectionRevision}`
    const flightKey = `${cacheKey}\0${directoryModifiedAtMs}`
    let flight = this.#flights.get(flightKey)
    if (!flight) {
      const revision = (this.#revisions.get(cacheKey) ?? 0) + 1
      this.#revisions.set(cacheKey, revision)
      const controller = new AbortController()
      const created: RepresentativeFlight = {
        controller,
        waiters: 0,
        settled: false,
        promise: Promise.resolve({ directoryModifiedAtMs }),
      }
      created.promise = this.#resolve(path, cacheKey, directoryModifiedAtMs, count, priority, controller.signal)
        .then((entry) => {
          if (this.#revisions.get(cacheKey) === revision) this.#setCache(cacheKey, entry)
          return entry
        })
        .finally(() => {
          created.settled = true
          if (this.#flights.get(flightKey) === created) this.#flights.delete(flightKey)
        })
      void created.promise.catch(() => undefined)
      this.#flights.set(flightKey, created)
      flight = created
    }
    flight.waiters += 1
    const entry = await waitForFlight(flight.promise, signal).finally(() => {
      flight!.waiters -= 1
      if (!flight!.waiters && !flight!.settled) flight!.controller.abort(abortError("Folder representative demand released."))
    })
    return {
      version: entry.version,
      paths: entry.sources?.map((source) => join(path, source.name)) ?? [],
    }
  }

  clear(): void {
    for (const flight of this.#flights.values()) flight.controller.abort(abortError("Folder representative index cleared."))
    this.#flights.clear()
    this.#cache.clear()
    this.#revisions.clear()
  }

  async #resolve(
    path: string,
    cacheKey: string,
    directoryModifiedAtMs: number,
    count: number,
    priority: ResourcePriority,
    signal: AbortSignal,
  ): Promise<RepresentativeEntry> {
    signal.throwIfAborted()
    let scanned: RepresentativeEntry | undefined
    const lease = await this.#resourceScheduler?.acquire({
      resource: "io",
      kind: "neoview.thumbnail.folder-representative",
      priority,
    }, signal)
    try {
      const cached = this.#cache.get(cacheKey)
      if (cached?.directoryModifiedAtMs === directoryModifiedAtMs) {
        const validated = await this.#validateEntry(path, cached, signal)
        if (validated) {
          this.#touch(cacheKey, validated)
          return validated
        }
      }
      const persisted = await this.#readManifest(path, directoryModifiedAtMs, count, signal)
      if (persisted) {
        this.#touch(cacheKey, persisted)
        return persisted
      }
      scanned = await this.#scan(path, directoryModifiedAtMs, count, signal, true)
    } finally {
      lease?.release()
    }
    if (!scanned) return { directoryModifiedAtMs }
    void this.#writeManifest(path, count, scanned)
    return scanned
  }

  async #readManifest(
    path: string,
    directoryModifiedAtMs: number,
    count: number,
    signal: AbortSignal,
  ): Promise<RepresentativeEntry | undefined> {
    const read = this.#manifestStore?.getFolderRepresentativeManifest
    if (!read) return undefined
    let manifest: ReaderFolderRepresentativeManifest | undefined
    try {
      manifest = await read.call(this.#manifestStore, path, count, representativeSelectionRevision(this.#mediaFormats?.revision))
    } catch {
      return undefined
    }
    signal.throwIfAborted()
    if (!manifest || manifest.directoryModifiedAtMs !== directoryModifiedAtMs) return undefined
    return this.#validateEntry(path, {
      directoryModifiedAtMs,
      sources: manifest.sources,
    }, signal)
  }

  async #writeManifest(path: string, count: number, entry: RepresentativeEntry): Promise<void> {
    const write = this.#manifestStore?.putFolderRepresentativeManifest
    if (!write) return
    try {
      await write.call(this.#manifestStore, path, count, representativeSelectionRevision(this.#mediaFormats?.revision), {
        directoryModifiedAtMs: entry.directoryModifiedAtMs,
        sources: entry.sources ?? [],
      })
    } catch {
      // Persistent indexing is an optimization; thumbnail generation remains authoritative.
    }
  }

  async #validateEntry(
    path: string,
    entry: RepresentativeEntry,
    signal: AbortSignal,
  ): Promise<RepresentativeEntry | undefined> {
    if (!entry.sources?.length) return entry
    try {
      const sources = await Promise.all(entry.sources.map(async (source) => {
        const sourceStats = await this.#statPath(join(path, source.name))
        if (!sourceStats.isFile() && !sourceStats.isDirectory()) return undefined
        return representativeSource(source.name, sourceStats)
      }))
      signal.throwIfAborted()
      return sources.every((source): source is RepresentativeSource => Boolean(source))
        ? representativeEntry(entry.directoryModifiedAtMs, sources)
        : undefined
    } catch (error) {
      if (!isMissingFile(error)) throw error
      return undefined
    }
  }

  async #scan(
    path: string,
    directoryModifiedAtMs: number,
    count: number,
    signal: AbortSignal,
    retryMissing: boolean,
  ): Promise<RepresentativeEntry> {
    signal.throwIfAborted()
    const representatives = await this.#scanRepresentativePaths(path, count, signal)
    if (!representatives.length) return { directoryModifiedAtMs }
    try {
      const sources = await Promise.all(representatives.map(async (name) => {
        const sourceStats = await this.#statPath(join(path, name))
        return sourceStats.isFile() || sourceStats.isDirectory() ? representativeSource(name, sourceStats) : undefined
      }))
      signal.throwIfAborted()
      const present = sources.filter((source): source is RepresentativeSource => Boolean(source))
      if (present.length) return representativeEntry(directoryModifiedAtMs, present)
    } catch (error) {
      if (!isMissingFile(error)) throw error
      if (retryMissing) return this.#scan(path, directoryModifiedAtMs, count, signal, false)
    }
    return { directoryModifiedAtMs }
  }

  async #scanRepresentativePaths(path: string, count: number, signal: AbortSignal): Promise<string[]> {
    const queue: Array<{ relativePath: string; depth: number; branch: string }> = [{ relativePath: "", depth: 0, branch: "" }]
    const mediaByBranch = new Map<string, Map<string, string[]>>()
    const pendingByBranch = new Map<string, number>()
    let scannedDirectories = 0
    const deadline = performance.now() + SCAN_BUDGET_MS
    while (queue.length && scannedDirectories < MAX_SCAN_DIRECTORIES && performance.now() < deadline) {
      signal.throwIfAborted()
      const current = queue.shift()!
      if (current.branch) pendingByBranch.set(current.branch, Math.max(0, (pendingByBranch.get(current.branch) ?? 1) - 1))
      scannedDirectories += 1
      const directoryPath = current.relativePath ? join(path, current.relativePath) : path
      let entries: readonly DirectoryEntryLike[]
      try {
        entries = (await this.#readDirectory(directoryPath)).slice(0, MAX_ENTRIES_PER_DIRECTORY)
      } catch {
        signal.throwIfAborted()
        continue
      }
      const directoryStem = basename(directoryPath).replace(/\.[^.]+$/u, "")
      const ranked = [...entries].sort((left, right) => representativeRank(left, this.#mediaFormats, directoryStem)
        - representativeRank(right, this.#mediaFormats, directoryStem) || compareNaturalPath(left.name, right.name))
      const media = ranked.filter((entry) => entry.isFile() && isRepresentativeFile(entry.name, this.#mediaFormats))
      const directories = ranked.filter((entry) => entry.isDirectory())
      if (media.length) {
        const branch = current.branch || "."
        const folders = mediaByBranch.get(branch) ?? new Map<string, string[]>()
        const folder = current.relativePath || "."
        const candidates = folders.get(folder) ?? []
        candidates.push(...media.slice(0, count - candidates.length).map((entry) => (
          current.relativePath ? join(current.relativePath, entry.name) : entry.name
        )))
        folders.set(folder, candidates)
        mediaByBranch.set(branch, folders)
        if (!current.relativePath && !directories.length && candidates.length >= count) return candidates.slice(0, count)
      }
      if (current.depth < MAX_SCAN_DEPTH) {
        for (const entry of directories) {
          if (scannedDirectories + queue.length >= MAX_SCAN_DIRECTORIES || performance.now() >= deadline) break
          const relativePath = current.relativePath ? join(current.relativePath, entry.name) : entry.name
          const branch = current.branch || entry.name
          queue.push({ relativePath, depth: current.depth + 1, branch })
          pendingByBranch.set(branch, (pendingByBranch.get(branch) ?? 0) + 1)
        }
      }
      if (representativeBranchesReady(mediaByBranch, pendingByBranch, count)) break
    }
    signal.throwIfAborted()
    return roundRobinRepresentatives([...mediaByBranch.values()].map((folders) => [...folders.values()]), count)
  }

  #setCache(path: string, entry: RepresentativeEntry): void {
    this.#cache.delete(path)
    this.#cache.set(path, entry)
    while (this.#cache.size > this.#maxEntries) {
      const oldest = this.#cache.keys().next().value as string | undefined
      if (!oldest) break
      this.#cache.delete(oldest)
      this.#revisions.delete(oldest)
    }
  }

  #touch(path: string, entry: RepresentativeEntry): void {
    this.#cache.delete(path)
    this.#cache.set(path, entry)
  }
}

function representativeSelectionRevision(mediaRevision = 0): number {
  const revision = REPRESENTATIVE_SELECTION_REVISION_BASE + mediaRevision * 16 + REPRESENTATIVE_SELECTION_REVISION
  if (!Number.isSafeInteger(revision)) throw new RangeError("Folder representative media revision exceeds the supported range.")
  return revision
}

function roundRobinRepresentatives(branches: readonly (readonly (readonly string[])[])[], count: number): string[] {
  const representatives: string[] = []
  const maxFolders = Math.max(0, ...branches.map((folders) => folders.length))
  for (let mediaOffset = 0; representatives.length < count; mediaOffset += 1) {
    let added = false
    for (let folderOffset = 0; folderOffset < maxFolders && representatives.length < count; folderOffset += 1) {
      for (const folders of branches) {
        const path = folders[folderOffset]?.[mediaOffset]
        if (!path) continue
        representatives.push(path)
        added = true
        if (representatives.length === count) break
      }
    }
    if (!added) break
  }
  return representatives
}

function representativeBranchesReady(
  mediaByBranch: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>,
  pendingByBranch: ReadonlyMap<string, number>,
  count: number,
): boolean {
  const branches = new Set([...mediaByBranch.keys(), ...pendingByBranch.keys()])
  if (!branches.size) return false
  const targetBranchCount = Math.min(count, branches.size)
  const populatedBranches = [...branches].filter((branch) => (mediaByBranch.get(branch)?.size ?? 0) > 0)
  if (populatedBranches.length < targetBranchCount) {
    const unpopulatedBranchCanStillProduce = [...branches].some((branch) => (
      !mediaByBranch.has(branch) && (pendingByBranch.get(branch) ?? 0) > 0
    ))
    if (unpopulatedBranchCanStillProduce) return false
  }

  const targetPerBranch = Math.ceil(count / Math.max(1, populatedBranches.length))
  let total = 0
  for (const branch of populatedBranches) {
    const available = mediaByBranch.get(branch)?.size ?? 0
    total += available
    if (available < targetPerBranch && (pendingByBranch.get(branch) ?? 0) > 0) return false
  }
  return total >= count
}

function representativeSource(name: string, sourceStats: FileStatsLike): RepresentativeSource {
  return { name, size: sourceStats.size, modifiedAtMs: Math.trunc(sourceStats.mtimeMs) }
}

function representativeEntry(directoryModifiedAtMs: number, sources: readonly RepresentativeSource[]): RepresentativeEntry {
  return {
    directoryModifiedAtMs,
    sources,
    version: sources.map((source) => `${source.name}:${source.size}:${source.modifiedAtMs}`).join("|"),
  }
}

async function defaultReadDirectory(path: string): Promise<readonly DirectoryEntryLike[]> {
  return readdir(path, { withFileTypes: true })
}

function isRepresentativeFile(name: string, mediaFormats?: ReaderMediaTypeResolver): boolean {
  if (pageMediaType(name, mediaFormats)) return true
  const dot = name.lastIndexOf(".")
  return dot >= 0 && READER_CONTAINER_EXTENSIONS.has(name.slice(dot + 1).toLocaleLowerCase("en-US"))
}

function representativeRank(entry: DirectoryEntryLike, mediaFormats?: ReaderMediaTypeResolver, directoryStem?: string): number {
  if (entry.isFile()) {
    const dot = entry.name.lastIndexOf(".")
    const stem = (dot > 0 ? entry.name.slice(0, dot) : entry.name).toLocaleLowerCase("en-US")
    if (POSTER_STEMS.has(stem) || isDirectoryNamedPoster(stem, directoryStem)) return 0
    const media = pageMediaType(entry.name, mediaFormats)
    if (media?.kind === "image" || media?.kind === "animated-image") return 1
    if (dot >= 0 && READER_CONTAINER_EXTENSIONS.has(entry.name.slice(dot + 1).toLocaleLowerCase("en-US"))) return 2
    if (media?.kind === "video") return 3
  }
  return entry.isDirectory() ? 4 : 5
}

function isDirectoryNamedPoster(stem: string, directoryStem?: string): boolean {
  if (!directoryStem) return false
  const normalizedDirectory = directoryStem.toLocaleLowerCase("en-US")
  if (!normalizedDirectory) return false
  const suffix = "(?:cover|default|folder|series|poster|thumbnail)"
  const escapedDirectory = normalizedDirectory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^[-\\s0-9+]*${escapedDirectory}(?:[_-]?${suffix})?[-\\s0-9+]*$`, "u").test(stem)
}

function waitForFlight<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason) }
    const cleanup = () => signal.removeEventListener("abort", abort)
    signal.addEventListener("abort", abort, { once: true })
    promise.then(
      (value) => { cleanup(); resolve(value) },
      (error) => { cleanup(); reject(error) },
    )
  })
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
}

function abortError(message: string): DOMException {
  return new DOMException(message, "AbortError")
}
