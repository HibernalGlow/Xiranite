import { createHash, randomBytes } from "node:crypto"
import type { ThumbnailAsset, ThumbnailLease } from "@xiranite/services/thumbnail-coordinator"
import pMap from "p-map"

import {
  ReaderLibraryThumbnailWarmupCommandSchema,
  ReaderLibraryThumbnailWarmupService,
  type ReaderLibraryThumbnailWarmupProgress,
} from "../../application/thumbnails/ReaderLibraryThumbnailWarmupService.js"
import {
  PlatformThumbnailPipeline,
  ThumbnailRetryDeferredError,
  ThumbnailUnavailableError,
  type LibraryThumbnailKind,
  type LibraryThumbnailPreviewCount,
  type LibraryThumbnailSource,
} from "../thumbnails/PlatformThumbnailPipeline.js"

const ASSET_PATH = /^\/reader\/library\/t\/([^/]+)$/
const CONTEXT_PATH = /^\/reader\/library\/contexts\/([^/]+)$/
const REGISTER_PATH = "/reader/library/thumbnails"
const PREWARM_PATH = "/reader/library/thumbnails/prewarm"
const MAX_BATCH_ITEMS = 64
const MAX_ASSETS = 4096

export interface LibraryThumbnailRouteOptions {
  baseUrl: string
  token: string
}

interface LibraryAssetRecord {
  assetId: string
  contextId: string
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
  readonly #warmups = new Set<AbortController>()
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
    const matchesRoute = url.pathname === REGISTER_PATH || url.pathname === PREWARM_PATH || Boolean(assetMatch) || Boolean(contextMatch)
    if (!matchesRoute) return undefined
    if (!this.#isAuthorized(request, url)) return textResponse("Unauthorized", 401)
    if (url.pathname === PREWARM_PATH && request.method === "POST") return this.#prewarm(request)
    if (url.pathname === REGISTER_PATH && request.method === "POST") return this.#register(request)
    if (assetMatch) return this.#serve(request, url, assetMatch[1]!)
    if (contextMatch && request.method === "DELETE") return this.#releaseContext(contextMatch[1]!)
    return new Response("Method not allowed", { status: 405 })
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const warmup of this.#warmups) warmup.abort(new DOMException("Thumbnail route closed", "AbortError"))
    this.#warmups.clear()
    for (const contextId of [...this.#contexts.keys()]) this.#dropContext(contextId)
  }

  async #register(request: Request): Promise<Response> {
    if (this.#closed) return jsonResponse({ error: "Thumbnail route is closed" }, 410)
    const body = await readJson(request)
    const parsed = parseRegistration(body)
    if (!parsed) return jsonResponse({ error: "contextId, generation and 1..64 valid items are required" }, 400)
    const current = this.#contexts.get(parsed.contextId)
    if (current && parsed.generation < current.generation) return jsonResponse({ error: "Thumbnail generation is stale" }, 409)

    const described = (await pMap(parsed.items, async (item) => {
      try {
        const source = await this.#pipeline.describeLibrarySource(item.path, item.kind, request.signal, item.previewCount, "view")
        const sources = item.kind === "folder" && item.previewCount > 1
          ? (await pMap(source.representativePaths ?? [], async (path) => {
              try {
                return await this.#pipeline.describeLibrarySource(path, "file", request.signal, 1, "view")
              } catch (error) {
                if (request.signal.aborted || isAbortError(error)) throw error
                return undefined
              }
            }, { concurrency: 4, stopOnError: true })).filter((value): value is LibraryThumbnailSource => value !== undefined)
          : [source]
        if (!sources.length) return undefined
        return { item, sources }
      } catch (error) {
        if (request.signal.aborted || isAbortError(error)) throw error
        return undefined
      }
    }, { concurrency: 16, stopOnError: true })).filter((value): value is { item: RegistrationItem; sources: LibraryThumbnailSource[] } => value !== undefined)
    const refreshContextId = `${pipelineContextId(parsed.contextId)}:refresh`
    try {
      await pMap(described.filter(({ item }) => item.refresh).flatMap(({ sources }) => sources), (source) => this.#pipeline.refreshLibrary(source, {
        contextId: refreshContextId,
        generation: parsed.generation,
        lane: "reader-visible",
        signal: request.signal,
      }), { concurrency: 4, stopOnError: true })
    } catch (error) {
      if (request.signal.aborted || isAbortError(error)) throw error
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500)
    } finally {
      this.#pipeline.releaseContext(refreshContextId)
    }
    try {
      await this.#pipeline.prewarmLibrary(described.filter(({ item }) => !item.refresh).flatMap(({ sources }) => sources), { signal: request.signal })
    } catch (error) {
      if (request.signal.aborted || isAbortError(error)) throw error
    }
    const latest = this.#contexts.get(parsed.contextId)
    if (latest && parsed.generation < latest.generation) return jsonResponse({ error: "Thumbnail generation is stale" }, 409)
    const context: ContextRecord = latest ?? { generation: parsed.generation, assetIds: new Set() }
    context.generation = parsed.generation
    this.#contexts.set(parsed.contextId, context)
    const items = described.map(({ item, sources }) => {
      const records = sources.map((source) => {
        const assetId = randomBytes(18).toString("base64url")
        const record: LibraryAssetRecord = { assetId, contextId: parsed.contextId, source }
        this.#assets.set(assetId, record)
        context.assetIds.add(assetId)
        this.#trimAssets()
        return record
      })
      const thumbnailUrls = records.map((record) => this.#assetUrl(record))
      return {
        id: item.id,
        thumbnailUrl: thumbnailUrls[0]!,
        ...(thumbnailUrls.length > 1 ? { thumbnailUrls } : {}),
        contentVersion: sources.map((source) => source.contentVersion).join("|"),
      }
    })
    return jsonResponse({ contextId: parsed.contextId, generation: parsed.generation, items }, 201)
  }

