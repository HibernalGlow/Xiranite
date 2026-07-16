import { posix, win32 } from "node:path"

import type {
  ReaderDirectoryEntry,
  ReaderDirectoryListing,
  ReaderDirectoryListingProvider,
} from "../../ports/ReaderDirectoryListingProvider.js"
import type {
  ReaderDirectoryMetadataField,
  ReaderDirectoryMetadataProvider,
} from "../../ports/ReaderDirectoryMetadataProvider.js"
import type {
  ReaderFileTreeScanner,
} from "../../ports/ReaderFileTreeScanner.js"
import type { ReaderDirectorySizeProvider } from "../../ports/ReaderDirectorySizeProvider.js"
import pMap from "p-map"
import type {
  ReaderFileTreeChange,
  ReaderFileTreeSubscription,
  ReaderFileTreeWatcher,
} from "../../ports/ReaderFileTreeWatcher.js"
import {
  READER_DIRECTORY_SORT_FIELDS,
  readerDirectoryMetadataFields,
  sortReaderDirectoryEntries,
  type ReaderDirectorySortField,
  type ReaderDirectorySortRule,
} from "./ReaderDirectorySort.js"
import {
  CoreReaderDirectorySortPreferences,
  type ReaderDirectorySortDefaultScope,
  type ReaderDirectorySortPreferenceSnapshot,
  type ReaderDirectoryTemporarySortRule,
} from "./ReaderDirectorySortPreferences.js"
import {
  searchReaderFileTree,
  type ReaderFileTreeSearchEvent,
  type ReaderFileTreeSearchHandle,
  type ReaderFileTreeSearchOptions,
} from "./ReaderFileTreeSearch.js"
import {
  ReaderFileTreeIndex,
  type ReaderFileTreeExclusionCommand,
  type ReaderFileTreeIndexOptions,
  type ReaderFileTreeNodePage,
} from "./ReaderFileTreeIndex.js"
import { readerDirectoryListingPayloadBytes, stringPayloadBytes } from "./ReaderDirectoryListingMetrics.js"

const MAXIMUM_TREE_WATCH_PATHS = 32

export type ReaderDirectoryNavigation =
  | { action: "path"; path: string }
  | { action: "back" | "forward" | "up" | "refresh" }

export type ReaderDirectorySortPreferenceCommand =
  | { action: "temporary"; enabled: boolean }
  | { action: "set-default"; scope: ReaderDirectorySortDefaultScope }
  | { action: "clear-memory"; scope: "current" | "all" }

export interface ReaderDirectoryPage {
  sessionId: string
  path: string
  parentPath?: string
  entries: readonly ReaderDirectoryEntry[]
  cursor: number
  nextCursor?: number
  total: number
  canGoBack: boolean
  canGoForward: boolean
  generation: number
  sort: ReaderDirectorySortRule
  sortFields: readonly ReaderDirectorySortField[]
  metadataFields: readonly ReaderDirectoryMetadataField[]
  metadataCapabilities: readonly ReaderDirectoryMetadataField[]
  sortSource: ReaderDirectorySortPreferenceSnapshot["source"]
  sortTemporary: boolean
  globalDefaultSort: ReaderDirectorySortRule
  tabDefaultSort: ReaderDirectorySortRule
  suggestedSelection?: { path: string; index: number }
  watching: boolean
  watchError?: string
}

export interface ReaderFileTreeServiceOptions extends ReaderFileTreeIndexOptions {
  scanner?: ReaderFileTreeScanner
  watcher?: ReaderFileTreeWatcher
  directorySizeProvider?: ReaderDirectorySizeProvider
  directorySizeConcurrency?: number
}

export interface ReaderFileTreeMemorySnapshot {
  sessions: number
  listingEntries: number
  listingPayloadBytes: number
  navigationPaths: number
  navigationPayloadBytes: number
  randomSeeds: number
  randomSeedPayloadBytes: number
}

export interface ReaderFileTreeWatchBatch {
  sessionId: string
  revision: number
  generation: number
  paths: readonly string[]
  reset: boolean
  watchError?: string
}

export interface ReaderDirectorySizeBatch {
  sessionId: string
  generation: number
  results: readonly ReaderDirectorySizeBatchItem[]
}

export type ReaderDirectorySizeBatchItem =
  | { path: string; status: "ok"; bytes: number; fileCount: number }
  | { path: string; status: "failed"; error: string }

