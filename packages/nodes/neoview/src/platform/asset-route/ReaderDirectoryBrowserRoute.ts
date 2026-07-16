import {
  ReaderFileTreeService,
  type ReaderDirectoryNavigation,
  type ReaderDirectorySortPreferenceCommand,
  type ReaderFileTreeServiceOptions,
} from "../../application/browser/ReaderFileTreeService.js"
import {
  isReaderDirectorySortField,
  type ReaderDirectorySortRule,
} from "../../application/browser/ReaderDirectorySort.js"
import {
  CoreReaderDirectorySortPreferences,
  type ReaderDirectorySortPreferenceStore,
} from "../../application/browser/ReaderDirectorySortPreferences.js"
import { PlatformDirectoryListingProvider } from "../filesystem/PlatformDirectoryListingProvider.js"
import { PlatformDirectoryMetadataProvider } from "../filesystem/PlatformDirectoryMetadataProvider.js"
import { PlatformFileTreeScanner } from "../filesystem/PlatformFileTreeScanner.js"
import { PlatformFileTreeWatcher } from "../filesystem/PlatformFileTreeWatcher.js"
import type { ReaderDirectoryEmmRecordStore } from "../../ports/ReaderDirectoryEmmRecordStore.js"
import type {
  ReaderDirectoryMetadataField,
  ReaderDirectoryMetadataProvider,
} from "../../ports/ReaderDirectoryMetadataProvider.js"

const BROWSER_ENTRIES_PATH = /^\/reader\/browser\/s\/([^/]+)\/entries$/
const BROWSER_NAVIGATE_PATH = /^\/reader\/browser\/s\/([^/]+)\/navigate$/
const BROWSER_SORT_PATH = /^\/reader\/browser\/s\/([^/]+)\/sort$/
const BROWSER_SORT_PREFERENCES_PATH = /^\/reader\/browser\/s\/([^/]+)\/sort\/preferences$/
const BROWSER_SESSION_PATH = /^\/reader\/browser\/s\/([^/]+)$/
const DISPLAY_METADATA_FIELDS = new Set<ReaderDirectoryMetadataField>(["rating", "collectTagCount"])
const READER_DIRECTORY_METADATA_FIELDS = new Set<ReaderDirectoryMetadataField>([
  "date", "size", "rating", "collectTagCount", "dimensions", "pageCount", "tags",
])

export class ReaderDirectoryBrowserRoute implements AsyncDisposable {
  readonly #browser: ReaderFileTreeService

  constructor(
    sortPreferenceStore?: ReaderDirectorySortPreferenceStore,
    emmRecordStore?: ReaderDirectoryEmmRecordStore,
    mediaMetadataProvider?: ReaderDirectoryMetadataProvider,
    fileTreeOptions: ReaderFileTreeServiceOptions = {},
  ) {
    this.#browser = new ReaderFileTreeService(
      new PlatformDirectoryListingProvider(),
      new PlatformDirectoryMetadataProvider(emmRecordStore, undefined, undefined, mediaMetadataProvider),
      new CoreReaderDirectorySortPreferences(sortPreferenceStore),
      {
        scanner: fileTreeOptions.scanner ?? new PlatformFileTreeScanner(),
        watcher: fileTreeOptions.watcher ?? new PlatformFileTreeWatcher(),
      },
    )
  }

  async handle(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url)
    if (url.pathname === "/reader/browser/sessions" && request.method === "POST") return this.#open(request)

    const entriesMatch = BROWSER_ENTRIES_PATH.exec(url.pathname)
    if (entriesMatch && request.method === "GET") return this.#list(entriesMatch[1]!, url, request.signal)
    const navigateMatch = BROWSER_NAVIGATE_PATH.exec(url.pathname)
    if (navigateMatch && request.method === "POST") return this.#navigate(navigateMatch[1]!, request)
    const sortPreferencesMatch = BROWSER_SORT_PREFERENCES_PATH.exec(url.pathname)
    if (sortPreferencesMatch && request.method === "PATCH") return this.#sortPreferences(sortPreferencesMatch[1]!, request)
    const sortMatch = BROWSER_SORT_PATH.exec(url.pathname)
    if (sortMatch && request.method === "PATCH") return this.#sort(sortMatch[1]!, request)
    const sessionMatch = BROWSER_SESSION_PATH.exec(url.pathname)
    if (sessionMatch && request.method === "DELETE") {
      const sessionId = safeDecode(sessionMatch[1]!)
      return sessionId && await this.#browser.close(sessionId) ? new Response(null, { status: 204 }) : errorResponse("Browser session not found", 404)
    }
    return undefined
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.#browser[Symbol.asyncDispose]()
  }

  async #open(request: Request): Promise<Response> {
    const body = await request.json().catch(() => undefined) as { path?: unknown; scopeId?: unknown; watch?: unknown } | undefined
    if (typeof body?.path !== "string" || !body.path.trim()) return errorResponse("path must be a non-empty string", 400)
    if (body.scopeId !== undefined && (typeof body.scopeId !== "string" || !body.scopeId.trim())) return errorResponse("scopeId must be a non-empty string", 400)
    if (body.watch !== undefined && typeof body.watch !== "boolean") return errorResponse("watch must be a boolean", 400)
    try {
      const resolvedPath = await realpath(body.path)
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
import { realpath, stat } from "node:fs/promises"
import { dirname } from "node:path"
