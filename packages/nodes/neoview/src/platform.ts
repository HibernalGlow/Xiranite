import type { NeoViewMigrationStatus, NeoViewRuntime } from "./core.js"
import type { ArchiveProvider } from "./ports/ArchiveProvider.js"
import type { ReaderBookLoader } from "./ports/ReaderBookLoader.js"
import type { ZipArchiveProviderOptions } from "./platform/archives/zip/ZipArchiveProvider.js"
import type { ReaderAssetRoute, ReaderAssetRouteOptions } from "./platform/asset-route/ReaderAssetRoute.js"
import type { ReaderHttpController, ReaderHttpControllerOptions } from "./platform/asset-route/ReaderHttpController.js"
import type { ReaderService } from "./application/reader/contracts.js"
import type { ImageMetadataProbe } from "./ports/ImageMetadataProbe.js"
import type { PlatformReaderBookLoaderOptions } from "./platform/books/PlatformReaderBookLoader.js"
import type { ReaderHeadlessController } from "./application/headless/ReaderHeadlessController.js"
import type { SolidArchiveCache, SolidArchiveCacheOptions } from "./platform/archives/sevenzip/SolidArchiveCache.js"
import type { NeoviewRuntimeLoadOptions } from "./platform/config/loadNeoviewRuntimeConfig.js"

export type { PlatformReaderBookLoaderOptions } from "./platform/books/PlatformReaderBookLoader.js"
export type { SolidArchiveCacheOptions } from "./platform/archives/sevenzip/SolidArchiveCache.js"

export type ReaderCompositionOptions = PlatformReaderBookLoaderOptions & NeoviewRuntimeLoadOptions

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
  options: ReaderAssetRouteOptions,
): Promise<ReaderAssetRoute> {
  const { ReaderAssetRoute } = await import("./platform/asset-route/ReaderAssetRoute.js")
  const { WeightedLruPresentationCache } = await import("./platform/cache/WeightedLruPresentationCache.js")
  return new ReaderAssetRoute(readerService, options, {
    presentationCache: new WeightedLruPresentationCache(),
    loadImageTransformer: async () => {
      const { SharpImageTransformer } = await import("./platform/images/sharp/SharpImageTransformer.js")
      return new SharpImageTransformer()
    },
  })
}

export async function createReaderHttpController(
  options: ReaderHttpControllerOptions & NeoviewRuntimeLoadOptions,
): Promise<ReaderHttpController> {
  const { ReaderHttpController } = await import("./platform/asset-route/ReaderHttpController.js")
  const { loadNeoviewSessionOptions } = await import("./platform/config/loadNeoviewRuntimeConfig.js")
  return new ReaderHttpController({ ...options, sessionOptions: await loadNeoviewSessionOptions(options) })
}

export async function createImageMetadataProbe(): Promise<ImageMetadataProbe> {
  const { StreamingImageMetadataProbe } = await import("./platform/images/StreamingImageMetadataProbe.js")
  return new StreamingImageMetadataProbe()
}

export async function createSolidArchiveCache(options: SolidArchiveCacheOptions = {}): Promise<SolidArchiveCache> {
  const { SolidArchiveCache } = await import("./platform/archives/sevenzip/SolidArchiveCache.js")
  return new SolidArchiveCache(options)
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
  const ownsCache = !options.solidArchiveCache
  const solidArchiveCache = options.solidArchiveCache ?? new SolidArchiveCache({
    maxBytes: options.maxSolidArchiveCacheBytes,
  })
  return new ReaderHeadlessController(
    new CoreReaderService(
      createPlatformReaderBookLoader({ ...options, solidArchiveCache }),
      new StreamingImageMetadataProbe(),
      await loadNeoviewSessionOptions(options),
    ),
    ownsCache ? () => solidArchiveCache.close() : undefined,
  )
}