interface BrowserSession {
  id: string
  listing: ReaderDirectoryListing
  back: string[]
  forward: string[]
  generation: number
  scopeId: string
  sort: ReaderDirectorySortRule
  sortPreference: ReaderDirectorySortPreferenceSnapshot
  temporarySort?: ReaderDirectoryTemporarySortRule
  sortFields: readonly ReaderDirectorySortField[]
  randomSeeds: Map<string, string>
  operation?: AbortController
  watchEnabled: boolean
  watch?: ReaderFileTreeSubscription
  watchRevision: number
  watchAppliedRevision: number
  watchRefresh?: Promise<void>
  watchRefreshAbort?: AbortController
  watchError?: string
  watchWaiters: Set<() => void>
  treeWatchRevision: number
  treeWatchResetRevision: number
  treeWatchChanges: Map<string, { path: string; revision: number }>
  treeWatchWaiters: Set<() => void>
  searches: Set<ReaderFileTreeSearchHandle>
  directorySizeOperations: Set<AbortController>
}

export class ReaderFileTreeService implements AsyncDisposable {
  readonly #sessions = new Map<string, BrowserSession>()
  readonly #tree: ReaderFileTreeIndex
  #nextSessionId = 1
  #closed = false

  constructor(
    private readonly provider: ReaderDirectoryListingProvider,
    private readonly metadataProvider?: ReaderDirectoryMetadataProvider,
    private readonly sortPreferences = new CoreReaderDirectorySortPreferences(),
    private readonly options: ReaderFileTreeServiceOptions = {},
  ) {
    this.#tree = new ReaderFileTreeIndex(provider, options)
  }

  async open(
    path: string,
    signal?: AbortSignal,
    scopeId = "folder-main",
    displayFields: ReadonlySet<ReaderDirectoryMetadataField> = new Set(),
    focusPath?: string,
    watch = false,
  ): Promise<ReaderDirectoryPage> {
    this.#assertOpen()
    const rawListing = await this.provider.read(path, signal)
    const sortPreference = await this.sortPreferences.resolve(scopeId, rawListing.path)
    this.#assertSortAvailable(sortPreference.sort)
    const hydratedEntries = await this.#hydrate(rawListing.entries, sortPreference.sort, signal)
    const listing = sortListing({ ...rawListing, entries: hydratedEntries }, sortPreference.sort, rawListing.path)
    signal?.throwIfAborted()
    const session: BrowserSession = {
      id: `browser-${this.#nextSessionId++}`,
      listing,
      back: [],
      forward: [],
      generation: 1,
      scopeId,
      sort: sortPreference.sort,
      sortPreference,
      sortFields: this.#availableSortFields(),
      randomSeeds: new Map(),
      watchEnabled: watch,
      watchRevision: 0,
      watchAppliedRevision: 0,
      watchWaiters: new Set(),
      treeWatchRevision: 0,
      treeWatchResetRevision: 0,
      treeWatchChanges: new Map(),
      treeWatchWaiters: new Set(),
      searches: new Set(),
      directorySizeOperations: new Set(),
    }
    if (this.#sessions.size >= 8) await this.close(this.#sessions.keys().next().value as string)
    this.#sessions.set(session.id, session)
    await this.#startWatcher(session)
    const focusIndex = focusPath ? listing.entries.findIndex((entry) => entry.path === focusPath) : -1
    return this.#page(
      session,
      0,
      128,
      displayFields,
      signal,
      focusIndex < 0 ? undefined : { path: focusPath!, index: focusIndex },
    )
  }

  async list(
    sessionId: string,
    cursor = 0,
    limit = 128,
    displayFields: ReadonlySet<ReaderDirectoryMetadataField> = new Set(),
    signal?: AbortSignal,
  ): Promise<ReaderDirectoryPage | undefined> {
    const session = this.#sessions.get(sessionId)
    if (!session) return undefined
    await this.#refreshWatchedSession(session, signal)
    assertPage(cursor, limit, session.listing.entries.length)
    return this.#page(session, cursor, limit, displayFields, signal)
  }

  async waitForChanges(
    sessionId: string,
    afterGeneration: number,
    waitMs = 25_000,
    displayFields: ReadonlySet<ReaderDirectoryMetadataField> = new Set(),
    focusPath?: string,
    signal?: AbortSignal,
  ): Promise<ReaderDirectoryPage | null | undefined> {
    const session = this.#sessions.get(sessionId)
    if (!session) return undefined
    if (!Number.isSafeInteger(afterGeneration) || afterGeneration < 0) throw new RangeError("afterGeneration must be a non-negative integer")
    if (!Number.isSafeInteger(waitMs) || waitMs < 10 || waitMs > 30_000) throw new RangeError("waitMs must be an integer from 10 to 30000")
    await this.#refreshWatchedSession(session, signal)
    if (session.generation <= afterGeneration && session.watch) {
      const revision = session.watchRevision
      await waitForWatcherChange(session, revision, waitMs, signal)
      if (this.#sessions.get(sessionId) !== session) return undefined
      await this.#refreshWatchedSession(session, signal)
      if (session.generation <= afterGeneration && session.watch && !session.watchError) return null
    }
    const focusIndex = focusPath ? session.listing.entries.findIndex((entry) => entry.path === focusPath) : -1
    return this.#page(
      session,
      0,
      128,
      displayFields,
      signal,
      focusIndex < 0 ? undefined : { path: focusPath!, index: focusIndex },
    )
  }

