import type {
  ReaderDirectoryPage,
  ReaderFileTreeService,
} from "../browser/ReaderFileTreeService.js"
import type { ReaderDirectoryFilter } from "../../domain/browser/ReaderDirectoryFilter.js"
import type {
  ReaderFileTreeExclusionCommand,
  ReaderFileTreeNodePage,
} from "../browser/ReaderFileTreeIndex.js"
import type {
  ReaderFileTreeSearchHandle,
  ReaderFileTreeSearchOptions,
} from "../browser/ReaderFileTreeSearch.js"
import {
  type ReaderSearchHistoryScope,
  ReaderSearchHistoryService,
} from "../browser/ReaderSearchHistoryService.js"
import type {
  ReaderEmmTagSuggestion,
  ReaderEmmTagSuggestionService,
} from "../metadata/ReaderEmmTagSuggestionService.js"

export interface ReaderSearchHistoryResource {
  service: ReaderSearchHistoryService
  close(): void | Promise<void>
}

export interface ReaderFileTreeHeadlessControllerOptions {
  loadSearchHistory?: () => Promise<ReaderSearchHistoryResource>
  loadEmmTagSuggestions?: () => Promise<ReaderEmmTagSuggestionService>
  closeResources?: () => void | Promise<void>
}

export interface OpenHeadlessFileTreeInput {
  path: string
  watch?: boolean
  signal?: AbortSignal
}

/** Single-session file-tree facade shared by CLI and terminal presentations. */
export class ReaderFileTreeHeadlessController implements AsyncDisposable {
  readonly #service: ReaderFileTreeService
  #sessionId: string | undefined
  #closed = false
  #disposing: Promise<void> | undefined
  #searchHistory?: Promise<ReaderSearchHistoryResource>
  #emmTagSuggestions?: Promise<ReaderEmmTagSuggestionService>

  constructor(service: ReaderFileTreeService, private readonly options: ReaderFileTreeHeadlessControllerOptions = {}) {
    this.#service = service
  }

  async open(input: OpenHeadlessFileTreeInput): Promise<ReaderDirectoryPage> {
    this.#assertOpen()
    const path = input.path.trim()
    if (!path) throw new Error("Reader file tree path must be a non-empty string.")
    const page = await this.#service.open(path, input.signal, "folder-headless", new Set(), undefined, input.watch === true)
    const previous = this.#sessionId
    this.#sessionId = page.sessionId
    if (previous) await this.#service.close(previous)
    return page
  }

  list(cursor = 0, limit = 128, signal?: AbortSignal): Promise<ReaderDirectoryPage | undefined> {
    return this.#service.list(this.#requireSession(), cursor, limit, new Set(), signal)
  }

  setFilter(filter: ReaderDirectoryFilter, focusPath?: string, signal?: AbortSignal): Promise<ReaderDirectoryPage | undefined> {
    return this.#service.setFilter(this.#requireSession(), filter, focusPath, signal)
  }

  tree(path?: string, refresh = false, signal?: AbortSignal): Promise<(ReaderFileTreeNodePage & { sessionId: string }) | undefined> {
    return this.#service.tree(this.#requireSession(), path, refresh, signal)
  }

  search(query: string, options?: ReaderFileTreeSearchOptions, signal?: AbortSignal): ReaderFileTreeSearchHandle {
    return this.#service.search(this.#requireSession(), query, options, signal)
  }

  updateExclusion(command: ReaderFileTreeExclusionCommand, signal?: AbortSignal) {
    return this.#service.updateTreeExclusion(this.#requireSession(), command, signal)
  }

  clearCache(path?: string) {
    return this.#service.clearTreeCache(this.#requireSession(), path)
  }

  directorySizes(generation: number, paths: readonly string[], signal?: AbortSignal) {
    return this.#service.directorySizes(this.#requireSession(), generation, paths, signal)
  }

  async listSearchHistory(scope: ReaderSearchHistoryScope, limit = 20) {
    return (await this.#requireSearchHistory()).service.list(scope, limit)
  }

  async recordSearchHistory(scope: ReaderSearchHistoryScope, query: string) {
    return (await this.#requireSearchHistory()).service.record(scope, query)
  }

  async removeSearchHistory(scope: ReaderSearchHistoryScope, query: string) {
    return (await this.#requireSearchHistory()).service.remove(scope, query)
  }

  async clearSearchHistory(scope: ReaderSearchHistoryScope) {
    return (await this.#requireSearchHistory()).service.clear(scope)
  }

  async suggestEmmTags(count = 8, signal?: AbortSignal): Promise<readonly ReaderEmmTagSuggestion[]> {
    return (await this.#requireEmmTagSuggestions()).suggest(count, signal)
  }

  async close(): Promise<void> {
    const sessionId = this.#sessionId
    this.#sessionId = undefined
    if (sessionId) await this.#service.close(sessionId)
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.#disposing) return this.#disposing
    this.#closed = true
    this.#disposing = Promise.resolve().then(async () => {
      this.#sessionId = undefined
      const errors: unknown[] = []
      try { await this.#service[Symbol.asyncDispose]() } catch (error) { errors.push(error) }
      try { await (await this.#searchHistory)?.close() } catch (error) { errors.push(error) }
      try { await this.#emmTagSuggestions } catch { /* failed lazy loads remain retryable until disposal */ }
      try { await this.options.closeResources?.() } catch (error) { errors.push(error) }
      if (errors.length) throw new AggregateError(errors, "Failed to dispose Reader file tree controller.")
    })
    return this.#disposing
  }

  #requireSession(): string {
    this.#assertOpen()
    if (!this.#sessionId) throw new Error("No Reader file tree is open.")
    return this.#sessionId
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Headless Reader file tree is closed.")
  }

  #requireSearchHistory(): Promise<ReaderSearchHistoryResource> {
    this.#assertOpen()
    if (!this.options.loadSearchHistory) throw new Error("Reader search history is unavailable.")
    if (this.#searchHistory) return this.#searchHistory
    const pending = this.options.loadSearchHistory()
    const guarded = pending.catch((error) => {
      if (this.#searchHistory === guarded) this.#searchHistory = undefined
      throw error
    })
    this.#searchHistory = guarded
    return guarded
  }

  #requireEmmTagSuggestions(): Promise<ReaderEmmTagSuggestionService> {
    this.#assertOpen()
    if (!this.options.loadEmmTagSuggestions) throw new Error("Reader EMM tag suggestions are unavailable.")
    if (this.#emmTagSuggestions) return this.#emmTagSuggestions
    const pending = this.options.loadEmmTagSuggestions()
    const guarded = pending.catch((error) => {
      if (this.#emmTagSuggestions === guarded) this.#emmTagSuggestions = undefined
      throw error
    })
    this.#emmTagSuggestions = guarded
    return guarded
  }
}
