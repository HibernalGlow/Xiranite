import { createHash } from "node:crypto"
import {
  type ThumbnailAsset,
  type ThumbnailLease,
} from "@xiranite/services/thumbnail-coordinator"

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
import type { ReaderPresentationDiskCache } from "../../ports/ReaderPresentationDiskCache.js"
import type { CachedPresentation, ReaderPresentationCache } from "../../ports/ReaderPresentationCache.js"
import type { ReaderThumbnailStore } from "../../ports/ReaderThumbnailStore.js"
import {
  PlatformThumbnailPipeline,
  ThumbnailRetryDeferredError,
  ThumbnailUnavailableError,
  type ThumbnailPrewarmResult,
} from "../thumbnails/PlatformThumbnailPipeline.js"
import { buildPresentationCacheKey, SHARP_PRESENTATION_PRODUCER_VERSION } from "../cache/PresentationCacheKey.js"

const PAGE_PATH = /^\/reader\/s\/([^/]+)\/page\/([^/]+)$/
const THUMBNAIL_PATH = /^\/reader\/s\/([^/]+)\/thumbnail\/([^/]+)$/

export interface ReaderAssetRouteOptions {
  baseUrl: string
  token: string
}

export interface ReaderAssetRouteDependencies {
  loadImageTransformer?: ImageTransformerLoader
  presentationCache?: ReaderPresentationCache
  presentationDiskCache?: ReaderPresentationDiskCache
  presentationProducerVersion?: string
  thumbnailStore?: ReaderThumbnailStore
  thumbnailPipeline?: PlatformThumbnailPipeline
}

export class ReaderAssetRoute {
  readonly #readerService: ReaderService
  readonly #baseUrl: string
  readonly #token: string
  readonly #loadImageTransformer?: ImageTransformerLoader
  readonly #presentationCache?: ReaderPresentationCache
  readonly #presentationDiskCache?: ReaderPresentationDiskCache
  readonly #presentationProducerVersion: string
  readonly #thumbnailPipeline?: PlatformThumbnailPipeline
  readonly #ownsThumbnailPipeline: boolean
  readonly #transformFlights = new Map<string, Promise<CachedPresentation | undefined>>()
  #imageTransformer?: Promise<ImageTransformer>
  #workController = new AbortController()
  #presentationEpoch = 0
  #closed = false

