import type { NeoViewMigrationStatus, NeoViewRuntime } from "./core.js"
import type { ArchiveProvider } from "./ports/ArchiveProvider.js"
import type { ReaderBookLoader } from "./ports/ReaderBookLoader.js"
import type { ZipArchiveProviderOptions } from "./platform/archives/zip/ZipArchiveProvider.js"
import type { ReaderAssetRoute, ReaderAssetRouteOptions } from "./platform/asset-route/ReaderAssetRoute.js"
import type { ReaderHttpController, ReaderHttpControllerOptions } from "./platform/asset-route/ReaderHttpController.js"
import type { ReaderService } from "./application/reader/contracts.js"
import type { ImageMetadataProbe } from "./ports/ImageMetadataProbe.js"
import type { ReaderThumbnailStore } from "./ports/ReaderThumbnailStore.js"
import type { ReaderProgressStore } from "./ports/ReaderProgressStore.js"
import type { ReaderMediaProgressStore } from "./ports/ReaderMediaProgressStore.js"
import type { ReaderDataStore } from "./ports/ReaderDataStore.js"
import type { ReaderDirectorySortPreferenceStore } from "./application/browser/ReaderDirectorySortPreferences.js"
import type { ReaderDirectoryEmmRecordStore } from "./ports/ReaderDirectoryEmmRecordStore.js"
import type { ResourceScheduler } from "./ports/ResourceScheduler.js"
import type { ReaderPresentationDiskCache } from "./ports/ReaderPresentationDiskCache.js"
import type { ReaderFileTreeWatcher } from "./ports/ReaderFileTreeWatcher.js"
import type { ReaderFileTreeScanner } from "./ports/ReaderFileTreeScanner.js"
import type { ReaderLibraryService } from "./application/library/ReaderLibraryService.js"
import type { ReaderCacheService } from "./application/cache/ReaderCacheService.js"
import type { LegacyReaderDataImporter } from "./migration/LegacyReaderDataImporter.js"
import type { PlatformReaderBookLoaderOptions } from "./platform/books/PlatformReaderBookLoader.js"
import type { ReaderHeadlessController } from "./application/headless/ReaderHeadlessController.js"
import type { SolidArchiveCache, SolidArchiveCacheOptions } from "./platform/archives/sevenzip/SolidArchiveCache.js"
import type { NeoviewRuntimeLoadOptions } from "./platform/config/loadNeoviewRuntimeConfig.js"
import type { NeoviewPresentationDiskCacheConfig } from "./application/config/ReaderRuntimeConfig.js"
import type {
  ReadonlyLegacyThumbnailStore,
  ReadonlyLegacyThumbnailStoreOptions,
} from "./platform/thumbnails/ReadonlyLegacyThumbnailStore.js"
import type {
  WritableLegacyThumbnailStore,
  WritableLegacyThumbnailStoreOptions,
} from "./platform/thumbnails/WritableLegacyThumbnailStore.js"
import type {
  PlatformThumbnailPipeline,
  PlatformThumbnailPipelineOptions,
} from "./platform/thumbnails/PlatformThumbnailPipeline.js"
import type {
  FfmpegVideoThumbnailProvider,
  FfmpegVideoThumbnailProviderOptions,
} from "./platform/video/FfmpegVideoThumbnailProvider.js"
import type {
  SqliteLegacyThumbnailDatabaseMaintenance,
  SqliteLegacyThumbnailDatabaseMaintenanceOptions,
} from "./platform/thumbnails/SqliteLegacyThumbnailDatabaseMaintenance.js"

export type { PlatformReaderBookLoaderOptions } from "./platform/books/PlatformReaderBookLoader.js"
export type { SolidArchiveCacheOptions } from "./platform/archives/sevenzip/SolidArchiveCache.js"
export type { LibraryThumbnailKind, LibraryThumbnailSource, PlatformThumbnailPipelineOptions } from "./platform/thumbnails/PlatformThumbnailPipeline.js"
export type { VideoThumbnailProvider, VideoThumbnailRequest, VideoThumbnailResult } from "./ports/VideoThumbnailProvider.js"
export type { FfmpegVideoThumbnailProviderOptions } from "./platform/video/FfmpegVideoThumbnailProvider.js"
export type { SqliteLegacyThumbnailDatabaseMaintenanceOptions } from "./platform/thumbnails/SqliteLegacyThumbnailDatabaseMaintenance.js"
export type {
  ReaderFileTreeChange,
  ReaderFileTreeChangeKind,
  ReaderFileTreeSubscription,
  ReaderFileTreeWatcher,
} from "./ports/ReaderFileTreeWatcher.js"
export type {
  ReaderFileTreeEntry,
  ReaderFileTreeEntryKind,
  ReaderFileTreeScanner,
  ReaderFileTreeScanOptions,
} from "./ports/ReaderFileTreeScanner.js"