  async waitForTreeChanges(
    sessionId: string,
    afterRevision: number,
    waitMs = 25_000,
    signal?: AbortSignal,
  ): Promise<ReaderFileTreeWatchBatch | null | undefined> {
    const session = this.#sessions.get(sessionId)
    if (!session) return undefined
    if (!Number.isSafeInteger(afterRevision) || afterRevision < 0) throw new RangeError("afterRevision must be a non-negative integer")
    if (!Number.isSafeInteger(waitMs) || waitMs < 10 || waitMs > 30_000) throw new RangeError("waitMs must be an integer from 10 to 30000")
    if (afterRevision !== session.treeWatchRevision) {
      return treeWatchBatch(session, afterRevision, this.#tree.snapshot().generation)
    }
    if (session.watch) {
      const revision = session.treeWatchRevision
      await waitForTreeWatcherChange(session, revision, waitMs, signal)
      if (this.#sessions.get(sessionId) !== session) return undefined
      if (session.treeWatchRevision <= afterRevision && session.watch && !session.watchError) return null
    }
    return treeWatchBatch(session, afterRevision, this.#tree.snapshot().generation)
  }

  async navigate(
    sessionId: string,
    navigation: ReaderDirectoryNavigation,
    signal?: AbortSignal,
    displayFields: ReadonlySet<ReaderDirectoryMetadataField> = new Set(),
  ): Promise<ReaderDirectoryPage | undefined> {
    const session = this.#sessions.get(sessionId)
    if (!session) return undefined
    const previousPath = session.listing.path
    const target = targetPath(session, navigation)
    if (!target) return this.#page(session, 0, 128, displayFields, signal)

    abortDirectorySizeOperations(session)
    session.operation?.abort()
    const controller = new AbortController()
    session.operation = controller
    const unlinkAbort = forwardAbort(signal, controller)
    const combinedSignal = controller.signal
    const generation = session.generation + 1
    try {
      const rawListing = await this.provider.read(target, combinedSignal)
      const sortPreference = await this.sortPreferences.resolve(session.scopeId, rawListing.path, session.temporarySort)
      this.#assertSortAvailable(sortPreference.sort)
      const hydratedEntries = await this.#hydrate(rawListing.entries, sortPreference.sort, combinedSignal)
      const listing = sortListing(
        { ...rawListing, entries: hydratedEntries },
        sortPreference.sort,
        randomSeedForPath(session, rawListing.path),
      )
      combinedSignal.throwIfAborted()
      if (this.#sessions.get(sessionId) !== session || session.operation !== controller) return undefined
      updateHistory(session, navigation, listing.path)
      session.listing = listing
      session.sort = sortPreference.sort
      session.sortPreference = sortPreference
      session.generation = generation
      await this.#replaceWatcher(session)
      combinedSignal.throwIfAborted()
      if (this.#sessions.get(sessionId) !== session || session.operation !== controller) return undefined
      return await this.#page(session, 0, 128, displayFields, combinedSignal, suggestedSelection(navigation, listing, previousPath))
    } finally {
      unlinkAbort()
      if (session.operation === controller) session.operation = undefined
    }
  }

  async sort(
    sessionId: string,
    sort: ReaderDirectorySortRule,
    focusPath?: string,
    signal?: AbortSignal,
    displayFields: ReadonlySet<ReaderDirectoryMetadataField> = new Set(),
  ): Promise<ReaderDirectoryPage | undefined> {
    const session = this.#sessions.get(sessionId)
    if (!session) return undefined
    if (!session.sortFields.includes(sort.field)) throw new Error(`Directory sort field is unavailable: ${sort.field}`)
    abortDirectorySizeOperations(session)
    session.operation?.abort()
    const controller = new AbortController()
    session.operation = controller
    const unlinkAbort = forwardAbort(signal, controller)
    const combinedSignal = controller.signal
    try {
      const entries = await this.#hydrate(session.listing.entries, sort, combinedSignal)
      combinedSignal.throwIfAborted()
      const remembered = await this.sortPreferences.rememberCurrent(
        session.scopeId,
        session.listing.path,
        sort,
        session.temporarySort,
      )
      combinedSignal.throwIfAborted()
      if (this.#sessions.get(sessionId) !== session || session.operation !== controller) return undefined
      session.sort = sort
      session.sortPreference = remembered.preference
      session.temporarySort = remembered.temporary
      session.listing = sortListing(
        { ...session.listing, entries },
        sort,
        randomSeedForPath(session, session.listing.path),
      )
      session.generation += 1
      const focusIndex = focusPath ? session.listing.entries.findIndex((entry) => entry.path === focusPath) : -1
      return await this.#page(session, 0, 128, displayFields, combinedSignal, focusIndex < 0 ? undefined : { path: focusPath!, index: focusIndex })
    } finally {
      unlinkAbort()
      if (session.operation === controller) session.operation = undefined
    }
  }

  async updateSortPreference(
    sessionId: string,
    command: ReaderDirectorySortPreferenceCommand,
    focusPath?: string,
    signal?: AbortSignal,
    displayFields: ReadonlySet<ReaderDirectoryMetadataField> = new Set(),
  ): Promise<ReaderDirectoryPage | undefined> {
    const session = this.#sessions.get(sessionId)
    if (!session) return undefined
    abortDirectorySizeOperations(session)
    session.operation?.abort()
    const controller = new AbortController()
    session.operation = controller
    const unlinkAbort = forwardAbort(signal, controller)
    const combinedSignal = controller.signal
    try {
      let next: { preference: ReaderDirectorySortPreferenceSnapshot; temporary?: ReaderDirectoryTemporarySortRule }
      if (command.action === "temporary") {
        next = await this.sortPreferences.setTemporary(
          session.scopeId,
          session.listing.path,
          command.enabled,
          session.sort,
        )
      } else {
        if (command.action === "set-default") {
          await this.sortPreferences.setDefault(session.scopeId, command.scope, session.sort)
        } else {
          await this.sortPreferences.clearMemory(command.scope === "current" ? session.listing.path : undefined)
        }
        next = {
          preference: await this.sortPreferences.resolve(session.scopeId, session.listing.path, session.temporarySort),
          temporary: session.temporarySort,
        }
      }
      this.#assertSortAvailable(next.preference.sort)
      const entries = await this.#hydrate(session.listing.entries, next.preference.sort, combinedSignal)
      combinedSignal.throwIfAborted()
      if (this.#sessions.get(sessionId) !== session || session.operation !== controller) return undefined
      session.sort = next.preference.sort
      session.sortPreference = next.preference
      session.temporarySort = next.temporary
      session.listing = sortListing(
        { ...session.listing, entries },
        session.sort,
        randomSeedForPath(session, session.listing.path),
      )
      session.generation += 1
      const focusIndex = focusPath ? session.listing.entries.findIndex((entry) => entry.path === focusPath) : -1
      return await this.#page(session, 0, 128, displayFields, combinedSignal, focusIndex < 0 ? undefined : { path: focusPath!, index: focusIndex })
    } finally {
      unlinkAbort()
      if (session.operation === controller) session.operation = undefined
    }
  }

  search(
    sessionId: string,
    query: string,
    options?: ReaderFileTreeSearchOptions,
    signal?: AbortSignal,
  ): ReaderFileTreeSearchHandle {
    const scanner = this.options.scanner
    if (!scanner) throw new Error("Reader file tree scanning is unavailable.")
    const session = this.#sessions.get(sessionId)
    if (!session) throw new Error(`Reader file tree session not found: ${sessionId}`)
    const controller = new AbortController()
    const unlinkAbort = forwardAbort(signal, controller)
    let iterator: AsyncIterator<ReaderFileTreeSearchEvent>
    try {
      iterator = searchReaderFileTree(scanner, {
        id: session.id,
        rootPath: session.listing.path,
        generation: session.generation,
      }, query, {
        ...options,
        excludePatterns: [
          ...this.#tree.exclusionPatterns(session.listing.path),
          ...(options?.excludePatterns ?? []),
        ],
      }, controller.signal)[Symbol.asyncIterator]()
    } catch (error) {
      unlinkAbort()
      throw error
    }
    let closed = false
    let handle!: ReaderFileTreeSearchHandle
    const close = async () => {
      if (closed) return
      closed = true
      controller.abort(new DOMException("Reader file tree search closed", "AbortError"))
      try {
        await iterator.return?.()
      } finally {
        unlinkAbort()
        session.searches.delete(handle)
      }
    }
    handle = {
      events: { [Symbol.asyncIterator]: () => iterator },
      close,
      [Symbol.asyncDispose]: close,
    }
    session.searches.add(handle)
    return handle
  }

  async tree(
    sessionId: string,
    path?: string,
    refresh = false,
    signal?: AbortSignal,
  ): Promise<(ReaderFileTreeNodePage & { sessionId: string }) | undefined> {
    const session = this.#sessions.get(sessionId)
    if (!session) return undefined
    const page = await this.#tree.read(path?.trim() || session.listing.path, refresh, signal)
    return { sessionId, ...page }
  }

  async updateTreeExclusion(
    sessionId: string,
    command: ReaderFileTreeExclusionCommand,
    signal?: AbortSignal,
  ): Promise<{ generation: number; excludedPaths: readonly string[] } | undefined> {
    if (!this.#sessions.has(sessionId)) return undefined
    const excludedPaths = await this.#tree.updateExclusion(command, signal)
    return { generation: this.#tree.snapshot().generation, excludedPaths }
  }

  clearTreeCache(sessionId: string, path?: string): { generation: number; size: number; excludedPaths: readonly string[] } | undefined {
    if (!this.#sessions.has(sessionId)) return undefined
    this.#tree.clear(path)
    return this.#tree.snapshot()
  }

  memorySnapshot(): ReaderFileTreeMemorySnapshot {
    const snapshot: ReaderFileTreeMemorySnapshot = {
      sessions: this.#sessions.size,
      listingEntries: 0,
      listingPayloadBytes: 0,
      navigationPaths: 0,
      navigationPayloadBytes: 0,
      randomSeeds: 0,
      randomSeedPayloadBytes: 0,
    }
    for (const session of this.#sessions.values()) {
      snapshot.listingEntries += session.listing.entries.length
      snapshot.listingPayloadBytes += readerDirectoryListingPayloadBytes(session.listing)
      snapshot.navigationPaths += session.back.length + session.forward.length
      snapshot.navigationPayloadBytes += stringPayloadBytes(session.back) + stringPayloadBytes(session.forward)
      snapshot.randomSeeds += session.randomSeeds.size
      snapshot.randomSeedPayloadBytes += stringPayloadBytes(session.randomSeeds.keys()) + stringPayloadBytes(session.randomSeeds.values())
    }
    return snapshot
  }

  releaseMemoryPressure(): { clearedTreeEntries: number; cancelledDirectorySizes: number; clearedRandomSeeds: number } {
    this.#assertOpen()
    const clearedTreeEntries = this.#tree.snapshot().size
    this.#tree.clear()
    let cancelledDirectorySizes = 0
    let clearedRandomSeeds = 0
    for (const session of this.#sessions.values()) {
      cancelledDirectorySizes += session.directorySizeOperations.size
      abortDirectorySizeOperations(session)
      clearedRandomSeeds += session.randomSeeds.size
      session.randomSeeds.clear()
    }
    return { clearedTreeEntries, cancelledDirectorySizes, clearedRandomSeeds }
  }

  async directorySizes(
    sessionId: string,
    generation: number,
    paths: readonly string[],
    signal?: AbortSignal,
  ): Promise<ReaderDirectorySizeBatch | undefined> {
    const provider = this.options.directorySizeProvider
    if (!provider) throw new Error("Reader directory size scanning is unavailable.")
    const session = this.#sessions.get(sessionId)
    if (!session) return undefined
    if (generation !== session.generation) throw new Error(`Reader directory size generation is stale: ${generation}`)
    const uniquePaths = [...new Set(paths)]
    if (!uniquePaths.length || uniquePaths.length > 64) throw new RangeError("Directory size batch must contain 1 to 64 unique paths.")
    const directories = new Set(session.listing.entries.filter((entry) => entry.kind === "directory").map((entry) => entry.path))
    if (uniquePaths.some((path) => !directories.has(path))) throw new Error("Directory size paths must belong to the current browser listing.")
    const controller = new AbortController()
    const unlinkAbort = forwardAbort(signal, controller)
    session.directorySizeOperations.add(controller)
    try {
      const results = await pMap(uniquePaths, async (path): Promise<ReaderDirectorySizeBatchItem> => {
        controller.signal.throwIfAborted()
        try {
          const result = await provider.measure(path, controller.signal)
          return { path, status: "ok", bytes: result.bytes, fileCount: result.fileCount }
        } catch (error) {
          if (controller.signal.aborted) throw error
          return { path, status: "failed", error: errorMessage(error) }
        }
      }, {
        concurrency: boundedInteger(this.options.directorySizeConcurrency, 1, 8, 2),
        stopOnError: true,
      })
      controller.signal.throwIfAborted()
      if (this.#sessions.get(sessionId) !== session || session.generation !== generation) {
        throw new Error(`Reader directory size generation is stale: ${generation}`)
      }
      return { sessionId, generation, results }
    } finally {
      unlinkAbort()
      session.directorySizeOperations.delete(controller)
    }
  }

  async close(sessionId: string): Promise<boolean> {
    const session = this.#sessions.get(sessionId)
    if (!session) return false
    session.operation?.abort()
    abortDirectorySizeOperations(session)
    this.#sessions.delete(sessionId)
    await Promise.all([...session.searches].map((search) => search.close()))
    await this.#closeWatcher(session)
    return true
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    const sessions = [...this.#sessions.values()]
    this.#sessions.clear()
    for (const session of sessions) {
      session.operation?.abort()
      abortDirectorySizeOperations(session)
      await Promise.all([...session.searches].map((search) => search.close()))
      await this.#closeWatcher(session)
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Reader directory browser is closed.")
  }

  async #hydrate(
    entries: readonly ReaderDirectoryEntry[],
    sort: ReaderDirectorySortRule,
    signal?: AbortSignal,
  ): Promise<readonly ReaderDirectoryEntry[]> {
    const fields = readerDirectoryMetadataFields(sort.field)
    return fields.size && this.metadataProvider
      ? this.metadataProvider.hydrate(entries, fields, signal)
      : entries
  }

  #availableSortFields(): ReaderDirectorySortField[] {
    const metadataFields = this.metadataProvider?.supportedFields ?? new Set()
    return [...READER_DIRECTORY_SORT_FIELDS].filter((field) => {
      const required = readerDirectoryMetadataFields(field)
      return !required.size || [...required].every((value) => metadataFields.has(value))
    })
  }

  #assertSortAvailable(sort: ReaderDirectorySortRule): void {
    if (!this.#availableSortFields().includes(sort.field)) {
      throw new Error(`Directory sort field is unavailable: ${sort.field}`)
    }
  }

  async #startWatcher(session: BrowserSession): Promise<void> {
    if (!session.watchEnabled || !this.options.watcher) return
    try {
      const subscription = await this.options.watcher.subscribe(
        session.listing.path,
        (changes) => this.#recordWatcherChanges(session, changes),
        (error) => {
          if (this.#sessions.get(session.id) !== session) return
          session.watchError = error.message
          wakeWatcherWaiters(session)
          wakeTreeWatcherWaiters(session)
        },
      )
      if (this.#sessions.get(session.id) !== session) {
        await subscription.close()
        return
      }
      session.watch = subscription
      session.watchError = undefined
    } catch (error) {
      session.watchError = errorMessage(error)
    }
  }

  async #replaceWatcher(session: BrowserSession): Promise<void> {
    await this.#closeWatcher(session)
    session.watchRevision = 0
    session.watchAppliedRevision = 0
    session.treeWatchRevision = 0
    session.treeWatchResetRevision = 0
    session.treeWatchChanges.clear()
    await this.#startWatcher(session)
  }

  async #closeWatcher(session: BrowserSession): Promise<void> {
    session.watchRefreshAbort?.abort(new DOMException("Reader file tree watch closed", "AbortError"))
    const refresh = session.watchRefresh
    const subscription = session.watch
    session.watch = undefined
    wakeWatcherWaiters(session)
    wakeTreeWatcherWaiters(session)
    if (refresh) await refresh.catch(() => undefined)
    if (subscription) await subscription.close()
  }

  #recordWatcherChanges(session: BrowserSession, changes: readonly ReaderFileTreeChange[]): void {
    if (this.#sessions.get(session.id) !== session) return
    const treeRevision = session.treeWatchRevision + 1
    for (const change of changes) {
      this.#tree.invalidate(change.path)
      const parentPath = watcherParentPath(change.path)
      session.treeWatchChanges.delete(directoryWatchPathKey(parentPath))
      session.treeWatchChanges.set(directoryWatchPathKey(parentPath), { path: parentPath, revision: treeRevision })
    }
    session.treeWatchRevision = treeRevision
    while (session.treeWatchChanges.size > MAXIMUM_TREE_WATCH_PATHS) {
      const oldestKey = session.treeWatchChanges.keys().next().value as string | undefined
      if (oldestKey === undefined) break
      const oldest = session.treeWatchChanges.get(oldestKey)
      session.treeWatchChanges.delete(oldestKey)
      if (oldest) session.treeWatchResetRevision = Math.max(session.treeWatchResetRevision, oldest.revision)
    }
    wakeTreeWatcherWaiters(session)
    if (!changes.some((change) => affectsCurrentDirectory(session.listing.path, change.path))) return
    session.watchRevision += 1
    wakeWatcherWaiters(session)
  }

  async #refreshWatchedSession(session: BrowserSession, signal?: AbortSignal): Promise<void> {
    if (session.watchAppliedRevision >= session.watchRevision) return
    if (!session.watchRefresh) {
      const revision = session.watchRevision
      const controller = new AbortController()
      session.watchRefreshAbort = controller
      session.watchRefresh = this.#reloadWatchedSession(session, revision, controller.signal).finally(() => {
        session.watchRefresh = undefined
        if (session.watchRefreshAbort === controller) session.watchRefreshAbort = undefined
      })
    }
    await waitForSharedRefresh(session.watchRefresh, signal)
  }

  async #reloadWatchedSession(session: BrowserSession, revision: number, signal: AbortSignal): Promise<void> {
    abortDirectorySizeOperations(session)
    const rawListing = await this.provider.read(session.listing.path, signal)
    const sortPreference = await this.sortPreferences.resolve(session.scopeId, rawListing.path, session.temporarySort)
    this.#assertSortAvailable(sortPreference.sort)
    const entries = await this.#hydrate(rawListing.entries, sortPreference.sort, signal)
    signal.throwIfAborted()
    if (this.#sessions.get(session.id) !== session) return
    session.listing = sortListing(
      { ...rawListing, entries },
      sortPreference.sort,
      randomSeedForPath(session, rawListing.path),
    )
    session.sort = sortPreference.sort
    session.sortPreference = sortPreference
    session.watchAppliedRevision = revision
    session.watchError = undefined
    session.generation += 1
  }

  async #page(
    session: BrowserSession,
    cursor: number,
    limit: number,
    requestedFields: ReadonlySet<ReaderDirectoryMetadataField>,
    signal?: AbortSignal,
    suggestedSelectionValue?: ReaderDirectoryPage["suggestedSelection"],
  ): Promise<ReaderDirectoryPage> {
    const metadataFields = [...requestedFields].filter((field) => this.metadataProvider?.supportedFields.has(field))
    const metadataCapabilities = [...(this.metadataProvider?.supportedFields ?? [])]
    const page = pageOf(session, cursor, limit, suggestedSelectionValue, metadataFields, metadataCapabilities)
    if (!metadataFields.length || !this.metadataProvider) return page
    const entries = await this.metadataProvider.hydrate(page.entries, new Set(metadataFields), signal)
    signal?.throwIfAborted()
    return { ...page, entries }
  }
}

function abortDirectorySizeOperations(session: BrowserSession): void {
  for (const controller of session.directorySizeOperations) controller.abort(new DOMException("Reader directory generation changed", "AbortError"))
  session.directorySizeOperations.clear()
}

function wakeWatcherWaiters(session: BrowserSession): void {
  for (const wake of session.watchWaiters) wake()
  session.watchWaiters.clear()
}

function wakeTreeWatcherWaiters(session: BrowserSession): void {
  for (const wake of session.treeWatchWaiters) wake()
  session.treeWatchWaiters.clear()
}

async function waitForWatcherChange(
  session: BrowserSession,
  revision: number,
  waitMs: number,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  if (session.watchRevision > revision) return
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      session.watchWaiters.delete(wake)
      signal?.removeEventListener("abort", abort)
      callback()
    }
    const wake = () => finish(resolve)
    const abort = () => finish(() => reject(signal?.reason))
    const timer = setTimeout(wake, waitMs)
    session.watchWaiters.add(wake)
    signal?.addEventListener("abort", abort, { once: true })
    if (session.watchRevision > revision) wake()
  })
}