  constructor(
    readerService: ReaderService,
    options: ReaderAssetRouteOptions,
    dependencies: ReaderAssetRouteDependencies = {},
  ) {
    this.#readerService = readerService
    this.#baseUrl = options.baseUrl.replace(/\/$/, "")
    this.#token = options.token
    this.#loadImageTransformer = dependencies.loadImageTransformer
    this.#presentationCache = dependencies.presentationCache
    this.#presentationDiskCache = dependencies.presentationDiskCache
    this.#presentationProducerVersion = dependencies.presentationProducerVersion ?? SHARP_PRESENTATION_PRODUCER_VERSION
    this.#ownsThumbnailPipeline = !dependencies.thumbnailPipeline
      && Boolean(dependencies.thumbnailStore || dependencies.loadImageTransformer)
    this.#thumbnailPipeline = dependencies.thumbnailPipeline ?? (
      this.#ownsThumbnailPipeline
        ? new PlatformThumbnailPipeline({
            loadImageTransformer: dependencies.loadImageTransformer,
            thumbnailStore: dependencies.thumbnailStore,
            maxMemoryBytes: 32 * 1024 * 1024,
            maxEntryBytes: 512 * 1024,
          })
        : undefined
    )
  }

  thumbnailUrl(sessionId: ReaderSessionId, pageId: PageId): string | undefined {
    if (!this.#thumbnailPipeline?.available) return undefined
    const session = this.#readerService.getSession(sessionId)
    const page = session?.getPage(pageId)
    if (!page || !this.#thumbnailPipeline.supportsPage(page)) return undefined
    const path = `/reader/s/${encodeURIComponent(sessionId)}/thumbnail/${encodeURIComponent(pageId)}`
    const url = new URL(path, this.#baseUrl)
    url.searchParams.set("version", page.contentVersion)
    url.searchParams.set("token", this.#token)
    return url.href
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
    if (transform) url.searchParams.set("producer", this.#presentationProducerVersion)
    return url.href
  }

  prewarmThumbnails(pages: readonly ReaderPage[], signal?: AbortSignal): Promise<ThumbnailPrewarmResult> {
    return this.#thumbnailPipeline?.prewarmPages(pages, { signal })
      ?? Promise.resolve({ requested: pages.length, databaseHits: 0, primed: 0 })
  }

  async handle(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url)
    const thumbnailMatch = THUMBNAIL_PATH.exec(url.pathname)
    if (thumbnailMatch) return this.#handleThumbnail(request, url, thumbnailMatch[1]!, thumbnailMatch[2]!)
    const match = PAGE_PATH.exec(url.pathname)
    if (!match) return undefined
    if (this.#closed) return textResponse("Reader asset route is closed", 410)
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
    if (transform) return this.#respondTransformed(request, page, transform)
    const source = await page.content.load(request.signal)
    try {
      return await this.#respondOriginal(request, page, source)
    } catch (error) {
      await source.close().catch(() => undefined)
      throw error
    }
  }

  async #handleThumbnail(
    request: Request,
    url: URL,
    encodedSessionId: string,
    encodedPageId: string,
  ): Promise<Response> {
    if (this.#closed) return textResponse("Reader asset route is closed", 410)
    if (!this.#isAuthorized(request, url)) return textResponse("Unauthorized", 401)
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } })
    }
    const sessionId = safeDecode(encodedSessionId)
    const pageId = safeDecode(encodedPageId)
    if (!sessionId || !pageId) return textResponse("Invalid reader asset identifier", 400)
    const page = this.#readerService.getSession(sessionId)?.getPage(pageId)
    if (!page?.thumbnailSource || !this.#thumbnailPipeline?.available) return textResponse("Reader thumbnail not found", 404)
    if (url.searchParams.get("version") !== page.contentVersion) return textResponse("Reader thumbnail version is stale", 410)
    request.signal.throwIfAborted()
    let lease: ThumbnailLease | undefined
    let thumbnail: ThumbnailAsset
    try {
      lease = this.#thumbnailPipeline.acquirePage(page, {
        lane: "reader-visible",
        contextId: `reader:${sessionId}`,
        generation: 0,
        signal: request.signal,
      })
      thumbnail = await lease.ready
    } catch (error) {
      lease?.release()
      if (error instanceof ThumbnailUnavailableError) return textResponse("Reader thumbnail not found", 404)
      if (error instanceof ThumbnailRetryDeferredError) {
        return new Response("Reader thumbnail retry is deferred", {
          status: 429,
          headers: {
            "cache-control": "private, no-store",
            "retry-after": String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))),
            "x-content-type-options": "nosniff",
          },
        })
      }
      throw error
    }
    if (!thumbnail.contentType?.startsWith("image/")) {
      lease.release()
      return textResponse("Reader thumbnail has an unsupported content type", 415)
    }
    const etag = thumbnailEtag(page, thumbnail)
    const headers = new Headers({
      "cache-control": thumbnail.cacheable === false ? "private, no-cache" : "private, max-age=31536000, immutable",
      "content-type": thumbnail.contentType,
      "content-length": String(thumbnail.bytes.byteLength),
      "etag": etag,
      "x-content-type-options": "nosniff",
    })
    if (matchesEtag(request.headers.get("if-none-match"), etag)) {
      lease.release()
      headers.delete("content-length")
      return new Response(null, { status: 304, headers })
    }
    if (request.method === "HEAD") {
      lease.release()
      return new Response(null, { status: 200, headers })
    }
    const response = new Response(streamCachedBytes(thumbnail.bytes), { status: 200, headers })
    lease.release()
    return response
  }

  clearPresentationCache(): void {
    this.#presentationEpoch += 1
    this.#presentationCache?.clear()
  }

  hibernate(): { thumbnailEntries: number; thumbnailBytes: number } {
    const activeController = this.#workController
    this.#workController = new AbortController()
    activeController.abort(abortError("Reader assets hibernated."))
    this.clearPresentationCache()
    const evicted = this.#thumbnailPipeline?.hibernateReader() ?? { entries: 0, bytes: 0 }
    return { thumbnailEntries: evicted.entries, thumbnailBytes: evicted.bytes }
  }

  close(): void {
    if (this.#closed) return
    this.hibernate()
    this.#closed = true
    if (this.#ownsThumbnailPipeline) void this.#thumbnailPipeline?.dispose()
  }

  async #respondOriginal(request: Request, page: ReaderPage, source: PageSource): Promise<Response> {
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

  async #respondTransformed(
    request: Request,
    page: ReaderPage,
    transform: ImageTransformRequest,
  ): Promise<Response> {
    const workSignal = AbortSignal.any([request.signal, this.#workController.signal])
    workSignal.throwIfAborted()
    const transformKey = imageTransformCacheKey(transform)
    const etag = pageEtag(page, `${transformKey}:${this.#presentationProducerVersion}`)
    const cacheKey = buildPresentationCacheKey({
      cacheKind: "presentation-transform",
      sourceIdentity: page.sourcePath,
      sourceRevision: page.contentVersion,
      entryIdentity: page.entryPath ?? page.id,
      producerVersion: this.#presentationProducerVersion,
      transformProfile: transformKey,
    })
    const headers = new Headers({
      "cache-control": "private, max-age=31536000, immutable",
      "content-type": imageTransformContentType(transform.format),
      "etag": etag,
      "x-content-type-options": "nosniff",
    })
    if (matchesEtag(request.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers })
    const cached = this.#presentationCache?.get(cacheKey)
    if (request.method === "HEAD") {
      if (cached) headers.set("content-length", String(cached.bytes.byteLength))
      return new Response(null, { status: 200, headers })
    }
    if (cached) return cachedPresentationResponse(cached, headers)
    const diskLease = await this.#presentationDiskCache?.acquire(cacheKey, workSignal).catch(() => undefined)
    workSignal.throwIfAborted()
    if (diskLease) {
      const presentation = { bytes: diskLease.bytes, contentType: diskLease.contentType }
      this.#presentationCache?.set(cacheKey, presentation)
      const response = cachedPresentationResponse(presentation, headers)
      diskLease.release()
      return response
    }
    const active = this.#transformFlights.get(cacheKey)
    if (active) {
      const shared = await waitForSharedTransform(active, workSignal)
      if (shared) return cachedPresentationResponse(shared, headers)
      workSignal.throwIfAborted()
      return this.#respondTransformed(request, page, transform)
    }

    let settleFlight: ((value: CachedPresentation | undefined) => void) | undefined
    const presentationEpoch = this.#presentationEpoch
    if (this.#presentationCache) {
      const completion = new Promise<CachedPresentation | undefined>((resolve) => { settleFlight = resolve })
      this.#transformFlights.set(cacheKey, completion)
    }

    let source: PageSource | undefined
    try {
      source = await page.content.load(workSignal)
      const input = await source.open(workSignal)
      const transformer = await this.#getImageTransformer()
      workSignal.throwIfAborted()
      const result = await transformer.transform(input, transform, workSignal)
      const expectedContentType = imageTransformContentType(transform.format)
      if (result.contentType !== expectedContentType) {
        await result.stream.cancel("unexpected image transform content type").catch(() => undefined)
        throw new Error(`Image transformer returned ${result.contentType}; expected ${expectedContentType}.`)
      }
      if (!this.#presentationCache || !settleFlight) {
        return new Response(finalizePageStream(result.stream, source), { status: 200, headers })
      }
      const [responseStream, cacheStream] = result.stream.tee()
      const cacheCompletion = collectPresentation(cacheStream, this.#presentationCache.maxEntryBytes, expectedContentType)
        .then((presentation) => {
          if (presentation && (this.#closed || presentationEpoch !== this.#presentationEpoch
            || !this.#presentationCache!.set(cacheKey, presentation))) {
            presentation = undefined
          }
          if (presentation && this.#presentationDiskCache) {
            void this.#presentationDiskCache.put(cacheKey, presentation)
          }
          this.#transformFlights.delete(cacheKey)
          settleFlight!(presentation)
        }, () => {
          this.#transformFlights.delete(cacheKey)
          settleFlight!(undefined)
        })
      return new Response(finalizePageStream(responseStream, source, cacheCompletion), { status: 200, headers })
    } catch (error) {
      this.#transformFlights.delete(cacheKey)
      settleFlight?.(undefined)
      await source?.close().catch(() => undefined)
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

function finalizePageStream(
  stream: ReadableStream<Uint8Array>,
  source: PageSource,
  beforeNormalClose?: Promise<void>,
): ReadableStream<Uint8Array> {
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
          await beforeNormalClose
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

async function collectPresentation(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  contentType: string,
): Promise<CachedPresentation | undefined> {
  const reader = stream.getReader()
  let chunks: Uint8Array[] | undefined = []
  let bytes = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      if (!chunks) continue
      const nextBytes = bytes + result.value.byteLength
      if (nextBytes > maxBytes) {
        chunks = undefined
        continue
      }
      chunks.push(result.value)
      bytes = nextBytes
    }
    if (!chunks || bytes === 0) return undefined
    const output = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) {
      output.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { bytes: output, contentType }
  } finally {
    reader.releaseLock()
  }
}

function cachedPresentationResponse(presentation: CachedPresentation, sourceHeaders: Headers): Response {
  const headers = new Headers(sourceHeaders)
  headers.set("content-type", presentation.contentType)
  headers.set("content-length", String(presentation.bytes.byteLength))
  return new Response(streamCachedBytes(presentation.bytes), { status: 200, headers })
}

function streamCachedBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close()
        return
      }
      const end = Math.min(offset + 64 * 1024, bytes.byteLength)
      controller.enqueue(bytes.subarray(offset, end))
      offset = end
    },
  })
}

function waitForSharedTransform(
  completion: Promise<CachedPresentation | undefined>,
  signal: AbortSignal,
): Promise<CachedPresentation | undefined> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(signal.reason)
    }
    const cleanup = () => signal.removeEventListener("abort", onAbort)
    signal.addEventListener("abort", onAbort, { once: true })
    completion.then(
      (value) => { cleanup(); resolve(value) },
      (error) => { cleanup(); reject(error) },
    )
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

function thumbnailEtag(page: ReaderPage, thumbnail: ThumbnailAsset): string {
  const hash = createHash("sha256")
    .update(page.id)
    .update("\0")
    .update(page.contentVersion)
    .update("\0")
    .update(thumbnail.version ?? "")
    .update("\0")
    .update(String(thumbnail.bytes.byteLength))
    .update("\0")
    .update(thumbnail.bytes)
    .digest("base64url")
  return `"neoview-thumb-${hash}"`
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

function abortError(message: string): DOMException {
  return new DOMException(message, "AbortError")
}

function textResponse(body: string, status: number, headers?: Headers): Response {
  const responseHeaders = new Headers(headers)
  responseHeaders.set("content-type", "text/plain; charset=utf-8")
  responseHeaders.set("cache-control", "no-store")
  return new Response(body, { status, headers: responseHeaders })
}
