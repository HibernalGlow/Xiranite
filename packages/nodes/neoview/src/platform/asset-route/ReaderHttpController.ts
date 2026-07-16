import type { Stats } from "node:fs"
import { stat } from "node:fs/promises"

import { DEFAULT_READER_LAYOUT, type FrameSnapshot } from "../../domain/frame/frame.js"
import type { ViewSource } from "../../domain/book/book.js"
import type { ReaderPage } from "../../domain/page/page.js"
import { CoreReaderService } from "../../application/reader/ReaderService.js"
import { ReaderCacheService } from "../../application/cache/ReaderCacheService.js"
import type { ReaderSession, ReaderSessionOptions } from "../../application/reader/contracts.js"
import type { ArchivePasswordInput } from "../../ports/ReaderBookLoader.js"
import type { ReaderThumbnailStore } from "../../ports/ReaderThumbnailStore.js"
import type { ReaderProgressStore } from "../../ports/ReaderProgressStore.js"
import type { ReaderMediaProgressStore } from "../../ports/ReaderMediaProgressStore.js"
import type { ReaderSearchHistoryStore } from "../../ports/ReaderSearchHistoryStore.js"
import type { ReaderFileUndoJournalStore } from "../../ports/ReaderFileUndoJournalStore.js"
import { ReaderSearchHistoryService } from "../../application/browser/ReaderSearchHistoryService.js"
import { ReaderMediaProgressService, type ReaderMediaProgressUpdate } from "../../application/reader/ReaderMediaProgressService.js"
import { ReaderClipboardMaterializationService } from "../../application/reader/ReaderClipboardMaterializationService.js"
import { ReaderDiagnosticsService, type ReaderSchedulerPoolDiagnostics } from "../../application/diagnostics/ReaderDiagnosticsService.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import type { ReaderPresentationDiskCache } from "../../ports/ReaderPresentationDiskCache.js"
import type { ReaderLibraryService } from "../../application/library/ReaderLibraryService.js"
import type { ReaderDirectorySortPreferenceStore } from "../../application/browser/ReaderDirectorySortPreferences.js"
import type { ReaderDirectoryEmmRecordStore } from "../../ports/ReaderDirectoryEmmRecordStore.js"
import type { ReaderPreloadPlan } from "../../application/preloading/PreloadCoordinator.js"
import type { ReaderPreloadOutcome } from "../../application/preloading/PreloadTelemetry.js"
import type { SystemThumbnailProviderLoader } from "../../ports/SystemThumbnailProvider.js"
import type { VideoThumbnailProviderLoader } from "../../ports/VideoThumbnailProvider.js"
import { createPlatformReaderBookLoader } from "../books/PlatformReaderBookLoader.js"
import type { PlatformReaderBookLoaderOptions } from "../books/PlatformReaderBookLoader.js"
import { StreamingImageMetadataProbe } from "../images/StreamingImageMetadataProbe.js"
import { PlatformDirectoryMediaMetadataProvider } from "../filesystem/PlatformDirectoryMediaMetadataProvider.js"
import { WeightedLruPresentationCache } from "../cache/WeightedLruPresentationCache.js"
import { SolidArchiveCache } from "../archives/sevenzip/SolidArchiveCache.js"
import { ReaderAssetRoute, type ReaderAssetRouteOptions } from "./ReaderAssetRoute.js"
import { LibraryThumbnailRoute } from "./LibraryThumbnailRoute.js"
import { PlatformThumbnailPipeline } from "../thumbnails/PlatformThumbnailPipeline.js"
import { ThumbnailMaintenanceRoute } from "./ThumbnailMaintenanceRoute.js"
import { ReaderDirectoryBrowserRoute } from "./ReaderDirectoryBrowserRoute.js"
import { ReaderLibraryHttpController } from "./ReaderLibraryHttpController.js"
import { ReaderFileOperationHttpController } from "./ReaderFileOperationHttpController.js"
import { ReaderSystemIntegrationHttpController } from "./ReaderSystemIntegrationHttpController.js"
import { ReaderLibraryCleanupService } from "../../application/library/ReaderLibraryCleanupService.js"
import { PlatformReaderPathStatusProvider } from "../filesystem/PlatformReaderPathStatusProvider.js"
import { PlatformReaderPageMaterializer } from "../content/PlatformReaderPageMaterializer.js"
import { WINDOWS_PRESENTATION_PRODUCER_VERSION } from "../cache/PresentationCacheKey.js"
import { ReaderMemoryPressureMonitor } from "../memory/ReaderMemoryPressureMonitor.js"
import {
  parseNeoviewFolderViewPatch,
  DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG,
  DEFAULT_NEOVIEW_SHELL_CONFIG,
  DEFAULT_NEOVIEW_SLIDESHOW_CONFIG,
  DEFAULT_NEOVIEW_VIEW_DEFAULTS,
  parseNeoviewBoardLayoutPatch,
  parseNeoviewCardLayoutPatch,
  parseNeoviewSidebarLayoutPatch,
  parseNeoviewSlideshowPatch,
  parseNeoviewViewDefaultsPatch,
  type NeoviewSlideshowConfig,
  type NeoviewSlideshowPatch,
  type NeoviewShellConfig,
  type NeoviewShellConfigPatch,
  type NeoviewViewDefaults,
  type NeoviewViewDefaultsPatch,
  type NeoviewFolderViewConfig,
  type NeoviewFolderViewPatch,
  type NeoviewFileTreeConfig,
} from "../../application/config/ReaderRuntimeConfig.js"

