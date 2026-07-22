import {
  ReaderFileTreeService,
  type ReaderFileTreeMemorySnapshot,
  type ReaderDirectoryNavigation,
  type ReaderDirectorySortPreferenceCommand,
  type ReaderFileTreeServiceOptions,
} from "../../application/browser/ReaderFileTreeService.js"
import { READER_DIRECTORY_FILTERS } from "../../domain/browser/ReaderDirectoryFilter.js"
import {
  isReaderDirectorySortField,
  type ReaderDirectorySortRule,
} from "../../application/browser/ReaderDirectorySort.js"
import {
  CoreReaderDirectorySortPreferences,
  type ReaderDirectorySortPreferenceStore,
} from "../../application/browser/ReaderDirectorySortPreferences.js"
import { PlatformDirectoryListingProvider } from "../filesystem/PlatformDirectoryListingProvider.js"
import { canonicalizePlatformDirectoryPath, normalizePlatformDirectoryPath } from "../filesystem/PlatformDirectoryPath.js"
import { PlatformDirectoryMetadataProvider } from "../filesystem/PlatformDirectoryMetadataProvider.js"
import { PlatformFileTreeScanner } from "../filesystem/PlatformFileTreeScanner.js"
import { PlatformFileTreeWatcher } from "../filesystem/PlatformFileTreeWatcher.js"
import { PlatformReaderDirectorySizeProvider } from "../filesystem/PlatformReaderDirectorySizeProvider.js"
import { PlatformEmmCollectTagSource } from "../emm/PlatformEmmCollectTagSource.js"
import { PlatformEmmTranslationSource } from "../emm/PlatformEmmTranslationSource.js"
import { PlatformDirectoryRootProvider } from "../filesystem/PlatformDirectoryRootProvider.js"
import { platformReaderDirectoryEntryType } from "../filesystem/PlatformReaderDirectoryEntryClassifier.js"
import type { ReaderDirectoryRootProvider } from "../../ports/ReaderDirectoryRootProvider.js"
import type { ReaderDirectoryEmmRecordStore } from "../../ports/ReaderDirectoryEmmRecordStore.js"
import type {
  ReaderDirectoryMetadataField,
  ReaderDirectoryMetadataProvider,
} from "../../ports/ReaderDirectoryMetadataProvider.js"
import type {
  ReaderFileTreeSearchHandle,
  ReaderFileTreeSearchOptions,
} from "../../application/browser/ReaderFileTreeSearch.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import type { ReaderMediaTypeResolver } from "../../domain/page/media.js"
import {
  ReaderSearchHistoryService,
  type ReaderSearchHistoryScope,
} from "../../application/browser/ReaderSearchHistoryService.js"
import {
  ReaderDirectoryEmmEditService,
  ReaderDirectoryEmmEditSessionNotFound,
} from "../../application/metadata/ReaderDirectoryEmmEditService.js"
import { ReaderEmmMetadataService } from "../../application/metadata/ReaderEmmMetadataService.js"
import type { ReaderEmmOverrideStore } from "../../ports/ReaderEmmOverrideStore.js"
import { z } from "zod"
import { ReaderEmmTagSuggestionService } from "../../application/metadata/ReaderEmmTagSuggestionService.js"
import type { ReaderEmmTagCatalogStore } from "../../ports/ReaderEmmTagCatalogStore.js"
import type { ReaderManualTagCatalogStore } from "../../ports/ReaderManualTagCatalogStore.js"
import { emmTranslationKey } from "../../ports/ReaderEmmTagTranslation.js"
import {
  ReaderDirectorySelectionStaleError,
  type ReaderDirectorySelectionDescriptor,
} from "../../application/browser/ReaderDirectorySelection.js"
import {
  ReaderFolderPenetrationResolver,
  type ReaderFolderPenetrationPolicy,
} from "../../application/browser/ReaderFolderPenetrationResolver.js"

