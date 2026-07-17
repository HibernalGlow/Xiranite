import { createHash } from "node:crypto"
import { realpath, stat } from "node:fs/promises"
import {
  ThumbnailCoordinatorService,
  thumbnailLanePriority,
  type ThumbnailAsset,
  type ThumbnailCoordinatorSnapshot,
  type ThumbnailDemand,
  type ThumbnailLane,
  type ThumbnailLease,
} from "@xiranite/services/thumbnail-coordinator"
import { LRUCache } from "lru-cache"

import type { PageSource } from "../../domain/page/page-content.js"
import type { ReaderPage } from "../../domain/page/page.js"
import type { ReaderMediaTypeResolver } from "../../domain/page/media.js"
import type { ImageTransformer, ImageTransformerLoader } from "../../ports/ImageTransformer.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import type { ReaderBookLoader } from "../../ports/ReaderBookLoader.js"
import type { ReaderThumbnailAsset, ReaderThumbnailFailure, ReaderThumbnailStore } from "../../ports/ReaderThumbnailStore.js"
import type { SystemThumbnailProvider, SystemThumbnailProviderLoader } from "../../ports/SystemThumbnailProvider.js"
import type { VideoThumbnailProvider, VideoThumbnailProviderLoader } from "../../ports/VideoThumbnailProvider.js"
import type {
  MosaicImageComposer,
  MosaicImageComposerLoader,
  MosaicPreviewCount,
} from "../../ports/MosaicImageComposer.js"
import { FolderRepresentativeIndex } from "./FolderRepresentativeIndex.js"
import { transformPageSource } from "../images/transform-page-source.js"

export interface PlatformThumbnailPipelineOptions {
  loadImageTransformer?: ImageTransformerLoader
  thumbnailStore?: ReaderThumbnailStore
  bookLoader?: ReaderBookLoader
  loadSystemThumbnailProvider?: SystemThumbnailProviderLoader
  loadVideoThumbnailProvider?: VideoThumbnailProviderLoader
  maxMemoryBytes?: number
  maxEntryBytes?: number
  folderRepresentativeIndex?: FolderRepresentativeIndex
  loadMosaicImageComposer?: MosaicImageComposerLoader
  resourceScheduler?: ResourceScheduler
  mediaFormats?: ReaderMediaTypeResolver
}

interface PageThumbnailDemandSource {
  kind: "page"
  page: ReaderPage
  profile: "page-strip-v1"
}

export type LibraryThumbnailKind = "file" | "folder"
export type LibraryThumbnailPreviewCount = 1 | MosaicPreviewCount

export interface LibraryThumbnailSource {
  kind: LibraryThumbnailKind
  path: string
  sourceSize?: number
  modifiedAtMs: number
  representativeVersion?: string
  previewCount: LibraryThumbnailPreviewCount
  contentVersion: string
}

interface LibraryThumbnailDemandSource {
  kind: "library"
  source: LibraryThumbnailSource
  profile: LibraryThumbnailProfile
  refresh: boolean
}

