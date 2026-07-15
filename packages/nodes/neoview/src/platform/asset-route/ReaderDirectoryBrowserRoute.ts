import { CoreReaderDirectoryBrowser, type ReaderDirectoryNavigation } from "../../application/browser/ReaderDirectoryBrowser.js"
import {
  isReaderDirectorySortField,
  type ReaderDirectorySortRule,
} from "../../application/browser/ReaderDirectorySort.js"
import { PlatformDirectoryListingProvider } from "../filesystem/PlatformDirectoryListingProvider.js"
import { PlatformDirectoryMetadataProvider } from "../filesystem/PlatformDirectoryMetadataProvider.js"

const BROWSER_ENTRIES_PATH = /^\/reader\/browser\/s\/([^/]+)\/entries$/
const BROWSER_NAVIGATE_PATH = /^\/reader\/browser\/s\/([^/]+)\/navigate$/
const BROWSER_SORT_PATH = /^\/reader\/browser\/s\/([^/]+)\/sort$/
const BROWSER_SESSION_PATH = /^\/reader\/browser\/s\/([^/]+)$/

export class ReaderDirectoryBrowserRoute implements AsyncDisposable {
  readonly #browser = new CoreReaderDirectoryBrowser(
    new PlatformDirectoryListingProvider(),
    new PlatformDirectoryMetadataProvider(),
  )

  async handle(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url)
    if (url.pathname === "/reader/browser/sessions" && request.method === "POST") return this.#open(request)

    const entriesMatch = BROWSER_ENTRIES_PATH.exec(url.pathname)
    if (entriesMatch && request.method === "GET") return this.#list(entriesMatch[1]!, url)
    const navigateMatch = BROWSER_NAVIGATE_PATH.exec(url.pathname)
    if (navigateMatch && request.method === "POST") return this.#navigate(navigateMatch[1]!, request)
    const sortMatch = BROWSER_SORT_PATH.exec(url.pathname)
    if (sortMatch && request.method === "PATCH") return this.#sort(sortMatch[1]!, request)
    const sessionMatch = BROWSER_SESSION_PATH.exec(url.pathname)
    if (sessionMatch && request.method === "DELETE") {
      const sessionId = safeDecode(sessionMatch[1]!)
      return sessionId && this.#browser.close(sessionId) ? new Response(null, { status: 204 }) : errorResponse("Browser session not found", 404)
    }
    return undefined
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.#browser[Symbol.asyncDispose]()
  }

  async #open(request: Request): Promise<Response> {
    const body = await request.json().catch(() => undefined) as { path?: unknown } | undefined
    if (typeof body?.path !== "string" || !body.path.trim()) return errorResponse("path must be a non-empty string", 400)
    try {
      return Response.json(await this.#browser.open(body.path, request.signal), responseInit(201))
    } catch (error) {
      if (request.signal.aborted) throw error
      return errorResponse(errorMessage(error), 400)
    }
  }

  #list(encodedSessionId: string, url: URL): Response {
    const sessionId = safeDecode(encodedSessionId)
    if (!sessionId) return errorResponse("Browser session not found", 404)
    const cursor = integer(url.searchParams.get("cursor"), 0)
    const limit = integer(url.searchParams.get("limit"), 128)
    try {
      const result = this.#browser.list(sessionId, cursor, limit)
      return result ? Response.json(result, responseInit()) : errorResponse("Browser session not found", 404)
    } catch (error) {
      return errorResponse(errorMessage(error), 400)
    }
  }

  async #navigate(encodedSessionId: string, request: Request): Promise<Response> {
    const sessionId = safeDecode(encodedSessionId)
    if (!sessionId) return errorResponse("Browser session not found", 404)
    const body = await request.json().catch(() => undefined) as { action?: unknown; path?: unknown } | undefined
    const navigation = parseNavigation(body)
    if (!navigation) return errorResponse("Invalid browser navigation", 400)
    try {
      const result = await this.#browser.navigate(sessionId, navigation, request.signal)
      return result ? Response.json(result, responseInit()) : errorResponse("Browser session not found", 404)
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
      const result = await this.#browser.sort(sessionId, command.sort, command.focusPath, request.signal)
      return result ? Response.json(result, responseInit()) : errorResponse("Browser session not found", 404)
    } catch (error) {
      if (request.signal.aborted) throw error
      return errorResponse(errorMessage(error), 400)
    }
  }
}

function parseNavigation(body: { action?: unknown; path?: unknown } | undefined): ReaderDirectoryNavigation | undefined {
  if (body?.action === "path") return typeof body.path === "string" && body.path.trim() ? { action: "path", path: body.path } : undefined
  if (body?.action === "back" || body?.action === "forward" || body?.action === "up" || body?.action === "refresh") return { action: body.action }
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

function integer(value: string | null, fallback: number): number {
  if (value === null) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : fallback
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
