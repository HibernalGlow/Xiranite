import type { ReaderBookmarkBatchUpdate, SaveReaderBookmarkInput, SaveReaderBookmarkListInput, UpdateReaderBookmarkInput } from "../../application/library/ReaderLibraryService.js"
import type { AppendReaderPlaylistEntryInput, SaveReaderPlaylistInput } from "../../application/library/ReaderPlaylistService.js"
import { ReaderLibraryService } from "../../application/library/ReaderLibraryService.js"
import type { ViewSource } from "../../domain/book/book.js"
import type { ReaderLibraryCleanupService } from "../../application/library/ReaderLibraryCleanupService.js"

const RECENT_ITEM_PATH = /^\/reader\/library\/recents\/([^/]+)$/
const BOOKMARK_ITEM_PATH = /^\/reader\/library\/bookmarks\/([^/]+)$/
const BOOKMARK_LIST_ITEM_PATH = /^\/reader\/library\/bookmark-lists\/([^/]+)$/
const PLAYLIST_ITEM_PATH = /^\/reader\/library\/playlists\/([^/]+)$/
const PLAYLIST_ENTRIES_PATH = /^\/reader\/library\/playlists\/([^/]+)\/items$/
const PLAYLIST_ORDER_PATH = /^\/reader\/library\/playlists\/([^/]+)\/items\/order$/
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
          items: await this.library.listRecent(libraryQuery(url)),
        })
      }
      if (url.pathname === "/reader/library/progress/folder" && request.method === "GET") {
        const path = url.searchParams.get("path")
        if (!path) return jsonResponse({ error: "path is required" }, 400)
        return jsonResponse(await this.library.summarizeFolderProgress(path, request.signal))
      }
      if (url.pathname === "/reader/library/statistics" && request.method === "GET") {
        return jsonResponse(await this.library.statistics())
      }
      if (url.pathname === "/reader/library/playlists" && request.method === "GET") {
        return jsonResponse({ items: await this.library.playlists().list() })
      }
      if (url.pathname === "/reader/library/playlists" && request.method === "POST") {
        const body = await readJson(request)
        const input = body && parsePlaylist(body)
        if (!input) return jsonResponse({ error: "Invalid reader playlist" }, 400)
        return jsonResponse(await this.library.playlists().save(input), 201)
      }
      const playlistEntriesMatch = PLAYLIST_ENTRIES_PATH.exec(url.pathname)
      if (playlistEntriesMatch && request.method === "GET") {
        const id = safeDecode(playlistEntriesMatch[1]!)
        if (!id) return jsonResponse({ error: "Invalid playlist id" }, 400)
        return jsonResponse({ items: await this.library.playlists().entries(id) })
      }
      if (playlistEntriesMatch && request.method === "POST") {
        const id = safeDecode(playlistEntriesMatch[1]!)
        const body = await readJson(request)
        const entries = body && parsePlaylistEntries(body)
        if (!id || !entries) return jsonResponse({ error: "Invalid reader playlist entries" }, 400)
        return jsonResponse({ items: await this.library.playlists().append(id, entries) }, 201)
      }
      if (playlistEntriesMatch && request.method === "DELETE") {
        const id = safeDecode(playlistEntriesMatch[1]!)
        const body = await readJson(request)
        const ids = body && parseBatchIds(body.ids)
        if (!id || !ids) return jsonResponse({ error: "Invalid reader playlist entry delete" }, 400)
        return jsonResponse({ deleted: await this.library.playlists().removeEntries(id, ids) })
      }
      const playlistOrderMatch = PLAYLIST_ORDER_PATH.exec(url.pathname)
      if (playlistOrderMatch && request.method === "PUT") {
        const id = safeDecode(playlistOrderMatch[1]!)
        const body = await readJson(request)
        const ids = body && parsePlaylistOrder(body)
        if (!id || !ids) return jsonResponse({ error: "Invalid reader playlist order" }, 400)
        await this.library.playlists().reorder(id, ids)
        return new Response(null, { status: 204 })
      }
      const playlistMatch = PLAYLIST_ITEM_PATH.exec(url.pathname)
      if (playlistMatch && request.method === "DELETE") {
        const id = safeDecode(playlistMatch[1]!)
        if (!id) return jsonResponse({ error: "Invalid playlist id" }, 400)
        return await this.library.playlists().remove(id)
          ? new Response(null, { status: 204 })
          : jsonResponse({ error: "Playlist not found" }, 404)
      }
      if (url.pathname === "/reader/library/recents/cleanup" && request.method === "POST") {
        const body = await readJson(request)
        if (!body) return jsonResponse({ error: "Invalid recent cleanup request" }, 400)
        if (body.kind === "oldest") {
          const limit = optionalBoundedInteger(body.limit, 500, 500)
          if (limit === undefined) return jsonResponse({ error: "limit must be an integer from 1 to 500" }, 400)
          if (Object.keys(body).some((key) => key !== "kind" && key !== "limit")) {
            return jsonResponse({ error: "oldest cleanup accepts only kind and limit" }, 400)
          }
          return jsonResponse(await this.library.removeOldestRecents(limit, request.signal))
        }
        if (body.kind === "folder") {
          if (typeof body.path !== "string" || Object.keys(body).some((key) => key !== "kind" && key !== "path")) {
            return jsonResponse({ error: "folder cleanup accepts only kind and path" }, 400)
          }
          return jsonResponse({ deleted: await this.library.clearByFolder("recents", body.path) })
        }
        if (body.kind === "all") {
          if (body.confirmed !== true || Object.keys(body).some((key) => key !== "kind" && key !== "confirmed")) {
            return jsonResponse({ error: "all cleanup requires only kind and confirmed=true" }, 400)
          }
          return jsonResponse({ deleted: await this.library.clearAll("recents") })
        }
        if (body.kind !== undefined) return jsonResponse({ error: "kind must be oldest, folder or all when provided" }, 400)
        if (!isTimestamp(body.before)) return jsonResponse({ error: "before must be a non-negative integer timestamp" }, 400)
        const limit = optionalPositiveInteger(body.limit, 500)
        if (limit === undefined) return jsonResponse({ error: "limit must be a positive integer" }, 400)
        return jsonResponse({ deleted: await this.library.clearRecentBefore(body.before, limit) })
      }
      if (url.pathname === "/reader/library/recents/batch" && request.method === "DELETE") {
        const body = await readJson(request)
        const ids = body && parseBatchIds(body.ids)
        if (!ids) return jsonResponse({ error: "Invalid reader recent batch delete" }, 400)
        return jsonResponse(await this.library.removeRecents(ids, request.signal))
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

      if (url.pathname === "/reader/library/bookmarks/by-path" && request.method === "GET") {
        const path = url.searchParams.get("path")
        if (!path) return jsonResponse({ error: "path is required" }, 400)
        return jsonResponse({ item: await this.library.findBookmarkByPath(path) ?? null })
      }
      if (url.pathname === "/reader/library/bookmarks" && request.method === "GET") {
        return jsonResponse({
          items: await this.library.listBookmarks({ ...libraryQuery(url), listId: url.searchParams.get("listId") || undefined }),
        })
      }
      if (url.pathname === "/reader/library/bookmarks" && request.method === "POST") {
        const body = await readJson(request)
        const input = body && parseBookmark(body)
        if (!input) return jsonResponse({ error: "Invalid reader bookmark" }, 400)
        return jsonResponse(await this.library.saveBookmark(input), 201)
      }
      if (url.pathname === "/reader/library/bookmarks/batch" && request.method === "PATCH") {
        const body = await readJson(request)
        const updates = body && parseBookmarkBatchUpdates(body.updates)
        if (!updates) return jsonResponse({ error: "Invalid reader bookmark batch update" }, 400)
        return jsonResponse(await this.library.updateBookmarks(updates, request.signal))
      }
      if (url.pathname === "/reader/library/bookmarks/batch" && request.method === "DELETE") {
        const body = await readJson(request)
        const ids = body && parseBatchIds(body.ids)
        if (!ids) return jsonResponse({ error: "Invalid reader bookmark batch delete" }, 400)
        return jsonResponse(await this.library.removeBookmarks(ids, request.signal))
      }
      if (url.pathname === "/reader/library/bookmarks/cleanup" && request.method === "POST") {
        const body = await readJson(request)
        if (!body) return jsonResponse({ error: "Invalid bookmark cleanup request" }, 400)
        if (body.kind === "folder") {
          if (typeof body.path !== "string" || Object.keys(body).some((key) => key !== "kind" && key !== "path")) {
            return jsonResponse({ error: "Bookmark folder cleanup requires only kind and path" }, 400)
          }
          return jsonResponse({ deleted: await this.library.clearByFolder("bookmarks", body.path) })
        }
        if (body.kind === "oldest") {
          const limit = optionalBoundedInteger(body.limit, 500, 500)
          if (limit === undefined || Object.keys(body).some((key) => key !== "kind" && key !== "limit")) {
            return jsonResponse({ error: "Bookmark oldest cleanup requires only kind and a limit from 1 to 500" }, 400)
          }
          return jsonResponse(await this.library.removeOldestBookmarks(limit, request.signal))
        }
        if (body.kind === "before") {
          const limit = optionalBoundedInteger(body.limit, 500, 500)
          if (!isTimestamp(body.before) || limit === undefined
            || Object.keys(body).some((key) => key !== "kind" && key !== "before" && key !== "limit")) {
            return jsonResponse({ error: "Bookmark date cleanup requires only kind, before and limit" }, 400)
          }
          return jsonResponse({ deleted: await this.library.clearBookmarksBefore(body.before, limit) })
        }
        if (body.kind === "all") {
          if (body.confirmed !== true || Object.keys(body).some((key) => key !== "kind" && key !== "confirmed")) {
            return jsonResponse({ error: "Bookmark all cleanup requires only kind and confirmed=true" }, 400)
          }
          return jsonResponse({ deleted: await this.library.clearAll("bookmarks") })
        }
        return jsonResponse({ error: "Bookmark cleanup kind must be folder, oldest, before or all" }, 400)
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

function libraryQuery(url: URL): { limit: number; offset: number; filter?: "all" | "archive" | "directory" | "video" } {
  const filter = url.searchParams.get("filter")
  if (filter !== null && filter !== "all" && filter !== "archive" && filter !== "directory" && filter !== "video") {
    throw new Error("Reader library filter must be all, archive, directory or video.")
  }
  return { ...paging(url), ...(filter !== null ? { filter } : {}) }
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

function parseBookmarkBatchUpdates(value: unknown): ReaderBookmarkBatchUpdate[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) return undefined
  const updates: ReaderBookmarkBatchUpdate[] = []
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return undefined
    const body = item as Record<string, unknown>
    if (typeof body.id !== "string") return undefined
    const update = parseBookmarkUpdate(Object.fromEntries(Object.entries(body).filter(([key]) => key !== "id")))
    if (!update) return undefined
    updates.push({ id: body.id, ...update })
  }
  return updates
}

function parseBatchIds(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.length <= 500 && value.every((id) => typeof id === "string")
    ? value
    : undefined
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

function parsePlaylist(body: Record<string, unknown>): SaveReaderPlaylistInput | undefined {
  if (typeof body.name !== "string" || Object.keys(body).some((key) => key !== "id" && key !== "name" && key !== "createdAt")) return undefined
  if (body.id !== undefined && typeof body.id !== "string") return undefined
  if (body.createdAt !== undefined && !isTimestamp(body.createdAt)) return undefined
  return { name: body.name, ...(body.id !== undefined ? { id: body.id as string } : {}), ...(body.createdAt !== undefined ? { createdAt: body.createdAt as number } : {}) }
}

function parsePlaylistEntries(body: Record<string, unknown>): AppendReaderPlaylistEntryInput[] | undefined {
  if (Object.keys(body).length !== 1 || !Array.isArray(body.entries) || !body.entries.length || body.entries.length > 500) return undefined
  const entries: AppendReaderPlaylistEntryInput[] = []
  for (const value of body.entries) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
    const entry = value as Record<string, unknown>
    if (Object.keys(entry).some((key) => key !== "id" && key !== "source" && key !== "name" && key !== "createdAt")) return undefined
    const source = parseSource(entry.source)
    if (!source || typeof entry.name !== "string") return undefined
    if (entry.id !== undefined && typeof entry.id !== "string") return undefined
    if (entry.createdAt !== undefined && !isTimestamp(entry.createdAt)) return undefined
    entries.push({
      source,
      name: entry.name,
      ...(entry.id !== undefined ? { id: entry.id as string } : {}),
      ...(entry.createdAt !== undefined ? { createdAt: entry.createdAt as number } : {}),
    })
  }
  return entries
}

function parsePlaylistOrder(body: Record<string, unknown>): string[] | undefined {
  return Object.keys(body).length === 1 && parseBatchIds(body.ids) ? body.ids as string[] : undefined
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
