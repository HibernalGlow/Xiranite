import type {
  ReaderDirectoryEntry,
  ReaderDirectoryListing,
  ReaderDirectoryListingProvider,
} from "../../ports/ReaderDirectoryListingProvider.js"

export type ReaderDirectoryNavigation =
  | { action: "path"; path: string }
  | { action: "back" | "forward" | "up" | "refresh" }

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
}

interface BrowserSession {
  id: string
  listing: ReaderDirectoryListing
  back: string[]
  forward: string[]
  generation: number
  operation?: AbortController
}

export class CoreReaderDirectoryBrowser implements AsyncDisposable {
  readonly #sessions = new Map<string, BrowserSession>()
  #nextSessionId = 1
  #closed = false

  constructor(private readonly provider: ReaderDirectoryListingProvider) {}

  async open(path: string, signal?: AbortSignal): Promise<ReaderDirectoryPage> {
    this.#assertOpen()
    const listing = await this.provider.read(path, signal)
    signal?.throwIfAborted()
    const session: BrowserSession = {
      id: `browser-${this.#nextSessionId++}`,
      listing,
      back: [],
      forward: [],
      generation: 1,
    }
    if (this.#sessions.size >= 8) this.close(this.#sessions.keys().next().value as string)
    this.#sessions.set(session.id, session)
    return pageOf(session, 0, 128)
  }

  list(sessionId: string, cursor = 0, limit = 128): ReaderDirectoryPage | undefined {
    const session = this.#sessions.get(sessionId)
    if (!session) return undefined
    assertPage(cursor, limit, session.listing.entries.length)
    return pageOf(session, cursor, limit)
  }

  async navigate(sessionId: string, navigation: ReaderDirectoryNavigation, signal?: AbortSignal): Promise<ReaderDirectoryPage | undefined> {
    const session = this.#sessions.get(sessionId)
    if (!session) return undefined
    const target = targetPath(session, navigation)
    if (!target) return pageOf(session, 0, 128)

    session.operation?.abort()
    const controller = new AbortController()
    session.operation = controller
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    const generation = session.generation + 1
    try {
      const listing = await this.provider.read(target, combinedSignal)
      combinedSignal.throwIfAborted()
      if (this.#sessions.get(sessionId) !== session || session.operation !== controller) return undefined
      updateHistory(session, navigation, listing.path)
      session.listing = listing
      session.generation = generation
      return pageOf(session, 0, 128)
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

function pageOf(session: BrowserSession, cursor: number, limit: number): ReaderDirectoryPage {
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
  }
}

function assertPage(cursor: number, limit: number, total: number): void {
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > total) throw new RangeError(`Invalid browser cursor: ${cursor}`)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 512) throw new RangeError(`Invalid browser limit: ${limit}`)
}
