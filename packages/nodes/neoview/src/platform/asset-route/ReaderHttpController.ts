import type { FrameSnapshot } from "../../domain/frame/frame.js"
import type { ReaderPage } from "../../domain/page/page.js"
import { CoreReaderService } from "../../application/reader/ReaderService.js"
import type { ReaderSession } from "../../application/reader/contracts.js"
import { createPlatformReaderBookLoader } from "../books/PlatformReaderBookLoader.js"
import { StreamingImageMetadataProbe } from "../images/StreamingImageMetadataProbe.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import { ReaderAssetRoute, type ReaderAssetRouteOptions } from "./ReaderAssetRoute.js"

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

export interface ReaderHttpControllerOptions extends ReaderAssetRouteOptions {
  resourceScheduler?: ResourceScheduler
}

export class ReaderHttpController implements AsyncDisposable {
  readonly #service = new CoreReaderService(createPlatformReaderBookLoader(), new StreamingImageMetadataProbe())
  readonly #assets: ReaderAssetRoute
  readonly #token: string

  constructor(options: ReaderHttpControllerOptions) {
    this.#assets = new ReaderAssetRoute(this.#service, options, {
      loadImageTransformer: async () => {
        const { SharpImageTransformer } = await import("../images/sharp/SharpImageTransformer.js")
        return new SharpImageTransformer(options.resourceScheduler)
      },
    })
    this.#token = options.token
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
    await this.#service[Symbol.asyncDispose]()
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
    try {
      const session = await this.#service.openViewSource(
        { kind: "path", path: body.path },
        { initialPage, signal: request.signal },
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
