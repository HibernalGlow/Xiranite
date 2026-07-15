import { createHash } from "node:crypto"
import { readdir, realpath, stat } from "node:fs/promises"
import { join } from "node:path"
import {
  ThumbnailCoordinatorService,
  thumbnailLanePriority,
  type ThumbnailAsset,
  type ThumbnailCoordinatorSnapshot,
  type ThumbnailDemand,
  type ThumbnailLane,
  type ThumbnailLease,
} from "@xiranite/services/thumbnail-coordinator"

import type { PageSource } from "../../domain/page/page-content.js"
import type { ReaderPage } from "../../domain/page/page.js"
import { pageMediaType } from "../../domain/page/media.js"
import { compareNaturalPath } from "../../domain/sorting/natural-sort.js"
import type { ImageTransformer, ImageTransformerLoader } from "../../ports/ImageTransformer.js"
import type { ReaderBookLoader } from "../../ports/ReaderBookLoader.js"
import type { ReaderThumbnailFailure, ReaderThumbnailStore } from "../../ports/ReaderThumbnailStore.js"
import type { VideoThumbnailProvider, VideoThumbnailProviderLoader } from "../../ports/VideoThumbnailProvider.js"

export interface PlatformThumbnailPipelineOptions {
  loadImageTransformer?: ImageTransformerLoader
  thumbnailStore?: ReaderThumbnailStore
  bookLoader?: ReaderBookLoader
  loadVideoThumbnailProvider?: VideoThumbnailProviderLoader
  maxMemoryBytes?: number
  maxEntryBytes?: number
}

interface PageThumbnailDemandSource {
  kind: "page"
  page: ReaderPage
  profile: "page-strip-v1"
}

export type LibraryThumbnailKind = "file" | "folder"

export interface LibraryThumbnailSource {
  kind: LibraryThumbnailKind
  path: string
  sourceSize?: number
  modifiedAtMs: number
  representativeVersion?: string
  contentVersion: string
}

interface LibraryThumbnailDemandSource {
  kind: "library"
  source: LibraryThumbnailSource
  profile: "library-cover-v1"
}

type PlatformThumbnailDemandSource = PageThumbnailDemandSource | LibraryThumbnailDemandSource

export interface PageThumbnailAcquireOptions {
  contextId: string
  generation?: number
  lane?: ThumbnailLane
  signal?: AbortSignal
}

export interface ThumbnailPrewarmResult {
  requested: number
  databaseHits: number
  primed: number
}

export class PlatformThumbnailPipeline implements AsyncDisposable {
  readonly #loadImageTransformer?: ImageTransformerLoader
  readonly #thumbnailStore?: ReaderThumbnailStore
  readonly #bookLoader?: ReaderBookLoader
  readonly #loadVideoThumbnailProvider?: VideoThumbnailProviderLoader
  readonly #coordinator: ThumbnailCoordinatorService<PlatformThumbnailDemandSource>
  #imageTransformer?: Promise<ImageTransformer>
  #videoThumbnailProvider?: Promise<VideoThumbnailProvider>