const BROWSER_SEARCH_HISTORY_PATH = "/reader/browser/search-history"
const BROWSER_EMM_TAG_SUGGESTIONS_PATH = "/reader/browser/emm-tags/suggestions"
const BROWSER_MANUAL_TAG_SUMMARIES_PATH = "/reader/browser/emm-tags/manual"
const BROWSER_ROOTS_PATH = "/reader/browser/roots"
const BROWSER_ENTRIES_PATH = /^\/reader\/browser\/s\/([^/]+)\/entries$/
const BROWSER_CHANGES_PATH = /^\/reader\/browser\/s\/([^/]+)\/changes$/
const BROWSER_DIRECTORY_SIZES_PATH = /^\/reader\/browser\/s\/([^/]+)\/directory-sizes$/
const BROWSER_EMM_METADATA_READ_PATH = /^\/reader\/browser\/s\/([^/]+)\/emm-metadata\/read$/
const BROWSER_EMM_METADATA_PATH = /^\/reader\/browser\/s\/([^/]+)\/emm-metadata$/
const BROWSER_SEARCH_PATH = /^\/reader\/browser\/s\/([^/]+)\/search$/
const BROWSER_TREE_PATH = /^\/reader\/browser\/s\/([^/]+)\/tree$/
const BROWSER_TREE_CHANGES_PATH = /^\/reader\/browser\/s\/([^/]+)\/tree\/changes$/
const BROWSER_TREE_CACHE_PATH = /^\/reader\/browser\/s\/([^/]+)\/tree\/cache$/
const BROWSER_TREE_EXCLUSIONS_PATH = /^\/reader\/browser\/s\/([^/]+)\/tree\/exclusions$/
const BROWSER_NAVIGATE_PATH = /^\/reader\/browser\/s\/([^/]+)\/navigate$/
const BROWSER_SORT_PATH = /^\/reader\/browser\/s\/([^/]+)\/sort$/
const BROWSER_SORT_PREFERENCES_PATH = /^\/reader\/browser\/s\/([^/]+)\/sort\/preferences$/
const BROWSER_FILTER_PATH = /^\/reader\/browser\/s\/([^/]+)\/filter$/
const BROWSER_SELECTION_PATH = /^\/reader\/browser\/s\/([^/]+)\/selection$/
const BROWSER_PENETRATION_RESOLVE_PATH = /^\/reader\/browser\/s\/([^/]+)\/penetration\/resolve$/
const BROWSER_CLONE_PATH = /^\/reader\/browser\/s\/([^/]+)\/clone$/
const BROWSER_REOPEN_PATH = /^\/reader\/browser\/s\/([^/]+)\/reopen$/
const BROWSER_SESSION_PATH = /^\/reader\/browser\/s\/([^/]+)$/
const DISPLAY_METADATA_FIELDS = new Set<ReaderDirectoryMetadataField>(["rating", "collectTagCount", "tags"])
const READER_DIRECTORY_METADATA_FIELDS = new Set<ReaderDirectoryMetadataField>([
  "date", "size", "rating", "collectTagCount", "dimensions", "pageCount", "tags",
])
const DirectoryFilterCommandSchema = z.object({
  filter: z.enum(READER_DIRECTORY_FILTERS),
  focusPath: z.string().trim().min(1).max(32_768).optional(),
  showHiddenFolders: z.boolean().optional(),
}).strict()
const FolderPenetrationCommandSchema = z.object({
  path: z.string().trim().min(1).max(32_768),
  policy: z.object({
    maxDepth: z.number().int().min(0).max(32).optional(),
    terminalTargets: z.array(z.enum(["archive", "document", "media-directory", "file"])).max(4).optional(),
  }).strict().optional(),
}).strict()

export class ReaderDirectoryBrowserRoute implements AsyncDisposable {
  readonly #browser: ReaderFileTreeService
  readonly #penetration: ReaderFolderPenetrationResolver
  readonly #searchHistory?: ReaderSearchHistoryService
  readonly #emmEditor?: ReaderDirectoryEmmEditService
  readonly #emmTagSuggestions?: ReaderEmmTagSuggestionService
  readonly #manualTagCatalog?: ReaderManualTagCatalogStore
  readonly #emmTranslations: PlatformEmmTranslationSource

  constructor(
    sortPreferenceStore?: ReaderDirectorySortPreferenceStore,
    emmRecordStore?: ReaderDirectoryEmmRecordStore & Partial<ReaderEmmTagCatalogStore>,
    mediaMetadataProvider?: ReaderDirectoryMetadataProvider,
    fileTreeOptions: ReaderFileTreeServiceOptions = {},
    resourceScheduler?: ResourceScheduler,
    searchHistory?: ReaderSearchHistoryService,
    private readonly directoryRootProvider: ReaderDirectoryRootProvider = new PlatformDirectoryRootProvider(),
    mediaFormats?: ReaderMediaTypeResolver,
    emmOverrideStore?: ReaderEmmOverrideStore,
    collectTagSource = new PlatformEmmCollectTagSource(),
    emmTranslations = new PlatformEmmTranslationSource(),
    manualTagCatalog?: ReaderManualTagCatalogStore,
  ) {
    this.#manualTagCatalog = manualTagCatalog
    this.#emmTranslations = emmTranslations
    this.#searchHistory = searchHistory
    const listingProvider = new PlatformDirectoryListingProvider(mediaFormats)
    this.#browser = new ReaderFileTreeService(
      listingProvider,
      new PlatformDirectoryMetadataProvider(emmRecordStore, collectTagSource, undefined, mediaMetadataProvider),
      new CoreReaderDirectorySortPreferences(sortPreferenceStore),
      {
        ...fileTreeOptions,
        scanner: fileTreeOptions.scanner ?? new PlatformFileTreeScanner(resourceScheduler),
        watcher: fileTreeOptions.watcher ?? new PlatformFileTreeWatcher(),
        directorySizeProvider: fileTreeOptions.directorySizeProvider ?? new PlatformReaderDirectorySizeProvider({ resourceScheduler }),
        classifyEntry: fileTreeOptions.classifyEntry ?? ((entry) => platformReaderDirectoryEntryType(entry, mediaFormats)),
      },
    )
    this.#penetration = new ReaderFolderPenetrationResolver(listingProvider, { mediaFormats })
    this.#emmEditor = emmOverrideStore
      ? new ReaderDirectoryEmmEditService(new ReaderEmmMetadataService(emmOverrideStore), this.#browser)
      : undefined
    this.#emmTagSuggestions = isEmmTagCatalogStore(emmRecordStore)
      ? new ReaderEmmTagSuggestionService(emmRecordStore, collectTagSource, undefined, {
          translate: (tags, signal) => emmTranslations.translate(tags, signal),
          key: emmTranslationKey,
        })
      : undefined
  }

