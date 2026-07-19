import type { ViewSource } from "../../domain/book/book.js"
import type { FrameSnapshot } from "../../domain/frame/frame.js"
import type { PageSource } from "../../domain/page/page-content.js"
import type { ReaderPage } from "../../domain/page/page.js"
import type { ArchivePasswordInput } from "../../ports/ReaderBookLoader.js"
import type { ReaderPreloadPlan } from "../preloading/PreloadCoordinator.js"
import type { ReaderMediaProgressService, ReaderMediaProgressUpdate } from "../reader/ReaderMediaProgressService.js"
import type { ReaderMediaProgressRecord } from "../../ports/ReaderMediaProgressStore.js"
import type { ReaderService, ReaderSession } from "../reader/contracts.js"
import type { ReaderSubtitleService, ReaderSubtitleTrack } from "../reader/ReaderSubtitleService.js"
import type { ReaderBookMetadataService, ReaderBookStaticMetadata } from "../metadata/ReaderBookMetadataService.js"
import type {
  ReaderBookSettingsDefaults,
  ReaderBookSettingsPatch,
  ReaderBookSettingsService,
  ReaderBookSettingsSnapshot,
} from "../reader/ReaderBookSettingsService.js"
import type {
  ReaderAdjacentBookDirection,
  ReaderAdjacentBookService,
} from "../reader/ReaderAdjacentBookService.js"
import type { ReaderDirectorySortRule } from "../browser/ReaderDirectorySort.js"
import type {
  ReaderEmmMetadataPatch,
  ReaderEmmMetadataService,
  ReaderEmmMetadataSnapshot,
} from "../metadata/ReaderEmmMetadataService.js"
import { legacyEmmBookPathKey } from "../metadata/LegacyEmmBookMetadataCodec.js"
import type {
  SuperResolutionPageInput,
  SuperResolutionPageResult,
} from "../super-resolution/SuperResolutionPageService.js"
import type {
  SuperResolutionArtifactDescriptor,
  SuperResolutionArtifactRunDecision,
} from "../../ports/SuperResolutionArtifact.js"
import type {
  SuperResolutionArtifactDestinationContext,
  SuperResolutionPreloadLiveSnapshot,
} from "../../ports/SuperResolutionPreload.js"
import type { SuperResolutionPreloadControlPort } from "../../ports/SuperResolutionPreloadControlPort.js"
import type {
  SuperResolutionCapabilitySnapshot,
  SuperResolutionExecutionContext,
  SuperResolutionModelManifest,
} from "../../ports/SuperResolutionProvider.js"

export interface OpenHeadlessReaderInput {
  path: string
  entryPaths?: readonly string[]
  archivePasswords?: readonly ArchivePasswordInput[]
  initialPage?: number
  signal?: AbortSignal
}

export interface HeadlessReaderBookSnapshot {
  displayName: string
  pageCount: number
  sourceKind?: ReaderBookStaticMetadata["sourceKind"]
  sourceFormat?: ReaderBookStaticMetadata["sourceFormat"]
  translatedTitle?: string
}

export interface HeadlessReaderPageSnapshot {
  id: string
  index: number
  name: string
  mediaKind: ReaderPage["mediaKind"]
  mimeType?: string
  byteLength?: number
  dimensions?: ReaderPage["dimensions"]
  contentVersion: string
  timestamps?: ReaderPage["timestamps"]
}

export interface HeadlessReaderSnapshot {
  book: HeadlessReaderBookSnapshot
  frame: FrameSnapshot
  visiblePages: readonly HeadlessReaderPageSnapshot[]
  preload?: ReaderPreloadPlan
}

export interface HeadlessPageStream extends AsyncDisposable {
  readonly page: HeadlessReaderPageSnapshot
  readonly stream: ReadableStream<Uint8Array>
  readonly byteLength?: number
  readonly contentType?: string
  close(): Promise<void>
}

export interface HeadlessReaderBookSettingsUpdate {
  settings: ReaderBookSettingsSnapshot
  reader: HeadlessReaderSnapshot
}

