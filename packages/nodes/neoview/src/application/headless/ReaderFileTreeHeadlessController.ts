import type {
  ReaderDirectoryPage,
  ReaderFileTreeService,
} from "../browser/ReaderFileTreeService.js"
import type {
  ReaderFileTreeExclusionCommand,
  ReaderFileTreeNodePage,
} from "../browser/ReaderFileTreeIndex.js"
import type {
  ReaderFileTreeSearchHandle,
  ReaderFileTreeSearchOptions,
} from "../browser/ReaderFileTreeSearch.js"

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

  constructor(service: ReaderFileTreeService) {
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
      await this.#service[Symbol.asyncDispose]()
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
}