  async handle(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url)
    if (url.pathname === BROWSER_EMM_TAG_SUGGESTIONS_PATH && request.method === "GET") return this.#suggestEmmTags(url, request.signal)
    if (url.pathname === BROWSER_MANUAL_TAG_SUMMARIES_PATH && request.method === "GET") return this.#manualTags(url, request.signal)
    if (url.pathname === BROWSER_SEARCH_HISTORY_PATH) return this.#handleSearchHistory(request, url)
    if (url.pathname === BROWSER_ROOTS_PATH && request.method === "GET") return this.#roots(request.signal)
    if (url.pathname === "/reader/browser/sessions" && request.method === "POST") return this.#open(request)

    const entriesMatch = BROWSER_ENTRIES_PATH.exec(url.pathname)
    if (entriesMatch && request.method === "GET") return this.#list(entriesMatch[1]!, url, request.signal)
    const changesMatch = BROWSER_CHANGES_PATH.exec(url.pathname)
    if (changesMatch && request.method === "GET") return this.#changes(changesMatch[1]!, url, request.signal)
    const directorySizesMatch = BROWSER_DIRECTORY_SIZES_PATH.exec(url.pathname)
    if (directorySizesMatch && request.method === "POST") return this.#directorySizes(directorySizesMatch[1]!, request)
    const emmMetadataReadMatch = BROWSER_EMM_METADATA_READ_PATH.exec(url.pathname)
    if (emmMetadataReadMatch && request.method === "POST") return this.#readEmmMetadata(emmMetadataReadMatch[1]!, request)
    const emmMetadataMatch = BROWSER_EMM_METADATA_PATH.exec(url.pathname)
    if (emmMetadataMatch && request.method === "PATCH") return this.#editEmmMetadata(emmMetadataMatch[1]!, request)
    const searchMatch = BROWSER_SEARCH_PATH.exec(url.pathname)
    if (searchMatch && request.method === "GET") return this.#search(searchMatch[1]!, url, request)
    const treeChangesMatch = BROWSER_TREE_CHANGES_PATH.exec(url.pathname)
    if (treeChangesMatch && request.method === "GET") return this.#treeChanges(treeChangesMatch[1]!, url, request.signal)
    const treeCacheMatch = BROWSER_TREE_CACHE_PATH.exec(url.pathname)
    if (treeCacheMatch && request.method === "DELETE") return this.#clearTreeCache(treeCacheMatch[1]!, url)
    const treeExclusionsMatch = BROWSER_TREE_EXCLUSIONS_PATH.exec(url.pathname)
    if (treeExclusionsMatch && request.method === "PATCH") return this.#updateTreeExclusion(treeExclusionsMatch[1]!, request)
    const treeMatch = BROWSER_TREE_PATH.exec(url.pathname)
    if (treeMatch && request.method === "GET") return this.#tree(treeMatch[1]!, url, request.signal)
    const navigateMatch = BROWSER_NAVIGATE_PATH.exec(url.pathname)
    if (navigateMatch && request.method === "POST") return this.#navigate(navigateMatch[1]!, request)
    const sortPreferencesMatch = BROWSER_SORT_PREFERENCES_PATH.exec(url.pathname)
    if (sortPreferencesMatch && request.method === "PATCH") return this.#sortPreferences(sortPreferencesMatch[1]!, request)
    const sortMatch = BROWSER_SORT_PATH.exec(url.pathname)
    if (sortMatch && request.method === "PATCH") return this.#sort(sortMatch[1]!, request)
    const filterMatch = BROWSER_FILTER_PATH.exec(url.pathname)
    if (filterMatch && request.method === "PATCH") return this.#filter(filterMatch[1]!, request)
    const selectionMatch = BROWSER_SELECTION_PATH.exec(url.pathname)
    if (selectionMatch && request.method === "POST") return this.#selection(selectionMatch[1]!, request)
    const penetrationMatch = BROWSER_PENETRATION_RESOLVE_PATH.exec(url.pathname)
    if (penetrationMatch && request.method === "POST") return this.#resolvePenetration(penetrationMatch[1]!, request)
    const cloneMatch = BROWSER_CLONE_PATH.exec(url.pathname)
    if (cloneMatch && request.method === "POST") return this.#clone(cloneMatch[1]!, request)
    const reopenMatch = BROWSER_REOPEN_PATH.exec(url.pathname)
    if (reopenMatch && request.method === "POST") return this.#reopen(reopenMatch[1]!, request)
    const sessionMatch = BROWSER_SESSION_PATH.exec(url.pathname)
    if (sessionMatch && request.method === "DELETE") {
      const sessionId = safeDecode(sessionMatch[1]!)
      return sessionId && await this.#browser.close(sessionId, url.searchParams.get("remember") === "1") ? new Response(null, { status: 204 }) : errorResponse("Browser session not found", 404)
    }
    return undefined
  }

  async #handleSearchHistory(request: Request, url: URL): Promise<Response> {
    if (!this.#searchHistory) return errorResponse("Reader search history is unavailable", 503)
    try {
      if (request.method === "GET") {
        const scope = searchHistoryScope(url.searchParams.get("scope"))
        const limit = optionalInteger(url.searchParams.get("limit"), "limit", 1, 100) ?? 20
        return Response.json({ scope, entries: await this.#searchHistory.list(scope, limit) }, responseInit())
      }
      if (request.method === "POST") {
        const body = await request.json().catch(() => undefined) as { scope?: unknown; query?: unknown } | undefined
        if (typeof body?.scope !== "string" || typeof body.query !== "string") {
          return errorResponse("Search history requires string scope and query", 400)
        }
        const entry = await this.#searchHistory.record(searchHistoryScope(body.scope), body.query)
        return Response.json(entry, responseInit(201))
      }
      if (request.method === "DELETE") {
        const scope = searchHistoryScope(url.searchParams.get("scope"))
        const query = url.searchParams.get("query")
        return Response.json(query === null
          ? { scope, cleared: await this.#searchHistory.clear(scope) }
          : { scope, query, removed: await this.#searchHistory.remove(scope, query) }, responseInit())
      }
      return errorResponse("Search history method not allowed", 405)
    } catch (error) {
      return errorResponse(errorMessage(error), 400)
    }
  }

  async #suggestEmmTags(url: URL, signal: AbortSignal): Promise<Response> {
    if (!this.#emmTagSuggestions) return errorResponse("Reader EMM tag suggestions are unavailable", 503)
    try {
      const count = optionalInteger(url.searchParams.get("count"), "count", 1, 32) ?? 8
      return Response.json({ tags: await this.#emmTagSuggestions.suggest(count, signal) }, responseInit())
    } catch (error) {
      if (signal.aborted) throw error
      return errorResponse(errorMessage(error), 400)
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.#emmTranslations.clear()
    await this.#browser[Symbol.asyncDispose]()
  }

  async #roots(signal: AbortSignal): Promise<Response> {
    try {
      return Response.json({ roots: await this.directoryRootProvider.list(signal) }, responseInit())
    } catch (error) {
      if (signal.aborted) throw error
      return errorResponse(errorMessage(error), 503)
    }
  }

  async #selection(encodedSessionId: string, request: Request): Promise<Response> {
    const sessionId = safeDecode(encodedSessionId)
    if (!sessionId) return errorResponse("Invalid browser session id", 400)
    const body = await request.json().catch(() => undefined) as {
      selection?: ReaderDirectorySelectionDescriptor
      previewLimit?: unknown
    } | undefined
    if (!body?.selection || typeof body.selection !== "object") return errorResponse("selection must be an object", 400)
    let previewLimit: number
    try {
      previewLimit = body.previewLimit === undefined ? 0 : bodyInteger(body.previewLimit, "previewLimit", 0, 128)
      const source = await this.#browser.resolveSelection(sessionId, body.selection, request.signal)
      if (!source) return errorResponse("Browser session not found", 404)
      const preview = previewLimit > 0
        ? [...source.batches(previewLimit, request.signal)][0]?.map((entry) => entry.path) ?? []
        : []
      return Response.json({
        sessionId,
        generation: source.generation,
        total: source.total,
        selectedCount: source.selectedCount,
        preview,
        truncated: source.selectedCount > preview.length,
      }, responseInit())
    } catch (error) {
      if (request.signal.aborted) throw error
      return errorResponse(errorMessage(error), error instanceof ReaderDirectorySelectionStaleError ? 409 : 400)
    }
  }

  releaseMemoryPressure(): {
    clearedTreeEntries: number
    cancelledDirectorySizes: number
    clearedRandomSeeds: number
    releasedListingEntries: number
    releasedListingPayloadBytes: number
  } {
    this.#emmTranslations.clear()
    return this.#browser.releaseMemoryPressure()
  }

  memorySnapshot(): ReaderFileTreeMemorySnapshot {
    return this.#browser.memorySnapshot()
  }

  resolveSelection(
    sessionId: string,
    descriptor: ReaderDirectorySelectionDescriptor,
    signal?: AbortSignal,
  ) {
    return this.#browser.resolveSelection(sessionId, descriptor, signal)
  }

  async #open(request: Request): Promise<Response> {
    const body = await request.json().catch(() => undefined) as { path?: unknown; scopeId?: unknown; watch?: unknown } | undefined
    if (typeof body?.path !== "string" || !body.path.trim()) return errorResponse("path must be a non-empty string", 400)
    if (body.scopeId !== undefined && (typeof body.scopeId !== "string" || !body.scopeId.trim())) return errorResponse("scopeId must be a non-empty string", 400)
    if (body.watch !== undefined && typeof body.watch !== "boolean") return errorResponse("watch must be a boolean", 400)
    try {
      const resolvedPath = await canonicalizePlatformDirectoryPath(body.path)
      const pathStats = await stat(resolvedPath)
      const directoryPath = pathStats.isDirectory() ? resolvedPath : dirname(resolvedPath)
      const focusPath = pathStats.isDirectory() ? undefined : resolvedPath
      return Response.json(await this.#browser.open(
        directoryPath,
        request.signal,
        typeof body.scopeId === "string" ? body.scopeId : undefined,
        DISPLAY_METADATA_FIELDS,
        focusPath,
        body.watch === true,
      ), responseInit(201))
    } catch (error) {
      if (request.signal.aborted) throw error
      return errorResponse(errorMessage(error), 400)
    }
  }

  async #list(encodedSessionId: string, url: URL, signal: AbortSignal): Promise<Response> {
    const sessionId = safeDecode(encodedSessionId)
    if (!sessionId) return errorResponse("Browser session not found", 404)
    const cursor = integer(url.searchParams.get("cursor"), 0)
    const limit = integer(url.searchParams.get("limit"), 128)
    try {
      const result = await this.#browser.list(sessionId, cursor, limit, requestedMetadataFields(url), signal)
      return result ? Response.json(result, responseInit()) : errorResponse("Browser session not found", 404)
    } catch (error) {
      return errorResponse(errorMessage(error), 400)
    }
  }

  async #clone(encodedSessionId: string, request: Request): Promise<Response> {
    const sessionId = safeDecode(encodedSessionId)
    if (!sessionId) return errorResponse("Browser session not found", 404)
    try {
      const result = await this.#browser.clone(sessionId, request.signal, DISPLAY_METADATA_FIELDS)
      return result ? Response.json(result, responseInit(201)) : errorResponse("Browser session not found", 404)
    } catch (error) {
      if (request.signal.aborted) throw error
      return errorResponse(errorMessage(error), 400)
    }
  }

  async #reopen(encodedSessionId: string, request: Request): Promise<Response> {
    const sessionId = safeDecode(encodedSessionId)
    if (!sessionId) return errorResponse("Browser session not found", 404)
    try {
      const result = await this.#browser.reopen(sessionId, request.signal, DISPLAY_METADATA_FIELDS)
      return result ? Response.json(result, responseInit(201)) : errorResponse("Recently closed browser session not found", 404)
    } catch (error) {
      if (request.signal.aborted) throw error
      return errorResponse(errorMessage(error), 400)
    }
  }

  async #changes(encodedSessionId: string, url: URL, signal: AbortSignal): Promise<Response> {
    const sessionId = safeDecode(encodedSessionId)
    if (!sessionId) return errorResponse("Browser session not found", 404)
    const afterGeneration = integer(url.searchParams.get("after"), -1)
    const waitMs = optionalInteger(url.searchParams.get("wait"), "wait", 10, 30_000) ?? 25_000
    try {
      const result = await this.#browser.waitForChanges(
        sessionId,
        afterGeneration,
        waitMs,
        DISPLAY_METADATA_FIELDS,
        url.searchParams.get("focus") ?? undefined,
        signal,
      )
      if (result === null) return new Response(null, responseInit(204))
      return result ? Response.json(result, responseInit()) : errorResponse("Browser session not found", 404)
    } catch (error) {
      if (signal.aborted) throw error
      return errorResponse(errorMessage(error), 400)
    }
  }

  async #directorySizes(encodedSessionId: string, request: Request): Promise<Response> {
    const sessionId = safeDecode(encodedSessionId)
    if (!sessionId) return errorResponse("Browser session not found", 404)
    const body = await request.json().catch(() => undefined) as { generation?: unknown; paths?: unknown } | undefined
    if (!Number.isSafeInteger(body?.generation) || !Array.isArray(body?.paths) || !body.paths.every((path) => typeof path === "string" && path.length > 0)) {
      return errorResponse("Directory size request requires an integer generation and non-empty string paths", 400)
    }
    try {
      const result = await this.#browser.directorySizes(sessionId, body.generation as number, body.paths as string[], request.signal)
      return result ? Response.json(result, responseInit()) : errorResponse("Browser session not found", 404)
    } catch (error) {
      if (request.signal.aborted) throw error
      const message = errorMessage(error)
      return errorResponse(message, message.includes("stale") ? 409 : 400)
    }
  }

  async #editEmmMetadata(encodedSessionId: string, request: Request): Promise<Response> {
    const sessionId = safeDecode(encodedSessionId)
    if (!sessionId) return errorResponse("Browser session not found", 404)
    if (!this.#emmEditor) return errorResponse("Reader EMM metadata editing is unavailable", 503)
    const body = await request.json().catch(() => undefined)
    try {
      return Response.json(await this.#emmEditor.update(
        sessionId,
        body as Parameters<ReaderDirectoryEmmEditService["update"]>[1],
        request.signal,
      ), responseInit())
    } catch (error) {
      if (request.signal.aborted) throw error
      if (error instanceof ReaderDirectoryEmmEditSessionNotFound) return errorResponse(error.message, 404)
      if (error instanceof z.ZodError) return errorResponse("Reader directory EMM edit command is invalid", 400)
      const message = errorMessage(error)
      return errorResponse(message, message.includes("stale") ? 409 : 400)
    }
  }

  async #manualTags(url: URL, signal: AbortSignal): Promise<Response> {
    if (!this.#manualTagCatalog) return errorResponse("Reader manual tags are unavailable", 503)
    try {
      const limit = optionalInteger(url.searchParams.get("limit"), "limit", 1, 256) ?? 64
      return Response.json({ tags: await this.#manualTagCatalog.listManualTagSummaries(limit, signal) }, responseInit())
    } catch (error) {
      if (signal.aborted) throw error
      return errorResponse(errorMessage(error), 400)
    }
  }

  async #readEmmMetadata(encodedSessionId: string, request: Request): Promise<Response> {
    const sessionId = safeDecode(encodedSessionId)
    if (!sessionId) return errorResponse("Browser session not found", 404)
    if (!this.#emmEditor) return errorResponse("Reader EMM metadata editing is unavailable", 503)
    const body = await request.json().catch(() => undefined)
    try {
      return Response.json(await this.#emmEditor.read(
        sessionId,
        body as Parameters<ReaderDirectoryEmmEditService["read"]>[1],
        request.signal,
      ), responseInit())
    } catch (error) {
      if (request.signal.aborted) throw error
      if (error instanceof ReaderDirectoryEmmEditSessionNotFound) return errorResponse(error.message, 404)
      if (error instanceof z.ZodError) return errorResponse("Reader directory EMM read command is invalid", 400)
      const message = errorMessage(error)
      return errorResponse(message, message.includes("stale") ? 409 : 400)
    }
  }

  #search(encodedSessionId: string, url: URL, request: Request): Response {
    const sessionId = safeDecode(encodedSessionId)
    if (!sessionId) return errorResponse("Browser session not found", 404)
    try {
      const parsed = parseSearch(url)
      const search = this.#browser.search(sessionId, parsed.query, parsed.options, request.signal)
      return ndjsonResponse(search, request.signal)
    } catch (error) {
      return errorResponse(errorMessage(error), errorMessage(error).includes("session not found") ? 404 : 400)
    }
  }

  async #tree(encodedSessionId: string, url: URL, signal: AbortSignal): Promise<Response> {
    const sessionId = safeDecode(encodedSessionId)
    if (!sessionId) return errorResponse("Browser session not found", 404)
    const refresh = url.searchParams.get("refresh")
    if (refresh !== null && refresh !== "0" && refresh !== "1") return errorResponse("refresh must be 0 or 1", 400)
    try {
      const requestedPath = url.searchParams.get("path")
      const normalizedPath = requestedPath === null ? undefined : normalizePlatformDirectoryPath(requestedPath)
      const result = await this.#browser.tree(sessionId, normalizedPath, refresh === "1", signal)
      return result ? Response.json(result, responseInit()) : errorResponse("Browser session not found", 404)
    } catch (error) {
      if (signal.aborted) throw error
      return errorResponse(errorMessage(error), 400)
    }
  }

  async #treeChanges(encodedSessionId: string, url: URL, signal: AbortSignal): Promise<Response> {
    const sessionId = safeDecode(encodedSessionId)
    if (!sessionId) return errorResponse("Browser session not found", 404)
    const afterRevision = integer(url.searchParams.get("after"), -1)
    const waitMs = optionalInteger(url.searchParams.get("wait"), "wait", 10, 30_000) ?? 25_000
    try {
      const result = await this.#browser.waitForTreeChanges(sessionId, afterRevision, waitMs, signal)
      if (result === null) return new Response(null, responseInit(204))
      return result ? Response.json(result, responseInit()) : errorResponse("Browser session not found", 404)
    } catch (error) {
      if (signal.aborted) throw error
      return errorResponse(errorMessage(error), 400)
    }
  }

  #clearTreeCache(encodedSessionId: string, url: URL): Response {
    const sessionId = safeDecode(encodedSessionId)
    if (!sessionId) return errorResponse("Browser session not found", 404)
    try {
      const result = this.#browser.clearTreeCache(sessionId, url.searchParams.get("path") ?? undefined)
      return result ? Response.json(result, responseInit()) : errorResponse("Browser session not found", 404)
    } catch (error) {
      return errorResponse(errorMessage(error), 400)
    }
  }

  async #updateTreeExclusion(encodedSessionId: string, request: Request): Promise<Response> {
    const sessionId = safeDecode(encodedSessionId)
    if (!sessionId) return errorResponse("Browser session not found", 404)
    const body = await request.json().catch(() => undefined) as { action?: unknown; path?: unknown } | undefined
    if ((body?.action !== "exclude" && body?.action !== "include") || typeof body.path !== "string" || !body.path.trim()) {
      return errorResponse("Tree exclusion requires action=exclude|include and a non-empty path", 400)
    }
    try {
      const result = await this.#browser.updateTreeExclusion(sessionId, { action: body.action, path: body.path }, request.signal)
      return result ? Response.json(result, responseInit()) : errorResponse("Browser session not found", 404)
    } catch (error) {
      if (request.signal.aborted) throw error
      const message = errorMessage(error)
      return errorResponse(message, message.includes("read-only") ? 405 : 400)
    }
  }

  async #navigate(encodedSessionId: string, request: Request): Promise<Response> {
    const sessionId = safeDecode(encodedSessionId)
    if (!sessionId) return errorResponse("Browser session not found", 404)
    const body = await request.json().catch(() => undefined) as { action?: unknown; path?: unknown } | undefined
    const navigation = parseNavigation(body)
    if (!navigation) return errorResponse("Invalid browser navigation", 400)
    try {
      const result = await this.#browser.navigate(sessionId, navigation, request.signal, DISPLAY_METADATA_FIELDS)
      return result ? Response.json(result, responseInit()) : errorResponse("Browser session not found", 404)
    } catch (error) {
      if (request.signal.aborted) throw error
      return errorResponse(errorMessage(error), 400)
    }
  }

  async #resolvePenetration(encodedSessionId: string, request: Request): Promise<Response> {
    const sessionId = safeDecode(encodedSessionId)
    if (!sessionId) return errorResponse("Browser session not found", 404)
    const parsed = FolderPenetrationCommandSchema.safeParse(await request.json().catch(() => undefined))
    if (!parsed.success) return errorResponse("Invalid folder penetration request", 400)
    try {
      const session = await this.#browser.list(sessionId, 0, 1, new Set(), request.signal)
      if (!session) return errorResponse("Browser session not found", 404)
      const policy: ReaderFolderPenetrationPolicy = parsed.data.policy ?? {}
      return Response.json(await this.#penetration.resolve(parsed.data.path, policy, request.signal), responseInit())
    } catch (error) {
      if (request.signal.aborted) throw error
      return errorResponse(errorMessage(error), 400)
    }
  }

  async #sort(encodedSessionId: string, request: Request): Promise<Response> {
    const sessionId = safeDecode(encodedSessionId)
    if (!sessionId) return errorResponse("Browser session not found", 404)
    const body = await request.json().catch(() => undefined) as Record<string, unknown> | undefined
    const command = parseSort(body)
    if (!command) return errorResponse("Invalid browser sort", 400)
    try {
      const result = await this.#browser.sort(sessionId, command.sort, command.focusPath, request.signal, DISPLAY_METADATA_FIELDS)
      return result ? Response.json(result, responseInit()) : errorResponse("Browser session not found", 404)
    } catch (error) {
      if (request.signal.aborted) throw error
      return errorResponse(errorMessage(error), 400)
    }
  }

  async #filter(encodedSessionId: string, request: Request): Promise<Response> {
    const sessionId = safeDecode(encodedSessionId)
    if (!sessionId) return errorResponse("Browser session not found", 404)
    const parsed = DirectoryFilterCommandSchema.safeParse(await request.json().catch(() => undefined))
    if (!parsed.success) return errorResponse("Invalid browser filter", 400)
    try {
      const result = await this.#browser.setFilter(
        sessionId,
        parsed.data.filter,
        parsed.data.focusPath,
        request.signal,
        DISPLAY_METADATA_FIELDS,
        parsed.data.showHiddenFolders,
      )
      return result ? Response.json(result, responseInit()) : errorResponse("Browser session not found", 404)
    } catch (error) {
      if (request.signal.aborted) throw error
      return errorResponse(errorMessage(error), 400)
    }
  }

  async #sortPreferences(encodedSessionId: string, request: Request): Promise<Response> {
    const sessionId = safeDecode(encodedSessionId)
    if (!sessionId) return errorResponse("Browser session not found", 404)
    const body = await request.json().catch(() => undefined) as Record<string, unknown> | undefined
    const command = parseSortPreferenceCommand(body)
    if (!command) return errorResponse("Invalid browser sort preference command", 400)
    try {
      const result = await this.#browser.updateSortPreference(
        sessionId,
        command,
        typeof body?.focusPath === "string" ? body.focusPath : undefined,
        request.signal,
        DISPLAY_METADATA_FIELDS,
      )
      return result ? Response.json(result, responseInit()) : errorResponse("Browser session not found", 404)
    } catch (error) {
      if (request.signal.aborted) throw error
      return errorResponse(errorMessage(error), 400)
    }
  }
}

