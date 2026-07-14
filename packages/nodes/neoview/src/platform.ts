import type { NeoViewMigrationStatus, NeoViewRuntime } from "./core.js"
import type { ArchiveProvider } from "./ports/ArchiveProvider.js"
import type { ReaderBookLoader } from "./ports/ReaderBookLoader.js"
import type { ZipArchiveProviderOptions } from "./platform/archives/zip/ZipArchiveProvider.js"
import type { ReaderAssetRoute, ReaderAssetRouteOptions } from "./platform/asset-route/ReaderAssetRoute.js"
import type { ReaderHttpController, ReaderHttpControllerOptions } from "./platform/asset-route/ReaderHttpController.js"
import type { ReaderService } from "./application/reader/contracts.js"
import type { ImageMetadataProbe } from "./ports/ImageMetadataProbe.js"
import type { PlatformReaderBookLoaderOptions } from "./platform/books/PlatformReaderBookLoader.js"

export type { PlatformReaderBookLoaderOptions } from "./platform/books/PlatformReaderBookLoader.js"

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
  options: ReaderHttpControllerOptions,
): Promise<ReaderHttpController> {
  const { ReaderHttpController } = await import("./platform/asset-route/ReaderHttpController.js")
  return new ReaderHttpController(options)
}

export async function createImageMetadataProbe(): Promise<ImageMetadataProbe> {
  const { StreamingImageMetadataProbe } = await import("./platform/images/StreamingImageMetadataProbe.js")
  return new StreamingImageMetadataProbe()
}
