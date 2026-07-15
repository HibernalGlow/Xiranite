import { createHash, randomBytes } from "node:crypto"
import type { ThumbnailAsset, ThumbnailLease } from "@xiranite/services/thumbnail-coordinator"

import {
  PlatformThumbnailPipeline,
  ThumbnailRetryDeferredError,
  ThumbnailUnavailableError,
  type LibraryThumbnailKind,
  type LibraryThumbnailSource,
} from "../thumbnails/PlatformThumbnailPipeline.js"

const ASSET_PATH = /^\/reader\/library\/t\/([^/]+)$/
const CONTEXT_PATH = /^\/reader\/library\/contexts\/([^/]+)$/
const REGISTER_PATH = "/reader/library/thumbnails"
const MAX_BATCH_ITEMS = 64
const MAX_ASSETS = 4096

export interface LibraryThumbnailRouteOptions {
  baseUrl: string
  token: string
}

interface LibraryAssetRecord {
  assetId: string
  contextId: string
  generation: number
  source: LibraryThumbnailSource
}

interface ContextRecord {
  generation: number
  assetIds: Set<string>
}

export class LibraryThumbnailRoute {
  readonly #pipeline: PlatformThumbnailPipeline
  readonly #baseUrl: string
  readonly #token: string
  readonly #assets = new Map<string, LibraryAssetRecord>()
  readonly #contexts = new Map<string, ContextRecord>()
  #closed = false

  constructor(pipeline: PlatformThumbnailPipeline, options: LibraryThumbnailRouteOptions) {
    this.#pipeline = pipeline
    this.#baseUrl = options.baseUrl.replace(/\/$/, "")
    this.#token = options.token
  }

  async handle(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url)
    const assetMatch = ASSET_PATH.exec(url.pathname)
    const contextMatch = CONTEXT_PATH.exec(url.pathname)
    const matchesRoute = url.pathname === REGISTER_PATH || Boolean(assetMatch) || Boolean(contextMatch)
    if (!matchesRoute) return undefined
    if (!this.#isAuthorized(request, url)) return textResponse("Unauthorized", 401)
    if (url.pathname === REGISTER_PATH && request.method === "POST") return this.#register(request)
    if (assetMatch) return this.#serve(request, url, assetMatch[1]!)
    if (contextMatch && request.method === "DELETE") return this.#releaseContext(contextMatch[1]!)
    return new Response("Method not allowed", { status: 405 })
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const contextId of this.#contexts.keys()) this.#pipeline.releaseContext(pipelineContextId(contextId))
    this.#assets.clear()
    this.#contexts.clear()
  }