function requestedMetadataFields(url: URL): ReadonlySet<ReaderDirectoryMetadataField> {
  const fields = new Set(DISPLAY_METADATA_FIELDS)
  const raw = url.searchParams.get("fields")
  if (!raw) return fields
  for (const value of raw.split(",")) {
    if (!READER_DIRECTORY_METADATA_FIELDS.has(value as ReaderDirectoryMetadataField)) {
      throw new Error(`Unsupported directory metadata field: ${value}`)
    }
    fields.add(value as ReaderDirectoryMetadataField)
  }
  return fields
}

function parseSearch(url: URL): { query: string; options: ReaderFileTreeSearchOptions } {
  const mode = url.searchParams.get("mode") ?? "text"
  if (mode !== "text" && mode !== "glob") throw new Error("mode must be text or glob")
  const kind = url.searchParams.get("kind") ?? "all"
  if (kind !== "all" && kind !== "file" && kind !== "directory") throw new Error("kind must be all, file, or directory")
  const caseValue = url.searchParams.get("case")
  if (caseValue !== null && caseValue !== "0" && caseValue !== "1") throw new Error("case must be 0 or 1")
  const pathValue = url.searchParams.get("path")
  if (pathValue !== null && pathValue !== "0" && pathValue !== "1") throw new Error("path must be 0 or 1")
  return {
    query: url.searchParams.get("q") ?? "",
    options: {
      mode,
      kind,
      caseSensitive: caseValue === "1",
      searchInPath: pathValue === "1",
      maximumDepth: optionalInteger(url.searchParams.get("depth"), "depth", 0, 4_096),
      maximumResults: optionalInteger(url.searchParams.get("limit"), "limit", 1, 10_000),
      excludePatterns: url.searchParams.getAll("exclude"),
      includeTags: url.searchParams.getAll("tag"),
      excludeTags: url.searchParams.getAll("excludeTag"),
      tagMode: tagMode(url.searchParams.get("tagMode")),
    },
  }
}