async function waitForTreeWatcherChange(
  session: BrowserSession,
  revision: number,
  waitMs: number,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  if (session.treeWatchRevision > revision) return
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      session.treeWatchWaiters.delete(wake)
      signal?.removeEventListener("abort", abort)
      callback()
    }
    const wake = () => finish(resolve)
    const abort = () => finish(() => reject(signal?.reason))
    const timer = setTimeout(wake, waitMs)
    session.treeWatchWaiters.add(wake)
    signal?.addEventListener("abort", abort, { once: true })
    if (session.treeWatchRevision > revision) wake()
  })
}

function treeWatchBatch(
  session: BrowserSession,
  afterRevision: number,
  generation: number,
): ReaderFileTreeWatchBatch {
  const reset = afterRevision > session.treeWatchRevision || afterRevision < session.treeWatchResetRevision
  const paths = reset
    ? []
    : [...session.treeWatchChanges.values()]
      .filter((change) => change.revision > afterRevision)
      .map((change) => change.path)
  return {
    sessionId: session.id,
    revision: session.treeWatchRevision,
    generation,
    paths,
    reset,
    ...(session.watchError ? { watchError: session.watchError } : {}),
  }
}

function watcherParentPath(path: string): string {
  return path.includes("\\") || /^[A-Za-z]:/u.test(path) ? win32.dirname(path) : posix.dirname(path)
}

