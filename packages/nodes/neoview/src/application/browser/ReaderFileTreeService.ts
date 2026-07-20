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
import {
  assertReaderDirectoryFilter,
  readerDirectoryEntryMatchesFilter,
  READER_DIRECTORY_FILTERS,
  type ReaderDirectoryEntryType,
  type ReaderDirectoryFilter,
} from "../../domain/browser/ReaderDirectoryFilter.js"
import { ReaderDirectoryListingScanner } from "./ReaderDirectoryListingScanner.js"
import { ReaderMetadataHydratingScanner } from "./ReaderMetadataHydratingScanner.js"
import {
  createReaderDirectorySelectionBatchSource,
  type ReaderDirectorySelectionBatchSource,
  type ReaderDirectorySelectionDescriptor,
} from "./ReaderDirectorySelection.js"

const MAXIMUM_TREE_WATCH_PATHS = 32
const MAXIMUM_NAVIGATION_HISTORY = 50
const MAXIMUM_RECENTLY_CLOSED_SESSIONS = 10
const DEFAULT_MAX_LISTING_PAYLOAD_BYTES_UNDER_PRESSURE = 1024 * 1024
const MAX_MAX_LISTING_PAYLOAD_BYTES_UNDER_PRESSURE = 64 * 1024 * 1024

export type ReaderDirectoryNavigation =
  | { action: "path"; path: string; focusPath?: string }
  | { action: "back" | "forward" | "up" | "refresh"; focusPath?: string }

export type ReaderDirectorySortPreferenceCommand =
  | { action: "temporary"; enabled: boolean }
  | { action: "set-default"; scope: ReaderDirectorySortDefaultScope }
  | { action: "clear-memory"; scope: "current" | "all" }

export interface ReaderDirectoryPage {
  sessionId: string
  navigationEntryId: number
  path: string
  parentPath?: string
  entries: readonly ReaderDirectoryEntry[]
  cursor: number
  nextCursor?: number
  total: number
  canGoBack: boolean
  canGoForward: boolean
  generation: number
  filter: ReaderDirectoryFilter
  filterOptions: readonly ReaderDirectoryFilter[]
  showHiddenFolders: boolean
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
  maxListingPayloadBytesUnderPressure?: number
  classifyEntry?: (entry: Pick<ReaderDirectoryEntry, "path" | "kind">) => ReaderDirectoryEntryType
}

export interface ReaderFileTreeMemorySnapshot {
  sessions: number
  listingEntries: number
  listingPayloadBytes: number
  releasedListings: number
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
  currentNavigation: BrowserNavigationEntry
  back: BrowserNavigationEntry[]
  forward: BrowserNavigationEntry[]
  nextNavigationEntryId: number
  generation: number
  scopeId: string
  sort: ReaderDirectorySortRule
  filter: ReaderDirectoryFilter
  showHiddenFolders: boolean
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
  listingReleased: boolean
  listingReload?: Promise<void>
  listingReloadAbort?: AbortController
  watchError?: string
  watchWaiters: Set<() => void>
  treeWatchRevision: number
  treeWatchResetRevision: number
  treeWatchChanges: Map<string, { path: string; revision: number }>
  treeWatchWaiters: Set<() => void>
  searches: Set<ReaderFileTreeSearchHandle>
  directorySizeOperations: Set<AbortController>
  directorySizeWaiters: Set<Promise<void>>
  directorySizeCache: Map<string, number>
}

interface BrowserNavigationEntry {
  id: number
  path: string
  focusPath?: string
  temporarySort?: ReaderDirectoryTemporarySortRule
}

interface ClosedBrowserSession {
  currentNavigation: BrowserNavigationEntry
  back: BrowserNavigationEntry[]
  forward: BrowserNavigationEntry[]
  nextNavigationEntryId: number
  generation: number
  scopeId: string
  sort: ReaderDirectorySortRule
  filter: ReaderDirectoryFilter
  showHiddenFolders: boolean
  sortPreference: ReaderDirectorySortPreferenceSnapshot
  temporarySort?: ReaderDirectoryTemporarySortRule
  randomSeeds: Map<string, string>
  watchEnabled: boolean
}