function tagMode(value: string | null): "all" | "any" | undefined {
  if (value === null) return undefined
  if (value === "all" || value === "any") return value
  throw new Error("tagMode must be all or any")
}

function isEmmTagCatalogStore(value: ReaderDirectoryEmmRecordStore | undefined): value is ReaderDirectoryEmmRecordStore & ReaderEmmTagCatalogStore {
  return typeof (value as Partial<ReaderEmmTagCatalogStore> | undefined)?.sampleEmmTags === "function"
}

function parseNavigation(body: { action?: unknown; path?: unknown; focusPath?: unknown } | undefined): ReaderDirectoryNavigation | undefined {
  if (body?.focusPath !== undefined && (typeof body.focusPath !== "string" || !body.focusPath.trim())) return undefined
  const focusPath = typeof body?.focusPath === "string" ? body.focusPath : undefined
  if (body?.action === "path") return typeof body.path === "string" && body.path.trim() ? { action: "path", path: body.path, focusPath } : undefined
  if (body?.action === "back" || body?.action === "forward" || body?.action === "up" || body?.action === "refresh") return { action: body.action, focusPath }
  return undefined
}

function parseSort(body: Record<string, unknown> | undefined): { sort: ReaderDirectorySortRule; focusPath?: string } | undefined {
  if (!isReaderDirectorySortField(body?.field)) return undefined
  if (body?.order !== "asc" && body?.order !== "desc") return undefined
  if (body.directoriesFirst !== undefined && typeof body.directoriesFirst !== "boolean") return undefined
  if (body.focusPath !== undefined && (typeof body.focusPath !== "string" || !body.focusPath.trim())) return undefined
  return {
    sort: { field: body.field, order: body.order, directoriesFirst: body.directoriesFirst ?? true },
    focusPath: typeof body.focusPath === "string" ? body.focusPath : undefined,
  }
}

