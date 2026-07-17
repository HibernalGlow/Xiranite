import type { NeoViewMigrationStatus, NeoViewRuntime } from "./core.js"
import type { ArchiveProvider } from "./ports/ArchiveProvider.js"
import type { ReaderBookLoader } from "./ports/ReaderBookLoader.js"
import type { ZipArchiveProviderOptions } from "./platform/archives/zip/ZipArchiveProvider.js"
import type { ReaderAssetRoute, ReaderAssetRouteOptions } from "./platform/asset-route/ReaderAssetRoute.js"
import type { ReaderHttpController, ReaderHttpControllerOptions } from "./platform/asset-route/ReaderHttpController.js"
import type { ReaderService } from "./application/reader/contracts.js"
import type { ReaderClipboardMaterializationServiceOptions } from "./application/reader/ReaderClipboardMaterializationService.js"
import type { ImageMetadataProbe } from "./ports/ImageMetadataProbe.js"
import type { ReaderThumbnailStore } from "./ports/ReaderThumbnailStore.js"
import type { ReaderProgressStore } from "./ports/ReaderProgressStore.js"
import type { ReaderMediaProgressStore } from "./ports/ReaderMediaProgressStore.js"
import type { ReaderDataStore } from "./ports/ReaderDataStore.js"
import type { ReaderBookSettingsStore } from "./ports/ReaderBookSettingsStore.js"
import type { ReaderSearchHistoryStore } from "./ports/ReaderSearchHistoryStore.js"
import type { ReaderDirectorySortPreferenceStore } from "./application/browser/ReaderDirectorySortPreferences.js"
import type { ReaderDirectoryEmmRecordStore } from "./ports/ReaderDirectoryEmmRecordStore.js"
import type { ResourceScheduler } from "./ports/ResourceScheduler.js"
import type { PlatformReaderPageMaterializerOptions } from "./platform/content/PlatformReaderPageMaterializer.js"
import type { ReaderPresentationDiskCache } from "./ports/ReaderPresentationDiskCache.js"
import type { ReaderFileTreeWatcher } from "./ports/ReaderFileTreeWatcher.js"
import type { ReaderFileTreeScanner } from "./ports/ReaderFileTreeScanner.js"
import type { ReaderLibraryService } from "./application/library/ReaderLibraryService.js"
import type { ReaderCacheService } from "./application/cache/ReaderCacheService.js"
import type { LegacyReaderDataImporter } from "./migration/LegacyReaderDataImporter.js"
import type { LegacySearchHistoryImporter } from "./migration/LegacySearchHistoryImporter.js"
import type { ReaderSettingsMigrationService } from "./application/migration/ReaderSettingsMigrationService.js"
import type { ReaderSettingsPortableService } from "./application/migration/ReaderSettingsPortableService.js"
import type { ReaderBackupBundleService } from "./platform/backup/ReaderBackupBundleService.js"
import type { PlatformReaderBookLoaderOptions } from "./platform/books/PlatformReaderBookLoader.js"
import type { ReaderHeadlessController } from "./application/headless/ReaderHeadlessController.js"
import type { ReaderFileTreeHeadlessController } from "./application/headless/ReaderFileTreeHeadlessController.js"
import type { ReaderLibraryHeadlessController } from "./application/headless/ReaderLibraryHeadlessController.js"
import type { ReaderFileTreeServiceOptions } from "./application/browser/ReaderFileTreeService.js"
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
  FfprobePageMediaMetadataProvider,
  FfprobePageMediaMetadataProviderOptions,
} from "./platform/video/FfprobePageMediaMetadataProvider.js"
import type {
  SqliteLegacyThumbnailDatabaseMaintenance,
  SqliteLegacyThumbnailDatabaseMaintenanceOptions,
} from "./platform/thumbnails/SqliteLegacyThumbnailDatabaseMaintenance.js"