const SESSION_PATH = /^\/reader\/s\/([^/]+)$/
const SESSION_PAGES_PATH = /^\/reader\/s\/([^/]+)\/pages$/
const SESSION_NAVIGATE_PATH = /^\/reader\/s\/([^/]+)\/navigate$/
const SESSION_PRELOAD_EVENTS_PATH = /^\/reader\/s\/([^/]+)\/preload-events$/
const SESSION_OPTIONS_PATH = /^\/reader\/s\/([^/]+)\/options$/
const SESSION_METADATA_PATH = /^\/reader\/s\/([^/]+)\/metadata$/
const SESSION_MEDIA_PROGRESS_PATH = /^\/reader\/s\/([^/]+)\/media-progress$/
const SESSION_CLIPBOARD_MATERIALIZATION_PATH = /^\/reader\/s\/([^/]+)\/clipboard-materializations(?:\/([^/]+))?$/
const PRESENTATION_CACHE_PATH = "/reader/cache/presentation"
const PRESENTATION_CACHE_CLEANUP_PATH = "/reader/cache/presentation/cleanup"
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
  preload?: ReaderPreloadPlan
}

export type ReaderHttpControllerOptions = ReaderAssetRouteOptions & PlatformReaderBookLoaderOptions & {
  memoryPressureMonitor?: ReaderMemoryPressureMonitor
  sessionOptions?: Partial<ReaderSessionOptions>
  thumbnailStore?: ReaderThumbnailStore
  loadSystemThumbnailProvider?: SystemThumbnailProviderLoader
  loadVideoThumbnailProvider?: VideoThumbnailProviderLoader
  disposeThumbnailStore?: () => void | Promise<void>
  progressStore?: ReaderProgressStore | false
  mediaProgressStore?: ReaderMediaProgressStore
  libraryService?: ReaderLibraryService
  directorySortPreferenceStore?: ReaderDirectorySortPreferenceStore
  directoryEmmRecordStore?: ReaderDirectoryEmmRecordStore
  searchHistoryStore?: ReaderSearchHistoryStore
  fileUndoJournalStore?: ReaderFileUndoJournalStore
  disposeLibraryService?: boolean
  presentationDiskCache?: ReaderPresentationDiskCache
  disposePresentationDiskCache?: boolean
  shellOptions?: NeoviewShellConfig
  updateShellOptions?: (patch: NeoviewShellConfigPatch, tomlPatch: Record<string, unknown>) => Promise<NeoviewShellConfig>
  viewDefaults?: NeoviewViewDefaults
  updateViewDefaults?: (patch: NeoviewViewDefaultsPatch, tomlPatch: Record<string, unknown>) => Promise<NeoviewViewDefaults>
  folderView?: NeoviewFolderViewConfig
  updateFolderView?: (patch: NeoviewFolderViewPatch, tomlPatch: Record<string, unknown>) => Promise<NeoviewFolderViewConfig>
  fileTree?: NeoviewFileTreeConfig
  updateFileTreeExclusions?: (paths: readonly string[]) => Promise<readonly string[]>
  slideshow?: NeoviewSlideshowConfig
  updateSlideshow?: (patch: NeoviewSlideshowPatch, tomlPatch: Record<string, unknown>) => Promise<NeoviewSlideshowConfig>
}