export type ReaderCompositionOptions = PlatformReaderBookLoaderOptions & NeoviewRuntimeLoadOptions & {
  progressStore?: ReaderProgressStore | false
  mediaProgressStore?: ReaderMediaProgressStore | false
  legacyThumbnailDatabasePath?: string | false
}
export type ReaderAssetRouteCompositionOptions = ReaderAssetRouteOptions & {
  resourceScheduler?: ResourceScheduler
}
export type ReaderHttpCompositionOptions = ReaderHttpControllerOptions & NeoviewRuntimeLoadOptions & {
  legacyThumbnailDatabasePath?: string | false
  loadLegacyThumbnailStore?: (databasePath?: string) => Promise<ReaderThumbnailStore>
  useDefaultLegacyProgressStore?: boolean
}

const CURRENT_STATUS: NeoViewMigrationStatus = {
  sourceRevision: "a4c4e07401e0e0c3e4d77edba096f6fd5b3e0c45",
  featureCount: 30,
  pendingFeatures: 30,
  readerCoreReady: true,
}

export function createNodeNeoviewRuntime(): NeoViewRuntime {
  return {
    migrationStatus: async () => ({ ...CURRENT_STATUS }),
  }
}

export async function createZipArchiveProvider(
  sourcePath: string,
  options?: ZipArchiveProviderOptions,
): Promise<ArchiveProvider> {
  const { ZipArchiveProvider } = await import("./platform/archives/zip/ZipArchiveProvider.js")
  return new ZipArchiveProvider(sourcePath, options)
}

export async function createReaderBookLoader(options: PlatformReaderBookLoaderOptions = {}): Promise<ReaderBookLoader> {
  const { createPlatformReaderBookLoader } = await import("./platform/books/PlatformReaderBookLoader.js")
  return createPlatformReaderBookLoader(options)
}

export async function createReaderAssetRoute(
  readerService: ReaderService,
  options: ReaderAssetRouteCompositionOptions,
): Promise<ReaderAssetRoute> {
  const { ReaderAssetRoute } = await import("./platform/asset-route/ReaderAssetRoute.js")
  const { WeightedLruPresentationCache } = await import("./platform/cache/WeightedLruPresentationCache.js")
  return new ReaderAssetRoute(readerService, options, {
    presentationCache: new WeightedLruPresentationCache(),
    loadImageTransformer: async () => {
      const { SharpImageTransformer } = await import("./platform/images/sharp/SharpImageTransformer.js")
      return new SharpImageTransformer(options.resourceScheduler)
    },
  })
}