function directoryWatchPathKey(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/u, "") || "/"
  return /^(?:[A-Za-z]:|\/\/)/u.test(normalized) ? normalized.toLowerCase() : normalized
}

function targetPath(session: BrowserSession, navigation: ReaderDirectoryNavigation): string | undefined {
  if (navigation.action === "path") return navigation.path.trim() || undefined
  if (navigation.action === "back") return session.back.at(-1)
  if (navigation.action === "forward") return session.forward.at(-1)
  if (navigation.action === "up") return session.listing.parentPath
  return session.listing.path
}

function updateHistory(session: BrowserSession, navigation: ReaderDirectoryNavigation, resolvedPath: string): void {
  const currentPath = session.listing.path
  if (navigation.action === "refresh" || resolvedPath === currentPath) return
  if (navigation.action === "back") {
    session.back.pop()
    session.forward.push(currentPath)
    return
  }
  if (navigation.action === "forward") {
    session.forward.pop()
    session.back.push(currentPath)
    return
  }
  session.back.push(currentPath)
  session.forward.length = 0
}

function pageOf(
  session: BrowserSession,
  cursor: number,
  limit: number,
  suggestedSelectionValue?: ReaderDirectoryPage["suggestedSelection"],
  metadataFields: readonly ReaderDirectoryMetadataField[] = [],
  metadataCapabilities: readonly ReaderDirectoryMetadataField[] = [],
): ReaderDirectoryPage {
  const entries = session.listing.entries.slice(cursor, cursor + limit)
  return {
    sessionId: session.id,
    path: session.listing.path,
    parentPath: session.listing.parentPath,
    entries,
    cursor,
    nextCursor: cursor + entries.length < session.listing.entries.length ? cursor + entries.length : undefined,
    total: session.listing.entries.length,
    canGoBack: session.back.length > 0,
    canGoForward: session.forward.length > 0,
    generation: session.generation,
    sort: session.sort,
    sortFields: session.sortFields,
    metadataFields,
    metadataCapabilities,
    sortSource: session.sortPreference.source,
    sortTemporary: session.sortPreference.temporary,
    globalDefaultSort: session.sortPreference.globalDefault,
    tabDefaultSort: session.sortPreference.tabDefault,
    suggestedSelection: suggestedSelectionValue,
    watching: Boolean(session.watch),
    watchError: session.watchError,
  }
}