export interface ReaderHeadlessBookSettingsOptions {
  service: ReaderBookSettingsService
  defaults: ReaderBookSettingsDefaults
}

export type ReaderHeadlessSuperResolutionArtifactFactory = (
  bookPath: string,
  page: ReaderPage,
  context: SuperResolutionArtifactDestinationContext & { decision: SuperResolutionArtifactRunDecision },
) => SuperResolutionArtifactDescriptor | Promise<SuperResolutionArtifactDescriptor>

export interface ReaderHeadlessSuperResolutionPort extends AsyncDisposable, Partial<SuperResolutionPreloadControlPort> {
  run(
    input: SuperResolutionPageInput,
    context?: SuperResolutionExecutionContext,
  ): Promise<SuperResolutionPageResult>
  inspect(options?: { refresh?: boolean; signal?: AbortSignal }): Promise<HeadlessSuperResolutionCapabilitySnapshot>
  artifactFor?: ReaderHeadlessSuperResolutionArtifactFactory
}

export type HeadlessSuperResolutionCapabilitySnapshot =
  | {
      available: false
      reason: string
      models: readonly []
      engines: readonly []
    }
  | {
      available: true
      models: readonly SuperResolutionModelManifest[]
      engines: SuperResolutionCapabilitySnapshot["engines"]
      probedAt: number
    }

export interface HeadlessSuperResolutionPageInput {
  pageIndex: number
  destinationPath: string
  trigger?: SuperResolutionPageInput["trigger"]
  metadata?: Readonly<Record<string, unknown>>
  priority?: SuperResolutionPageInput["priority"]
  maxMaterializationBytes?: number
}

export type HeadlessSuperResolutionPageResult =
  | {
      decision: Exclude<SuperResolutionPageResult["decision"], { kind: "run" }>
      result?: never
    }
  | {
      decision: Extract<SuperResolutionPageResult["decision"], { kind: "run" }>
      result: Omit<NonNullable<SuperResolutionPageResult["result"]>, "sourcePath">
    }

export interface HeadlessReaderEmmMetadataUpdate {
  metadata: ReaderEmmMetadataSnapshot
  reader: HeadlessReaderSnapshot
}

/** Application-level Reader facade shared by CLI and TUI. */
export class ReaderHeadlessController implements AsyncDisposable {
  readonly #service: ReaderService
  readonly #disposeDependencies?: () => Promise<void>
  readonly #mediaProgress?: ReaderMediaProgressService
  #session: ReaderSession | undefined
  #bookMetadata: ReaderBookStaticMetadata | undefined
  #closed = false
  #disposing: Promise<void> | undefined

  constructor(
    service: ReaderService,
    disposeDependencies?: () => Promise<void>,
    mediaProgress?: ReaderMediaProgressService,
    private readonly metadata?: ReaderBookMetadataService,
    private readonly bookSettings?: ReaderHeadlessBookSettingsOptions,
    private readonly adjacentBooks?: ReaderAdjacentBookService,
    private readonly emmMetadata?: ReaderEmmMetadataService,
    private readonly superResolution?: ReaderHeadlessSuperResolutionPort,
    private readonly subtitles?: ReaderSubtitleService,
  ) {
    this.#service = service
    this.#disposeDependencies = disposeDependencies
    this.#mediaProgress = mediaProgress
  }

  get isOpen(): boolean {
    return this.#session !== undefined
  }