  constructor(options: PlatformThumbnailPipelineOptions = {}) {
    this.#loadImageTransformer = options.loadImageTransformer
    this.#thumbnailStore = options.thumbnailStore
    this.#bookLoader = options.bookLoader
    this.#loadVideoThumbnailProvider = options.loadVideoThumbnailProvider
    this.#coordinator = new ThumbnailCoordinatorService<PlatformThumbnailDemandSource>({
      maxMemoryBytes: options.maxMemoryBytes,
      maxEntryBytes: options.maxEntryBytes,
      resolver: { resolve: (demand, signal) => this.#resolve(demand, signal) },
    })
  }

  get available(): boolean {
    return Boolean(this.#thumbnailStore || this.#loadImageTransformer || this.#loadVideoThumbnailProvider)
  }

  supportsPage(page: ReaderPage): boolean {
    return Boolean(page.thumbnailSource) && (
      page.mediaKind === "image" || page.mediaKind === "animated-image"
      || (page.mediaKind === "video" && Boolean(this.#loadVideoThumbnailProvider) && !page.entryPath)
    )
  }

  acquirePage(page: ReaderPage, options: PageThumbnailAcquireOptions): ThumbnailLease {
    if (!this.supportsPage(page)) throw new ThumbnailUnavailableError()
    const profile = "page-strip-v1" as const
    return this.#coordinator.acquire({
      cacheKey: pageThumbnailCacheKey(page, profile),
      source: { kind: "page", page, profile },
      lane: options.lane ?? "reader-visible",
      contextId: options.contextId,
      generation: options.generation ?? 0,
      signal: options.signal,
    })
  }

  async prewarmPages(
    pages: readonly ReaderPage[],
    options: { ttlMs?: number; signal?: AbortSignal } = {},
  ): Promise<ThumbnailPrewarmResult> {
    options.signal?.throwIfAborted()
    const ttlMs = options.ttlMs ?? 500
    const store = this.#thumbnailStore
    if (!store?.getMany || !pages.length) return { requested: pages.length, databaseHits: 0, primed: 0 }
    if (pages.length > 512) throw new RangeError("Thumbnail prewarm batch cannot exceed 512 pages.")
    const candidates = pages.filter((page) => page.thumbnailSource
      && (page.mediaKind === "image" || page.mediaKind === "animated-image" || page.mediaKind === "video"))
    const byCategory = new Map<"file" | "folder", ReaderPage[]>()
    for (const page of candidates) {
      const category = page.thumbnailSource!.category
      const current = byCategory.get(category)
      if (current) current.push(page)
      else byCategory.set(category, [page])
    }

    let databaseHits = 0
    let primed = 0
    const primedKeys = new Set<string>()
    for (const [category, categoryPages] of byCategory) {
      options.signal?.throwIfAborted()
      const records = await store.getMany(categoryPages.map((page) => page.thumbnailSource!.key), category)
      options.signal?.throwIfAborted()
      for (const page of categoryPages) {
        const record = records.get(page.thumbnailSource!.key)
        const sizeMatches = record?.sourceSize === undefined || page.byteLength === undefined || record.sourceSize === page.byteLength
        if (!record?.contentType?.startsWith("image/") || !sizeMatches) continue
        databaseHits += 1
        const cacheKey = pageThumbnailCacheKey(page, "page-strip-v1")
        if (primedKeys.has(cacheKey)) continue
        primedKeys.add(cacheKey)
        if (this.#coordinator.prime(cacheKey, {
          bytes: record.bytes,
          contentType: record.contentType,
          version: `${record.date ?? ""}:${record.generationHash ?? ""}`,
          cacheable: false,
        }, { ttlMs })) primed += 1
      }
    }
    return { requested: pages.length, databaseHits, primed }
  }

  async describeLibrarySource(path: string, kind: LibraryThumbnailKind, signal?: AbortSignal): Promise<LibraryThumbnailSource> {
    signal?.throwIfAborted()
    const normalizedPath = await realpath(path)
    signal?.throwIfAborted()
    const sourceStats = await stat(normalizedPath)
    if ((kind === "file" && !sourceStats.isFile()) || (kind === "folder" && !sourceStats.isDirectory())) {
      throw new Error(`Thumbnail source does not match ${kind}: ${path}`)
    }
    const sourceSize = kind === "file" ? sourceStats.size : undefined
    const modifiedAtMs = Math.trunc(sourceStats.mtimeMs)
    const representativeVersion = kind === "folder" ? await describeFolderRepresentative(normalizedPath, signal) : undefined
    return {
      kind,
      path: normalizedPath,
      sourceSize,
      modifiedAtMs,
      representativeVersion,
      contentVersion: `${kind}:${sourceSize ?? "directory"}:${modifiedAtMs}:${representativeVersion ?? "empty"}:library-cover-v1`,
    }
  }

  acquireLibrary(source: LibraryThumbnailSource, options: PageThumbnailAcquireOptions): ThumbnailLease {
    const profile = "library-cover-v1" as const
    return this.#coordinator.acquire({
      cacheKey: `${source.kind}:${source.path}:${source.contentVersion}:${profile}`,
      source: { kind: "library", source, profile },
      lane: options.lane ?? (source.kind === "folder" ? "folder-preview" : "library-visible"),
      contextId: options.contextId,
      generation: options.generation ?? 0,
      signal: options.signal,
    })
  }

  advanceContext(contextId: string, generation: number): void {
    this.#coordinator.advanceContext(contextId, generation)
  }

  releaseContext(contextId: string): void {
    this.#coordinator.releaseContext(contextId)
  }

  snapshot(): ThumbnailCoordinatorSnapshot {
    return this.#coordinator.snapshot()
  }

  async dispose(): Promise<void> {
    await this.#coordinator.dispose()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose()
  }

  async #resolve(
    demand: Readonly<ThumbnailDemand<PlatformThumbnailDemandSource>>,
    signal: AbortSignal,
  ): Promise<ThumbnailAsset> {
    switch (demand.source.kind) {
      case "page": return this.#resolvePage(demand.source, demand, signal)
      case "library": return this.#resolveLibrary(demand.source, demand, signal)
    }
  }

  async #resolvePage(
    demandSource: PageThumbnailDemandSource,
    demand: Readonly<ThumbnailDemand<PlatformThumbnailDemandSource>>,
    signal: AbortSignal,
  ): Promise<ThumbnailAsset> {
    const page = demandSource.page
    const persistence = page.thumbnailSource
    const thumbnailStore = this.#thumbnailStore
    if (!persistence) throw new ThumbnailUnavailableError()
    if (thumbnailStore) {
      const stored = await thumbnailStore.get(persistence.key, persistence.category)
      const sizeMatches = stored?.sourceSize === undefined || page.byteLength === undefined || stored.sourceSize === page.byteLength
      if (stored?.contentType?.startsWith("image/") && sizeMatches) {
        return {
          bytes: stored.bytes,
          contentType: stored.contentType,
          version: `${stored.date ?? ""}:${stored.generationHash ?? ""}`,
          cacheable: false,
        }
      }
      const failure = await thumbnailStore.getFailure?.(persistence.key)
      const retryAfterMs = failure ? thumbnailRetryAfterMs(failure) : 0
      if (retryAfterMs > 0) throw new ThumbnailRetryDeferredError(retryAfterMs)
    }
    if (page.mediaKind === "video") {
      if (!this.#loadVideoThumbnailProvider || page.entryPath) throw new ThumbnailUnavailableError()
      try {
        const result = await (await this.#getVideoThumbnailProvider()).generate({
          sourcePath: page.sourcePath,
          maxEdge: 320,
          quality: 78,
          priority: thumbnailLanePriority(demand.lane),
          ownerId: demand.contextId,
        }, signal)
        if (thumbnailStore?.put) {
          void thumbnailStore.put({
            key: persistence.key,
            category: persistence.category,
            bytes: result.bytes,
            sourceSize: page.byteLength,
            date: sqliteTimestamp(new Date()),
            generationHash: thumbnailGenerationHash(page.contentVersion),
          }).catch(() => undefined)
        }
        return { bytes: result.bytes, contentType: result.contentType, version: demandSource.profile, cacheable: true }
      } catch (error) {
        this.#recordFailure(persistence.key, error)
        throw error
      }
    }
    if (!this.#loadImageTransformer) throw new ThumbnailUnavailableError()

    let source: PageSource | undefined
    try {
      source = await page.content.load(signal)
      const input = await source.open(signal)
      const transformer = await this.#getImageTransformer()
      const result = await transformer.transform(input, {
        width: 320,
        height: 320,
        dpr: 1,
        fit: "inside",
        format: "webp",
        quality: 78,
      }, signal, {
        priority: thumbnailLanePriority(demand.lane),
        kind: "neoview.thumbnail.generate",
        ownerId: demand.contextId,
      })
      if (result.contentType !== "image/webp") {
        await result.stream.cancel("unexpected thumbnail content type").catch(() => undefined)
        throw new Error(`Thumbnail transformer returned ${result.contentType}; expected image/webp.`)
      }
      const bytes = await collectThumbnailBytes(result.stream, 2 * 1024 * 1024, signal)
      if (thumbnailStore?.put) {
        void thumbnailStore.put({
          key: persistence.key,
          category: persistence.category,
          bytes,
          sourceSize: page.byteLength,
          date: sqliteTimestamp(new Date()),
          generationHash: thumbnailGenerationHash(page.contentVersion),
        }).catch(() => undefined)
      }
      return { bytes, contentType: result.contentType, version: demandSource.profile, cacheable: true }
    } catch (error) {
      this.#recordFailure(persistence.key, error)
      throw error
    } finally {
      await source?.close().catch(() => undefined)
    }
  }

  async #resolveLibrary(
    demandSource: LibraryThumbnailDemandSource,
    demand: Readonly<ThumbnailDemand<PlatformThumbnailDemandSource>>,
    signal: AbortSignal,
  ): Promise<ThumbnailAsset> {
    const descriptor = demandSource.source
    const thumbnailStore = this.#thumbnailStore
    const category = descriptor.kind
    const expectedHash = thumbnailGenerationHash(descriptor.contentVersion)
    if (thumbnailStore) {
      const stored = await thumbnailStore.get(descriptor.path, category)
      const validFile = descriptor.kind === "file"
        && (stored?.sourceSize === undefined || stored.sourceSize === descriptor.sourceSize)
        && (stored?.generationHash === expectedHash || timestampAtOrAfter(stored?.date, descriptor.modifiedAtMs))
      const validFolder = descriptor.kind === "folder"
        && (stored?.generationHash === expectedHash || timestampAtOrAfter(stored?.date, descriptor.modifiedAtMs))
      if (stored?.contentType?.startsWith("image/") && (validFile || validFolder)) {
        return {
          bytes: stored.bytes,
          contentType: stored.contentType,
          version: `${stored.date ?? ""}:${stored.generationHash ?? ""}`,
          cacheable: false,
        }
      }
      const failure = await thumbnailStore.getFailure?.(descriptor.path)
      const retryAfterMs = failure ? thumbnailRetryAfterMs(failure) : 0
      if (retryAfterMs > 0) throw new ThumbnailRetryDeferredError(retryAfterMs)
    }
    if (!this.#bookLoader || (!this.#loadImageTransformer && !this.#loadVideoThumbnailProvider)) throw new ThumbnailUnavailableError()

    let book: Awaited<ReturnType<ReaderBookLoader>> | undefined
    let source: PageSource | undefined
    try {
      book = await this.#bookLoader({ kind: "path", path: descriptor.path }, { signal })
      const page = book.pages.find((candidate) => candidate.mediaKind === "image" || candidate.mediaKind === "animated-image" || candidate.mediaKind === "video")
      if (!page) throw new ThumbnailUnavailableError()

      const reusable = page.thumbnailSource && thumbnailStore
        ? await thumbnailStore.get(page.thumbnailSource.key, page.thumbnailSource.category)
        : undefined
      const reusableMatches = reusable?.contentType === "image/webp"
        && (reusable.sourceSize === undefined || page.byteLength === undefined || reusable.sourceSize === page.byteLength)
      let bytes: Uint8Array
      if (reusableMatches) {
        bytes = reusable.bytes
      } else if (page.mediaKind === "video") {
        if (!this.#loadVideoThumbnailProvider || page.entryPath) throw new ThumbnailUnavailableError()
        bytes = (await (await this.#getVideoThumbnailProvider()).generate({
          sourcePath: page.sourcePath,
          maxEdge: 416,
          quality: 82,
          priority: thumbnailLanePriority(demand.lane),
          ownerId: demand.contextId,
        }, signal)).bytes
      } else {
        source = await page.content.load(signal)
        const input = await source.open(signal)
        const transformer = await this.#getImageTransformer()
        const result = await transformer.transform(input, {
          width: 416,
          height: 416,
          dpr: 1,
          fit: "inside",
          format: "webp",
          quality: 82,
        }, signal, {
          priority: thumbnailLanePriority(demand.lane),
          kind: "neoview.thumbnail.generate",
          ownerId: demand.contextId,
        })
        if (result.contentType !== "image/webp") {
          await result.stream.cancel("unexpected thumbnail content type").catch(() => undefined)
          throw new Error(`Thumbnail transformer returned ${result.contentType}; expected image/webp.`)
        }
        bytes = await collectThumbnailBytes(result.stream, 2 * 1024 * 1024, signal)
      }

      if (thumbnailStore?.put) {
        void thumbnailStore.put({
          key: descriptor.path,
          category,
          bytes,
          sourceSize: descriptor.kind === "file" ? descriptor.sourceSize : page.byteLength,
          date: sqliteTimestamp(new Date()),
          generationHash: expectedHash,
        }).catch(() => undefined)
      }
      return { bytes, contentType: "image/webp", version: demandSource.profile, cacheable: true }
    } catch (error) {
      if (thumbnailStore?.recordFailure && !isAbortError(error) && !(error instanceof ThumbnailUnavailableError)) {
        void thumbnailStore.recordFailure({
          key: descriptor.path,
          reason: thumbnailFailureReason(error),
          lastAttempt: sqliteTimestamp(new Date()),
          errorMessage: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined)
      }
      throw error
    } finally {
      await source?.close().catch(() => undefined)
      await book?.close().catch(() => undefined)
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

  #getVideoThumbnailProvider(): Promise<VideoThumbnailProvider> {
    if (!this.#loadVideoThumbnailProvider) return Promise.reject(new ThumbnailUnavailableError())
    if (!this.#videoThumbnailProvider) {
      const pending = this.#loadVideoThumbnailProvider()
      const guarded = pending.catch((error) => {
        if (this.#videoThumbnailProvider === guarded) this.#videoThumbnailProvider = undefined
        throw error
      })
      this.#videoThumbnailProvider = guarded
    }
    return this.#videoThumbnailProvider
  }

  #recordFailure(key: string, error: unknown): void {
    const thumbnailStore = this.#thumbnailStore
    if (!thumbnailStore?.recordFailure || isAbortError(error) || error instanceof ThumbnailUnavailableError) return
    void thumbnailStore.recordFailure({
      key,
      reason: thumbnailFailureReason(error),
      lastAttempt: sqliteTimestamp(new Date()),
      errorMessage: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined)
  }
}

export class ThumbnailUnavailableError extends Error {}

export class ThumbnailRetryDeferredError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`Thumbnail retry is deferred for ${retryAfterMs}ms.`)
  }
}

function thumbnailRetryAfterMs(failure: ReaderThumbnailFailure, now = Date.now()): number {
  const attemptedAt = Date.parse(failure.lastAttempt)
  if (!Number.isFinite(attemptedAt)) return 0
  const exponent = Math.min(14, Math.max(0, failure.retryCount - 1))
  const delay = Math.min(24 * 60 * 60 * 1000, 5_000 * 2 ** exponent)
  return Math.max(0, attemptedAt + delay - now)
}

function thumbnailFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  if (message.includes("password")) return "password-required"
  if (message.includes("unsupported") || message.includes("expected image")) return "unsupported-format"
  if (message.includes("archive") || message.includes("7z") || message.includes("zip")) return "archive-error"
  if (message.includes("ffmpeg") || message.includes("video")) return "video-error"
  if (message.includes("enoent") || message.includes("not found") || message.includes("missing")) return "source-missing"
  return "decode-error"
}

