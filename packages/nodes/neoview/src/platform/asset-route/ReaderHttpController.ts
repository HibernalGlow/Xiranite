import type { FrameSnapshot } from "../../domain/frame/frame.js"
import type { ViewSource } from "../../domain/book/book.js"
import type { ReaderPage } from "../../domain/page/page.js"
import { CoreReaderService } from "../../application/reader/ReaderService.js"
import type { ReaderSession, ReaderSessionOptions } from "../../application/reader/contracts.js"
import type { ArchivePasswordInput } from "../../ports/ReaderBookLoader.js"
import type { ReaderThumbnailStore } from "../../ports/ReaderThumbnailStore.js"
import { createPlatformReaderBookLoader } from "../books/PlatformReaderBookLoader.js"
import type { PlatformReaderBookLoaderOptions } from "../books/PlatformReaderBookLoader.js"
import { StreamingImageMetadataProbe } from "../images/StreamingImageMetadataProbe.js"
import { WeightedLruPresentationCache } from "../cache/WeightedLruPresentationCache.js"
import { SolidArchiveCache } from "../archives/sevenzip/SolidArchiveCache.js"
import { ReaderAssetRoute, type ReaderAssetRouteOptions } from "./ReaderAssetRoute.js"
import { DEFAULT_NEOVIEW_SHELL_CONFIG, type NeoviewShellConfig } from "../../application/config/ReaderRuntimeConfig.js"

const SESSION_PATH = /^\/reader\/s\/([^/]+)$/
const SESSION_PAGES_PATH = /^\/reader\/s\/([^/]+)\/pages$/
const SESSION_NAVIGATE_PATH = /^\/reader\/s\/([^/]+)\/navigate$/
const MAX_CONTROL_BODY_BYTES = 64 * 1024

export interface ReaderPageDto {
  id: string
  index: number
  name: string
  mediaKind: ReaderPage["mediaKind"]
  mimeType?: string
  byteLength?: number
  dimensions?: ReaderPage["dimensions"]
  contentVersion: string
  assetUrl: string
  thumbnailUrl?: string
}

export interface ReaderSessionDto {
  sessionId: string
  book: {
    id: string
    displayName: string
    pageCount: number
  }
  frame: FrameSnapshot
  visiblePages: ReaderPageDto[]
}

export type ReaderHttpControllerOptions = ReaderAssetRouteOptions & PlatformReaderBookLoaderOptions & {
  sessionOptions?: Partial<ReaderSessionOptions>
  thumbnailStore?: ReaderThumbnailStore
  disposeThumbnailStore?: () => void | Promise<void>
  shellOptions?: NeoviewShellConfig
}

export class ReaderHttpController implements AsyncDisposable {
  readonly #service: CoreReaderService
  readonly #assets: ReaderAssetRoute
  readonly #token: string
  readonly #solidArchiveCache: SolidArchiveCache
  readonly #ownsSolidArchiveCache: boolean
  readonly #disposeThumbnailStore?: () => void | Promise<void>
  readonly #shellOptions: NeoviewShellConfig

