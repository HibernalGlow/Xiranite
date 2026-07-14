import { createHash } from "node:crypto"

import type { ReaderService, ReaderSessionId } from "../../application/reader/contracts.js"
import {
  appendImageTransform,
  imageTransformCacheKey,
  imageTransformContentType,
  parseImageTransform,
  type ImageTransformRequest,
} from "../../domain/image/image-transform.js"
import type { PageByteRange, PageSource } from "../../domain/page/page-content.js"
import type { PageId, ReaderPage } from "../../domain/page/page.js"
import type { ImageTransformer, ImageTransformerLoader } from "../../ports/ImageTransformer.js"

const PAGE_PATH = /^\/reader\/s\/([^/]+)\/page\/([^/]+)$/

export interface ReaderAssetRouteOptions {
  baseUrl: string
  token: string
}

export interface ReaderAssetRouteDependencies {
  loadImageTransformer?: ImageTransformerLoader
}

export class ReaderAssetRoute {
  readonly #readerService: ReaderService
  readonly #baseUrl: string
  readonly #token: string
  readonly #loadImageTransformer?: ImageTransformerLoader
  #imageTransformer?: Promise<ImageTransformer>

  constructor(
    readerService: ReaderService,
    options: ReaderAssetRouteOptions,
    dependencies: ReaderAssetRouteDependencies = {},
  ) {
    this.#readerService = readerService
    this.#baseUrl = options.baseUrl.replace(/\/$/, "")
    this.#token = options.token
    this.#loadImageTransformer = dependencies.loadImageTransformer
  }

  pageUrl(sessionId: ReaderSessionId, pageId: PageId, transform?: ImageTransformRequest): string {
    const session = this.#readerService.getSession(sessionId)
    const page = session?.getPage(pageId)
    if (!page) throw new Error(`Reader page was not found: ${sessionId}/${pageId}`)
    const path = `/reader/s/${encodeURIComponent(sessionId)}/page/${encodeURIComponent(pageId)}`
    const url = new URL(path, this.#baseUrl)
    url.searchParams.set("version", page.contentVersion)
    url.searchParams.set("token", this.#token)
    if (transform) appendImageTransform(url.searchParams, transform)
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
    let transform: ImageTransformRequest | undefined
    try {
      transform = parseImageTransform(url.searchParams)
    } catch (error) {
      return textResponse(error instanceof Error ? error.message : String(error), 400)
    }
    if (transform && page.mediaKind !== "image" && page.mediaKind !== "animated-image") {
      return textResponse("Reader asset does not support image transforms", 415)
    }
    if (transform && !this.#loadImageTransformer) return textResponse("Image transforms are unavailable", 501)

    request.signal.throwIfAborted()
    const source = await page.content.load(request.signal)
    try {
      return await this.#respond(request, page, source, transform)
    } catch (error) {
      await source.close().catch(() => undefined)
      throw error
    }
  }

  async #respond(
    request: Request,
    page: ReaderPage,
    source: PageSource,
    transform?: ImageTransformRequest,
  ): Promise<Response> {
    const size = source.byteLength ?? page.byteLength
    const transformKey = transform ? imageTransformCacheKey(transform) : undefined
    const etag = pageEtag(page, transformKey)
    const headers = new Headers({
      "cache-control": "private, max-age=31536000, immutable",
      "content-type": transform
        ? imageTransformContentType(transform.format)
        : source.contentType ?? page.mimeType ?? "application/octet-stream",
      "etag": etag,
      "x-content-type-options": "nosniff",
    })
    if (!transform && source.rangeSupported) headers.set("accept-ranges", "bytes")
    if (!transform && size !== undefined) headers.set("content-length", String(size))

    if (matchesEtag(request.headers.get("if-none-match"), etag)) {
      await source.close()
      headers.delete("content-length")
      return new Response(null, { status: 304, headers })
    }

    const requestedRange = !transform && source.rangeSupported && size !== undefined
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

    const input = await source.open(request.signal, requestedRange ?? undefined)
    if (!transform) return new Response(finalizePageStream(input, source), { status, headers })
    try {
      const transformer = await this.#getImageTransformer()
      request.signal.throwIfAborted()
      const result = await transformer.transform(input, transform, request.signal)
      const expectedContentType = imageTransformContentType(transform.format)
      if (result.contentType !== expectedContentType) {
        await result.stream.cancel("unexpected image transform content type").catch(() => undefined)
        throw new Error(`Image transformer returned ${result.contentType}; expected ${expectedContentType}.`)
      }
      return new Response(finalizePageStream(result.stream, source), { status, headers })
    } catch (error) {
      await input.cancel(error).catch(() => undefined)
      throw error
    }
  }

  #getImageTransformer(): Promise<ImageTransformer> {
    if (!this.#loadImageTransformer) return Promise.reject(new Error("Image transforms are unavailable"))
    if (!this.#imageTransformer) {
      const pending = this.#loadImageTransformer()
      const guarded = pending.catch((error) => {
        if (this.#imageTransformer === guarded) this.#imageTransformer = undefined
        throw error
      })
      this.#imageTransformer = guarded
    }
    return this.#imageTransformer
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

function pageEtag(page: ReaderPage, transformKey?: string): string {
  const hash = createHash("sha256")
    .update(page.id)
    .update("\0")
    .update(page.contentVersion)
    .update("\0")
    .update(transformKey ?? "original")
    .digest("base64url")
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
