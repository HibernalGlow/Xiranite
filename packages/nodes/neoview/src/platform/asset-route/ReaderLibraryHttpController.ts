import type { SaveReaderBookmarkInput, SaveReaderBookmarkListInput, UpdateReaderBookmarkInput } from "../../application/library/ReaderLibraryService.js"
import { ReaderLibraryService } from "../../application/library/ReaderLibraryService.js"
import type { ViewSource } from "../../domain/book/book.js"
import type { ReaderLibraryCleanupService } from "../../application/library/ReaderLibraryCleanupService.js"

const RECENT_ITEM_PATH = /^\/reader\/library\/recents\/([^/]+)$/
const BOOKMARK_ITEM_PATH = /^\/reader\/library\/bookmarks\/([^/]+)$/
const BOOKMARK_LIST_ITEM_PATH = /^\/reader\/library\/bookmark-lists\/([^/]+)$/
const MAX_BODY_BYTES = 64 * 1024

export class ReaderLibraryHttpController {
  constructor(
    private readonly library: ReaderLibraryService,
    private readonly cleanup?: ReaderLibraryCleanupService,
  ) {}

  async handle(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith("/reader/library/")) return undefined
    try {
      if (url.pathname === "/reader/library/recents" && request.method === "GET") {
        return jsonResponse({
          items: await this.library.listRecent(paging(url)),
        })
      }
      if (url.pathname === "/reader/library/recents/cleanup" && request.method === "POST") {
        const body = await readJson(request)
        if (!body || !isTimestamp(body.before)) return jsonResponse({ error: "before must be a non-negative integer timestamp" }, 400)
        const limit = optionalPositiveInteger(body.limit, 500)
        if (limit === undefined) return jsonResponse({ error: "limit must be a positive integer" }, 400)
        return jsonResponse({ deleted: await this.library.clearRecentBefore(body.before, limit) })
      }
      if (url.pathname === "/reader/library/cleanup-invalid" && request.method === "POST") {
        if (!this.cleanup) return jsonResponse({ error: "Reader library invalid-path cleanup is unavailable" }, 503)
        const body = await readJson(request)
        if (!body) return jsonResponse({ error: "Invalid cleanup request" }, 400)
        const kind = body.kind ?? "both"
        if (kind !== "recents" && kind !== "bookmarks" && kind !== "both") return jsonResponse({ error: "kind must be recents, bookmarks or both" }, 400)
        const concurrency = optionalBoundedInteger(body.concurrency, 8, 16)
        if (body.concurrency !== undefined && concurrency === undefined) return jsonResponse({ error: "concurrency must be an integer from 1 to 16" }, 400)
        return jsonResponse(await this.cleanup.cleanupInvalid({
          kind,
          scanLimit: optionalPositiveInteger(body.scanLimit, 500),
          deleteLimit: optionalPositiveInteger(body.deleteLimit, 500),
          concurrency,
          signal: request.signal,
        }))
      }
      const recentMatch = RECENT_ITEM_PATH.exec(url.pathname)
      if (recentMatch && request.method === "DELETE") {
        const id = safeDecode(recentMatch[1]!)
        if (!id) return jsonResponse({ error: "Invalid recent book id" }, 400)
        return await this.library.removeRecent(id)
          ? new Response(null, { status: 204 })
          : jsonResponse({ error: "Recent book not found" }, 404)
      }

      if (url.pathname === "/reader/library/bookmarks" && request.method === "GET") {
        return jsonResponse({
          items: await this.library.listBookmarks({ ...paging(url), listId: url.searchParams.get("listId") || undefined }),
        })
      }
      if (url.pathname === "/reader/library/bookmarks" && request.method === "POST") {
        const body = await readJson(request)
        const input = body && parseBookmark(body)
        if (!input) return jsonResponse({ error: "Invalid reader bookmark" }, 400)
        return jsonResponse(await this.library.saveBookmark(input), 201)
      }
      const bookmarkMatch = BOOKMARK_ITEM_PATH.exec(url.pathname)
      if (bookmarkMatch && request.method === "PATCH") {
        const id = safeDecode(bookmarkMatch[1]!)
        if (!id) return jsonResponse({ error: "Invalid bookmark id" }, 400)
        const body = await readJson(request)
        const input = body && parseBookmarkUpdate(body)
        if (!input) return jsonResponse({ error: "Invalid reader bookmark update" }, 400)
        const updated = await this.library.updateBookmark(id, input, request.signal)
        return updated ? jsonResponse(updated) : jsonResponse({ error: "Bookmark not found" }, 404)
      }
      if (bookmarkMatch && request.method === "DELETE") {
        const id = safeDecode(bookmarkMatch[1]!)
        if (!id) return jsonResponse({ error: "Invalid bookmark id" }, 400)
        return await this.library.removeBookmark(id)
          ? new Response(null, { status: 204 })
          : jsonResponse({ error: "Bookmark not found" }, 404)
      }

      if (url.pathname === "/reader/library/bookmark-lists" && request.method === "GET") {
        return jsonResponse({ items: await this.library.listBookmarkLists() })
      }
      if (url.pathname === "/reader/library/bookmark-lists" && request.method === "POST") {
        const body = await readJson(request)
        const input = body && parseBookmarkList(body)
        if (!input) return jsonResponse({ error: "Invalid reader bookmark list" }, 400)
        return jsonResponse(await this.library.saveBookmarkList(input), 201)
      }
      const listMatch = BOOKMARK_LIST_ITEM_PATH.exec(url.pathname)
      if (listMatch && request.method === "DELETE") {
        const id = safeDecode(listMatch[1]!)
        if (!id) return jsonResponse({ error: "Invalid bookmark list id" }, 400)
        return await this.library.removeBookmarkList(id)
          ? new Response(null, { status: 204 })
          : jsonResponse({ error: "Bookmark list not found" }, 404)
      }
      return jsonResponse({ error: "Reader library route not found" }, 404)
    } catch (error) {
      if (request.signal.aborted) throw error
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400)
    }
  }
}

