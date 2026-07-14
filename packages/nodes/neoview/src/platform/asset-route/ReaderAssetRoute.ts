import { createHash } from "node:crypto"

import type { ReaderService, ReaderSessionId } from "../../application/reader/contracts.js"
import type { PageByteRange, PageSource } from "../../domain/page/page-content.js"
import type { PageId, ReaderPage } from "../../domain/page/page.js"

const PAGE_PATH = /^\/reader\/s\/([^/]+)\/page\/([^/]+)$/

export interface ReaderAssetRouteOptions {
  baseUrl: string
  token: string
}

export class ReaderAssetRoute {
  readonly #readerService: ReaderService
  readonly #baseUrl: string
  readonly #token: string

  constructor(readerService: ReaderService, options: ReaderAssetRouteOptions) {
    this.#readerService = readerService
    this.#baseUrl = options.baseUrl.replace(/\/$/, "")
    this.#token = options.token
  }

  pageUrl(sessionId: ReaderSessionId, pageId: PageId): string {
    const session = this.#readerService.getSession(sessionId)
    const page = session?.getPage(pageId)
    if (!page) throw new Error(`Reader page was not found: ${sessionId}/${pageId}`)
    const path = `/reader/s/${encodeURIComponent(sessionId)}/page/${encodeURIComponent(pageId)}`
    const url = new URL(path, this.#baseUrl)
    url.searchParams.set("version", page.contentVersion)
    url.searchParams.set("token", this.#token)
    return url.href
  }

  async handle(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url)
    const match = PAGE_PATH.exec(url.pathname)
    if (!match) return undefined
    if (!this.#isAuthorized(request, url)) return textResponse("Unauthorized", 401)
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } })
    }

    const sessionId = safeDecode(match[1]!)
    const pageId = safeDecode(match[2]!)
    if (!sessionId || !pageId) return textResponse("Invalid reader asset identifier", 400)
    const session = this.#readerService.getSession(sessionId)
    const page = session?.getPage(pageId)
    if (!page) return textResponse("Reader page not found", 404)
    if (url.searchParams.get("version") !== page.contentVersion) {
      return textResponse("Reader page version is stale", 410)
    }

    request.signal.throwIfAborted()
    const source = await page.content.load(request.signal)
    try {
      return await this.#respond(request, page, source)
    } catch (error) {
      await source.close().catch(() => undefined)
      throw error
    }
  }

  async #respond(request: Request, page: ReaderPage, source: PageSource): Promise<Response> {
    const size = source.byteLength ?? page.byteLength
    const etag = pageEtag(page)
    const headers = new Headers({
      "cache-control": "private, max-age=31536000, immutable",
      "content-type": source.contentType ?? page.mimeType ?? "application/octet-stream",
      "etag": etag,
      "x-content-type-options": "nosniff",
    })
    if (source.rangeSupported) headers.set("accept-ranges", "bytes")
    if (size !== undefined) headers.set("content-length", String(size))

    if (matchesEtag(request.headers.get("if-none-match"), etag)) {
      await source.close()
      headers.delete("content-length")
      return new Response(null, { status: 304, headers })
    }

    const requestedRange = source.rangeSupported && size !== undefined
      ? parseRangeHeader(request.headers.get("range"), size)
      : null
    if (requestedRange === "invalid") {
      await source.close()
      headers.set("content-range", `bytes */${size}`)
      headers.delete("content-length")
      return textResponse("Requested range is not satisfiable", 416, headers)
    }
    if (requestedRange) {
      headers.set("content-range", `bytes ${requestedRange.start}-${requestedRange.end}/${size}`)
      headers.set("content-length", String(requestedRange.end - requestedRange.start + 1))
    }
    const status = requestedRange ? 206 : 200
    if (request.method === "HEAD") {
      await source.close()
      return new Response(null, { status, headers })
    }

    const stream = await source.open(request.signal, requestedRange ?? undefined)
    return new Response(finalizePageStream(stream, source), { status, headers })
  }

  #isAuthorized(request: Request, url: URL): boolean {
    return request.headers.get("x-xiranite-token") === this.#token || url.searchParams.get("token") === this.#token
  }
}

export function parseRangeHeader(rangeHeader: string | null, size: number): PageByteRange | "invalid" | null {
  if (!rangeHeader) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!match || size <= 0) return "invalid"
  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return "invalid"

  let start: number
  let end: number
  if (!rawStart) {
    const suffixLength = Number(rawEnd)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return "invalid"
    start = Math.max(size - suffixLength, 0)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd ? Number(rawEnd) : size - 1
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
    return "invalid"
  }
  return { start, end: Math.min(end, size - 1) }
}

function finalizePageStream(stream: ReadableStream<Uint8Array>, source: PageSource): ReadableStream<Uint8Array> {
  const reader = stream.getReader()
  let finalizePromise: Promise<void> | undefined
  const finalize = (): Promise<void> => {
    finalizePromise ??= Promise.resolve().then(async () => {
      reader.releaseLock()
      await source.close()
    })
    return finalizePromise
  }
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read()
        if (result.done) {
          await finalize()
          controller.close()
        } else {
          controller.enqueue(result.value)
        }
      } catch (error) {
        await reader.cancel(error).catch(() => undefined)
        await finalize().catch(() => undefined)
        controller.error(error)
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined)
      await finalize()
    },
  })
}

function pageEtag(page: ReaderPage): string {
  const hash = createHash("sha256").update(page.id).update("\0").update(page.contentVersion).digest("base64url")
  return `"neoview-${hash}"`
}

function matchesEtag(value: string | null, etag: string): boolean {
  return value?.split(",").some((candidate) => candidate.trim() === etag || candidate.trim() === "*") ?? false
}

function safeDecode(value: string): string | undefined {
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

function textResponse(body: string, status: number, headers?: Headers): Response {
  const responseHeaders = new Headers(headers)
  responseHeaders.set("content-type", "text/plain; charset=utf-8")
  responseHeaders.set("cache-control", "no-store")
  return new Response(body, { status, headers: responseHeaders })
}
