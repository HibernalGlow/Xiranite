import type { NeoViewMigrationStatus, NeoViewRuntime } from "./core.js"
import type { ArchiveProvider } from "./ports/ArchiveProvider.js"
import type { ZipArchiveProviderOptions } from "./platform/archives/zip/ZipArchiveProvider.js"

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