  constructor(options: ReaderHttpControllerOptions) {
    this.#ownsSolidArchiveCache = !options.solidArchiveCache
    this.#solidArchiveCache = options.solidArchiveCache ?? new SolidArchiveCache({
      maxBytes: options.maxSolidArchiveCacheBytes,
    })
    this.#service = new CoreReaderService(
      createPlatformReaderBookLoader({ ...options, solidArchiveCache: this.#solidArchiveCache }),
      new StreamingImageMetadataProbe(),
      options.sessionOptions,
    )
    this.#assets = new ReaderAssetRoute(this.#service, options, {
      presentationCache: new WeightedLruPresentationCache(),
      loadImageTransformer: async () => {
        const { SharpImageTransformer } = await import("../images/sharp/SharpImageTransformer.js")
        return new SharpImageTransformer(options.resourceScheduler)
      },
      thumbnailStore: options.thumbnailStore,
    })
    this.#disposeThumbnailStore = options.disposeThumbnailStore
    this.#token = options.token
    this.#shellOptions = options.shellOptions ?? DEFAULT_NEOVIEW_SHELL_CONFIG
  }

  async handle(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith("/reader/")) return undefined
    if (!this.#isAuthorized(request, url)) return jsonResponse({ error: "Unauthorized" }, 401)

    const assetResponse = await this.#assets.handle(request)
    if (assetResponse) return assetResponse

    if (url.pathname === "/reader/sessions" && request.method === "POST") {
      return this.#openSession(request)
    }
    if (url.pathname === "/reader/config" && request.method === "GET") {
      return jsonResponse({ schemaVersion: 1, shell: this.#shellOptions })
    }

    const pagesMatch = SESSION_PAGES_PATH.exec(url.pathname)
    if (pagesMatch && request.method === "GET") return this.#listPages(pagesMatch[1]!, url)
    const navigateMatch = SESSION_NAVIGATE_PATH.exec(url.pathname)
    if (navigateMatch && request.method === "POST") return this.#navigate(navigateMatch[1]!, request)
    const sessionMatch = SESSION_PATH.exec(url.pathname)
    if (sessionMatch && request.method === "GET") return this.#getSession(sessionMatch[1]!)
    if (sessionMatch && request.method === "DELETE") return this.#closeSession(sessionMatch[1]!)
    return jsonResponse({ error: "Reader route not found" }, 404)
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.#assets.close()
    const errors: unknown[] = []
    try {
      await this.#service[Symbol.asyncDispose]()
    } catch (error) {
      errors.push(error)
    }
    if (this.#ownsSolidArchiveCache) {
      try {
        await this.#solidArchiveCache.close()
      } catch (error) {
        errors.push(error)
      }
    }
    if (this.#disposeThumbnailStore) {
      try {
        await this.#disposeThumbnailStore()
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length) throw new AggregateError(errors, "Failed to close the reader HTTP controller.")
  }

  async #openSession(request: Request): Promise<Response> {
    const body = await readControlJson(request)
    if (!body || typeof body.path !== "string" || !body.path.trim()) {
      return jsonResponse({ error: "path must be a non-empty string" }, 400)
    }
    const initialPageValue = body.initialPage
    if (initialPageValue !== undefined && (
      typeof initialPageValue !== "number"
      || !Number.isSafeInteger(initialPageValue)
      || initialPageValue < 0
    )) {
      return jsonResponse({ error: "initialPage must be a non-negative integer" }, 400)
    }
    const initialPage = typeof initialPageValue === "number" ? initialPageValue : undefined
    const entryPaths = parseEntryPaths(body)
    if (entryPaths === "invalid") {
      return jsonResponse({ error: "entryPath/entryPaths must contain non-empty archive paths and cannot be combined" }, 400)
    }
    const archivePasswords = parseArchivePasswords(body)
    if (archivePasswords === "invalid") {
      return jsonResponse({ error: "password/archivePasswords must contain valid, uniquely scoped password entries and cannot be combined" }, 400)
    }
    try {
      const source: ViewSource = entryPaths
        ? { kind: "archive", path: body.path, entryPaths }
        : { kind: "path", path: body.path }
      const session = await this.#service.openViewSource(
        source,
        { initialPage, signal: request.signal, archivePasswords },
      )
      return jsonResponse(this.#sessionDto(session), 201)
    } catch (error) {
      if (request.signal.aborted) throw error
      return jsonResponse({ error: errorMessage(error) }, 400)
    }
  }

  #getSession(encodedSessionId: string): Response {
    const session = this.#findSession(encodedSessionId)
    return session ? jsonResponse(this.#sessionDto(session)) : jsonResponse({ error: "Reader session not found" }, 404)
  }

  #listPages(encodedSessionId: string, url: URL): Response {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    const cursor = boundedInteger(url.searchParams.get("cursor"), 0, session.book.pages.length, 0)
    const limit = boundedInteger(url.searchParams.get("limit"), 1, 500, 100)
    const pages = session.book.pages.slice(cursor, cursor + limit).map((page) => this.#pageDto(session, page))
    const nextCursor = cursor + pages.length < session.book.pages.length ? cursor + pages.length : undefined
    return jsonResponse({ pages, nextCursor, total: session.book.pages.length })
  }

  async #navigate(encodedSessionId: string, request: Request): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    const body = await readControlJson(request)
    if (!body || (body.action !== "next" && body.action !== "previous" && body.action !== "goTo")) {
      return jsonResponse({ error: "action must be next, previous or goTo" }, 400)
    }
    try {
      const frame = body.action === "next"
        ? await session.next(request.signal)
        : body.action === "previous"
          ? await session.previous(request.signal)
          : await session.goTo(requirePageIndex(body.pageIndex), request.signal)
      return jsonResponse({ frame, visiblePages: this.#visiblePages(session, frame) })
    } catch (error) {
      if (request.signal.aborted) throw error
      return jsonResponse({ error: errorMessage(error) }, 400)
    }
  }

  async #closeSession(encodedSessionId: string): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    await this.#service.closeSession(session.id)
    return new Response(null, { status: 204 })
  }

  #sessionDto(session: ReaderSession): ReaderSessionDto {
    const frame = session.snapshot()
    return {
      sessionId: session.id,
      book: {
        id: session.book.id,
        displayName: session.book.displayName,
        pageCount: session.book.pages.length,
      },
      frame,
      visiblePages: this.#visiblePages(session, frame),
    }
  }

  #visiblePages(session: ReaderSession, frame: FrameSnapshot): ReaderPageDto[] {
    return frame.pages.flatMap(({ pageId }) => {
      const page = session.getPage(pageId)
      return page ? [this.#pageDto(session, page)] : []
    })
  }

  #pageDto(session: ReaderSession, page: ReaderPage): ReaderPageDto {
    return {
      id: page.id,
      index: page.index,
      name: page.name,
      mediaKind: page.mediaKind,
      mimeType: page.mimeType,
      byteLength: page.byteLength,
      dimensions: page.dimensions,
      contentVersion: page.contentVersion,
      assetUrl: this.#assets.pageUrl(session.id, page.id),
      thumbnailUrl: this.#assets.thumbnailUrl(session.id, page.id),
    }
  }

  #findSession(encodedSessionId: string): ReaderSession | undefined {
    const sessionId = safeDecode(encodedSessionId)
    return sessionId ? this.#service.getSession(sessionId) : undefined
  }

  #isAuthorized(request: Request, url: URL): boolean {
    return request.headers.get("x-xiranite-token") === this.#token || url.searchParams.get("token") === this.#token
  }
}