export type { PlatformReaderBookLoaderOptions } from "./platform/books/PlatformReaderBookLoader.js"
export type { SolidArchiveCacheOptions } from "./platform/archives/sevenzip/SolidArchiveCache.js"
export type { LibraryThumbnailKind, LibraryThumbnailSource, PlatformThumbnailPipelineOptions } from "./platform/thumbnails/PlatformThumbnailPipeline.js"
export type { VideoThumbnailProvider, VideoThumbnailRequest, VideoThumbnailResult } from "./ports/VideoThumbnailProvider.js"
export type { FfmpegVideoThumbnailProviderOptions } from "./platform/video/FfmpegVideoThumbnailProvider.js"
export type { FfprobePageMediaMetadataProviderOptions } from "./platform/video/FfprobePageMediaMetadataProvider.js"
export type { SqliteLegacyThumbnailDatabaseMaintenanceOptions } from "./platform/thumbnails/SqliteLegacyThumbnailDatabaseMaintenance.js"
export type { PlatformReaderPageMaterializerOptions } from "./platform/content/PlatformReaderPageMaterializer.js"
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
  bookSettingsStore?: ReaderBookSettingsStore | false
  legacyThumbnailDatabasePath?: string | false
}
export type ReaderFileTreeCompositionOptions = NeoviewRuntimeLoadOptions & Pick<
  ReaderFileTreeServiceOptions,
  "scanner" | "watcher" | "directorySizeProvider" | "directorySizeConcurrency" | "maximumCacheEntries" | "cacheTtlMs"
> & {
  resourceScheduler?: ResourceScheduler
  searchHistoryStore?: ReaderSearchHistoryStore | false
  legacyThumbnailDatabasePath?: string | false
}
export type ReaderAssetRouteCompositionOptions = ReaderAssetRouteOptions & {
  resourceScheduler?: ResourceScheduler
}
export type ReaderClipboardMaterializationCompositionOptions = ReaderClipboardMaterializationServiceOptions & PlatformReaderPageMaterializerOptions
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

