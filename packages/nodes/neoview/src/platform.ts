import type { NeoViewMigrationStatus, NeoViewRuntime } from "./core.js"
import type { ArchiveProvider } from "./ports/ArchiveProvider.js"
import type { ReaderBookLoader } from "./ports/ReaderBookLoader.js"
import type { ZipArchiveProviderOptions } from "./platform/archives/zip/ZipArchiveProvider.js"
import type { ReaderAssetRoute, ReaderAssetRouteOptions } from "./platform/asset-route/ReaderAssetRoute.js"
import type { ReaderHttpController } from "./platform/asset-route/ReaderHttpController.js"
import type { ReaderService } from "./application/reader/contracts.js"

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

export async function createReaderBookLoader(): Promise<ReaderBookLoader> {
  const { createPlatformReaderBookLoader } = await import("./platform/books/PlatformReaderBookLoader.js")
  return createPlatformReaderBookLoader()
}

export async function createReaderAssetRoute(
  readerService: ReaderService,
  options: ReaderAssetRouteOptions,
): Promise<ReaderAssetRoute> {
  const { ReaderAssetRoute } = await import("./platform/asset-route/ReaderAssetRoute.js")
  return new ReaderAssetRoute(readerService, options)
}

export async function createReaderHttpController(
  options: ReaderAssetRouteOptions,
): Promise<ReaderHttpController> {
  const { ReaderHttpController } = await import("./platform/asset-route/ReaderHttpController.js")
  return new ReaderHttpController(options)
}