export class ReaderFileTreeService implements AsyncDisposable {
  readonly #sessions = new Map<string, BrowserSession>()
  readonly #closedSessions = new Map<string, ClosedBrowserSession>()
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
      currentNavigation: { id: 1, path: listing.path },
      back: [],
      forward: [],
      nextNavigationEntryId: 2,
      generation: 1,
      scopeId,
      sort: sortPreference.sort,
      filter: "all",
      showHiddenFolders: false,
      sortPreference,
      sortFields: this.#availableSortFields(),
      randomSeeds: new Map(),
      watchEnabled: watch,
      watchRevision: 0,
      watchAppliedRevision: 0,
      listingReleased: false,
      watchWaiters: new Set(),
      treeWatchRevision: 0,
      treeWatchResetRevision: 0,
      treeWatchChanges: new Map(),
      treeWatchWaiters: new Set(),
      searches: new Set(),
      directorySizeOperations: new Set(),
      directorySizeWaiters: new Set(),
      directorySizeCache: new Map(),
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
    await this.#ensureListing(session, signal)
    assertPage(cursor, limit, filteredEntries(session, this.options.classifyEntry).length)
    return this.#page(session, cursor, limit, displayFields, signal)
  }

  async setFilter(
    sessionId: string,
    filter: ReaderDirectoryFilter,
    focusPath?: string,
    signal?: AbortSignal,
    displayFields: ReadonlySet<ReaderDirectoryMetadataField> = new Set(),
    showHiddenFolders?: boolean,
  ): Promise<ReaderDirectoryPage | undefined> {
    const session = this.#sessions.get(sessionId)
    if (!session) return undefined
    assertReaderDirectoryFilter(filter)
    await this.#refreshWatchedSession(session, signal)
    await this.#ensureListing(session, signal)
    signal?.throwIfAborted()
    if (session.filter !== filter || (showHiddenFolders !== undefined && session.showHiddenFolders !== showHiddenFolders)) {
      abortDirectorySizeOperations(session)
      session.filter = filter
      if (showHiddenFolders !== undefined) session.showHiddenFolders = showHiddenFolders
      session.generation += 1
    }
    const entries = filteredEntries(session, this.options.classifyEntry)
    const focusIndex = focusPath ? entries.findIndex((entry) => normalizePathKey(entry.path) === normalizePathKey(focusPath)) : -1
    return this.#page(
      session,
      0,
      128,
      displayFields,
      signal,
      focusIndex < 0 ? undefined : { path: entries[focusIndex]!.path, index: focusIndex },
    )
  }

  async clone(
    sessionId: string,
    signal?: AbortSignal,
    displayFields: ReadonlySet<ReaderDirectoryMetadataField> = new Set(),
  ): Promise<ReaderDirectoryPage | undefined> {
    this.#assertOpen()
    const source = this.#sessions.get(sessionId)
    if (!source) return undefined
    await this.#refreshWatchedSession(source, signal)
    await this.#ensureListing(source, signal)
    signal?.throwIfAborted()
    const session: BrowserSession = {
      id: `browser-${this.#nextSessionId++}`,
      listing: { ...source.listing, entries: [...source.listing.entries] },
      currentNavigation: cloneNavigationEntry(source.currentNavigation),
      back: source.back.map(cloneNavigationEntry),
      forward: source.forward.map(cloneNavigationEntry),
      nextNavigationEntryId: source.nextNavigationEntryId,
      generation: source.generation,
      scopeId: source.scopeId,
      sort: { ...source.sort },
      filter: source.filter,
      showHiddenFolders: source.showHiddenFolders,
      sortPreference: cloneSortPreference(source.sortPreference),
      temporarySort: source.temporarySort ? cloneTemporarySort(source.temporarySort) : undefined,
      sortFields: [...source.sortFields],
      randomSeeds: new Map(source.randomSeeds),
      watchEnabled: source.watchEnabled,
      watchRevision: 0,
      watchAppliedRevision: 0,
      listingReleased: false,
      watchWaiters: new Set(),
      treeWatchRevision: 0,
      treeWatchResetRevision: 0,
      treeWatchChanges: new Map(),
      treeWatchWaiters: new Set(),
      searches: new Set(),
      directorySizeOperations: new Set(),
      directorySizeWaiters: new Set(),
      directorySizeCache: new Map(),
    }
    if (this.#sessions.size >= 8) {
      const evictionId = [...this.#sessions.keys()].find((id) => id !== sessionId)
      if (evictionId) await this.close(evictionId)
    }
    this.#sessions.set(session.id, session)
    try {
      await this.#startWatcher(session)
      signal?.throwIfAborted()
      if (this.#sessions.get(session.id) !== session) return undefined
      return await this.#page(session, 0, 128, displayFields, signal)
    } catch (error) {
      await this.close(session.id)
      throw error
    }
  }

  async reopen(
    closedSessionId: string,
    signal?: AbortSignal,
    displayFields: ReadonlySet<ReaderDirectoryMetadataField> = new Set(),
  ): Promise<ReaderDirectoryPage | undefined> {
    this.#assertOpen()
    if (this.#sessions.has(closedSessionId)) return this.clone(closedSessionId, signal, displayFields)
    const closed = this.#closedSessions.get(closedSessionId)
    if (!closed) return undefined
    const rawListing = await this.provider.read(closed.currentNavigation.path, signal)
    const entries = await this.#hydrate(rawListing.entries, closed.sort, signal)
    signal?.throwIfAborted()
    const session: BrowserSession = {
      id: `browser-${this.#nextSessionId++}`,
      listing: sortListing({ ...rawListing, entries }, closed.sort, closed.randomSeeds.get(normalizePathKey(rawListing.path)) ?? rawListing.path),
      currentNavigation: cloneNavigationEntry(closed.currentNavigation),
      back: closed.back.map(cloneNavigationEntry),
      forward: closed.forward.map(cloneNavigationEntry),
      nextNavigationEntryId: closed.nextNavigationEntryId,
      generation: closed.generation,
      scopeId: closed.scopeId,
      sort: { ...closed.sort },
      filter: closed.filter,
      showHiddenFolders: closed.showHiddenFolders,
      sortPreference: cloneSortPreference(closed.sortPreference),
      temporarySort: closed.temporarySort ? cloneTemporarySort(closed.temporarySort) : undefined,
      sortFields: this.#availableSortFields(),
      randomSeeds: new Map(closed.randomSeeds),
      watchEnabled: closed.watchEnabled,
      watchRevision: 0,
      watchAppliedRevision: 0,
      listingReleased: false,
      watchWaiters: new Set(),
      treeWatchRevision: 0,
      treeWatchResetRevision: 0,
      treeWatchChanges: new Map(),
      treeWatchWaiters: new Set(),
      searches: new Set(),
      directorySizeOperations: new Set(),
      directorySizeWaiters: new Set(),
      directorySizeCache: new Map(),
    }
    if (this.#sessions.size >= 8) await this.close(this.#sessions.keys().next().value as string)
    this.#sessions.set(session.id, session)
    try {
      await this.#startWatcher(session)
      signal?.throwIfAborted()
      const page = await this.#page(session, 0, 128, displayFields, signal)
      this.#closedSessions.delete(closedSessionId)
      return page
    } catch (error) {
      await this.close(session.id)
      throw error
    }
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
    await this.#ensureListing(session, signal)
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
    const targetEntry = targetNavigationEntry(session, navigation)
    const target = targetEntry?.path ?? targetPath(session, navigation)
    if (!target) return this.#page(session, 0, 128, displayFields, signal)

    abortDirectorySizeOperations(session)
    abortListingReload(session)
    session.operation?.abort()
    const controller = new AbortController()
    session.operation = controller
    const unlinkAbort = forwardAbort(signal, controller)
    const combinedSignal = controller.signal
    const generation = session.generation + 1
    try {
      const rawListing = await this.provider.read(target, combinedSignal)
      const targetTemporarySort = navigation.action === "back" || navigation.action === "forward"
        ? targetEntry?.temporarySort
        : navigation.action === "refresh" || directoryWatchPathKey(target) === directoryWatchPathKey(session.listing.path)
          ? session.currentNavigation.temporarySort
          : undefined
      const sortPreference = await this.sortPreferences.resolve(session.scopeId, rawListing.path, targetTemporarySort)
      this.#assertSortAvailable(sortPreference.sort)
      const hydratedEntries = applyCachedDirectorySizes(session, await this.#hydrate(rawListing.entries, sortPreference.sort, combinedSignal))
      const listing = sortListing(
        { ...rawListing, entries: hydratedEntries },
        sortPreference.sort,
        randomSeedForPath(session, rawListing.path),
      )
      combinedSignal.throwIfAborted()
      if (this.#sessions.get(sessionId) !== session || session.operation !== controller) return undefined
      session.currentNavigation.focusPath = navigation.focusPath
      updateHistory(session, navigation, listing.path)
      session.temporarySort = session.currentNavigation.temporarySort
      session.listing = listing
      session.listingReleased = false
      session.sort = sortPreference.sort
      session.sortPreference = sortPreference
      session.generation = generation
      await this.#replaceWatcher(session)
      combinedSignal.throwIfAborted()
      if (this.#sessions.get(sessionId) !== session || session.operation !== controller) return undefined
      return await this.#page(session, 0, 128, displayFields, combinedSignal, suggestedSelection(navigation, targetEntry, listing, previousPath))
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
    await this.#ensureListing(session, signal)
    if (!session.sortFields.includes(sort.field)) throw new Error(`Directory sort field is unavailable: ${sort.field}`)
    abortDirectorySizeOperations(session)
    session.operation?.abort()
    const controller = new AbortController()
    session.operation = controller
    const unlinkAbort = forwardAbort(signal, controller)
    const combinedSignal = controller.signal
    try {
      const entries = applyCachedDirectorySizes(session, await this.#hydrate(session.listing.entries, sort, combinedSignal))
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
      syncCurrentNavigationTemporarySort(session)
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
    await this.#ensureListing(session, signal)
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
      const entries = applyCachedDirectorySizes(session, await this.#hydrate(session.listing.entries, next.preference.sort, combinedSignal))
      combinedSignal.throwIfAborted()
      if (this.#sessions.get(sessionId) !== session || session.operation !== controller) return undefined
      session.sort = next.preference.sort
      session.sortPreference = next.preference
      session.temporarySort = next.temporary
      syncCurrentNavigationTemporarySort(session)
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
    const session = this.#sessions.get(sessionId)
    if (!session) throw new Error(`Reader file tree session not found: ${sessionId}`)
    let scanner = options?.maximumDepth === 0
      ? new ReaderDirectoryListingScanner(session.listing.entries)
      : this.options.scanner
    if (!scanner) throw new Error("Reader file tree scanning is unavailable.")
    if (options?.includeTags?.length || options?.excludeTags?.length) {
      if (!this.metadataProvider?.supportedFields.has("tags")) throw new Error("Reader EMM tag search is unavailable.")
      scanner = new ReaderMetadataHydratingScanner(scanner, this.metadataProvider)
    }
    const controller = new AbortController()
    const unlinkAbort = forwardAbort(signal, controller)
    let iterator: AsyncIterator<ReaderFileTreeSearchEvent>
    try {
      iterator = searchReaderFileTree(scanner, {
        id: session.id,
        rootPath: session.listing.path,
        generation: session.generation,
        filter: session.filter,
      }, query, {
        ...options,
        excludePatterns: [
          ...this.#tree.exclusionPatterns(session.listing.path),
          ...(options?.excludePatterns ?? []),
        ],
      }, controller.signal, this.options.classifyEntry)[Symbol.asyncIterator]()
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
      releasedListings: 0,
      navigationPaths: 0,
      navigationPayloadBytes: 0,
      randomSeeds: 0,
      randomSeedPayloadBytes: 0,
    }
    for (const session of this.#sessions.values()) {
      snapshot.listingEntries += session.listing.entries.length
      snapshot.listingPayloadBytes += readerDirectoryListingPayloadBytes(session.listing)
      if (session.listingReleased) snapshot.releasedListings += 1
      snapshot.navigationPaths += session.back.length + session.forward.length
      snapshot.navigationPayloadBytes += stringPayloadBytes(session.back.map((entry) => entry.path)) + stringPayloadBytes(session.forward.map((entry) => entry.path))
      snapshot.randomSeeds += session.randomSeeds.size
      snapshot.randomSeedPayloadBytes += stringPayloadBytes(session.randomSeeds.keys()) + stringPayloadBytes(session.randomSeeds.values())
    }
    return snapshot
  }

  releaseMemoryPressure(): {
    clearedTreeEntries: number
    cancelledDirectorySizes: number
    clearedRandomSeeds: number
    releasedListingEntries: number
    releasedListingPayloadBytes: number
  } {
    this.#assertOpen()
    const clearedTreeEntries = this.#tree.snapshot().size
    this.#tree.clear()
    let cancelledDirectorySizes = 0
    let clearedRandomSeeds = 0
    let releasedListingEntries = 0
    let releasedListingPayloadBytes = 0
    const listingBudget = listingPayloadBudget(this.options.maxListingPayloadBytesUnderPressure)
    for (const session of this.#sessions.values()) {
      cancelledDirectorySizes += session.directorySizeOperations.size
      abortDirectorySizeOperations(session)
      clearedRandomSeeds += session.randomSeeds.size
      session.randomSeeds.clear()
      if (
        !session.listingReleased
        && !session.operation
        && !session.watchRefresh
        && !session.listingReload
        && readerDirectoryListingPayloadBytes(session.listing) > listingBudget
      ) {
        const retainedListing = { ...session.listing, entries: [] }
        releasedListingEntries += session.listing.entries.length
        releasedListingPayloadBytes += readerDirectoryListingPayloadBytes(session.listing) - readerDirectoryListingPayloadBytes(retainedListing)
        session.listing = retainedListing
        session.listingReleased = true
      }
    }
    return { clearedTreeEntries, cancelledDirectorySizes, clearedRandomSeeds, releasedListingEntries, releasedListingPayloadBytes }
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
    await this.#ensureListing(session, signal)
    if (generation !== session.generation) throw new Error(`Reader directory size generation is stale: ${generation}`)
    const uniquePaths = [...new Set(paths)]
    if (!uniquePaths.length || uniquePaths.length > 64) throw new RangeError("Directory size batch must contain 1 to 64 unique paths.")
    const directories = new Set(filteredEntries(session, this.options.classifyEntry).filter((entry) => entry.kind === "directory").map((entry) => entry.path))
    if (uniquePaths.some((path) => !directories.has(path))) throw new Error("Directory size paths must belong to the current browser listing.")
    const controller = new AbortController()
    const unlinkAbort = forwardAbort(signal, controller)
    let complete!: () => void
    const completion = new Promise<void>((resolve) => { complete = resolve })
    session.directorySizeOperations.add(controller)
    session.directorySizeWaiters.add(completion)
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
      for (const result of results) {
        if (result.status === "ok") session.directorySizeCache.set(result.path, result.bytes)
      }
      return { sessionId, generation, results }
    } finally {
      unlinkAbort()
      session.directorySizeOperations.delete(controller)
      session.directorySizeWaiters.delete(completion)
      complete()
    }
  }

  async resolveEntries(
    sessionId: string,
    generation: number,
    paths: readonly string[],
    signal?: AbortSignal,
  ): Promise<readonly ReaderDirectoryEntry[] | undefined> {
    const session = this.#sessions.get(sessionId)
    if (!session) return undefined
    await this.#ensureListing(session, signal)
    assertCurrentGeneration(session, generation, "metadata edit")
    signal?.throwIfAborted()
    const entries = new Map(filteredEntries(session, this.options.classifyEntry).map((entry) => [normalizePathKey(entry.path), entry]))
    return paths.map((path) => {
      const entry = entries.get(normalizePathKey(path))
      if (!entry) throw new RangeError("Reader directory metadata edit path is not in the current listing.")
      return entry
    })
  }

  async resolveSelection(
    sessionId: string,
    descriptor: ReaderDirectorySelectionDescriptor,
    signal?: AbortSignal,
  ): Promise<ReaderDirectorySelectionBatchSource | undefined> {
    const session = this.#sessions.get(sessionId)
    if (!session) return undefined
    await this.#refreshWatchedSession(session, signal)
    await this.#ensureListing(session, signal)
    signal?.throwIfAborted()
    return createReaderDirectorySelectionBatchSource(
      filteredEntries(session, this.options.classifyEntry),
      session.generation,
      descriptor,
    )
  }

  async refreshEntryMetadata(
    sessionId: string,
    generation: number,
    paths: readonly string[],
    fields: ReadonlySet<ReaderDirectoryMetadataField>,
    signal?: AbortSignal,
  ): Promise<{
    generation: number
    entries: readonly ReaderDirectoryEntry[]
    orderChanged: boolean
  } | undefined> {
    const session = this.#sessions.get(sessionId)
    if (!session) return undefined
    await this.#ensureListing(session, signal)
    assertCurrentGeneration(session, generation, "metadata edit")
    const selected = new Set(paths.map(normalizePathKey))
    const beforeEntries = filteredEntries(session, this.options.classifyEntry)
    const sourceEntries = beforeEntries.filter((entry) => selected.has(normalizePathKey(entry.path)))
    if (sourceEntries.length !== selected.size) throw new RangeError("Reader directory metadata edit path is not in the current listing.")
    if (!this.metadataProvider) return { generation: session.generation, entries: sourceEntries, orderChanged: false }
    const requestedFields = new Set([...fields].filter((field) => this.metadataProvider!.supportedFields.has(field)))
    for (const field of readerDirectoryMetadataFields(session.sort.field)) requestedFields.add(field)
    if (!requestedFields.size) return { generation: session.generation, entries: sourceEntries, orderChanged: false }
    const hydrated = await this.metadataProvider.hydrate(sourceEntries, requestedFields, signal)
    signal?.throwIfAborted()
    if (this.#sessions.get(sessionId) !== session) return undefined
    assertCurrentGeneration(session, generation, "metadata edit")
    const replacements = new Map(hydrated.map((entry) => [normalizePathKey(entry.path), entry]))
    abortDirectorySizeOperations(session)
    session.listing = sortListing({
      ...session.listing,
      entries: session.listing.entries.map((entry) => replacements.get(normalizePathKey(entry.path)) ?? entry),
    }, session.sort, randomSeedForPath(session, session.listing.path))
    session.generation += 1
    const afterEntries = filteredEntries(session, this.options.classifyEntry)
    const orderChanged = beforeEntries.length !== afterEntries.length
      || beforeEntries.some((entry, index) => normalizePathKey(entry.path) !== normalizePathKey(afterEntries[index]!.path))
    const refreshedByPath = new Map(afterEntries.map((entry) => [normalizePathKey(entry.path), entry]))
    return {
      generation: session.generation,
      entries: paths.map((path) => refreshedByPath.get(normalizePathKey(path))!),
      orderChanged,
    }
  }

  async close(sessionId: string, remember = false): Promise<boolean> {
    const session = this.#sessions.get(sessionId)
    if (!session) return false
    if (remember) this.#rememberClosedSession(session)
    session.operation?.abort()
    const listingReload = session.listingReload
    abortListingReload(session)
    abortDirectorySizeOperations(session)
    const directorySizeWaiters = [...session.directorySizeWaiters]
    this.#sessions.delete(sessionId)
    await Promise.all([...session.searches].map((search) => search.close()))
    await listingReload?.catch(() => undefined)
    await Promise.all(directorySizeWaiters)
    await this.#closeWatcher(session)
    return true
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    const sessions = [...this.#sessions.values()]
    this.#sessions.clear()
    this.#closedSessions.clear()
    for (const session of sessions) {
      session.operation?.abort()
      const listingReload = session.listingReload
      abortListingReload(session)
      abortDirectorySizeOperations(session)
      const directorySizeWaiters = [...session.directorySizeWaiters]
      await Promise.all([...session.searches].map((search) => search.close()))
      await listingReload?.catch(() => undefined)
      await Promise.all(directorySizeWaiters)
      await this.#closeWatcher(session)
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Reader directory browser is closed.")
  }

  #rememberClosedSession(session: BrowserSession): void {
    this.#closedSessions.delete(session.id)
    this.#closedSessions.set(session.id, {
      currentNavigation: cloneNavigationEntry(session.currentNavigation),
      back: session.back.map(cloneNavigationEntry),
      forward: session.forward.map(cloneNavigationEntry),
      nextNavigationEntryId: session.nextNavigationEntryId,
      generation: session.generation,
      scopeId: session.scopeId,
      sort: { ...session.sort },
      filter: session.filter,
      showHiddenFolders: session.showHiddenFolders,
      sortPreference: cloneSortPreference(session.sortPreference),
      temporarySort: session.temporarySort ? cloneTemporarySort(session.temporarySort) : undefined,
      randomSeeds: new Map(session.randomSeeds),
      watchEnabled: session.watchEnabled,
    })
    while (this.#closedSessions.size > MAXIMUM_RECENTLY_CLOSED_SESSIONS) {
      this.#closedSessions.delete(this.#closedSessions.keys().next().value as string)
    }
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
    abortListingReload(session)
    const rawListing = await this.provider.read(session.listing.path, signal)
    const sortPreference = await this.sortPreferences.resolve(session.scopeId, rawListing.path, session.temporarySort)
    this.#assertSortAvailable(sortPreference.sort)
    const entries = applyCachedDirectorySizes(session, await this.#hydrate(rawListing.entries, sortPreference.sort, signal))
    signal.throwIfAborted()
    if (this.#sessions.get(session.id) !== session) return
    session.listing = sortListing(
      { ...rawListing, entries },
      sortPreference.sort,
      randomSeedForPath(session, rawListing.path),
    )
    session.listingReleased = false
    session.sort = sortPreference.sort
    session.sortPreference = sortPreference
    session.watchAppliedRevision = revision
    session.watchError = undefined
    session.generation += 1
  }

  async #ensureListing(session: BrowserSession, signal?: AbortSignal): Promise<void> {
    if (!session.listingReleased) return
    if (!session.listingReload) {
      const controller = new AbortController()
      session.listingReloadAbort = controller
      session.listingReload = this.#reloadReleasedListing(session, controller.signal).finally(() => {
        session.listingReload = undefined
        if (session.listingReloadAbort === controller) session.listingReloadAbort = undefined
      })
    }
    await waitForSharedRefresh(session.listingReload, signal)
  }

  async #reloadReleasedListing(session: BrowserSession, signal: AbortSignal): Promise<void> {
    const rawListing = await this.provider.read(session.listing.path, signal)
    const sortPreference = await this.sortPreferences.resolve(session.scopeId, rawListing.path, session.temporarySort)
    this.#assertSortAvailable(sortPreference.sort)
    const entries = applyCachedDirectorySizes(session, await this.#hydrate(rawListing.entries, sortPreference.sort, signal))
    signal.throwIfAborted()
    if (this.#sessions.get(session.id) !== session || !session.listingReleased) return
    session.listing = sortListing(
      { ...rawListing, entries },
      sortPreference.sort,
      randomSeedForPath(session, rawListing.path),
    )
    session.sort = sortPreference.sort
    session.sortPreference = sortPreference
    session.listingReleased = false
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
    const page = pageOf(session, cursor, limit, this.options.classifyEntry, suggestedSelectionValue, metadataFields, metadataCapabilities)
    if (!metadataFields.length || !this.metadataProvider) return page
    const entries = await this.metadataProvider.hydrate(page.entries, new Set(metadataFields), signal)
    signal?.throwIfAborted()
    return { ...page, entries }
  }
}

function abortDirectorySizeOperations(session: BrowserSession): readonly Promise<void>[] {
  for (const controller of session.directorySizeOperations) controller.abort(new DOMException("Reader directory generation changed", "AbortError"))
  session.directorySizeOperations.clear()
  return [...session.directorySizeWaiters]
}

function assertCurrentGeneration(session: BrowserSession, generation: number, operation: string): void {
  if (!Number.isSafeInteger(generation) || generation < 0 || generation !== session.generation) {
    throw new Error(`Reader directory ${operation} generation is stale: ${generation}`)
  }
}

function abortListingReload(session: BrowserSession): void {
  session.listingReloadAbort?.abort(new DOMException("Reader directory listing changed", "AbortError"))
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
  if (navigation.action === "back") return session.back.at(-1)?.path
  if (navigation.action === "forward") return session.forward.at(-1)?.path
  if (navigation.action === "up") return session.listing.parentPath
  return session.listing.path
}

function updateHistory(session: BrowserSession, navigation: ReaderDirectoryNavigation, resolvedPath: string): void {
  const currentPath = session.listing.path
  if (navigation.action === "refresh") return
  if (navigation.action === "back") {
    const target = session.back.pop()
    if (!target) return
    pushNavigationEntry(session.forward, session.currentNavigation)
    session.currentNavigation = { ...target, path: resolvedPath }
    return
  }
  if (navigation.action === "forward") {
    const target = session.forward.pop()
    if (!target) return
    pushNavigationEntry(session.back, session.currentNavigation)
    session.currentNavigation = { ...target, path: resolvedPath }
    return
  }
  if (resolvedPath === currentPath) return
  pushNavigationEntry(session.back, session.currentNavigation)
  session.forward.length = 0
  session.currentNavigation = { id: session.nextNavigationEntryId++, path: resolvedPath }
}

function targetNavigationEntry(session: BrowserSession, navigation: ReaderDirectoryNavigation): BrowserNavigationEntry | undefined {
  if (navigation.action === "back") return session.back.at(-1)
  if (navigation.action === "forward") return session.forward.at(-1)
  if (navigation.action === "refresh") return session.currentNavigation
}

function pushNavigationEntry(stack: BrowserNavigationEntry[], entry: BrowserNavigationEntry): void {
  stack.push(entry)
  if (stack.length > MAXIMUM_NAVIGATION_HISTORY) stack.shift()
}

function cloneNavigationEntry(entry: BrowserNavigationEntry): BrowserNavigationEntry {
  return {
    ...entry,
    temporarySort: entry.temporarySort ? cloneTemporarySort(entry.temporarySort) : undefined,
  }
}

function cloneTemporarySort(value: ReaderDirectoryTemporarySortRule): ReaderDirectoryTemporarySortRule {
  return { ...value, sort: { ...value.sort } }
}

function cloneSortPreference(value: ReaderDirectorySortPreferenceSnapshot): ReaderDirectorySortPreferenceSnapshot {
  return {
    ...value,
    sort: { ...value.sort },
    globalDefault: { ...value.globalDefault },
    tabDefault: { ...value.tabDefault },
  }
}

function syncCurrentNavigationTemporarySort(session: BrowserSession): void {
  session.currentNavigation.temporarySort = session.sortPreference.temporary ? session.temporarySort : undefined
}

function pageOf(
  session: BrowserSession,
  cursor: number,
  limit: number,
  classifyEntry: ReaderFileTreeServiceOptions["classifyEntry"],
  suggestedSelectionValue?: ReaderDirectoryPage["suggestedSelection"],
  metadataFields: readonly ReaderDirectoryMetadataField[] = [],
  metadataCapabilities: readonly ReaderDirectoryMetadataField[] = [],
): ReaderDirectoryPage {
  const catalog = filteredEntries(session, classifyEntry)
  const entries = catalog.slice(cursor, cursor + limit)
  const suggestedIndex = suggestedSelectionValue
    ? catalog.findIndex((entry) => normalizePathKey(entry.path) === normalizePathKey(suggestedSelectionValue.path))
    : -1
  return {
    sessionId: session.id,
    navigationEntryId: session.currentNavigation.id,
    path: session.listing.path,
    parentPath: session.listing.parentPath,
    entries,
    cursor,
    nextCursor: cursor + entries.length < catalog.length ? cursor + entries.length : undefined,
    total: catalog.length,
    canGoBack: session.back.length > 0,
    canGoForward: session.forward.length > 0,
    generation: session.generation,
    filter: session.filter,
    filterOptions: READER_DIRECTORY_FILTERS,
    showHiddenFolders: session.showHiddenFolders,
    sort: session.sort,
    sortFields: session.sortFields,
    metadataFields,
    metadataCapabilities,
    sortSource: session.sortPreference.source,
    sortTemporary: session.sortPreference.temporary,
    globalDefaultSort: session.sortPreference.globalDefault,
    tabDefaultSort: session.sortPreference.tabDefault,
    suggestedSelection: suggestedIndex < 0 ? undefined : { path: catalog[suggestedIndex]!.path, index: suggestedIndex },
    watching: Boolean(session.watch),
    watchError: session.watchError,
  }
}

function filteredEntries(
  session: BrowserSession,
  classifyEntry: ReaderFileTreeServiceOptions["classifyEntry"],
): readonly ReaderDirectoryEntry[] {
  return session.listing.entries.filter((entry) => {
    if (!session.showHiddenFolders && entry.kind === "directory" && entry.name.startsWith(".")) return false
    if (session.filter === "all") return true
    const type = entry.kind === "directory" ? "directory" : classifyEntry?.(entry) ?? "other"
    return readerDirectoryEntryMatchesFilter(type, session.filter)
  })
}

function sortListing(
  listing: ReaderDirectoryListing,
  sort: ReaderDirectorySortRule,
  randomSeed: string,
): ReaderDirectoryListing {
  return { ...listing, entries: sortReaderDirectoryEntries(listing.entries, sort, randomSeed) }
}

function applyCachedDirectorySizes(
  session: BrowserSession,
  entries: readonly ReaderDirectoryEntry[],
): readonly ReaderDirectoryEntry[] {
  if (!session.directorySizeCache.size) return entries
  return entries.map((entry) => {
    if (entry.kind !== "directory") return entry
    const bytes = session.directorySizeCache.get(entry.path)
    return bytes === undefined || entry.size === bytes ? entry : { ...entry, size: bytes }
  })
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
  targetEntry: BrowserNavigationEntry | undefined,
  listing: ReaderDirectoryListing,
  previousPath: string,
): ReaderDirectoryPage["suggestedSelection"] {
  const path = navigation.action === "up"
    ? previousPath
    : navigation.action === "back" || navigation.action === "forward"
      ? targetEntry?.focusPath
      : navigation.action === "refresh"
        ? navigation.focusPath
        : undefined
  if (!path) return undefined
  const index = listing.entries.findIndex((entry) => entry.path === path)
  return index < 0 ? undefined : { path, index }
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

function listingPayloadBudget(value: number | undefined): number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 && value <= MAX_MAX_LISTING_PAYLOAD_BYTES_UNDER_PRESSURE
    ? value
    : DEFAULT_MAX_LISTING_PAYLOAD_BYTES_UNDER_PRESSURE
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