  async #prewarm(request: Request): Promise<Response> {
    if (this.#closed) return jsonResponse({ error: "Thumbnail route is closed" }, 410)
    const body = await readJson(request)
    const parsed = ReaderLibraryThumbnailWarmupCommandSchema.safeParse(body)
    if (!parsed.success) return jsonResponse({ error: "1..256 valid thumbnail warmup items are required" }, 400)
    const contextId = `library:warmup:${randomBytes(18).toString("base64url")}`
    const operation = new AbortController()
    this.#warmups.add(operation)
    const abort = () => operation.abort(request.signal.reason ?? new DOMException("Thumbnail warmup request cancelled", "AbortError"))
    if (request.signal.aborted) abort()
    else request.signal.addEventListener("abort", abort, { once: true })
    const service = new ReaderLibraryThumbnailWarmupService({
      warm: async (item, options) => {
        const source = await this.#pipeline.describeLibrarySource(item.path, item.kind, options.signal, item.previewCount, "background")
        if (options.mode === "refresh") {
          await this.#pipeline.refreshLibrary(source, {
            contextId: options.contextId,
            generation: 0,
            lane: "background",
            signal: options.signal,
          })
          return
        }
        const lease = this.#pipeline.acquireLibrary(source, {
          contextId: options.contextId,
          generation: 0,
          lane: "background",
          signal: options.signal,
        })
        try {
          await lease.ready
        } finally {
          lease.release()
        }
      },
    })
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const write = (value: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`))
        write({ type: "start", total: parsed.data.items.length })
        void service.run(parsed.data, {
          contextId,
          signal: operation.signal,
          onProgress: (progress: ReaderLibraryThumbnailWarmupProgress) => write(progress),
        }).then((summary) => {
          write({ type: "complete", ...summary })
          controller.close()
        }).catch((error) => {
          try {
            if (!operation.signal.aborted) controller.error(error)
            else controller.close()
          } catch {
            // The response consumer may already have cancelled the stream.
          }
        }).finally(() => {
          request.signal.removeEventListener("abort", abort)
          this.#warmups.delete(operation)
          this.#pipeline.releaseContext(contextId)
        })
      },
      cancel: (reason) => operation.abort(reason),
    })
    return new Response(stream, {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    })
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
      const context = this.#contexts.get(record.contextId)
      if (!context) return textResponse("Library thumbnail context was released", 404)
      lease = this.#pipeline.acquireLibrary(record.source, {
        contextId: pipelineAssetContextId(record),
        generation: 0,
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
    this.#dropContext(contextId)
    return new Response(null, { status: 204 })
  }

  #dropContext(contextId: string): void {
    const context = this.#contexts.get(contextId)
    if (!context) return
    for (const assetId of context.assetIds) {
      const record = this.#assets.get(assetId)
      if (record) this.#pipeline.releaseContext(pipelineAssetContextId(record))
      this.#assets.delete(assetId)
    }
    this.#contexts.delete(contextId)
  }

  #trimAssets(): void {
    while (this.#assets.size > MAX_ASSETS) {
      const oldestId = this.#assets.keys().next().value as string | undefined
      if (!oldestId) return
      const record = this.#assets.get(oldestId)
      this.#assets.delete(oldestId)
      if (record) {
        this.#pipeline.releaseContext(pipelineAssetContextId(record))
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

interface RegistrationItem { id: string; path: string; kind: LibraryThumbnailKind; previewCount: LibraryThumbnailPreviewCount; refresh: boolean }

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
    const previewCount = item.previewCount ?? 1
    if (previewCount !== 1 && previewCount !== 4 && previewCount !== 9 && previewCount !== 16) return undefined
    if (item.kind !== "folder" && previewCount !== 1) return undefined
    if (item.refresh !== undefined && typeof item.refresh !== "boolean") return undefined
    ids.add(item.id)
    items.push({ id: item.id, path: item.path, kind: item.kind, previewCount, refresh: item.refresh === true })
  }
  return { contextId: body.contextId, generation: body.generation as number, items }
}

async function readJson(request: Request): Promise<Record<string, unknown> | undefined> {
  const length = Number(request.headers.get("content-length") ?? 0)
  if (Number.isFinite(length) && length > 256 * 1024) return undefined
  return request.json().catch(() => undefined) as Promise<Record<string, unknown> | undefined>
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

function pipelineAssetContextId(record: LibraryAssetRecord): string {
  return `${pipelineContextId(record.contextId)}:asset:${record.assetId}`
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" } })
}

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } })
}