function paging(url: URL): { limit: number; offset: number } {
  return {
    limit: queryInteger(url.searchParams.get("limit"), 1, 500, 100),
    offset: queryInteger(url.searchParams.get("offset"), 0, Number.MAX_SAFE_INTEGER, 0),
  }
}

function parseBookmark(body: Record<string, unknown>): SaveReaderBookmarkInput | undefined {
  const source = parseSource(body.source)
  if (!source || typeof body.name !== "string") return undefined
  if (body.id !== undefined && typeof body.id !== "string") return undefined
  if (body.kind !== undefined && body.kind !== "file" && body.kind !== "folder") return undefined
  if (body.starred !== undefined && typeof body.starred !== "boolean") return undefined
  if (body.createdAt !== undefined && !isTimestamp(body.createdAt)) return undefined
  if (body.listIds !== undefined && (!Array.isArray(body.listIds) || !body.listIds.every((id) => typeof id === "string"))) return undefined
  return {
    id: body.id as string | undefined,
    source,
    name: body.name,
    kind: body.kind as "file" | "folder" | undefined,
    starred: body.starred as boolean | undefined,
    createdAt: body.createdAt as number | undefined,
    listIds: body.listIds as string[] | undefined,
  }
}

function parseBookmarkUpdate(body: Record<string, unknown>): UpdateReaderBookmarkInput | undefined {
  const keys = Object.keys(body)
  if (!keys.length || keys.some((key) => key !== "starred" && key !== "listIds")) return undefined
  if (body.starred !== undefined && typeof body.starred !== "boolean") return undefined
  if (body.listIds !== undefined && (
    !Array.isArray(body.listIds)
    || body.listIds.length > 128
    || !body.listIds.every((id) => typeof id === "string")
  )) return undefined
  return {
    ...(body.starred !== undefined ? { starred: body.starred as boolean } : {}),
    ...(body.listIds !== undefined ? { listIds: body.listIds as string[] } : {}),
  }
}

function parseBookmarkList(body: Record<string, unknown>): SaveReaderBookmarkListInput | undefined {
  if (typeof body.name !== "string") return undefined
  if (body.id !== undefined && typeof body.id !== "string") return undefined
  if (body.isFavorite !== undefined && typeof body.isFavorite !== "boolean") return undefined
  if (body.createdAt !== undefined && !isTimestamp(body.createdAt)) return undefined
  return {
    id: body.id as string | undefined,
    name: body.name,
    isFavorite: body.isFavorite as boolean | undefined,
    createdAt: body.createdAt as number | undefined,
  }
}

function parseSource(value: unknown): ViewSource | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  if (typeof source.path !== "string" || !source.path) return undefined
  if (source.kind === "path" || source.kind === "directory" || source.kind === "image" || source.kind === "media") return source as unknown as ViewSource
  if (source.kind === "document" && (source.format === "pdf" || source.format === "epub")) return source as unknown as ViewSource
  if (source.kind === "archive"
    && (source.entryPath === undefined || typeof source.entryPath === "string")
    && (source.entryPaths === undefined || (Array.isArray(source.entryPaths) && source.entryPaths.every((entry) => typeof entry === "string")))) {
    return source as unknown as ViewSource
  }
  return undefined
}

async function readJson(request: Request): Promise<Record<string, unknown> | undefined> {
  const length = Number(request.headers.get("content-length") ?? 0)
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return undefined
  return request.json().catch(() => undefined) as Promise<Record<string, unknown> | undefined>
}

function queryInteger(value: string | null, minimum: number, maximum: number, fallback: number): number {
  if (value === null) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback
}

function optionalPositiveInteger(value: unknown, fallback: number): number | undefined {
  if (value === undefined) return fallback
  return Number.isSafeInteger(value) && (value as number) > 0 ? Math.min(value as number, 500) : undefined
}

function optionalBoundedInteger(value: unknown, fallback: number, maximum: number): number | undefined {
  if (value === undefined) return fallback
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= maximum ? value as number : undefined
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function safeDecode(value: string): string | undefined {
  try { return decodeURIComponent(value) } catch { return undefined }
}

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  })
}