function sortListing(
  listing: ReaderDirectoryListing,
  sort: ReaderDirectorySortRule,
  randomSeed: string,
): ReaderDirectoryListing {
  return { ...listing, entries: sortReaderDirectoryEntries(listing.entries, sort, randomSeed) }
}

function randomSeedForPath(session: BrowserSession, path: string): string {
  const normalized = path.replaceAll("\\", "/").toLocaleLowerCase()
  let seed = session.randomSeeds.get(normalized)
  if (!seed) {
    seed = `${session.id}:${session.generation}:${normalized}`
    session.randomSeeds.set(normalized, seed)
    while (session.randomSeeds.size > 100) session.randomSeeds.delete(session.randomSeeds.keys().next().value as string)
  }
  return seed
}


function suggestedSelection(
  navigation: ReaderDirectoryNavigation,
  listing: ReaderDirectoryListing,
  previousPath: string,
): ReaderDirectoryPage["suggestedSelection"] {
  if (navigation.action !== "up") return undefined
  const index = listing.entries.findIndex((entry) => entry.path === previousPath)
  return index < 0 ? undefined : { path: previousPath, index }
}

function assertPage(cursor: number, limit: number, total: number): void {
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > total) throw new RangeError(`Invalid browser cursor: ${cursor}`)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 512) throw new RangeError(`Invalid browser limit: ${limit}`)
}

function affectsCurrentDirectory(directoryPath: string, changedPath: string): boolean {
  const directory = normalizePathKey(directoryPath)
  const changed = normalizePathKey(changedPath)
  if (changed === directory) return true
  const separator = changed.lastIndexOf("/")
  return separator >= 0 && changed.slice(0, separator) === directory
}

function normalizePathKey(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/u, "").toLocaleLowerCase()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function boundedInteger(value: number | undefined, minimum: number, maximum: number, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback
}

async function waitForSharedRefresh(refresh: Promise<void>, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  if (!signal) return refresh
  await Promise.race([
    refresh,
    new Promise<never>((_resolve, reject) => {
      const abort = () => reject(signal.reason)
      signal.addEventListener("abort", abort, { once: true })
      const cleanup = () => signal.removeEventListener("abort", abort)
      void refresh.then(cleanup, cleanup)
    }),
  ])
}

function forwardAbort(source: AbortSignal | undefined, target: AbortController): () => void {
  if (!source) return () => undefined
  if (source.aborted) {
    target.abort(source.reason)
    return () => undefined
  }
  const abort = () => target.abort(source.reason)
  source.addEventListener("abort", abort, { once: true })
  return () => source.removeEventListener("abort", abort)
}
