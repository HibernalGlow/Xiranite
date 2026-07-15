import type {
  ReaderDirectoryEntry,
  ReaderDirectoryListing,
  ReaderDirectoryListingProvider,
} from "../../ports/ReaderDirectoryListingProvider.js"
import type {
  ReaderDirectoryMetadataField,
  ReaderDirectoryMetadataProvider,
} from "../../ports/ReaderDirectoryMetadataProvider.js"
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
}

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
}

export class CoreReaderDirectoryBrowser implements AsyncDisposable {
  readonly #sessions = new Map<string, BrowserSession>()
  #nextSessionId = 1
  #closed = false

  constructor(
    private readonly provider: ReaderDirectoryListingProvider,
    private readonly metadataProvider?: ReaderDirectoryMetadataProvider,
    private readonly sortPreferences = new CoreReaderDirectorySortPreferences(),
  ) {}

  async open(
    path: string,
    signal?: AbortSignal,
    scopeId = "folder-main",
    displayFields: ReadonlySet<ReaderDirectoryMetadataField> = new Set(),
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
    }
    if (this.#sessions.size >= 8) this.close(this.#sessions.keys().next().value as string)
    this.#sessions.set(session.id, session)
    return this.#page(session, 0, 128, displayFields, signal)
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
    assertPage(cursor, limit, session.listing.entries.length)
    return this.#page(session, cursor, limit, displayFields, signal)
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

    session.operation?.abort()
    const controller = new AbortController()
    session.operation = controller
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
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
      return await this.#page(session, 0, 128, displayFields, combinedSignal, suggestedSelection(navigation, listing, previousPath))
    } finally {
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
    session.operation?.abort()
    const controller = new AbortController()
    session.operation = controller
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
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
    session.operation?.abort()
    const controller = new AbortController()
    session.operation = controller
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
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
      if (session.operation === controller) session.operation = undefined
    }
  }

  close(sessionId: string): boolean {
    const session = this.#sessions.get(sessionId)
    session?.operation?.abort()
    return this.#sessions.delete(sessionId)
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    for (const session of this.#sessions.values()) session.operation?.abort()
    this.#sessions.clear()
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