  async #register(request: Request): Promise<Response> {
    if (this.#closed) return jsonResponse({ error: "Thumbnail route is closed" }, 410)
    const body = await readJson(request)
    const parsed = parseRegistration(body)
    if (!parsed) return jsonResponse({ error: "contextId, generation and 1..64 valid items are required" }, 400)
    const current = this.#contexts.get(parsed.contextId)
    if (current && parsed.generation < current.generation) return jsonResponse({ error: "Thumbnail generation is stale" }, 409)

    let described: Array<{ item: RegistrationItem; source: LibraryThumbnailSource }>
    try {
      described = await mapConcurrent(parsed.items, 16, async (item) => ({
        item,
        source: await this.#pipeline.describeLibrarySource(item.path, item.kind, request.signal),
      }))
    } catch (error) {
      if (request.signal.aborted) throw error
      return jsonResponse({ error: "One or more thumbnail sources are unavailable or have the wrong kind" }, 400)
    }
    const latest = this.#contexts.get(parsed.contextId)
    if (latest && parsed.generation < latest.generation) return jsonResponse({ error: "Thumbnail generation is stale" }, 409)
    this.#pipeline.releaseContext(pipelineContextId(parsed.contextId))
    this.#pipeline.advanceContext(pipelineContextId(parsed.contextId), parsed.generation)
    this.#dropContext(parsed.contextId)
    const context: ContextRecord = { generation: parsed.generation, assetIds: new Set() }
    this.#contexts.set(parsed.contextId, context)
    const items = described.map(({ item, source }) => {
      const assetId = randomBytes(18).toString("base64url")
      const record: LibraryAssetRecord = { assetId, contextId: parsed.contextId, generation: parsed.generation, source }
      this.#assets.set(assetId, record)
      context.assetIds.add(assetId)
      this.#trimAssets()
      return { id: item.id, thumbnailUrl: this.#assetUrl(record), contentVersion: source.contentVersion }
    })
    return jsonResponse({ contextId: parsed.contextId, generation: parsed.generation, items }, 201)
  }

  async #serve(request: Request, url: URL, encodedAssetId: string): Promise<Response> {
    if (this.#closed) return textResponse("Thumbnail route is closed", 410)
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } })
    }
    const assetId = safeDecode(encodedAssetId)
    const record = assetId ? this.#assets.get(assetId) : undefined
    if (!record) return textResponse("Library thumbnail not found", 404)
    if (url.searchParams.get("version") !== record.source.contentVersion) return textResponse("Library thumbnail version is stale", 410)

    let lease: ThumbnailLease | undefined
    let thumbnail: ThumbnailAsset
    try {
      lease = this.#pipeline.acquireLibrary(record.source, {
        contextId: pipelineContextId(record.contextId),
        generation: record.generation,
        signal: request.signal,
      })
      thumbnail = await lease.ready
    } catch (error) {
      lease?.release()
      if (isAbortError(error)) return textResponse("Library thumbnail demand was superseded", 410)
      if (error instanceof ThumbnailUnavailableError) return textResponse("Library thumbnail is unavailable", 404)
      if (error instanceof ThumbnailRetryDeferredError) {
        return new Response("Library thumbnail retry is deferred", {
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

    const etag = thumbnailEtag(record, thumbnail)
    const headers = new Headers({
      "cache-control": thumbnail.cacheable === false ? "private, no-cache" : "private, max-age=31536000, immutable",
      "content-type": thumbnail.contentType,
      "content-length": String(thumbnail.bytes.byteLength),
      etag,
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
    const response = new Response(streamBytes(thumbnail.bytes), { status: 200, headers })
    lease.release()
    return response
  }

  #releaseContext(encodedContextId: string): Response {
    const contextId = safeDecode(encodedContextId)
    if (!contextId) return jsonResponse({ error: "Invalid thumbnail context" }, 400)
    const context = this.#contexts.get(contextId)
    if (!context) return new Response(null, { status: 204 })
    this.#pipeline.releaseContext(pipelineContextId(contextId))
    this.#dropContext(contextId)
    return new Response(null, { status: 204 })
  }

  #dropContext(contextId: string): void {
    const context = this.#contexts.get(contextId)
    if (!context) return
    for (const assetId of context.assetIds) this.#assets.delete(assetId)
    this.#contexts.delete(contextId)
  }

  #trimAssets(): void {
    while (this.#assets.size > MAX_ASSETS) {
      const oldestId = this.#assets.keys().next().value as string | undefined
      if (!oldestId) return
      const record = this.#assets.get(oldestId)
      this.#assets.delete(oldestId)
      if (record) {
        const context = this.#contexts.get(record.contextId)
        context?.assetIds.delete(oldestId)
        if (context && !context.assetIds.size) this.#contexts.delete(record.contextId)
      }
    }
  }

  #assetUrl(record: LibraryAssetRecord): string {
    const url = new URL(`/reader/library/t/${encodeURIComponent(record.assetId)}`, this.#baseUrl)
    url.searchParams.set("version", record.source.contentVersion)
    url.searchParams.set("token", this.#token)
    return url.href
  }

  #isAuthorized(request: Request, url: URL): boolean {
    return request.headers.get("x-xiranite-token") === this.#token || url.searchParams.get("token") === this.#token
  }
}

interface RegistrationItem { id: string; path: string; kind: LibraryThumbnailKind }

function parseRegistration(body: Record<string, unknown> | undefined): { contextId: string; generation: number; items: RegistrationItem[] } | undefined {
  if (!body || typeof body.contextId !== "string" || !body.contextId || body.contextId.length > 1024) return undefined
  if (!Number.isSafeInteger(body.generation) || (body.generation as number) < 0) return undefined
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > MAX_BATCH_ITEMS) return undefined
  const ids = new Set<string>()
  const items: RegistrationItem[] = []
  for (const value of body.items) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
    const item = value as Record<string, unknown>
    if (typeof item.id !== "string" || !item.id || item.id.length > 1024 || ids.has(item.id)) return undefined
    if (typeof item.path !== "string" || !item.path || item.path.length > 32_768 || item.path.includes("\0")) return undefined
    if (item.kind !== "file" && item.kind !== "folder") return undefined
    ids.add(item.id)
    items.push({ id: item.id, path: item.path, kind: item.kind })
  }
  return { contextId: body.contextId, generation: body.generation as number, items }
}

async function readJson(request: Request): Promise<Record<string, unknown> | undefined> {
  const length = Number(request.headers.get("content-length") ?? 0)
  if (Number.isFinite(length) && length > 256 * 1024) return undefined
  return request.json().catch(() => undefined) as Promise<Record<string, unknown> | undefined>
}

async function mapConcurrent<T, R>(values: readonly T[], concurrency: number, map: (value: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++
      output[index] = await map(values[index]!)
    }
  }))
  return output
}

function thumbnailEtag(record: LibraryAssetRecord, asset: ThumbnailAsset): string {
  const hash = createHash("sha256")
    .update(record.source.contentVersion)
    .update("\0")
    .update(asset.version ?? "")
    .update("\0")
    .update(asset.bytes)
    .digest("base64url")
  return `"neoview-library-thumb-${hash}"`
}

function streamBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) return controller.close()
      const end = Math.min(offset + 64 * 1024, bytes.byteLength)
      controller.enqueue(bytes.subarray(offset, end))
      offset = end
    },
  })
}

function matchesEtag(value: string | null, etag: string): boolean {
  return value?.split(",").some((candidate) => candidate.trim() === etag || candidate.trim() === "*") ?? false
}

function safeDecode(value: string): string | undefined {
  try { return decodeURIComponent(value) } catch { return undefined }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function pipelineContextId(contextId: string): string {
  return `library:${contextId}`
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" } })
}

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } })
}