export async function createReaderFileTreeController(
  options: ReaderFileTreeCompositionOptions = {},
): Promise<ReaderFileTreeHeadlessController> {
  const { ReaderFileTreeHeadlessController } = await import("./application/headless/ReaderFileTreeHeadlessController.js")
  const { ReaderFileTreeService } = await import("./application/browser/ReaderFileTreeService.js")
  const { PlatformDirectoryListingProvider } = await import("./platform/filesystem/PlatformDirectoryListingProvider.js")
  const { PlatformFileTreeScanner } = await import("./platform/filesystem/PlatformFileTreeScanner.js")
  const { PlatformFileTreeWatcher } = await import("./platform/filesystem/PlatformFileTreeWatcher.js")
  const { PlatformReaderDirectorySizeProvider } = await import("./platform/filesystem/PlatformReaderDirectorySizeProvider.js")
  const { loadNeoviewRuntimeConfig } = await import("./platform/config/loadNeoviewRuntimeConfig.js")
  const runtimeConfig = await loadNeoviewRuntimeConfig(options)
  const updateExcludedPaths = async (paths: readonly string[]) => {
    const { commitNeoviewFileTreeExclusions } = await import("./platform/config/NeoviewFileTreeConfigStore.js")
    return commitNeoviewFileTreeExclusions(paths, options)
  }
  const service = new ReaderFileTreeService(
    new PlatformDirectoryListingProvider(),
    undefined,
    undefined,
    {
      scanner: options.scanner ?? new PlatformFileTreeScanner(options.resourceScheduler, "neoview:file-tree-headless"),
      watcher: options.watcher ?? new PlatformFileTreeWatcher(),
      directorySizeProvider: options.directorySizeProvider ?? new PlatformReaderDirectorySizeProvider({ resourceScheduler: options.resourceScheduler }),
      maximumCacheEntries: options.maximumCacheEntries,
      cacheTtlMs: options.cacheTtlMs,
      excludedPaths: runtimeConfig.fileTree.excludedPaths,
      updateExcludedPaths,
    },
  )
  const externalSearchHistoryStore = options.searchHistoryStore || undefined
  const loadSearchHistory = options.searchHistoryStore === false || options.legacyThumbnailDatabasePath === false
    ? undefined
    : async () => {
        const store = externalSearchHistoryStore ?? await createSqliteReaderDataStore(await legacyNeoViewDatabasePath(
          typeof options.legacyThumbnailDatabasePath === "string" ? options.legacyThumbnailDatabasePath : undefined,
        ))
        const { ReaderSearchHistoryService } = await import("./application/browser/ReaderSearchHistoryService.js")
        return {
          service: new ReaderSearchHistoryService(store),
          close: externalSearchHistoryStore ? async () => undefined : () => store.close(),
        }
      }
  return new ReaderFileTreeHeadlessController(service, { loadSearchHistory })
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

export async function createReaderClipboardMaterializationService(
  readerService: ReaderService,
  options: ReaderClipboardMaterializationCompositionOptions = {},
) {
  const { ReaderClipboardMaterializationService } = await import("./application/reader/ReaderClipboardMaterializationService.js")
  const { PlatformReaderPageMaterializer } = await import("./platform/content/PlatformReaderPageMaterializer.js")
  return new ReaderClipboardMaterializationService(
    readerService,
    new PlatformReaderPageMaterializer(options),
    options,
  )
}

export async function createReaderHttpController(
  options: ReaderHttpCompositionOptions,
): Promise<ReaderHttpController> {
  const { ReaderHttpController } = await import("./platform/asset-route/ReaderHttpController.js")
  const { ReaderLibraryService } = await import("./application/library/ReaderLibraryService.js")
  const { loadNeoviewRuntimeConfig } = await import("./platform/config/loadNeoviewRuntimeConfig.js")
  const runtimeConfig = await loadNeoviewRuntimeConfig(options)
  const updateFileTreeExclusions = async (paths: readonly string[]) => {
    const { commitNeoviewFileTreeExclusions } = await import("./platform/config/NeoviewFileTreeConfigStore.js")
    return commitNeoviewFileTreeExclusions(paths, options)
  }
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
    bookSettingsStore: options.bookSettingsStore ?? dataStore,
    mediaProgressStore: dataStore,
    libraryService,
    directorySortPreferenceStore: dataStore,
    directoryEmmRecordStore: dataStore,
    searchHistoryStore: dataStore,
    fileUndoJournalStore: dataStore,
    disposeLibraryService: true,
    sessionOptions: runtimeConfig.sessionOptions,
    shellOptions: runtimeConfig.shellOptions,
    viewDefaults: runtimeConfig.viewDefaults,
    folderView: runtimeConfig.folderView,
    fileTree: runtimeConfig.fileTree,
    slideshow: runtimeConfig.slideshow,
    media: runtimeConfig.media,
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
    updateFileTreeExclusions,
    updateSlideshow: async (_patch, tomlPatch) => {
      const { commitNeoviewConfig } = await import("./platform/config/NeoviewConfigStore.js")
      const { parseNeoviewRuntimeConfig } = await import("./application/config/ReaderRuntimeConfig.js")
      const committed = await commitNeoviewConfig(tomlPatch, { ...options, strategy: "merge" })
      return parseNeoviewRuntimeConfig(committed.nodeConfig).slideshow
    },
    updateMedia: async (_patch, tomlPatch) => {
      const { commitNeoviewConfig } = await import("./platform/config/NeoviewConfigStore.js")
      const { parseNeoviewRuntimeConfig } = await import("./application/config/ReaderRuntimeConfig.js")
      const committed = await commitNeoviewConfig(tomlPatch, { ...options, strategy: "merge" })
      return parseNeoviewRuntimeConfig(committed.nodeConfig).media
    },
    loadSettingsMigrationService: () => createReaderSettingsMigrationService(options),
    loadBookSettingsMigrationService: options.loadBookSettingsMigrationService ?? (dataStore
      ? async () => {
          const { ReaderBookSettingsMigrationService } = await import("./application/migration/ReaderBookSettingsMigrationService.js")
          const { LegacyBookSettingsImporter } = await import("./migration/LegacyBookSettingsImporter.js")
          const { resolveLegacyReaderSource } = await import("./platform/migration/resolveLegacyReaderSource.js")
          return new ReaderBookSettingsMigrationService(new LegacyBookSettingsImporter(dataStore, resolveLegacyReaderSource))
        }
      : undefined),
    loadSettingsPortableService: () => createReaderSettingsPortableService({
      ...options,
      thumbnailDatabasePath: options.legacyThumbnailDatabasePath === false
        ? false
        : typeof options.legacyThumbnailDatabasePath === "string" ? options.legacyThumbnailDatabasePath : undefined,
    }),
    thumbnailStore,
    disposeThumbnailStore,
  })
}