export async function createReaderHttpController(
  options: ReaderHttpCompositionOptions,
): Promise<ReaderHttpController> {
  const { ReaderHttpController } = await import("./platform/asset-route/ReaderHttpController.js")
  const { ReaderLibraryService } = await import("./application/library/ReaderLibraryService.js")
  const { loadNeoviewRuntimeConfig } = await import("./platform/config/loadNeoviewRuntimeConfig.js")
  const runtimeConfig = await loadNeoviewRuntimeConfig(options)
  const presentationDiskCache = options.presentationDiskCache ?? (
    runtimeConfig.presentationDiskCache.enabled
      ? await createDefaultPresentationDiskCache(runtimeConfig.presentationDiskCache, options)
      : undefined
  )
  const useDefaultDataStore = options.legacyThumbnailDatabasePath !== false
    && (typeof options.legacyThumbnailDatabasePath === "string" || options.useDefaultLegacyProgressStore)
  const dataStore = useDefaultDataStore
    ? await createSqliteReaderDataStore(await legacyNeoViewDatabasePath(
        typeof options.legacyThumbnailDatabasePath === "string" ? options.legacyThumbnailDatabasePath : undefined,
      ))
    : undefined
  const progressStore = options.progressStore === false
    ? undefined
    : options.progressStore ?? dataStore
  const libraryService = dataStore ? new ReaderLibraryService(dataStore) : undefined
  let thumbnailStore = options.thumbnailStore
  let disposeThumbnailStore = options.disposeThumbnailStore
  if (!thumbnailStore && options.legacyThumbnailDatabasePath !== false) {
    const { LazyReaderThumbnailStore } = await import("./platform/thumbnails/LazyReaderThumbnailStore.js")
    const loadThumbnailStore = options.loadLegacyThumbnailStore ?? createWritableLegacyThumbnailStore
    const ownedThumbnailStore = new LazyReaderThumbnailStore({
      load: () => loadThumbnailStore(options.legacyThumbnailDatabasePath || undefined),
      dispose: disposeLoadedThumbnailStore,
    })
    thumbnailStore = ownedThumbnailStore
    disposeThumbnailStore = () => ownedThumbnailStore.close()
  }
  return new ReaderHttpController({
    ...options,
    progressStore,
    mediaProgressStore: dataStore,
    libraryService,
    directorySortPreferenceStore: dataStore,
    directoryEmmRecordStore: dataStore,
    disposeLibraryService: true,
    sessionOptions: runtimeConfig.sessionOptions,
    shellOptions: runtimeConfig.shellOptions,
    viewDefaults: runtimeConfig.viewDefaults,
    folderView: runtimeConfig.folderView,
    slideshow: runtimeConfig.slideshow,
    presentationDiskCache,
    disposePresentationDiskCache: Boolean(presentationDiskCache && !options.presentationDiskCache),
    updateShellOptions: async (_patch, tomlPatch) => {
      const { commitNeoviewConfig } = await import("./platform/config/NeoviewConfigStore.js")
      const { parseNeoviewRuntimeConfig } = await import("./application/config/ReaderRuntimeConfig.js")
      const committed = await commitNeoviewConfig(tomlPatch, { ...options, strategy: "merge" })
      return parseNeoviewRuntimeConfig(committed.nodeConfig).shellOptions
    },
    updateViewDefaults: async (_patch, tomlPatch) => {
      const { commitNeoviewConfig } = await import("./platform/config/NeoviewConfigStore.js")
      const { parseNeoviewRuntimeConfig } = await import("./application/config/ReaderRuntimeConfig.js")
      const committed = await commitNeoviewConfig(tomlPatch, { ...options, strategy: "merge" })
      return parseNeoviewRuntimeConfig(committed.nodeConfig).viewDefaults
    },
    updateFolderView: async (_patch, tomlPatch) => {
      const { commitNeoviewConfig } = await import("./platform/config/NeoviewConfigStore.js")
      const { parseNeoviewRuntimeConfig } = await import("./application/config/ReaderRuntimeConfig.js")
      const committed = await commitNeoviewConfig(tomlPatch, { ...options, strategy: "merge" })
      return parseNeoviewRuntimeConfig(committed.nodeConfig).folderView
    },
    updateSlideshow: async (_patch, tomlPatch) => {
      const { commitNeoviewConfig } = await import("./platform/config/NeoviewConfigStore.js")
      const { parseNeoviewRuntimeConfig } = await import("./application/config/ReaderRuntimeConfig.js")
      const committed = await commitNeoviewConfig(tomlPatch, { ...options, strategy: "merge" })
      return parseNeoviewRuntimeConfig(committed.nodeConfig).slideshow
    },
    thumbnailStore,
    disposeThumbnailStore,
  })
}

export async function createReaderCacheService(
  options: NeoviewRuntimeLoadOptions = {},
): Promise<ReaderCacheService> {
  const { ReaderCacheService } = await import("./application/cache/ReaderCacheService.js")
  const { loadNeoviewRuntimeConfig } = await import("./platform/config/loadNeoviewRuntimeConfig.js")
  const config = (await loadNeoviewRuntimeConfig(options)).presentationDiskCache
  if (!config.enabled) return new ReaderCacheService()
  return new ReaderCacheService(
    await createDefaultPresentationDiskCache(config, options),
    { ownsPresentationCache: true },
  )
}