function parseSortPreferenceCommand(body: Record<string, unknown> | undefined): ReaderDirectorySortPreferenceCommand | undefined {
  if (body?.focusPath !== undefined && (typeof body.focusPath !== "string" || !body.focusPath.trim())) return undefined
  if (body?.action === "temporary" && typeof body.enabled === "boolean") return { action: "temporary", enabled: body.enabled }
  if (body?.action === "set-default" && (body.scope === "global" || body.scope === "tab")) {
    return { action: "set-default", scope: body.scope }
  }
  if (body?.action === "clear-memory" && (body.scope === "current" || body.scope === "all")) {
    return { action: "clear-memory", scope: body.scope }
  }
  return undefined
}

function integer(value: string | null, fallback: number): number {
  if (value === null) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : fallback
}

function optionalInteger(value: string | null, name: string, minimum: number, maximum: number): number | undefined {
  if (value === null) return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return parsed
}

function bodyInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return value as number
}

function searchHistoryScope(value: string | null): ReaderSearchHistoryScope {
  if (value === "folder" || value === "file" || value === "bookmark" || value === "history") return value
  throw new Error("scope must be folder, file, bookmark or history")
}

function safeDecode(value: string): string | undefined {
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorResponse(error: string, status: number): Response {
  return Response.json({ error }, responseInit(status))
}

function responseInit(status = 200): ResponseInit {
  return { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } }
}

function ndjsonResponse(
  search: ReaderFileTreeSearchHandle,
  requestSignal: AbortSignal,
): Response {
  const iterator = search.events[Symbol.asyncIterator]()
  const encoder = new TextEncoder()
  let finished = false
  const finish = async () => {
    if (finished) return false
    finished = true
    await search.close()
    return true
  }
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return
      try {
        const next = await iterator.next()
        if (next.done) {
          await finish()
          controller.close()
          return
        }
        controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`))
      } catch (error) {
        let output = ""
        if (!requestSignal.aborted) {
          output += `${JSON.stringify({ type: "error", error: errorMessage(error) })}\n`
        }
        await finish()
        if (output) controller.enqueue(encoder.encode(output))
        controller.close()
      }
    },
    async cancel(reason) {
      void reason
      await finish()
    },
  })
  return new Response(stream, {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  })
}
import { stat } from "node:fs/promises"
import { dirname } from "node:path"