  async open(input: OpenHeadlessReaderInput): Promise<HeadlessReaderSnapshot> {
    this.#assertOpen()
    const path = input.path.trim()
    if (!path) throw new Error("Reader path must be a non-empty string.")
    assertInitialPage(input.initialPage)
    assertEntryPaths(input.entryPaths)
    input.signal?.throwIfAborted()

    const source: ViewSource = input.entryPaths?.length
      ? { kind: "archive", path, entryPaths: [...input.entryPaths] }
      : { kind: "path", path }
    const next = await this.#service.openViewSource(source, {
      initialPage: input.initialPage,
      archivePasswords: input.archivePasswords,
      signal: input.signal,
    })
    let adopted = false
    try {
      input.signal?.throwIfAborted()
      this.#assertOpen()
      const previous = this.#session
      const bookMetadata = this.metadata
        ? await this.metadata.load(next.book, input.signal)
        : staticMetadataOf(next)
      this.#session = next
      this.#bookMetadata = bookMetadata
      adopted = true
      if (previous) await this.#mediaProgress?.flush(previous.book.id)
      if (previous) await this.superResolution?.releaseContext?.(preloadContextId(previous.id))
      await previous?.close()
      return snapshotOf(next, bookMetadata)
    } catch (error) {
      if (!adopted) await next.close()
      throw error
    }
  }

  inspect(): HeadlessReaderSnapshot {
    return snapshotOf(this.#requireSession(), this.#bookMetadata)
  }

  listPages(cursor = 0, limit = 100): readonly HeadlessReaderPageSnapshot[] {
    const session = this.#requireSession()
    assertSlice(cursor, limit, session.book.pages.length)
    return session.book.pages.slice(cursor, cursor + limit).map(pageSnapshot)
  }

  async next(signal?: AbortSignal): Promise<HeadlessReaderSnapshot> {
    const session = this.#requireSession()
    await session.next(signal)
    return snapshotOf(session, this.#bookMetadata)
  }

  async previous(signal?: AbortSignal): Promise<HeadlessReaderSnapshot> {
    const session = this.#requireSession()
    await session.previous(signal)
    return snapshotOf(session, this.#bookMetadata)
  }

  async openAdjacent(
    direction: ReaderAdjacentBookDirection,
    sort?: ReaderDirectorySortRule,
    signal?: AbortSignal,
  ): Promise<HeadlessReaderSnapshot | undefined> {
    const current = this.#requireSession()
    if (!this.adjacentBooks) throw new Error("Reader adjacent-book navigation is unavailable.")
    const candidate = await this.adjacentBooks.resolve({
      source: current.book.source,
      direction,
      sort,
      randomSeed: current.id,
    }, signal)
    signal?.throwIfAborted()
    if (!candidate) return undefined
    if (this.#session !== current) throw new Error("Reader session changed while resolving the adjacent book.")
    return this.open({ path: candidate.path, signal })
  }

  async goTo(pageIndex: number, signal?: AbortSignal): Promise<HeadlessReaderSnapshot> {
    assertPageIndex(pageIndex)
    const session = this.#requireSession()
    await session.goTo(pageIndex, signal)
    return snapshotOf(session, this.#bookMetadata)
  }

  async openPageStream(pageIndex: number, signal?: AbortSignal): Promise<HeadlessPageStream> {
    assertPageIndex(pageIndex)
    const session = this.#requireSession()
    const page = session.book.pages[pageIndex]
    if (!page) throw new RangeError(`Reader page index is out of range: ${pageIndex}`)
    signal?.throwIfAborted()
    const source = await page.content.load(signal)
    try {
      const stream = await source.open(signal)
      return new OwnedHeadlessPageStream(pageSnapshot(page), source, stream)
    } catch (error) {
      await source.close().catch(() => undefined)
      throw error
    }
  }

  listSubtitles(pageIndex: number): readonly ReaderSubtitleTrack[] {
    const { session, page } = this.#requireSubtitlePage(pageIndex)
    return this.subtitles!.list(session.id, page.id)
  }

  async renderSubtitle(
    pageIndex: number,
    assetId: string,
    signal?: AbortSignal,
  ): Promise<{ bytes: Uint8Array; contentVersion: string }> {
    const { session, page } = this.#requireSubtitlePage(pageIndex)
    signal?.throwIfAborted()
    return this.subtitles!.render(session.id, page.id, assetId, signal)
  }

  async upscalePage(
    input: HeadlessSuperResolutionPageInput,
    context: SuperResolutionExecutionContext = {},
  ): Promise<HeadlessSuperResolutionPageResult> {
    assertPageIndex(input.pageIndex)
    const session = this.#requireSession()
    const page = session.book.pages[input.pageIndex]
    if (!page) throw new RangeError(`Reader page index is out of range: ${input.pageIndex}`)
    if (!this.superResolution) throw new Error("Reader super-resolution is unavailable.")
    const output = await this.superResolution.run({
      page,
      destinationPath: input.destinationPath,
      trigger: input.trigger ?? "manual",
      bookPath: session.book.source.path,
      metadata: input.metadata,
      priority: input.priority,
      maxMaterializationBytes: input.maxMaterializationBytes,
    }, context)
    if (!output.result) return output
    const { sourcePath: _sourcePath, ...result } = output.result
    return { decision: output.decision, result }
  }

  inspectSuperResolution(
    options: { refresh?: boolean; signal?: AbortSignal } = {},
  ): Promise<HeadlessSuperResolutionCapabilitySnapshot> {
    this.#assertOpen()
    if (!this.superResolution) {
      return Promise.resolve({ available: false, reason: "super-resolution-disabled", models: [], engines: [] })
    }
    return this.superResolution.inspect(options)
  }

  getUpscalePreload(signal?: AbortSignal): Promise<readonly SuperResolutionPreloadLiveSnapshot[]> {
    const session = this.#requireSession()
    return this.#requirePreload().snapshots(preloadContextId(session.id), signal)
  }

  async startUpscalePreload(
    mode: "nearby" | "progressive" = "nearby",
    signal?: AbortSignal,
  ): Promise<readonly SuperResolutionPreloadLiveSnapshot[]> {
    const session = this.#requireSession()
    const preload = this.#requirePreload()
    const plan = session.preloadPlan()
    const contextId = preloadContextId(session.id)
    const artifactFor = this.#artifactFactory(session)
    if (mode === "nearby") {
      if (!plan) throw new Error("Reader preload plan is unavailable.")
      return preload.startPlan({
        contextId,
        plan,
        pages: session.book.pages,
        bookPath: session.book.source.path,
        artifactFor,
      }, signal)
    }
    return preload.startProgressive({
      contextId,
      generation: plan?.generation ?? Number(session.generation),
      currentPageIndex: session.snapshot().anchorPageIndex,
      pages: session.book.pages,
      bookPath: session.book.source.path,
      artifactFor,
    }, signal)
  }

  pauseUpscalePreload(signal?: AbortSignal): Promise<readonly SuperResolutionPreloadLiveSnapshot[]> {
    const session = this.#requireSession()
    return this.#requirePreload().pause(preloadContextId(session.id), signal)
  }

  retryUpscalePreload(
    mode: "nearby" | "progressive" = "nearby",
    signal?: AbortSignal,
  ): Promise<readonly SuperResolutionPreloadLiveSnapshot[]> {
    const session = this.#requireSession()
    return this.#requirePreload().retry(preloadContextId(session.id), mode, signal)
  }

  async getMediaProgress(): Promise<ReaderMediaProgressRecord | undefined> {
    const session = this.#requireVideoSession()
    if (!this.#mediaProgress) return undefined
    return this.#mediaProgress.get(session.book.id)
  }

  async updateMediaProgress(
    update: ReaderMediaProgressUpdate,
    options: { flush?: boolean } = {},
  ): Promise<ReaderMediaProgressRecord> {
    const session = this.#requireVideoSession()
    if (!this.#mediaProgress) throw new Error("Reader media progress is unavailable.")
    const progress = this.#mediaProgress.record(session.book.id, update)
    if (options.flush) await this.#mediaProgress.flush(session.book.id)
    return progress
  }

  async getBookSettings(signal?: AbortSignal): Promise<ReaderBookSettingsSnapshot> {
    const session = this.#requireSession()
    if (!this.bookSettings) throw new Error("Reader book settings are unavailable.")
    return this.bookSettings.service.read(session.book.id, this.bookSettings.defaults, signal)
  }

  async updateBookSettings(
    expectedRevision: number,
    patch: ReaderBookSettingsPatch,
    signal?: AbortSignal,
  ): Promise<HeadlessReaderBookSettingsUpdate> {
    const session = this.#requireSession()
    if (!this.bookSettings) throw new Error("Reader book settings are unavailable.")
    const settings = await this.bookSettings.service.update(
      session.book.id,
      expectedRevision,
      patch,
      this.bookSettings.defaults,
      async (effective, updateSignal) => {
        const current = session.snapshot()
        await session.updateOptions({
          direction: effective.direction,
          layout: {
            ...current.layout,
            pageMode: effective.pageMode,
            treatWidePageAsSingle: effective.horizontalBook,
          },
        }, updateSignal)
      },
      signal,
    )
    return { settings, reader: snapshotOf(session, this.#bookMetadata) }
  }

  getEmmMetadata(signal?: AbortSignal): Promise<ReaderEmmMetadataSnapshot> {
    const session = this.#requireSession()
    if (!this.emmMetadata) throw new Error("Reader EMM metadata is unavailable.")
    return this.emmMetadata.read(legacyEmmBookPathKey(session.book.source.path), signal)
  }

  async updateEmmMetadata(
    expectedRevision: number,
    patch: ReaderEmmMetadataPatch,
    signal?: AbortSignal,
  ): Promise<HeadlessReaderEmmMetadataUpdate> {
    const session = this.#requireSession()
    if (!this.emmMetadata) throw new Error("Reader EMM metadata is unavailable.")
    const metadata = await this.emmMetadata.update(
      legacyEmmBookPathKey(session.book.source.path),
      expectedRevision,
      patch,
      signal,
    )
    if (this.metadata) this.#bookMetadata = await this.metadata.load(session.book, signal)
    return { metadata, reader: snapshotOf(session, this.#bookMetadata) }
  }

  async closeBook(): Promise<void> {
    const session = this.#session
    this.#session = undefined
    this.#bookMetadata = undefined
    if (session) await this.#mediaProgress?.flush(session.book.id)
    if (session) await this.superResolution?.releaseContext?.(preloadContextId(session.id))
    await session?.close()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.#disposing) return this.#disposing
    this.#closed = true
    this.#disposing = Promise.resolve().then(async () => {
      const session = this.#session
      this.#session = undefined
      this.#bookMetadata = undefined
      const errors: unknown[] = []
      if (session) {
        try {
          await this.superResolution?.releaseContext?.(preloadContextId(session.id))
        } catch (error) {
          errors.push(error)
        }
      }
      for (const dispose of [
        this.#mediaProgress ? () => this.#mediaProgress!.close() : undefined,
        session ? () => session.close() : undefined,
        () => this.#service[Symbol.asyncDispose](),
        this.superResolution ? () => this.superResolution![Symbol.asyncDispose]() : undefined,
        this.#disposeDependencies,
      ]) {
        if (!dispose) continue
        try {
          await dispose()
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length) throw new AggregateError(errors, "Failed to close the headless reader.")
    })
    return this.#disposing
  }

  #requireSession(): ReaderSession {
    this.#assertOpen()
    if (!this.#session) throw new Error("No reader book is open.")
    return this.#session
  }

  #requirePreload(): ReaderHeadlessSuperResolutionPort & SuperResolutionPreloadControlPort {
    const port = this.superResolution
    if (!port?.startPlan || !port.startProgressive || !port.snapshots || !port.pause || !port.retry) {
      throw new Error("Reader super-resolution preload is unavailable.")
    }
    return port as ReaderHeadlessSuperResolutionPort & SuperResolutionPreloadControlPort
  }

  #artifactFactory(session: ReaderSession) {
    if (!this.superResolution?.artifactFor) {
      throw new Error("Reader super-resolution artifact cache is unavailable.")
    }
    return (page: ReaderPage, context: SuperResolutionArtifactDestinationContext & { decision: SuperResolutionArtifactRunDecision }) =>
      this.superResolution!.artifactFor!(session.book.source.path, page, context)
  }

  #requireVideoSession(): ReaderSession {
    const session = this.#requireSession()
    if (!session.book.pages.some((page) => page.mediaKind === "video")) {
      throw new Error("The open Reader book does not contain video media.")
    }
    return session
  }

  #requireSubtitlePage(pageIndex: number): { session: ReaderSession; page: ReaderPage } {
    assertPageIndex(pageIndex)
    const session = this.#requireSession()
    const page = session.book.pages[pageIndex]
    if (!page) throw new RangeError(`Reader page index is out of range: ${pageIndex}`)
    if (page.mediaKind !== "video") throw new Error("Reader video page was not found.")
    if (!this.subtitles) throw new Error("Reader subtitles are unavailable.")
    return { session, page }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Headless reader is closed.")
  }
}

class OwnedHeadlessPageStream implements HeadlessPageStream {
  readonly page: HeadlessReaderPageSnapshot
  readonly stream: ReadableStream<Uint8Array>
  readonly byteLength?: number
  readonly contentType?: string
  readonly #source: PageSource
  #closing: Promise<void> | undefined

  constructor(page: HeadlessReaderPageSnapshot, source: PageSource, stream: ReadableStream<Uint8Array>) {
    this.page = page
    this.#source = source
    this.stream = stream
    this.byteLength = source.byteLength
    this.contentType = source.contentType
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing
    this.#closing = Promise.resolve().then(async () => {
      await this.stream.cancel("headless page stream closed").catch(() => undefined)
      await this.#source.close()
    })
    return this.#closing
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }
}

function snapshotOf(session: ReaderSession, metadata = staticMetadataOf(session)): HeadlessReaderSnapshot {
  const frame = session.snapshot()
  return {
    book: {
      displayName: session.book.displayName,
      pageCount: session.book.pages.length,
      sourceKind: metadata.sourceKind,
      sourceFormat: metadata.sourceFormat,
      translatedTitle: metadata.emm?.translatedTitle,
    },
    frame,
    preload: session.preloadPlan(),
    visiblePages: frame.pages.flatMap(({ pageId }) => {
      const page = session.getPage(pageId)
      return page ? [pageSnapshot(page)] : []
    }),
  }
}

function staticMetadataOf(session: ReaderSession): ReaderBookStaticMetadata {
  return {
    bookId: session.book.id,
    displayName: session.book.displayName,
    sourcePath: session.book.source.path,
    sourceKind: session.book.source.kind,
    sourceFormat: session.book.source.kind === "document" ? session.book.source.format : undefined,
    pageCount: session.book.pages.length,
  }
}

function pageSnapshot(page: ReaderPage): HeadlessReaderPageSnapshot {
  return {
    id: page.id,
    index: page.index,
    name: page.name,
    mediaKind: page.mediaKind,
    mimeType: page.mimeType,
    byteLength: page.byteLength,
    dimensions: page.dimensions ? { ...page.dimensions } : undefined,
    contentVersion: page.contentVersion,
    timestamps: page.timestamps ? { ...page.timestamps } : undefined,
  }
}

function assertEntryPaths(entryPaths: readonly string[] | undefined): void {
  if (entryPaths === undefined) return
  if (!entryPaths.length || entryPaths.length > 16 || entryPaths.some((entry) => !entry.trim())) {
    throw new Error("Archive entry paths must contain between 1 and 16 non-empty paths.")
  }
}

function assertInitialPage(value: number | undefined): void {
  if (value !== undefined) assertPageIndex(value)
}

function assertPageIndex(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid reader page index: ${value}`)
}

function assertSlice(cursor: number, limit: number, pageCount: number): void {
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > pageCount) {
    throw new RangeError(`Invalid reader page cursor: ${cursor}`)
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError(`Invalid reader page limit: ${limit}`)
  }
}

function preloadContextId(sessionId: string): string {
  return `reader:${sessionId}:super-resolution`
}