async function disposeLoadedThumbnailStore(store: ReaderThumbnailStore): Promise<void> {
  const disposable = store as ReaderThumbnailStore & Partial<AsyncDisposable> & { close?: () => void | Promise<void> }
  const asyncDispose = disposable[Symbol.asyncDispose]
  if (typeof asyncDispose === "function") await asyncDispose.call(disposable)
  else await disposable.close?.()
}

export async function createImageMetadataProbe(): Promise<ImageMetadataProbe> {
  const { StreamingImageMetadataProbe } = await import("./platform/images/StreamingImageMetadataProbe.js")
  return new StreamingImageMetadataProbe()
}

export async function createFileTreeWatcher(): Promise<ReaderFileTreeWatcher> {
  const { PlatformFileTreeWatcher } = await import("./platform/filesystem/PlatformFileTreeWatcher.js")
  return new PlatformFileTreeWatcher()
}

export async function createFileTreeScanner(): Promise<ReaderFileTreeScanner> {
  const { PlatformFileTreeScanner } = await import("./platform/filesystem/PlatformFileTreeScanner.js")
  return new PlatformFileTreeScanner()
}

export async function createSolidArchiveCache(options: SolidArchiveCacheOptions = {}): Promise<SolidArchiveCache> {
  const { SolidArchiveCache } = await import("./platform/archives/sevenzip/SolidArchiveCache.js")
  return new SolidArchiveCache(options)
}

export async function createReadonlyLegacyThumbnailStore(
  databasePath?: string,
  options: ReadonlyLegacyThumbnailStoreOptions = {},
): Promise<ReadonlyLegacyThumbnailStore> {
  let path = databasePath
  if (!path) {
    const { LegacyNeoViewDataLocator } = await import("./application/data/LegacyNeoViewDataLocator.js")
    path = new LegacyNeoViewDataLocator().locate().thumbnailDatabasePath
  }
  const { ReadonlyLegacyThumbnailStore } = await import("./platform/thumbnails/ReadonlyLegacyThumbnailStore.js")
  return ReadonlyLegacyThumbnailStore.open(path, options)
}

export async function createWritableLegacyThumbnailStore(
  databasePath?: string,
  options: WritableLegacyThumbnailStoreOptions = {},
): Promise<WritableLegacyThumbnailStore> {
  let path = databasePath
  if (!path) {
    const { LegacyNeoViewDataLocator } = await import("./application/data/LegacyNeoViewDataLocator.js")
    path = new LegacyNeoViewDataLocator().locate().thumbnailDatabasePath
  }
  const { WritableLegacyThumbnailStore } = await import("./platform/thumbnails/WritableLegacyThumbnailStore.js")
  return WritableLegacyThumbnailStore.open(path, options)
}

export async function createLegacyThumbnailDatabaseMaintenance(
  options: SqliteLegacyThumbnailDatabaseMaintenanceOptions = {},
): Promise<SqliteLegacyThumbnailDatabaseMaintenance> {
  const { SqliteLegacyThumbnailDatabaseMaintenance } = await import("./platform/thumbnails/SqliteLegacyThumbnailDatabaseMaintenance.js")
  return new SqliteLegacyThumbnailDatabaseMaintenance(options)
}

export async function createPlatformThumbnailPipeline(
  options: PlatformThumbnailPipelineOptions = {},
): Promise<PlatformThumbnailPipeline> {
  const { PlatformThumbnailPipeline } = await import("./platform/thumbnails/PlatformThumbnailPipeline.js")
  return new PlatformThumbnailPipeline(options)
}

export async function createFfmpegVideoThumbnailProvider(
  options: FfmpegVideoThumbnailProviderOptions = {},
): Promise<FfmpegVideoThumbnailProvider> {
  const { FfmpegVideoThumbnailProvider } = await import("./platform/video/FfmpegVideoThumbnailProvider.js")
  return new FfmpegVideoThumbnailProvider(options)
}

export async function createReaderLibraryService(databasePath?: string): Promise<ReaderLibraryService> {
  const { ReaderLibraryService } = await import("./application/library/ReaderLibraryService.js")
  return new ReaderLibraryService(
    await createSqliteReaderDataStore(await legacyNeoViewDatabasePath(databasePath)),
  )
}