export async function createReaderSettingsMigrationService(
  options: NeoviewRuntimeLoadOptions = {},
): Promise<ReaderSettingsMigrationService> {
  const { ReaderSettingsMigrationService } = await import("./application/migration/ReaderSettingsMigrationService.js")
  return new ReaderSettingsMigrationService({
    commit: async (patch, strategy) => {
      const { commitNeoviewConfig } = await import("./platform/config/NeoviewConfigStore.js")
      const committed = await commitNeoviewConfig(patch, { ...options, strategy })
      return {
        changed: committed.changed,
        configPath: committed.configPath,
        backupPath: committed.backupPath,
      }
    },
  })
}

export async function createReaderSettingsPortableService(
  options: NeoviewRuntimeLoadOptions & { thumbnailDatabasePath?: string | false } = {},
): Promise<ReaderSettingsPortableService> {
  const portable = await createReaderSettingsPortableCore(options)
  if (options.thumbnailDatabasePath === false) return portable
  const { ReaderBackupBundleService } = await import("./platform/backup/ReaderBackupBundleService.js")
  const backup = new ReaderBackupBundleService(
    portable,
    await createLegacyThumbnailDatabaseMaintenance(),
    await legacyNeoViewDatabasePath(options.thumbnailDatabasePath),
  )
  return portable.withBackupProvider(backup)
}

async function createReaderSettingsPortableCore(
  options: NeoviewRuntimeLoadOptions,
): Promise<ReaderSettingsPortableService> {
  const { ReaderSettingsPortableService } = await import("./application/migration/ReaderSettingsPortableService.js")
  const { commitNeoviewConfig, readNeoviewConfig } = await import("./platform/config/NeoviewConfigStore.js")
  return new ReaderSettingsPortableService(
    { read: () => readNeoviewConfig(options) },
    {
      commit: async (patch, strategy) => {
        const committed = await commitNeoviewConfig(patch, { ...options, strategy })
        return { changed: committed.changed, configPath: committed.configPath, backupPath: committed.backupPath }
      },
    },
  )
}