async function readControlJson(request: Request): Promise<Record<string, unknown> | undefined> {
  const length = Number(request.headers.get("content-length") ?? 0)
  if (Number.isFinite(length) && length > MAX_CONTROL_BODY_BYTES) return undefined
  return request.json().catch(() => undefined) as Promise<Record<string, unknown> | undefined>
}

function requirePageIndex(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("pageIndex must be a non-negative integer")
  return value as number
}

function parseEntryPaths(body: Record<string, unknown>): readonly string[] | undefined | "invalid" {
  if (body.entryPath !== undefined && body.entryPaths !== undefined) return "invalid"
  if (body.entryPath !== undefined) {
    return typeof body.entryPath === "string" && body.entryPath.trim() ? [body.entryPath] : "invalid"
  }
  if (body.entryPaths === undefined) return undefined
  if (!Array.isArray(body.entryPaths) || body.entryPaths.length === 0 || body.entryPaths.length > 16) return "invalid"
  return body.entryPaths.every((path) => typeof path === "string" && path.trim())
    ? body.entryPaths as string[]
    : "invalid"
}

function parseArchivePasswords(body: Record<string, unknown>): readonly ArchivePasswordInput[] | undefined | "invalid" {
  if (body.password !== undefined && body.archivePasswords !== undefined) return "invalid"
  if (body.password !== undefined) {
    return typeof body.password === "string" && body.password.length > 0 ? [{ password: body.password }] : "invalid"
  }
  if (body.archivePasswords === undefined) return undefined
  if (!Array.isArray(body.archivePasswords) || body.archivePasswords.length === 0 || body.archivePasswords.length > 16) {
    return "invalid"
  }
  const scopes = new Set<string>()
  const inputs: ArchivePasswordInput[] = []
  for (const value of body.archivePasswords) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "invalid"
    const record = value as Record<string, unknown>
    if (typeof record.password !== "string" || record.password.length === 0) return "invalid"
    if (record.entryPaths !== undefined && (
      !Array.isArray(record.entryPaths)
      || record.entryPaths.length > 16
      || !record.entryPaths.every((path) => typeof path === "string" && path.trim())
    )) return "invalid"
    const entryPaths = record.entryPaths as string[] | undefined
    const key = entryPaths?.join("\0") ?? ""
    if (scopes.has(key)) return "invalid"
    scopes.add(key)
    inputs.push({ password: record.password, entryPaths })
  }
  return inputs
}

function boundedInteger(value: string | null, minimum: number, maximum: number, fallback: number): number {
  if (value === null) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback
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

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  })
}