export async function createLegacyReaderDataImporter(databasePath?: string): Promise<LegacyReaderDataImporter> {
  const { LegacyReaderDataImporter } = await import("./migration/LegacyReaderDataImporter.js")
  const { resolveLegacyReaderSource } = await import("./platform/migration/resolveLegacyReaderSource.js")
  return new LegacyReaderDataImporter(
    await createSqliteReaderDataStore(await legacyNeoViewDatabasePath(databasePath)),
    resolveLegacyReaderSource,
  )
}

export async function createReaderHeadlessController(
  options: ReaderCompositionOptions = {},
): Promise<ReaderHeadlessController> {
  const { ReaderHeadlessController } = await import("./application/headless/ReaderHeadlessController.js")
  const { CoreReaderService } = await import("./application/reader/ReaderService.js")
  const { createPlatformReaderBookLoader } = await import("./platform/books/PlatformReaderBookLoader.js")
  const { StreamingImageMetadataProbe } = await import("./platform/images/StreamingImageMetadataProbe.js")
  const { SolidArchiveCache } = await import("./platform/archives/sevenzip/SolidArchiveCache.js")
  const { loadNeoviewSessionOptions } = await import("./platform/config/loadNeoviewRuntimeConfig.js")
  const progressStore = options.progressStore === false
    ? undefined
    : options.progressStore ?? (options.legacyThumbnailDatabasePath === false
      ? undefined
      : await createSqliteReaderDataStore(await legacyNeoViewDatabasePath(options.legacyThumbnailDatabasePath)))
  const mediaProgressStore = options.mediaProgressStore === false
    ? undefined
    : options.mediaProgressStore ?? (isReaderMediaProgressStore(progressStore) ? progressStore : undefined)
  const mediaProgress = mediaProgressStore
    ? new (await import("./application/reader/ReaderMediaProgressService.js")).ReaderMediaProgressService(mediaProgressStore)
    : undefined
  const ownsCache = !options.solidArchiveCache
  const solidArchiveCache = options.solidArchiveCache ?? new SolidArchiveCache({
    maxBytes: options.maxSolidArchiveCacheBytes,
  })
  return new ReaderHeadlessController(
    new CoreReaderService(
      createPlatformReaderBookLoader({ ...options, solidArchiveCache }),
      new StreamingImageMetadataProbe(),
      await loadNeoviewSessionOptions(options),
      progressStore,
    ),
    ownsCache ? () => solidArchiveCache.close() : undefined,
    mediaProgress,
  )
}

function isReaderMediaProgressStore(store: ReaderProgressStore | undefined): store is ReaderProgressStore & ReaderMediaProgressStore {
  return Boolean(store
    && typeof (store as Partial<ReaderMediaProgressStore>).getMediaProgress === "function"
    && typeof (store as Partial<ReaderMediaProgressStore>).saveMediaProgress === "function")
}

async function createSqliteReaderDataStore(databasePath: string): Promise<ReaderDataStore & ReaderDirectorySortPreferenceStore & ReaderDirectoryEmmRecordStore> {
  const { SqliteReaderDataStore } = await import("./platform/persistence/SqliteReaderDataStore.js")
  return SqliteReaderDataStore.open(databasePath)
}

async function createDefaultPresentationDiskCache(
  config: NeoviewPresentationDiskCacheConfig,
  options: NeoviewRuntimeLoadOptions,
): Promise<ReaderPresentationDiskCache> {
  const { join, resolve } = await import("node:path")
  const root = config.directory
    ? resolve(options.cwd ?? process.cwd(), config.directory)
    : join((await import("@xiranite/config")).resolveXiraniteDataDir(options), "cache", "neoview", "presentation-v1")
  const { CacachePresentationDiskCache } = await import("./platform/cache/CacachePresentationDiskCache.js")
  return new CacachePresentationDiskCache({
    root,
    maxBytes: config.maxBytes,
    maxEntryBytes: config.maxEntryBytes,
    maxAgeMs: config.maxAgeMs,
    trimRatio: config.trimRatio,
    minFreeBytes: config.minFreeBytes,
  })
}

async function legacyNeoViewDatabasePath(explicitPath?: string): Promise<string> {
  if (explicitPath) return explicitPath
  const { LegacyNeoViewDataLocator } = await import("./application/data/LegacyNeoViewDataLocator.js")
  return new LegacyNeoViewDataLocator().locate().thumbnailDatabasePath
}