type LibraryThumbnailProfile = "library-cover-v1" | `library-mosaic-${MosaicPreviewCount}-v1`

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
  readonly #loadSystemThumbnailProvider?: SystemThumbnailProviderLoader
  readonly #loadVideoThumbnailProvider?: VideoThumbnailProviderLoader
  readonly #coordinator: ThumbnailCoordinatorService<PlatformThumbnailDemandSource>
  readonly #folderRepresentativeIndex: FolderRepresentativeIndex
  readonly #ownsFolderRepresentativeIndex: boolean
  readonly #loadMosaicImageComposer?: MosaicImageComposerLoader
  readonly #resourceScheduler?: ResourceScheduler
  #imageTransformer?: Promise<ImageTransformer>
  #systemThumbnailProvider?: Promise<SystemThumbnailProvider>
  #videoThumbnailProvider?: Promise<VideoThumbnailProvider>
  #mosaicImageComposer?: Promise<MosaicImageComposer>
  readonly #libraryCacheEpochs: LRUCache<string, number>
  #libraryCacheBaseEpoch = 0
  #nextLibraryCacheEpoch = 1

  constructor(options: PlatformThumbnailPipelineOptions = {}) {
    this.#loadImageTransformer = options.loadImageTransformer
    this.#thumbnailStore = options.thumbnailStore
    this.#bookLoader = options.bookLoader
    this.#loadSystemThumbnailProvider = options.loadSystemThumbnailProvider
    this.#loadVideoThumbnailProvider = options.loadVideoThumbnailProvider
    this.#resourceScheduler = options.resourceScheduler
    this.#loadMosaicImageComposer = options.loadMosaicImageComposer
    this.#ownsFolderRepresentativeIndex = !options.folderRepresentativeIndex
    this.#folderRepresentativeIndex = options.folderRepresentativeIndex ?? new FolderRepresentativeIndex({ mediaFormats: options.mediaFormats })
    this.#coordinator = new ThumbnailCoordinatorService<PlatformThumbnailDemandSource>({
      maxMemoryBytes: options.maxMemoryBytes,
      maxEntryBytes: options.maxEntryBytes,
      resolver: { resolve: (demand, signal) => this.#resolve(demand, signal) },
    })
    this.#libraryCacheEpochs = new LRUCache<string, number>({
      max: 4_096,
      dispose: (_value, _key, reason) => {
        if (reason === "evict") this.#libraryCacheBaseEpoch = this.#nextLibraryCacheEpoch++
      },
    })
  }

  get available(): boolean {
    return Boolean(this.#thumbnailStore || this.#loadImageTransformer
      || this.#loadSystemThumbnailProvider || this.#loadVideoThumbnailProvider)
  }

  supportsPage(page: ReaderPage): boolean {
    return Boolean(page.thumbnailSource) && (
      page.mediaKind === "image" || page.mediaKind === "animated-image"
      || (page.mediaKind === "video" && (
        Boolean(this.#thumbnailStore)
        || Boolean(this.#loadVideoThumbnailProvider)
        || (!page.entryPath && Boolean(this.#loadSystemThumbnailProvider))
      ))
    )
  }

  acquirePage(page: ReaderPage, options: PageThumbnailAcquireOptions): ThumbnailLease {
    if (!this.supportsPage(page)) throw new ThumbnailUnavailableError()
    const profile = "page-strip-v1" as const
    return this.#coordinator.acquire({
      cacheKey: pageThumbnailCacheKey(page, profile, this.#thumbnailRevision()),
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
    const revision = this.#thumbnailRevision()
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
        const cacheKey = pageThumbnailCacheKey(page, "page-strip-v1", revision)
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

  async prewarmLibrary(
    sources: readonly LibraryThumbnailSource[],
    options: { ttlMs?: number; signal?: AbortSignal } = {},
  ): Promise<ThumbnailPrewarmResult> {
    options.signal?.throwIfAborted()
    const ttlMs = options.ttlMs ?? 1_000
    const store = this.#thumbnailStore
    if (!store?.getMany || !sources.length) return { requested: sources.length, databaseHits: 0, primed: 0 }
    if (sources.length > 512) throw new RangeError("Library thumbnail prewarm batch cannot exceed 512 sources.")

    const byCategory = new Map<LibraryThumbnailKind, LibraryThumbnailSource[]>()
    for (const source of sources.filter((source) => source.previewCount === 1)) {
      const current = byCategory.get(source.kind)
      if (current) current.push(source)
      else byCategory.set(source.kind, [source])
    }

    let databaseHits = 0
    let primed = 0
    const revision = this.#thumbnailRevision()
    const primedKeys = new Set<string>()
    for (const [category, categorySources] of byCategory) {
      options.signal?.throwIfAborted()
      const records = await store.getMany([...new Set(categorySources.map((source) => source.path))], category)
      options.signal?.throwIfAborted()
      for (const source of categorySources) {
        const record = records.get(source.path)
        if (!isValidLibraryThumbnail(record, source)) continue
        databaseHits += 1
        const identity = libraryThumbnailCacheIdentity(source, "library-cover-v1")
        const cacheKey = libraryThumbnailCacheKey(source, "library-cover-v1", revision, this.#libraryCacheEpoch(identity), identity)
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
    return { requested: sources.length, databaseHits, primed }
  }

  async describeLibrarySource(
    path: string,
    kind: LibraryThumbnailKind,
    signal?: AbortSignal,
    previewCount: LibraryThumbnailPreviewCount = 1,
  ): Promise<LibraryThumbnailSource> {
    signal?.throwIfAborted()
    if (previewCount !== 1 && previewCount !== 4 && previewCount !== 9 && previewCount !== 16) {
      throw new RangeError("Library thumbnail preview count must be 1, 4, 9 or 16.")
    }
    if (kind !== "folder" && previewCount !== 1) throw new Error("Mosaic previews are only available for folders.")
    const normalizedPath = await realpath(path)
    signal?.throwIfAborted()
    const sourceStats = await stat(normalizedPath)
    if ((kind === "file" && !sourceStats.isFile()) || (kind === "folder" && !sourceStats.isDirectory())) {
      throw new Error(`Thumbnail source does not match ${kind}: ${path}`)
    }
    const sourceSize = kind === "file" ? sourceStats.size : undefined
    const modifiedAtMs = Math.trunc(sourceStats.mtimeMs)
    const representativeVersion = kind === "folder"
      ? await this.#folderRepresentativeIndex.describe(normalizedPath, modifiedAtMs, signal, previewCount)
      : undefined
    const profile = libraryThumbnailProfile(previewCount)
    return {
      kind,
      path: normalizedPath,
      sourceSize,
      modifiedAtMs,
      representativeVersion,
      previewCount,
      contentVersion: `${kind}:${sourceSize ?? "directory"}:${modifiedAtMs}:${representativeVersion ?? "empty"}:${profile}`,
    }
  }

  acquireLibrary(source: LibraryThumbnailSource, options: PageThumbnailAcquireOptions): ThumbnailLease {
    const profile = libraryThumbnailProfile(source.previewCount)
    const identity = libraryThumbnailCacheIdentity(source, profile)
    return this.#coordinator.acquire({
      cacheKey: libraryThumbnailCacheKey(source, profile, this.#thumbnailRevision(), this.#libraryCacheEpoch(identity), identity),
      source: { kind: "library", source, profile, refresh: false },
      lane: options.lane ?? (source.kind === "folder" ? "folder-preview" : "library-visible"),
      contextId: options.contextId,
      generation: options.generation ?? 0,
      signal: options.signal,
    })
  }

  async refreshLibrary(source: LibraryThumbnailSource, options: PageThumbnailAcquireOptions): Promise<ThumbnailAsset> {
    if (source.previewCount === 1 && !this.#thumbnailStore?.put) throw new ThumbnailPersistenceUnavailableError()
    const profile = libraryThumbnailProfile(source.previewCount)
    const identity = libraryThumbnailCacheIdentity(source, profile)
    const targetEpoch = this.#nextLibraryCacheEpoch++
    const lease = this.#coordinator.acquire({
      cacheKey: libraryThumbnailCacheKey(source, profile, this.#thumbnailRevision(), targetEpoch, identity),
      source: { kind: "library", source, profile, refresh: true },
      lane: options.lane ?? "background",
      contextId: options.contextId,
      generation: options.generation ?? 0,
      signal: options.signal,
    })
    try {
      const asset = await lease.ready
      this.#libraryCacheEpochs.set(identity, targetEpoch)
      const prefix = `library:${identity}:`
      this.#coordinator.evictUnpinned((key) => key.startsWith(prefix) && !key.includes(`:local-${targetEpoch}:`))
      return asset
    } finally {
      lease.release()
    }
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

  hibernateReader(): { entries: number; bytes: number } {
    return this.#coordinator.evictUnpinned((key) => key.endsWith(":page-strip-v1"))
  }

  async dispose(): Promise<void> {
    await this.#coordinator.dispose()
    if (this.#ownsFolderRepresentativeIndex) this.#folderRepresentativeIndex.clear()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose()
  }

  #thumbnailRevision(): number {
    return this.#thumbnailStore?.revision?.() ?? 0
  }

  #libraryCacheEpoch(identity: string): number {
    return this.#libraryCacheEpochs.get(identity) ?? this.#libraryCacheBaseEpoch
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
    if (!page.entryPath) {
      const cached = await this.#trySystemThumbnail({
        sourcePath: page.sourcePath,
        maxEdge: 320,
        quality: 78,
        priority: thumbnailLanePriority(demand.lane),
        ownerId: demand.contextId,
      }, signal)
      if (cached) {
        if (thumbnailStore?.put) {
          void thumbnailStore.put({
            key: persistence.key,
            category: persistence.category,
            bytes: cached.bytes,
            sourceSize: page.byteLength,
            date: sqliteTimestamp(new Date()),
            generationHash: thumbnailGenerationHash(page.contentVersion),
          }).catch(() => undefined)
        }
        return { bytes: cached.bytes, contentType: cached.contentType, version: demandSource.profile, cacheable: true }
      }
    }
    if (page.mediaKind === "video") {
      try {
        const result = await this.#generateVideoThumbnail(page, 320, 78, demand, signal)
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
      const transformer = await this.#getImageTransformer()
      const result = await transformPageSource(source, transformer, {
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
      }, this.#resourceScheduler)
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
    if (descriptor.previewCount !== 1) return this.#resolveLibraryMosaic(demandSource, demand, signal)
    const thumbnailStore = this.#thumbnailStore
    const category = descriptor.kind
    const expectedHash = thumbnailGenerationHash(descriptor.contentVersion)
    if (thumbnailStore && !demandSource.refresh) {
      const stored = await thumbnailStore.get(descriptor.path, category)
      if (isValidLibraryThumbnail(stored, descriptor)) {
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
    const cached = !demandSource.refresh ? await this.#trySystemThumbnail({
      sourcePath: descriptor.path,
      maxEdge: 416,
      quality: 82,
      priority: thumbnailLanePriority(demand.lane),
      ownerId: demand.contextId,
    }, signal) : undefined
    if (cached) {
      if (thumbnailStore?.put) {
        void thumbnailStore.put({
          key: descriptor.path,
          category,
          bytes: cached.bytes,
          sourceSize: descriptor.kind === "file" ? descriptor.sourceSize : undefined,
          date: sqliteTimestamp(new Date()),
          generationHash: expectedHash,
        }).catch(() => undefined)
      }
      return { bytes: cached.bytes, contentType: cached.contentType, version: demandSource.profile, cacheable: true }
    }
    if (!this.#bookLoader || (!this.#loadImageTransformer && !this.#loadVideoThumbnailProvider)) throw new ThumbnailUnavailableError()

    let book: Awaited<ReturnType<ReaderBookLoader>> | undefined
    let source: PageSource | undefined
    try {
      book = await this.#bookLoader({ kind: "path", path: descriptor.path }, { signal })
      const page = book.pages.find((candidate) => candidate.mediaKind === "image" || candidate.mediaKind === "animated-image" || candidate.mediaKind === "video")
      if (!page) throw new ThumbnailUnavailableError()

      const reusable = !demandSource.refresh && page.thumbnailSource && thumbnailStore
        ? await thumbnailStore.get(page.thumbnailSource.key, page.thumbnailSource.category)
        : undefined
      const reusableMatches = reusable?.contentType === "image/webp"
        && (reusable.sourceSize === undefined || page.byteLength === undefined || reusable.sourceSize === page.byteLength)
      let bytes: Uint8Array
      if (reusableMatches) {
        bytes = reusable.bytes
      } else if (page.mediaKind === "video") {
        bytes = (await this.#generateVideoThumbnail(page, 416, 82, demand, signal)).bytes
      } else {
        source = await page.content.load(signal)
        const transformer = await this.#getImageTransformer()
        const result = await transformPageSource(source, transformer, {
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
        }, this.#resourceScheduler)
        if (result.contentType !== "image/webp") {
          await result.stream.cancel("unexpected thumbnail content type").catch(() => undefined)
          throw new Error(`Thumbnail transformer returned ${result.contentType}; expected image/webp.`)
        }
        bytes = await collectThumbnailBytes(result.stream, 2 * 1024 * 1024, signal)
      }

      if (thumbnailStore?.put) {
        const write = thumbnailStore.put({
          key: descriptor.path,
          category,
          bytes,
          sourceSize: descriptor.kind === "file" ? descriptor.sourceSize : page.byteLength,
          date: sqliteTimestamp(new Date()),
          generationHash: expectedHash,
        })
        if (demandSource.refresh) {
          try {
            await write
          } catch (error) {
            throw new ThumbnailPersistenceError(error)
          }
        } else {
          void write.catch(() => undefined)
        }
      }
      return { bytes, contentType: "image/webp", version: demandSource.profile, cacheable: true }
    } catch (error) {
      if (thumbnailStore?.recordFailure && !isAbortError(error)
        && !(error instanceof ThumbnailUnavailableError) && !(error instanceof ThumbnailPersistenceError)) {
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

  async #generateVideoThumbnail(
    page: ReaderPage,
    maxEdge: number,
    quality: number,
    demand: Readonly<ThumbnailDemand<PlatformThumbnailDemandSource>>,
    signal: AbortSignal,
  ) {
    if (!this.#loadVideoThumbnailProvider) throw new ThumbnailUnavailableError()
    const provider = await this.#getVideoThumbnailProvider()
    const options = {
      maxEdge,
      quality,
      priority: thumbnailLanePriority(demand.lane),
      ownerId: demand.contextId,
    }
    if (!page.entryPath) return provider.generate({ sourcePath: page.sourcePath, ...options }, signal)

    let source: PageSource | undefined
    try {
      source = await page.content.load(signal)
      const sourceStream = await source.open(signal)
      return await provider.generate({ sourceStream, ...options }, signal)
    } finally {
      await source?.close().catch(() => undefined)
    }
  }

  async #resolveLibraryMosaic(
    demandSource: LibraryThumbnailDemandSource,
    demand: Readonly<ThumbnailDemand<PlatformThumbnailDemandSource>>,
    signal: AbortSignal,
  ): Promise<ThumbnailAsset> {
    const descriptor = demandSource.source
    if (descriptor.kind !== "folder" || descriptor.previewCount === 1 || !this.#bookLoader || !this.#loadMosaicImageComposer) {
      throw new ThumbnailUnavailableError()
    }
    let book: Awaited<ReturnType<ReaderBookLoader>> | undefined
    const sources: PageSource[] = []
    try {
      book = await this.#bookLoader({ kind: "directory", path: descriptor.path }, { signal })
      const pages = book.pages
        .filter((page) => page.mediaKind === "image" || page.mediaKind === "animated-image")
        .slice(0, descriptor.previewCount)
      if (!pages.length) throw new ThumbnailUnavailableError()
      const inputs: ReadableStream<Uint8Array>[] = []
      for (const page of pages) {
        signal.throwIfAborted()
        const source = await page.content.load(signal)
        sources.push(source)
        inputs.push(await source.open(signal))
      }
      const result = await (await this.#getMosaicImageComposer()).compose(inputs, {
        count: descriptor.previewCount,
        size: 416,
        quality: 82,
      }, signal, {
        priority: thumbnailLanePriority(demand.lane),
        kind: "neoview.thumbnail.folder-mosaic",
        ownerId: demand.contextId,
      })
      return { bytes: result.bytes, contentType: result.contentType, version: demandSource.profile, cacheable: true }
    } finally {
      await Promise.all(sources.map((source) => source.close().catch(() => undefined)))
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

  #getMosaicImageComposer(): Promise<MosaicImageComposer> {
    if (!this.#loadMosaicImageComposer) return Promise.reject(new ThumbnailUnavailableError())
    if (!this.#mosaicImageComposer) {
      const pending = this.#loadMosaicImageComposer()
      const guarded = pending.catch((error) => {
        if (this.#mosaicImageComposer === guarded) this.#mosaicImageComposer = undefined
        throw error
      })
      this.#mosaicImageComposer = guarded
    }
    return this.#mosaicImageComposer
  }

  #getSystemThumbnailProvider(): Promise<SystemThumbnailProvider> {
    if (!this.#loadSystemThumbnailProvider) return Promise.reject(new ThumbnailUnavailableError())
    if (!this.#systemThumbnailProvider) {
      const pending = this.#loadSystemThumbnailProvider()
      const guarded = pending.catch((error) => {
        if (this.#systemThumbnailProvider === guarded) this.#systemThumbnailProvider = undefined
        throw error
      })
      this.#systemThumbnailProvider = guarded
    }
    return this.#systemThumbnailProvider
  }

  async #trySystemThumbnail(
    request: Parameters<SystemThumbnailProvider["getCached"]>[0],
    signal: AbortSignal,
  ): Promise<Awaited<ReturnType<SystemThumbnailProvider["getCached"]>>> {
    if (!this.#loadSystemThumbnailProvider) return undefined
    try {
      return await (await this.#getSystemThumbnailProvider()).getCached(request, signal)
    } catch (error) {
      signal.throwIfAborted()
      return undefined
    }
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

export class ThumbnailPersistenceUnavailableError extends Error {
  constructor() {
    super("Writable thumbnail persistence is unavailable.")
    this.name = "ThumbnailPersistenceUnavailableError"
  }
}

class ThumbnailPersistenceError extends Error {
  constructor(readonly cause: unknown) {
    super(`Thumbnail replacement was not committed: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = "ThumbnailPersistenceError"
  }
}

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

function libraryThumbnailCacheIdentity(source: LibraryThumbnailSource, profile: LibraryThumbnailProfile): string {
  return createHash("sha256")
    .update(source.kind).update("\0")
    .update(source.path).update("\0")
    .update(profile)
    .digest("base64url")
}

function libraryThumbnailCacheKey(
  source: LibraryThumbnailSource,
  profile: LibraryThumbnailProfile,
  revision: number,
  localEpoch: number,
  identity = libraryThumbnailCacheIdentity(source, profile),
): string {
  return `library:${identity}:${source.contentVersion}:db-${revision}:local-${localEpoch}:${profile}`
}

function libraryThumbnailProfile(count: LibraryThumbnailPreviewCount): LibraryThumbnailProfile {
  return count === 1 ? "library-cover-v1" : `library-mosaic-${count}-v1`
}

function isValidLibraryThumbnail(
  record: ReaderThumbnailAsset | undefined,
  source: LibraryThumbnailSource,
): record is ReaderThumbnailAsset & { contentType: string } {
  if (!record?.contentType?.startsWith("image/")) return false
  const versionMatches = record.generationHash === thumbnailGenerationHash(source.contentVersion)
    || timestampAtOrAfter(record.date, source.modifiedAtMs)
  if (!versionMatches) return false
  return source.kind === "folder" || record.sourceSize === undefined || record.sourceSize === source.sourceSize
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

function pageThumbnailCacheKey(page: ReaderPage, profile: "page-strip-v1", revision: number): string {
  const source = page.thumbnailSource
  if (!source) throw new ThumbnailUnavailableError()
  return `${source.category}:${source.key}:${page.contentVersion}:db-${revision}:${profile}`
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