export class ReaderHttpController implements AsyncDisposable {
  readonly #service: CoreReaderService
  readonly #assets: ReaderAssetRoute
  readonly #libraryThumbnails: LibraryThumbnailRoute
  readonly #thumbnailPipeline: PlatformThumbnailPipeline
  readonly #thumbnailMaintenance: ThumbnailMaintenanceRoute
  readonly #directoryBrowser: ReaderDirectoryBrowserRoute
  readonly #fileOperations: ReaderFileOperationHttpController
  readonly #systemIntegration: ReaderSystemIntegrationHttpController
  readonly #library?: ReaderLibraryHttpController
  readonly #libraryService?: ReaderLibraryService
  readonly #disposeLibraryService: boolean
  readonly #cacheService: ReaderCacheService
  readonly #mediaProgress?: ReaderMediaProgressService
  readonly #clipboardMaterializations: ReaderClipboardMaterializationService
  readonly #diagnostics: ReaderDiagnosticsService
  readonly #token: string
  readonly #solidArchiveCache: SolidArchiveCache
  readonly #ownsSolidArchiveCache: boolean
  readonly #disposeThumbnailStore?: () => void | Promise<void>
  #shellOptions: NeoviewShellConfig
  #shellRevision = 0
  #viewDefaults: NeoviewViewDefaults
  #folderView: NeoviewFolderViewConfig
  #slideshow: NeoviewSlideshowConfig
  #sessionOptions: Partial<ReaderSessionOptions>
  readonly #updateShellOptions?: ReaderHttpControllerOptions["updateShellOptions"]
  readonly #updateViewDefaults?: ReaderHttpControllerOptions["updateViewDefaults"]
  readonly #updateFolderView?: ReaderHttpControllerOptions["updateFolderView"]
  readonly #updateSlideshow?: ReaderHttpControllerOptions["updateSlideshow"]
  #configUpdateQueue: Promise<void> = Promise.resolve()
  #hibernateCheck?: Promise<void>