export async function createReaderBackupBundleService(
  options: NeoviewRuntimeLoadOptions & { thumbnailDatabasePath?: string } = {},
): Promise<ReaderBackupBundleService> {
  const { ReaderBackupBundleService } = await import("./platform/backup/ReaderBackupBundleService.js")
  return new ReaderBackupBundleService(
    await createReaderSettingsPortableCore(options),
    await createLegacyThumbnailDatabaseMaintenance(),
    await legacyNeoViewDatabasePath(options.thumbnailDatabasePath),
  )
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

export async function createReaderDiagnosticsService(
  options: NeoviewRuntimeLoadOptions & { resourceScheduler?: ResourceScheduler } = {},
) {
  const { ReaderDiagnosticsService } = await import("./application/diagnostics/ReaderDiagnosticsService.js")
  const cache = await createReaderCacheService(options)
  const scheduler = options.resourceScheduler as (ResourceScheduler & { snapshot?: () => never }) | undefined
  return new ReaderDiagnosticsService({
    activeSessions: () => 0,
    assets: () => ({ activeTransformFlights: 0, presentation: null, thumbnails: null }),
    presentationDiskCache: () => cache.status(),
    solidArchiveCache: () => ({ entries: 0, retainedBytes: 0, maxBytes: 0, activeEntries: 0, activeLeases: 0 }),
    scheduler: typeof scheduler?.snapshot === "function" ? () => scheduler.snapshot!() : undefined,
    close: () => cache.close(),
  })
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

export async function createFileTreeScanner(resourceScheduler?: ResourceScheduler): Promise<ReaderFileTreeScanner> {
  const { PlatformFileTreeScanner } = await import("./platform/filesystem/PlatformFileTreeScanner.js")
  return new PlatformFileTreeScanner(resourceScheduler)
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

export async function createFfprobePageMediaMetadataProvider(
  options: FfprobePageMediaMetadataProviderOptions = {},
): Promise<FfprobePageMediaMetadataProvider> {
  const { FfprobePageMediaMetadataProvider } = await import("./platform/video/FfprobePageMediaMetadataProvider.js")
  return new FfprobePageMediaMetadataProvider(options)
}

export async function createReaderLibraryService(databasePath?: string): Promise<ReaderLibraryService> {
  const { ReaderLibraryService } = await import("./application/library/ReaderLibraryService.js")
  return new ReaderLibraryService(
    await createSqliteReaderDataStore(await legacyNeoViewDatabasePath(databasePath)),
  )
}

export async function createReaderFileOperationService(options: {
  resourceScheduler?: ResourceScheduler
  databasePath?: string
  journal?: import("./ports/ReaderFileUndoJournalStore.js").ReaderFileUndoJournalStore
} = {}) {
  const { ReaderFileOperationService } = await import("./application/files/ReaderFileOperationService.js")
  const { PlatformReaderFileMutationProvider } = await import("./platform/filesystem/PlatformReaderFileMutationProvider.js")
  const provider = new PlatformReaderFileMutationProvider({ scheduler: options.resourceScheduler })
  if (options.journal) return new ReaderFileOperationService(provider, { journal: options.journal })
  const journal = await createSqliteReaderDataStore(await legacyNeoViewDatabasePath(options.databasePath))
  return new ReaderFileOperationService(provider, {
    journal,
    disposeJournal: () => journal.close(),
  })
}

export async function createReaderSystemIntegrationService(resourceScheduler?: ResourceScheduler) {
  const { ReaderSystemIntegrationService } = await import("./application/files/ReaderSystemIntegrationService.js")
  const { PlatformReaderSystemIntegrationProvider } = await import("./platform/filesystem/PlatformReaderSystemIntegrationProvider.js")
  return new ReaderSystemIntegrationService(new PlatformReaderSystemIntegrationProvider({ scheduler: resourceScheduler }))
}

export async function createReaderLibraryHeadlessController(
  databasePath?: string,
  resourceScheduler?: ResourceScheduler,
): Promise<ReaderLibraryHeadlessController> {
  const { basename } = await import("node:path")
  const { ReaderLibraryHeadlessController } = await import("./application/headless/ReaderLibraryHeadlessController.js")
  const { detectViewSource } = await import("./platform/filesystem/detectViewSource.js")
  const { ReaderLibraryCleanupService } = await import("./application/library/ReaderLibraryCleanupService.js")
  const { PlatformReaderPathStatusProvider } = await import("./platform/filesystem/PlatformReaderPathStatusProvider.js")
  const library = await createReaderLibraryService(databasePath)
  return new ReaderLibraryHeadlessController(
    library,
    async (path) => {
      const source = await detectViewSource(path)
      return { source, displayName: basename(source.path) || source.path }
    },
    new ReaderLibraryCleanupService(library, new PlatformReaderPathStatusProvider(resourceScheduler)),
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

export async function createLegacySearchHistoryImporter(databasePath?: string): Promise<LegacySearchHistoryImporter> {
  const { LegacySearchHistoryImporter } = await import("./migration/LegacySearchHistoryImporter.js")
  return new LegacySearchHistoryImporter(
    await createSqliteReaderDataStore(await legacyNeoViewDatabasePath(databasePath)),
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
  const { loadNeoviewRuntimeConfig } = await import("./platform/config/loadNeoviewRuntimeConfig.js")
  const { ReaderMediaFormatRegistry } = await import("./domain/page/media.js")
  const runtimeConfig = await loadNeoviewRuntimeConfig(options)
  const sessionOptions = runtimeConfig.sessionOptions
  const mediaFormats = new ReaderMediaFormatRegistry(runtimeConfig.media)
  const progressStore = options.progressStore === false
    ? undefined
    : options.progressStore ?? (options.legacyThumbnailDatabasePath === false
      ? undefined
      : await createSqliteReaderDataStore(await legacyNeoViewDatabasePath(options.legacyThumbnailDatabasePath)))
  const mediaProgressStore = options.mediaProgressStore === false
    ? undefined
      : options.mediaProgressStore ?? (isReaderMediaProgressStore(progressStore) ? progressStore : undefined)
  const bookSettingsStore = options.bookSettingsStore === false
    ? undefined
    : options.bookSettingsStore ?? (isReaderBookSettingsStore(progressStore) ? progressStore : undefined)
  const bookSettingsModule = bookSettingsStore
    ? await import("./application/reader/ReaderBookSettingsService.js")
    : undefined
  const bookSettings = bookSettingsStore && bookSettingsModule
    ? new bookSettingsModule.ReaderBookSettingsService(bookSettingsStore)
    : undefined
  const mediaProgress = mediaProgressStore
    ? new (await import("./application/reader/ReaderMediaProgressService.js")).ReaderMediaProgressService(mediaProgressStore)
    : undefined
  const bookMetadata = isReaderDirectoryEmmRecordStore(progressStore)
    ? new (await import("./application/metadata/ReaderBookMetadataService.js")).ReaderBookMetadataService(progressStore)
    : undefined
  const ownsCache = !options.solidArchiveCache
  const solidArchiveCache = options.solidArchiveCache ?? new SolidArchiveCache({
    maxBytes: options.maxSolidArchiveCacheBytes,
  })
  const { ReaderAdjacentBookService } = await import("./application/reader/ReaderAdjacentBookService.js")
  const { PlatformDirectoryListingProvider } = await import("./platform/filesystem/PlatformDirectoryListingProvider.js")
  const { PlatformDirectoryMetadataProvider } = await import("./platform/filesystem/PlatformDirectoryMetadataProvider.js")
  const { platformReaderBookCandidate } = await import("./platform/filesystem/PlatformReaderBookCandidate.js")
  const adjacentBooks = new ReaderAdjacentBookService(
    new PlatformDirectoryListingProvider(mediaFormats),
    new PlatformDirectoryMetadataProvider(isReaderDirectoryEmmRecordStore(progressStore) ? progressStore : undefined),
    (entry) => platformReaderBookCandidate(entry, mediaFormats),
  )
  return new ReaderHeadlessController(
    new CoreReaderService(
      createPlatformReaderBookLoader({ ...options, solidArchiveCache, mediaFormats }),
      new StreamingImageMetadataProbe(),
      sessionOptions,
      progressStore,
      bookSettingsStore,
    ),
    ownsCache ? () => solidArchiveCache.close() : undefined,
    mediaProgress,
    bookMetadata,
    bookSettings && bookSettingsModule ? {
      service: bookSettings,
      defaults: bookSettingsModule.readerBookSettingsDefaults(sessionOptions),
    } : undefined,
    adjacentBooks,
  )
}

function isReaderMediaProgressStore(store: ReaderProgressStore | undefined): store is ReaderProgressStore & ReaderMediaProgressStore {
  return Boolean(store
    && typeof (store as Partial<ReaderMediaProgressStore>).getMediaProgress === "function"
    && typeof (store as Partial<ReaderMediaProgressStore>).saveMediaProgress === "function")
}

function isReaderBookSettingsStore(store: ReaderProgressStore | undefined): store is ReaderProgressStore & ReaderBookSettingsStore {
  return Boolean(store
    && typeof (store as Partial<ReaderBookSettingsStore>).getBookSettings === "function"
    && typeof (store as Partial<ReaderBookSettingsStore>).saveBookSettings === "function"
    && typeof (store as Partial<ReaderBookSettingsStore>).importBookSettings === "function")
}

function isReaderDirectoryEmmRecordStore(store: ReaderProgressStore | undefined): store is ReaderProgressStore & ReaderDirectoryEmmRecordStore {
  return Boolean(store
    && typeof (store as Partial<ReaderDirectoryEmmRecordStore>).directoryEmmAvailable === "boolean"
    && typeof (store as Partial<ReaderDirectoryEmmRecordStore>).readDirectoryEmmRecords === "function")
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