function thumbnailGenerationHash(contentVersion: string): number {
  return createHash("sha256").update(contentVersion).digest().readUInt32LE(0)
}

function sqliteTimestamp(value: Date): string {
  return value.toISOString().replace("T", " ").slice(0, 19)
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function timestampAtOrAfter(value: string | undefined, minimumMs: number): boolean {
  if (!value) return false
  const parsed = Date.parse(value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`)
  return Number.isFinite(parsed) && parsed >= minimumMs
}

function pageThumbnailCacheKey(page: ReaderPage, profile: "page-strip-v1"): string {
  const source = page.thumbnailSource
  if (!source) throw new ThumbnailUnavailableError()
  return `${source.category}:${source.key}:${page.contentVersion}:${profile}`
}

async function describeFolderRepresentative(path: string, signal?: AbortSignal): Promise<string | undefined> {
  signal?.throwIfAborted()
  const entries = await readdir(path, { withFileTypes: true })
  const names = entries
    .filter((entry) => entry.isFile() && pageMediaType(entry.name))
    .map((entry) => entry.name)
    .sort(compareNaturalPath)
  for (const name of names) {
    signal?.throwIfAborted()
    try {
      const sourceStats = await stat(join(path, name))
      if (sourceStats.isFile()) return `${name}:${sourceStats.size}:${Math.trunc(sourceStats.mtimeMs)}`
    } catch (error) {
      if (!isMissingFile(error)) throw error
    }
  }
  return undefined
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
}

async function collectThumbnailBytes(stream: ReadableStream<Uint8Array>, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const result = await reader.read()
      if (result.done) break
      bytes += result.value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel("thumbnail output exceeds the hard byte limit").catch(() => undefined)
        throw new RangeError(`Thumbnail output exceeds ${maxBytes} bytes.`)
      }
      chunks.push(result.value)
    }
    if (!bytes) throw new Error("Thumbnail transformer returned empty bytes.")
    const output = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) {
      output.set(chunk, offset)
      offset += chunk.byteLength
    }
    return output
  } finally {
    reader.releaseLock()
  }
}