  constructor(options: ReaderHttpControllerOptions) {
    this.#ownsSolidArchiveCache = !options.solidArchiveCache
    this.#solidArchiveCache = options.solidArchiveCache ?? new SolidArchiveCache({
      maxBytes: options.maxSolidArchiveCacheBytes,
    })
    const bookLoader = createPlatformReaderBookLoader({ ...options, solidArchiveCache: this.#solidArchiveCache })
    const imageMetadataProbe = new StreamingImageMetadataProbe()
    const loadImageTransformer = async () => {
      const { SharpImageTransformer } = await import("../images/sharp/SharpImageTransformer.js")
      const sharp = new SharpImageTransformer(options.resourceScheduler)
      if (process.platform !== "win32") return sharp
      const { WindowsWicImageTransformer } = await import("../images/WindowsWicImageTransformer.js")
      return new WindowsWicImageTransformer(sharp, { resourceScheduler: options.resourceScheduler })
    }
    const loadVideoThumbnailProvider = options.loadVideoThumbnailProvider ?? (async () => {
      const { FfmpegVideoThumbnailProvider } = await import("../video/FfmpegVideoThumbnailProvider.js")
      return new FfmpegVideoThumbnailProvider({ resourceScheduler: options.resourceScheduler })
    })
    const loadMosaicImageComposer = async () => {
      const { SharpMosaicImageComposer } = await import("../images/sharp/SharpMosaicImageComposer.js")
      return new SharpMosaicImageComposer(options.resourceScheduler)
    }
    const loadSystemThumbnailProvider = options.loadSystemThumbnailProvider ?? (process.platform === "win32"
      ? async () => {
          const { WindowsSystemThumbnailProvider } = await import("../windows/WindowsSystemThumbnailProvider.js")
          return new WindowsSystemThumbnailProvider({ resourceScheduler: options.resourceScheduler })
        }
      : undefined)
    this.#thumbnailPipeline = new PlatformThumbnailPipeline({
      bookLoader,
      loadImageTransformer,
      loadSystemThumbnailProvider,
      loadVideoThumbnailProvider,
      loadMosaicImageComposer,
      thumbnailStore: options.thumbnailStore,
      maxMemoryBytes: 32 * 1024 * 1024,
      maxEntryBytes: 512 * 1024,
      resourceScheduler: options.resourceScheduler,
    })
    this.#service = new CoreReaderService(
      bookLoader,
      imageMetadataProbe,
      options.sessionOptions,
      options.progressStore || undefined,
    )
    this.#clipboardMaterializations = new ReaderClipboardMaterializationService(
      this.#service,
      new PlatformReaderPageMaterializer({
        tempDirectory: options.archiveTempDirectory,
        resourceScheduler: options.resourceScheduler,
      }),
    )
    const memoryPressureMonitor = options.memoryPressureMonitor ?? new ReaderMemoryPressureMonitor()
    this.#assets = new ReaderAssetRoute(this.#service, options, {
      presentationCache: new WeightedLruPresentationCache(),
      presentationDiskCache: options.presentationDiskCache,
      presentationProducerVersion: process.platform === "win32" ? WINDOWS_PRESENTATION_PRODUCER_VERSION : undefined,
      loadImageTransformer,
      thumbnailPipeline: this.#thumbnailPipeline,
      memoryPressureMonitor,
      relieveHostMemoryPressure: async (level) => {
        const snapshot = this.#solidArchiveCache.snapshot()
        await this.#solidArchiveCache.trimTo(level === "critical" ? 0 : Math.floor(snapshot.maxBytes * 0.25))
        this.#directoryBrowser.releaseMemoryPressure()
      },
    })
    this.#libraryThumbnails = new LibraryThumbnailRoute(this.#thumbnailPipeline, options)
    this.#thumbnailMaintenance = new ThumbnailMaintenanceRoute({ token: options.token, thumbnailStore: options.thumbnailStore })
    this.#directoryBrowser = new ReaderDirectoryBrowserRoute(
      options.directorySortPreferenceStore,
      options.directoryEmmRecordStore,
      new PlatformDirectoryMediaMetadataProvider(bookLoader, imageMetadataProbe),
      {
        excludedPaths: options.fileTree?.excludedPaths,
        updateExcludedPaths: options.updateFileTreeExclusions,
      },
      options.resourceScheduler,
      options.searchHistoryStore ? new ReaderSearchHistoryService(options.searchHistoryStore) : undefined,
    )
    this.#fileOperations = new ReaderFileOperationHttpController(async () => {
      const { ReaderFileOperationService } = await import("../../application/files/ReaderFileOperationService.js")
      const { PlatformReaderFileMutationProvider } = await import("../filesystem/PlatformReaderFileMutationProvider.js")
      return new ReaderFileOperationService(new PlatformReaderFileMutationProvider({ scheduler: options.resourceScheduler }), {
        journal: options.fileUndoJournalStore,
      })
    })
    this.#systemIntegration = new ReaderSystemIntegrationHttpController(async () => {
      const { ReaderSystemIntegrationService } = await import("../../application/files/ReaderSystemIntegrationService.js")
      const { PlatformReaderSystemIntegrationProvider } = await import("../filesystem/PlatformReaderSystemIntegrationProvider.js")
      return new ReaderSystemIntegrationService(new PlatformReaderSystemIntegrationProvider({ scheduler: options.resourceScheduler }))
    })
    this.#libraryService = options.libraryService
    this.#library = options.libraryService ? new ReaderLibraryHttpController(
      options.libraryService,
      new ReaderLibraryCleanupService(options.libraryService, new PlatformReaderPathStatusProvider(options.resourceScheduler)),
    ) : undefined
    this.#disposeLibraryService = options.disposeLibraryService ?? false
    this.#cacheService = new ReaderCacheService(options.presentationDiskCache, {
      ownsPresentationCache: options.disposePresentationDiskCache,
    })
    this.#diagnostics = new ReaderDiagnosticsService({
      activeSessions: () => this.#service.sessionCount,
      preload: () => this.#service.preloadDiagnostics(),
      assets: () => this.#assets.snapshot(),
      presentationDiskCache: () => this.#cacheService.status(),
      solidArchiveCache: () => this.#solidArchiveCache.snapshot(),
      scheduler: schedulerSnapshot(options.resourceScheduler),
    })
    this.#mediaProgress = options.mediaProgressStore
      ? new ReaderMediaProgressService(options.mediaProgressStore)
      : undefined
    this.#disposeThumbnailStore = options.disposeThumbnailStore
    this.#token = options.token
    this.#shellOptions = options.shellOptions ?? DEFAULT_NEOVIEW_SHELL_CONFIG
    this.#viewDefaults = options.viewDefaults ?? DEFAULT_NEOVIEW_VIEW_DEFAULTS
    this.#folderView = options.folderView ?? DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG
    this.#slideshow = options.slideshow ?? DEFAULT_NEOVIEW_SLIDESHOW_CONFIG
    this.#sessionOptions = options.sessionOptions ?? {}
    this.#updateShellOptions = options.updateShellOptions
    this.#updateViewDefaults = options.updateViewDefaults
    this.#updateFolderView = options.updateFolderView
    this.#updateSlideshow = options.updateSlideshow
  }

  async handle(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith("/reader/")) return undefined
    if (!this.#isAuthorized(request, url)) return jsonResponse({ error: "Unauthorized" }, 401)

    const assetResponse = await this.#assets.handle(request)
    if (assetResponse) return assetResponse
    const libraryThumbnailResponse = await this.#libraryThumbnails.handle(request)
    if (libraryThumbnailResponse) return libraryThumbnailResponse
    const thumbnailMaintenanceResponse = await this.#thumbnailMaintenance.handle(request)
    if (thumbnailMaintenanceResponse) return thumbnailMaintenanceResponse
    const directoryBrowserResponse = await this.#directoryBrowser.handle(request)
    if (directoryBrowserResponse) return directoryBrowserResponse
    const fileOperationResponse = await this.#fileOperations.handle(request)
    if (fileOperationResponse) return fileOperationResponse
    const systemIntegrationResponse = await this.#systemIntegration.handle(request)
    if (systemIntegrationResponse) return systemIntegrationResponse
    const libraryResponse = await this.#library?.handle(request)
    if (libraryResponse) return libraryResponse

    if (url.pathname === PRESENTATION_CACHE_PATH && request.method === "GET") {
      return jsonResponse(await this.#cacheService.status())
    }
    if (url.pathname === "/reader/diagnostics" && request.method === "GET") {
      return jsonResponse(await this.#diagnostics.snapshot())
    }
    if (url.pathname === PRESENTATION_CACHE_PATH && request.method === "DELETE") {
      return jsonResponse(await this.#cacheService.clear())
    }
    if (url.pathname === PRESENTATION_CACHE_CLEANUP_PATH && request.method === "POST") {
      const body = await readControlJson(request)
      const reason = body?.reason ?? "age"
      if (reason !== "age" && reason !== "budget" && reason !== "explicit") {
        return jsonResponse({ error: "reason must be age, budget or explicit" }, 400)
      }
      return jsonResponse(await this.#cacheService.cleanup(reason))
    }

    if (url.pathname === "/reader/sessions" && request.method === "POST") {
      return this.#openSession(request)
    }
    if (url.pathname === "/reader/config" && request.method === "GET") {
      return jsonResponse(this.#configDto())
    }
    if (url.pathname === "/reader/config" && request.method === "PATCH") {
      return this.#patchShellConfig(request)
    }

    const pagesMatch = SESSION_PAGES_PATH.exec(url.pathname)
    if (pagesMatch && request.method === "GET") return this.#listPages(pagesMatch[1]!, url, request.signal)
    const metadataMatch = SESSION_METADATA_PATH.exec(url.pathname)
    if (metadataMatch && request.method === "GET") return this.#metadata(metadataMatch[1]!, request.signal)
    const mediaProgressMatch = SESSION_MEDIA_PROGRESS_PATH.exec(url.pathname)
    if (mediaProgressMatch && (request.method === "GET" || request.method === "PATCH")) {
      return this.#handleMediaProgress(mediaProgressMatch[1]!, request)
    }
    const clipboardMaterializationMatch = SESSION_CLIPBOARD_MATERIALIZATION_PATH.exec(url.pathname)
    if (clipboardMaterializationMatch && request.method === "POST" && !clipboardMaterializationMatch[2]) {
      return this.#materializeClipboardPage(clipboardMaterializationMatch[1]!, request)
    }
    if (clipboardMaterializationMatch && request.method === "DELETE" && clipboardMaterializationMatch[2]) {
      return this.#releaseClipboardMaterialization(clipboardMaterializationMatch[1]!, clipboardMaterializationMatch[2]!)
    }
    const navigateMatch = SESSION_NAVIGATE_PATH.exec(url.pathname)
    if (navigateMatch && request.method === "POST") return this.#navigate(navigateMatch[1]!, request)
    const preloadEventsMatch = SESSION_PRELOAD_EVENTS_PATH.exec(url.pathname)
    if (preloadEventsMatch && request.method === "POST") return this.#reportPreloadEvents(preloadEventsMatch[1]!, request)
    const optionsMatch = SESSION_OPTIONS_PATH.exec(url.pathname)
    if (optionsMatch && request.method === "PATCH") return this.#updateSessionOptions(optionsMatch[1]!, request)
    const sessionMatch = SESSION_PATH.exec(url.pathname)
    if (sessionMatch && request.method === "GET") return this.#getSession(sessionMatch[1]!)
    if (sessionMatch && request.method === "DELETE") return this.#closeSession(sessionMatch[1]!)
    return jsonResponse({ error: "Reader route not found" }, 404)
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.#assets.close()
    this.#libraryThumbnails.close()
    const errors: unknown[] = []
    try {
      await this.#directoryBrowser[Symbol.asyncDispose]()
    } catch (error) {
      errors.push(error)
    }
    try {
      await this.#thumbnailPipeline.dispose()
    } catch (error) {
      errors.push(error)
    }
    try {
      await this.#mediaProgress?.close()
    } catch (error) {
      errors.push(error)
    }
    try {
      await this.#clipboardMaterializations[Symbol.asyncDispose]()
    } catch (error) {
      errors.push(error)
    }
    try {
      await this.#service[Symbol.asyncDispose]()
    } catch (error) {
      errors.push(error)
    }
    if (this.#disposeLibraryService && this.#libraryService) {
      try {
        await this.#libraryService.close()
      } catch (error) {
        errors.push(error)
      }
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
    try {
      await this.#diagnostics.close()
    } catch (error) {
      errors.push(error)
    }
    try {
      await this.#cacheService.close()
    } catch (error) {
      errors.push(error)
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

  async #patchShellConfig(request: Request): Promise<Response> {
    const body = await readControlJson(request)
    if (!body) return jsonResponse({ error: "Reader config patch must be a JSON object" }, 400)
    if (Object.hasOwn(body, "slideshow")) {
      if (!this.#updateSlideshow) return jsonResponse({ error: "Reader slideshow config is read-only" }, 405)
      let parsed: ReturnType<typeof parseNeoviewSlideshowPatch>
      try {
        parsed = parseNeoviewSlideshowPatch(body)
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 400)
      }
      let updated: NeoviewSlideshowConfig | undefined
      const operation = this.#configUpdateQueue.then(async () => {
        updated = await this.#updateSlideshow!(parsed.patch, parsed.tomlPatch)
        this.#slideshow = updated
      })
      this.#configUpdateQueue = operation.catch(() => undefined)
      try {
        await operation
        return jsonResponse(this.#configDto())
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    if (Object.hasOwn(body, "viewDefaults")) {
      if (!this.#updateViewDefaults) return jsonResponse({ error: "Reader view defaults are read-only" }, 405)
      let parsed: ReturnType<typeof parseNeoviewViewDefaultsPatch>
      try {
        parsed = parseNeoviewViewDefaultsPatch(body)
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 400)
      }
      let updated: NeoviewViewDefaults | undefined
      const operation = this.#configUpdateQueue.then(async () => {
        updated = await this.#updateViewDefaults!(parsed.patch, parsed.tomlPatch)
        this.#viewDefaults = updated
        if (parsed.patch.viewDefaults.pageMode) {
          const layout = {
            ...DEFAULT_READER_LAYOUT,
            ...this.#sessionOptions.layout,
            pageMode: parsed.patch.viewDefaults.pageMode,
          }
          this.#sessionOptions = { ...this.#sessionOptions, layout }
          this.#service.updateSessionDefaults(this.#sessionOptions)
        }
      })
      this.#configUpdateQueue = operation.catch(() => undefined)
      try {
        await operation
        return jsonResponse(this.#configDto())
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    if (Object.hasOwn(body, "folderView")) {
      if (!this.#updateFolderView) return jsonResponse({ error: "Reader folder view config is read-only" }, 405)
      let parsed: ReturnType<typeof parseNeoviewFolderViewPatch>
      try {
        parsed = parseNeoviewFolderViewPatch(body)
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 400)
      }
      let updated: NeoviewFolderViewConfig | undefined
      const operation = this.#configUpdateQueue.then(async () => {
        updated = await this.#updateFolderView!(parsed.patch, parsed.tomlPatch)
        this.#folderView = updated
      })
      this.#configUpdateQueue = operation.catch(() => undefined)
      try {
        await operation
        return jsonResponse(this.#configDto())
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    if (!this.#updateShellOptions) return jsonResponse({ error: "Reader shell config is read-only" }, 405)
    let parsed: ReturnType<typeof parseNeoviewSidebarLayoutPatch> | ReturnType<typeof parseNeoviewCardLayoutPatch> | ReturnType<typeof parseNeoviewBoardLayoutPatch>
    try {
      parsed = Object.hasOwn(body, "board")
        ? parseNeoviewBoardLayoutPatch(body)
        : Object.hasOwn(body, "cardId")
          ? parseNeoviewCardLayoutPatch(body)
          : parseNeoviewSidebarLayoutPatch(body)
    } catch (error) {
      return jsonResponse({ error: errorMessage(error) }, 400)
    }
    let updated: NeoviewShellConfig | undefined
    const operation = this.#configUpdateQueue.then(async () => {
      if ("expectedRevision" in parsed.patch && parsed.patch.expectedRevision !== this.#shellRevision) {
        throw new ReaderShellRevisionConflict(parsed.patch.expectedRevision, this.#shellRevision)
      }
      updated = await this.#updateShellOptions!(parsed.patch, parsed.tomlPatch)
      this.#shellOptions = updated
      this.#shellRevision += 1
    })
    this.#configUpdateQueue = operation.catch(() => undefined)
    try {
      await operation
      return jsonResponse(this.#configDto())
    } catch (error) {
      if (error instanceof ReaderShellRevisionConflict) {
        return jsonResponse({ error: error.message, ...this.#configDto() }, 409)
      }
      return jsonResponse({ error: errorMessage(error) }, 500)
    }
  }

  #configDto() {
    return {
      schemaVersion: 1 as const,
      shell: { ...this.#shellOptions, revision: this.#shellRevision },
      viewDefaults: this.#viewDefaults,
      folderView: this.#folderView,
      slideshow: this.#slideshow,
    }
  }

  #getSession(encodedSessionId: string): Response {
    const session = this.#findSession(encodedSessionId)
    return session ? jsonResponse(this.#sessionDto(session)) : jsonResponse({ error: "Reader session not found" }, 404)
  }

  async #listPages(encodedSessionId: string, url: URL, signal?: AbortSignal): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    const query = url.searchParams.get("query")?.trim() ?? ""
    if (query.length > 128) return jsonResponse({ error: "Page query must not exceed 128 characters" }, 400)
    const normalizedQuery = query.toLocaleLowerCase()
    const catalog = normalizedQuery
      ? session.book.pages.filter((page) => page.name.toLocaleLowerCase().includes(normalizedQuery) || String(page.index + 1).includes(normalizedQuery))
      : session.book.pages
    const cursor = boundedInteger(url.searchParams.get("cursor"), 0, catalog.length, 0)
    const limit = boundedInteger(url.searchParams.get("limit"), 1, 500, 100)
    const sourcePages = catalog.slice(cursor, cursor + limit)
    if (url.searchParams.get("thumbnails") !== "0") {
      await this.#assets.prewarmThumbnails(sourcePages, signal).catch((error) => {
        if (signal?.aborted) throw error
      })
    }
    const pages = sourcePages.map((page) => this.#pageDto(session, page))
    const nextCursor = cursor + pages.length < catalog.length ? cursor + pages.length : undefined
    return jsonResponse({ pages, nextCursor, total: catalog.length })
  }

  async #metadata(encodedSessionId: string, signal?: AbortSignal): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    const snapshot = session.snapshot()
    const page = session.book.pages[snapshot.anchorPageIndex]
    const sourcePath = session.book.source.path
    const pageFilePath = page && !page.timestamps && !page.entryPath && page.sourcePath !== sourcePath
      ? page.sourcePath
      : undefined
    const [bookStats, pageStats] = await Promise.all([
      safeStat(sourcePath, signal),
      pageFilePath && pageFilePath !== sourcePath ? safeStat(pageFilePath, signal) : Promise.resolve(undefined),
    ])
    signal?.throwIfAborted()
    return jsonResponse({
      book: {
        displayName: session.book.displayName,
        sourceKind: session.book.source.kind,
        sourcePath,
        pageCount: session.book.pages.length,
        currentPage: snapshot.anchorPageIndex + 1,
        progressPercent: session.book.pages.length ? (snapshot.anchorPageIndex + 1) / session.book.pages.length * 100 : 0,
        byteLength: bookStats?.isFile() ? bookStats.size : undefined,
        createdAtMs: validTime(bookStats?.birthtimeMs),
        modifiedAtMs: validTime(bookStats?.mtimeMs),
        accessedAtMs: validTime(bookStats?.atimeMs),
      },
      page: page ? pageMetadata(page, pageStats ?? (!page.timestamps && !page.entryPath ? bookStats : undefined)) : undefined,
    })
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
      return jsonResponse({ frame, visiblePages: this.#visiblePages(session, frame), preload: session.preloadPlan() })
    } catch (error) {
      if (request.signal.aborted) throw error
      return jsonResponse({ error: errorMessage(error) }, 400)
    }
  }

  async #reportPreloadEvents(encodedSessionId: string, request: Request): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    const body = await readControlJson(request)
    if (!body || !Number.isSafeInteger(body.generation) || !Array.isArray(body.events) || body.events.length < 1 || body.events.length > 64) {
      return jsonResponse({ error: "Preload report requires generation and 1..64 events" }, 400)
    }
    const events: Array<{ pageId: string; outcome: ReaderPreloadOutcome }> = []
    for (const value of body.events) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return jsonResponse({ error: "Invalid preload event" }, 400)
      const event = value as Record<string, unknown>
      if (typeof event.pageId !== "string" || !event.pageId || !isPreloadOutcome(event.outcome)) {
        return jsonResponse({ error: "Preload event requires pageId and a valid outcome" }, 400)
      }
      events.push({ pageId: event.pageId, outcome: event.outcome })
    }
    const results = events.map((event) => session.reportPreload({ generation: body.generation as number, ...event }))
    const accepted = results.filter((result) => result.accepted).length
    const stale = results.filter((result) => result.reason === "stale-generation").length
    const rejected = results.length - accepted
    const status = accepted > 0 ? 202 : stale > 0 ? 409 : 400
    return jsonResponse({ generation: body.generation, accepted, rejected, stale }, status)
  }

  async #updateSessionOptions(encodedSessionId: string, request: Request): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    const body = await readControlJson(request)
    if (!body || Object.keys(body).some((key) => key !== "layout")) {
      return jsonResponse({ error: "Reader session options must contain only layout" }, 400)
    }
    const layout = body.layout
    if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
      return jsonResponse({ error: "Reader session options.layout must be an object" }, 400)
    }
    const record = layout as Record<string, unknown>
    if (Object.keys(record).some((key) => key !== "pageMode") || (record.pageMode !== "single" && record.pageMode !== "double")) {
      return jsonResponse({ error: "Reader session options.layout.pageMode must be single or double" }, 400)
    }
    try {
      const current = session.snapshot().layout
      const frame = await session.updateOptions({ layout: { ...current, pageMode: record.pageMode } }, request.signal)
      return jsonResponse({ frame, visiblePages: this.#visiblePages(session, frame), preload: session.preloadPlan() })
    } catch (error) {
      if (request.signal.aborted) throw error
      return jsonResponse({ error: errorMessage(error) }, 400)
    }
  }

  async #closeSession(encodedSessionId: string): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    await this.#mediaProgress?.flush(session.book.id)
    await this.#clipboardMaterializations.releaseSession(session.id)
    await this.#service.closeSession(session.id)
    await this.#hibernateIfIdle()
    return new Response(null, { status: 204 })
  }

  async #materializeClipboardPage(encodedSessionId: string, request: Request): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    const body = await readControlJson(request)
    if (!body || typeof body.pageId !== "string" || !body.pageId) {
      return jsonResponse({ error: "pageId must be a non-empty string" }, 400)
    }
    try {
      const materialization = await this.#clipboardMaterializations.materialize(session.id, body.pageId, request.signal)
      return jsonResponse(materialization, 201)
    } catch (error) {
      if (request.signal.aborted) throw error
      return jsonResponse({ error: errorMessage(error) }, 400)
    }
  }

  async #releaseClipboardMaterialization(encodedSessionId: string, encodedToken: string): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    const token = safeDecode(encodedToken)
    if (!token || !await this.#clipboardMaterializations.release(token, session.id)) {
      return jsonResponse({ error: "Reader clipboard materialization not found" }, 404)
    }
    return new Response(null, { status: 204 })
  }

  async #handleMediaProgress(encodedSessionId: string, request: Request): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    if (!this.#mediaProgress) return jsonResponse({ error: "Reader media progress is unavailable" }, 501)
    if (!session.book.pages.some((page) => page.mediaKind === "video")) {
      return jsonResponse({ error: "Reader session does not contain video media" }, 409)
    }
    if (request.method === "GET") {
      try {
        return jsonResponse({ progress: await this.#mediaProgress.get(session.book.id) ?? null })
      } catch (error) {
        if (request.signal.aborted) throw error
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    const body = await readControlJson(request)
    if (!body) return jsonResponse({ error: "Media progress patch must be a JSON object" }, 400)
    if (body.flush !== undefined && typeof body.flush !== "boolean") {
      return jsonResponse({ error: "Media progress flush must be a boolean" }, 400)
    }
    const { flush, ...update } = body
    let progress
    try {
      progress = this.#mediaProgress.record(session.book.id, update as ReaderMediaProgressUpdate)
    } catch (error) {
      return jsonResponse({ error: errorMessage(error) }, 400)
    }
    if (flush) {
      try {
        await this.#mediaProgress.flush(session.book.id)
      } catch (error) {
        if (request.signal.aborted) throw error
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    return jsonResponse({ progress, durable: Boolean(flush) }, flush ? 200 : 202)
  }

  #hibernateIfIdle(): Promise<void> {
    if (this.#hibernateCheck) return this.#hibernateCheck
    const pending = Promise.resolve().then(() => {
      if (this.#service.sessionCount === 0) this.#assets.hibernate()
    }).finally(() => {
      if (this.#hibernateCheck === pending) this.#hibernateCheck = undefined
    })
    this.#hibernateCheck = pending
    return pending
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
      preload: session.preloadPlan(),
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

class ReaderShellRevisionConflict extends Error {
  constructor(expected: number, actual: number) {
    super(`Reader layout changed while editing (expected revision ${expected}, current revision ${actual}).`)
    this.name = "ReaderShellRevisionConflict"
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

function isPreloadOutcome(value: unknown): value is ReaderPreloadOutcome {
  return value === "started" || value === "ready" || value === "failed" || value === "cancelled" || value === "evicted"
}

async function safeStat(path: string, signal?: AbortSignal): Promise<Stats | undefined> {
  signal?.throwIfAborted()
  try {
    const result = await stat(path)
    signal?.throwIfAborted()
    return result
  } catch (error) {
    if (signal?.aborted) throw error
    return undefined
  }
}

function pageMetadata(page: ReaderPage, fallbackStats?: Stats): Record<string, unknown> {
  const timestamps = page.timestamps
  return {
    index: page.index,
    name: page.name,
    displayPath: page.entryPath ?? page.sourcePath,
    mediaKind: page.mediaKind,
    mimeType: page.mimeType,
    byteLength: page.byteLength ?? (fallbackStats?.isFile() ? fallbackStats.size : undefined),
    dimensions: page.dimensions,
    timeSource: timestamps?.source ?? (fallbackStats ? "book-source" : undefined),
    createdAtMs: timestamps?.createdAtMs ?? validTime(fallbackStats?.birthtimeMs),
    modifiedAtMs: timestamps?.modifiedAtMs ?? validTime(fallbackStats?.mtimeMs),
    accessedAtMs: timestamps?.accessedAtMs ?? validTime(fallbackStats?.atimeMs),
  }
}

function validTime(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined
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

function schedulerSnapshot(
  scheduler: ResourceScheduler | undefined,
): (() => Readonly<Record<"cpu" | "io" | "gpu", ReaderSchedulerPoolDiagnostics>>) | undefined {
  const source = scheduler as (ResourceScheduler & {
    snapshot?: () => Readonly<Record<"cpu" | "io" | "gpu", ReaderSchedulerPoolDiagnostics>>
  }) | undefined
  return typeof source?.snapshot === "function" ? () => source.snapshot!() : undefined
}
